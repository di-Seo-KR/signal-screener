// ════════════════════════════════════════════════════════════════════
// Zepta — 검증된 추천 스크리너 4종
// ──────────────────────────────────────────────────────────────────
// 사전에 검증된 4개 패턴.
// 사용자는 "+추천 조건" 버튼으로 한 번에 추가 가능.
// cron(screener-alert-monitor) 가 이 조건들을 평가합니다.
// ════════════════════════════════════════════════════════════════════

export const SUGGESTED_SCREENERS = [
  {
    template_id: "golden-cross-imminent",
    name: "골든크로스 직전",
    summary: "MA50 < MA200 + MA50 기울기 양수 — 추세 전환 시그널",
    description: "단기 이동평균(50일)이 장기(200일)를 곧 돌파할 가능성. 기울기가 양수면 상승 모멘텀.",
    conditions: {
      ma_state: "ma50_below_ma200",
      ma50_slope: { op: ">", value: 0 },
      market: "all",
    },
    alert_enabled: false,
  },
  {
    template_id: "rsi-oversold-volume-spike",
    name: "RSI 과매도 + 거래량 급증",
    summary: "RSI < 30 + 거래량 1.5배 이상 — 반등 가능성",
    description: "과매도 영역에서 거래량 증가는 매수세 유입 신호. 단기 반등 후보.",
    conditions: {
      rsi: { op: "<", value: 30 },
      volume_ratio: { op: ">=", value: 1.5 },
      market: "all",
    },
    alert_enabled: false,
  },
  {
    template_id: "bb-lower-touch",
    name: "볼린저밴드 하단 터치",
    summary: "종가 ≤ BB 하단 — 평균 회귀 후보",
    description: "20일 볼린저밴드 하단 도달. 단기 과매도 + 변동성 압축 구간.",
    conditions: {
      bb_position: "lower",
      market: "all",
    },
    alert_enabled: false,
  },
  {
    template_id: "atr-explosion",
    name: "ATR 폭발 (변동성 급증)",
    summary: "현재 ATR / 20일 평균 ATR > 2 — 변동성 폭발",
    description: "변동성이 평소의 2배. 큰 움직임 직전 가능성 — 손절 폭 넓혀 대응.",
    conditions: {
      atr_ratio: { op: ">", value: 2 },
      market: "all",
    },
    alert_enabled: false,
  },
];

/**
 * 조건 요약 문자열 생성 (UI 카드에 표시).
 */
export function summarizeConditions(conditions) {
  if (!conditions) return "조건 없음";
  const parts = [];
  if (conditions.rsi) {
    parts.push(`RSI ${conditions.rsi.op} ${conditions.rsi.value}`);
  }
  if (conditions.volume_ratio) {
    parts.push(`거래량 ${conditions.volume_ratio.op} ${conditions.volume_ratio.value}배`);
  }
  if (conditions.ma_state === "ma50_below_ma200") {
    parts.push("MA50 < MA200");
  }
  if (conditions.ma50_slope) {
    parts.push(`MA50 기울기 ${conditions.ma50_slope.op} ${conditions.ma50_slope.value}`);
  }
  if (conditions.bb_position === "lower") {
    parts.push("BB 하단 터치");
  }
  if (conditions.atr_ratio) {
    parts.push(`ATR 비율 ${conditions.atr_ratio.op} ${conditions.atr_ratio.value}`);
  }
  if (conditions.price_change_pct) {
    parts.push(`등락 ${conditions.price_change_pct.op} ${conditions.price_change_pct.value}%`);
  }
  return parts.length ? parts.join(" · ") : "사용자 정의";
}
