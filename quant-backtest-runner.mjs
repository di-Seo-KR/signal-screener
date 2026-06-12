#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════
// DI금융 퀀트 연구소 — 자동 백테스트 러너 v1.0
// 전체 전략(ALL_STRATEGIES) x 주요 종목 백테스트 실행 및 리포트 생성
// 실행일: 2026-03-25
// ════════════════════════════════════════════════════════════════════

import { ALL_STRATEGIES, runBacktest, diagnoseMarket } from './src/strategies.js';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

// ── 설정 ──────────────────────────────────────────────────
const STOCK_TICKERS = ['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'META', 'TSLA', 'AMD', 'AVGO', 'TSM'];
const CRYPTO_TICKERS = ['BTC', 'ETH', 'SOL'];
const CRYPTO_IDS = { BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana' };

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

// ── Yahoo Finance OHLCV 가져오기 ─────────────────────────
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
          time: ts[i],
          open: q.open[i],
          high: q.high[i],
          low: q.low[i],
          close: q.close[i],
          volume: q.volume[i] || 0,
        });
      }
    }
    return candles;
  } catch (e) {
    console.error(`  ⚠ Yahoo fetch failed for ${ticker}: ${e.message}`);
    return null;
  }
}

// ── CoinGecko OHLCV 가져오기 ─────────────────────────────
async function fetchCoinGeckoOHLCV(cryptoId, ticker) {
  const url = `https://api.coingecko.com/api/v3/coins/${cryptoId}/ohlc?vs_currency=usd&days=365`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    // CoinGecko OHLC: [timestamp, open, high, low, close]
    // Group by day for daily candles
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

    const candles = [...dailyMap.values()].sort((a, b) => a.time - b.time);
    return candles;
  } catch (e) {
    console.error(`  ⚠ CoinGecko fetch failed for ${ticker}: ${e.message}`);
    return null;
  }
}

// ── 백테스트 실행 ─────────────────────────────────────────
function runStrategyBacktest(strategy, candles, ticker) {
  try {
    const signals = strategy.generate(candles);
    if (!signals || signals.length === 0) {
      return { ticker, strategy: strategy.name, totalTrades: 0, totalReturn: 0, note: 'No signals generated' };
    }
    const result = runBacktest(candles, signals, BACKTEST_OPTIONS);
    return {
      ticker,
      strategy: strategy.name,
      strategyId: strategy.id,
      category: strategy.category,
      ...result,
    };
  } catch (e) {
    return { ticker, strategy: strategy.name, error: e.message, totalTrades: 0, totalReturn: 0 };
  }
}

