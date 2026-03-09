import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  ReferenceLine, ComposedChart
} from "recharts";

// ═══════════════════════════════════════════════════════════
//  SIGNAL SCREENER v2.0
//  실시간 데이터만 사용 — Vercel API Routes 경유
// ═══════════════════════════════════════════════════════════

const DEFAULT_CONDITIONS = [
  { id: "rsi30",       label: "RSI ≤ 30",       desc: "주봉 기준 과매도",         icon: "📉", color: "#ef4444", category: "momentum"  },
  { id: "ma200",       label: "200일선 터치",    desc: "200MA ±2% 이내",          icon: "📊", color: "#f59e0b", category: "trend"     },
  { id: "bb_lower",    label: "BB 하단 터치",    desc: "볼린저밴드 하단 ±1%",     icon: "🎯", color: "#8b5cf6", category: "volatility" },
  { id: "macd_golden", label: "MACD 골든크로스", desc: "MACD선이 시그널선 상향돌파", icon: "✨", color: "#10b981", category: "momentum"  },
  { id: "volume_spike",label: "거래량 급증",     desc: "20주 평균 대비 2배 이상", icon: "🔥", color: "#f97316", category: "volume"    },
];

const MARKET_TABS = [
  { id: "all",    label: "전체",  icon: "🌐" },
  { id: "us",     label: "미국",  icon: "🇺🇸" },
  { id: "kr",     label: "한국",  icon: "🇰🇷" },
  { id: "crypto", label: "크립토", icon: "₿"  },
];

const US_SYMBOLS = [
  "AAPL","MSFT","GOOGL","AMZN","NVDA","META","TSLA","AMD","NFLX","INTC",
  "BA","DIS","PYPL","SNAP","UBER","COIN","SQ","PLTR","RIVN","SOFI",
  "CRM","ORCL","ADBE","QCOM","MU","TSM","AVGO","SHOP","ROKU","PINS",
  "V","MA","JPM","GS","BAC","WFC","AXP","BLK","SCHW","MSTR",
];

const KR_SYMBOLS = [
  "005930.KS","000660.KS","035420.KS","035720.KS","051910.KS",
  "006400.KS","003670.KS","105560.KS","055550.KS","068270.KS",
  "207940.KS","373220.KS","066570.KS","034730.KS","012330.KS",
  "005380.KS","000270.KS","086790.KS","009150.KS","017670.KS",
];

const KR_NAMES = {
  "005930.KS":"삼성전자","000660.KS":"SK하이닉스","035420.KS":"NAVER","035720.KS":"카카오",
  "051910.KS":"LG화학","006400.KS":"삼성SDI","003670.KS":"포스코퓨처엠","105560.KS":"KB금융",
  "055550.KS":"신한지주","068270.KS":"셀트리온","207940.KS":"삼성바이오로직스",
  "373220.KS":"LG에너지솔루션","066570.KS":"LG전자","034730.KS":"SK","012330.KS":"현대모비스",
  "005380.KS":"현대차","000270.KS":"기아","086790.KS":"하나금융지주",
  "009150.KS":"삼성전기","017670.KS":"SK텔레콤",
};

const CRYPTO_IDS = [
  "bitcoin","ethereum","solana","ripple","cardano",
  "avalanche-2","polkadot","matic-network","chainlink","cosmos",
  "dogecoin","uniswap","aave","litecoin","shiba-inu",
];

const CRYPTO_SYMBOLS = {
  "bitcoin":"BTC","ethereum":"ETH","solana":"SOL","ripple":"XRP","cardano":"ADA",
  "avalanche-2":"AVAX","polkadot":"DOT","matic-network":"MATIC","chainlink":"LINK",
  "cosmos":"ATOM","dogecoin":"DOGE","uniswap":"UNI","aave":"AAVE","litecoin":"LTC","shiba-inu":"SHIB",
};

// ═══════════════════════════════════════════════════════════
//  TECHNICAL ANALYSIS ENGINE
// ═══════════════════════════════════════════════════════════

function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  let avgGain = gains / period, avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

function calcSMA(data, period) {
  if (data.length < period) return null;
  return data.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function calcMACD(closes) {
  if (closes.length < 35) return { macdLine: null, signalLine: null, histogram: null, goldenCross: false };
  const k12 = 2/13, k26 = 2/27, k9 = 2/10;
  let e12 = closes.slice(0,12).reduce((a,b)=>a+b,0)/12;
  let e26 = closes.slice(0,26).reduce((a,b)=>a+b,0)/26;
  const macdSeries = [];
  for (let i = 0; i < closes.length; i++) {
    if (i >= 12) e12 = closes[i]*k12 + e12*(1-k12);
    if (i >= 26) { e26 = closes[i]*k26 + e26*(1-k26); macdSeries.push(e12-e26); }
  }
  if (macdSeries.length < 9) return { macdLine: null, signalLine: null, histogram: null, goldenCross: false };
  let signal = macdSeries.slice(0,9).reduce((a,b)=>a+b,0)/9;
  for (let i = 9; i < macdSeries.length; i++) signal = macdSeries[i]*k9 + signal*(1-k9);
  let prevSignal = macdSeries.slice(0,9).reduce((a,b)=>a+b,0)/9;
  for (let i = 9; i < macdSeries.length-1; i++) prevSignal = macdSeries[i]*k9 + prevSignal*(1-k9);
  const macdLine = macdSeries[macdSeries.length-1];
  const prevMacd = macdSeries[macdSeries.length-2];
  return {
    macdLine: +macdLine.toFixed(4),
    signalLine: +signal.toFixed(4),
    histogram: +(macdLine-signal).toFixed(4),
    goldenCross: prevMacd <= prevSignal && macdLine > signal,
  };
}

function calcBollingerBands(closes, period=20, mult=2) {
  if (closes.length < period) return { upper:null, middle:null, lower:null };
  const slice = closes.slice(-period);
  const mean = slice.reduce((a,b)=>a+b,0)/period;
  const std = Math.sqrt(slice.reduce((a,b)=>a+(b-mean)**2,0)/period);
  return { upper: +(mean+mult*std).toFixed(4), middle: +mean.toFixed(4), lower: +(mean-mult*std).toFixed(4) };
}

function calcRSISeries(closes, period=14) {
  const out = [];
  if (closes.length < period+1) return out;
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i]-closes[i-1];
    if (d>=0) avgGain+=d; else avgLoss-=d;
  }
  avgGain/=period; avgLoss/=period;
  out.push(avgLoss===0 ? 100 : 100-100/(1+avgGain/avgLoss));
  for (let i = period+1; i < closes.length; i++) {
    const d = closes[i]-closes[i-1];
    avgGain=(avgGain*(period-1)+Math.max(d,0))/period;
    avgLoss=(avgLoss*(period-1)+Math.max(-d,0))/period;
    out.push(avgLoss===0 ? 100 : 100-100/(1+avgGain/avgLoss));
  }
  return out;
}

