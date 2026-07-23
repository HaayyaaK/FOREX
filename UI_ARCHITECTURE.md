# UI Architecture — Presentation Layer

## The boundary (non-negotiable)

```
Market data (proxy)
      ↓
Engine pipeline  (engine/qt-indicators … qt-recommendation)  — ALL analysis
      ↓
Recommendation Object  (plain JSON, the single contract)
      ↓
Card Renderer  (engine/qt-card.js)  — reads the object, draws it
      ↓
Presentation Layer  (dashboard.html: shell, CSS, wiring)
```

**The presentation layer never performs analysis.** It does not recalculate an
indicator, recompute a score, infer a missing value, or reinterpret a
recommendation. The only transformations it performs are presentational:

- number → string formatting,
- value → pixel/percentage scaling (bars, rings, gauges),
- already-produced text → icon/tone classification (e.g. mapping a
  recommendation code to a colour, or an evidence string to a short badge).

This boundary is enforced by tests: `qt-card.js` is grepped to prove it never
calls `QT.indicators`, `QT.scoring.score`, `QT.recommendation.build`, etc., and
never uses `Math.random` / `Math.log` / `Math.exp`. See
[UI_TEST_RESULTS.md](UI_TEST_RESULTS.md).

### The one deliberate, documented extension
`qt-card.js`'s `CARD.render(container, rec, context)` accepts an **optional**
third argument `context = { price, priceTime }`. This is a display-only value
(the last fetched close) forwarded by `qt-app.js` from data it already holds. It
is **not** part of the recommendation contract; the engine's JSON is unchanged.
When omitted, the hero simply shows no reference price. This is the only value
the renderer reads that does not come from the recommendation object.

---

## Application shell (`dashboard.html`)

```
<body>  (height:100%, overflow:hidden — the browser viewport never scrolls)
  .app  [data-workspace="charts|keeneye"]  (100dvh flex column)
    .app-header  (flex:0 0 auto)
      .header       — hamburger · brand · connection chip + clock · workspace switch (last)
      .controls     — symbol · interval · style · reload · profile · Trader/Analyst · Analyze
    .app-body  (flex:1, min-height:0, position:relative)
      #wsPanelCharts   (absolute inset:0; shown when data-workspace=charts)
        .ticker-bar + .chart-panel (the dominant chart)
      #wsPanelKeenEye  (absolute inset:0; shown when data-workspace=keeneye)
        .analysis-scroll → .analysis-area → #analysisCard  (qt-card renders here)
```

### Viewport model
- `body { overflow: hidden }` and `.app { height: 100dvh }` pin the app to the
  viewport. Scrolling happens **inside** regions, never on the page.
- Internal scroll regions: `.analysis-scroll` (Keen Eye), and the mobile
  `.controls` panel when expanded.
- Verified: `scrollWidth === clientWidth` and `scrollHeight === clientHeight` at
  all supported widths, both workspaces, both modes.

### Workspace switching
`setWorkspace(ws)` sets `.app[data-workspace]`, updates the tab `aria-selected`,
persists to `localStorage` (`qt.workspace`), and dispatches a `resize` when
returning to Charts so TradingView autosizes. It performs **no** engine call and
**no** DOM rebuild — both panels stay mounted, so the chart widget and the
analysis DOM are never recreated on switch.

### Dual modes (Trader / Analyst)
`QT.card.getMode()` / `QT.card.setMode()` own the mode state (persisted to
`qt.uiMode`). The renderer tags analyst-only sections/rows with
`.qtw-analyst-only` and the mode is a pure CSS visibility flip via
`.qtw[data-mode]`. Switching modes never re-renders or re-analyses.

### Mobile navigation
Below 760px a hamburger (`#navToggle`, `aria-controls`, `aria-expanded`)
collapses the controls bar; the expanded panel scrolls internally
(`max-height: 72vh`). Above 760px the controls are always shown inline.

---

## Renderer (`engine/qt-card.js`)

A small hyperscript-style DOM builder (`h()`, `svg()`) plus pure presentational
helpers (formatters, tone classification, ring/gauge/bar builders) and one
`build*` function per section. `CARD.render()` assembles: hero → executive
summary → grid(health, trade, structure, scores, confidence, evidence, gates,
mtf) → warnings → technical accordion → inspection accordion → footer.

- Progressive disclosure uses native `<details>/<summary>` (accessible,
  keyboard-operable, zero custom JS).
- Gauges/rings are inline SVG via `document.createElementNS` — no chart library.
- Graceful degradation: missing values render as "—"; no-trade shows a
  professional no-trade card; a `null` recommendation renders an empty state.

See [UI_COMPONENTS.md](UI_COMPONENTS.md) for the component catalogue.

---

## Orchestration (`engine/qt-app.js`)

`APP.run()` = fetch bundle from the proxy → run the engine pipeline →
`QT.card.render()`. It contains no mathematics and never holds an API key (all
market data flows through the proxy). `APP.analyzeBundle()` returns
`{ rec, context }`; `context` is the display-only price passthrough described
above.

---

## Design system (CSS in `dashboard.html`)

- One clamped token scale: spacing (`--sp-*`), type (`--fs-*`), radii, colours.
- Semantic tone tokens: `--qtw-bull / -bear / -warn / -info / -ai / -neutral`.
- Workstation-local text tokens (`--qtw-text-faint/-muted`) chosen to meet WCAG
  AA contrast (≥4.5:1) on every card surface.
- Theme is dark, single-commit (this is a terminal, not a themable site).
- Reduced motion honoured globally via `@media (prefers-reduced-motion: reduce)`.
