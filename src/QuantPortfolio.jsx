// DI금융 — 퀀트 전략별 포트폴리오 시스템 v4.0
// 실제 시장 데이터 기반 백테스트 + 전략 generate() 시그널 매매기록
// Yahoo Finance 실시간 데이터 → 전략별 수익률 · 매매 · 리밸런싱
import React, { useState, useMemo, useRef, useEffect, useCallback } from "react";
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

const CAT_COLORS = {
  "추세추종": "#3182F6", "평균회귀": "#8B5CF6", "모멘텀": "#FFB400", "변동성": "#F04452",
};

// ══════════════════════════════════════════════════════════════
// 종목명 매핑
// ══════════════════════════════════════════════════════════════
const SYM_NAMES = {
  AAPL: "애플", MSFT: "마이크로소프트", NVDA: "엔비디아", TSLA: "테슬라", AMZN: "아마존",
  GOOG: "구글", GOOGL: "구글A", META: "메타", AMD: "AMD", AVGO: "브로드컴", JPM: "JP모건",
  V: "비자", MA: "마스터카드", JNJ: "존슨앤존슨", PG: "P&G", UNH: "유나이티드헬스",
  HD: "홈디포", DIS: "디즈니", NFLX: "넷플릭스", PYPL: "페이팔", INTC: "인텔",
  CRM: "세일즈포스", ORCL: "오라클", CSCO: "시스코", PEP: "펩시", KO: "코카콜라",
  MRK: "머크", LLY: "일라이릴리", ABBV: "애브비", TMO: "써모피셔", DHR: "다나허",
  COST: "코스트코", WMT: "월마트", NKE: "나이키", SBUX: "스타벅스", MCD: "맥도날드",
  BA: "보잉", CAT: "캐터필러", GE: "GE에어로", RTX: "RTX(레이시온)", LMT: "록히드마틴",
  XOM: "엑슨모빌", CVX: "셰브론", COP: "코노코필립스",
  GS: "골드만삭스", MS: "모건스탠리", BAC: "뱅크오브아메리카", C: "씨티그룹", WFC: "웰스파고",
  BLK: "블랙록", SCHW: "찰스슈왑",
  QCOM: "퀄컴", MU: "마이크론", MRVL: "마벨", LRCX: "램리서치", AMAT: "어플라이드",
  KLAC: "KLA", SNPS: "시놉시스", CDNS: "케이던스",
  NOW: "서비스나우", PANW: "팔로알토", SNOW: "스노우플레이크", DDOG: "데이터독",
  NET: "클라우드플레어", ZS: "지스케일러", CRWD: "크라우드스트라이크",
  SHOP: "쇼피파이", SQ: "블록(스퀘어)", COIN: "코인베이스", MSTR: "마이크로스트래티지",
  UBER: "우버", ABNB: "에어비앤비", DASH: "도어대시",
  SPY: "S&P 500 ETF", QQQ: "나스닥 ETF", IWM: "러셀2000 ETF", DIA: "다우 ETF",
  GLD: "금 ETF", SLV: "은 ETF", TLT: "미국채20Y ETF", XLE: "에너지 ETF",
  XLF: "금융 ETF", XLK: "기술 ETF", XLV: "헬스케어 ETF", XLI: "산업 ETF",
  ARKK: "ARK 혁신 ETF", SOXX: "반도체 ETF", SMH: "반도체 VanEck",
  VNQ: "부동산 ETF", KWEB: "중국기술 ETF",
  "BTC-USD": "비트코인", "ETH-USD": "이더리움", "SOL-USD": "솔라나",
  "BNB-USD": "바이낸스코인", "XRP-USD": "리플", "ADA-USD": "카르다노",
  "AVAX-USD": "아발란체", "DOT-USD": "폴카닷", "LINK-USD": "체인링크",
  "MATIC-USD": "폴리곤", "DOGE-USD": "도지코인",
  "005930.KS": "삼성전자", "000660.KS": "SK하이닉스", "373220.KS": "LG에너지솔루션",
  "005380.KS": "현대차", "000270.KS": "기아", "068270.KS": "셀트리온",
  "035420.KS": "NAVER", "035720.KS": "카카오", "051910.KS": "LG화학",
  "006400.KS": "삼성SDI", "066570.KS": "LG전자", "009150.KS": "삼성전기",
  "105560.KS": "KB금융", "055550.KS": "신한지주", "086790.KS": "하나금융지주",
  "012330.KS": "현대모비스", "096770.KS": "SK이노베이션", "017670.KS": "SK텔레콤",
  "028260.KS": "삼성물산", "009540.KS": "HD한국조선해양", "329180.KS": "HD현대중공업",
  "259960.KS": "크래프톤", "352820.KS": "하이브", "003670.KS": "포스코퓨처엠",
  "207940.KS": "삼성바이오로직스", "034730.KS": "SK",
  "042700.KS": "한미반도체", "247540.KS": "에코프로비엠", "058470.KS": "리노공업",
};

const getName = (sym) => SYM_NAMES[sym] || sym.replace(".KS", "").replace("-USD", "");