function analyzeAsset(weeklyCloses, dailyCloses, volumes) {
  const rsi = calcRSI(weeklyCloses, 14);
  const ma200 = calcSMA(dailyCloses, 200);
  const price = weeklyCloses[weeklyCloses.length-1];
  const prev  = weeklyCloses.length>=2 ? weeklyCloses[weeklyCloses.length-2] : price;
  const weekChange = ((price-prev)/prev)*100;
  const ma200Dist = ma200 ? ((price-ma200)/ma200)*100 : null;
  const bb = calcBollingerBands(weeklyCloses, 20, 2);
  const macd = calcMACD(weeklyCloses);
  const last20vol = volumes.slice(-20);
  const avgVol = last20vol.length ? last20vol.reduce((a,b)=>a+b,0)/last20vol.length : 0;
  const curVol = volumes[volumes.length-1] || 0;
  const volRatio = avgVol > 0 ? curVol/avgVol : 0;

  const triggers = [];
  if (rsi!=null && rsi<=30) triggers.push("rsi30");
  if (ma200Dist!=null && Math.abs(ma200Dist)<=2) triggers.push("ma200");
  if (bb.lower!=null && price<=bb.lower*1.01) triggers.push("bb_lower");
  if (macd.goldenCross) triggers.push("macd_golden");
  if (volRatio>=2) triggers.push("volume_spike");

  // 차트용 데이터 (최근 26주)
  const chartLen = Math.min(26, weeklyCloses.length);
  const rsiSeries = calcRSISeries(weeklyCloses, 14);
  const chartData = [];
  for (let i = weeklyCloses.length-chartLen; i < weeklyCloses.length; i++) {
    const idx = i-(weeklyCloses.length-chartLen);
    const slice = weeklyCloses.slice(Math.max(0,i-19), i+1);
    const mean = slice.length ? slice.reduce((a,b)=>a+b,0)/slice.length : null;
    const std = mean ? Math.sqrt(slice.reduce((a,b)=>a+(b-mean)**2,0)/slice.length) : 0;
    const rsiIdx = i-(weeklyCloses.length-rsiSeries.length);
    chartData.push({
      week: `W-${chartLen-idx}`,
      price: +weeklyCloses[i].toFixed(2),
      bbUpper: mean ? +(mean+2*std).toFixed(2) : null,
      bbMiddle: mean ? +mean.toFixed(2) : null,
      bbLower: mean ? +(mean-2*std).toFixed(2) : null,
      volume: volumes[i]||0,
      rsi: rsiIdx>=0&&rsiIdx<rsiSeries.length ? +rsiSeries[rsiIdx].toFixed(1) : null,
      ma200: ma200 ? +ma200.toFixed(2) : null,
    });
  }

  return {
    price: +price.toFixed(4),
    weekChange: +weekChange.toFixed(2),
    rsi: rsi!=null ? +rsi.toFixed(1) : null,
    ma200: ma200 ? +ma200.toFixed(2) : null,
    ma200Dist: ma200Dist!=null ? +ma200Dist.toFixed(2) : null,
    bbUpper: bb.upper, bbMiddle: bb.middle, bbLower: bb.lower,
    macdLine: macd.macdLine, signalLine: macd.signalLine,
    macdHist: macd.histogram, macdGoldenCross: macd.goldenCross,
    volume: curVol, avgVolume: Math.round(avgVol),
    volRatio: +volRatio.toFixed(1),
    triggers, score: triggers.length,
    sparkline: weeklyCloses.slice(-12),
    chartData,
  };
}

// ═══════════════════════════════════════════════════════════
//  DATA FETCHERS — Vercel /api/* 경유 (실시간 데이터)
// ═══════════════════════════════════════════════════════════

async function fetchYahooViaAPI(symbol, interval="1wk", range="2y") {
  const res = await fetch(`/api/yahoo?symbol=${encodeURIComponent(symbol)}&interval=${interval}&range=${range}`);
  if (!res.ok) throw new Error(`Yahoo API ${res.status}`);
  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error("No chart data");
  const q = result.indicators?.quote?.[0];
  const closes = (q?.close||[]).map((v,i)=>v??q?.open?.[i]??null).filter(v=>v!=null);
  const volumes = (q?.volume||[]).filter(v=>v!=null);
  return { closes, volumes };
}

async function fetchUSStock(symbol) {
  try {
    const [weekly, daily] = await Promise.all([
      fetchYahooViaAPI(symbol, "1wk", "2y"),
      fetchYahooViaAPI(symbol, "1d",  "1y"),
    ]);
    return { symbol, name: symbol, market:"us", ...analyzeAsset(weekly.closes, daily.closes, weekly.volumes) };
  } catch(e) {
    console.warn(`US fail: ${symbol}`, e.message);
    return null;
  }
}

async function fetchKRStock(symbol) {
  try {
    const [weekly, daily] = await Promise.all([
      fetchYahooViaAPI(symbol, "1wk", "2y"),
      fetchYahooViaAPI(symbol, "1d",  "1y"),
    ]);
    return { symbol, name: KR_NAMES[symbol]||symbol.replace(".KS",""), market:"kr", ...analyzeAsset(weekly.closes, daily.closes, weekly.volumes) };
  } catch(e) {
    console.warn(`KR fail: ${symbol}`, e.message);
    return null;
  }
}

async function fetchCryptoAsset(id) {
  const res = await fetch(`/api/coingecko?id=${id}&days=365`);
  if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
  const json = await res.json();
  const dailyPrices = (json.prices||[]).map(p=>p[1]);
  const dailyVols   = (json.total_volumes||[]).map(v=>v[1]);
  const weeklyCloses=[], weeklyVols=[];
  for (let i=6; i<dailyPrices.length; i+=7) {
    weeklyCloses.push(dailyPrices[i]);
    weeklyVols.push(dailyVols.slice(Math.max(0,i-6),i+1).reduce((a,b)=>a+b,0));
  }
  if (weeklyCloses.length<10) throw new Error("Not enough data");
  return {
    symbol: CRYPTO_SYMBOLS[id]||id.toUpperCase(),
    name: id.charAt(0).toUpperCase()+id.slice(1).replace(/-/g," "),
    market:"crypto",
    ...analyzeAsset(weeklyCloses, dailyPrices, weeklyVols),
  };
}

// ═══════════════════════════════════════════════════════════
//  TELEGRAM NOTIFICATIONS
// ═══════════════════════════════════════════════════════════

