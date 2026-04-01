#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════
// DI금융 퀀트 연구소 — 자동 백테스트 러너 v3.7
// 33개 전략 x 주요 종목 백테스트 실행 및 리포트 생성
// ════════════════════════════════════════════════════════════════════

import { ALL_STRATEGIES, runBacktest, diagnoseMarket } from './src/strategies.js';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const NOW = new Date();
const DATE_STR = NOW.toISOString().slice(0, 10);
const TIME_STR = `${String(NOW.getHours()).padStart(2,'0')}${String(NOW.getMinutes()).padStart(2,'0')}`;
const LABEL = `${DATE_STR}-lab-${TIME_STR}`;

// ── 설정 ──────────────────────────────────────────────────
const STOCK_TICKERS = ['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'META', 'TSLA', 'AMD', 'AVGO', 'TSM'];
const CRYPTO_TICKERS = ['BTC', 'ETH', 'SOL'];
const CRYPTO_YAHOO = { BTC: 'BTC-USD', ETH: 'ETH-USD', SOL: 'SOL-USD' };

const REPORT_DIR = join(process.cwd(), 'quant-reports');
if (!existsSync(REPORT_DIR)) mkdirSync(REPORT_DIR, { recursive: true });

const BACKTEST_OPTIONS = {
  initialCapital: 10000,
  positionSize: 1.0,
  commission: 0.001,
  slippage: 0.0005,
  stopLoss: 8,
  takeProfit: 15,
  trailingStop: 5,
};

// ── Yahoo Finance OHLCV ─────────────────────────────────
async function fetchYahooOHLCV(ticker) {
  const now = Math.floor(Date.now() / 1000);
  const oneYearAgo = now - 365 * 24 * 3600;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?period1=${oneYearAgo}&period2=${now}&interval=1d`;

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36' }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const result = json.chart?.result?.[0];
    if (!result) throw new Error('No data');

    const ts = result.timestamp;
    const q = result.indicators.quote[0];
    const candles = [];
    for (let i = 0; i < ts.length; i++) {
      if (q.open[i] != null && q.high[i] != null && q.low[i] != null && q.close[i] != null) {
        candles.push({
          time: ts[i], open: q.open[i], high: q.high[i],
          low: q.low[i], close: q.close[i], volume: q.volume[i] || 0,
        });
      }
    }
    return candles;
  } catch (e) {
    console.error(`  ⚠ Yahoo fail ${ticker}: ${e.message}`);
    return null;
  }
}

// ── CoinGecko OHLCV ─────────────────────────────────────
async function fetchCoinGeckoOHLCV(cryptoId) {
  const url = `https://api.coingecko.com/api/v3/coins/${cryptoId}/ohlc?vs_currency=usd&days=365`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const dailyMap = new Map();
    for (const [ts, o, h, l, c] of data) {
      const dayKey = new Date(ts).toISOString().slice(0, 10);
      if (!dailyMap.has(dayKey)) {
        dailyMap.set(dayKey, { time: Math.floor(ts / 1000), open: o, high: h, low: l, close: c, volume: 0 });
      } else {
        const d = dailyMap.get(dayKey);
        d.high = Math.max(d.high, h);
        d.low = Math.min(d.low, l);
        d.close = c;
      }
    }
    return [...dailyMap.values()].sort((a, b) => a.time - b.time);
  } catch (e) {
    console.error(`  ⚠ CoinGecko fail ${cryptoId}: ${e.message}`);
    return null;
  }
}

// ── 백테스트 실행 ─────────────────────────────────────────
function runStrategyBacktest(strategy, candles, ticker) {
  try {
    const signals = strategy.generate(candles);
    if (!signals || signals.length === 0) {
      return { ticker, strategy: strategy.name, totalTrades: 0, totalReturn: 0, note: 'No signals' };
    }
    const result = runBacktest(candles, signals, BACKTEST_OPTIONS);
    return { ticker, strategy: strategy.name, strategyId: strategy.id, category: strategy.category, ...result };
  } catch (e) {
    return { ticker, strategy: strategy.name, error: e.message, totalTrades: 0, totalReturn: 0 };
  }
}

