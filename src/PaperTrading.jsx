// DI금융 — Alpaca 페이퍼 트레이딩 모듈 v1.0
// 실시간 계좌 현황, 포지션 관리, 전략 시그널 기반 주문 실행
// Alpaca Paper Trading API 연동 (실계좌 전환 가능)
import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { ALL_STRATEGIES } from "./strategies.js";

const C = {
  bg: "#070C14", card: "#0F1825", card2: "#141E2E",
  border: "#1A2535", border2: "#243044",
  blue: "#3182F6", blueL: "#5AA3FF", blueBg: "#1A2C4F",
  red: "#F04452", redBg: "#2A1520",
  green: "#05C072", greenBg: "#0A2A1A",
  yellow: "#FFB400", yellowBg: "#2A2000",
  purple: "#8B5CF6", purpleBg: "#1E1535",
  orange: "#FF6B2C",
  text1: "#F2F4F7", text2: "#A0AEBF", text3: "#5A6880",
};

const ALPACA_STORAGE_KEY = "di_alpaca_config";

function loadAlpacaConfig() {
  try {
    return JSON.parse(localStorage.getItem(ALPACA_STORAGE_KEY)) || {};
  } catch { return {}; }
}

function saveAlpacaConfig(cfg) {
  try { localStorage.setItem(ALPACA_STORAGE_KEY, JSON.stringify(cfg)); } catch {}
}

// ── Alpaca API 호출 래퍼 ──
async function alpacaAPI(action, config, params = {}) {
  const { apiKey, apiSecret, isPaper = true } = config;
  if (!apiKey || !apiSecret) throw new Error("API 키가 설정되지 않았습니다");

  const isPost = ["submit_order"].includes(action);
  const queryParams = isPost ? `action=${action}` : new URLSearchParams({ action, ...params }).toString();

  const res = await fetch(`/api/alpaca?${queryParams}`, {
    method: isPost ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      "x-alpaca-key": apiKey,
      "x-alpaca-secret": apiSecret,
      "x-alpaca-paper": String(isPaper),
    },
    body: isPost ? JSON.stringify(params) : undefined,
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.message || data.error || `API Error ${res.status}`);
  return data;
}