async function sendTelegramAlert(botToken, chatId, assets, conditions) {
  if (!botToken||!chatId) return { ok:false, error:"Bot Token과 Chat ID를 입력하세요." };
  const condMap = Object.fromEntries(conditions.map(c=>[c.id,c]));
  let msg = `🚨 *Signal Screener 알림*\n\n`;
  msg += `📅 ${new Date().toLocaleDateString("ko-KR")} ${new Date().toLocaleTimeString("ko-KR")}\n`;
  msg += `📊 시그널 감지: *${assets.length}개* 자산\n\n`;
  assets.slice(0,15).forEach(a=>{
    const flag = a.market==="us"?"🇺🇸":a.market==="kr"?"🇰🇷":"₿";
    const price = a.market==="kr"?`₩${Math.round(a.price).toLocaleString()}`:`$${a.price?.toLocaleString(undefined,{maximumFractionDigits:a.price<1?6:2})}`;
    const chg = a.weekChange>=0?`+${a.weekChange}%`:`${a.weekChange}%`;
    const sigs = a.triggers.map(t=>condMap[t]?.label).filter(Boolean).join(" · ");
    msg += `${flag} *${a.name}* (${a.symbol})\n`;
    msg += `   ${price} | ${chg} | RSI ${a.rsi??"—"}\n`;
    msg += `   📌 ${sigs}\n\n`;
  });
  if (assets.length>15) msg += `_...외 ${assets.length-15}개_\n\n`;
  msg += `_⚠️ 기술적 지표 기반 — 투자 추천 아님_`;
  try {
    const r = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`,{
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ chat_id:chatId, text:msg, parse_mode:"Markdown" }),
    });
    const d = await r.json();
    return d.ok ? {ok:true} : {ok:false, error:d.description||"전송 실패"};
  } catch(e) { return {ok:false, error:e.message}; }
}

// ═══════════════════════════════════════════════════════════
//  UI COMPONENTS
// ═══════════════════════════════════════════════════════════

function Sparkline({ data, color="#6366f1", width=80, height=28 }) {
  if (!data||data.length<2) return <div style={{width,height}}/>;
  const min=Math.min(...data), max=Math.max(...data), range=max-min||1;
  const pts=data.map((v,i)=>`${(i/(data.length-1))*width},${height-2-((v-min)/range)*(height-4)}`).join(" ");
  const ly=height-2-((data[data.length-1]-min)/range)*(height-4);
  return (
    <svg width={width} height={height} style={{display:"block"}}>
      <polyline fill="none" stroke={color} strokeWidth="1.5" points={pts} strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx={width} cy={ly} r="2" fill={color}/>
    </svg>
  );
}

function RSIGauge({ value }) {
  if (value==null) return <span style={{color:"#334155",fontSize:12}}>—</span>;
  const color = value<=30?"#ef4444":value>=70?"#10b981":"#94a3b8";
  return (
    <div style={{display:"flex",alignItems:"center",gap:8}}>
      <div style={{width:48,height:5,borderRadius:3,background:"#1a2332",overflow:"hidden"}}>
        <div style={{width:`${Math.min(value,100)}%`,height:"100%",background:`linear-gradient(90deg,${color}cc,${color})`,transition:"width 0.5s"}}/>
      </div>
      <span style={{color,fontSize:13,fontWeight:700,fontFamily:"monospace",minWidth:30,textAlign:"right"}}>{value}</span>
    </div>
  );
}

function ConditionBadge({ condId, small, conditions }) {
  const cond = (conditions||DEFAULT_CONDITIONS).find(c=>c.id===condId);
  if (!cond) return null;
  return (
    <span style={{
      display:"inline-flex",alignItems:"center",gap:small?2:4,
      padding:small?"1px 6px":"3px 10px",borderRadius:5,
      fontSize:small?10:11,fontWeight:600,
      background:cond.color+"14",color:cond.color,
      border:`1px solid ${cond.color}25`,whiteSpace:"nowrap",
    }}>
      {!small&&<span>{cond.icon}</span>}
      <span>{small?cond.label.split(" ")[0]:cond.label}</span>
    </span>
  );
}

function ToastContainer({ toasts, onDismiss }) {
  if (!toasts.length) return null;
  const colors={error:"#ef4444",warning:"#f59e0b",success:"#10b981",info:"#6366f1"};
  return (
    <div style={{position:"fixed",top:20,right:20,zIndex:2000,display:"flex",flexDirection:"column",gap:8,maxWidth:380}}>
      {toasts.map(t=>(
        <div key={t.id} style={{
          background:"#111827",border:`1px solid ${colors[t.type]||colors.error}40`,
          borderLeft:`3px solid ${colors[t.type]||colors.error}`,
          borderRadius:10,padding:"12px 16px",fontSize:13,color:"#e2e8f0",
          boxShadow:"0 8px 32px rgba(0,0,0,0.5)",animation:"slideIn 0.3s ease",
          display:"flex",gap:10,alignItems:"flex-start",
        }}>
          <span style={{flex:1,lineHeight:1.5}}>{t.message}</span>
          <button onClick={()=>onDismiss(t.id)} style={{background:"none",border:"none",color:"#475569",cursor:"pointer",fontSize:14,padding:0}}>✕</button>
        </div>
      ))}
    </div>
  );
}

function ChartModal({ asset, onClose, conditions }) {
  const [tab, setTab] = useState("price");
  if (!asset) return null;

  const fmt = v => {
    if (v==null) return "—";
    if (asset.market==="kr") return `₩${Math.round(v).toLocaleString()}`;
    return `$${v.toLocaleString(undefined,{maximumFractionDigits:v<1?6:2})}`;
  };

  const cd = asset.chartData||[];
  const nums = cd.flatMap(d=>[d.price,d.bbLower,d.bbUpper].filter(v=>v!=null&&isFinite(v)));
  const pMin = nums.length ? Math.min(...nums)*0.97 : 0;
  const pMax = nums.length ? Math.max(...nums)*1.03 : 100;

  const CustomTooltip = ({active,payload}) => {
    if (!active||!payload?.length) return null;
    const d = payload[0]?.payload;
    return (
      <div style={{background:"#111827",border:"1px solid #1e293b",borderRadius:8,padding:"10px 14px",fontSize:11,color:"#e2e8f0"}}>
        <div style={{fontWeight:700,marginBottom:4}}>{d.week}</div>
        {d.price!=null&&<div>가격: {fmt(d.price)}</div>}
        {d.rsi!=null&&<div>RSI: <span style={{color:d.rsi<=30?"#ef4444":d.rsi>=70?"#10b981":"#94a3b8"}}>{d.rsi}</span></div>}
        {d.bbUpper!=null&&<div>BB: {fmt(d.bbLower)} ~ {fmt(d.bbUpper)}</div>}
      </div>
    );
  };

  const metrics = [
    {label:"현재가",   value:fmt(asset.price),              big:true},
    {label:"주간 변동",value:`${asset.weekChange>=0?"+":""}${asset.weekChange}%`, color:asset.weekChange>=0?"#10b981":"#ef4444"},
    {label:"RSI(14)", value:asset.rsi??"—",                color:asset.rsi!=null?(asset.rsi<=30?"#ef4444":asset.rsi>=70?"#10b981":"#94a3b8"):"#475569"},
    {label:"200일선", value:asset.ma200Dist!=null?`${asset.ma200Dist>0?"+":""}${asset.ma200Dist}%`:"—", color:asset.ma200Dist!=null&&Math.abs(asset.ma200Dist)<=2?"#f59e0b":"#94a3b8"},
    {label:"MACD Hist",value:asset.macdHist??"—",           color:asset.macdHist!=null?(asset.macdHist>=0?"#10b981":"#ef4444"):"#475569"},
    {label:"거래량배율",value:`${asset.volRatio}x`,          color:asset.volRatio>=2?"#f97316":"#94a3b8"},
  ];

  return (
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.8)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,backdropFilter:"blur(12px)",padding:16}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#0c1120",border:"1px solid #1e293b",borderRadius:16,maxWidth:720,width:"100%",maxHeight:"92vh",overflowY:"auto",boxShadow:"0 32px 64px rgba(0,0,0,0.7)"}}>
        {/* Header */}
        <div style={{padding:"22px 22px 14px",borderBottom:"1px solid #151d2e"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
            <div>
              <div style={{fontSize:10,color:"#475569",letterSpacing:1.5,textTransform:"uppercase",marginBottom:4}}>
                {asset.market==="us"?"🇺🇸 US STOCK":asset.market==="kr"?"🇰🇷 KR STOCK":"₿ CRYPTO"}
              </div>
              <h2 style={{margin:0,fontSize:20,color:"#f8fafc",fontWeight:700,display:"flex",alignItems:"center",gap:10}}>
                {asset.name}
                <span style={{fontSize:13,color:"#475569",fontWeight:400,fontFamily:"monospace"}}>{asset.symbol}</span>
              </h2>
            </div>
            <button onClick={onClose} style={{background:"#1e293b",border:"none",color:"#64748b",width:32,height:32,borderRadius:8,cursor:"pointer",fontSize:14,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
          </div>
          <div style={{display:"flex",gap:10,marginTop:14,flexWrap:"wrap"}}>
            {metrics.map((m,i)=>(
              <div key={i} style={{background:"#111827",borderRadius:8,padding:"8px 14px",border:"1px solid #1a2332",minWidth:i===0?110:80}}>
                <div style={{fontSize:9,color:"#475569",marginBottom:2,letterSpacing:0.3}}>{m.label}</div>
                <div style={{fontSize:m.big?16:14,fontWeight:700,color:m.color||"#e2e8f0",fontFamily:"monospace"}}>{m.value}</div>
              </div>
            ))}
          </div>
          {asset.triggers.length>0&&(
            <div style={{display:"flex",gap:6,marginTop:10,flexWrap:"wrap"}}>
              {asset.triggers.map(t=><ConditionBadge key={t} condId={t} conditions={conditions}/>)}
            </div>
          )}
        </div>

        {/* Charts */}
        <div style={{padding:"14px 22px 22px"}}>
          <div style={{display:"flex",gap:4,marginBottom:14}}>
            {[["price","가격 + BB"],["rsi","RSI"],["volume","거래량"]].map(([id,lbl])=>(
              <button key={id} onClick={()=>setTab(id)} style={{padding:"5px 12px",borderRadius:6,border:"none",fontSize:12,fontWeight:600,cursor:"pointer",background:tab===id?"#6366f1":"#111827",color:tab===id?"#fff":"#475569"}}>
                {lbl}
              </button>
            ))}
          </div>

          {tab==="price"&&cd.length>0&&(
            <div style={{background:"#080d18",borderRadius:12,padding:"14px 4px 8px 0",border:"1px solid #151d2e"}}>
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={cd} margin={{top:5,right:8,left:8,bottom:5}}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#151d2e"/>
                  <XAxis dataKey="week" tick={{fill:"#334155",fontSize:9}} axisLine={{stroke:"#151d2e"}} tickLine={false}/>
                  <YAxis domain={[pMin,pMax]} tick={{fill:"#334155",fontSize:9}} axisLine={{stroke:"#151d2e"}} tickLine={false}
                    tickFormatter={v=>asset.market==="kr"?`${(v/1000).toFixed(0)}K`:v<1?v.toFixed(4):v.toFixed(0)}/>
                  <Tooltip content={<CustomTooltip/>}/>
                  <Area type="monotone" dataKey="bbUpper" stroke="none" fill="#8b5cf608"/>
                  <Area type="monotone" dataKey="bbLower" stroke="none" fill="#080d18"/>
                  <Line type="monotone" dataKey="bbUpper"  stroke="#8b5cf640" strokeWidth={1} dot={false} strokeDasharray="4 4"/>
                  <Line type="monotone" dataKey="bbLower"  stroke="#8b5cf640" strokeWidth={1} dot={false} strokeDasharray="4 4"/>
                  <Line type="monotone" dataKey="bbMiddle" stroke="#8b5cf628" strokeWidth={1} dot={false}/>
                  {asset.ma200&&<ReferenceLine y={asset.ma200} stroke="#f59e0b50" strokeDasharray="5 3" label={{value:"200MA",fill:"#f59e0b80",fontSize:9,position:"right"}}/>}
                  <Line type="monotone" dataKey="price" stroke="#6366f1" strokeWidth={2} dot={false} activeDot={{r:4,fill:"#6366f1"}}/>
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}

          {tab==="rsi"&&cd.length>0&&(
            <div style={{background:"#080d18",borderRadius:12,padding:"14px 4px 8px 0",border:"1px solid #151d2e"}}>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={cd} margin={{top:5,right:8,left:8,bottom:5}}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#151d2e"/>
                  <XAxis dataKey="week" tick={{fill:"#334155",fontSize:9}} axisLine={{stroke:"#151d2e"}} tickLine={false}/>
                  <YAxis domain={[0,100]} ticks={[0,30,50,70,100]} tick={{fill:"#334155",fontSize:9}} axisLine={{stroke:"#151d2e"}} tickLine={false}/>
                  <Tooltip content={<CustomTooltip/>}/>
                  <ReferenceLine y={30} stroke="#ef444450" strokeDasharray="4 2" label={{value:"과매도 30",fill:"#ef444480",fontSize:9,position:"insideLeft"}}/>
                  <ReferenceLine y={70} stroke="#10b98150" strokeDasharray="4 2" label={{value:"과매수 70",fill:"#10b98180",fontSize:9,position:"insideLeft"}}/>
                  <Line type="monotone" dataKey="rsi" stroke="#f59e0b" strokeWidth={2} dot={false} activeDot={{r:4,fill:"#f59e0b"}}/>
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {tab==="volume"&&cd.length>0&&(
            <div style={{background:"#080d18",borderRadius:12,padding:"14px 4px 8px 0",border:"1px solid #151d2e"}}>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={cd} margin={{top:5,right:8,left:8,bottom:5}}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#151d2e"/>
                  <XAxis dataKey="week" tick={{fill:"#334155",fontSize:9}} axisLine={{stroke:"#151d2e"}} tickLine={false}/>
                  <YAxis tick={{fill:"#334155",fontSize:9}} axisLine={{stroke:"#151d2e"}} tickLine={false}
                    tickFormatter={v=>v>=1e9?`${(v/1e9).toFixed(1)}B`:v>=1e6?`${(v/1e6).toFixed(0)}M`:`${(v/1e3).toFixed(0)}K`}/>
                  <Tooltip content={<CustomTooltip/>}/>
                  <Bar dataKey="volume" fill="#6366f170" radius={[2,2,0,0]}/>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          <p style={{margin:"14px 0 0",fontSize:10,color:"#1e293b",textAlign:"center",fontStyle:"italic"}}>
            본 데이터는 기술적 지표 참고용이며 투자 추천이 아닙니다
          </p>
        </div>
      </div>
    </div>
  );
}

function TelegramPanel({ assets, conditions, onClose }) {
  const [botToken, setBotToken] = useState(()=>{try{return sessionStorage.getItem("tg_bot")||"";}catch{return "";}});
  const [chatId,   setChatId]   = useState(()=>{try{return sessionStorage.getItem("tg_chat")||"";}catch{return "";}});
  const [status, setStatus] = useState(null);
  const [sending, setSending] = useState(false);

  const handleTest = async () => {
    try{sessionStorage.setItem("tg_bot",botToken);sessionStorage.setItem("tg_chat",chatId);}catch{}
    setSending(true); setStatus(null);
    const signaled = assets.filter(a=>a.triggers.length>0);
    const r = await sendTelegramAlert(botToken, chatId, signaled.length?signaled:assets.slice(0,3), conditions);
    setStatus(r); setSending(false);
  };

  return (
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1100,backdropFilter:"blur(8px)",padding:20}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#0f172a",border:"1px solid #1e293b",borderRadius:16,padding:28,maxWidth:460,width:"100%"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
          <h3 style={{margin:0,color:"#f8fafc",fontSize:18}}>📨 텔레그램 알림</h3>
          <button onClick={onClose} style={{background:"#1e293b",border:"none",color:"#64748b",width:32,height:32,borderRadius:8,cursor:"pointer"}}>✕</button>
        </div>
        <div style={{background:"#111827",borderRadius:10,padding:14,marginBottom:20,border:"1px solid #1a2332",fontSize:12,color:"#64748b",lineHeight:1.9}}>
          <strong style={{color:"#94a3b8",display:"block",marginBottom:6}}>설정 방법</strong>
          <span>1. 텔레그램 → <strong style={{color:"#94a3b8"}}>@BotFather</strong> → /newbot → Bot Token 발급</span><br/>
          <span>2. <strong style={{color:"#94a3b8"}}>@userinfobot</strong> 에게 메시지 → Chat ID 확인</span><br/>
          <span>3. 만든 봇에게 먼저 /start 를 보내야 수신 가능</span>
        </div>
        <label style={{display:"block",marginBottom:14}}>
          <span style={{fontSize:12,color:"#94a3b8",display:"block",marginBottom:5}}>Bot Token</span>
          <input value={botToken} onChange={e=>setBotToken(e.target.value)} placeholder="123456:ABC-DEFxxxxxx..." style={{width:"100%",background:"#1e293b",border:"1px solid #334155",borderRadius:8,padding:"10px 14px",color:"#f8fafc",fontSize:13,outline:"none",fontFamily:"monospace"}}/>
        </label>
        <label style={{display:"block",marginBottom:20}}>
          <span style={{fontSize:12,color:"#94a3b8",display:"block",marginBottom:5}}>Chat ID</span>
          <input value={chatId} onChange={e=>setChatId(e.target.value)} placeholder="123456789" style={{width:"100%",background:"#1e293b",border:"1px solid #334155",borderRadius:8,padding:"10px 14px",color:"#f8fafc",fontSize:13,outline:"none",fontFamily:"monospace"}}/>
        </label>
        {status&&(
          <div style={{padding:"10px 14px",borderRadius:8,marginBottom:14,fontSize:13,background:status.ok?"#10b98115":"#ef444415",border:`1px solid ${status.ok?"#10b98130":"#ef444430"}`,color:status.ok?"#10b981":"#fca5a5"}}>
            {status.ok?"전송 성공! 텔레그램을 확인하세요 ✅":`오류: ${status.error}`}
          </div>
        )}
        <button onClick={handleTest} disabled={sending||!botToken||!chatId} style={{
          width:"100%",padding:"12px",borderRadius:10,border:"none",
          background:botToken&&chatId&&!sending?"linear-gradient(135deg,#0088cc,#00aaff)":"#1e293b",
          color:"#fff",fontSize:14,fontWeight:600,cursor:botToken&&chatId&&!sending?"pointer":"not-allowed",
        }}>{sending?"전송 중...":"테스트 알림 보내기"}</button>
      </div>
    </div>
  );
}

function AddConditionModal({ onAdd, onClose }) {
  const [name,setName]=useState(""); const [type,setType]=useState("rsi_custom");
  const [p1,setP1]=useState(""); const [p2,setP2]=useState("");
  const TEMPLATES=[
    {id:"rsi_custom",label:"RSI 커스텀",params:["RSI 임계값 (예: 25)","기간 (기본: 14)"]},
    {id:"ma_touch",label:"이동평균선 터치",params:["이동평균 기간 (예: 50)","오차 % (기본: 2)"]},
    {id:"price_drop",label:"가격 낙폭",params:["주간 하락률 % (예: 10)",""]},
    {id:"vol_custom",label:"거래량 커스텀",params:["배수 (예: 3)","평균 기간 (기본: 20)"]},
  ];
  const tpl=TEMPLATES.find(t=>t.id===type);
  const handleAdd=()=>{
    if(!name.trim()) return;
    onAdd({id:`custom_${Date.now()}`,label:name,desc:"사용자 정의 조건",icon:"⚙️",color:"#06b6d4",category:"custom",customType:type,param1:parseFloat(p1)||0,param2:parseFloat(p2)||0});
  };
  return (
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1100,backdropFilter:"blur(8px)",padding:20}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#0f172a",border:"1px solid #1e293b",borderRadius:16,padding:28,maxWidth:440,width:"100%"}}>
        <h3 style={{margin:"0 0 20px",color:"#f8fafc",fontSize:18}}>새 조건 추가</h3>
        <label style={{display:"block",marginBottom:14}}>
          <span style={{fontSize:12,color:"#94a3b8",display:"block",marginBottom:5}}>조건 이름</span>
          <input value={name} onChange={e=>setName(e.target.value)} placeholder="예: RSI ≤ 25" style={{width:"100%",background:"#1e293b",border:"1px solid #334155",borderRadius:8,padding:"10px 14px",color:"#f8fafc",fontSize:14,outline:"none"}}/>
        </label>
        <label style={{display:"block",marginBottom:14}}>
          <span style={{fontSize:12,color:"#94a3b8",display:"block",marginBottom:5}}>조건 유형</span>
          <select value={type} onChange={e=>setType(e.target.value)} style={{width:"100%",background:"#1e293b",border:"1px solid #334155",borderRadius:8,padding:"10px 14px",color:"#f8fafc",fontSize:14,cursor:"pointer"}}>
            {TEMPLATES.map(t=><option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </label>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:22}}>
          {tpl?.params.filter(Boolean).map((p,i)=>(
            <label key={i}>
              <span style={{fontSize:11,color:"#64748b",display:"block",marginBottom:4}}>{p}</span>
              <input value={i===0?p1:p2} onChange={e=>i===0?setP1(e.target.value):setP2(e.target.value)} type="number" style={{width:"100%",background:"#1e293b",border:"1px solid #334155",borderRadius:8,padding:"8px 12px",color:"#f8fafc",fontSize:13,outline:"none"}}/>
            </label>
          ))}
        </div>
        <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
          <button onClick={onClose} style={{padding:"10px 20px",borderRadius:8,border:"1px solid #334155",background:"transparent",color:"#94a3b8",fontSize:13,cursor:"pointer"}}>취소</button>
          <button onClick={handleAdd} disabled={!name.trim()} style={{padding:"10px 20px",borderRadius:8,border:"none",background:name.trim()?"linear-gradient(135deg,#6366f1,#8b5cf6)":"#1e293b",color:"#fff",fontSize:13,fontWeight:600,cursor:name.trim()?"pointer":"not-allowed"}}>추가</button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  MAIN APPLICATION
// ═══════════════════════════════════════════════════════════

export default function SignalScreener() {
  const [data,setData]=useState([]);
  const [conditions,setConditions]=useState(DEFAULT_CONDITIONS);
  const [activeConditions,setActiveConditions]=useState(["rsi30"]);
  const [marketFilter,setMarketFilter]=useState("all");
  const [sortBy,setSortBy]=useState("score");
  const [selectedAsset,setSelectedAsset]=useState(null);
  const [isLoading,setIsLoading]=useState(true);
  const [progress,setProgress]=useState({current:0,total:0,phase:""});
  const [lastUpdated,setLastUpdated]=useState(null);
  const [conditionMode,setConditionMode]=useState("or");
  const [showAddCondition,setShowAddCondition]=useState(false);
  const [showTelegram,setShowTelegram]=useState(false);
  const [searchQuery,setSearchQuery]=useState("");
  const [toasts,setToasts]=useState([]);
  const [failedItems,setFailedItems]=useState({us:0,kr:0,crypto:0});
  const toastId=useRef(0);

  const addToast=useCallback((message,type="error",dur=6000)=>{
    const id=++toastId.current;
    setToasts(p=>[...p,{id,message,type}]);
    setTimeout(()=>setToasts(p=>p.filter(t=>t.id!==id)),dur);
  },[]);
  const dismissToast=useCallback(id=>setToasts(p=>p.filter(t=>t.id!==id)),[]);

  const loadData=useCallback(async()=>{
    setIsLoading(true); setData([]); setFailedItems({us:0,kr:0,crypto:0});
    const all=[];
    const failed={us:0,kr:0,crypto:0};

    // ── US Stocks ──
    setProgress({current:0,total:US_SYMBOLS.length+KR_SYMBOLS.length+CRYPTO_IDS.length,phase:"🇺🇸 미국 주식 스캔 중..."});
    for (let i=0; i<US_SYMBOLS.length; i+=5) {
      const batch=US_SYMBOLS.slice(i,i+5);
      const results=await Promise.allSettled(batch.map(fetchUSStock));
      results.forEach(r=>{if(r.status==="fulfilled"&&r.value)all.push(r.value);else failed.us++;});
      setProgress(p=>({...p,current:Math.min(i+5,US_SYMBOLS.length),phase:`🇺🇸 미국 (${Math.min(i+5,US_SYMBOLS.length)}/${US_SYMBOLS.length})`}));
      setData([...all]);
      await new Promise(r=>setTimeout(r,150));
    }

    // ── KR Stocks ──
    setProgress(p=>({...p,phase:"🇰🇷 한국 주식 스캔 중..."}));
    for (let i=0; i<KR_SYMBOLS.length; i+=5) {
      const batch=KR_SYMBOLS.slice(i,i+5);
      const results=await Promise.allSettled(batch.map(fetchKRStock));
      results.forEach(r=>{if(r.status==="fulfilled"&&r.value)all.push(r.value);else failed.kr++;});
      setProgress(p=>({...p,current:US_SYMBOLS.length+Math.min(i+5,KR_SYMBOLS.length),phase:`🇰🇷 한국 (${Math.min(i+5,KR_SYMBOLS.length)}/${KR_SYMBOLS.length})`}));
      setData([...all]);
      await new Promise(r=>setTimeout(r,150));
    }

    // ── Crypto ──
    setProgress(p=>({...p,phase:"₿ 크립토 스캔 중..."}));
    for (let i=0; i<CRYPTO_IDS.length; i++) {
      try {
        const asset=await fetchCryptoAsset(CRYPTO_IDS[i]);
        all.push(asset);
      } catch { failed.crypto++; }
      setProgress(p=>({...p,current:US_SYMBOLS.length+KR_SYMBOLS.length+i+1,phase:`₿ 크립토 (${i+1}/${CRYPTO_IDS.length})`}));
      setData([...all]);
      await new Promise(r=>setTimeout(r,700)); // CoinGecko 레이트리밋 대응
    }

    setData(all);
    setFailedItems(failed);
    setLastUpdated(new Date());
    setIsLoading(false);
    setProgress({current:0,total:0,phase:""});

    const total=all.length;
    const totalFail=failed.us+failed.kr+failed.crypto;
    if (totalFail===0) addToast(`✅ ${total}개 자산 실시간 데이터 로딩 완료`,"success",3000);
    else if (total>0) addToast(`⚠️ ${total}개 로딩 완료, ${totalFail}개 실패`,"warning",5000);
    else addToast("❌ 데이터 로딩 실패 — Vercel 배포 환경을 확인하세요","error",8000);
  },[addToast]);

  useEffect(()=>{loadData();},[loadData]);

  const filtered=useMemo(()=>{
    return data.filter(a=>{
      if(marketFilter!=="all"&&a.market!==marketFilter) return false;
      if(searchQuery){const q=searchQuery.toLowerCase();if(!a.symbol.toLowerCase().includes(q)&&!a.name.toLowerCase().includes(q)) return false;}
      if(activeConditions.length===0) return a.triggers.length>0;
      if(conditionMode==="or") return a.triggers.some(t=>activeConditions.includes(t));
      return activeConditions.every(c=>a.triggers.includes(c));
    }).sort((a,b)=>{
      if(sortBy==="score") return b.score-a.score||(a.rsi??999)-(b.rsi??999);
      if(sortBy==="rsi") return (a.rsi??999)-(b.rsi??999);
      if(sortBy==="change") return (a.weekChange??0)-(b.weekChange??0);
      if(sortBy==="volume") return (b.volRatio??0)-(a.volRatio??0);
      if(sortBy==="ma200") return Math.abs(a.ma200Dist??999)-Math.abs(b.ma200Dist??999);
      return 0;
    });
  },[data,marketFilter,activeConditions,conditionMode,sortBy,searchQuery]);

  const stats=useMemo(()=>({
    total:data.length,
    signals:data.reduce((a,d)=>a+d.triggers.length,0),
    rsiLow:data.filter(d=>d.rsi!=null&&d.rsi<=30).length,
    filtered:filtered.length,
    byMarket:{us:data.filter(d=>d.market==="us").length,kr:data.filter(d=>d.market==="kr").length,crypto:data.filter(d=>d.market==="crypto").length},
  }),[data,filtered]);

  const fmtPrice=a=>{if(!a.price) return "—";if(a.market==="kr") return `₩${Math.round(a.price).toLocaleString()}`;return `$${a.price.toLocaleString(undefined,{maximumFractionDigits:a.price<1?6:2})}`;};

  // ─── RENDER ───
  return (
    <div style={{minHeight:"100vh",background:"#060a12",color:"#f8fafc",fontFamily:"-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"}}>
      <style>{`
        @keyframes slideIn{from{opacity:0;transform:translateX(20px)}to{opacity:1;transform:translateX(0)}}
        @keyframes slideUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
        @keyframes glow{0%,100%{box-shadow:0 0 12px rgba(99,102,241,.15)}50%{box-shadow:0 0 24px rgba(99,102,241,.3)}}
        @keyframes prog{0%{background-position:-200% 0}100%{background-position:200% 0}}
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:5px;height:5px}
        ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:#1e293b;border-radius:3px}
        input:focus,select:focus{outline:none;border-color:#6366f1!important}
      `}</style>

      <ToastContainer toasts={toasts} onDismiss={dismissToast}/>

      {/* Header */}
      <header style={{background:"linear-gradient(180deg,#0c1120 0%,#060a12 100%)",borderBottom:"1px solid #12192a",padding:"16px 24px",position:"sticky",top:0,zIndex:100,backdropFilter:"blur(12px)"}}>
        <div style={{maxWidth:1440,margin:"0 auto"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10}}>
            <div>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <div style={{width:8,height:8,borderRadius:"50%",background:isLoading?"#475569":"#10b981",boxShadow:isLoading?"none":"0 0 8px #10b98180",animation:isLoading?"pulse 1s infinite":"none"}}/>
                <h1 style={{fontSize:18,fontWeight:700,letterSpacing:-0.5,color:"#f8fafc"}}>SIGNAL SCREENER</h1>
                <span style={{fontSize:9,color:"#475569",background:"#111827",padding:"2px 7px",borderRadius:4,fontWeight:600}}>LIVE</span>
              </div>
              <p style={{color:"#334155",fontSize:11,marginTop:2}}>실시간 데이터 · 주봉 기술적 지표 스크리너</p>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              {lastUpdated&&<span style={{fontSize:10,color:"#334155",fontFamily:"monospace"}}>{lastUpdated.toLocaleTimeString("ko-KR")}</span>}
              <button onClick={()=>setShowTelegram(true)} style={{background:"#111827",border:"1px solid #1e293b",color:"#94a3b8",padding:"7px 12px",borderRadius:8,fontSize:12,fontWeight:600,cursor:"pointer",display:"flex",alignItems:"center",gap:5}}>
                <span>📨</span> 텔레그램
              </button>
              <button onClick={loadData} disabled={isLoading} style={{background:isLoading?"#111827":"linear-gradient(135deg,#6366f1,#7c3aed)",border:"1px solid "+(isLoading?"#1e293b":"#6366f150"),color:"#fff",padding:"7px 16px",borderRadius:8,fontSize:12,fontWeight:600,cursor:isLoading?"not-allowed":"pointer",opacity:isLoading?.6:1,animation:isLoading?"none":"glow 2s infinite"}}>
                {isLoading?"스캔 중...":"새로고침"}
              </button>
            </div>
          </div>

          {isLoading&&progress.total>0&&(
            <div style={{marginTop:12}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                <span style={{fontSize:11,color:"#64748b"}}>{progress.phase}</span>
                <span style={{fontSize:10,color:"#475569",fontFamily:"monospace"}}>{progress.current}/{progress.total}</span>
              </div>
              <div style={{width:"100%",height:3,borderRadius:2,background:"#111827",overflow:"hidden"}}>
                <div style={{width:`${(progress.current/progress.total)*100}%`,height:"100%",background:"linear-gradient(90deg,#6366f1,#8b5cf6,#6366f1)",backgroundSize:"200% 100%",animation:"prog 1.5s linear infinite",transition:"width .3s"}}/>
              </div>
            </div>
          )}

          {!isLoading&&(
            <div style={{display:"flex",gap:10,marginTop:12,flexWrap:"wrap"}}>
              {[
                {label:"총 자산",value:stats.total,sub:`US ${stats.byMarket.us} · KR ${stats.byMarket.kr} · Crypto ${stats.byMarket.crypto}`},
                {label:"총 시그널",value:stats.signals,color:"#f59e0b"},
                {label:"RSI ≤ 30",value:stats.rsiLow,color:"#ef4444"},
                {label:"필터 결과",value:stats.filtered,color:"#6366f1"},
              ].map((s,i)=>(
                <div key={i} style={{background:"#0c1120",border:"1px solid #12192a",borderRadius:8,padding:"7px 14px",minWidth:90}}>
                  <div style={{fontSize:9,color:"#475569",marginBottom:2,letterSpacing:.5}}>{s.label}</div>
                  <span style={{fontSize:20,fontWeight:700,color:s.color||"#e2e8f0",fontFamily:"monospace"}}>{s.value}</span>
                  {s.sub&&<div style={{fontSize:9,color:"#1e293b",marginTop:1}}>{s.sub}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      </header>

      <main style={{maxWidth:1440,margin:"0 auto",padding:"14px 24px"}}>
        {/* Conditions */}
        <div style={{background:"#0a0f1a",border:"1px solid #12192a",borderRadius:11,padding:14,marginBottom:14}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,flexWrap:"wrap",gap:8}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:11,color:"#94a3b8",fontWeight:600}}>스크리닝 조건</span>
              <div style={{display:"inline-flex",background:"#0c1120",borderRadius:5,border:"1px solid #12192a",overflow:"hidden"}}>
                {[{id:"or",label:"OR"},{id:"and",label:"AND"}].map(m=>(
                  <button key={m.id} onClick={()=>setConditionMode(m.id)} style={{padding:"3px 10px",border:"none",fontSize:10,fontWeight:700,cursor:"pointer",background:conditionMode===m.id?"#6366f1":"transparent",color:conditionMode===m.id?"#fff":"#475569"}}>
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
            <button onClick={()=>setShowAddCondition(true)} style={{padding:"4px 11px",borderRadius:6,fontSize:11,fontWeight:600,background:"transparent",border:"1px dashed #1e293b",color:"#475569",cursor:"pointer"}}>+ 추가</button>
          </div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            {conditions.map(cond=>{
              const isActive=activeConditions.includes(cond.id);
              const count=data.filter(a=>a.triggers.includes(cond.id)).length;
              return (
                <button key={cond.id} onClick={()=>setActiveConditions(p=>p.includes(cond.id)?p.filter(c=>c!==cond.id):[...p,cond.id])} style={{display:"flex",alignItems:"center",gap:5,padding:"7px 12px",borderRadius:7,cursor:"pointer",background:isActive?cond.color+"10":"#0c1120",border:`1.5px solid ${isActive?cond.color+"40":"#12192a"}`,color:isActive?cond.color:"#475569",transition:"all .2s",fontSize:12}}>
                  <span style={{fontSize:13}}>{cond.icon}</span>
                  <span>{cond.label}</span>
                  <span style={{background:isActive?cond.color+"20":"#111827",padding:"0 5px",borderRadius:9,fontSize:10,fontWeight:700,fontFamily:"monospace",lineHeight:"16px"}}>{count}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Filters */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:11,flexWrap:"wrap",gap:8}}>
          <div style={{display:"flex",gap:2}}>
            {MARKET_TABS.map(tab=>(
              <button key={tab.id} onClick={()=>setMarketFilter(tab.id)} style={{padding:"5px 11px",borderRadius:5,border:"none",fontSize:12,fontWeight:600,cursor:"pointer",background:marketFilter===tab.id?"#1e293b":"transparent",color:marketFilter===tab.id?"#f8fafc":"#334155"}}>
                {tab.icon} {tab.label}
              </button>
            ))}
          </div>
          <div style={{display:"flex",alignItems:"center",gap:7}}>
            <div style={{position:"relative"}}>
              <input value={searchQuery} onChange={e=>setSearchQuery(e.target.value)} placeholder="종목 검색..."
                style={{background:"#0c1120",border:"1px solid #12192a",borderRadius:6,padding:"5px 11px 5px 26px",color:"#e2e8f0",fontSize:12,width:150}}/>
              <span style={{position:"absolute",left:7,top:"50%",transform:"translateY(-50%)",color:"#334155",fontSize:11}}>🔍</span>
            </div>
            <select value={sortBy} onChange={e=>setSortBy(e.target.value)} style={{background:"#0c1120",border:"1px solid #12192a",color:"#94a3b8",padding:"5px 9px",borderRadius:6,fontSize:11,cursor:"pointer"}}>
              <option value="score">시그널 수</option>
              <option value="rsi">RSI 낮은순</option>
              <option value="change">주간 하락순</option>
              <option value="volume">거래량 높은순</option>
              <option value="ma200">200일선 근접순</option>
            </select>
          </div>
        </div>

        {/* Table */}
        {isLoading&&data.length===0?(
          <div style={{textAlign:"center",padding:80}}>
            <div style={{fontSize:44,marginBottom:14,animation:"pulse 1.5s infinite"}}>📡</div>
            <p style={{color:"#475569",fontSize:14}}>실시간 시장 데이터를 수집하고 있습니다...</p>
            <p style={{color:"#1e293b",fontSize:11,marginTop:6}}>Yahoo Finance · CoinGecko 연결 중</p>
          </div>
        ):filtered.length===0?(
          <div style={{textAlign:"center",padding:80}}>
            <div style={{fontSize:44,marginBottom:14}}>🔍</div>
            <p style={{color:"#475569",fontSize:14}}>조건에 맞는 자산이 없습니다</p>
            <p style={{color:"#334155",fontSize:12,marginTop:6}}>{conditionMode==="and"?"OR 모드로 전환하거나 ":""}조건을 조정해보세요</p>
          </div>
        ):(
          <div style={{background:"#0a0f1a",border:"1px solid #12192a",borderRadius:11,overflow:"hidden"}}>
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",minWidth:820}}>
                <thead>
                  <tr>
                    {["자산","차트","현재가","주간","RSI(14)","200일선","거래량","시그널"].map((h,i)=>(
                      <th key={i} style={{padding:"9px 11px",textAlign:i<2?"left":"center",fontSize:9,color:"#334155",fontWeight:700,letterSpacing:1,textTransform:"uppercase",borderBottom:"1px solid #12192a",background:"#080d18"}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((asset,idx)=>(
                    <tr key={asset.symbol+asset.market} onClick={()=>setSelectedAsset(asset)}
                      style={{borderBottom:"1px solid #0e1422",cursor:"pointer",animation:`slideUp .2s ease ${Math.min(idx*12,250)}ms both`}}
                      onMouseEnter={e=>e.currentTarget.style.background="#0e1422"}
                      onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                      <td style={{padding:"9px 11px"}}>
                        <div style={{display:"flex",alignItems:"center",gap:8}}>
                          <div style={{width:30,height:30,borderRadius:6,flexShrink:0,background:asset.market==="us"?"#0c1e36":asset.market==="kr"?"#1e0c0c":"#0c1e14",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12}}>
                            {asset.market==="us"?"🇺🇸":asset.market==="kr"?"🇰🇷":"₿"}
                          </div>
                          <div>
                            <div style={{fontWeight:600,fontSize:12,color:"#e2e8f0",fontFamily:"monospace"}}>{asset.symbol.replace(".KS","")}</div>
                            <div style={{fontSize:10,color:"#334155",maxWidth:110,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{asset.name}</div>
                          </div>
                        </div>
                      </td>
                      <td style={{padding:"9px 5px"}}><Sparkline data={asset.sparkline} color={asset.weekChange>=0?"#10b981":"#ef4444"}/></td>
                      <td style={{padding:"9px 11px",textAlign:"center"}}>
                        <span style={{fontFamily:"monospace",fontSize:12,fontWeight:600,color:"#e2e8f0"}}>{fmtPrice(asset)}</span>
                      </td>
                      <td style={{padding:"9px 11px",textAlign:"center"}}>
                        <span style={{fontFamily:"monospace",fontSize:12,fontWeight:600,color:(asset.weekChange??0)>=0?"#10b981":"#ef4444",background:(asset.weekChange??0)>=0?"#10b98110":"#ef444410",padding:"2px 6px",borderRadius:4}}>
                          {(asset.weekChange??0)>0?"+":""}{asset.weekChange??0}%
                        </span>
                      </td>
                      <td style={{padding:"9px 11px",textAlign:"center"}}><RSIGauge value={asset.rsi}/></td>
                      <td style={{padding:"9px 11px",textAlign:"center"}}>
                        <span style={{fontFamily:"monospace",fontSize:11,color:asset.ma200Dist!=null&&Math.abs(asset.ma200Dist)<=2?"#f59e0b":"#334155",fontWeight:asset.ma200Dist!=null&&Math.abs(asset.ma200Dist)<=2?600:400}}>
                          {asset.ma200Dist!=null?`${asset.ma200Dist>0?"+":""}${asset.ma200Dist}%`:"—"}
                        </span>
                      </td>
                      <td style={{padding:"9px 11px",textAlign:"center"}}>
                        <span style={{fontFamily:"monospace",fontSize:11,color:(asset.volRatio??0)>=2?"#f97316":"#334155",fontWeight:(asset.volRatio??0)>=2?600:400}}>{asset.volRatio??"—"}x</span>
                      </td>
                      <td style={{padding:"9px 11px",textAlign:"center"}}>
                        {asset.triggers.length>0?(
                          <div style={{display:"flex",gap:3,justifyContent:"center",flexWrap:"wrap"}}>
                            {asset.triggers.slice(0,3).map(t=><ConditionBadge key={t} condId={t} small conditions={conditions}/>)}
                            {asset.triggers.length>3&&<span style={{fontSize:10,color:"#475569"}}>+{asset.triggers.length-3}</span>}
                          </div>
                        ):<span style={{color:"#1e293b",fontSize:10}}>—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{padding:"8px 11px",borderTop:"1px solid #12192a",display:"flex",justifyContent:"space-between",alignItems:"center",background:"#080d18",flexWrap:"wrap",gap:8}}>
              <span style={{fontSize:10,color:"#334155"}}>{filtered.length}개 자산 · {conditionMode==="or"?"OR":"AND"} 모드 {isLoading?"· 로딩 중...":""}</span>
              <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                {conditions.slice(0,5).map(c=>(
                  <div key={c.id} style={{display:"flex",alignItems:"center",gap:3}}>
                    <span style={{width:5,height:5,borderRadius:"50%",background:c.color}}/>
                    <span style={{fontSize:9,color:"#334155"}}>{c.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>

      {selectedAsset&&<ChartModal asset={selectedAsset} onClose={()=>setSelectedAsset(null)} conditions={conditions}/>}
      {showAddCondition&&<AddConditionModal onAdd={c=>{setConditions(p=>[...p,c]);setShowAddCondition(false);}} onClose={()=>setShowAddCondition(false)}/>}
      {showTelegram&&<TelegramPanel assets={filtered} conditions={conditions} onClose={()=>setShowTelegram(false)}/>}
    </div>
  );
}