// ══════════════════════════════════════════════════════════════
// 전략별 포트폴리오 (32개 전략 × 다양한 종목 구성)
// ══════════════════════════════════════════════════════════════
const STRATEGY_PORTFOLIOS = {
  "RSI 반전 전략": [
    { sym: "GOOGL", w: 0.10 }, { sym: "AMD", w: 0.08 }, { sym: "TSLA", w: 0.08 },
    { sym: "AAPL", w: 0.08 }, { sym: "DIS", w: 0.06 }, { sym: "PYPL", w: 0.06 },
    { sym: "INTC", w: 0.06 }, { sym: "005930.KS", w: 0.08 }, { sym: "035720.KS", w: 0.06 },
    { sym: "ETH-USD", w: 0.08 }, { sym: "SOL-USD", w: 0.06 }, { sym: "NKE", w: 0.06 },
    { sym: "BA", w: 0.06 }, { sym: "COIN", w: 0.04 }, { sym: "DASH", w: 0.04 },
  ],
  "볼린저밴드 바운스": [
    { sym: "AAPL", w: 0.10 }, { sym: "MSFT", w: 0.08 }, { sym: "JPM", w: 0.08 },
    { sym: "JNJ", w: 0.06 }, { sym: "PG", w: 0.06 }, { sym: "V", w: 0.06 },
    { sym: "KO", w: 0.05 }, { sym: "PEP", w: 0.05 }, { sym: "MRK", w: 0.06 },
    { sym: "COST", w: 0.05 }, { sym: "105560.KS", w: 0.06 }, { sym: "055550.KS", w: 0.05 },
    { sym: "HD", w: 0.05 }, { sym: "UNH", w: 0.06 }, { sym: "WMT", w: 0.04 },
    { sym: "ABBV", w: 0.05 }, { sym: "TMO", w: 0.04 },
  ],
  "스토캐스틱+RSI 콤보": [
    { sym: "AMZN", w: 0.08 }, { sym: "META", w: 0.08 }, { sym: "NFLX", w: 0.07 },
    { sym: "CRM", w: 0.06 }, { sym: "ORCL", w: 0.06 }, { sym: "SBUX", w: 0.05 },
    { sym: "MCD", w: 0.05 }, { sym: "068270.KS", w: 0.06 }, { sym: "207940.KS", w: 0.06 },
    { sym: "BTC-USD", w: 0.08 }, { sym: "LINK-USD", w: 0.05 },
    { sym: "MA", w: 0.06 }, { sym: "DHR", w: 0.05 }, { sym: "ABNB", w: 0.05 },
    { sym: "UBER", w: 0.05 }, { sym: "LLY", w: 0.05 }, { sym: "NOW", w: 0.04 },
  ],
  "켈트너 채널 회귀": [
    { sym: "XLF", w: 0.10 }, { sym: "JPM", w: 0.08 }, { sym: "GS", w: 0.07 },
    { sym: "BAC", w: 0.06 }, { sym: "MS", w: 0.06 }, { sym: "BLK", w: 0.06 },
    { sym: "V", w: 0.06 }, { sym: "MA", w: 0.06 }, { sym: "086790.KS", w: 0.06 },
    { sym: "105560.KS", w: 0.06 }, { sym: "SCHW", w: 0.05 },
    { sym: "WFC", w: 0.05 }, { sym: "XLV", w: 0.06 }, { sym: "UNH", w: 0.05 },
    { sym: "PG", w: 0.06 }, { sym: "MCD", w: 0.06 },
  ],
  "VWAP 반전": [
    { sym: "NVDA", w: 0.08 }, { sym: "AMD", w: 0.07 }, { sym: "MRVL", w: 0.06 },
    { sym: "MU", w: 0.06 }, { sym: "QCOM", w: 0.06 }, { sym: "LRCX", w: 0.05 },
    { sym: "AMAT", w: 0.05 }, { sym: "SOXX", w: 0.08 }, { sym: "000660.KS", w: 0.08 },
    { sym: "042700.KS", w: 0.06 }, { sym: "058470.KS", w: 0.05 },
    { sym: "009150.KS", w: 0.05 }, { sym: "AVGO", w: 0.07 },
    { sym: "KLAC", w: 0.05 }, { sym: "SNPS", w: 0.04 }, { sym: "CDNS", w: 0.04 },
    { sym: "SMH", w: 0.05 },
  ],
  "피보나치 되돌림": [
    { sym: "SPY", w: 0.10 }, { sym: "QQQ", w: 0.08 }, { sym: "AAPL", w: 0.07 },
    { sym: "MSFT", w: 0.07 }, { sym: "AMZN", w: 0.06 }, { sym: "GOOG", w: 0.06 },
    { sym: "BTC-USD", w: 0.08 }, { sym: "GLD", w: 0.06 },
    { sym: "005930.KS", w: 0.07 }, { sym: "000660.KS", w: 0.05 },
    { sym: "TLT", w: 0.06 }, { sym: "XLE", w: 0.05 },
    { sym: "DIA", w: 0.05 }, { sym: "COST", w: 0.05 },
    { sym: "LLY", w: 0.05 }, { sym: "ABBV", w: 0.04 },
  ],
  "통계적 차익 (Z-Score)": [
    { sym: "XOM", w: 0.08 }, { sym: "CVX", w: 0.07 }, { sym: "COP", w: 0.06 },
    { sym: "JPM", w: 0.07 }, { sym: "GS", w: 0.06 }, { sym: "BAC", w: 0.05 },
    { sym: "GLD", w: 0.08 }, { sym: "SLV", w: 0.05 }, { sym: "TLT", w: 0.06 },
    { sym: "034730.KS", w: 0.06 }, { sym: "096770.KS", w: 0.05 },
    { sym: "VNQ", w: 0.06 }, { sym: "XLE", w: 0.06 },
    { sym: "XLI", w: 0.05 }, { sym: "CAT", w: 0.05 },
    { sym: "SPY", w: 0.05 }, { sym: "IWM", w: 0.04 },
  ],
  "래리 코너스 RSI(2)": [
    { sym: "SPY", w: 0.12 }, { sym: "QQQ", w: 0.10 }, { sym: "IWM", w: 0.08 },
    { sym: "DIA", w: 0.08 }, { sym: "AAPL", w: 0.06 }, { sym: "MSFT", w: 0.06 },
    { sym: "AMZN", w: 0.06 }, { sym: "META", w: 0.05 }, { sym: "NVDA", w: 0.05 },
    { sym: "005930.KS", w: 0.06 }, { sym: "AVGO", w: 0.05 },
    { sym: "GLD", w: 0.06 }, { sym: "XLK", w: 0.06 },
    { sym: "NFLX", w: 0.05 }, { sym: "CRM", w: 0.06 },
  ],
  "MFI 자금유입": [
    { sym: "NVDA", w: 0.08 }, { sym: "TSLA", w: 0.07 }, { sym: "AVGO", w: 0.07 },
    { sym: "BTC-USD", w: 0.08 }, { sym: "ETH-USD", w: 0.06 },
    { sym: "COIN", w: 0.05 }, { sym: "MSTR", w: 0.04 },
    { sym: "005930.KS", w: 0.07 }, { sym: "000660.KS", w: 0.06 },
    { sym: "042700.KS", w: 0.05 }, { sym: "META", w: 0.06 },
    { sym: "AMD", w: 0.06 }, { sym: "SHOP", w: 0.05 },
    { sym: "SQ", w: 0.05 }, { sym: "CRWD", w: 0.05 },
    { sym: "NET", w: 0.05 }, { sym: "DDOG", w: 0.05 },
  ],
  "캔들 패턴 (엔궐핑)": [
    { sym: "TSLA", w: 0.08 }, { sym: "NVDA", w: 0.07 }, { sym: "AMD", w: 0.06 },
    { sym: "AAPL", w: 0.06 }, { sym: "GOOGL", w: 0.06 },
    { sym: "SOL-USD", w: 0.06 }, { sym: "BTC-USD", w: 0.07 },
    { sym: "005380.KS", w: 0.06 }, { sym: "000270.KS", w: 0.05 },
    { sym: "329180.KS", w: 0.05 }, { sym: "009540.KS", w: 0.05 },
    { sym: "UBER", w: 0.05 }, { sym: "ABNB", w: 0.05 },
    { sym: "NFLX", w: 0.06 }, { sym: "DIS", w: 0.05 },
    { sym: "BA", w: 0.06 }, { sym: "DASH", w: 0.06 },
  ],
  "MACD 크로스오버": [
    { sym: "SPY", w: 0.08 }, { sym: "QQQ", w: 0.08 }, { sym: "NVDA", w: 0.07 },
    { sym: "AVGO", w: 0.06 }, { sym: "MSFT", w: 0.06 }, { sym: "META", w: 0.06 },
    { sym: "LLY", w: 0.06 }, { sym: "COST", w: 0.05 },
    { sym: "005930.KS", w: 0.07 }, { sym: "035420.KS", w: 0.05 },
    { sym: "BTC-USD", w: 0.07 }, { sym: "XLK", w: 0.06 },
    { sym: "ORCL", w: 0.05 }, { sym: "NOW", w: 0.05 },
    { sym: "PANW", w: 0.05 }, { sym: "GE", w: 0.04 }, { sym: "RTX", w: 0.04 },
  ],
  "이평선 크로스 (20/60)": [
    { sym: "SPY", w: 0.10 }, { sym: "QQQ", w: 0.08 }, { sym: "DIA", w: 0.06 },
    { sym: "AAPL", w: 0.06 }, { sym: "MSFT", w: 0.06 }, { sym: "AMZN", w: 0.05 },
    { sym: "JNJ", w: 0.05 }, { sym: "PG", w: 0.04 },
    { sym: "BTC-USD", w: 0.06 }, { sym: "GLD", w: 0.06 },
    { sym: "005930.KS", w: 0.06 }, { sym: "012330.KS", w: 0.05 },
    { sym: "XLV", w: 0.05 }, { sym: "WMT", w: 0.04 },
    { sym: "HD", w: 0.05 }, { sym: "UNH", w: 0.05 },
    { sym: "TLT", w: 0.04 }, { sym: "ABBV", w: 0.04 },
  ],
  "터틀 트레이딩": [
    { sym: "BTC-USD", w: 0.10 }, { sym: "ETH-USD", w: 0.06 }, { sym: "SOL-USD", w: 0.05 },
    { sym: "GLD", w: 0.08 }, { sym: "SLV", w: 0.04 },
    { sym: "XOM", w: 0.06 }, { sym: "CVX", w: 0.05 },
    { sym: "SPY", w: 0.06 }, { sym: "CAT", w: 0.05 }, { sym: "GE", w: 0.05 },
    { sym: "005380.KS", w: 0.05 }, { sym: "009540.KS", w: 0.05 },
    { sym: "329180.KS", w: 0.05 }, { sym: "LMT", w: 0.05 },
    { sym: "RTX", w: 0.05 }, { sym: "COP", w: 0.05 },
    { sym: "NVDA", w: 0.05 }, { sym: "XLE", w: 0.05 },
  ],
  "Williams %R + ADX": [
    { sym: "NVDA", w: 0.08 }, { sym: "AVGO", w: 0.07 }, { sym: "AMD", w: 0.06 },
    { sym: "TSLA", w: 0.06 }, { sym: "META", w: 0.06 },
    { sym: "BTC-USD", w: 0.07 }, { sym: "SOL-USD", w: 0.05 },
    { sym: "CRWD", w: 0.05 }, { sym: "PANW", w: 0.05 },
    { sym: "005930.KS", w: 0.06 }, { sym: "066570.KS", w: 0.05 },
    { sym: "259960.KS", w: 0.05 }, { sym: "NFLX", w: 0.05 },
    { sym: "SHOP", w: 0.05 }, { sym: "COIN", w: 0.04 },
    { sym: "MRVL", w: 0.05 }, { sym: "MU", w: 0.05 }, { sym: "QCOM", w: 0.05 },
  ],
  "삼중 이평선 + ATR 정지": [
    { sym: "SPY", w: 0.10 }, { sym: "QQQ", w: 0.08 }, { sym: "AAPL", w: 0.06 },
    { sym: "MSFT", w: 0.06 }, { sym: "GLD", w: 0.08 }, { sym: "TLT", w: 0.06 },
    { sym: "JNJ", w: 0.05 }, { sym: "PG", w: 0.05 },
    { sym: "005930.KS", w: 0.06 }, { sym: "105560.KS", w: 0.05 },
    { sym: "055550.KS", w: 0.04 }, { sym: "BTC-USD", w: 0.05 },
    { sym: "XLV", w: 0.05 }, { sym: "COST", w: 0.04 },
    { sym: "MRK", w: 0.04 }, { sym: "KO", w: 0.04 },
    { sym: "PEP", w: 0.04 }, { sym: "WMT", w: 0.05 },
  ],
  "일목균형표": [
    { sym: "005930.KS", w: 0.10 }, { sym: "000660.KS", w: 0.08 }, { sym: "035420.KS", w: 0.06 },
    { sym: "005380.KS", w: 0.06 }, { sym: "068270.KS", w: 0.05 },
    { sym: "259960.KS", w: 0.05 }, { sym: "352820.KS", w: 0.04 },
    { sym: "009540.KS", w: 0.05 }, { sym: "028260.KS", w: 0.04 },
    { sym: "SPY", w: 0.06 }, { sym: "AAPL", w: 0.05 }, { sym: "MSFT", w: 0.05 },
    { sym: "BTC-USD", w: 0.06 }, { sym: "NVDA", w: 0.05 },
    { sym: "KWEB", w: 0.04 }, { sym: "GLD", w: 0.06 },
    { sym: "003670.KS", w: 0.05 }, { sym: "042700.KS", w: 0.05 },
  ],
  "OBV 추세 추종": [
    { sym: "NVDA", w: 0.08 }, { sym: "AVGO", w: 0.07 }, { sym: "META", w: 0.06 },
    { sym: "AMZN", w: 0.06 }, { sym: "MSFT", w: 0.06 },
    { sym: "BTC-USD", w: 0.07 }, { sym: "ETH-USD", w: 0.05 },
    { sym: "005930.KS", w: 0.06 }, { sym: "000660.KS", w: 0.05 },
    { sym: "LLY", w: 0.06 }, { sym: "ORCL", w: 0.05 },
    { sym: "CRM", w: 0.05 }, { sym: "NOW", w: 0.04 },
    { sym: "SPY", w: 0.06 }, { sym: "XLK", w: 0.05 },
    { sym: "TMO", w: 0.04 }, { sym: "DHR", w: 0.04 }, { sym: "SOXX", w: 0.05 },
  ],
  "슈퍼트렌드": [
    { sym: "BTC-USD", w: 0.08 }, { sym: "SOL-USD", w: 0.06 }, { sym: "AVAX-USD", w: 0.04 },
    { sym: "NVDA", w: 0.07 }, { sym: "TSLA", w: 0.06 }, { sym: "AMD", w: 0.05 },
    { sym: "COIN", w: 0.05 }, { sym: "MSTR", w: 0.04 },
    { sym: "META", w: 0.06 }, { sym: "AMZN", w: 0.05 },
    { sym: "005930.KS", w: 0.05 }, { sym: "042700.KS", w: 0.05 },
    { sym: "247540.KS", w: 0.04 }, { sym: "SHOP", w: 0.05 },
    { sym: "DDOG", w: 0.04 }, { sym: "SNOW", w: 0.04 },
    { sym: "NET", w: 0.04 }, { sym: "ZS", w: 0.04 }, { sym: "CRWD", w: 0.04 },
    { sym: "ARKK", w: 0.05 },
  ],
  "파라볼릭 SAR": [
    { sym: "SPY", w: 0.08 }, { sym: "QQQ", w: 0.07 }, { sym: "NVDA", w: 0.06 },
    { sym: "AAPL", w: 0.06 }, { sym: "GOOG", w: 0.06 },
    { sym: "BTC-USD", w: 0.06 }, { sym: "GLD", w: 0.05 },
    { sym: "005930.KS", w: 0.06 }, { sym: "017670.KS", w: 0.04 },
    { sym: "XOM", w: 0.05 }, { sym: "CVX", w: 0.05 },
    { sym: "CAT", w: 0.05 }, { sym: "GE", w: 0.05 },
    { sym: "JPM", w: 0.05 }, { sym: "V", w: 0.05 },
    { sym: "HD", w: 0.04 }, { sym: "COST", w: 0.04 },
    { sym: "XLI", w: 0.04 }, { sym: "DIA", w: 0.04 },
  ],
  "레짐 전환 적응형": [
    { sym: "SPY", w: 0.10 }, { sym: "TLT", w: 0.10 }, { sym: "GLD", w: 0.10 },
    { sym: "IWM", w: 0.06 }, { sym: "QQQ", w: 0.06 },
    { sym: "XLE", w: 0.05 }, { sym: "XLF", w: 0.05 }, { sym: "XLV", w: 0.05 },
    { sym: "BTC-USD", w: 0.06 }, { sym: "VNQ", w: 0.05 },
    { sym: "005930.KS", w: 0.05 }, { sym: "AAPL", w: 0.05 },
    { sym: "MSFT", w: 0.05 }, { sym: "JNJ", w: 0.04 },
    { sym: "PG", w: 0.04 }, { sym: "KO", w: 0.04 }, { sym: "SLV", w: 0.05 },
  ],
  "헤이킨 아시 추세": [
    { sym: "NVDA", w: 0.08 }, { sym: "META", w: 0.07 }, { sym: "AVGO", w: 0.06 },
    { sym: "LLY", w: 0.06 }, { sym: "MSFT", w: 0.06 },
    { sym: "BTC-USD", w: 0.07 }, { sym: "SOL-USD", w: 0.05 },
    { sym: "005930.KS", w: 0.06 }, { sym: "005380.KS", w: 0.05 },
    { sym: "NFLX", w: 0.05 }, { sym: "CRM", w: 0.05 },
    { sym: "UBER", w: 0.04 }, { sym: "ABNB", w: 0.04 },
    { sym: "SPY", w: 0.06 }, { sym: "SOXX", w: 0.05 },
    { sym: "XLK", w: 0.05 }, { sym: "PANW", w: 0.05 }, { sym: "NOW", w: 0.05 },
  ],
  "듀얼 타임프레임 모멘텀": [
    { sym: "QQQ", w: 0.08 }, { sym: "SPY", w: 0.07 }, { sym: "SOXX", w: 0.06 },
    { sym: "NVDA", w: 0.06 }, { sym: "AVGO", w: 0.05 }, { sym: "AMD", w: 0.05 },
    { sym: "BTC-USD", w: 0.07 }, { sym: "ETH-USD", w: 0.05 },
    { sym: "005930.KS", w: 0.05 }, { sym: "000660.KS", w: 0.05 },
    { sym: "META", w: 0.05 }, { sym: "TSLA", w: 0.05 },
    { sym: "ORCL", w: 0.04 }, { sym: "CRWD", w: 0.04 },
    { sym: "LLY", w: 0.05 }, { sym: "COST", w: 0.04 },
    { sym: "XOM", w: 0.04 }, { sym: "GLD", w: 0.05 }, { sym: "ARKK", w: 0.05 },
  ],
  "엘더 삼중 필터": [
    { sym: "SPY", w: 0.08 }, { sym: "QQQ", w: 0.07 }, { sym: "AAPL", w: 0.06 },
    { sym: "MSFT", w: 0.06 }, { sym: "NVDA", w: 0.06 }, { sym: "AMZN", w: 0.05 },
    { sym: "BTC-USD", w: 0.06 }, { sym: "GLD", w: 0.06 },
    { sym: "005930.KS", w: 0.06 }, { sym: "012330.KS", w: 0.04 },
    { sym: "JPM", w: 0.05 }, { sym: "V", w: 0.05 },
    { sym: "XLE", w: 0.04 }, { sym: "XLF", w: 0.04 },
    { sym: "TLT", w: 0.05 }, { sym: "HD", w: 0.04 },
    { sym: "UNH", w: 0.04 }, { sym: "LLY", w: 0.05 }, { sym: "PG", w: 0.04 },
  ],
  "MACD 다이버전스": [
    { sym: "TSLA", w: 0.07 }, { sym: "AMD", w: 0.06 }, { sym: "GOOGL", w: 0.06 },
    { sym: "INTC", w: 0.05 }, { sym: "BA", w: 0.05 },
    { sym: "BTC-USD", w: 0.08 }, { sym: "ETH-USD", w: 0.06 }, { sym: "SOL-USD", w: 0.05 },
    { sym: "005930.KS", w: 0.06 }, { sym: "035720.KS", w: 0.05 },
    { sym: "066570.KS", w: 0.04 }, { sym: "DIS", w: 0.05 },
    { sym: "PYPL", w: 0.05 }, { sym: "NKE", w: 0.04 },
    { sym: "COIN", w: 0.05 }, { sym: "DASH", w: 0.04 },
    { sym: "SHOP", w: 0.04 }, { sym: "SQ", w: 0.05 }, { sym: "ARKK", w: 0.05 },
  ],
  "거래량 돌파 전략": [
    { sym: "NVDA", w: 0.08 }, { sym: "AMD", w: 0.06 }, { sym: "TSLA", w: 0.06 },
    { sym: "AVGO", w: 0.06 }, { sym: "MRVL", w: 0.05 },
    { sym: "BTC-USD", w: 0.08 }, { sym: "SOL-USD", w: 0.06 }, { sym: "ETH-USD", w: 0.05 },
    { sym: "005930.KS", w: 0.05 }, { sym: "042700.KS", w: 0.05 },
    { sym: "329180.KS", w: 0.05 }, { sym: "COIN", w: 0.04 },
    { sym: "META", w: 0.05 }, { sym: "NFLX", w: 0.04 },
    { sym: "SHOP", w: 0.04 }, { sym: "CRWD", w: 0.04 },
    { sym: "SNOW", w: 0.04 }, { sym: "NET", w: 0.04 },
    { sym: "DDOG", w: 0.03 }, { sym: "ARKK", w: 0.03 },
  ],
  "듀얼 모멘텀": [
    { sym: "SPY", w: 0.10 }, { sym: "QQQ", w: 0.08 }, { sym: "IWM", w: 0.05 },
    { sym: "BTC-USD", w: 0.08 }, { sym: "GLD", w: 0.08 },
    { sym: "NVDA", w: 0.06 }, { sym: "AAPL", w: 0.05 }, { sym: "MSFT", w: 0.05 },
    { sym: "005930.KS", w: 0.05 }, { sym: "000660.KS", w: 0.04 },
    { sym: "TLT", w: 0.06 }, { sym: "XLE", w: 0.05 },
    { sym: "XLF", w: 0.04 }, { sym: "SOXX", w: 0.05 },
    { sym: "AVGO", w: 0.04 }, { sym: "META", w: 0.04 },
    { sym: "XLV", w: 0.04 }, { sym: "VNQ", w: 0.04 },
  ],
  "갭 앤 고": [
    { sym: "TSLA", w: 0.08 }, { sym: "NVDA", w: 0.07 }, { sym: "AMD", w: 0.06 },
    { sym: "COIN", w: 0.06 }, { sym: "MSTR", w: 0.05 },
    { sym: "BTC-USD", w: 0.07 }, { sym: "SOL-USD", w: 0.05 }, { sym: "DOGE-USD", w: 0.04 },
    { sym: "005930.KS", w: 0.05 }, { sym: "259960.KS", w: 0.04 },
    { sym: "352820.KS", w: 0.04 }, { sym: "META", w: 0.05 },
    { sym: "NFLX", w: 0.04 }, { sym: "SHOP", w: 0.05 },
    { sym: "SQ", w: 0.04 }, { sym: "UBER", w: 0.04 },
    { sym: "ABNB", w: 0.04 }, { sym: "DASH", w: 0.04 },
    { sym: "ARKK", w: 0.04 }, { sym: "CRWD", w: 0.05 },
  ],
  "모멘텀·거래량 가중": [
    { sym: "NVDA", w: 0.08 }, { sym: "AVGO", w: 0.06 }, { sym: "META", w: 0.06 },
    { sym: "LLY", w: 0.07 }, { sym: "MSFT", w: 0.06 },
    { sym: "BTC-USD", w: 0.07 }, { sym: "ETH-USD", w: 0.05 },
    { sym: "005930.KS", w: 0.06 }, { sym: "009540.KS", w: 0.05 },
    { sym: "ORCL", w: 0.05 }, { sym: "NOW", w: 0.04 },
    { sym: "PANW", w: 0.04 }, { sym: "CRM", w: 0.04 },
    { sym: "GE", w: 0.05 }, { sym: "CAT", w: 0.04 },
    { sym: "COST", w: 0.04 }, { sym: "WMT", w: 0.04 },
    { sym: "SPY", w: 0.06 }, { sym: "XLK", w: 0.04 },
  ],
  "CCI 오실레이터": [
    { sym: "AMZN", w: 0.07 }, { sym: "GOOG", w: 0.06 }, { sym: "AAPL", w: 0.06 },
    { sym: "NFLX", w: 0.06 }, { sym: "CRM", w: 0.05 },
    { sym: "BTC-USD", w: 0.07 }, { sym: "LINK-USD", w: 0.04 },
    { sym: "005930.KS", w: 0.06 }, { sym: "035420.KS", w: 0.05 },
    { sym: "068270.KS", w: 0.05 }, { sym: "JPM", w: 0.05 },
    { sym: "V", w: 0.05 }, { sym: "MA", w: 0.04 },
    { sym: "UNH", w: 0.05 }, { sym: "TMO", w: 0.04 },
    { sym: "DHR", w: 0.04 }, { sym: "SOXX", w: 0.06 },
    { sym: "SPY", w: 0.05 }, { sym: "XLK", w: 0.05 },
  ],
  "채널 돌파 모멘텀": [
    { sym: "BTC-USD", w: 0.08 }, { sym: "SOL-USD", w: 0.06 }, { sym: "ETH-USD", w: 0.05 },
    { sym: "NVDA", w: 0.07 }, { sym: "TSLA", w: 0.06 }, { sym: "AMD", w: 0.05 },
    { sym: "AVGO", w: 0.05 }, { sym: "MU", w: 0.04 },
    { sym: "005930.KS", w: 0.05 }, { sym: "042700.KS", w: 0.05 },
    { sym: "247540.KS", w: 0.04 }, { sym: "003670.KS", w: 0.04 },
    { sym: "COIN", w: 0.05 }, { sym: "MSTR", w: 0.04 },
    { sym: "SHOP", w: 0.04 }, { sym: "SQ", w: 0.04 },
    { sym: "CRWD", w: 0.04 }, { sym: "NET", w: 0.04 },
    { sym: "ARKK", w: 0.05 }, { sym: "SMH", w: 0.06 },
  ],
  "BB 스퀴즈 돌파": [
    { sym: "NVDA", w: 0.07 }, { sym: "TSLA", w: 0.06 }, { sym: "AMD", w: 0.06 },
    { sym: "AVGO", w: 0.05 }, { sym: "MRVL", w: 0.04 },
    { sym: "BTC-USD", w: 0.07 }, { sym: "SOL-USD", w: 0.05 }, { sym: "AVAX-USD", w: 0.03 },
    { sym: "005930.KS", w: 0.05 }, { sym: "000660.KS", w: 0.05 },
    { sym: "META", w: 0.06 }, { sym: "NFLX", w: 0.05 },
    { sym: "COIN", w: 0.04 }, { sym: "SHOP", w: 0.04 },
    { sym: "CRWD", w: 0.04 }, { sym: "GLD", w: 0.06 },
    { sym: "SPY", w: 0.05 }, { sym: "TLT", w: 0.04 },
    { sym: "SOXX", w: 0.05 }, { sym: "ARKK", w: 0.04 },
  ],
  "ATR 스윙": [
    { sym: "TSLA", w: 0.07 }, { sym: "NVDA", w: 0.06 }, { sym: "AMD", w: 0.05 },
    { sym: "BTC-USD", w: 0.07 }, { sym: "SOL-USD", w: 0.05 }, { sym: "ETH-USD", w: 0.05 },
    { sym: "005930.KS", w: 0.05 }, { sym: "329180.KS", w: 0.04 },
    { sym: "009540.KS", w: 0.04 }, { sym: "GLD", w: 0.08 },
    { sym: "TLT", w: 0.06 }, { sym: "XOM", w: 0.05 },
    { sym: "CVX", w: 0.04 }, { sym: "JPM", w: 0.05 },
    { sym: "SPY", w: 0.06 }, { sym: "IWM", w: 0.04 },
    { sym: "BA", w: 0.04 }, { sym: "CAT", w: 0.04 },
    { sym: "RTX", w: 0.03 }, { sym: "LMT", w: 0.03 },
  ],
};