// ── 숫자 포맷 ──
function fmt(n, dec = 2) {
  if (n == null || isNaN(n)) return "—";
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function fmtUSD(n) { return n == null ? "—" : `$${fmt(n)}`; }
function fmtPct(n) { return n == null ? "—" : `${Number(n) >= 0 ? "+" : ""}${fmt(n)}%`; }

// ══════════════════════════════════════════════════════════════
// 설정 패널
// ══════════════════════════════════════════════════════════════
function SetupPanel({ config, setConfig, onConnect }) {
  const [key, setKey] = useState(config.apiKey || "");
  const [secret, setSecret] = useState(config.apiSecret || "");
  const [showSecret, setShowSecret] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");

  const handleConnect = async () => {
    if (!key.trim() || !secret.trim()) { setError("API Key와 Secret을 모두 입력해주세요"); return; }
    setTesting(true); setError("");
    try {
      const acc = await alpacaAPI("account", { apiKey: key.trim(), apiSecret: secret.trim(), isPaper: true });
      if (acc.id) {
        const newConfig = { apiKey: key.trim(), apiSecret: secret.trim(), isPaper: true, connected: true };
        setConfig(newConfig);
        saveAlpacaConfig(newConfig);
        onConnect(acc);
      } else {
        setError("계좌 인증 실패. API 키를 확인해주세요.");
      }
    } catch (e) {
      setError(e.message || "연결 실패");
    }
    setTesting(false);
  };

  return (
    <div className="tab-content">
      <div style={{ background: `linear-gradient(135deg, ${C.card} 0%, #0D1B2A 100%)`,
        border: `1px solid ${C.border}`, borderRadius: "16px", padding: "32px 24px", textAlign: "center", marginBottom: "16px" }}>
        <div style={{ fontSize: "48px", marginBottom: "12px" }}>🏦</div>
        <div style={{ fontWeight: 800, fontSize: "22px", marginBottom: "8px" }}>Alpaca 페이퍼 트레이딩</div>
        <div style={{ color: C.text3, fontSize: "14px", maxWidth: "420px", margin: "0 auto", lineHeight: 1.6 }}>
          가상 자금 $100,000으로 실시간 시장에서 전략을 검증하세요.
          실제 시장 데이터, 실제 체결 로직, 리스크 제로.
        </div>
      </div>

      {/* 가입 안내 */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "20px", marginBottom: "16px" }}>
        <div style={{ fontWeight: 700, fontSize: "15px", marginBottom: "12px" }}>시작하기</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {[
            { step: "1", title: "Alpaca 계정 생성", desc: "alpaca.markets 에서 무료 가입 (이메일만 필요)", link: "https://app.alpaca.markets/signup" },
            { step: "2", title: "Paper Trading API 키 발급", desc: "Dashboard → Paper Trading → API Keys 에서 생성" },
            { step: "3", title: "아래에 키 입력 후 연결", desc: "API Key ID와 Secret Key를 입력하세요" },
          ].map(s => (
            <div key={s.step} style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
              <div style={{ width: "28px", height: "28px", borderRadius: "50%", background: C.blueBg,
                color: C.blue, fontWeight: 800, fontSize: "13px", display: "flex", alignItems: "center",
                justifyContent: "center", flexShrink: 0 }}>{s.step}</div>
              <div>
                <div style={{ fontWeight: 600, fontSize: "13px" }}>{s.title}</div>
                <div style={{ fontSize: "12px", color: C.text3 }}>{s.desc}</div>
                {s.link && (
                  <a href={s.link} target="_blank" rel="noopener noreferrer"
                    style={{ fontSize: "12px", color: C.blue, textDecoration: "none" }}>
                    alpaca.markets 가입 →
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* API 키 입력 */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "20px" }}>
        <div style={{ fontWeight: 700, fontSize: "15px", marginBottom: "16px" }}>API 연결</div>
        <div style={{ marginBottom: "12px" }}>
          <label style={{ fontSize: "12px", color: C.text3, fontWeight: 600, marginBottom: "4px", display: "block" }}>API Key ID</label>
          <input value={key} onChange={e => setKey(e.target.value)} placeholder="PK..." style={{
            width: "100%", padding: "10px 14px", borderRadius: "10px", fontSize: "14px",
            background: C.card2, border: `1px solid ${C.border2}`, color: C.text1, outline: "none",
            fontFamily: "monospace",
          }} />
        </div>
        <div style={{ marginBottom: "16px" }}>
          <label style={{ fontSize: "12px", color: C.text3, fontWeight: 600, marginBottom: "4px", display: "block" }}>Secret Key</label>
          <div style={{ position: "relative" }}>
            <input value={secret} onChange={e => setSecret(e.target.value)}
              type={showSecret ? "text" : "password"} placeholder="Secret..." style={{
              width: "100%", padding: "10px 14px", paddingRight: "60px", borderRadius: "10px", fontSize: "14px",
              background: C.card2, border: `1px solid ${C.border2}`, color: C.text1, outline: "none",
              fontFamily: "monospace",
            }} />
            <button onClick={() => setShowSecret(!showSecret)} style={{
              position: "absolute", right: "8px", top: "50%", transform: "translateY(-50%)",
              background: "none", border: "none", color: C.text3, fontSize: "12px", cursor: "pointer",
            }}>{showSecret ? "숨기기" : "보기"}</button>
          </div>
        </div>

        {error && (
          <div style={{ background: C.redBg, border: `1px solid ${C.red}33`, borderRadius: "8px",
            padding: "10px 14px", fontSize: "12px", color: C.red, marginBottom: "12px" }}>
            {error}
          </div>
        )}

        <button onClick={handleConnect} disabled={testing} style={{
          width: "100%", padding: "12px", borderRadius: "12px", fontSize: "15px", fontWeight: 700,
          background: testing ? C.card2 : `linear-gradient(135deg, ${C.blue}, #2563EB)`,
          color: "#fff", border: "none", cursor: testing ? "default" : "pointer",
        }}>
          {testing ? "연결 중..." : "페이퍼 트레이딩 연결"}
        </button>

        <div style={{ fontSize: "11px", color: C.text3, marginTop: "10px", textAlign: "center" }}>
          API 키는 브라우저 로컬에만 저장되며 서버에 저장되지 않습니다
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// 주문 실행 모달
// ══════════════════════════════════════════════════════════════
function OrderModal({ symbol, side, reason, config, onClose, onOrderPlaced }) {
  const [qty, setQty] = useState("");
  const [notional, setNotional] = useState("");
  const [orderType, setOrderType] = useState("market");
  const [limitPrice, setLimitPrice] = useState("");
  const [qtyMode, setQtyMode] = useState("shares"); // shares | dollars
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    setSubmitting(true); setError(""); setResult(null);
    try {
      const params = {
        symbol: symbol.replace(".KS", "").replace("-USD", ""),
        side,
        type: orderType,
        time_in_force: orderType === "market" ? "day" : "gtc",
      };
      if (qtyMode === "shares") params.qty = parseFloat(qty);
      else params.notional = parseFloat(notional);
      if (orderType === "limit") params.limit_price = parseFloat(limitPrice);

      const order = await alpacaAPI("submit_order", config, params);
      setResult(order);
      if (onOrderPlaced) onOrderPlaced(order);
    } catch (e) {
      setError(e.message);
    }
    setSubmitting(false);
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "center",
      justifyContent: "center", background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
      onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: C.card, border: `1px solid ${C.border}`, borderRadius: "20px",
        padding: "24px", width: "100%", maxWidth: "400px", margin: "16px",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <div style={{ fontWeight: 800, fontSize: "17px" }}>
            {side === "buy" ? "매수" : "매도"} 주문
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: C.text3,
            fontSize: "20px", cursor: "pointer" }}>×</button>
        </div>

        {/* 종목 */}
        <div style={{ background: C.card2, borderRadius: "10px", padding: "12px", marginBottom: "12px",
          borderLeft: `3px solid ${side === "buy" ? C.red : C.blue}` }}>
          <div style={{ fontWeight: 700, fontSize: "15px" }}>{symbol}</div>
          {reason && <div style={{ fontSize: "11px", color: C.text3, marginTop: "2px" }}>{reason}</div>}
        </div>

        {!result ? (
          <>
            {/* 수량 모드 */}
            <div style={{ display: "flex", gap: "4px", marginBottom: "12px" }}>
              {[["shares", "수량(주)"], ["dollars", "금액($)"]].map(([id, label]) => (
                <button key={id} onClick={() => setQtyMode(id)} style={{
                  flex: 1, padding: "8px", borderRadius: "8px", fontSize: "12px", fontWeight: 600,
                  background: qtyMode === id ? C.blueBg : "transparent",
                  color: qtyMode === id ? C.blue : C.text3,
                  border: `1px solid ${qtyMode === id ? C.blue : C.border2}`, cursor: "pointer",
                }}>{label}</button>
              ))}
            </div>

            {/* 수량/금액 입력 */}
            <div style={{ marginBottom: "12px" }}>
              <label style={{ fontSize: "12px", color: C.text3, fontWeight: 600, display: "block", marginBottom: "4px" }}>
                {qtyMode === "shares" ? "주문 수량" : "주문 금액 (USD)"}
              </label>
              <input value={qtyMode === "shares" ? qty : notional}
                onChange={e => qtyMode === "shares" ? setQty(e.target.value) : setNotional(e.target.value)}
                type="number" placeholder={qtyMode === "shares" ? "10" : "1000"} style={{
                width: "100%", padding: "10px 14px", borderRadius: "10px", fontSize: "16px", fontWeight: 700,
                background: C.card2, border: `1px solid ${C.border2}`, color: C.text1, outline: "none",
              }} />
            </div>

            {/* 주문 유형 */}
            <div style={{ display: "flex", gap: "4px", marginBottom: "12px" }}>
              {[["market", "시장가"], ["limit", "지정가"]].map(([id, label]) => (
                <button key={id} onClick={() => setOrderType(id)} style={{
                  flex: 1, padding: "8px", borderRadius: "8px", fontSize: "12px", fontWeight: 600,
                  background: orderType === id ? C.blueBg : "transparent",
                  color: orderType === id ? C.blue : C.text3,
                  border: `1px solid ${orderType === id ? C.blue : C.border2}`, cursor: "pointer",
                }}>{label}</button>
              ))}
            </div>

            {orderType === "limit" && (
              <div style={{ marginBottom: "12px" }}>
                <label style={{ fontSize: "12px", color: C.text3, fontWeight: 600, display: "block", marginBottom: "4px" }}>지정가 ($)</label>
                <input value={limitPrice} onChange={e => setLimitPrice(e.target.value)}
                  type="number" placeholder="150.00" style={{
                  width: "100%", padding: "10px 14px", borderRadius: "10px", fontSize: "16px", fontWeight: 700,
                  background: C.card2, border: `1px solid ${C.border2}`, color: C.text1, outline: "none",
                }} />
              </div>
            )}

            {error && (
              <div style={{ background: C.redBg, borderRadius: "8px", padding: "10px",
                fontSize: "12px", color: C.red, marginBottom: "12px" }}>{error}</div>
            )}

            <button onClick={handleSubmit} disabled={submitting || (!qty && !notional)} style={{
              width: "100%", padding: "14px", borderRadius: "12px", fontSize: "15px", fontWeight: 700,
              background: submitting ? C.card2 : side === "buy"
                ? `linear-gradient(135deg, ${C.red}, #DC2626)`
                : `linear-gradient(135deg, ${C.blue}, #2563EB)`,
              color: "#fff", border: "none", cursor: submitting ? "default" : "pointer",
              opacity: (!qty && !notional) ? 0.5 : 1,
            }}>
              {submitting ? "주문 전송 중..." : side === "buy" ? `${symbol} 매수` : `${symbol} 매도`}
            </button>
          </>
        ) : (
          /* 주문 결과 */
          <div style={{ textAlign: "center", padding: "16px 0" }}>
            <div style={{ fontSize: "40px", marginBottom: "8px" }}>
              {result.status === "accepted" || result.status === "new" || result.status === "filled" ? "✅" : "⚠️"}
            </div>
            <div style={{ fontWeight: 700, fontSize: "15px", marginBottom: "4px" }}>
              {result.status === "accepted" || result.status === "new" ? "주문 접수 완료" :
               result.status === "filled" ? "주문 체결 완료" : `상태: ${result.status}`}
            </div>
            <div style={{ fontSize: "12px", color: C.text3, marginBottom: "4px" }}>
              {result.symbol} · {result.side === "buy" ? "매수" : "매도"} · {result.qty || result.notional}
              {result.type === "limit" ? ` @ $${result.limit_price}` : " 시장가"}
            </div>
            <div style={{ fontSize: "11px", color: C.text3 }}>
              주문 ID: {result.id?.slice(0, 12)}...
            </div>
            <button onClick={onClose} style={{
              marginTop: "16px", padding: "10px 24px", borderRadius: "10px",
              background: C.card2, border: `1px solid ${C.border2}`, color: C.text2,
              fontSize: "13px", fontWeight: 600, cursor: "pointer",
            }}>확인</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// 메인 컴포넌트
// ══════════════════════════════════════════════════════════════
export default function PaperTrading({ strategyAlerts = [], theme = "dark" }) {
  const [config, setConfig] = useState(() => loadAlpacaConfig());
  const [account, setAccount] = useState(null);
  const [positions, setPositions] = useState([]);
  const [orders, setOrders] = useState([]);
  const [clock, setClock] = useState(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [orderModal, setOrderModal] = useState(null); // { symbol, side, reason }
  const [autoTradeEnabled, setAutoTradeEnabled] = useState(false);
  const [tradeLog, setTradeLog] = useState([]);
  const refreshTimer = useRef(null);

  const isConnected = config.connected && config.apiKey;

  // ── 데이터 새로고침 ──
  const refreshData = useCallback(async () => {
    if (!config.apiKey) return;
    setLoading(true);
    try {
      const [acc, pos, ord, clk] = await Promise.allSettled([
        alpacaAPI("account", config),
        alpacaAPI("positions", config),
        alpacaAPI("orders", config, { status: "all", limit: "30" }),
        alpacaAPI("clock", config),
      ]);
      if (acc.status === "fulfilled") setAccount(acc.value);
      if (pos.status === "fulfilled") setPositions(Array.isArray(pos.value) ? pos.value : []);
      if (ord.status === "fulfilled") setOrders(Array.isArray(ord.value) ? ord.value : []);
      if (clk.status === "fulfilled") setClock(clk.value);
    } catch {}
    setLoading(false);
  }, [config]);

  useEffect(() => {
    if (isConnected) {
      refreshData();
      // 30초마다 자동 갱신
      refreshTimer.current = setInterval(refreshData, 30000);
      return () => clearInterval(refreshTimer.current);
    }
  }, [isConnected, refreshData]);

  // ── 전략 시그널 자동 매매 ──
  useEffect(() => {
    if (!autoTradeEnabled || !isConnected || !strategyAlerts.length) return;

    const executeAlerts = async () => {
      for (const alert of strategyAlerts) {
        // US 주식만 자동 매매 (한국/크립토는 Alpaca 미지원)
        if (!alert.symbol || alert.symbol.includes(".KS") || alert.symbol.includes("-USD")) continue;

        try {
          const order = await alpacaAPI("submit_order", config, {
            symbol: alert.symbol,
            qty: 1, // 최소 수량으로 안전하게
            side: alert.action === "매수" || alert.type === "BUY" ? "buy" : "sell",
            type: "market",
            time_in_force: "day",
          });
          setTradeLog(prev => [{
            time: new Date().toLocaleString("ko-KR"),
            symbol: alert.symbol,
            side: alert.action || alert.type,
            strategy: alert.strategy,
            orderId: order.id,
            status: order.status,
          }, ...prev].slice(0, 100));
        } catch (e) {
          setTradeLog(prev => [{
            time: new Date().toLocaleString("ko-KR"),
            symbol: alert.symbol,
            side: alert.action || alert.type,
            strategy: alert.strategy,
            error: e.message,
          }, ...prev].slice(0, 100));
        }
      }
      refreshData();
    };

    executeAlerts();
  }, [strategyAlerts, autoTradeEnabled, isConnected]);

  // ── 주문 완료 콜백 ──
  const handleOrderPlaced = useCallback(() => {
    setTimeout(refreshData, 1000);
  }, [refreshData]);

  // ── 포지션 청산 ──
  const closePosition = async (symbol) => {
    try {
      await alpacaAPI("close_position", config, { symbol });
      setTimeout(refreshData, 500);
    } catch (e) { alert("청산 실패: " + e.message); }
  };

  // ── 주문 취소 ──
  const cancelOrder = async (orderId) => {
    try {
      await alpacaAPI("cancel_order", config, { order_id: orderId });
      setTimeout(refreshData, 500);
    } catch (e) { alert("취소 실패: " + e.message); }
  };

  // ── 연결 해제 ──
  const disconnect = () => {
    setConfig({});
    saveAlpacaConfig({});
    setAccount(null);
    setPositions([]);
    setOrders([]);
  };

  // 미연결 시 설정 화면
  if (!isConnected) {
    return <SetupPanel config={config} setConfig={setConfig}
      onConnect={(acc) => setAccount(acc)} />;
  }

  // ── 계산 ──
  const equity = parseFloat(account?.equity || 0);
  const cash = parseFloat(account?.cash || 0);
  const buyingPower = parseFloat(account?.buying_power || 0);
  const portfolioValue = parseFloat(account?.portfolio_value || 0);
  const dayPL = parseFloat(account?.equity) - parseFloat(account?.last_equity || account?.equity);
  const dayPLPct = parseFloat(account?.last_equity) ? (dayPL / parseFloat(account.last_equity) * 100) : 0;
  const totalPL = equity - 100000; // 페이퍼 초기 $100k 기준
  const totalPLPct = (totalPL / 100000) * 100;

  const positionPL = positions.reduce((sum, p) => sum + parseFloat(p.unrealized_pl || 0), 0);
  const openOrders = orders.filter(o => ["new", "accepted", "pending_new", "partially_filled"].includes(o.status));
  const filledOrders = orders.filter(o => o.status === "filled");

  const marketOpen = clock?.is_open;

  return (
    <div className="tab-content">
      {/* 주문 모달 */}
      {orderModal && (
        <OrderModal
          symbol={orderModal.symbol} side={orderModal.side} reason={orderModal.reason}
          config={config} onClose={() => setOrderModal(null)} onOrderPlaced={handleOrderPlaced}
        />
      )}

      {/* ── 상단 계좌 요약 ── */}
      <div style={{ background: `linear-gradient(135deg, ${C.card} 0%, #0D1B2A 100%)`,
        border: `1px solid ${C.border}`, borderRadius: "16px", padding: "20px", marginBottom: "12px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
              <span style={{ fontWeight: 800, fontSize: "18px" }}>페이퍼 트레이딩</span>
              <span style={{ padding: "2px 8px", borderRadius: "4px", fontSize: "10px", fontWeight: 700,
                background: C.yellowBg, color: C.yellow }}>PAPER</span>
              <span style={{ padding: "2px 8px", borderRadius: "4px", fontSize: "10px", fontWeight: 700,
                background: marketOpen ? C.greenBg : C.redBg, color: marketOpen ? C.green : C.red }}>
                {marketOpen ? "장중" : "장 마감"}
              </span>
            </div>
            <div style={{ fontSize: "11px", color: C.text3 }}>
              Alpaca Paper · {loading ? "갱신 중..." : "30초 자동 갱신"}
            </div>
          </div>
          <div style={{ display: "flex", gap: "6px" }}>
            <button onClick={refreshData} style={{
              padding: "6px 12px", borderRadius: "8px", fontSize: "11px", fontWeight: 600,
              background: C.card2, border: `1px solid ${C.border2}`, color: C.text2, cursor: "pointer",
            }}>새로고침</button>
            <button onClick={disconnect} style={{
              padding: "6px 12px", borderRadius: "8px", fontSize: "11px", fontWeight: 600,
              background: C.redBg, border: `1px solid ${C.red}33`, color: C.red, cursor: "pointer",
            }}>연결 해제</button>
          </div>
        </div>

        {/* 핵심 지표 */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "8px" }}>
          {[
            { label: "총 자산", value: fmtUSD(equity), color: C.text1 },
            { label: "현금", value: fmtUSD(cash), color: C.blue },
            { label: "매수 가능액", value: fmtUSD(buyingPower), color: C.blueL },
            { label: "오늘 P&L", value: fmtUSD(dayPL), sub: fmtPct(dayPLPct), color: dayPL >= 0 ? C.green : C.red },
            { label: "총 수익", value: fmtUSD(totalPL), sub: fmtPct(totalPLPct), color: totalPL >= 0 ? C.green : C.red },
            { label: "포지션 P&L", value: fmtUSD(positionPL), color: positionPL >= 0 ? C.green : C.red },
          ].map((m, i) => (
            <div key={i} style={{ background: C.card2, borderRadius: "10px", padding: "10px 12px" }}>
              <div style={{ fontSize: "10px", color: C.text3, marginBottom: "2px" }}>{m.label}</div>
              <div style={{ fontWeight: 800, fontSize: "16px", color: m.color }}>{m.value}</div>
              {m.sub && <div style={{ fontSize: "10px", color: m.color }}>{m.sub}</div>}
            </div>
          ))}
        </div>
      </div>

      {/* ── 탭 네비게이션 ── */}
      <div style={{ display: "flex", gap: "4px", marginBottom: "12px", overflowX: "auto" }}>
        {[
          ["dashboard", "포지션", positions.length],
          ["orders", "주문 내역", orders.length],
          ["signals", "전략 시그널", strategyAlerts.length],
          ["auto", "자동 매매", null],
        ].map(([id, label, count]) => (
          <button key={id} onClick={() => setActiveTab(id)} style={{
            padding: "8px 14px", borderRadius: "8px", fontSize: "12px", fontWeight: 600,
            background: activeTab === id ? C.blueBg : "transparent",
            color: activeTab === id ? C.blue : C.text3,
            border: `1px solid ${activeTab === id ? C.blue : C.border2}`,
            cursor: "pointer", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: "6px",
          }}>
            {label}
            {count != null && count > 0 && (
              <span style={{ background: activeTab === id ? C.blue : C.border2, color: activeTab === id ? "#fff" : C.text3,
                fontSize: "10px", fontWeight: 700, borderRadius: "50%", width: "18px", height: "18px",
                display: "flex", alignItems: "center", justifyContent: "center" }}>{count}</span>
            )}
          </button>
        ))}

        <div style={{ flex: 1 }} />
        {/* 빠른 주문 */}
        <button onClick={() => setOrderModal({ symbol: "", side: "buy", reason: "수동 주문" })} style={{
          padding: "8px 14px", borderRadius: "8px", fontSize: "12px", fontWeight: 700,
          background: `linear-gradient(135deg, ${C.blue}, #2563EB)`, color: "#fff",
          border: "none", cursor: "pointer", whiteSpace: "nowrap",
        }}>+ 주문</button>
      </div>

      {/* ── 포지션 탭 ── */}
      {activeTab === "dashboard" && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "20px" }}>
          <div style={{ fontWeight: 700, marginBottom: "16px" }}>보유 포지션 ({positions.length})</div>
          {positions.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px 0", color: C.text3 }}>
              <div style={{ fontSize: "40px", marginBottom: "8px" }}>📭</div>
              <div>보유 중인 포지션이 없습니다</div>
              <div style={{ fontSize: "12px", marginTop: "4px" }}>전략 시그널에서 매수하거나 수동 주문하세요</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {positions.map((p, i) => {
                const pl = parseFloat(p.unrealized_pl || 0);
                const plPct = parseFloat(p.unrealized_plpc || 0) * 100;
                const mktVal = parseFloat(p.market_value || 0);
                const qty = parseFloat(p.qty || 0);
                const avgEntry = parseFloat(p.avg_entry_price || 0);
                const currentPrice = parseFloat(p.current_price || 0);

                return (
                  <div key={i} style={{ background: C.card2, borderRadius: "10px", padding: "12px",
                    borderLeft: `3px solid ${pl >= 0 ? C.green : C.red}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                      <div>
                        <span style={{ fontWeight: 700, fontSize: "14px", marginRight: "8px" }}>{p.symbol}</span>
                        <span style={{ fontSize: "11px", color: C.text3 }}>{qty}주 · 평단 ${fmt(avgEntry)}</span>
                      </div>
                      <div style={{ display: "flex", gap: "4px" }}>
                        <button onClick={() => setOrderModal({ symbol: p.symbol, side: "buy", reason: "추가 매수" })} style={{
                          padding: "4px 8px", borderRadius: "6px", fontSize: "10px", fontWeight: 700,
                          background: C.redBg, color: C.red, border: "none", cursor: "pointer",
                        }}>매수</button>
                        <button onClick={() => closePosition(p.symbol)} style={{
                          padding: "4px 8px", borderRadius: "6px", fontSize: "10px", fontWeight: 700,
                          background: C.blueBg, color: C.blue, border: "none", cursor: "pointer",
                        }}>청산</button>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: "16px", fontSize: "12px" }}>
                      <span style={{ color: C.text3 }}>현재가 <b style={{ color: C.text1 }}>${fmt(currentPrice)}</b></span>
                      <span style={{ color: C.text3 }}>평가액 <b style={{ color: C.text1 }}>${fmt(mktVal)}</b></span>
                      <span style={{ color: C.text3 }}>P&L <b style={{ color: pl >= 0 ? C.green : C.red }}>
                        {fmtUSD(pl)} ({fmtPct(plPct)})
                      </b></span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── 주문 내역 탭 ── */}
      {activeTab === "orders" && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "20px" }}>
          {/* 미체결 */}
          {openOrders.length > 0 && (
            <>
              <div style={{ fontWeight: 700, marginBottom: "12px", display: "flex", justifyContent: "space-between" }}>
                <span>미체결 주문 ({openOrders.length})</span>
                <button onClick={async () => {
                  await alpacaAPI("cancel_all", config);
                  setTimeout(refreshData, 500);
                }} style={{ fontSize: "11px", color: C.red, background: "none", border: "none", cursor: "pointer" }}>전체 취소</button>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "20px" }}>
                {openOrders.map((o, i) => (
                  <div key={i} style={{ background: C.card2, borderRadius: "10px", padding: "12px",
                    display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "2px" }}>
                        <span style={{ padding: "2px 6px", borderRadius: "4px", fontSize: "10px", fontWeight: 700,
                          background: o.side === "buy" ? C.redBg : C.blueBg,
                          color: o.side === "buy" ? C.red : C.blue }}>{o.side === "buy" ? "매수" : "매도"}</span>
                        <span style={{ fontWeight: 700 }}>{o.symbol}</span>
                        <span style={{ fontSize: "11px", color: C.text3 }}>{o.qty || o.notional}주</span>
                      </div>
                      <div style={{ fontSize: "11px", color: C.text3 }}>
                        {o.type === "limit" ? `지정가 $${o.limit_price}` : "시장가"} · {o.status}
                      </div>
                    </div>
                    <button onClick={() => cancelOrder(o.id)} style={{
                      padding: "4px 8px", borderRadius: "6px", fontSize: "10px",
                      background: C.redBg, color: C.red, border: "none", cursor: "pointer",
                    }}>취소</button>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* 체결 내역 */}
          <div style={{ fontWeight: 700, marginBottom: "12px" }}>체결 내역 ({filledOrders.length})</div>
          {filledOrders.length === 0 ? (
            <div style={{ textAlign: "center", padding: "30px 0", color: C.text3 }}>체결 내역이 없습니다</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "4px", maxHeight: "400px", overflow: "auto" }}>
              {filledOrders.map((o, i) => (
                <div key={i} style={{ background: C.card2, borderRadius: "8px", padding: "10px 12px",
                  display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ padding: "2px 6px", borderRadius: "4px", fontSize: "10px", fontWeight: 700,
                      background: o.side === "buy" ? C.redBg : C.blueBg,
                      color: o.side === "buy" ? C.red : C.blue }}>{o.side === "buy" ? "매수" : "매도"}</span>
                    <span style={{ fontWeight: 600, fontSize: "13px" }}>{o.symbol}</span>
                    <span style={{ fontSize: "11px", color: C.text3 }}>{o.filled_qty}주 @ ${fmt(parseFloat(o.filled_avg_price || 0))}</span>
                  </div>
                  <span style={{ fontSize: "10px", color: C.text3 }}>{new Date(o.filled_at || o.created_at).toLocaleDateString("ko-KR")}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── 전략 시그널 탭 ── */}
      {activeTab === "signals" && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "20px" }}>
          <div style={{ fontWeight: 700, marginBottom: "4px" }}>전략 매매 시그널</div>
          <div style={{ fontSize: "11px", color: C.text3, marginBottom: "16px" }}>
            스크리너에서 감지된 전략 시그널 · 클릭하여 즉시 주문 가능
          </div>
          {strategyAlerts.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px 0", color: C.text3 }}>
              <div style={{ fontSize: "40px", marginBottom: "8px" }}>📡</div>
              <div>아직 감지된 시그널이 없습니다</div>
              <div style={{ fontSize: "12px", marginTop: "4px" }}>스크리너에서 스캔을 실행하면 전략 시그널이 여기에 표시됩니다</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxHeight: "500px", overflow: "auto" }}>
              {strategyAlerts.slice(0, 50).map((a, i) => {
                const isBuy = a.action === "매수" || a.type === "BUY";
                const isUS = a.symbol && !a.symbol.includes(".KS") && !a.symbol.includes("-USD");
                return (
                  <div key={i} style={{ background: C.card2, borderRadius: "10px", padding: "12px",
                    borderLeft: `3px solid ${isBuy ? C.red : C.blue}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <span style={{ padding: "2px 6px", borderRadius: "4px", fontSize: "10px", fontWeight: 700,
                          background: isBuy ? C.redBg : C.blueBg, color: isBuy ? C.red : C.blue }}>
                          {isBuy ? "매수" : "매도"}
                        </span>
                        <span style={{ fontWeight: 700 }}>{a.symbol}</span>
                        {a.strategy && <span style={{ fontSize: "10px", color: C.purple }}>{a.strategy}</span>}
                      </div>
                      {isUS && (
                        <button onClick={() => setOrderModal({
                          symbol: a.symbol,
                          side: isBuy ? "buy" : "sell",
                          reason: `${a.strategy || "전략"} 시그널: ${a.reason || ""}`,
                        })} style={{
                          padding: "5px 10px", borderRadius: "6px", fontSize: "11px", fontWeight: 700,
                          background: isBuy ? C.red : C.blue, color: "#fff",
                          border: "none", cursor: "pointer",
                        }}>주문</button>
                      )}
                    </div>
                    <div style={{ fontSize: "11px", color: C.text3 }}>
                      {a.reason || a.strategy}
                      {!isUS && <span style={{ color: C.yellow, marginLeft: "8px" }}>(Alpaca 미지원 종목)</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── 자동 매매 탭 ── */}
      {activeTab === "auto" && (
        <div>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "20px", marginBottom: "12px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: "15px" }}>자동 매매 모드</div>
                <div style={{ fontSize: "12px", color: C.text3, marginTop: "2px" }}>
                  전략 시그널 발생 시 자동으로 최소 수량(1주) 주문 실행
                </div>
              </div>
              <button onClick={() => setAutoTradeEnabled(!autoTradeEnabled)} style={{
                width: "52px", height: "28px", borderRadius: "14px", border: "none", cursor: "pointer",
                background: autoTradeEnabled ? C.green : C.border2,
                position: "relative", transition: "background 0.2s",
              }}>
                <div style={{
                  width: "22px", height: "22px", borderRadius: "50%", background: "#fff",
                  position: "absolute", top: "3px",
                  left: autoTradeEnabled ? "27px" : "3px",
                  transition: "left 0.2s",
                }} />
              </button>
            </div>

            {autoTradeEnabled && (
              <div style={{ background: C.yellowBg, border: `1px solid ${C.yellow}33`, borderRadius: "10px",
                padding: "12px", fontSize: "12px", color: C.yellow }}>
                자동 매매가 활성화되었습니다. 스크리너 스캔 시 감지되는 US 주식 시그널에 대해 자동으로 1주 시장가 주문이 실행됩니다.
                페이퍼 트레이딩이므로 실제 자금 손실은 없습니다.
              </div>
            )}
          </div>

          {/* 자동 매매 실행 로그 */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "20px" }}>
            <div style={{ fontWeight: 700, marginBottom: "12px" }}>실행 로그 ({tradeLog.length})</div>
            {tradeLog.length === 0 ? (
              <div style={{ textAlign: "center", padding: "30px 0", color: C.text3 }}>
                자동 매매 실행 기록이 없습니다
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "4px", maxHeight: "400px", overflow: "auto" }}>
                {tradeLog.map((log, i) => (
                  <div key={i} style={{ background: C.card2, borderRadius: "8px", padding: "10px 12px",
                    borderLeft: `3px solid ${log.error ? C.red : C.green}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "2px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <span style={{ fontWeight: 700, fontSize: "13px" }}>{log.symbol}</span>
                        <span style={{ fontSize: "10px", color: C.text3 }}>{log.side}</span>
                        {log.strategy && <span style={{ fontSize: "10px", color: C.purple }}>{log.strategy}</span>}
                      </div>
                      <span style={{ fontSize: "10px", color: C.text3 }}>{log.time}</span>
                    </div>
                    {log.error ? (
                      <div style={{ fontSize: "11px", color: C.red }}>{log.error}</div>
                    ) : (
                      <div style={{ fontSize: "11px", color: C.green }}>{log.status} · ID: {log.orderId?.slice(0, 8)}...</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
