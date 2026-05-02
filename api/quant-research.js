// ═══════════════════════════════════════════════════════════════
// Zepta — 퀀트 전략 연구 엔진 v2.1 (Production-Grade)
// ═══════════════════════════════════════════════════════════════
// 매일 06:00 UTC 자동 실행 (Vercel Cron)
// 일별 배치 로테이션: Day0=대형성장, Day1=대형가치+금융, Day2=반도체+소비재,
//   Day3=헬스+산업+에너지, Day4=ETF+크립토, Day5=중형성장, Day6=글로벌+테마
// 15개 전략 × 다중 파라미터 × 8~12종목/일 = 매주 60+종목 커버
// 환경변수: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
// 텔레그램 알림: api/_shared/telegram.js 의 buildCard/sendCards (사용자 친화)
// ═══════════════════════════════════════════════════════════════

import { sendCards, buildCard, fmtKSTShort } from "./_shared/telegram.js";

// ── 유니버스: 7개 배치 (요일별 로테이션) ──
const BATCHES = [
  // Day 0 (일) — 대형 성장주
  { name: "대형 성장", symbols: [
    { sym: "AAPL", name: "애플" }, { sym: "MSFT", name: "마이크로소프트" },
    { sym: "GOOG", name: "구글" }, { sym: "AMZN", name: "아마존" },
    { sym: "META", name: "메타" }, { sym: "NFLX", name: "넷플릭스" },
    { sym: "TSLA", name: "테슬라" }, { sym: "CRM", name: "세일즈포스" },
    { sym: "ADBE", name: "어도비" }, { sym: "ORCL", name: "오라클" },
  ]},
  // Day 1 (월) — 대형 가치 + 금융
  { name: "가치+금융", symbols: [
    { sym: "BRK-B", name: "버크셔" }, { sym: "JPM", name: "JP모건" },
    { sym: "V", name: "비자" }, { sym: "MA", name: "마스터카드" },
    { sym: "BAC", name: "BoA" }, { sym: "GS", name: "골드만삭스" },
    { sym: "WFC", name: "웰스파고" }, { sym: "MS", name: "모건스탠리" },
    { sym: "BLK", name: "블랙록" }, { sym: "SCHW", name: "찰스슈왑" },
    { sym: "COIN", name: "코인베이스" }, { sym: "PYPL", name: "페이팔" },
  ]},
  // Day 2 (화) — 반도체 + 소비재
  { name: "반도체+소비재", symbols: [
    { sym: "NVDA", name: "엔비디아" }, { sym: "AMD", name: "AMD" },
    { sym: "AVGO", name: "브로드컴" }, { sym: "INTC", name: "인텔" },
    { sym: "QCOM", name: "퀄컴" }, { sym: "MU", name: "마이크론" },
    { sym: "LRCX", name: "램리서치" }, { sym: "AMAT", name: "어플라이드" },
    { sym: "COST", name: "코스트코" }, { sym: "WMT", name: "월마트" },
    { sym: "HD", name: "홈디포" }, { sym: "NKE", name: "나이키" },
  ]},
  // Day 3 (수) — 헬스케어 + 산업재 + 에너지
  { name: "헬스+산업+에너지", symbols: [
    { sym: "UNH", name: "유나이티드헬스" }, { sym: "JNJ", name: "J&J" },
    { sym: "LLY", name: "일라이릴리" }, { sym: "ABBV", name: "애브비" },
    { sym: "MRK", name: "머크" }, { sym: "PFE", name: "화이자" },
    { sym: "BA", name: "보잉" }, { sym: "CAT", name: "캐터필라" },
    { sym: "GE", name: "GE" }, { sym: "XOM", name: "엑슨모빌" },
    { sym: "CVX", name: "셰브론" }, { sym: "COP", name: "코노코필립스" },
  ]},
  // Day 4 (목) — ETF + 크립토
  { name: "ETF+크립토", symbols: [
    { sym: "SPY", name: "S&P 500" }, { sym: "QQQ", name: "나스닥100" },
    { sym: "IWM", name: "러셀2000" }, { sym: "DIA", name: "다우30" },
    { sym: "XLF", name: "금융ETF" }, { sym: "XLE", name: "에너지ETF" },
    { sym: "XLK", name: "기술ETF" }, { sym: "ARKK", name: "ARK혁신" },
    { sym: "BTC-USD", name: "비트코인", crypto: true },
    { sym: "ETH-USD", name: "이더리움", crypto: true },
    { sym: "SOL-USD", name: "솔라나", crypto: true },
  ]},
  // Day 5 (금) — 중형 성장주
  { name: "중형 성장", symbols: [
    { sym: "SQ", name: "블록" }, { sym: "SHOP", name: "쇼피파이" },
    { sym: "SNOW", name: "스노우플레이크" }, { sym: "DDOG", name: "데이터독" },
    { sym: "NET", name: "클라우드플레어" }, { sym: "CRWD", name: "크라우드스트라이크" },
    { sym: "ZS", name: "지스케일러" }, { sym: "PANW", name: "팔로알토" },
    { sym: "UBER", name: "우버" }, { sym: "ABNB", name: "에어비앤비" },
    { sym: "DASH", name: "도어대시" }, { sym: "RBLX", name: "로블록스" },
  ]},
  // Day 6 (토) — 글로벌 + 테마
  { name: "글로벌+테마", symbols: [
    { sym: "BABA", name: "알리바바" }, { sym: "TSM", name: "TSMC" },
    { sym: "ASML", name: "ASML" }, { sym: "NVO", name: "노보노디스크" },
    { sym: "MSTR", name: "마이크로스트래티지" }, { sym: "IBIT", name: "BTC ETF" },
    { sym: "PLTR", name: "팔란티어" }, { sym: "AI", name: "C3.ai" },
    { sym: "SMCI", name: "슈퍼마이크로" }, { sym: "ARM", name: "ARM" },
    { sym: "LMT", name: "록히드마틴" }, { sym: "RTX", name: "레이시온" },
  ]},
];