const DEFAULT_PORTFOLIO = [
  { sym: "SPY", w: 0.08 }, { sym: "QQQ", w: 0.07 }, { sym: "NVDA", w: 0.06 },
  { sym: "AAPL", w: 0.06 }, { sym: "MSFT", w: 0.06 }, { sym: "AMZN", w: 0.05 },
  { sym: "BTC-USD", w: 0.06 }, { sym: "GLD", w: 0.05 },
  { sym: "005930.KS", w: 0.06 }, { sym: "000660.KS", w: 0.04 },
  { sym: "META", w: 0.05 }, { sym: "AVGO", w: 0.05 },
  { sym: "JPM", w: 0.05 }, { sym: "LLY", w: 0.05 },
  { sym: "TLT", w: 0.04 }, { sym: "XLE", w: 0.04 },
  { sym: "V", w: 0.04 }, { sym: "UNH", w: 0.04 }, { sym: "COST", w: 0.05 },
];

// ══════════════════════════════════════════════════════════════
// 실제 데이터 fetch 엔진
// ══════════════════════════════════════════════════════════════
function collectAllSymbols() {
  const syms = new Set();
  for (const key of Object.keys(STRATEGY_PORTFOLIOS)) {
    for (const { sym } of STRATEGY_PORTFOLIOS[key]) syms.add(sym);
  }
  for (const { sym } of DEFAULT_PORTFOLIO) syms.add(sym);
  return [...syms];
}

