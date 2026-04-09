// ══════════════════════════════════════════════════════════════════
// Zepta Icons — lightweight inline SVGs (stroke-based, lucide-style)
// ══════════════════════════════════════════════════════════════════
import React from "react";

const base = {
  xmlns: "http://www.w3.org/2000/svg",
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

function make(children) {
  return function Icon({ size = 18, ...p }) {
    return (
      <svg {...base} width={size} height={size} {...p}>
        {children}
      </svg>
    );
  };
}

export const Play      = make(<polygon points="6 3 20 12 6 21 6 3" />);
export const Stop      = make(<rect x="5" y="5" width="14" height="14" rx="2" />);
export const Pause     = make(<><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></>);
export const Refresh   = make(<><path d="M21 12a9 9 0 0 1-15 6.7L3 16" /><path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><polyline points="21 3 21 8 16 8" /><polyline points="3 21 3 16 8 16" /></>);
export const Power     = make(<><path d="M12 2v10" /><path d="M18.4 6.6a9 9 0 1 1-12.77.04" /></>);
export const Shield    = make(<path d="M12 2 4 5v7c0 5 3.4 9.5 8 10 4.6-.5 8-5 8-10V5l-8-3z" />);
export const Ghost     = make(<path d="M9 10h.01M15 10h.01M12 2a7 7 0 0 1 7 7v10l-3-2-2 2-2-2-2 2-2-2-3 2V9a7 7 0 0 1 7-7z" />);
export const Gauge     = make(<><path d="M12 14 16 10" /><circle cx="12" cy="14" r="8" /></>);
export const Alert     = make(<><circle cx="12" cy="12" r="10" /><path d="M12 8v4" /><path d="M12 16h.01" /></>);
export const Check     = make(<polyline points="20 6 9 17 4 12" />);
export const Cross     = make(<><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>);
export const ArrowUp   = make(<><line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" /></>);
export const ArrowDown = make(<><line x1="12" y1="5" x2="12" y2="19" /><polyline points="19 12 12 19 5 12" /></>);
export const TrendUp   = make(<><polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" /></>);
export const TrendDown = make(<><polyline points="22 17 13.5 8.5 8.5 13.5 2 7" /><polyline points="16 17 22 17 22 11" /></>);
export const Flask     = make(<><path d="M10 2v7.5L4.5 20A2 2 0 0 0 6.2 23h11.6A2 2 0 0 0 19.5 20L14 9.5V2" /><line x1="8" y1="2" x2="16" y2="2" /></>);
export const Lock      = make(<><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>);
export const Unlock    = make(<><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8-0.8" /></>);
export const Settings  = make(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></>);
export const Sun       = make(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" /></>);
export const Moon      = make(<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />);
export const ChevronR  = make(<polyline points="9 18 15 12 9 6" />);
export const ChevronD  = make(<polyline points="6 9 12 15 18 9" />);
export const Info      = make(<><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></>);
export const Zap       = make(<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />);
export const Activity  = make(<polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />);
export const Target    = make(<><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></>);
export const Wallet    = make(<><path d="M20 12V8H6a2 2 0 0 1 0-4h12v4" /><path d="M4 6v12a2 2 0 0 0 2 2h14v-4" /><circle cx="18" cy="14" r="1.2" /></>);
export const Menu      = make(<><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></>);
export const Copy      = make(<><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>);
