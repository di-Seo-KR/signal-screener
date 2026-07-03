// ════════════════════════════════════════════════════════════════════
// Zepta — 캔들 패턴 캘리브레이션 테이블 (자동 생성 — 수동 편집 금지)
// 생성: 2026-07-03T14:57:45.926Z / scripts/calibrate-candle-patterns.mjs
// 데이터: 바이낸스 USDM 24심볼 × {1h,4h,1d} × 1500봉, 확정봉만
// 방법: dir×(H봉 전진수익−학습구간 드리프트중앙값), 앞65%/뒤35% 부호일관 + OOS≥10bps + 동일봉 클러스터-강건 합동 t 기반 mult
// mult: 0=미채택(부호불일치/OOS<10bps/표본부족) 0.6=일관+약한엣지(합동t≥0.5) 1.0=일관+유의(합동t≥1.5)
// ────────────────────────────────────────────────────────────────────
//   1h  morning_star       mult=0    | 학습 n=106  엣지=  -88bps t=-1.27 승률=0.434 | OOS n=37  엣지=  -73bps t=-0.86
//   1h  evening_star       mult=0    | 학습 n=92   엣지=   65bps t= 0.95 승률=0.587 | OOS n=44  엣지=  -65bps t=-0.57
//   1h  piercing           mult=0    | 학습 n=264  엣지=   15bps t= 0.32 승률=0.504 | OOS n=149 엣지=   49bps t=0.88
//   1h  dark_cloud         mult=0    | 학습 n=257  엣지=    3bps t= 0.07 승률=0.49 | OOS n=175 엣지=   17bps t=0.39
//   1h  bullish_engulfing  mult=1    | 학습 n=345  엣지=   75bps t= 1.96 승률=0.484 | OOS n=225 엣지=   67bps t=1.61
//   1h  bearish_engulfing  mult=0    | 학습 n=425  엣지=  -12bps t=-0.36 승률=0.466 | OOS n=209 엣지=  -80bps t=-2.26
//   1h  three_soldiers     mult=0    | 학습 n=63   엣지=   12bps t= 0.15 승률=0.381 | OOS n=43  엣지=  -12bps t=-0.18
//   1h  three_crows        mult=0    | 학습 n=70   엣지=    5bps t= 0.06 승률=0.443 | OOS n=19  엣지= -147bps t=-1.17
//   1h  hammer             mult=0    | 학습 n=58   엣지=   14bps t= 0.19 승률=0.655 | OOS n=38  엣지=   91bps t=0.95
//   4h  morning_star       mult=0    | 학습 n=98   엣지=  -69bps t=-0.78 승률=0.49 | OOS n=73  엣지=  134bps t=0.8
//   4h  evening_star       mult=0    | 학습 n=73   엣지=    2bps t= 0.01 승률=0.534 | OOS n=65  엣지=  -12bps t=-0.13
//   4h  piercing           mult=1    | 학습 n=230  엣지=   97bps t= 1.56 승률=0.578 | OOS n=155 엣지=   71bps t=1
//   4h  dark_cloud         mult=0    | 학습 n=218  엣지=   63bps t= 1.25 승률=0.61 | OOS n=149 엣지= -158bps t=-2.83
//   4h  bullish_engulfing  mult=0    | 학습 n=334  엣지=    2bps t= 0.03 승률=0.563 | OOS n=286 엣지=   71bps t=1.15
//   4h  bearish_engulfing  mult=0    | 학습 n=341  엣지=   -8bps t=-0.15 승률=0.493 | OOS n=183 엣지= -107bps t=-1.46
//   4h  three_soldiers     mult=0    | 학습 n=70   엣지=  200bps t= 2.26 승률=0.671 | OOS n=22  엣지= -231bps t=-1.21
//   4h  three_crows        mult=0    | 학습 n=97   엣지= -170bps t=-1.38 승률=0.289 | OOS n=17  엣지=  239bps t=0.9
//   4h  hammer             mult=0    | 학습 n=58   엣지=  145bps t= 1.15 승률=0.448 | OOS n=18  엣지=   82bps t=0.6
//   1d  morning_star       mult=0    | 학습 n=71   엣지= -290bps t=-1.79 승률=0.423 | OOS n=35  엣지= -208bps t=-0.44
//   1d  evening_star       mult=0    | 학습 n=82   엣지=  136bps t= 1.05 승률=0.622 | OOS n=73  엣지=   13bps t=0.07
//   1d  piercing           mult=0    | 학습 n=246  엣지=   72bps t= 0.78 승률=0.451 | OOS n=142 엣지= -254bps t=-2.47
//   1d  dark_cloud         mult=0    | 학습 n=250  엣지=  -37bps t=-0.44 승률=0.532 | OOS n=154 엣지=   56bps t=0.41
//   1d  bullish_engulfing  mult=0    | 학습 n=437  엣지=  134bps t=  1.6 승률=0.481 | OOS n=240 엣지=  -62bps t=-0.45
//   1d  bearish_engulfing  mult=0    | 학습 n=384  엣지=   10bps t= 0.11 승률=0.529 | OOS n=190 엣지=   58bps t=0.43
//   1d  three_soldiers     mult=1    | 학습 n=77   엣지=  287bps t= 1.72 승률=0.61 | OOS n=20  엣지=  365bps t=0.63
//   1d  three_crows        mult=0    | 학습 n=56   엣지= -405bps t=-2.34 승률=0.321 | OOS n=12  엣지=  230bps t=1.73
//   1d  hammer             mult=0    | 학습 n=39   엣지=   88bps t= 0.53 승률=0.513 | OOS n=32  엣지= -184bps t=-0.86
// ════════════════════════════════════════════════════════════════════

