# UI Components — the `.qtw-*` Workstation library

All components are built by `engine/qt-card.js` and styled in `dashboard.html`.
They are pure renderers of the recommendation object. Class prefix: `.qtw-*`.

## Primitives / helpers (qt-card.js)
| Helper | Purpose |
|---|---|
| `h(tag, props, children)` | Hyperscript DOM builder (class/text/dataset/events). |
| `svg(tag, attrs)` | SVG element builder (`createElementNS`). |
| `pct/num/signed/price/dash/timeStr/titleCase` | Presentational formatters. |
| `toneForCode(code)` | Maps a recommendation code → `{tone, intensity}`. |
| `badgeFor(name)` | Maps an evidence string → short badge label (CHoCH, BOS, OB…). |
| `ring / gauge` | Inline-SVG donut gauges (stroke-dasharray geometry). |
| `signedBar / unsignedBar` | Bidirectional / unidirectional progress bars. |
| `section(id, level, title, opts)` | `<details>` card shell (opts: open, wide, scope, meta). |
| `chip / statusIcon` | Pill badges and pass/fail/info gate icons. |

## Sections (rendered in this order)
| Section | `data-section` | Level | Scope | Notes |
|---|---|---|---|---|
| Hero | (section, not a card) | L1 | both | Label, tone icon, confidence ring, profile/band chips, **trend line** (direction · N candles · timeframe), facts grid, and the **executive trade ladder** (Current · Entry · Stop · TP1–3). |
| Executive Summary | `executive` | L1 | both | `explanations.executive` verbatim + primary reason + limiting factor. |
| Market Health | `health` | L2 | both* | 8 gauges; Capability Coverage and Risk Quality are analyst-only. |
| Trade Setup | `trade` | L2 | both | Ticket (entry/stop/targets) or graceful no-trade card; R:R, EV, ATR, S/R, Fibonacci, confluence. |
| Market Structure | `structure` | L2 | analyst | Swing timeline (HH/HL/LH/LL) + SMC event chips. |
| Score Breakdown | `scores` | L2 | analyst | One bar per contribution; excluded categories listed. |
| Confidence Breakdown | `confidence` | L2 | analyst | Agreement / evidence quality / data coverage + MTF delta. |
| Evidence | `evidence` | L2 | both | Supporting vs opposing chips. |
| Qualification Gates | `gates` | L2 | both | Trader Mode: one-line summary; Analyst Mode: full checklist. |
| Multi-Timeframe Consensus | `mtf` | L2 | both | Action + reason verbatim + consensus facts. |
| Warnings | `warnings` | L3 | both | Grouped by source; omitted entirely when empty. |
| Technical Details | `technical` | L4 | analyst | Full contribution table + raw explanation (closed by default). |
| Engine Inspection | `inspection` | L5 | analyst | Version metadata + raw inspection payload (closed by default). |

\* individual gauges within Market Health can be analyst-only.

## Hero trade ladder (v1.1-final)
`.qtw-hero-strip` renders one `.qtw-hs-cell` per value, read verbatim from
`rec.trade`:
- **Current** — from the optional render `context.price` (last close).
- **Entry** — `rec.trade.entry.price`.
- **Stop** — `rec.trade.stop.price`, labelled with `rec.trade.stop.id` (the
  engine exposes a **single** tiered stop; there is no SL1/SL2/SL3 ladder, so
  exactly one stop cell is rendered — never fabricated).
- **TP1 / TP2 / TP3** — `rec.trade.targets[].price`.
When there is no executable trade, the strip shows only the current price and a
"No executable trade" note.

## Shell components (dashboard.html)
| Component | Class / id | Notes |
|---|---|---|
| Workspace switcher | `.workspace-switch` / `.ws-btn` | `role="tablist"`; last control in the header row. |
| Trader/Analyst toggle | `.qtw-mode-toggle` | `role="radiogroup"`; in the controls bar; styled to match Analyze (green gradient, control height). |
| Connection chip | `.conn-chip` / `#connState` / `#connDot` | Real observed proxy state (idle/connecting/connected/unreachable). |
| Symbol selector | `.symbol-select` | Custom accessible listbox; simplified to logo + pair label. |
| Mobile hamburger | `.nav-toggle` / `#navToggle` | Collapses the controls bar below 760px; animates to an X. |
| Empty state | `.qtw-empty` | Welcoming Keen Eye placeholder before first analysis. |

## Colour / tone system
`bull`=green, `bear`=red, `warn`=amber, `info`=blue, `ai`=purple (confidence/AI),
`neutral`=grey. Each has a solid and a soft (background) variant. All text tones
verified ≥4.5:1 (AA) or the low-emphasis text uses the lightened
`--qtw-text-faint/-muted` tokens.

## Accessibility
- Native `<details>/<summary>`, `<button>`, radio/label pairs → keyboard and
  screen-reader support without custom ARIA plumbing.
- `role="tablist"/"tab"/"tabpanel"` on workspaces; `role="radiogroup"` on the
  mode toggle; `aria-controls`/`aria-expanded` on the hamburger; `aria-current`
  on the selected symbol option; `aria-live="polite"` on the analysis card.
- One `<h1>` (brand); hero label is `<h2>`; card titles are `<h3>` — no skipped
  levels.
- Visible focus rings on all interactive controls; global reduced-motion.