// ── 15개 전략 + 파라미터 그리드 ──
const STRATEGY_DEFS = [
  { name: "RSI Reversal", fn: strategyRSI, params: [
    { period: 14, buyTh: 30, sellTh: 70 }, { period: 10, buyTh: 25, sellTh: 75 },
    { period: 14, buyTh: 25, sellTh: 75 }, { period: 21, buyTh: 35, sellTh: 65 },
    { period: 7, buyTh: 20, sellTh: 80 },
  ]},
  { name: "MACD Cross", fn: strategyMACD, params: [
    { fast: 12, slow: 26, sig: 9 }, { fast: 8, slow: 21, sig: 5 },
    { fast: 12, slow: 26, sig: 5 }, { fast: 5, slow: 13, sig: 8 },
  ]},
  { name: "BB Bounce", fn: strategyBB, params: [
    { period: 20, mult: 2 }, { period: 20, mult: 2.5 },
    { period: 30, mult: 2 }, { period: 15, mult: 1.5 },
  ]},
  { name: "Triple MA", fn: strategyTripleMA, params: [
    { fast: 10, mid: 20, slow: 50 }, { fast: 5, mid: 13, slow: 34 },
    { fast: 8, mid: 21, slow: 55 }, { fast: 13, mid: 34, slow: 89 },
  ]},
  { name: "Supertrend", fn: strategySupertrend, params: [
    { atrPeriod: 10, mult: 3 }, { atrPeriod: 14, mult: 2.5 },
    { atrPeriod: 10, mult: 2 }, { atrPeriod: 7, mult: 3.5 },
  ]},
  { name: "Keltner Channel", fn: strategyKeltner, params: [
    { emaPeriod: 20, atrPeriod: 10, mult: 2 },
    { emaPeriod: 20, atrPeriod: 14, mult: 1.5 },
    { emaPeriod: 10, atrPeriod: 10, mult: 2.5 },
  ]},
  { name: "Stochastic RSI", fn: strategyStochRSI, params: [
    { rsiPeriod: 14, stochPeriod: 14, buyTh: 20, sellTh: 80 },
    { rsiPeriod: 10, stochPeriod: 10, buyTh: 15, sellTh: 85 },
    { rsiPeriod: 21, stochPeriod: 14, buyTh: 25, sellTh: 75 },
  ]},
  { name: "Volume Breakout", fn: strategyVolBreak, params: [
    { volMult: 2.0, trendPeriod: 50 }, { volMult: 1.5, trendPeriod: 20 },
    { volMult: 2.5, trendPeriod: 50 },
  ]},
  { name: "Dual Momentum", fn: strategyDualMom, params: [
    { lookback: 60, holdBars: 20 }, { lookback: 90, holdBars: 30 },
    { lookback: 40, holdBars: 15 },
  ]},
  { name: "Mean Reversion", fn: strategyMeanRev, params: [
    { period: 20, zThreshold: 2.0 }, { period: 20, zThreshold: 2.5 },
    { period: 30, zThreshold: 1.5 }, { period: 10, zThreshold: 2.0 },
  ]},
  { name: "Ichimoku Cloud", fn: strategyIchimoku, params: [
    { tenkan: 9, kijun: 26, senkou: 52 },
    { tenkan: 7, kijun: 22, senkou: 44 },
  ]},
  { name: "OBV Trend", fn: strategyOBVTrend, params: [
    { emaPeriod: 20 }, { emaPeriod: 10 }, { emaPeriod: 30 },
  ]},
  { name: "Parabolic SAR", fn: strategyPSAR, params: [
    { step: 0.02, max: 0.2 }, { step: 0.01, max: 0.15 },
    { step: 0.03, max: 0.3 },
  ]},
  { name: "Connors RSI(2)", fn: strategyConnorsRSI2, params: [
    { rsiPeriod: 2, buyTh: 10, sellTh: 90 },
    { rsiPeriod: 2, buyTh: 5, sellTh: 95 },
    { rsiPeriod: 3, buyTh: 15, sellTh: 85 },
  ]},
  { name: "BTC Alpha", fn: strategyBTCAlpha, cryptoOnly: true, params: [
    { rsiPeriod: 14, bbMult: 2.5, emaFast: 21, emaSlow: 55, cooldown: 3 },
    { rsiPeriod: 10, bbMult: 2.0, emaFast: 13, emaSlow: 34, cooldown: 2 },
    { rsiPeriod: 14, bbMult: 3.0, emaFast: 21, emaSlow: 55, cooldown: 5 },
  ]},
  // ── 알파 전략 (시장 비효율성 포착) ──
  { name: "Hurst Regime", fn: strategyHurstRegime, params: [
    { lookback: 100, trendTh: 0.55, meanRevTh: 0.45 },
    { lookback: 60, trendTh: 0.58, meanRevTh: 0.42 },
    { lookback: 150, trendTh: 0.52, meanRevTh: 0.48 },
  ]},
  { name: "Efficiency Ratio", fn: strategyEfficiencyRatio, params: [
    { period: 10, surgeTh: 0.6, collapseTh: 0.2 },
    { period: 15, surgeTh: 0.55, collapseTh: 0.25 },
    { period: 8, surgeTh: 0.65, collapseTh: 0.15 },
  ]},
  { name: "Vol Cluster", fn: strategyVolCluster, params: [
    { atrPeriod: 14, longMAPeriod: 50, explosionRatio: 1.8 },
    { atrPeriod: 10, longMAPeriod: 40, explosionRatio: 2.0 },
    { atrPeriod: 14, longMAPeriod: 60, explosionRatio: 1.5 },
  ]},
  { name: "Momentum Decay", fn: strategyMomentumDecay, params: [
    { momPeriod: 10, rsiPeriod: 14, rsiHigh: 60, rsiLow: 40 },
    { momPeriod: 15, rsiPeriod: 14, rsiHigh: 65, rsiLow: 35 },
    { momPeriod: 8, rsiPeriod: 10, rsiHigh: 55, rsiLow: 45 },
  ]},
  { name: "Smart Money", fn: strategySmartMoney, params: [
    { flatRange: 1.5, volMult: 2.0, obvEmaPeriod: 20 },
    { flatRange: 1.0, volMult: 1.8, obvEmaPeriod: 15 },
    { flatRange: 2.0, volMult: 2.5, obvEmaPeriod: 25 },
  ]},
];

