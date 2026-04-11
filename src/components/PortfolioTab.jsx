/**
 * PortfolioTab — 포트폴리오 탭 컴포넌트
 * App.jsx에서 분리된 포트폴리오 관리 UI
 */
import { memo } from "react";
import { useLanguage } from "@/i18n/LanguageContext";

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
  return (
    <div className="tab-content">
      {/* 요약 헤더 */}
      <div className="rounded-[18px] p-[22px_24px] mb-4" style={{
        background: `linear-gradient(135deg, ${C.card}, #0d1f35)`,
        border: `1px solid ${C.border}20`,
      }}>
        <div className={`flex justify-between items-center ${portfolio.length ? "mb-4" : ""}`}>
          <div className="font-bold text-lg" style={{ color: C.text1 }}>{t("portfolio.myPortfolio")}</div>
          <div className="flex gap-1.5 flex-wrap">
            <button onClick={() => setCurrency(c => c === "USD" ? "KRW" : "USD")} className="rounded-lg px-2.5 py-1.5 text-base font-bold transition-all" style={{
              background: C.card2, color: C.yellow, border: `1px solid ${C.yellow}44`,
            }}>{currency === "USD" ? t("portfolio.currencyUSD") : t("portfolio.currencyKRW")}</button>
            <button onClick={fetchPortfolioPrices} className="rounded-lg px-3 py-1.5 text-base font-semibold transition-all" style={{
              background: C.blueBg, color: C.blue, border: `1px solid ${C.blue}44`,
            }}>{portfolioLoading ? t("portfolio.refreshing") : t("portfolio.refreshBtn")}</button>
            <button onClick={() => setShowAddAsset(true)} className="rounded-lg px-3.5 py-1.5 text-base font-bold transition-all" style={{
              background: C.blue, color: "#fff", border: "none",
            }}>+ {t("portfolio.addBtn")}</button>
          </div>
        </div>
        {portfolio.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            {[
              { label: t("portfolio.invested"), value: currency === "KRW" ? `₩${Math.round(pStats.invested * krwRate).toLocaleString()}` : `$${pStats.invested.toLocaleString(undefined, { maximumFractionDigits: 0 })}` },
              { label: t("portfolio.current"), value: pStats.hasPrices ? (currency === "KRW" ? `₩${Math.round(pStats.current * krwRate).toLocaleString()}` : `$${pStats.current.toLocaleString(undefined, { maximumFractionDigits: 0 })}`) : "—" },
              { label: t("portfolio.pnl"), value: pStats.hasPrices ? `${pStats.pnl >= 0 ? "+" : ""}${currency === "KRW" ? `₩${Math.round(Math.abs(pStats.pnl) * krwRate).toLocaleString()}` : `$${pStats.pnl.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}` : "—", color: pStats.pnl >= 0 ? C.green : C.red },
            ].map(({ label, value, color }) => (
              <div key={label} className="rounded-xl p-3.5" style={{ background: C.bg }}>
                <div className="text-base mb-1" style={{ color: C.text3 }}>{label}</div>
                <div className="font-bold text-lg" style={{ color: color || C.text1 }}>{value}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 자산 추가 폼 */}
      {showAddAsset && (
        <div className="rounded-[18px] p-[22px_24px] mb-4" style={{ background: C.card, border: `1px solid ${C.border}20` }}>
          <div className="font-bold mb-3.5 text-lg" style={{ color: C.text1 }}>📌 {t("portfolio.addAsset")}</div>
          <div className="mb-3">
            <div className="text-base mb-1.5" style={{ color: C.text3 }}>{t("portfolio.searchSymbol")}</div>
            <SearchBarWrapper SearchBar={SearchBar} placeholder={t("portfolio.symbolPlaceholder")} onSelect={(asset) => {
              const sym = asset.symbol.toUpperCase();
              setNewAsset(p => ({
                ...p,
                symbol: sym,
                name: asset.name,
                market: asset.market,
              }));
            }} />
          </div>
          <div className="grid grid-cols-2 gap-2.5 mb-3">
            {[
              { k: "symbol",   label: t("portfolio.symbolPlaceholder").split(",")[0], ph: t("portfolio.symbolPlaceholder") },
              { k: "name",     label: t("portfolio.nameLabel"), ph: t("portfolio.namePlaceholder") },
              { k: "qty",      label: t("portfolio.qtyLabel"), ph: t("portfolio.qtyPlaceholder") },
              { k: "avgPrice", label: t("portfolio.avgPriceLabel"), ph: t("portfolio.avgPricePlaceholder") },
            ].map(({ k, label, ph }) => (
              <div key={k}>
                <div className="text-base mb-1" style={{ color: C.text3 }}>{label}</div>
                <input value={newAsset[k]} onChange={e => setNewAsset(p => ({ ...p, [k]: e.target.value }))}
                  placeholder={ph} className="w-full px-3 py-2 rounded-[10px] text-lg outline-none box-border" style={{
                    background: C.bg, border: `1px solid ${C.border2}`, color: C.text1,
                  }} />
              </div>
            ))}
          </div>
          <div className="mb-3">
            <div className="text-base mb-1.5" style={{ color: C.text3 }}>{t("portfolio.marketLabel")}</div>
            <div className="flex gap-1.5">
              {[["us",t("portfolio.marketUS")], ["kr",t("portfolio.marketKR")], ["crypto",t("portfolio.marketCrypto")]].map(([v, l]) => (
                <button key={v} onClick={() => setNewAsset(p => ({ ...p, market: v }))} className="rounded-lg px-3.5 py-1.5 text-base font-semibold transition-all" style={{
                  background: newAsset.market === v ? C.blueBg : C.card2,
                  color: newAsset.market === v ? C.blue : C.text3,
                  border: `1px solid ${newAsset.market === v ? C.blue : C.border2}`,
                }}>{l}</button>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => {
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
            }} className="flex-1 rounded-[10px] px-5 py-2 text-lg font-bold border-none transition-all" style={{
              background: C.blue, color: "#fff",
            }}>{t("portfolio.addBtn")}</button>
            <button onClick={() => setShowAddAsset(false)} className="flex-1 rounded-[10px] px-5 py-2 text-lg font-semibold transition-all" style={{
              background: C.card2, color: C.text3, border: `1px solid ${C.border2}`,
            }}>{t("portfolio.cancelBtn")}</button>
          </div>
        </div>
      )}

      {/* 포트폴리오 아이템 */}
      {portfolio.length === 0 ? (
        <div className="rounded-[18px] p-[40px_24px] text-center" style={{ background: C.card, border: `1px solid ${C.border}20` }}>
          <div className="text-4xl mb-3">💼</div>
          <div className="font-bold text-lg mb-2" style={{ color: C.text1 }}>{t("portfolio.startPortfolio")}</div>
          <div className="text-base mb-5" style={{ color: C.text3, lineHeight: 1.6 }}>
            {t("portfolio.startDesc")}
          </div>
          <div className="flex flex-col gap-2.5 max-w-80 mx-auto text-left">
            {[
              { icon: "1️⃣", text: t("portfolio.step1") },
              { icon: "2️⃣", text: t("portfolio.step2") },
              { icon: "3️⃣", text: t("portfolio.step3") },
            ].map((step, i) => (
              <div key={i} className="flex items-center gap-2.5 p-2.5 rounded-[10px]" style={{ background: C.card2 }}>
                <span className="text-base">{step.icon}</span>
                <span className="text-base" style={{ color: C.text2, fontWeight: 500 }}>{step.text}</span>
              </div>
            ))}
          </div>
          <div className="mt-5 flex gap-2 justify-center">
            <button onClick={() => setTab("screener")} className="px-5 py-2 rounded-[10px] text-base font-bold cursor-pointer transition-all" style={{
              background: C.blueBg, color: C.blue, border: `1px solid ${C.blue}30`,
            }}>{t("portfolio.screener")}</button>
            <button onClick={() => setTab("quant-report")} className="px-5 py-2 rounded-[10px] text-base font-bold cursor-pointer transition-all" style={{
              background: C.card2, color: C.text2, border: `1px solid ${C.border}`,
            }}>{t("portfolio.report")}</button>
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
            const mcBg = item.market === "us" ? "#1A2C4F" : item.market === "kr" ? "#1A2A1E" : "#1E1A2A";
            const flag = item.market === "us" ? "🇺🇸" : item.market === "kr" ? "🇰🇷" : "₿";
            return (
              <div key={idx} className="rounded-[18px] overflow-hidden" style={{
                background: C.card, border: `1px solid ${C.border}20`,
              }}>
                <div className="flex items-center p-4 gap-3.5">
                  <div className="size-11 rounded-xl flex-shrink-0 flex items-center justify-center font-black text-sm" style={{
                    background: mcBg, color: mcColor,
                  }}>
                    {item.symbol.replace(".KS","").slice(0,4)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-bold text-lg" style={{ color: C.text1 }}>{item.name || item.symbol}</span>
                      <span className="text-base" style={{ color: C.text3 }}>{flag} {item.symbol}</span>
                    </div>
                    <div className="text-lg" style={{ color: C.text3 }}>
                      {item.qty.toLocaleString()} {t("portfolio.shares")} · {t("portfolio.avgPrice")} {toDisplay(item.avgPrice, item.market)}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="font-bold text-lg mb-0.5" style={{ color: C.text1 }}>
                      {toDisplay(cur, item.market)}
                    </div>
                    {gain != null && (
                      <div className="text-lg font-bold" style={{ color: isPos ? C.green : C.red }}>
                        {isPos ? "+" : ""}{gain.toFixed(2)}%
                      </div>
                    )}
                  </div>
                </div>

                {cur != null && (
                  <div className="grid grid-cols-3 gap-1.5 px-4.5 pb-3 text-base">
                    <div className="rounded-lg p-2.5" style={{ background: C.bg }}>
                      <div className="mb-0.5" style={{ color: C.text3 }}>{t("portfolio.investedAmount")}</div>
                      <div className="font-bold text-lg" style={{ color: C.text1 }}>
                        {toDisplay(invested, item.market)}
                      </div>
                    </div>
                    <div className="rounded-lg p-2.5" style={{ background: C.bg }}>
                      <div className="mb-0.5" style={{ color: C.text3 }}>{t("portfolio.evaluatedAmount")}</div>
                      <div className="font-bold text-lg" style={{ color: C.text1 }}>
                        {toDisplay(evalVal, item.market)}
                      </div>
                    </div>
                    <div className="rounded-lg p-2.5" style={{ background: isPos ? C.greenBg : C.redBg }}>
                      <div className="mb-0.5" style={{ color: C.text3 }}>{t("portfolio.profitLoss")}</div>
                      <div className="font-bold text-lg" style={{ color: isPos ? C.green : C.red }}>
                        {isPos ? "+" : ""}{toDisplay(Math.abs(gainVal), item.market)}
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex gap-2 px-4.5 pb-3.5">
                  <button onClick={() => {
                    const cryptoA = CRYPTO_ASSETS.find(c => c.symbol === item.symbol);
                    setSelectedAsset({
                      symbol: item.symbol, name: item.name || item.symbol,
                      market: item.market, symbolRaw: item.symbolRaw || item.symbol,
                      ...(cryptoA ? { id: cryptoA.id } : {}),
                    });
                  }} className="flex-1 py-2 rounded-[10px] text-base font-semibold transition-all flex items-center justify-center gap-1.5" style={{
                    background: C.blueBg, color: C.blue, border: `1px solid ${C.blue}33`,
                  }}>{t("portfolio.diagnostic")}</button>
                  <button onClick={() => {
                    const sym = item.market === "crypto"
                      ? `https://www.coingecko.com/en/coins/${item.cryptoId || item.symbol.toLowerCase()}`
                      : `https://finance.yahoo.com/quote/${item.symbolRaw || item.symbol}`;
                    window.open(sym, "_blank");
                  }} className="flex-1 py-2 rounded-[10px] text-base font-semibold transition-all flex items-center justify-center gap-1.5" style={{
                    background: C.card2, color: C.text2, border: `1px solid ${C.border2}`,
                  }}>{t("portfolio.detail")}</button>
                  <button onClick={() => {
                    if (!confirm(t("portfolio.deleteConfirm"))) return;
                    setPortfolio(p => p.filter((_, i) => i !== idx));
                  }} className="px-3.5 py-2 rounded-[10px] text-base font-semibold transition-all" style={{
                    background: C.redBg, color: C.red, border: `1px solid ${C.red}33`,
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
