/**
 * PortfolioTab — 포트폴리오 탭 컴포넌트
 * App.jsx에서 분리된 포트폴리오 관리 UI
 */
import { memo, useState, useEffect } from "react";
import { useLanguage } from "@/i18n/LanguageContext";
import { useIsMobile } from "@/ui/useBreakpoint.jsx";
import { BottomSheet } from "@/ui/bottom-sheet.jsx";

function SearchBarWrapper({ SearchBar, onSelect, placeholder }) {
  return <SearchBar placeholder={placeholder} onSelect={onSelect} />;
}

export default memo(function PortfolioTab({
  C,
  portfolio, setPortfolio,
  portfolioPrices,
  portfolioLoading,
  showAddAsset, setShowAddAsset,
  newAsset, setNewAsset,
  currency, setCurrency,
  krwRate,
  toDisplay,
  pStats,
  fetchPortfolioPrices,
  CRYPTO_ASSETS,
  SearchBar,
  setSelectedAsset,
  setTab,
}) {
  const { t } = useLanguage();
  // ★ 모바일 감지 SSOT — useIsMobile (src/ui/useBreakpoint.jsx)
  const isMobile = useIsMobile();
  return (
    <div className="tab-content">
      {/* 요약 헤더 */}
      <div className="rounded-[16px] p-[22px_24px] mb-4" style={{
        background: `linear-gradient(135deg, ${C.card}, #0d1f35)`,
        border: `1px solid ${C.border}20`,
      }}>
        <div className={`flex justify-between items-center ${portfolio.length ? "mb-4" : ""}`} style={{ flexDirection: isMobile ? "column" : "row", alignItems: isMobile ? "flex-start" : "center", gap: isMobile ? "12px" : "0" }}>
          <div className="font-bold" style={{ color: C.text1, fontSize: isMobile ? "16px" : "18px" }}>{t("portfolio.myPortfolio")}</div>
          <div className="flex gap-1.5 flex-wrap" style={{ width: isMobile ? "100%" : "auto", justifyContent: isMobile ? "stretch" : "flex-start" }}>
            <button onClick={() => setCurrency(c => c === "USD" ? "KRW" : "USD")} className="rounded-lg px-2.5 font-bold transition-all" style={{
              background: C.card2, color: C.yellow, border: `1px solid ${C.yellow}44`,
              minHeight: "44px", display: "flex", alignItems: "center", justifyContent: "center",
              flex: isMobile ? "1 1 calc(33.333% - 6px)" : "0 0 auto",
            }}>{currency === "USD" ? t("portfolio.currencyUSD") : t("portfolio.currencyKRW")}</button>
            <button onClick={fetchPortfolioPrices} className="rounded-lg px-3 font-semibold transition-all" style={{
              background: C.blueBg, color: C.blue, border: `1px solid ${C.blue}44`,
              minHeight: "44px", display: "flex", alignItems: "center", justifyContent: "center",
              flex: isMobile ? "1 1 calc(33.333% - 6px)" : "0 0 auto",
            }}>{portfolioLoading ? t("portfolio.refreshing") : t("portfolio.refreshBtn")}</button>
            <button onClick={() => setShowAddAsset(true)} className="rounded-lg px-3.5 font-bold transition-all" style={{
              background: C.blue, color: "#fff", border: "none",
              minHeight: "44px", display: "flex", alignItems: "center", justifyContent: "center",
              flex: isMobile ? "1 1 calc(33.333% - 6px)" : "0 0 auto",
            }}>+ {t("portfolio.addBtn")}</button>
          </div>
        </div>
        {portfolio.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)", gap: isMobile ? "8px" : "10px" }}>
            {[
              { label: t("portfolio.invested"), value: currency === "KRW" ? `₩${Math.round(pStats.invested * krwRate).toLocaleString()}` : `$${pStats.invested.toLocaleString(undefined, { maximumFractionDigits: 0 })}` },
              { label: t("portfolio.current"), value: pStats.hasPrices ? (currency === "KRW" ? `₩${Math.round(pStats.current * krwRate).toLocaleString()}` : `$${pStats.current.toLocaleString(undefined, { maximumFractionDigits: 0 })}`) : "—" },
              { label: t("portfolio.pnl"), value: pStats.hasPrices ? `${pStats.pnl >= 0 ? "+" : ""}${currency === "KRW" ? `₩${Math.round(Math.abs(pStats.pnl) * krwRate).toLocaleString()}` : `$${pStats.pnl.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}` : "—", color: pStats.pnl >= 0 ? C.green : C.red },
            ].map(({ label, value, color }) => (
              <div key={label} className="rounded-xl" style={{ background: C.bg, padding: isMobile ? "10px 12px" : "14px" }}>
                <div style={{ color: C.text3, marginBottom: "4px", fontSize: isMobile ? "12px" : "14px" }}>{label}</div>
                <div className="font-bold" style={{ color: color || C.text1, fontSize: isMobile ? "14px" : "18px" }}>{value}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 자산 추가 폼 — 데스크탑: inline 카드 / 모바일: BottomSheet (홈 인디케이터 회피, 드래그 닫기) */}
      {(() => {
        const submitAsset = () => {
          if (!newAsset.symbol || !newAsset.qty || !newAsset.avgPrice) return;
          const sym = newAsset.symbol.toUpperCase();
          const symbolRaw = newAsset.market === "kr" && !sym.includes(".KS") ? `${sym}.KS` : sym;
          const cryptoA = CRYPTO_ASSETS.find(c => c.symbol === sym || c.id === sym.toLowerCase());
          setPortfolio(p => [...p, {
            ...newAsset, symbol: sym, symbolRaw, cryptoId: cryptoA?.id || sym.toLowerCase(),
            qty: parseFloat(newAsset.qty), avgPrice: parseFloat(newAsset.avgPrice), addedAt: Date.now(),
          }]);
          setNewAsset({ symbol: "", name: "", market: "us", qty: "", avgPrice: "" });
          setShowAddAsset(false);
        };
        const formBody = (
          <>
            <div className="mb-3">
              <div style={{ color: C.text3, marginBottom: "8px", fontSize: "14px" }}>{t("portfolio.searchSymbol")}</div>
              <SearchBarWrapper SearchBar={SearchBar} placeholder={t("portfolio.symbolPlaceholder")} onSelect={(asset) => {
                const sym = asset.symbol.toUpperCase();
                setNewAsset(p => ({ ...p, symbol: sym, name: asset.name, market: asset.market }));
              }} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, 1fr)", gap: "10px", marginBottom: "12px" }}>
              {[
                { k: "symbol",   label: t("portfolio.symbolPlaceholder").split(",")[0], ph: t("portfolio.symbolPlaceholder") },
                { k: "name",     label: t("portfolio.nameLabel"), ph: t("portfolio.namePlaceholder") },
                { k: "qty",      label: t("portfolio.qtyLabel"), ph: t("portfolio.qtyPlaceholder") },
                { k: "avgPrice", label: t("portfolio.avgPriceLabel"), ph: t("portfolio.avgPricePlaceholder") },
              ].map(({ k, label, ph }) => (
                <div key={k}>
                  <div style={{ color: C.text3, marginBottom: "6px", fontSize: "14px" }}>{label}</div>
                  <input value={newAsset[k]} onChange={e => setNewAsset(p => ({ ...p, [k]: e.target.value }))}
                    placeholder={ph} className="w-full rounded-[10px] outline-none box-border" style={{
                      background: C.bg, border: `1px solid ${C.border2}`, color: C.text1,
                      padding: "10px 12px", minHeight: "44px",
                      // iOS Safari 자동 zoom-in 방지 — 모바일에선 16px 강제
                      fontSize: isMobile ? "16px" : "14px",
                    }} />
                </div>
              ))}
            </div>
            <div className="mb-1">
              <div style={{ color: C.text3, marginBottom: "10px", fontSize: "14px" }}>{t("portfolio.marketLabel")}</div>
              <div className="flex gap-1.5" style={{ flexDirection: isMobile ? "row" : "row" }}>
                {[["us",t("portfolio.marketUS")], ["kr",t("portfolio.marketKR")], ["crypto",t("portfolio.marketCrypto")]].map(([v, l]) => (
                  <button key={v} onClick={() => setNewAsset(p => ({ ...p, market: v }))} className="rounded-lg font-semibold transition-all" style={{
                    background: newAsset.market === v ? C.blueBg : C.card2,
                    color: newAsset.market === v ? C.blue : C.text3,
                    border: `1px solid ${newAsset.market === v ? C.blue : C.border2}`,
                    minHeight: "44px", padding: "10px 12px", flex: "1", display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: "14px",
                  }}>{l}</button>
                ))}
              </div>
            </div>
          </>
        );
        const footerButtons = (
          <>
            <button onClick={submitAsset} className="flex-1 rounded-[10px] font-bold border-none transition-all" style={{
              background: C.blue, color: "#fff",
              minHeight: "44px", padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: isMobile ? "15px" : "16px",
            }}>{t("portfolio.addBtn")}</button>
            <button onClick={() => setShowAddAsset(false)} className="flex-1 rounded-[10px] font-semibold transition-all" style={{
              background: C.card2, color: C.text3, border: `1px solid ${C.border2}`,
              minHeight: "44px", padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: isMobile ? "15px" : "16px",
            }}>{t("portfolio.cancelBtn")}</button>
          </>
        );

        // 모바일: BottomSheet — iOS 네이티브 패턴, safe-area 자동, 드래그 닫기
        if (isMobile) {
          return (
            <BottomSheet
              open={showAddAsset}
              onClose={() => setShowAddAsset(false)}
              title={`📌 ${t("portfolio.addAsset")}`}
              footer={<div className="flex gap-2 w-full">{footerButtons}</div>}
              maxHeight="88dvh"
            >
              {formBody}
            </BottomSheet>
          );
        }
        // 데스크탑: inline 카드 유지
        if (!showAddAsset) return null;
        return (
          <div className="rounded-[16px] mb-4" style={{ background: C.card, border: `1px solid ${C.border}20`, padding: "22px 24px" }}>
            <div className="font-bold mb-3.5" style={{ color: C.text1, fontSize: "18px" }}>📌 {t("portfolio.addAsset")}</div>
            {formBody}
            <div className="flex gap-2 mt-3">
              {footerButtons}
            </div>
          </div>
        );
      })()}

      {/* 포트폴리오 아이템 */}
      {portfolio.length === 0 ? (
        <div style={{
          borderRadius: "20px",
          padding: isMobile ? "40px 16px" : "56px 24px",
          textAlign: "center",
          background: `linear-gradient(135deg, ${C.blueBg}20 0%, ${C.card2}40 100%)`,
          border: `1px solid ${C.border}20`,
          boxShadow: `0 4px 16px ${C.blue}10`,
        }}>
          <div style={{ fontSize: isMobile ? "40px" : "56px", marginBottom: "16px", animation: "float 3s ease-in-out infinite" }}>💼</div>
          <div style={{ fontSize: isMobile ? "16px" : "20px", fontWeight: 800, marginBottom: "8px", color: C.text1 }}>
            {t("portfolio.startPortfolio") || "포트폴리오를 시작하세요"}
          </div>
          <div style={{ fontSize: isMobile ? "14px" : "16px", color: C.text3, lineHeight: 1.7, marginBottom: "28px" }}>
            {t("portfolio.startDesc") || "보유 자산을 기록하고 성과를 추적하세요"}
          </div>

          {/* 스텝 가이드 */}
          <div style={{
            display: "flex",
            flexDirection: "column",
            gap: "10px",
            maxWidth: "420px",
            margin: "0 auto 28px",
            textAlign: "left",
          }}>
            {[
              { icon: "1️⃣", text: t("portfolio.step1") || "종목을 검색하여 추가" },
              { icon: "2️⃣", text: t("portfolio.step2") || "매수 가격과 수량 입력" },
              { icon: "3️⃣", text: t("portfolio.step3") || "실시간 성과 추적" },
            ].map((step, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: isMobile ? "10px" : "12px",
                  padding: isMobile ? "10px 12px" : "12px 16px",
                  borderRadius: "12px",
                  background: `${C.blue}10`,
                  border: `1px solid ${C.blue}20`,
                  transition: "all .2s",
                  minHeight: isMobile ? "44px" : "auto",
                }}
                onMouseEnter={e => { e.currentTarget.style.background = `${C.blue}20`; e.currentTarget.style.transform = "translateX(4px)"; }}
                onMouseLeave={e => { e.currentTarget.style.background = `${C.blue}10`; e.currentTarget.style.transform = "translateX(0)"; }}
              >
                <span style={{ fontSize: isMobile ? "16px" : "18px", minWidth: "24px" }}>{step.icon}</span>
                <span style={{ fontSize: isMobile ? "14px" : "15px", color: C.text2, fontWeight: 500 }}>{step.text}</span>
              </div>
            ))}
          </div>

          {/* CTA 버튼 */}
          <div style={{ display: "flex", gap: "10px", justifyContent: "center", flexWrap: isMobile ? "wrap" : "nowrap", flexDirection: isMobile ? "column" : "row" }}>
            <button
              onClick={() => setTab("screener")}
              style={{
                padding: isMobile ? "10px 16px" : "10px 24px",
                borderRadius: "12px",
                fontSize: isMobile ? "14px" : "15px",
                fontWeight: 700,
                background: C.blue,
                color: "#fff",
                border: "none",
                cursor: "pointer",
                transition: "all .2s",
                boxShadow: `0 4px 12px ${C.blue}30`,
                minHeight: isMobile ? "44px" : "auto", flex: isMobile ? "1" : "0 0 auto",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
              onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = `0 6px 20px ${C.blue}40`; }}
              onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = `0 4px 12px ${C.blue}30`; }}
            >
              {t("portfolio.screener") || "스크리너에서 찾기"}
            </button>
            <button
              onClick={() => setTab("quant-report")}
              style={{
                padding: isMobile ? "10px 16px" : "10px 24px",
                borderRadius: "12px",
                fontSize: isMobile ? "14px" : "15px",
                fontWeight: 700,
                background: C.card2,
                color: C.text2,
                border: `1.5px solid ${C.border}`,
                cursor: "pointer",
                transition: "all .2s",
                minHeight: isMobile ? "44px" : "auto", flex: isMobile ? "1" : "0 0 auto",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
              onMouseEnter={e => { e.currentTarget.style.background = `${C.blue}15`; e.currentTarget.style.color = C.blue; e.currentTarget.style.borderColor = C.blue; }}
              onMouseLeave={e => { e.currentTarget.style.background = C.card2; e.currentTarget.style.color = C.text2; e.currentTarget.style.borderColor = C.border; }}
            >
              {t("portfolio.report") || "추천 리포트 보기"}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {portfolio.map((item, idx) => {
            const cur = portfolioPrices[item.symbol];
            const gain = cur ? ((cur - item.avgPrice) / item.avgPrice) * 100 : null;
            const gainVal = cur ? item.qty * (cur - item.avgPrice) : null;
            const invested = item.qty * item.avgPrice;
            const evalVal = cur ? item.qty * cur : null;
            const isPos = gainVal != null ? gainVal >= 0 : true;
            const mcColor = item.market === "us" ? C.blue : item.market === "kr" ? C.green : C.purple;
            // 다크 전용 hex 를 테마 알파 틴트로 교체 — 라이트 모드에서도 동작 (App.jsx 시장 배지와 동일 패턴)
            const mcBg = item.market === "us" ? `${C.blue}1A` : item.market === "kr" ? `${C.green}1A` : `${C.purple}1A`;
            const flag = item.market === "us" ? "🇺🇸" : item.market === "kr" ? "🇰🇷" : "₿";
            return (
              <div key={idx} className="rounded-[16px] overflow-hidden" style={{
                background: C.card, border: `1px solid ${C.border}20`,
              }}>
                <div className="flex items-center p-4 gap-3.5" style={{ flexDirection: isMobile ? "column" : "row", alignItems: isMobile ? "flex-start" : "center" }}>
                  <div className="size-11 rounded-xl flex-shrink-0 flex items-center justify-center font-black text-sm" style={{
                    background: mcBg, color: mcColor,
                  }}>
                    {item.symbol.replace(".KS","").slice(0,4)}
                  </div>
                  <div className="flex-1 min-w-0" style={{ width: isMobile ? "100%" : "auto" }}>
                    <div className="flex items-center gap-2 mb-0.5" style={{ flexWrap: "wrap" }}>
                      <span className="font-bold" style={{ color: C.text1, fontSize: isMobile ? "14px" : "18px" }}>{item.name || item.symbol}</span>
                      <span style={{ color: C.text3, fontSize: isMobile ? "12px" : "14px" }}>{flag} {item.symbol}</span>
                    </div>
                    <div style={{ color: C.text3, fontSize: isMobile ? "12px" : "14px" }}>
                      {item.qty.toLocaleString()} {t("portfolio.shares")} · {t("portfolio.avgPrice")} {toDisplay(item.avgPrice, item.market)}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flex: isMobile ? "1 0 100%" : "0 0 auto", width: isMobile ? "100%" : "auto", paddingTop: isMobile ? "12px" : "0", borderTop: isMobile ? `1px solid ${C.border}` : "none" }}>
                    <div className="font-bold mb-0.5" style={{ color: C.text1, fontSize: isMobile ? "14px" : "18px" }}>
                      {toDisplay(cur, item.market)}
                    </div>
                    {gain != null && (
                      <div className="font-bold" style={{ color: isPos ? C.green : C.red, fontSize: isMobile ? "14px" : "16px" }}>
                        {isPos ? "+" : ""}{gain.toFixed(2)}%
                      </div>
                    )}
                  </div>
                </div>

                {cur != null && (
                  <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)", gap: isMobile ? "8px" : "6px", padding: isMobile ? "12px" : "14px 18px 12px", fontSize: isMobile ? "14px" : "14px" }}>
                    <div className="rounded-lg" style={{ background: C.bg, padding: isMobile ? "10px 12px" : "10px" }}>
                      <div style={{ marginBottom: "4px", color: C.text3, fontSize: isMobile ? "12px" : "12px" }}>{t("portfolio.investedAmount")}</div>
                      <div className="font-bold" style={{ color: C.text1, fontSize: isMobile ? "14px" : "16px" }}>
                        {toDisplay(invested, item.market)}
                      </div>
                    </div>
                    <div className="rounded-lg" style={{ background: C.bg, padding: isMobile ? "10px 12px" : "10px" }}>
                      <div style={{ marginBottom: "4px", color: C.text3, fontSize: isMobile ? "12px" : "12px" }}>{t("portfolio.evaluatedAmount")}</div>
                      <div className="font-bold" style={{ color: C.text1, fontSize: isMobile ? "14px" : "16px" }}>
                        {toDisplay(evalVal, item.market)}
                      </div>
                    </div>
                    <div className="rounded-lg" style={{ background: isPos ? C.greenBg : C.redBg, padding: isMobile ? "10px 12px" : "10px" }}>
                      <div style={{ marginBottom: "4px", color: C.text3, fontSize: isMobile ? "12px" : "12px" }}>{t("portfolio.profitLoss")}</div>
                      <div className="font-bold" style={{ color: isPos ? C.green : C.red, fontSize: isMobile ? "14px" : "16px" }}>
                        {isPos ? "+" : ""}{toDisplay(Math.abs(gainVal), item.market)}
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex gap-2" style={{ padding: isMobile ? "10px 12px" : "12px 18px 14px", flexDirection: isMobile ? "column" : "row" }}>
                  <button onClick={() => {
                    const cryptoA = CRYPTO_ASSETS.find(c => c.symbol === item.symbol);
                    setSelectedAsset({
                      symbol: item.symbol, name: item.name || item.symbol,
                      market: item.market, symbolRaw: item.symbolRaw || item.symbol,
                      ...(cryptoA ? { id: cryptoA.id } : {}),
                    });
                  }} className="flex-1 rounded-[10px] font-semibold transition-all flex items-center justify-center gap-1.5" style={{
                    background: C.blueBg, color: C.blue, border: `1px solid ${C.blue}33`,
                    minHeight: "44px", padding: "8px 12px", fontSize: isMobile ? "14px" : "14px",
                  }}>{t("portfolio.diagnostic")}</button>
                  <button onClick={() => {
                    const sym = item.market === "crypto"
                      ? `https://www.coingecko.com/en/coins/${item.cryptoId || item.symbol.toLowerCase()}`
                      : `https://finance.yahoo.com/quote/${item.symbolRaw || item.symbol}`;
                    window.open(sym, "_blank");
                  }} className="flex-1 rounded-[10px] font-semibold transition-all flex items-center justify-center gap-1.5" style={{
                    background: C.card2, color: C.text2, border: `1px solid ${C.border2}`,
                    minHeight: "44px", padding: "8px 12px", fontSize: isMobile ? "14px" : "14px",
                  }}>{t("portfolio.detail")}</button>
                  <button onClick={() => {
                    if (!confirm(t("portfolio.deleteConfirm"))) return;
                    setPortfolio(p => p.filter((_, i) => i !== idx));
                  }} className="rounded-[10px] font-semibold transition-all flex items-center justify-center" style={{
                    background: C.redBg, color: C.red, border: `1px solid ${C.red}33`,
                    minHeight: "44px", padding: "8px 12px", flex: isMobile ? "0 0 auto" : "0 0 auto", fontSize: isMobile ? "14px" : "14px",
                  }}>{t("portfolio.delete")}</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});