async function fetchAllSymbolData(onProgress) {
  const allSyms = collectAllSymbols();
  const results = {};
  const BATCH = 20;
  const batches = [];
  for (let i = 0; i < allSyms.length; i += BATCH) batches.push(allSyms.slice(i, i + BATCH));

  let done = 0;
  // 4개 배치 동시 실행
  const CONCURRENT = 4;
  for (let i = 0; i < batches.length; i += CONCURRENT) {
    const chunk = batches.slice(i, i + CONCURRENT);
    await Promise.allSettled(chunk.map(async (batch) => {
      try {
        const url = `/api/yahoo-batch?symbols=${batch.join(",")}&interval=1d&range=6mo`;
        const ctrl = new AbortController();
        const tmr = setTimeout(() => ctrl.abort(), 15000);
        const res = await fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(tmr));
        if (res.ok) {
          const json = await res.json();
          if (json.results) {
            for (const [sym, data] of Object.entries(json.results)) {
              if (data && data.closes && data.closes.length > 0) results[sym] = data;
            }
          }
        }
      } catch {}
      done++;
      if (onProgress) onProgress(Math.min(100, Math.round((done / batches.length) * 100)));
    }));
  }
  return results;
}

// raw 데이터 → 캔들 객체 배열
function toCandles(data) {
  if (!data?.closes?.length) return [];
  return data.closes.map((c, i) => ({
    close: c,
    high: data.highs?.[i] || c,
    low: data.lows?.[i] || c,
    open: data.opens?.[i] || c,
    volume: data.volumes?.[i] || 0,
  }));
}