// ── 메인 실행 ─────────────────────────────────────────────
async function main() {
  console.log('══════════════════════════════════════════════════════');
  console.log('DI금융 퀀트 연구소 — 자동 백테스트 실행');
  console.log(`전략 수: ${ALL_STRATEGIES.length}`);
  console.log(`종목: ${[...STOCK_TICKERS, ...CRYPTO_TICKERS].join(', ')}`);
  console.log(`실행일: ${new Date().toISOString().slice(0, 10)}`);
  console.log('══════════════════════════════════════════════════════\n');

  // 1. 데이터 수집
  console.log('📊 1단계: OHLCV 데이터 수집...');
  const tickerData = {};

  // 주식 데이터 (순차적으로 가져오되, 약간의 딜레이)
  for (const ticker of STOCK_TICKERS) {
    process.stdout.write(`  ${ticker}...`);
    tickerData[ticker] = await fetchYahooOHLCV(ticker);
    if (tickerData[ticker]) {
      console.log(` ✓ ${tickerData[ticker].length}일`);
    } else {
      console.log(` ✗ 실패`);
    }
    await new Promise(r => setTimeout(r, 300));
  }

  // 크립토 데이터
  for (const ticker of CRYPTO_TICKERS) {
    process.stdout.write(`  ${ticker}...`);
    tickerData[ticker] = await fetchCoinGeckoOHLCV(CRYPTO_IDS[ticker], ticker);
    if (tickerData[ticker]) {
      console.log(` ✓ ${tickerData[ticker].length}일`);
    } else {
      console.log(` ✗ 실패`);
    }
    await new Promise(r => setTimeout(r, 500));
  }

  const validTickers = Object.entries(tickerData).filter(([_, v]) => v && v.length >= 60);
  console.log(`\n✅ 유효 데이터: ${validTickers.length}개 종목\n`);

  if (validTickers.length === 0) {
    console.error('❌ 유효한 데이터가 없습니다. 종료합니다.');
    process.exit(1);
  }

  // 2. 시장 진단
  console.log('🔍 2단계: 시장 진단...');
  const marketDiagnoses = {};
  for (const [ticker, candles] of validTickers) {
    marketDiagnoses[ticker] = diagnoseMarket(candles);
    console.log(`  ${ticker}: ${marketDiagnoses[ticker].regime} (추세=${marketDiagnoses[ticker].trend}, RSI=${marketDiagnoses[ticker].rsi})`);
  }

  // 3. 백테스트 실행
  console.log(`\n⚡ 3단계: ${ALL_STRATEGIES.length} x ${validTickers.length} = ${ALL_STRATEGIES.length * validTickers.length}개 백테스트 실행...`);
  const allResults = [];
  let completed = 0;
  const total = ALL_STRATEGIES.length * validTickers.length;

  for (const strategy of ALL_STRATEGIES) {
    for (const [ticker, candles] of validTickers) {
      // BTC 알파 전략은 BTC에만 적용
      if (strategy.id === 'btc_alpha' && ticker !== 'BTC') {
        completed++;
        continue;
      }
      const result = runStrategyBacktest(strategy, candles, ticker);
      allResults.push(result);
      completed++;
      if (completed % 50 === 0) {
        console.log(`  진행: ${completed}/${total} (${((completed/total)*100).toFixed(0)}%)`);
      }
    }
  }
  console.log(`  완료: ${allResults.length}개 백테스트\n`);

  // 4. 결과 분석 및 리포트 생성
  console.log('📈 4단계: 리포트 생성...');

  // 유효한 결과만 필터 (거래 1회 이상)
  const validResults = allResults.filter(r => r.totalTrades >= 1 && !r.error);

  // ── 전략별 평균 성과
  const strategyStats = {};
  for (const r of validResults) {
    if (!strategyStats[r.strategy]) {
      strategyStats[r.strategy] = { results: [], category: r.category };
    }
    strategyStats[r.strategy].results.push(r);
  }

  const strategyRanking = Object.entries(strategyStats).map(([name, s]) => {
    const rs = s.results;
    return {
      name,
      category: s.category,
      avgReturn: +(rs.reduce((a, r) => a + r.totalReturn, 0) / rs.length).toFixed(2),
      avgSharpe: +(rs.reduce((a, r) => a + (r.sharpeRatio || 0), 0) / rs.length).toFixed(2),
      avgWinRate: +(rs.reduce((a, r) => a + (r.winRate || 0), 0) / rs.length).toFixed(1),
      avgMaxDD: +(rs.reduce((a, r) => a + (r.maxDrawdown || 0), 0) / rs.length).toFixed(2),
      avgTrades: +(rs.reduce((a, r) => a + r.totalTrades, 0) / rs.length).toFixed(1),
      avgPF: +(rs.reduce((a, r) => a + (r.profitFactor || 0), 0) / rs.length).toFixed(2),
      avgAlpha: +(rs.reduce((a, r) => a + (r.alpha || 0), 0) / rs.length).toFixed(2),
      avgExpectancy: +(rs.reduce((a, r) => a + (r.expectancy || 0), 0) / rs.length).toFixed(4),
      tickerCount: rs.length,
      positiveCount: rs.filter(r => r.totalReturn > 0).length,
    };
  }).sort((a, b) => b.avgSharpe - a.avgSharpe);

  // ── 종목별 최고 전략
  const tickerBest = {};
  for (const r of validResults) {
    if (!tickerBest[r.ticker] || r.sharpeRatio > (tickerBest[r.ticker].sharpeRatio || 0)) {
      tickerBest[r.ticker] = r;
    }
  }

  // ── Top 20 개별 성과
  const top20 = [...validResults].sort((a, b) => (b.sharpeRatio || 0) - (a.sharpeRatio || 0)).slice(0, 20);
  const worst10 = [...validResults].sort((a, b) => (a.totalReturn || 0) - (b.totalReturn || 0)).slice(0, 10);

  // ── JSON 리포트 저장
  const report = {
    meta: {
      runDate: new Date().toISOString(),
      totalStrategies: ALL_STRATEGIES.length,
      totalTickers: validTickers.length,
      totalBacktests: allResults.length,
      validBacktests: validResults.length,
      backtestOptions: BACKTEST_OPTIONS,
    },
    marketDiagnoses,
    strategyRanking,
    tickerBestStrategies: tickerBest,
    top20Results: top20.map(r => ({
      ticker: r.ticker, strategy: r.strategy, category: r.category,
      totalReturn: r.totalReturn, sharpeRatio: r.sharpeRatio, winRate: r.winRate,
      maxDrawdown: r.maxDrawdown, totalTrades: r.totalTrades, profitFactor: r.profitFactor,
      alpha: r.alpha, expectancy: r.expectancy, sortinoRatio: r.sortinoRatio,
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
      avgMAE: r.avgMAE, avgMFE: r.avgMFE, avgHoldBars: r.avgHoldBars,
      calmarRatio: r.calmarRatio,
    })),
  };

  const jsonPath = join(REPORT_DIR, `backtest-${new Date().toISOString().slice(0, 10)}.json`);
  writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  console.log(`  ✅ JSON 리포트: ${jsonPath}`);

  // ── Markdown 리포트 생성
  let md = `# DI금융 퀀트 연구소 — 백테스트 리포트\n\n`;
  md += `**실행일:** ${new Date().toISOString().slice(0, 10)}  \n`;
  md += `**전략:** ${ALL_STRATEGIES.length}개 | **종목:** ${validTickers.length}개 | **백테스트:** ${validResults.length}건  \n`;
  md += `**설정:** 초기자금 $${BACKTEST_OPTIONS.initialCapital} | 손절 ${BACKTEST_OPTIONS.stopLoss}% | 익절 ${BACKTEST_OPTIONS.takeProfit}% | 트레일링 ${BACKTEST_OPTIONS.trailingStop}%\n\n`;

  md += `## 📊 시장 진단\n\n`;
  md += `| 종목 | 시장국면 | 추세 | 변동성 | 모멘텀 | RSI |\n`;
  md += `|------|---------|------|--------|--------|-----|\n`;
  for (const [ticker, diag] of Object.entries(marketDiagnoses)) {
    md += `| ${ticker} | ${diag.regime} | ${diag.trend} | ${diag.volatility} | ${diag.momentum} | ${diag.rsi || '-'} |\n`;
  }

  md += `\n## 🏆 전략 랭킹 (Sharpe Ratio 기준)\n\n`;
  md += `| # | 전략 | 카테고리 | 평균수익률 | Sharpe | 승률 | 최대낙폭 | PF | Alpha | Expectancy |\n`;
  md += `|---|------|---------|-----------|--------|------|---------|----|----|------------|\n`;
  strategyRanking.forEach((s, i) => {
    const returnEmoji = s.avgReturn > 0 ? '🟢' : '🔴';
    md += `| ${i+1} | ${s.name} | ${s.category} | ${returnEmoji} ${s.avgReturn}% | ${s.avgSharpe} | ${s.avgWinRate}% | ${s.avgMaxDD}% | ${s.avgPF} | ${s.avgAlpha}% | ${s.avgExpectancy} |\n`;
  });

  md += `\n## 🎯 종목별 최적 전략\n\n`;
  md += `| 종목 | 최적 전략 | 수익률 | Sharpe | 승률 | 최대낙폭 | Alpha |\n`;
  md += `|------|---------|--------|--------|------|---------|-------|\n`;
  for (const [ticker, r] of Object.entries(tickerBest)) {
    md += `| ${ticker} | ${r.strategy} | ${r.totalReturn}% | ${r.sharpeRatio} | ${r.winRate}% | ${r.maxDrawdown}% | ${r.alpha}% |\n`;
  }

  md += `\n## ⭐ Top 20 성과 (Sharpe 기준)\n\n`;
  md += `| # | 종목 | 전략 | 수익률 | Sharpe | Sortino | 승률 | MDD | PF | Alpha |\n`;
  md += `|---|------|------|--------|--------|---------|------|-----|----|-------|\n`;
  top20.forEach((r, i) => {
    md += `| ${i+1} | ${r.ticker} | ${r.strategy} | ${r.totalReturn}% | ${r.sharpeRatio} | ${r.sortinoRatio} | ${r.winRate}% | ${r.maxDrawdown}% | ${r.profitFactor} | ${r.alpha}% |\n`;
  });

  md += `\n## ⚠️ 최악 10 성과\n\n`;
  md += `| # | 종목 | 전략 | 수익률 | Sharpe | MDD |\n`;
  md += `|---|------|------|--------|--------|-----|\n`;
  worst10.forEach((r, i) => {
    md += `| ${i+1} | ${r.ticker} | ${r.strategy} | ${r.totalReturn}% | ${r.sharpeRatio} | ${r.maxDrawdown}% |\n`;
  });

  md += `\n---\n*DI금융 퀀트 연구소 자동 생성 리포트 | ${new Date().toISOString()}*\n`;

  const mdPath = join(REPORT_DIR, `backtest-${new Date().toISOString().slice(0, 10)}.md`);
  writeFileSync(mdPath, md);
  console.log(`  ✅ Markdown 리포트: ${mdPath}`);

  // ── 텔레그램 요약 생성
  const topStrats = strategyRanking.slice(0, 5);
  const topResults = top20.slice(0, 5);

  let telegramMsg = `📊 DI금융 퀀트 연구소 — 백테스트 리포트\n`;
  telegramMsg += `━━━━━━━━━━━━━━━━━━\n`;
  telegramMsg += `📅 ${new Date().toISOString().slice(0, 10)}\n`;
  telegramMsg += `🔢 ${ALL_STRATEGIES.length}개 전략 x ${validTickers.length}개 종목 = ${validResults.length}건\n\n`;

  telegramMsg += `🏆 TOP 5 전략 (평균 Sharpe):\n`;
  topStrats.forEach((s, i) => {
    const emoji = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'][i];
    telegramMsg += `${emoji} ${s.name}\n   수익 ${s.avgReturn}% | Sharpe ${s.avgSharpe} | 승률 ${s.avgWinRate}%\n`;
  });

  telegramMsg += `\n⭐ TOP 5 개별 성과:\n`;
  topResults.forEach((r, i) => {
    telegramMsg += `${i+1}. ${r.ticker}×${r.strategy}\n   수익 ${r.totalReturn}% | Sharpe ${r.sharpeRatio} | Alpha ${r.alpha}%\n`;
  });

  telegramMsg += `\n📈 시장 현황:\n`;
  for (const [ticker, diag] of Object.entries(marketDiagnoses)) {
    telegramMsg += `  ${ticker}: ${diag.regime} (RSI ${diag.rsi || '-'})\n`;
  }

  telegramMsg += `\n⚠️ 주의 종목:\n`;
  worst10.slice(0, 3).forEach(r => {
    telegramMsg += `  ${r.ticker}×${r.strategy}: ${r.totalReturn}% (MDD ${r.maxDrawdown}%)\n`;
  });
  telegramMsg += `\n🔗 상세 리포트: quant-reports/ 디렉토리 확인`;

  // 결과 출력
  console.log('\n══════════════════════════════════════════════════════');
  console.log('📋 요약');
  console.log('══════════════════════════════════════════════════════');
  console.log(`유효 백테스트: ${validResults.length}건`);
  console.log(`양수 수익 전략: ${validResults.filter(r => r.totalReturn > 0).length}건 (${((validResults.filter(r => r.totalReturn > 0).length / validResults.length) * 100).toFixed(1)}%)`);
  console.log(`\nTop 전략: ${topStrats[0]?.name || 'N/A'} (Sharpe ${topStrats[0]?.avgSharpe || 0})`);
  console.log(`Top 조합: ${topResults[0]?.ticker || 'N/A'} x ${topResults[0]?.strategy || 'N/A'} (수익 ${topResults[0]?.totalReturn || 0}%)`);

  // 텔레그램 메시지 반환
  return telegramMsg;
}

// 실행
main().then(telegramMsg => {
  writeFileSync(join(REPORT_DIR, 'telegram-msg.txt'), telegramMsg);
  console.log('\n✅ 텔레그램 메시지 준비 완료');
  console.log(telegramMsg);
}).catch(err => {
  console.error('❌ 오류:', err);
  process.exit(1);
});