export const CANDLE_CALIB = {
  "1h": {
    "morning_star": {
      "mult": 0,
      "n": 106,
      "edgeBps": -88,
      "t": -1.27,
      "winRate": 0.434,
      "oosN": 37,
      "oosEdgeBps": -73,
      "oosT": -0.86,
      "oosWinRate": 0.649
    },
    "evening_star": {
      "mult": 0,
      "n": 92,
      "edgeBps": 65,
      "t": 0.95,
      "winRate": 0.587,
      "oosN": 44,
      "oosEdgeBps": -65,
      "oosT": -0.57,
      "oosWinRate": 0.545
    },
    "piercing": {
      "mult": 0,
      "n": 264,
      "edgeBps": 15,
      "t": 0.32,
      "winRate": 0.504,
      "oosN": 149,
      "oosEdgeBps": 49,
      "oosT": 0.88,
      "oosWinRate": 0.537
    },
    "dark_cloud": {
      "mult": 0,
      "n": 257,
      "edgeBps": 3,
      "t": 0.07,
      "winRate": 0.49,
      "oosN": 175,
      "oosEdgeBps": 17,
      "oosT": 0.39,
      "oosWinRate": 0.457
    },
    "bullish_engulfing": {
      "mult": 1,
      "n": 345,
      "edgeBps": 75,
      "t": 1.96,
      "winRate": 0.484,
      "oosN": 225,
      "oosEdgeBps": 67,
      "oosT": 1.61,
      "oosWinRate": 0.582
    },
    "bearish_engulfing": {
      "mult": 0,
      "n": 425,
      "edgeBps": -12,
      "t": -0.36,
      "winRate": 0.466,
      "oosN": 209,
      "oosEdgeBps": -80,
      "oosT": -2.26,
      "oosWinRate": 0.464
    },
    "three_soldiers": {
      "mult": 0,
      "n": 63,
      "edgeBps": 12,
      "t": 0.15,
      "winRate": 0.381,
      "oosN": 43,
      "oosEdgeBps": -12,
      "oosT": -0.18,
      "oosWinRate": 0.558
    },
    "three_crows": {
      "mult": 0,
      "n": 70,
      "edgeBps": 5,
      "t": 0.06,
      "winRate": 0.443,
      "oosN": 19,
      "oosEdgeBps": -147,
      "oosT": -1.17,
      "oosWinRate": 0.211
    },
    "hammer": {
      "mult": 0,
      "n": 58,
      "edgeBps": 14,
      "t": 0.19,
      "winRate": 0.655,
      "oosN": 38,
      "oosEdgeBps": 91,
      "oosT": 0.95,
      "oosWinRate": 0.632
    }
  },
  "4h": {
    "morning_star": {
      "mult": 0,
      "n": 98,
      "edgeBps": -69,
      "t": -0.78,
      "winRate": 0.49,
      "oosN": 73,
      "oosEdgeBps": 134,
      "oosT": 0.8,
      "oosWinRate": 0.548
    },
    "evening_star": {
      "mult": 0,
      "n": 73,
      "edgeBps": 2,
      "t": 0.01,
      "winRate": 0.534,
      "oosN": 65,
      "oosEdgeBps": -12,
      "oosT": -0.13,
      "oosWinRate": 0.492
    },
    "piercing": {
      "mult": 1,
      "n": 230,
      "edgeBps": 97,
      "t": 1.56,
      "winRate": 0.578,
      "oosN": 155,
      "oosEdgeBps": 71,
      "oosT": 1,
      "oosWinRate": 0.632
    },
    "dark_cloud": {
      "mult": 0,
      "n": 218,
      "edgeBps": 63,
      "t": 1.25,
      "winRate": 0.61,
      "oosN": 149,
      "oosEdgeBps": -158,
      "oosT": -2.83,
      "oosWinRate": 0.423
    },
    "bullish_engulfing": {
      "mult": 0,
      "n": 334,
      "edgeBps": 2,
      "t": 0.03,
      "winRate": 0.563,
      "oosN": 286,
      "oosEdgeBps": 71,
      "oosT": 1.15,
      "oosWinRate": 0.573
    },
    "bearish_engulfing": {
      "mult": 0,
      "n": 341,
      "edgeBps": -8,
      "t": -0.15,
      "winRate": 0.493,
      "oosN": 183,
      "oosEdgeBps": -107,
      "oosT": -1.46,
      "oosWinRate": 0.388
    },
    "three_soldiers": {
      "mult": 0,
      "n": 70,
      "edgeBps": 200,
      "t": 2.26,
      "winRate": 0.671,
      "oosN": 22,
      "oosEdgeBps": -231,
      "oosT": -1.21,
      "oosWinRate": 0.5
    },
    "three_crows": {
      "mult": 0,
      "n": 97,
      "edgeBps": -170,
      "t": -1.38,
      "winRate": 0.289,
      "oosN": 17,
      "oosEdgeBps": 239,
      "oosT": 0.9,
      "oosWinRate": 0.353
    },
    "hammer": {
      "mult": 0,
      "n": 58,
      "edgeBps": 145,
      "t": 1.15,
      "winRate": 0.448,
      "oosN": 18,
      "oosEdgeBps": 82,
      "oosT": 0.6,
      "oosWinRate": 0.444
    }
  },
  "1d": {
    "morning_star": {
      "mult": 0,
      "n": 71,
      "edgeBps": -290,
      "t": -1.79,
      "winRate": 0.423,
      "oosN": 35,
      "oosEdgeBps": -208,
      "oosT": -0.44,
      "oosWinRate": 0.343
    },
    "evening_star": {
      "mult": 0,
      "n": 82,
      "edgeBps": 136,
      "t": 1.05,
      "winRate": 0.622,
      "oosN": 73,
      "oosEdgeBps": 13,
      "oosT": 0.07,
      "oosWinRate": 0.562
    },
    "piercing": {
      "mult": 0,
      "n": 246,
      "edgeBps": 72,
      "t": 0.78,
      "winRate": 0.451,
      "oosN": 142,
      "oosEdgeBps": -254,
      "oosT": -2.47,
      "oosWinRate": 0.444
    },
    "dark_cloud": {
      "mult": 0,
      "n": 250,
      "edgeBps": -37,
      "t": -0.44,
      "winRate": 0.532,
      "oosN": 154,
      "oosEdgeBps": 56,
      "oosT": 0.41,
      "oosWinRate": 0.649
    },
    "bullish_engulfing": {
      "mult": 0,
      "n": 437,
      "edgeBps": 134,
      "t": 1.6,
      "winRate": 0.481,
      "oosN": 240,
      "oosEdgeBps": -62,
      "oosT": -0.45,
      "oosWinRate": 0.438
    },
    "bearish_engulfing": {
      "mult": 0,
      "n": 384,
      "edgeBps": 10,
      "t": 0.11,
      "winRate": 0.529,
      "oosN": 190,
      "oosEdgeBps": 58,
      "oosT": 0.43,
      "oosWinRate": 0.658
    },
    "three_soldiers": {
      "mult": 1,
      "n": 77,
      "edgeBps": 287,
      "t": 1.72,
      "winRate": 0.61,
      "oosN": 20,
      "oosEdgeBps": 365,
      "oosT": 0.63,
      "oosWinRate": 0.4
    },
    "three_crows": {
      "mult": 0,
      "n": 56,
      "edgeBps": -405,
      "t": -2.34,
      "winRate": 0.321,
      "oosN": 12,
      "oosEdgeBps": 230,
      "oosT": 1.73,
      "oosWinRate": 0.833
    },
    "hammer": {
      "mult": 0,
      "n": 39,
      "edgeBps": 88,
      "t": 0.53,
      "winRate": 0.513,
      "oosN": 32,
      "oosEdgeBps": -184,
      "oosT": -0.86,
      "oosWinRate": 0.25
    }
  }
};

export const CANDLE_CALIB_META = {
  "generatedAt": "2026-07-03T14:57:45.926Z",
  "symbols": 24,
  "tfs": [
    "1h×1500",
    "4h×1500",
    "1d×1500"
  ],
  "horizonBars": {
    "1h": 24,
    "4h": 12,
    "1d": 5
  },
  "trainFrac": 0.65,
  "totalEvents": 7646,
  "fetched": 72,
  "failed": 0,
  "method": "dir×(H봉 전진수익−학습구간 드리프트중앙값), 앞65%/뒤35% 부호일관 + OOS≥10bps + 동일봉 클러스터-강건 합동 t 기반 mult"
};

export default { CANDLE_CALIB, CANDLE_CALIB_META };
