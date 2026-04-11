#!/usr/bin/env node
/**
 * Binance Futures API 연결 테스트 스크립트
 *
 * 사용법:
 *   node scripts/test-binance.mjs
 *
 * 환경변수 (터미널에서 직접 세팅):
 *   export BINANCE_API_KEY="your-api-key"
 *   export BINANCE_API_SECRET="your-api-secret"
 */

import crypto from "crypto";

const API_KEY = process.env.BINANCE_API_KEY;
const API_SECRET = process.env.BINANCE_API_SECRET;
const BASE = "https://fapi.binance.com";

if (!API_KEY || !API_SECRET) {
  console.error("\n❌ 환경변수를 먼저 설정해주세요:\n");
  console.error('  export BINANCE_API_KEY="your-api-key"');
  console.error('  export BINANCE_API_SECRET="your-api-secret"\n');
  process.exit(1);
}

function sign(queryString) {
  return crypto.createHmac("sha256", API_SECRET).update(queryString).digest("hex");
}

async function signedGet(path, params = {}) {
  params.timestamp = Date.now();
  params.recvWindow = 5000;
  const qs = new URLSearchParams(params).toString();
  const signature = sign(qs);
  const url = `${BASE}${path}?${qs}&signature=${signature}`;
  const res = await fetch(url, { headers: { "X-MBX-APIKEY": API_KEY } });
  return res.json();
}

async function signedPost(path, params = {}) {
  params.timestamp = Date.now();
  params.recvWindow = 5000;
  const qs = new URLSearchParams(params).toString();
  const signature = sign(qs);
  const url = `${BASE}${path}?${qs}&signature=${signature}`;
  const res = await fetch(url, { method: "POST", headers: { "X-MBX-APIKEY": API_KEY } });
  return res.json();
}

console.log("\n🔍 Binance Futures API 연결 테스트 시작...\n");
console.log("─".repeat(50));

// 1. 서버 시간 확인 (비서명)
try {
  const res = await fetch(`${BASE}/fapi/v1/time`);
  const data = await res.json();
  console.log("✅ 1. 서버 연결:", new Date(data.serverTime).toISOString());
} catch (e) {
  console.error("❌ 1. 서버 연결 실패:", e.message);
  process.exit(1);
}

// 2. BTCUSDT 현재가
try {
  const res = await fetch(`${BASE}/fapi/v1/ticker/price?symbol=BTCUSDT`);
  const data = await res.json();
  console.log(`✅ 2. BTC 현재가: $${Number(data.price).toLocaleString()}`);
} catch (e) {
  console.error("❌ 2. 가격 조회 실패:", e.message);
}

// 3. 계정 정보 (서명 필요)
try {
  const account = await signedGet("/fapi/v2/account");
  if (account.code) {
    console.error(`❌ 3. 계정 조회 실패: [${account.code}] ${account.msg}`);
    if (account.code === -2015) console.error("   → API 키가 잘못되었거나 IP 제한에 걸렸습니다");
    if (account.code === -1021) console.error("   → 시간 동기화 문제 (PC 시간 확인)");
  } else {
    const wallet = Number(account.totalWalletBalance);
    const available = Number(account.availableBalance);
    const unrealized = Number(account.totalUnrealizedProfit);
    console.log(`✅ 3. 계정 연결 성공!`);
    console.log(`   💰 총 잔고: $${wallet.toFixed(2)}`);
    console.log(`   💵 가용 잔고: $${available.toFixed(2)}`);
    console.log(`   📊 미실현 손익: $${unrealized.toFixed(2)}`);
    console.log(`   🔑 거래 가능: ${account.canTrade ? "YES" : "NO"}`);
  }
} catch (e) {
  console.error("❌ 3. 계정 조회 실패:", e.message);
}