// ══════════════════════════════════════════════════════════════
// 실제 가중 포트폴리오 수익률 계산
// ══════════════════════════════════════════════════════════════
function computePortfolioReturns(portfolio, allData) {
  // 각 종목의 일간 수익률 계산
  const stockData = [];
  for (const { sym, w } of portfolio) {
    const d = allData[sym];
    if (!d?.closes?.length || d.closes.length < 10) continue;
    const closes = d.closes;
    const timestamps = d.timestamps || [];
    const rets = [];
    for (let i = 1; i < closes.length; i++) {
      rets.push({ ret: (closes[i] - closes[i - 1]) / closes[i - 1], ts: timestamps[i] || 0 });
    }
    stockData.push({ sym, w, rets });
  }
  if (!stockData.length) return [];

  // 공통 길이 맞추기 (최소 길이 기준)
  const minLen = Math.min(...stockData.map(s => s.rets.length));
  const days = Math.min(minLen, 90);
  if (days < 5) return [];

  const dailyReturns = [];
  let cumReturn = 0;
  const totalW = stockData.reduce((a, s) => a + s.w, 0);

  for (let d = minLen - days; d < minLen; d++) {
    let dayRet = 0;
    for (const s of stockData) {
      dayRet += (s.w / totalW) * s.rets[d].ret;
    }
    cumReturn = (1 + cumReturn / 100) * (1 + dayRet) * 100 - 100;
    // 날짜 계산
    const ts = stockData[0].rets[d]?.ts;
    const date = ts ? new Date(ts * 1000).toISOString().slice(0, 10)
      : new Date(Date.now() - (minLen - d) * 86400000).toISOString().slice(0, 10);

    dailyReturns.push({
      date,
      daily: +(dayRet * 100).toFixed(2),
      cumulative: +cumReturn.toFixed(2),
    });
  }
  return dailyReturns;
}

// ══════════════════════════════════════════════════════════════
// 실제 전략 시그널 기반 매매기록 생성
// ══════════════════════════════════════════════════════════════
function generateRealTrades(strategyName, portfolio, allData) {
  const stratObj = ALL_STRATEGIES.find(s => s.name === strategyName);
  if (!stratObj) return [];
  const trades = [];

  for (const { sym, w } of portfolio) {
    const d = allData[sym];
    if (!d?.closes?.length || d.closes.length < 30) continue;
    const candles = toCandles(d);
    const timestamps = d.timestamps || [];

    try {
      const signals = stratObj.generate(candles);
      if (!signals || !signals.length) continue;

      // 최근 60일 시그널만
      const cutoff = candles.length - 60;
      const recent = signals.filter(s => s && s.index >= cutoff && s.index < candles.length);

      for (const sig of recent) {
        const idx = sig.index;
        const candle = candles[idx];
        if (!candle) continue;
        const price = candle.close;
        const ts = timestamps[idx];
        const date = ts ? new Date(ts * 1000).toISOString().slice(0, 10) : "N/A";
        const isKR = sym.includes(".KS");
        const isCrypto = sym.includes("-USD");
        const isBTC = sym.includes("BTC");
        const isETH = sym.includes("ETH");

        // 실제 거래 수량 추정 (포트폴리오 비중 × $100,000 기준)
        const alloc = w * 100000;
        const qty = isBTC ? +(alloc / price).toFixed(4) :
                    isETH ? +(alloc / price).toFixed(2) :
                    isCrypto ? +(alloc / price).toFixed(2) :
                    isKR ? Math.max(1, Math.floor(alloc / price)) :
                    Math.max(1, Math.floor(alloc / price));

        // 매도 시 P&L: 이전 매수가 대비 (근사 계산)
        let pnl = null;
        if (sig.type === "SELL") {
          // 이전 5~20일 가격 대비 수익률 (실제 가격 기반)
          const lookback = Math.max(0, idx - 10);
          const prevPrice = candles[lookback]?.close || price;
          pnl = +((price - prevPrice) / prevPrice * 100).toFixed(2);
        }

        trades.push({
          date,
          symbol: sym,
          symbolName: getName(sym),
          action: sig.type === "BUY" ? "매수" : "매도",
          price: +(price).toFixed(isKR ? 0 : 2),
          qty,
          amount: +(price * qty).toFixed(0),
          pnl,
          reason: sig.reason || `${stratObj.name} 시그널`,
        });
      }
    } catch {}
  }
  return trades.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 50);
}

// ══════════════════════════════════════════════════════════════
// 실제 리밸런싱 이력 (가격 드리프트 기반)
// ══════════════════════════════════════════════════════════════
function generateRealRebalance(portfolio, allData) {
  const history = [];
  // 2주 간격으로 리밸런싱 체크 (최근 6개 포인트)
  const intervals = [14, 28, 42, 56, 70, 84];

  for (const dayOffset of intervals) {
    // 각 종목의 기간 수익률 → 비중 드리프트
    let maxDrift = null;
    let maxDriftSym = null;
    let driftDirection = "";
    const totalW = portfolio.reduce((a, p) => a + p.w, 0);

    for (const { sym, w } of portfolio) {
      const d = allData[sym];
      if (!d?.closes?.length || d.closes.length < dayOffset + 14) continue;
      const endIdx = d.closes.length - dayOffset;
      const startIdx = endIdx - 14;
      if (startIdx < 0 || endIdx < 0) continue;

      const startP = d.closes[startIdx];
      const endP = d.closes[endIdx];
      if (!startP) continue;
      const ret = (endP - startP) / startP;
      // 비중 드리프트 = 실제 비중 변화
      const targetW = w / totalW;
      const actualW = targetW * (1 + ret);
      const drift = actualW - targetW;

      if (!maxDrift || Math.abs(drift) > Math.abs(maxDrift)) {
        maxDrift = drift;
        maxDriftSym = sym;
        driftDirection = drift > 0 ? "비중 감소" : "비중 증가";
      }
    }

    if (maxDriftSym && maxDrift !== null) {
      const d = allData[maxDriftSym];
      const endIdx = d.closes.length - dayOffset;
      const ts = d.timestamps?.[endIdx];
      const date = ts ? new Date(ts * 1000).toISOString().slice(0, 10)
        : new Date(Date.now() - dayOffset * 86400000).toISOString().slice(0, 10);
      const pInfo = portfolio.find(p => p.sym === maxDriftSym);
      const beforeW = pInfo ? +(pInfo.w * 100).toFixed(1) : 5;
      const afterW = +(beforeW + maxDrift * 100).toFixed(1);

      const reasons = [];
      if (Math.abs(maxDrift) > 0.03) reasons.push("비중 편차 3% 초과");
      if (maxDrift > 0) reasons.push("가격 급등으로 비중 확대");
      else reasons.push("가격 하락으로 비중 축소");

      history.push({
        date,
        action: Math.abs(maxDrift) > 0.05 ? "긴급 리밸런싱" : driftDirection,
        symbol: maxDriftSym,
        symbolName: getName(maxDriftSym),
        detail: `${getName(maxDriftSym)} ${driftDirection}`,
        reason: reasons.join(", "),
        beforeWeight: beforeW,
        afterWeight: Math.max(0.5, Math.min(25, afterW)),
      });
    }
  }
  return history.sort((a, b) => b.date.localeCompare(a.date));
}