export default async function handler(req, res) {
  const start = Date.now();
  const log = [];
  const L = (m) => { log.push(m); console.log(m); };

  try {
    const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TG_CHAT = process.env.TELEGRAM_CHAT_ID;

    // 오늘 배치 결정 (요일 기반 로테이션)
    const today = new Date();
    const dayOfWeek = today.getDay(); // 0=Sun...6=Sat
    const batch = BATCHES[dayOfWeek];

    L(`🔬 퀀트 연구 v2.0 — [Day ${dayOfWeek}] ${batch.name} (${batch.symbols.length}종목 × ${STRATEGY_DEFS.length}전략)`);

    const results = [];
    let fetchCount = 0;
    let testCount = 0;

    // ── 종목별 처리 ──
    for (const sym of batch.symbols) {
      // Vercel Hobby 10s timeout 대응: 이미 8초 초과 시 중단
      if (Date.now() - start > 8000) {
        L(`⏱️ 타임아웃 임박 — ${fetchCount}종목 처리 후 중단`);
        break;
      }

      const candles = await fetchYahoo(sym.sym);
      if (!candles || candles.length < 60) { L(`⚠️ ${sym.sym}: 데이터 부족`); continue; }
      fetchCount++;

      const closes = candles.map(c => c.close);
      const lastPrice = closes[closes.length - 1];
      L(`📊 ${sym.name} (${sym.sym}): ${candles.length}봉, $${lastPrice?.toFixed(2)}`);

      // ── 각 전략 × 파라미터 백테스트 ──
      for (const strat of STRATEGY_DEFS) {
        if (strat.cryptoOnly && !sym.crypto) continue;
        if (!strat.cryptoOnly && sym.crypto && strat.name !== "RSI Reversal" && strat.name !== "MACD Cross"
          && strat.name !== "BB Bounce" && strat.name !== "Supertrend" && strat.name !== "Mean Reversion") continue;

        for (const p of strat.params) {
          try {
            const sigs = strat.fn(candles, p);
            if (!sigs || sigs.length < 2) continue;
            testCount++;

            const bt = backtest(candles, sigs, {
              capital: 10000,
              posSize: 0.7,
              comm: sym.crypto ? 0.001 : 0.0005,
              slip: sym.crypto ? 0.002 : 0.0005,
            });

            results.push({
              sym: sym.sym, name: sym.name, crypto: !!sym.crypto,
              strat: strat.name, params: p,
              signals: sigs.length,
              ret: bt.totalReturn,
              sharpe: bt.sharpe,
              sortino: bt.sortino,
              calmar: bt.calmar,
              mdd: bt.mdd,
              winRate: bt.winRate,
              pf: bt.profitFactor,
              trades: bt.trades,
              avgHold: bt.avgHold,
              // 최근 시그널 정보
              lastSignal: sigs.length > 0 ? {
                type: sigs[sigs.length - 1].type,
                price: sigs[sigs.length - 1].price,
                bar: sigs[sigs.length - 1].index,
                age: candles.length - 1 - sigs[sigs.length - 1].index,
              } : null,
            });
          } catch (e) { /* 개별 에러 무시 */ }
        }
      }
    }

    L(`\n✅ ${fetchCount}종목 × ${testCount}건 백테스트 완료`);

    // ── 분석 ──
    // 1) Top 10 (Sharpe 기준)
    const topSharpe = [...results].filter(r => r.sharpe != null && isFinite(r.sharpe))
      .sort((a, b) => b.sharpe - a.sharpe).slice(0, 10);

    // 2) Top 10 (수익률 기준)
    const topReturn = [...results].filter(r => r.ret != null && isFinite(r.ret))
      .sort((a, b) => b.ret - a.ret).slice(0, 10);

    // 3) 종목별 최적 전략
    const bestBySymbol = {};
    for (const r of results) {
      if (!bestBySymbol[r.sym] || (r.sharpe || 0) > (bestBySymbol[r.sym].sharpe || 0)) {
        bestBySymbol[r.sym] = r;
      }
    }

    // 4) 전략별 평균 성과
    const stratStats = {};
    for (const r of results) {
      if (!stratStats[r.strat]) stratStats[r.strat] = { sharpes: [], rets: [], wins: [], n: 0 };
      const s = stratStats[r.strat];
      if (r.sharpe != null && isFinite(r.sharpe)) s.sharpes.push(r.sharpe);
      if (r.ret != null && isFinite(r.ret)) s.rets.push(r.ret);
      if (r.winRate != null) s.wins.push(r.winRate);
      s.n++;
    }
    const stratRank = Object.entries(stratStats).map(([name, s]) => ({
      name,
      avgSharpe: avg(s.sharpes),
      avgReturn: avg(s.rets),
      avgWinRate: avg(s.wins),
      count: s.n,
    })).sort((a, b) => b.avgSharpe - a.avgSharpe);

    // 5) 실전 트레이딩 시그널 (최근 3봉 이내)
    const actionable = results.filter(r => r.lastSignal && r.lastSignal.age <= 3 && r.sharpe > 0.5)
      .sort((a, b) => b.sharpe - a.sharpe).slice(0, 10);

    // ── 텔레그램 리포트 ──
    const dur = ((Date.now() - start) / 1000).toFixed(1);
    const date = today.toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" });
    const dayNames = ["일", "월", "화", "수", "목", "금", "토"];

    // ── 사용자 친화 카드형 리포트 ──
    // Sharpe·MDD·PF 같은 전문 지표는 평어 부연 설명을 함께 표기
    const avgAllSharpe = results.length > 0 ? results.reduce((s, r) => s + (r.sharpe || 0), 0) / results.length : 0;
    const bullSignals = actionable.filter(r => r.lastSignal?.type === "BUY").length;
    const bearSignals = actionable.filter(r => r.lastSignal?.type === "SELL").length;
    const sentimentText =
      avgAllSharpe > 0.3 ? `강세 흐름 (전략들이 평균적으로 잘 통하는 구간)` :
      avgAllSharpe > 0   ? `중립 흐름 (어떤 전략은 통하고 어떤 건 안 통함)` :
                            `약세 흐름 (전반적으로 전략이 잘 안 먹히는 구간 — 신중하게)`;

    const cards = [];

    // 카드 1) 헤더 — 오늘 시장 분위기 + 신호 카운트
    cards.push(buildCard({
      tag: "🔬",
      title: `Zepta 퀀트 리서치 — ${date} (${dayNames[dayOfWeek]})`,
      lines: [
        `오늘 분석 배치: ${batch.name}`,
        `${fetchCount}종목 × ${testCount}건 백테스트 완료 (${dur}초)`,
        `시장 분위기: ${sentimentText}`,
        `오늘 신호: 매수 ${bullSignals}건 · 매도 ${bearSignals}건`,
      ],
      footer: `Sharpe = 위험 대비 수익률 점수 (1.0 이상이면 우수, 0.5 미만이면 약함)`,
    }));

    // 카드 2) 실전 시그널 (가장 중요)
    if (actionable.length > 0) {
      const lines = actionable.slice(0, 5).map((r) => {
        const dir = r.lastSignal.type === "BUY" ? "매수" : "매도";
        const grade = r.sharpe >= 1.5 ? "강력" : r.sharpe >= 1.0 ? "중간" : "약함";
        const age = r.lastSignal.age === 0 ? "오늘" : r.lastSignal.age === 1 ? "어제" : `${r.lastSignal.age}일 전`;
        const price = r.lastSignal.price?.toFixed(2) || "-";
        return `${r.name} ${dir} 신호 (강도 ${grade}, ${age}) @ $${price} — ${r.strat} 전략, 백테스트 승률 ${r.winRate?.toFixed(0)}%`;
      });
      cards.push(buildCard({
        tag: "🎯",
        title: `오늘 실전 매매 신호 ${actionable.length}건 (최근 3봉)`,
        lines,
        hint: actionable.length >= 3
          ? "여러 신호가 동시에 잡혔어요. 한 번에 다 들어가지 말고 강도 높은 순으로 분할 진입하시는 게 안전합니다"
          : "신호가 충족됐다고 무조건 들어가지 마시고, 본인 손절선·목표가 정한 후에 진입하세요",
      }));
    } else {
      cards.push(buildCard({
        tag: "🎯",
        title: "오늘 실전 매매 신호: 조건 충족 종목 없음",
        lines: ["조건이 충족되는 종목이 없어요 — 관망이 정답인 날이에요"],
      }));
    }

    // 카드 3) 강세 전략 / 강세 종목 (요약)
    const stratLines = stratRank.slice(0, 3).map((s, i) =>
      `${i + 1}위 ${s.name} — 평균 위험조정수익 ${s.avgSharpe.toFixed(2)}, 평균수익 ${s.avgReturn.toFixed(1)}%, 승률 ${s.avgWinRate.toFixed(0)}%`
    );
    const symbolLines = topReturn.slice(0, 3).map((r, i) =>
      `${i + 1}위 ${r.name}: ${r.ret?.toFixed(1)}% 수익 (전략: ${r.strat})`
    );
    cards.push(buildCard({
      tag: "🏆",
      title: "오늘 가장 잘 통한 전략·종목 (지난 백테스트 기준)",
      lines: [
        `▸ 전략 베스트 3:`,
        ...stratLines,
        `▸ 종목 베스트 3:`,
        ...symbolLines,
      ],
      footer: `${fmtKSTShort()} · 내일 분석 배치: ${BATCHES[(dayOfWeek + 1) % 7].name}`,
    }));

    // ★ virtual 채널 — 백테스트 결과는 daily-standup 에서 통합 보고하므로 중복 방지
    await sendCards(cards, { channel: "virtual" });
    L(`📨 리포트 전송 완료 (${cards.length}장)`);

    // ── 영구 아카이브 (di:quant:latest) — 실전매매 엔진이 참조 ──
    try {
      const kvModule = await import("@vercel/kv");
      const kv = kvModule.kv;
      await kv.set("di:quant:latest", {
        batch: { day: dayOfWeek, name: batch.name },
        topSharpe: topSharpe.slice(0, 10),
        topReturn: topReturn.slice(0, 10),
        stratRank,
        bestBySymbol,
        actionable: actionable.slice(0, 10),
        duration: `${dur}s`,
        savedAt: new Date().toISOString(),
      });
    } catch (e) {
      L(`⚠️ di:quant:latest 저장 실패: ${e.message}`);
    }

    return res.status(200).json({
      ok: true,
      batch: { day: dayOfWeek, name: batch.name },
      stats: { symbols: fetchCount, tests: testCount, results: results.length },
      topSharpe: topSharpe.slice(0, 5).map(r => ({ sym: r.sym, strat: r.strat, sharpe: r.sharpe, ret: r.ret })),
      topReturn: topReturn.slice(0, 5).map(r => ({ sym: r.sym, strat: r.strat, ret: r.ret, sharpe: r.sharpe })),
      actionable: actionable.slice(0, 5).map(r => ({ sym: r.sym, strat: r.strat, signal: r.lastSignal, sharpe: r.sharpe })),
      strategyRanking: stratRank,
      duration: `${dur}s`,
    });

  } catch (e) {
    L(`💥 ${e.message}`);
    return res.status(200).json({ ok: false, error: e.message, log });
  }
}

