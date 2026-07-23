# UI Test Results — Presentation Layer

Run: `npm test` (or `node tests/run-all.js`). Environment: Node ≥18, jsdom
(dev-only). Deterministic; no network.

## Totals
- **Whole suite: 1604 / 1604 assertions passing** (all phases).
- **Presentation layer (Phase 8 + 8.5–8.8): 408 assertions**, all passing.

## Presentation suites (`tests/phase8-presentation.test.js`)
| Suite | Assertions |
|---|---|
| Phase 8 — Architecture boundary | 21 |
| Phase 8 — Structural contract (tradeable) | 53 |
| Phase 8 — Market Health gauges | 4 |
| Phase 8 — Trade Setup ticket | 8 |
| Phase 8 — Graceful degradation (no trade) | 6 |
| Phase 8 — Market Structure timeline | 3 |
| Phase 8 — Score & Confidence breakdown | 12 |
| Phase 8 — Evidence panels | 2 |
| Phase 8 — Qualification gates | 16 |
| Phase 8 — MTF panel | 3 |
| Phase 8 — Warnings | 2 |
| Phase 8 — Technical Details & Engine Inspection | 5 |
| Phase 8 — Render-context extension (current price) | 4 |
| Phase 8 — Rendering behaviour & invariants | 15 |
| Phase 8.5 — Dual modes: defaults & persistence | 2 |
| Phase 8.5 — Mode switching: no rebuild, no re-analysis | 29 |
| Phase 8.5 — Header toggle: markup, a11y, responsiveness | 13 |
| Phase 8.5 — UX audit: condensed gates, no layout gaps | 24 |
| Phase 8.5 — UI freeze: every recommendation code in both modes | 52 |
| Phase 8.5 — UI freeze: real engine-produced scenarios | 7 |
| Phase 8.5 — UI freeze: heading semantics & contrast | 28 |
| Phase 8.6 — Two-workspace layout | 44 |
| Phase 8.7 — UX polish: persistence, empty state, focus | 30 |
| Phase 8.8 — v1.1-final: hero executive summary | 14 |
| Phase 8.8 — v1.1-final: header & control refinement | 11 |

## What is verified by tests (automated)
- **Architecture boundary** — the renderer/app/inline-script contain no
  analytical calls, no `Math.random`, no API-key handling.
- **Contract fidelity** — every rendered value traces to a recommendation-object
  field; the recommendation object is never mutated by the renderer.
- **All 13 recommendation codes** render in both modes without throwing, with the
  correct tone. Real STRONG_SELL and DATA_INSUFFICIENT fixtures render safely.
- **Mode switching** performs zero engine calls and no DOM rebuild (byte-identical
  markup aside from the mode attribute; a spy proves `QT.recommendation.build`
  is not called).
- **Persistence** — symbol/interval/profile/style/workspace/mode keys are wired;
  restore runs before first paint; the restore/save path calls no engine.
- **Hero executive summary** — trend line uses `rec.trend.barsInState`; the trade
  ladder reads verbatim from `rec.trade`; **exactly one** stop id appears (never a
  fabricated SL1/2/3); degrades to current-price-only with no trade.
- **Header refinement** — workspace switcher last in the header; mode toggle in
  the controls with Analyze styling; hamburger accessible; connection chip in the
  header.
- **Accessibility** — single `<h1>`, hero `<h2>`, card `<h3>` (no skipped levels);
  low-emphasis text ≥4.5:1 AA contrast (computed in-test); reduced-motion rule
  present and global.

## What is verified by real-browser measurement (DevTools Protocol)
Driven against the **real** `dashboard.html`, injecting a synthetic
recommendation through the page's already-loaded engine (no proxy needed):
- **Zero horizontal overflow and zero page-level vertical scroll** at
  **390 / 768 / 1024 / 1366 / 1600 / 1920 px**, in both workspaces and both modes
  (`scrollWidth === clientWidth` and `scrollHeight === clientHeight`).
- Enhanced hero (trend line + trade ladder), dominant chart (Charts), mode toggle
  in controls, workspace switcher at header end, and the mobile hamburger
  open/closed states all render correctly. Screenshots captured during
  verification.

## Not covered by automated tests (verified manually / out of scope)
- The live TradingView chart/ticker require network; in CI they render their own
  loading state. Layout is verified regardless of whether they finish loading.
- Real proxy round-trips (Analyze against a running proxy) — the proxy server is
  not part of this repository snapshot; the inline `Analyze` path is unit-tested
  for delegation and connection-state handling only.