// 4. 현재 포지션 확인
try {
  const positions = await signedGet("/fapi/v2/positionRisk");
  if (positions.code) {
    console.error(`❌ 4. 포지션 조회 실패: [${positions.code}] ${positions.msg}`);
  } else {
    const open = positions.filter(p => Number(p.positionAmt) !== 0);
    console.log(`✅ 4. 오픈 포지션: ${open.length}개`);
    open.forEach(p => {
      const pnl = Number(p.unRealizedProfit);
      const emoji = pnl >= 0 ? "🟢" : "🔴";
      console.log(`   ${emoji} ${p.symbol} ${Number(p.positionAmt) > 0 ? "LONG" : "SHORT"} | 수량: ${p.positionAmt} | 미실현: $${pnl.toFixed(2)}`);
    });
  }
} catch (e) {
  console.error("❌ 4. 포지션 조회 실패:", e.message);
}

// 5. $15 테스트 주문 (Dry Run)
console.log("\n─".repeat(50));
console.log("\n📋 $15 BTCUSDT 롱 주문 시뮬레이션:\n");

try {
  const priceRes = await fetch(`${BASE}/fapi/v1/ticker/price?symbol=BTCUSDT`);
  const priceData = await priceRes.json();
  const btcPrice = Number(priceData.price);

  // 레버리지 10x → 노셔널 $150 → 수량 계산
  const leverage = 10;
  const usdt = 15;
  const notional = usdt * leverage;
  const qty = Math.floor((notional / btcPrice) * 1000) / 1000; // 소수점 3자리

  console.log(`   심볼: BTCUSDT`);
  console.log(`   방향: LONG (매수)`);
  console.log(`   마진: $${usdt} USDT`);
  console.log(`   레버리지: ${leverage}x`);
  console.log(`   노셔널: $${notional}`);
  console.log(`   BTC 현재가: $${btcPrice.toLocaleString()}`);
  console.log(`   주문 수량: ${qty} BTC`);
  console.log(`   예상 체결가: ~$${(qty * btcPrice).toFixed(2)}`);

  // 실제 주문은 여기서 실행하지 않음
  console.log(`\n   ⚠️  이것은 시뮬레이션입니다. 실제 주문은 아래 명령어로:\n`);
  console.log(`   node scripts/test-binance.mjs --execute\n`);

  // --execute 플래그가 있으면 실제 주문
  if (process.argv.includes("--execute")) {
    console.log("   🚀 실제 주문 실행 중...\n");

    // 레버리지 설정
    const levRes = await signedPost("/fapi/v1/leverage", {
      symbol: "BTCUSDT",
      leverage: leverage,
    });
    if (levRes.code) {
      console.error(`   ❌ 레버리지 설정 실패: ${levRes.msg}`);
    } else {
      console.log(`   ✅ 레버리지 ${leverage}x 설정 완료`);
    }

    // 마진 타입 설정 (ISOLATED)
    const marginRes = await signedPost("/fapi/v1/marginType", {
      symbol: "BTCUSDT",
      marginType: "ISOLATED",
    });
    // -4046 = "No need to change margin type" (이미 설정됨)
    if (marginRes.code && marginRes.code !== -4046) {
      console.error(`   ❌ 마진 타입 설정 실패: ${marginRes.msg}`);
    } else {
      console.log(`   ✅ ISOLATED 마진 설정 완료`);
    }

    // 시장가 매수 주문
    const order = await signedPost("/fapi/v1/order", {
      symbol: "BTCUSDT",
      side: "BUY",
      type: "MARKET",
      quantity: qty,
    });

    if (order.code) {
      console.error(`   ❌ 주문 실패: [${order.code}] ${order.msg}`);
      if (order.code === -2019) console.error("   → 마진이 부족합니다");
      if (order.code === -4164) console.error("   → 최소 주문 수량 미달");
    } else {
      console.log(`   ✅ 주문 성공!`);
      console.log(`   📋 주문 ID: ${order.orderId}`);
      console.log(`   📋 상태: ${order.status}`);
      console.log(`   📋 체결가: $${order.avgPrice || order.price}`);
      console.log(`   📋 수량: ${order.origQty} BTC`);
    }
  }

} catch (e) {
  console.error("❌ 주문 시뮬레이션 실패:", e.message);
}

console.log("\n" + "─".repeat(50));
console.log("테스트 완료!\n");