// ── 텔레그램 전송 (Vercel 프록시) ──────────────────────────
async function sendTelegram(text) {
  try {
    const res = await fetch('https://signal-screener.vercel.app/api/telegram-send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const data = await res.json();
    console.log(`📤 텔레그램 전송: ${data.success ? '✅ 성공' : '❌ 실패'}`);
    return data.success;
  } catch (e) {
    console.error(`📤 텔레그램 전송 실패: ${e.message}`);
    return false;
  }
}

// ── 메인 ─────────────────────────────────────────────────
async function main() {
  console.log('══════════════════════════════════════════════════════');
  console.log('DI금융 퀀트 연구소 — 자동 백테스트 v3.7');
  console.log(`전략: ${ALL_STRATEGIES.length}개 | 종목: ${STOCK_TICKERS.length + CRYPTO_TICKERS.length}개`);
  console.log(`실행: ${DATE_STR} ${TIME_STR}`);
  console.log('══════════════════════════════════════════════════════\n');

  // 1. 데이터 수집
  console.log('📊 1단계: OHLCV 데이터 수집...');
  const tickerData = {};

  // 주식: Yahoo Finance
  for (const ticker of STOCK_TICKERS) {
    process.stdout.write(`  ${ticker}...`);
    tickerData[ticker] = await fetchYahooOHLCV(ticker);
    console.log(tickerData[ticker] ? ` ✓ ${tickerData[ticker].length}일` : ' ✗');
    await new Promise(r => setTimeout(r, 350));
  }

  // 크립토: Yahoo Finance 먼저 시도, 실패 시 CoinGecko
  const CRYPTO_CG_IDS = { BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana' };
  for (const ticker of CRYPTO_TICKERS) {
    const yahooTicker = CRYPTO_YAHOO[ticker];
    process.stdout.write(`  ${ticker} (Yahoo ${yahooTicker})...`);
    tickerData[ticker] = await fetchYahooOHLCV(yahooTicker);
    if (tickerData[ticker]) {
      console.log(` ✓ ${tickerData[ticker].length}일`);
    } else {
      process.stdout.write(` → CoinGecko...`);
      tickerData[ticker] = await fetchCoinGeckoOHLCV(CRYPTO_CG_IDS[ticker]);
      console.log(tickerData[ticker] ? ` ✓ ${tickerData[ticker].length}일` : ' ✗');
    }
    await new Promise(r => setTimeout(r, 500));
  }

  const validTickers = Object.entries(tickerData).filter(([_, v]) => v && v.length >= 60);
  console.log(`\n✅ 유효 데이터: ${validTickers.length}개 종목\n`);

  if (validTickers.length === 0) {
    console.error('❌ 유효한 데이터 없음. 종료.');
    process.exit(1);
  }

  // 2. 시장 진단
  console.log('🔍 2단계: 시장 진단...');
  const marketDiagnoses = {};
  for (const [ticker, candles] of validTickers) {
    try {
      marketDiagnoses[ticker] = diagnoseMarket(candles);
      console.log(`  ${ticker}: ${marketDiagnoses[ticker].regime} (추세=${marketDiagnoses[ticker].trend}, RSI=${marketDiagnoses[ticker].rsi})`);
    } catch (e) {
      marketDiagnoses[ticker] = { regime: 'unknown', trend: 'unknown', rsi: 0 };
      console.log(`  ${ticker}: 진단 실패`);
    }
  }

  // 3. 백테스트 실행
  const total = ALL_STRATEGIES.length * validTickers.length;
  console.log(`\n⚡ 3단계: ${ALL_STRATEGIES.length} x ${validTickers.length} = ${total}개 백테스트...\n`);
  const allResults = [];
  let completed = 0;

  for (const strategy of ALL_STRATEGIES) {
    for (const [ticker, candles] of validTickers) {
      if (strategy.id === 'btc_alpha' && ticker !== 'BTC') { completed++; continue; }
      allResults.push(runStrategyBacktest(strategy, candles, ticker));
      completed++;
      if (completed % 66 === 0) console.log(`  진행: ${completed}/${total} (${((completed/total)*100).toFixed(0)}%)`);
    }
  }
  console.log(`  완료: ${allResults.length}개 백테스트\n`);

  // 4. 결과 분석
  console.log('📈 4단계: 결과 분석 및 리포트 생성...');
  const validResults = allResults.filter(r => r.totalTrades >= 1 && !r.error);

  // 전략별 평균 성과
  const strategyStats = {};
  for (const r of validResults) {
    if (!strategyStats[r.strategy]) strategyStats[r.strategy] = { results: [], category: r.category };
    strategyStats[r.strategy].results.push(r);
  }

  const strategyRanking = Object.entries(strategyStats).map(([name, s]) => {
    const rs = s.results;
    const avg = (fn) => +(rs.reduce((a, r) => a + fn(r), 0) / rs.length).toFixed(2);
    return {
      name, category: s.category,
      avgReturn: avg(r => r.totalReturn),
      avgSharpe: avg(r => r.sharpeRatio || 0),
      avgWinRate: +(rs.reduce((a, r) => a + (r.winRate || 0), 0) / rs.length).toFixed(1),
      avgMaxDD: avg(r => r.maxDrawdown || 0),
      avgTrades: +(rs.reduce((a, r) => a + r.totalTrades, 0) / rs.length).toFixed(1),
      avgPF: avg(r => r.profitFactor || 0),
      avgAlpha: avg(r => r.alpha || 0),
      avgExpectancy: +(rs.reduce((a, r) => a + (r.expectancy || 0), 0) / rs.length).toFixed(4),
      avgSortino: avg(r => r.sortinoRatio || 0),
      avgCalmar: avg(r => r.calmarRatio || 0),
      tickerCount: rs.length,
      positiveCount: rs.filter(r => r.totalReturn > 0).length,
    };
  }).sort((a, b) => b.avgSharpe - a.avgSharpe);

  // 종목별 평균 성과
  const tickerStats = {};
  for (const r of validResults) {
    if (!tickerStats[r.ticker]) tickerStats[r.ticker] = [];
    tickerStats[r.ticker].push(r);
  }
  const tickerRanking = Object.entries(tickerStats).map(([ticker, rs]) => ({
    ticker,
    avgReturn: +(rs.reduce((a, r) => a + r.totalReturn, 0) / rs.length).toFixed(2),
    avgSharpe: +(rs.reduce((a, r) => a + (r.sharpeRatio || 0), 0) / rs.length).toFixed(2),
    avgMaxDD: +(rs.reduce((a, r) => a + (r.maxDrawdown || 0), 0) / rs.length).toFixed(2),
    avgWinRate: +(rs.reduce((a, r) => a + (r.winRate || 0), 0) / rs.length).toFixed(1),
  })).sort((a, b) => b.avgSharpe - a.avgSharpe);

  // 종목별 최고 전략
  const tickerBest = {};
  for (const r of validResults) {
    if (!tickerBest[r.ticker] || (r.sharpeRatio || 0) > (tickerBest[r.ticker].sharpeRatio || 0)) {
      tickerBest[r.ticker] = r;
    }
  }

  // Top 20 / Worst 10
  const top20 = [...validResults].sort((a, b) => (b.sharpeRatio || 0) - (a.sharpeRatio || 0)).slice(0, 20);
  const worst10 = [...validResults].sort((a, b) => (a.totalReturn || 0) - (b.totalReturn || 0)).slice(0, 10);

  // ── JSON 저장
  const report = {
    meta: {
      runDate: NOW.toISOString(), label: LABEL,
      totalStrategies: ALL_STRATEGIES.length,
      totalTickers: validTickers.length,
      totalBacktests: allResults.length,
      validBacktests: validResults.length,
      backtestOptions: BACKTEST_OPTIONS,
      version: 'v3.7',
    },
    marketDiagnoses, strategyRanking, tickerRanking,
    tickerBestStrategies: Object.fromEntries(
      Object.entries(tickerBest).map(([t, r]) => [t, {
        strategy: r.strategy, totalReturn: r.totalReturn, sharpeRatio: r.sharpeRatio,
        winRate: r.winRate, maxDrawdown: r.maxDrawdown, profitFactor: r.profitFactor, alpha: r.alpha,
      }])
    ),
    top20Results: top20.map(r => ({
      ticker: r.ticker, strategy: r.strategy, category: r.category,
      totalReturn: r.totalReturn, sharpeRatio: r.sharpeRatio, sortinoRatio: r.sortinoRatio,
      winRate: r.winRate, maxDrawdown: r.maxDrawdown, totalTrades: r.totalTrades,
      profitFactor: r.profitFactor, alpha: r.alpha, expectancy: r.expectancy,
    })),
    worst10Results: worst10.map(r => ({
      ticker: r.ticker, strategy: r.strategy,
      totalReturn: r.totalReturn, sharpeRatio: r.sharpeRatio, maxDrawdown: r.maxDrawdown,
    })),
    allResults: validResults.map(r => ({
      ticker: r.ticker, strategy: r.strategy, strategyId: r.strategyId, category: r.category,
      totalReturn: r.totalReturn, sharpeRatio: r.sharpeRatio, sortinoRatio: r.sortinoRatio,
      winRate: r.winRate, maxDrawdown: r.maxDrawdown, totalTrades: r.totalTrades,
      profitFactor: r.profitFactor, payoffRatio: r.payoffRatio, alpha: r.alpha,
      expectancy: r.expectancy, recoveryFactor: r.recoveryFactor,
      avgMAE: r.avgMAE, avgMFE: r.avgMFE, avgHoldBars: r.avgHoldBars, calmarRatio: r.calmarRatio,
    })),
  };

  writeFileSync(join(REPORT_DIR, `data-${LABEL}-backtest.json`), JSON.stringify(report, null, 2));

  // ── CSV 저장
  const csvHeader = 'ticker,strategy,category,totalReturn,sharpeRatio,sortinoRatio,winRate,maxDrawdown,totalTrades,profitFactor,alpha,expectancy,calmarRatio';
  const csvRows = validResults.map(r =>
    `${r.ticker},${r.strategy},${r.category || ''},${r.totalReturn},${r.sharpeRatio || 0},${r.sortinoRatio || 0},${r.winRate || 0},${r.maxDrawdown || 0},${r.totalTrades},${r.profitFactor || 0},${r.alpha || 0},${r.expectancy || 0},${r.calmarRatio || 0}`
  );
  writeFileSync(join(REPORT_DIR, `backtest-results-${LABEL}.csv`), [csvHeader, ...csvRows].join('\n'));

  // ── Top 20 CSV
  const top20Header = 'rank,ticker,strategy,totalReturn,sharpeRatio,sortinoRatio,winRate,maxDrawdown,totalTrades,profitFactor,alpha';
  const top20Rows = top20.map((r, i) =>
    `${i+1},${r.ticker},${r.strategy},${r.totalReturn},${r.sharpeRatio || 0},${r.sortinoRatio || 0},${r.winRate || 0},${r.maxDrawdown || 0},${r.totalTrades},${r.profitFactor || 0},${r.alpha || 0}`
  );
  writeFileSync(join(REPORT_DIR, `top20_combos_${LABEL}.csv`), [top20Header, ...top20Rows].join('\n'));

  // ── Markdown 리포트
  let md = `# DI금융 퀀트 연구소 — 백테스트 리포트\n`;
  md += `**날짜**: ${DATE_STR} | **전략**: ${ALL_STRATEGIES.length}개 | **종목**: ${validTickers.length}개 | **총 조합**: ${validResults.length}개\n\n`;

  md += `## 🏆 전략 성과 랭킹 (Sharpe 기준)\n\n`;
  md += `| 순위 | 전략 | 평균수익률(%) | Sharpe | 최대낙폭(%) | 승률(%) | PF |\n`;
  md += `|---:|:---|---:|---:|---:|---:|---:|\n`;
  strategyRanking.forEach((s, i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}`;
    md += `| ${medal} | ${s.name} | ${s.avgReturn > 0 ? '+' : ''}${s.avgReturn} | ${s.avgSharpe} | ${s.avgMaxDD} | ${s.avgWinRate} | ${s.avgPF} |\n`;
  });

  md += `\n## 📊 Top 20 전략-종목 조합\n\n`;
  md += `| 전략 | 종목 | 수익률(%) | Sharpe | 최대낙폭(%) | 승률(%) | 거래수 |\n`;
  md += `|:---|:---|---:|---:|---:|---:|---:|\n`;
  top20.forEach(r => {
    md += `| ${r.strategy} | ${r.ticker} | ${r.totalReturn > 0 ? '+' : ''}${r.totalReturn}% | ${r.sharpeRatio} | ${r.maxDrawdown}% | ${r.winRate}% | ${r.totalTrades} |\n`;
  });

  md += `\n## 📈 종목별 평균 성과\n\n`;
  md += `| 종목 | 평균수익률(%) | Sharpe | 최대낙폭(%) | 승률(%) |\n`;
  md += `|:---|---:|---:|---:|---:|\n`;
  tickerRanking.forEach(t => {
    md += `| ${t.ticker} | ${t.avgReturn > 0 ? '+' : ''}${t.avgReturn} | ${t.avgSharpe} | ${t.avgMaxDD} | ${t.avgWinRate} |\n`;
  });

  md += `\n## 🎯 종목별 최적 전략\n\n`;
  md += `| 종목 | 최적전략 | 수익률 | Sharpe | Alpha |\n`;
  md += `|:---|:---|---:|---:|---:|\n`;
  for (const [ticker, r] of Object.entries(tickerBest)) {
    md += `| ${ticker} | ${r.strategy} | ${r.totalReturn}% | ${r.sharpeRatio} | ${r.alpha}% |\n`;
  }

  md += `\n## ⚠️ 최악 10 성과\n\n`;
  md += `| 종목 | 전략 | 수익률 | Sharpe | MDD |\n`;
  md += `|:---|:---|---:|---:|---:|\n`;
  worst10.forEach(r => {
    md += `| ${r.ticker} | ${r.strategy} | ${r.totalReturn}% | ${r.sharpeRatio} | ${r.maxDrawdown}% |\n`;
  });

  md += `\n## 📊 시장 진단\n\n`;
  md += `| 종목 | 시장국면 | 추세 | RSI |\n`;
  md += `|:---|:---|:---|---:|\n`;
  for (const [ticker, d] of Object.entries(marketDiagnoses)) {
    md += `| ${ticker} | ${d.regime} | ${d.trend} | ${d.rsi || '-'} |\n`;
  }

  md += `\n---\n*DI금융 퀀트 연구소 v3.7 자동 생성 | ${NOW.toISOString()}*\n`;

  const mdPath = join(REPORT_DIR, `backtest-report-${LABEL}.md`);
  writeFileSync(mdPath, md);
  console.log(`  ✅ MD 리포트: ${mdPath}`);

  // ── 텔레그램 메시지 생성 및 전송
  const topStrats = strategyRanking.slice(0, 5);
  const topResults = top20.slice(0, 5);
  const positiveRate = validResults.length > 0
    ? ((validResults.filter(r => r.totalReturn > 0).length / validResults.length) * 100).toFixed(1) : 0;

  let tg = `📊 DI금융 퀀트 연구소 v3.7 — 백테스트 리포트\n`;
  tg += `━━━━━━━━━━━━━━━━━━\n`;
  tg += `📅 ${DATE_STR} ${TIME_STR} | 전략 ${ALL_STRATEGIES.length}개 x 종목 ${validTickers.length}개\n`;
  tg += `📈 유효 백테스트: ${validResults.length}건 | 양수수익: ${positiveRate}%\n\n`;

  tg += `🏆 TOP 5 전략 (Sharpe 기준):\n`;
  topStrats.forEach((s, i) => {
    const emoji = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'][i];
    tg += `${emoji} ${s.name}\n   수익 ${s.avgReturn > 0 ? '+' : ''}${s.avgReturn}% | Sharpe ${s.avgSharpe} | 승률 ${s.avgWinRate}%\n`;
  });

  tg += `\n⭐ TOP 5 개별 성과:\n`;
  topResults.forEach((r, i) => {
    tg += `${i+1}. ${r.ticker} × ${r.strategy}\n   수익 ${r.totalReturn > 0 ? '+' : ''}${r.totalReturn}% | Sharpe ${r.sharpeRatio} | Alpha ${r.alpha}%\n`;
  });

  tg += `\n📈 시장 현황:\n`;
  for (const [ticker, d] of Object.entries(marketDiagnoses)) {
    tg += `  ${ticker}: ${d.regime} (RSI ${d.rsi || '-'})\n`;
  }

  tg += `\n⚠️ 주의 조합:\n`;
  worst10.slice(0, 3).forEach(r => {
    tg += `  ${r.ticker} × ${r.strategy}: ${r.totalReturn}% (MDD ${r.maxDrawdown}%)\n`;
  });

  writeFileSync(join(REPORT_DIR, `telegram-${LABEL}.txt`), tg);

  // 텔레그램 전송
  const sent = await sendTelegram(tg);
  if (!sent) {
    console.log('⚠ 텔레그램 전송 실패 — 재시도...');
    await new Promise(r => setTimeout(r, 2000));
    await sendTelegram(tg);
  }

  console.log('\n══════════════════════════════════════════════════════');
  console.log('📋 요약');
  console.log('══════════════════════════════════════════════════════');
  console.log(`유효 백테스트: ${validResults.length}건`);
  console.log(`양수 수익: ${positiveRate}%`);
  console.log(`Top 전략: ${topStrats[0]?.name || 'N/A'} (Sharpe ${topStrats[0]?.avgSharpe || 0})`);
  console.log(`Top 조합: ${topResults[0]?.ticker || 'N/A'} × ${topResults[0]?.strategy || 'N/A'} (수익 ${topResults[0]?.totalReturn || 0}%)`);
  console.log('══════════════════════════════════════════════════════');
}

main().catch(err => {
  console.error('❌ Fatal:', err);
  process.exit(1);
});