// ═══════════════════════════════════════════════════════
// 유틸
// ═══════════════════════════════════════════════════════
function avg(arr) { return arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : 0; }

async function fetchYahoo(sym) {
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=1y&interval=1d`,
      { headers: { "User-Agent": "Mozilla/5.0 (DI-Quant)" } });
    const d = await r.json();
    const res = d?.chart?.result?.[0];
    if (!res?.timestamp) return [];
    const q = res.indicators.quote[0];
    return res.timestamp.map((t, i) => ({
      time: t, open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i], volume: q.volume[i],
    })).filter(c => c.close != null && c.high != null && c.low != null);
  } catch { return []; }
}

// (구버전 sendTG — _shared/telegram.js 의 sendCards 로 대체됨, 호환성용 유지)
async function _legacySendTG(token, chatId, text) {
  if (!token || !chatId) return;
  try {
    // 텔레그램 메시지 길이 제한 (4096자)
    const trimmed = text.length > 4000 ? text.slice(0, 4000) + "\n...(truncated)" : text;
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: trimmed }),
    });
  } catch (e) { console.error("TG:", e.message); }
}

// ═══════════════════════════════════════════════════════
// 백테스트 엔진
// ═══════════════════════════════════════════════════════
function backtest(candles, signals, opts = {}) {
  const { capital = 10000, posSize = 0.7, comm = 0.001, slip = 0.001 } = opts;
  let cash = capital, pos = null, peak = capital, maxDD = 0;
  const trades = [];
  const eqCurve = [capital];

  for (const sig of signals) {
    const p = sig.price || candles[sig.index]?.close;
    if (!p) continue;

    if (sig.type === "BUY" && !pos) {
      const amt = cash * posSize;
      const bp = p * (1 + slip);
      const shares = amt / bp;
      cash -= amt + amt * comm;
      pos = { bp, shares, idx: sig.index };
    } else if (sig.type === "SELL" && pos) {
      const sp = p * (1 - slip);
      const proceeds = pos.shares * sp;
      cash += proceeds - proceeds * comm;
      trades.push({
        pnl: ((sp - pos.bp) / pos.bp) * 100,
        hold: sig.index - pos.idx,
      });
      pos = null;
    }
    const eq = cash + (pos ? pos.shares * p : 0);
    eqCurve.push(eq);
    if (eq > peak) peak = eq;
    const dd = peak > 0 ? ((peak - eq) / peak) * 100 : 0;
    if (dd > maxDD) maxDD = dd;
  }

  // 미청산 정리
  if (pos) {
    const lp = candles[candles.length - 1].close;
    cash += pos.shares * lp;
    trades.push({ pnl: ((lp - pos.bp) / pos.bp) * 100, hold: candles.length - 1 - pos.idx });
  }

  const totalReturn = ((cash - capital) / capital) * 100;
  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl <= 0);
  const winRate = trades.length ? (wins.length / trades.length) * 100 : 0;
  const avgW = wins.length ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
  const avgL = losses.length ? Math.abs(losses.reduce((s, t) => s + t.pnl, 0) / losses.length) : 1;
  const profitFactor = avgL > 0 ? avgW / avgL : avgW;
  const avgHold = trades.length ? trades.reduce((s, t) => s + t.hold, 0) / trades.length : 0;

  // Sharpe & Sortino
  const rets = [];
  for (let i = 1; i < eqCurve.length; i++) rets.push((eqCurve[i] - eqCurve[i - 1]) / eqCurve[i - 1]);
  const mu = rets.length ? rets.reduce((s, r) => s + r, 0) / rets.length : 0;
  const sigma = rets.length > 1 ? Math.sqrt(rets.reduce((s, r) => s + (r - mu) ** 2, 0) / (rets.length - 1)) : 1;
  const sharpe = sigma > 0 ? (mu / sigma) * Math.sqrt(252) : 0;
  const downside = rets.filter(r => r < 0);
  const dsigma = downside.length > 1 ? Math.sqrt(downside.reduce((s, r) => s + r ** 2, 0) / downside.length) : 1;
  const sortino = dsigma > 0 ? (mu / dsigma) * Math.sqrt(252) : 0;
  const calmar = maxDD > 0 ? (totalReturn / maxDD) : totalReturn;

  return { totalReturn, sharpe, sortino, calmar, mdd: maxDD, winRate, profitFactor, trades: trades.length, avgHold };
}

// ═══════════════════════════════════════════════════════
// 15개 전략 구현
// ═══════════════════════════════════════════════════════

function strategyRSI(candles, p = {}) {
  const { period = 14, buyTh = 30, sellTh = 70 } = p;
  const c = candles.map(x => x.close);
  const rsi = calcRSI(c, period);
  const sigs = [];
  for (let i = period + 1; i < c.length; i++) {
    if (rsi[i] == null || rsi[i - 1] == null) continue;
    if (rsi[i] > buyTh && rsi[i - 1] <= buyTh) sigs.push({ index: i, type: "BUY", price: c[i] });
    else if (rsi[i] < sellTh && rsi[i - 1] >= sellTh) sigs.push({ index: i, type: "SELL", price: c[i] });
  }
  return sigs;
}

function strategyMACD(candles, p = {}) {
  const { fast = 12, slow = 26, sig = 9 } = p;
  const c = candles.map(x => x.close);
  const { macdLine, signal } = calcMACD(c, fast, slow, sig);
  const sigs = [];
  for (let i = slow + sig; i < c.length; i++) {
    if (macdLine[i] == null || signal[i] == null) continue;
    if (macdLine[i] > signal[i] && macdLine[i - 1] <= signal[i - 1]) sigs.push({ index: i, type: "BUY", price: c[i] });
    else if (macdLine[i] < signal[i] && macdLine[i - 1] >= signal[i - 1]) sigs.push({ index: i, type: "SELL", price: c[i] });
  }
  return sigs;
}

function strategyBB(candles, p = {}) {
  const { period = 20, mult = 2 } = p;
  const c = candles.map(x => x.close);
  const bb = calcBB(c, period, mult);
  const sigs = [];
  for (let i = period + 1; i < c.length; i++) {
    if (!bb[i] || !bb[i - 1]) continue;
    if (c[i - 1] <= bb[i - 1].lower && c[i] > bb[i].lower) sigs.push({ index: i, type: "BUY", price: c[i] });
    else if (c[i - 1] >= bb[i - 1].upper && c[i] < bb[i].upper) sigs.push({ index: i, type: "SELL", price: c[i] });
  }
  return sigs;
}

function strategyTripleMA(candles, p = {}) {
  const { fast = 10, mid = 20, slow = 50 } = p;
  const c = candles.map(x => x.close);
  const ef = calcEMA(c, fast), em = calcEMA(c, mid), es = calcEMA(c, slow);
  const sigs = [];
  for (let i = slow + 1; i < c.length; i++) {
    if (ef[i] == null || em[i] == null || es[i] == null) continue;
    const up = ef[i] > em[i] && em[i] > es[i];
    const pUp = ef[i - 1] > em[i - 1] && em[i - 1] > es[i - 1];
    const dn = ef[i] < em[i] && em[i] < es[i];
    const pDn = ef[i - 1] < em[i - 1] && em[i - 1] < es[i - 1];
    if (up && !pUp) sigs.push({ index: i, type: "BUY", price: c[i] });
    else if (dn && !pDn) sigs.push({ index: i, type: "SELL", price: c[i] });
  }
  return sigs;
}

function strategySupertrend(candles, p = {}) {
  const { atrPeriod = 10, mult = 3 } = p;
  const c = candles.map(x => x.close), h = candles.map(x => x.high), l = candles.map(x => x.low);
  const atr = calcATR(h, l, c, atrPeriod);
  const sigs = [];
  let trend = 1, ub = 0, lb = 0;
  for (let i = atrPeriod; i < c.length; i++) {
    if (!atr[i]) continue;
    const mid = (h[i] + l[i]) / 2;
    const nu = mid + mult * atr[i], nl = mid - mult * atr[i];
    ub = (nu < ub || c[i - 1] > ub) ? nu : ub;
    lb = (nl > lb || c[i - 1] < lb) ? nl : lb;
    const pt = trend;
    if (c[i] > ub) trend = 1; else if (c[i] < lb) trend = -1;
    if (trend === 1 && pt === -1) sigs.push({ index: i, type: "BUY", price: c[i] });
    else if (trend === -1 && pt === 1) sigs.push({ index: i, type: "SELL", price: c[i] });
  }
  return sigs;
}

function strategyKeltner(candles, p = {}) {
  const { emaPeriod = 20, atrPeriod = 10, mult = 2 } = p;
  const c = candles.map(x => x.close), h = candles.map(x => x.high), l = candles.map(x => x.low);
  const ema = calcEMA(c, emaPeriod);
  const atr = calcATR(h, l, c, atrPeriod);
  const sigs = [];
  for (let i = Math.max(emaPeriod, atrPeriod) + 1; i < c.length; i++) {
    if (!ema[i] || !atr[i]) continue;
    const upper = ema[i] + mult * atr[i], lower = ema[i] - mult * atr[i];
    const pUpper = ema[i - 1] + mult * atr[i - 1], pLower = ema[i - 1] - mult * atr[i - 1];
    if (c[i - 1] <= pLower && c[i] > lower) sigs.push({ index: i, type: "BUY", price: c[i] });
    else if (c[i - 1] >= pUpper && c[i] < upper) sigs.push({ index: i, type: "SELL", price: c[i] });
  }
  return sigs;
}

function strategyStochRSI(candles, p = {}) {
  const { rsiPeriod = 14, stochPeriod = 14, buyTh = 20, sellTh = 80 } = p;
  const c = candles.map(x => x.close);
  const rsi = calcRSI(c, rsiPeriod);
  // Stochastic on RSI
  const k = new Array(c.length).fill(null);
  for (let i = rsiPeriod + stochPeriod; i < c.length; i++) {
    let hh = -Infinity, ll = Infinity;
    for (let j = 0; j < stochPeriod; j++) {
      const v = rsi[i - j];
      if (v != null) { hh = Math.max(hh, v); ll = Math.min(ll, v); }
    }
    k[i] = hh !== ll ? ((rsi[i] - ll) / (hh - ll)) * 100 : 50;
  }
  const sigs = [];
  for (let i = rsiPeriod + stochPeriod + 1; i < c.length; i++) {
    if (k[i] == null || k[i - 1] == null) continue;
    if (k[i] > buyTh && k[i - 1] <= buyTh) sigs.push({ index: i, type: "BUY", price: c[i] });
    else if (k[i] < sellTh && k[i - 1] >= sellTh) sigs.push({ index: i, type: "SELL", price: c[i] });
  }
  return sigs;
}

function strategyVolBreak(candles, p = {}) {
  const { volMult = 2.0, trendPeriod = 50 } = p;
  const c = candles.map(x => x.close), v = candles.map(x => x.volume || 0);
  const vSMA = calcSMA(v, 20);
  const tSMA = calcSMA(c, trendPeriod);
  const sigs = [];
  for (let i = Math.max(20, trendPeriod) + 1; i < c.length; i++) {
    if (!vSMA[i] || !tSMA[i]) continue;
    if (v[i] > vSMA[i] * volMult && c[i] > c[i - 1] && c[i] > tSMA[i])
      sigs.push({ index: i, type: "BUY", price: c[i] });
    else if (v[i] > vSMA[i] * volMult && c[i] < c[i - 1] && c[i] < tSMA[i])
      sigs.push({ index: i, type: "SELL", price: c[i] });
  }
  return sigs;
}

function strategyDualMom(candles, p = {}) {
  const { lookback = 60, holdBars = 20 } = p;
  const c = candles.map(x => x.close);
  const sigs = [];
  let lastSig = -999;
  for (let i = lookback; i < c.length; i++) {
    if (i - lastSig < holdBars) continue;
    const absRet = (c[i] - c[i - lookback]) / c[i - lookback];
    const relRet = (c[i] - c[i - Math.floor(lookback / 2)]) / c[i - Math.floor(lookback / 2)];
    if (absRet > 0 && relRet > 0.02) { sigs.push({ index: i, type: "BUY", price: c[i] }); lastSig = i; }
    else if (absRet < -0.05 || relRet < -0.03) { sigs.push({ index: i, type: "SELL", price: c[i] }); lastSig = i; }
  }
  return sigs;
}

function strategyMeanRev(candles, p = {}) {
  const { period = 20, zThreshold = 2.0 } = p;
  const c = candles.map(x => x.close);
  const sma = calcSMA(c, period);
  const sigs = [];
  for (let i = period; i < c.length; i++) {
    if (!sma[i]) continue;
    let sqSum = 0;
    for (let j = 0; j < period; j++) sqSum += (c[i - j] - sma[i]) ** 2;
    const std = Math.sqrt(sqSum / period);
    if (std === 0) continue;
    const z = (c[i] - sma[i]) / std;
    const pz = i > period ? (c[i - 1] - (sma[i - 1] || sma[i])) / (std || 1) : 0;
    if (z > -zThreshold && pz <= -zThreshold) sigs.push({ index: i, type: "BUY", price: c[i] });
    else if (z < zThreshold && pz >= zThreshold) sigs.push({ index: i, type: "SELL", price: c[i] });
  }
  return sigs;
}

function strategyIchimoku(candles, p = {}) {
  const { tenkan = 9, kijun = 26, senkou = 52 } = p;
  const h = candles.map(x => x.high), l = candles.map(x => x.low), c = candles.map(x => x.close);
  const hilo = (arr, arrL, per, i) => {
    let hh = -Infinity, ll = Infinity;
    for (let j = 0; j < per && i - j >= 0; j++) { hh = Math.max(hh, arr[i - j]); ll = Math.min(ll, arrL[i - j]); }
    return (hh + ll) / 2;
  };
  const sigs = [];
  for (let i = senkou + 1; i < c.length; i++) {
    const tk = hilo(h, l, tenkan, i), kj = hilo(h, l, kijun, i);
    const ptk = hilo(h, l, tenkan, i - 1), pkj = hilo(h, l, kijun, i - 1);
    if (tk > kj && ptk <= pkj && c[i] > kj) sigs.push({ index: i, type: "BUY", price: c[i] });
    else if (tk < kj && ptk >= pkj && c[i] < kj) sigs.push({ index: i, type: "SELL", price: c[i] });
  }
  return sigs;
}

function strategyOBVTrend(candles, p = {}) {
  const { emaPeriod = 20 } = p;
  const c = candles.map(x => x.close), v = candles.map(x => x.volume || 0);
  const obv = calcOBV(c, v);
  const obvEma = calcEMA(obv, emaPeriod);
  const sigs = [];
  for (let i = emaPeriod + 1; i < c.length; i++) {
    if (obvEma[i] == null || obvEma[i - 1] == null) continue;
    if (obv[i] > obvEma[i] && obv[i - 1] <= obvEma[i - 1]) sigs.push({ index: i, type: "BUY", price: c[i] });
    else if (obv[i] < obvEma[i] && obv[i - 1] >= obvEma[i - 1]) sigs.push({ index: i, type: "SELL", price: c[i] });
  }
  return sigs;
}

function strategyPSAR(candles, p = {}) {
  const { step = 0.02, max = 0.2 } = p;
  const h = candles.map(x => x.high), l = candles.map(x => x.low), c = candles.map(x => x.close);
  const sigs = [];
  let bull = true, af = step, ep = h[0], sar = l[0];
  for (let i = 2; i < c.length; i++) {
    const prevBull = bull;
    sar = sar + af * (ep - sar);
    if (bull) {
      sar = Math.min(sar, l[i - 1], l[i - 2]);
      if (l[i] < sar) { bull = false; sar = ep; af = step; ep = l[i]; }
      else { if (h[i] > ep) { ep = h[i]; af = Math.min(af + step, max); } }
    } else {
      sar = Math.max(sar, h[i - 1], h[i - 2]);
      if (h[i] > sar) { bull = true; sar = ep; af = step; ep = h[i]; }
      else { if (l[i] < ep) { ep = l[i]; af = Math.min(af + step, max); } }
    }
    if (bull && !prevBull) sigs.push({ index: i, type: "BUY", price: c[i] });
    else if (!bull && prevBull) sigs.push({ index: i, type: "SELL", price: c[i] });
  }
  return sigs;
}

function strategyConnorsRSI2(candles, p = {}) {
  const { rsiPeriod = 2, buyTh = 10, sellTh = 90 } = p;
  const c = candles.map(x => x.close);
  const rsi = calcRSI(c, rsiPeriod);
  const sma200 = calcSMA(c, 200);
  const sigs = [];
  for (let i = 201; i < c.length; i++) {
    if (rsi[i] == null || !sma200[i]) continue;
    if (rsi[i] < buyTh && c[i] > sma200[i]) sigs.push({ index: i, type: "BUY", price: c[i] });
    else if (rsi[i] > sellTh) sigs.push({ index: i, type: "SELL", price: c[i] });
  }
  return sigs;
}

function strategyBTCAlpha(candles, p = {}) {
  const { rsiPeriod = 14, bbMult = 2.5, emaFast = 21, emaSlow = 55, cooldown = 3, emaLong = 200 } = p;
  if (candles.length < Math.max(emaLong, 60) + 10) return [];
  const c = candles.map(x => x.close), h = candles.map(x => x.high), l = candles.map(x => x.low), v = candles.map(x => x.volume || 0);
  const rsi = calcRSI(c, rsiPeriod), bb = calcBB(c, 20, bbMult);
  const e21 = calcEMA(c, emaFast), e55 = calcEMA(c, emaSlow), e200 = calcEMA(c, emaLong);
  const { macdLine: ml, signal: ms, histogram: mh } = calcMACD(c);
  const atr = calcATR(h, l, c, 14);
  const obv = calcOBV(c, v), obvE = calcEMA(obv, 20), vSMA = calcSMA(v, 20);
  const sigs = [];
  let last = -999;
  const minI = Math.max(emaLong, 55, 30);
  for (let i = minI; i < c.length; i++) {
    if (rsi[i] == null || !bb[i] || mh[i] == null || i - last < cooldown) continue;
    const pr = c[i], pp = c[i - 1];
    const atrP = atr[i] && pr > 0 ? (atr[i] / pr) * 100 : 2;
    const rBuy = atrP > 5 ? 20 : atrP > 3 ? 25 : 28;
    let bS = 0, bF = 0, sS = 0, sF = 0;
    if (rsi[i] > rBuy && rsi[i - 1] <= rBuy) { bS += 3; bF++; }
    if (pp <= (bb[i - 1]?.lower || 0) && pr > bb[i].lower) { bS += 2; bF++; }
    if (vSMA[i] > 0 && v[i] >= vSMA[i] * 1.8 && pr > pp) { bS += 2; bF++; }
    if (obv[i] > obvE[i] && obv[i - 1] <= obvE[i - 1]) { bS += 2; bF++; }
    if (ml[i] > ms[i] && ml[i - 1] <= ms[i - 1]) { bS += 2; bF++; }
    if (e21[i] > e55[i] && e21[i - 1] <= e55[i - 1]) { bS += 3; bF++; }
    else if (e21[i] > e55[i]) bS += 1;
    if (pr > e200[i]) bS += 1;
    if (bS >= 5 && bF >= 3) { last = i; sigs.push({ index: i, type: "BUY", price: pr }); continue; }

    const rSell = atrP > 5 ? 80 : atrP > 3 ? 75 : 72;
    if (rsi[i] < rSell && rsi[i - 1] >= rSell) { sS += 3; sF++; }
    if (pp >= (bb[i - 1]?.upper || Infinity) && pr < bb[i].upper) { sS += 2; sF++; }
    if (ml[i] < ms[i] && ml[i - 1] >= ms[i - 1]) { sS += 2; sF++; }
    if (e21[i] < e55[i] && e21[i - 1] >= e55[i - 1]) { sS += 3; sF++; }
    else if (e21[i] < e55[i]) sS += 1;
    if (obv[i] < obvE[i] && obv[i - 1] >= obvE[i - 1]) { sS += 2; sF++; }
    if (pr < e200[i]) sS += 1;
    if (sS >= 5 && sF >= 3) { last = i; sigs.push({ index: i, type: "SELL", price: pr }); }
  }
  return sigs;
}

// ═══════════════════════════════════════════════════════
// 알파 전략 함수들 (시장 비효율성 포착)
// ═══════════════════════════════════════════════════════

function calcHurst(data) {
  const n = data.length;
  if (n < 20) return 0.5;
  const lr = []; for (let i = 1; i < n; i++) lr.push(Math.log(data[i] / data[i - 1]));
  const mean = lr.reduce((a, b) => a + b, 0) / lr.length;
  const dev = lr.map(r => r - mean);
  const cd = []; let cum = 0; for (const d of dev) { cum += d; cd.push(cum); }
  const R = Math.max(...cd) - Math.min(...cd);
  const S = Math.sqrt(dev.reduce((a, b) => a + b * b, 0) / dev.length);
  if (S === 0) return 0.5;
  return Math.log(R / S) / Math.log(n);
}

function calcEfficiencyRatio(closes, period = 10) {
  const er = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period) { er.push(0); continue; }
    const dir = Math.abs(closes[i] - closes[i - period]);
    let vol = 0; for (let j = 1; j <= period; j++) vol += Math.abs(closes[i - j + 1] - closes[i - j]);
    er.push(vol > 0 ? dir / vol : 0);
  }
  return er;
}

function strategyHurstRegime(candles, p = {}) {
  const { lookback = 100, trendTh = 0.55, meanRevTh = 0.45 } = p;
  const c = candles.map(x => x.close), h = candles.map(x => x.high), l = candles.map(x => x.low);
  const rsi = calcRSI(c, 14);
  const sigs = [];
  let last = -10;
  for (let i = lookback; i < c.length; i++) {
    if (i - last < 5) continue;
    const hurst = calcHurst(c.slice(i - lookback, i));
    if (hurst > trendTh) {
      const high20 = Math.max(...h.slice(i - 20, i + 1));
      const low20 = Math.min(...l.slice(i - 20, i + 1));
      if (c[i] >= high20 * 0.99) { last = i; sigs.push({ index: i, type: "BUY", price: c[i] }); continue; }
      if (c[i] <= low20 * 1.01) { last = i; sigs.push({ index: i, type: "SELL", price: c[i] }); continue; }
    }
    if (hurst < meanRevTh && rsi[i] != null) {
      if (rsi[i] < 30 && rsi[i] > (rsi[i - 1] || 50)) { last = i; sigs.push({ index: i, type: "BUY", price: c[i] }); continue; }
      if (rsi[i] > 70 && rsi[i] < (rsi[i - 1] || 50)) { last = i; sigs.push({ index: i, type: "SELL", price: c[i] }); }
    }
  }
  return sigs;
}

function strategyEfficiencyRatio(candles, p = {}) {
  const { period = 10, surgeTh = 0.6, collapseTh = 0.2 } = p;
  const c = candles.map(x => x.close);
  const er = calcEfficiencyRatio(c, period);
  const sigs = [];
  let last = -10;
  for (let i = period + 3; i < c.length; i++) {
    if (i - last < 5) continue;
    const curER = er[i] || 0;
    const prevER = ((er[i - 1] || 0) + (er[i - 2] || 0) + (er[i - 3] || 0)) / 3;
    if (curER > surgeTh && prevER < surgeTh - 0.1) {
      const dir = c[i] > c[i - period] ? "BUY" : "SELL";
      last = i; sigs.push({ index: i, type: dir, price: c[i] });
    } else if (curER < collapseTh && prevER > collapseTh + 0.2) {
      const dir = c[i] > c[i - 3] ? "SELL" : "BUY";
      last = i; sigs.push({ index: i, type: dir, price: c[i] });
    }
  }
  return sigs;
}

function strategyVolCluster(candles, p = {}) {
  const { atrPeriod = 14, longMAPeriod = 50, explosionRatio = 1.8 } = p;
  const c = candles.map(x => x.close), h = candles.map(x => x.high), l = candles.map(x => x.low);
  const atr = calcATR(h, l, c, atrPeriod);
  const atrLongMA = calcSMA(atr.map(v => v || 0), longMAPeriod);
  const sigs = [];
  let last = -10;
  for (let i = longMAPeriod; i < c.length; i++) {
    if (i - last < 5 || !atr[i] || !atrLongMA[i] || atrLongMA[i] === 0) continue;
    const ratio = atr[i] / atrLongMA[i];
    if (ratio > explosionRatio) {
      const dir = c[i] > c[i - 1] ? "BUY" : "SELL";
      last = i; sigs.push({ index: i, type: dir, price: c[i] });
    }
  }
  return sigs;
}

function strategyMomentumDecay(candles, p = {}) {
  const { momPeriod = 10, rsiPeriod = 14, rsiHigh = 60, rsiLow = 40 } = p;
  const c = candles.map(x => x.close);
  const rsi = calcRSI(c, rsiPeriod);
  const sigs = [];
  let last = -10;
  for (let i = momPeriod + 1; i < c.length; i++) {
    if (i - last < 5 || rsi[i] == null) continue;
    const mom = ((c[i] - c[i - momPeriod]) / c[i - momPeriod]) * 100;
    const momPrev = ((c[i - 1] - c[i - 1 - momPeriod]) / c[i - 1 - momPeriod]) * 100;
    if (mom > 2 && mom < momPrev && rsi[i] > rsiHigh) {
      last = i; sigs.push({ index: i, type: "SELL", price: c[i] }); continue;
    }
    if (mom < -2 && mom > momPrev && rsi[i] < rsiLow) {
      last = i; sigs.push({ index: i, type: "BUY", price: c[i] });
    }
  }
  return sigs;
}

function strategySmartMoney(candles, p = {}) {
  const { flatRange = 1.5, volMult = 2.0, obvEmaPeriod = 20 } = p;
  const c = candles.map(x => x.close), v = candles.map(x => x.volume || 0);
  const obv = calcOBV(c, v);
  const obvEma = calcEMA(obv, obvEmaPeriod);
  const volSMA = calcSMA(v, 20);
  const sigs = [];
  let last = -10;
  for (let i = 20; i < c.length; i++) {
    if (i - last < 5 || i < 3) continue;
    const priceFlat = Math.abs(c[i] - c[i - 3]) / c[i - 3] * 100;
    const vAvg = volSMA[i] || 1;
    const volSurge = v[i] > vAvg * volMult && v[i - 1] > vAvg * (volMult * 0.75) && v[i - 2] > vAvg * (volMult * 0.75);
    if (priceFlat < flatRange && volSurge) {
      if (obv[i] > (obvEma[i] || 0)) { last = i; sigs.push({ index: i, type: "BUY", price: c[i] }); }
      else if (obv[i] < (obvEma[i] || 0)) { last = i; sigs.push({ index: i, type: "SELL", price: c[i] }); }
    }
  }
  return sigs;
}

// ═══════════════════════════════════════════════════════
// 기술 지표 라이브러리
// ═══════════════════════════════════════════════════════

function calcSMA(d, p) {
  const r = new Array(d.length).fill(null);
  for (let i = p - 1; i < d.length; i++) { let s = 0; for (let j = 0; j < p; j++) s += d[i - j]; r[i] = s / p; }
  return r;
}

function calcEMA(d, p) {
  const r = new Array(d.length).fill(null); const k = 2 / (p + 1);
  let st = -1; for (let i = 0; i < d.length; i++) { if (d[i] != null) { st = i; break; } }
  if (st < 0 || d.length - st < p) return r;
  let s = 0; for (let i = st; i < st + p; i++) s += d[i]; r[st + p - 1] = s / p;
  for (let i = st + p; i < d.length; i++) r[i] = d[i] * k + r[i - 1] * (1 - k);
  return r;
}

function calcRSI(c, p = 14) {
  const r = new Array(c.length).fill(null); if (c.length < p + 1) return r;
  let gS = 0, lS = 0;
  for (let i = 1; i <= p; i++) { const d = c[i] - c[i - 1]; if (d > 0) gS += d; else lS -= d; }
  let ag = gS / p, al = lS / p;
  r[p] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  for (let i = p + 1; i < c.length; i++) {
    const d = c[i] - c[i - 1];
    ag = (ag * (p - 1) + (d > 0 ? d : 0)) / p;
    al = (al * (p - 1) + (d < 0 ? -d : 0)) / p;
    r[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  return r;
}

function calcBB(c, p = 20, m = 2) {
  const r = new Array(c.length).fill(null); const sma = calcSMA(c, p);
  for (let i = p - 1; i < c.length; i++) {
    if (sma[i] == null) continue; let sq = 0;
    for (let j = 0; j < p; j++) sq += (c[i - j] - sma[i]) ** 2;
    const std = Math.sqrt(sq / p); const u = sma[i] + std * m, l = sma[i] - std * m;
    r[i] = { middle: sma[i], upper: u, lower: l, bw: sma[i] > 0 ? (u - l) / sma[i] : 0 };
  }
  return r;
}

function calcMACD(c, f = 12, s = 26, g = 9) {
  const ef = calcEMA(c, f), es = calcEMA(c, s);
  const ml = c.map((_, i) => (ef[i] != null && es[i] != null) ? ef[i] - es[i] : null);
  const signal = calcEMA(ml.map(v => v ?? 0), g);
  const histogram = c.map((_, i) => (ml[i] != null && signal[i] != null) ? ml[i] - signal[i] : null);
  return { macdLine: ml, signal, histogram };
}

function calcATR(h, l, c, p = 14) {
  const tr = [h[0] - l[0]];
  for (let i = 1; i < c.length; i++) tr.push(Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])));
  return calcEMA(tr, p);
}

function calcOBV(c, v) {
  const o = [0];
  for (let i = 1; i < c.length; i++) {
    if (c[i] > c[i - 1]) o.push(o[i - 1] + (v[i] || 0));
    else if (c[i] < c[i - 1]) o.push(o[i - 1] - (v[i] || 0));
    else o.push(o[i - 1]);
  }
  return o;
}