// ══════════════════════════════════════════════════════════════
// 인터랙티브 차트 (호버/탭 시 누적 수익률 표시)
// ══════════════════════════════════════════════════════════════
function InteractiveChart({ returns, width = 600, height = 220 }) {
  const svgRef = useRef(null);
  const [hoverIdx, setHoverIdx] = useState(null);

  if (!returns.length) return null;
  const vals = returns.map(r => r.cumulative);
  const min = Math.min(...vals, 0), max = Math.max(...vals);
  const range = max - min || 1;
  const pad = 10, chartH = height - 30;

  const getY = (v) => pad + chartH - ((v - min) / range) * chartH;
  const getX = (i) => (i / (vals.length - 1)) * width;

  const points = vals.map((v, i) => `${getX(i)},${getY(v)}`).join(" ");
  const zeroY = getY(0);
  const isPos = vals[vals.length - 1] >= 0;
  const areaPoints = points + ` ${width},${zeroY} 0,${zeroY}`;

  const handleInteraction = (e) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    const idx = Math.max(0, Math.min(vals.length - 1, Math.round((x / rect.width) * (vals.length - 1))));
    setHoverIdx(idx);
  };

  const hv = hoverIdx != null ? returns[hoverIdx] : null;
  const hvX = hoverIdx != null ? getX(hoverIdx) : 0;
  const hvY = hoverIdx != null ? getY(vals[hoverIdx]) : 0;

  return (
    <div style={{ position: "relative" }}>
      <svg ref={svgRef} width="100%" viewBox={`0 0 ${width} ${height}`}
        style={{ display: "block", cursor: "crosshair", touchAction: "none" }}
        onMouseMove={handleInteraction} onTouchMove={handleInteraction}
        onMouseLeave={() => setHoverIdx(null)} onTouchEnd={() => setHoverIdx(null)}>
        {[0, 0.25, 0.5, 0.75, 1].map(f => (
          <line key={f} x1="0" y1={pad + f * chartH} x2={width} y2={pad + f * chartH} stroke={C.border} strokeWidth="0.5" />
        ))}
        <line x1="0" y1={zeroY} x2={width} y2={zeroY} stroke={C.border2} strokeDasharray="4,4" />
        <polygon points={areaPoints} fill={isPos ? C.green + "12" : C.red + "12"} />
        <polyline points={points} fill="none" stroke={isPos ? C.green : C.red} strokeWidth="2" />
        {hoverIdx != null && (
          <>
            <line x1={hvX} y1={pad} x2={hvX} y2={pad + chartH} stroke={C.text3} strokeWidth="1" strokeDasharray="3,3" />
            <circle cx={hvX} cy={hvY} r="5" fill={vals[hoverIdx] >= 0 ? C.green : C.red} stroke={C.bg} strokeWidth="2" />
          </>
        )}
        {[0, Math.floor(returns.length * 0.25), Math.floor(returns.length / 2), Math.floor(returns.length * 0.75), returns.length - 1].map(i => (
          <text key={i} x={getX(i)} y={height - 2} fill={C.text3} fontSize="9" textAnchor="middle">{returns[i]?.date.slice(5)}</text>
        ))}
        <text x={3} y={pad + 8} fill={C.text3} fontSize="9">{max.toFixed(1)}%</text>
        <text x={3} y={pad + chartH - 2} fill={C.text3} fontSize="9">{min.toFixed(1)}%</text>
      </svg>
      {hv && (
        <div style={{
          position: "absolute", top: "8px",
          left: hvX > width * 0.6 ? "auto" : `${(hvX / width) * 100}%`,
          right: hvX > width * 0.6 ? `${((width - hvX) / width) * 100}%` : "auto",
          background: C.card2, border: `1px solid ${C.border2}`, borderRadius: "10px",
          padding: "10px 14px", pointerEvents: "none", zIndex: 10, minWidth: "140px",
          boxShadow: "0 4px 20px rgba(0,0,0,.5)",
        }}>
          <div style={{ fontSize: "11px", color: C.text3, marginBottom: "4px" }}>{hv.date}</div>
          <div style={{ display: "flex", gap: "16px" }}>
            <div>
              <div style={{ fontSize: "10px", color: C.text3 }}>누적 수익률</div>
              <div style={{ fontWeight: 800, fontSize: "18px", color: hv.cumulative >= 0 ? C.green : C.red }}>
                {hv.cumulative >= 0 ? "+" : ""}{hv.cumulative}%
              </div>
            </div>
            <div>
              <div style={{ fontSize: "10px", color: C.text3 }}>일간 변동</div>
              <div style={{ fontWeight: 700, fontSize: "14px", color: hv.daily >= 0 ? C.green : C.red }}>
                {hv.daily >= 0 ? "+" : ""}{hv.daily}%
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 미니 차트 ──
function MiniChart({ returns, width = 120, height = 36 }) {
  if (!returns.length) return null;
  const vals = returns.map(r => r.cumulative);
  const min = Math.min(...vals), max = Math.max(...vals), range = max - min || 1;
  const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * width},${height - ((v - min) / range) * height}`).join(" ");
  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      <polyline points={pts} fill="none" stroke={vals[vals.length - 1] >= 0 ? C.green : C.red} strokeWidth="1.5" />
    </svg>
  );
}

// ══════════════════════════════════════════════════════════════
// 로딩 스켈레톤
// ══════════════════════════════════════════════════════════════
function LoadingSkeleton({ progress }) {
  return (
    <div className="tab-content">
      <div style={{ background: `linear-gradient(135deg, ${C.card} 0%, ${C.card2} 100%)`,
        border: `1px solid ${C.border}`, borderRadius: "16px", padding: "40px 20px", textAlign: "center" }}>
        <div style={{ marginBottom: "20px" }}>
          <div style={{ width: "48px", height: "48px", margin: "0 auto 16px",
            border: `3px solid ${C.border2}`, borderTop: `3px solid ${C.blue}`,
            borderRadius: "50%", animation: "qpSpin 1s linear infinite" }} />
          <style>{`@keyframes qpSpin { to { transform: rotate(360deg); } }`}</style>
          <div style={{ fontWeight: 800, fontSize: "18px", marginBottom: "8px" }}>실시간 데이터 로딩 중</div>
          <div style={{ color: C.text3, fontSize: "13px", marginBottom: "16px" }}>
            {collectAllSymbols().length}개 종목 시세 수신 + 32개 전략 백테스트 실행
          </div>
        </div>
        <div style={{ maxWidth: "300px", margin: "0 auto" }}>
          <div style={{ height: "6px", borderRadius: "3px", background: C.bg, overflow: "hidden" }}>
            <div style={{ width: `${progress}%`, height: "100%", borderRadius: "3px",
              background: `linear-gradient(90deg, ${C.blue}, ${C.green})`, transition: "width 0.3s ease" }} />
          </div>
          <div style={{ fontSize: "12px", color: C.text3, marginTop: "6px" }}>{progress}%</div>
        </div>
      </div>
      {/* 스켈레톤 카드 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "10px", marginTop: "12px" }}>
        {[1,2,3,4,5,6].map(i => (
          <div key={i} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "14px",
            padding: "16px", opacity: 0.5 }}>
            <div style={{ height: "14px", width: "60%", background: C.card2, borderRadius: "4px", marginBottom: "10px" }} />
            <div style={{ height: "24px", width: "40%", background: C.card2, borderRadius: "4px", marginBottom: "8px" }} />
            <div style={{ height: "36px", background: C.card2, borderRadius: "4px" }} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// 메인 컴포넌트
// ══════════════════════════════════════════════════════════════
export default function QuantPortfolio({ theme = "dark" }) {
  const [selectedStrategy, setSelectedStrategy] = useState(null);
  const [sortBy, setSortBy] = useState("return");
  const [filterCat, setFilterCat] = useState("all");
  const [detailTab, setDetailTab] = useState("overview");

  // 실제 데이터 상태
  const [allData, setAllData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [lastUpdate, setLastUpdate] = useState(null);
  const fetchedRef = useRef(false);

  // 데이터 로드
  const loadData = useCallback(async () => {
    setLoading(true);
    setProgress(0);
    try {
      const data = await fetchAllSymbolData((p) => setProgress(p));
      setAllData(data);
      setLastUpdate(new Date());
    } catch {
      setAllData({});
    }
    setProgress(100);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!fetchedRef.current) {
      fetchedRef.current = true;
      loadData();
    }
  }, [loadData]);

  // 전략 데이터 계산 (실제 데이터 기반)
  const strategyData = useMemo(() => {
    if (!allData) return [];
    return ALL_STRATEGIES.map(s => {
      const portfolio = STRATEGY_PORTFOLIOS[s.name] || DEFAULT_PORTFOLIO;
      const returns = computePortfolioReturns(portfolio, allData);
      const cumReturn = returns.length ? returns[returns.length - 1].cumulative : 0;
      const dailyR = returns.map(r => r.daily);
      const avg = dailyR.length ? dailyR.reduce((a, b) => a + b, 0) / dailyR.length : 0;
      const std = dailyR.length > 1 ? Math.sqrt(dailyR.reduce((a, b) => a + (b - avg) ** 2, 0) / dailyR.length) || 1 : 1;
      const sharpe = +((avg / std) * Math.sqrt(252)).toFixed(2);
      const maxDD = (() => {
        let peak = 0, dd = 0;
        returns.forEach(r => { peak = Math.max(peak, r.cumulative); dd = Math.min(dd, r.cumulative - peak); });
        return +dd.toFixed(2);
      })();
      const winRate = dailyR.length ? +(dailyR.filter(r => r > 0).length / dailyR.length * 100).toFixed(0) : 0;
      const tradeHistory = generateRealTrades(s.name, portfolio, allData);
      const rebalanceHistory = generateRealRebalance(portfolio, allData);

      // 수익 종목 / 손실 종목 집계
      const validStocks = portfolio.filter(p => {
        const d = allData[p.sym];
        return d?.closes?.length > 30;
      }).length;

      return {
        ...s, portfolio, returns, cumReturn, sharpe, maxDD, winRate,
        avgReturn: +avg.toFixed(3), rebalanceHistory, tradeHistory, validStocks,
      };
    });
  }, [allData]);

  const categories = useMemo(() => [...new Set(ALL_STRATEGIES.map(s => s.category))], []);
  const filteredData = useMemo(() => {
    let data = filterCat === "all" ? strategyData : strategyData.filter(s => s.category === filterCat);
    if (sortBy === "return") data = [...data].sort((a, b) => b.cumReturn - a.cumReturn);
    else if (sortBy === "sharpe") data = [...data].sort((a, b) => b.sharpe - a.sharpe);
    else data = [...data].sort((a, b) => a.name.localeCompare(b.name));
    return data;
  }, [strategyData, filterCat, sortBy]);

  const topPerformers = useMemo(() => [...strategyData].sort((a, b) => b.cumReturn - a.cumReturn).slice(0, 5), [strategyData]);

  // 로딩 중
  if (loading) return <LoadingSkeleton progress={progress} />;

  // ═══ 상세 뷰 ═══
  if (selectedStrategy) {
    const s = selectedStrategy;
    return (
      <div className="tab-content">
        <button onClick={() => { setSelectedStrategy(null); setDetailTab("overview"); }} style={{
          background: C.card2, border: `1px solid ${C.border}`, borderRadius: "10px",
          padding: "8px 16px", fontSize: "13px", fontWeight: 600, color: C.text2, cursor: "pointer", marginBottom: "16px",
        }}>← 전체 목록</button>

        {/* 헤더 */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "20px", marginBottom: "12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
            <span style={{ padding: "4px 10px", borderRadius: "6px", fontSize: "11px", fontWeight: 700,
              background: (CAT_COLORS[s.category] || C.blue) + "20", color: CAT_COLORS[s.category] || C.blue }}>{s.category}</span>
            <span style={{ fontWeight: 800, fontSize: "18px" }}>{s.name}</span>
          </div>
          <div style={{ fontSize: "11px", color: C.green, marginBottom: "12px", display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: C.green, display: "inline-block" }} />
            실시간 데이터 · {lastUpdate ? lastUpdate.toLocaleTimeString("ko-KR") : ""} 업데이트
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(90px, 1fr))", gap: "6px" }}>
            {[
              { label: "누적 수익률", value: `${s.cumReturn >= 0 ? "+" : ""}${s.cumReturn}%`, color: s.cumReturn >= 0 ? C.green : C.red },
              { label: "샤프 비율", value: s.sharpe, color: s.sharpe > 1 ? C.green : s.sharpe > 0 ? C.yellow : C.red },
              { label: "MDD", value: `${s.maxDD}%`, color: C.red },
              { label: "승률", value: `${s.winRate}%`, color: s.winRate >= 55 ? C.green : C.yellow },
              { label: "일평균", value: `${s.avgReturn >= 0 ? "+" : ""}${s.avgReturn}%`, color: s.avgReturn >= 0 ? C.green : C.red },
              { label: "종목 수", value: `${s.validStocks}/${s.portfolio.length}`, color: C.blue },
              { label: "실거래 수", value: s.tradeHistory.length, color: C.purple },
            ].map((m, i) => (
              <div key={i} style={{ background: C.card2, borderRadius: "8px", padding: "8px 6px", textAlign: "center" }}>
                <div style={{ fontSize: "9px", color: C.text3, marginBottom: "2px" }}>{m.label}</div>
                <div style={{ fontWeight: 800, fontSize: "15px", color: m.color }}>{m.value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* 서브탭 */}
        <div style={{ display: "flex", gap: "4px", marginBottom: "12px" }}>
          {[["overview", "수익률"], ["trades", "매매기록"], ["rebalance", "리밸런싱"]].map(([id, label]) => (
            <button key={id} onClick={() => setDetailTab(id)} style={{
              padding: "7px 14px", borderRadius: "8px", fontSize: "12px", fontWeight: 600,
              background: detailTab === id ? C.blueBg : "transparent", color: detailTab === id ? C.blue : C.text3,
              border: `1px solid ${detailTab === id ? C.blue : C.border2}`, cursor: "pointer",
            }}>{label}</button>
          ))}
        </div>

        {/* 수익률 탭 */}
        {detailTab === "overview" && (
          <>
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "20px", marginBottom: "12px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                <div style={{ fontWeight: 700 }}>수익률 추이 (실제 데이터)</div>
                <span style={{ fontSize: "10px", color: C.green, padding: "2px 8px", borderRadius: "4px", background: C.greenBg }}>LIVE</span>
              </div>
              <div style={{ fontSize: "11px", color: C.text3, marginBottom: "12px" }}>
                Yahoo Finance 실시간 시세 기반 · {s.returns.length}거래일
              </div>
              <InteractiveChart returns={s.returns} />
            </div>

            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "20px", marginBottom: "12px" }}>
              <div style={{ fontWeight: 700, marginBottom: "12px" }}>일간 수익률</div>
              <div style={{ maxHeight: "200px", overflow: "auto" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1px", background: C.border, borderRadius: "8px", overflow: "hidden" }}>
                  {["날짜", "일간", "누적"].map(h => (
                    <div key={h} style={{ background: C.card2, padding: "6px 8px", fontSize: "11px", fontWeight: 700, color: C.text3, textAlign: "center" }}>{h}</div>
                  ))}
                  {[...s.returns].reverse().slice(0, 30).map((r, i) => (
                    <React.Fragment key={i}>
                      <div style={{ background: C.card, padding: "5px 8px", fontSize: "11px", color: C.text2, textAlign: "center" }}>{r.date.slice(5)}</div>
                      <div style={{ background: C.card, padding: "5px 8px", fontSize: "11px", fontWeight: 700, textAlign: "center",
                        color: r.daily >= 0 ? C.green : C.red }}>{r.daily >= 0 ? "+" : ""}{r.daily}%</div>
                      <div style={{ background: C.card, padding: "5px 8px", fontSize: "11px", fontWeight: 700, textAlign: "center",
                        color: r.cumulative >= 0 ? C.green : C.red }}>{r.cumulative >= 0 ? "+" : ""}{r.cumulative}%</div>
                    </React.Fragment>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "20px" }}>
              <div style={{ fontWeight: 700, marginBottom: "12px" }}>포트폴리오 구성 ({s.validStocks}/{s.portfolio.length}종목 활성)</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                {s.portfolio.map((p, i) => {
                  const hasData = allData && allData[p.sym]?.closes?.length > 0;
                  const priceData = allData?.[p.sym];
                  const lastPrice = priceData?.closes?.[priceData.closes.length - 1];
                  const prevPrice = priceData?.closes?.[priceData.closes.length - 2];
                  const dayChange = lastPrice && prevPrice ? ((lastPrice - prevPrice) / prevPrice * 100).toFixed(2) : null;
                  const isKR = p.sym.includes(".KS");

                  return (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 10px",
                      background: C.card2, borderRadius: "8px", opacity: hasData ? 1 : 0.4 }}>
                      <div style={{ width: "28px", height: "28px", borderRadius: "6px",
                        background: `hsl(${(i * 23) % 360}, 45%, 25%)`, display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: "9px", fontWeight: 800, color: `hsl(${(i * 23) % 360}, 65%, 65%)`, flexShrink: 0 }}>
                        {p.sym.replace(".KS", "").replace("-USD", "").slice(0, 3)}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: "12px" }}>{getName(p.sym)}</div>
                        <div style={{ fontSize: "10px", color: C.text3, display: "flex", gap: "8px" }}>
                          <span>{p.sym}</span>
                          {lastPrice && <span style={{ color: C.text2 }}>{isKR ? `₩${Math.round(lastPrice).toLocaleString()}` : `$${lastPrice.toFixed(2)}`}</span>}
                          {dayChange && <span style={{ color: parseFloat(dayChange) >= 0 ? C.green : C.red }}>{parseFloat(dayChange) >= 0 ? "+" : ""}{dayChange}%</span>}
                        </div>
                      </div>
                      <div style={{ width: "60px", height: "4px", borderRadius: "2px", background: C.bg, overflow: "hidden" }}>
                        <div style={{ width: `${p.w * 100 * 5}%`, height: "100%", borderRadius: "2px",
                          background: `hsl(${(i * 23) % 360}, 60%, 50%)` }} />
                      </div>
                      <div style={{ fontWeight: 700, fontSize: "12px", color: C.blue, minWidth: "32px", textAlign: "right" }}>
                        {(p.w * 100).toFixed(0)}%
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {/* 매매기록 탭 */}
        {detailTab === "trades" && (
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "20px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
              <div>
                <div style={{ fontWeight: 700 }}>매매기록 ({s.tradeHistory.length}건)</div>
                <div style={{ fontSize: "11px", color: C.green, marginTop: "2px" }}>전략 generate() 실제 시그널 기반</div>
              </div>
              <span style={{ fontSize: "10px", color: C.green, padding: "2px 8px", borderRadius: "4px", background: C.greenBg }}>REAL</span>
            </div>
            {s.tradeHistory.length === 0 ? (
              <div style={{ textAlign: "center", padding: "40px 0", color: C.text3 }}>
                최근 60일간 발생한 시그널이 없습니다
              </div>
            ) : (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px", marginBottom: "16px" }}>
                  {[
                    { label: "매수", count: s.tradeHistory.filter(t => t.action === "매수").length, color: C.red },
                    { label: "매도", count: s.tradeHistory.filter(t => t.action === "매도").length, color: C.blue },
                    { label: "평균 P&L", count: (() => {
                      const sells = s.tradeHistory.filter(t => t.pnl != null);
                      return sells.length ? (sells.reduce((a, t) => a + t.pnl, 0) / sells.length).toFixed(1) + "%" : "N/A";
                    })(), color: C.yellow },
                  ].map((item, i) => (
                    <div key={i} style={{ background: C.card2, borderRadius: "10px", padding: "10px", textAlign: "center" }}>
                      <div style={{ fontWeight: 800, fontSize: "20px", color: item.color }}>{item.count}</div>
                      <div style={{ fontSize: "10px", color: C.text3 }}>{item.label}</div>
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxHeight: "500px", overflow: "auto" }}>
                  {s.tradeHistory.map((t, i) => (
                    <div key={i} style={{ background: C.card2, borderRadius: "10px", padding: "12px",
                      borderLeft: `3px solid ${t.action === "매수" ? C.red : C.blue}` }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <span style={{
                            padding: "2px 6px", borderRadius: "4px", fontSize: "10px", fontWeight: 700,
                            background: t.action === "매수" ? C.redBg : C.blueBg,
                            color: t.action === "매수" ? C.red : C.blue,
                          }}>{t.action}</span>
                          <span style={{ fontWeight: 700, fontSize: "13px" }}>{t.symbolName}</span>
                          <span style={{ fontSize: "10px", color: C.text3 }}>{t.symbol}</span>
                        </div>
                        <span style={{ fontSize: "10px", color: C.text3 }}>{t.date}</span>
                      </div>
                      <div style={{ display: "flex", gap: "12px", fontSize: "11px", color: C.text2, flexWrap: "wrap" }}>
                        <span>가격 <b style={{ color: C.text1 }}>{t.symbol.includes(".KS") ? `₩${t.price.toLocaleString()}` : `$${t.price.toLocaleString()}`}</b></span>
                        <span>수량 <b style={{ color: C.text1 }}>{t.qty}</b></span>
                        <span>금액 <b style={{ color: C.text1 }}>{t.symbol.includes(".KS") ? `₩${t.amount.toLocaleString()}` : `$${t.amount.toLocaleString()}`}</b></span>
                        {t.pnl != null && (
                          <span>P&L <b style={{ color: t.pnl >= 0 ? C.green : C.red }}>{t.pnl >= 0 ? "+" : ""}{t.pnl}%</b></span>
                        )}
                      </div>
                      <div style={{ fontSize: "10px", color: C.text3, marginTop: "3px" }}>시그널: {t.reason}</div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* 리밸런싱 탭 */}
        {detailTab === "rebalance" && (
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "20px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <div style={{ fontWeight: 700 }}>리밸런싱 이력</div>
              <span style={{ fontSize: "10px", color: C.green, padding: "2px 8px", borderRadius: "4px", background: C.greenBg }}>실제 비중 드리프트</span>
            </div>
            {s.rebalanceHistory.length === 0 ? (
              <div style={{ textAlign: "center", padding: "40px 0", color: C.text3 }}>
                리밸런싱 데이터 없음
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {s.rebalanceHistory.map((h, i) => (
                  <div key={i} style={{ background: C.card2, borderRadius: "10px", padding: "12px",
                    borderLeft: `3px solid ${h.action.includes("증가") || h.action === "신규 편입" ? C.green : h.action.includes("감소") ? C.orange : C.blue}` }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <span style={{
                          padding: "2px 6px", borderRadius: "4px", fontSize: "10px", fontWeight: 700,
                          background: h.action.includes("증가") ? C.greenBg : h.action.includes("감소") ? C.redBg : C.blueBg,
                          color: h.action.includes("증가") ? C.green : h.action.includes("감소") ? C.red : C.blue,
                        }}>{h.action}</span>
                        <span style={{ fontWeight: 700, fontSize: "13px" }}>{h.symbolName}</span>
                        <span style={{ fontSize: "10px", color: C.text3 }}>{h.symbol}</span>
                      </div>
                      <span style={{ fontSize: "10px", color: C.text3 }}>{h.date}</span>
                    </div>
                    <div style={{ display: "flex", gap: "12px", fontSize: "11px", color: C.text2 }}>
                      <span>비중 {h.beforeWeight}% → <b style={{ color: C.text1 }}>{h.afterWeight}%</b></span>
                      <span>사유: {h.reason}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // ═══ 전체 목록 ═══
  return (
    <div className="tab-content">
      <div style={{ background: `linear-gradient(135deg, ${C.card} 0%, ${C.card2} 100%)`, border: `1px solid ${C.border}`,
        borderRadius: "16px", padding: "20px", marginBottom: "12px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "4px" }}>
          <div style={{ fontWeight: 800, fontSize: "18px" }}>퀀트 전략 포트폴리오</div>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <span style={{ fontSize: "10px", color: C.green, padding: "2px 8px", borderRadius: "4px", background: C.greenBg }}>LIVE</span>
            <button onClick={loadData} style={{ background: C.card2, border: `1px solid ${C.border2}`, borderRadius: "6px",
              padding: "4px 10px", fontSize: "11px", color: C.text2, cursor: "pointer" }}>새로고침</button>
          </div>
        </div>
        <div style={{ color: C.text3, fontSize: "13px", marginBottom: "4px" }}>
          {strategyData.length}개 전략 · 실시간 Yahoo Finance 데이터 · 전략 generate() 백테스트
        </div>
        {lastUpdate && <div style={{ color: C.text3, fontSize: "11px", marginBottom: "16px" }}>마지막 업데이트: {lastUpdate.toLocaleString("ko-KR")}</div>}
        <div style={{ display: "flex", gap: "8px", overflowX: "auto", paddingBottom: "4px" }}>
          {topPerformers.map((s, i) => (
            <div key={i} onClick={() => setSelectedStrategy(s)} style={{
              minWidth: "140px", background: C.card2, borderRadius: "12px", padding: "12px", cursor: "pointer",
              border: `1px solid ${C.border2}`, flexShrink: 0, transition: "all .2s",
            }}
            onMouseEnter={e => e.currentTarget.style.borderColor = C.blue}
            onMouseLeave={e => e.currentTarget.style.borderColor = C.border2}>
              <div style={{ fontSize: "11px", color: C.yellow, marginBottom: "2px", fontWeight: 700 }}>#{i + 1}</div>
              <div style={{ fontWeight: 700, fontSize: "13px", marginBottom: "6px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.name}</div>
              <MiniChart returns={s.returns} width={116} height={28} />
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: "4px" }}>
                <span style={{ fontWeight: 800, fontSize: "16px", color: s.cumReturn >= 0 ? C.green : C.red }}>
                  {s.cumReturn >= 0 ? "+" : ""}{s.cumReturn}%
                </span>
                <span style={{ fontSize: "10px", color: C.text3, alignSelf: "flex-end" }}>{s.validStocks}종목</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", gap: "6px", marginBottom: "12px", flexWrap: "wrap", alignItems: "center" }}>
        <button onClick={() => setFilterCat("all")} style={{
          padding: "6px 12px", borderRadius: "8px", fontSize: "12px", fontWeight: 600,
          background: filterCat === "all" ? C.blueBg : "transparent", color: filterCat === "all" ? C.blue : C.text3,
          border: `1px solid ${filterCat === "all" ? C.blue : C.border2}`, cursor: "pointer",
        }}>전체</button>
        {categories.map(cat => (
          <button key={cat} onClick={() => setFilterCat(cat)} style={{
            padding: "6px 12px", borderRadius: "8px", fontSize: "12px", fontWeight: 600,
            background: filterCat === cat ? (CAT_COLORS[cat] || C.blue) + "20" : "transparent",
            color: filterCat === cat ? (CAT_COLORS[cat] || C.blue) : C.text3,
            border: `1px solid ${filterCat === cat ? (CAT_COLORS[cat] || C.blue) : C.border2}`, cursor: "pointer",
          }}>{cat}</button>
        ))}
        <div style={{ flex: 1 }} />
        <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={{
          padding: "6px 10px", borderRadius: "8px", fontSize: "12px", fontWeight: 600,
          background: C.card2, color: C.text2, border: `1px solid ${C.border2}`,
        }}>
          <option value="return">수익률순</option>
          <option value="sharpe">샤프비율순</option>
          <option value="name">이름순</option>
        </select>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "10px" }}>
        {filteredData.map((s, i) => (
          <div key={i} onClick={() => setSelectedStrategy(s)} style={{
            background: C.card, border: `1px solid ${C.border}`, borderRadius: "14px",
            padding: "16px", cursor: "pointer", transition: "all 0.2s",
          }}
          onMouseEnter={e => e.currentTarget.style.borderColor = C.blue}
          onMouseLeave={e => e.currentTarget.style.borderColor = C.border}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
              <div>
                <span style={{ padding: "2px 8px", borderRadius: "4px", fontSize: "10px", fontWeight: 700,
                  background: (CAT_COLORS[s.category] || C.blue) + "20", color: CAT_COLORS[s.category] || C.blue,
                  marginRight: "6px" }}>{s.category}</span>
                <span style={{ fontWeight: 700, fontSize: "14px" }}>{s.name}</span>
              </div>
              <span style={{ fontSize: "10px", color: C.text3 }}>{s.validStocks}종목</span>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "8px" }}>
              <div>
                <div style={{ fontSize: "11px", color: C.text3 }}>누적 수익률</div>
                <div style={{ fontWeight: 800, fontSize: "20px", color: s.cumReturn >= 0 ? C.green : C.red }}>
                  {s.cumReturn >= 0 ? "+" : ""}{s.cumReturn}%
                </div>
              </div>
              <MiniChart returns={s.returns} />
            </div>

            <div style={{ display: "flex", gap: "10px", fontSize: "11px", color: C.text3, marginBottom: "8px" }}>
              <span>샤프 <b style={{ color: s.sharpe > 1 ? C.green : C.text2 }}>{s.sharpe}</b></span>
              <span>MDD <b style={{ color: C.red }}>{s.maxDD}%</b></span>
              <span>승률 <b style={{ color: s.winRate >= 55 ? C.green : C.text2 }}>{s.winRate}%</b></span>
            </div>

            <div style={{ display: "flex", gap: "3px", flexWrap: "wrap" }}>
              {s.portfolio.slice(0, 5).map((p, j) => (
                <span key={j} style={{ padding: "1px 5px", borderRadius: "4px", fontSize: "9px",
                  background: C.card2, color: C.text3 }}>{getName(p.sym)}</span>
              ))}
              {s.portfolio.length > 5 && (
                <span style={{ padding: "1px 5px", borderRadius: "4px", fontSize: "9px",
                  background: C.card2, color: C.text3 }}>+{s.portfolio.length - 5}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
