#!/usr/bin/env python3
"""
DI금융 저녁 종합 리포트 생성기
- 최신 백테스트 결과를 읽어 개선된 텔레그램 메시지 포맷으로 출력
- 장 마감 후 저녁 전략 업데이트용
"""

import json
import os
import glob
from datetime import datetime

REPORT_DIR = os.path.join(os.path.dirname(__file__), "..", "quant-reports")


def find_latest_backtest():
    """Find the most recent backtest JSON result"""
    pattern = os.path.join(REPORT_DIR, "data-*-backtest.json")
    files = sorted(glob.glob(pattern), key=os.path.getmtime, reverse=True)
    return files[0] if files else None


def generate_evening_report(results, date_str):
    """Generate structured evening telegram report"""
    if not results:
        return "⚠️ 백테스트 데이터 없음"

    # Aggregate stats
    total = len(results)
    returns = [r['return'] for r in results]
    avg_ret = sum(returns) / total
    sorted_rets = sorted(returns)
    median_ret = sorted_rets[total // 2]
    winning = sum(1 for r in returns if r > 0)
    avg_bnh = sum(r['bnh'] for r in results) / total
    alpha_pos = sum(1 for r in results if r['alpha'] > 0)
    avg_sharpe = sum(r['sharpe'] for r in results) / total
    avg_mdd = sum(r['mdd'] for r in results) / total

    # Signal
    if avg_ret > 10:
        signal = "🟢 적극 매수 시장"
    elif avg_ret > 3:
        signal = "🟡 매수 우위"
    elif avg_ret > -3:
        signal = "⚪ 중립 (관망)"
    elif avg_ret > -10:
        signal = "🟠 매도 우위"
    else:
        signal = "🔴 적극 매도 시장"

    # Top performers
    by_return = sorted(results, key=lambda x: x['return'], reverse=True)
    by_alpha = sorted(results, key=lambda x: x['alpha'], reverse=True)
    by_sharpe = sorted([r for r in results if r['num_trades'] >= 3], key=lambda x: x['sharpe'], reverse=True)
    worst = sorted(results, key=lambda x: x['return'])[:3]

    # Category aggregation
    categories = {}
    for r in results:
        cat = r.get('category', '기타')
        if cat not in categories:
            categories[cat] = {'returns': [], 'wins': 0, 'count': 0}
        categories[cat]['returns'].append(r['return'])
        categories[cat]['count'] += 1
        if r['return'] > 0:
            categories[cat]['wins'] += 1

    cat_summary = []
    for cat, data in categories.items():
        avg = sum(data['returns']) / len(data['returns'])
        win_pct = data['wins'] / data['count'] * 100
        cat_summary.append((cat, avg, win_pct))
    cat_summary.sort(key=lambda x: x[1], reverse=True)

    # Best per ticker
    ticker_best = {}
    for r in results:
        t = r['ticker']
        if t not in ticker_best or r['return'] > ticker_best[t]['return']:
            ticker_best[t] = r
    ticker_sorted = sorted(ticker_best.values(), key=lambda x: x['return'], reverse=True)[:8]

    # Consistent strategies (Sharpe > 0.5 AND win rate > 50%)
    consistent = [r for r in results if r['sharpe'] > 0.5 and r['win_rate'] > 50]

    msg = f"""🌙 DI퀀트 저녁 전략 리포트
📅 {date_str} | {signal}

┌─ 📈 성과 요약 ──────────
│ 수익률  {avg_ret:+.1f}% (중앙값 {median_ret:+.1f}%)
│ 승  률  {winning}/{total} ({winning/total*100:.0f}%)
│ B&H     {avg_bnh:+.1f}%
│ 알파+   {alpha_pos}건 ({alpha_pos/total*100:.0f}%)
│ Sharpe  {avg_sharpe:.2f} | MDD {avg_mdd:.1f}%
└─────────────────────────

┌─ 🏆 TOP 5 절대수익 ─────
"""
    for i, r in enumerate(by_return[:5], 1):
        star = "⭐" if r['sharpe'] > 1.0 else ""
        msg += f"│ {i}. {r['strategy_name']}|{r['ticker']}\n│    {r['return']:+.1f}% S:{r['sharpe']:.1f} WR:{r['win_rate']:.0f}% {star}\n"
    msg += "└─────────────────────────\n"

    msg += "\n┌─ 🎯 TOP 5 알파 ─────────\n"
    for i, r in enumerate(by_alpha[:5], 1):
        msg += f"│ {i}. {r['strategy_name']}|{r['ticker']}: α{r['alpha']:+.1f}%\n"
    msg += "└─────────────────────────\n"

    if by_sharpe:
        msg += "\n┌─ 🛡️ TOP 3 위험조정 (Sharpe) ─\n"
        for i, r in enumerate(by_sharpe[:3], 1):
            msg += f"│ {i}. {r['strategy_name']}|{r['ticker']}: S:{r['sharpe']:.2f} ({r['return']:+.1f}%)\n"
        msg += "└─────────────────────────\n"

    msg += "\n┌─ ⚠️ WORST 3 ────────────\n"
    for i, r in enumerate(worst, 1):
        msg += f"│ {i}. {r['strategy_name']}|{r['ticker']}: {r['return']:+.1f}% MDD:{r['mdd']:.1f}%\n"
    msg += "└─────────────────────────\n"

    msg += "\n┌─ 📊 카테고리 성과 ───────\n"
    for cat, avg, win_pct in cat_summary:
        bar = "█" * max(1, int(win_pct / 10))
        trend = "↑" if avg > 0 else "↓"
        msg += f"│ {cat}: {avg:+.1f}%{trend} (승률 {win_pct:.0f}%) {bar}\n"
    msg += "└─────────────────────────\n"

    msg += "\n┌─ 🔍 종목별 최적전략 ─────\n"
    for r in ticker_sorted:
        rsi_val = r.get('rsi', 50)
        if rsi_val > 70:
            emoji = "🔴"
        elif rsi_val < 30:
            emoji = "🟢"
        else:
            emoji = "⚪"
        msg += f"│ {emoji} {r['ticker']}: {r['strategy_name']}\n│    {r['return']:+.1f}% α{r['alpha']:+.1f}% RSI:{rsi_val:.0f}\n"
    msg += "└─────────────────────────\n"

    msg += f"""
┌─ 📋 리스크 & 인사이트 ──
│ 안정 전략: {len(consistent)}건 (S>0.5+WR50%↑)
│ 전략: {len(set(r['strategy_id'] for r in results))}개
│ 종목: {len(set(r['ticker'] for r in results))}개
└─────────────────────────
🤖 DI금융 퀀트 연구소"""

    return msg


def main():
    date_str = datetime.now().strftime("%Y-%m-%d")
    json_file = find_latest_backtest()

    if not json_file:
        print("⚠️ 백테스트 결과 파일을 찾을 수 없습니다.")
        return

    print(f"📂 데이터: {json_file}")
    with open(json_file, 'r') as f:
        results = json.load(f)

    msg = generate_evening_report(results, date_str)

    # Save
    out_path = os.path.join(REPORT_DIR, f"telegram-pending-{date_str}-evening.txt")
    with open(out_path, 'w') as f:
        f.write(msg)

    print(f"✅ 저녁 리포트 생성: {out_path}")
    print()
    print(msg)


if __name__ == "__main__":
    main()
