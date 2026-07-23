# UI Version History — Presentation Layer

The presentation layer is the **only** part of the application that renders the
analytical output. It never computes analysis; it reads the recommendation
object produced by the engine (`engine/qt-*.js`) and draws it. See
[UI_ARCHITECTURE.md](UI_ARCHITECTURE.md) for the boundary contract.

Files that make up the presentation layer:
- `engine/qt-card.js` — the renderer (the "Workstation" component library).
- `engine/qt-app.js` — orchestration (fetch → engine pipeline → render). No analysis.
- `dashboard.html` — the application shell, CSS design system, and inline wiring.
- `tests/phase8-presentation.test.js` — the presentation test suite.

---

## Version 1.1 — "Two-Workspace Terminal" (current, frozen)

The dashboard is a fixed, viewport-pinned two-workspace terminal.

### Structure
- **Charts workspace** — a TradingView chart as the dominant component, with a
  live ticker tape. Symbol / interval / style / profile / Analyze live in a
  persistent controls bar that is always visible.
- **Keen Eye workspace** — the full AI decision workstation rendered by
  `qt-card.js`, scrolling inside its own region.
- Switching between workspaces is a pure CSS attribute flip (`data-workspace`);
  no reload, no re-analysis, both panels stay mounted.

### 1.1 refinements (in order of delivery)
1. **Dual interface modes** — Trader (decision-focused) and Analyst (everything
   exposed). Same recommendation object, same DOM, CSS-visibility only.
2. **UX audit** — condensed qualification-gate summary in Trader Mode; dense grid
   packing to remove stranded gaps.
3. **Two-workspace layout** — Charts / Keen Eye; viewport-pinned; internal scroll.
4. **Session persistence** — workspace, analysis mode, symbol, interval, profile
   and chart style all restored on reload (`localStorage`).
5. **Welcoming empty state** + button focus rings.
6. **v1.1-final refinements:**
   - Header: workspace switcher moved to the end of the header row; the
     Trader/Analyst toggle moved into the controls bar and restyled to match the
     Analyze button; a compact connection chip in the header; a mobile hamburger
     that collapses the controls bar.
   - Symbol selector simplified (removed search box, per-row symbol code and
     category badge).
   - Charts sidebar removed so the chart is the dominant component.
   - **Hero "executive summary"** — the hero card now includes a trend line
     (direction · duration in candles · timeframe) and a trade ladder
     (Current · Entry · Stop · TP1 · TP2 · TP3). Only fields that exist on the
     recommendation object are shown; the engine exposes a single tiered stop,
     so exactly one Stop Loss is rendered (never a fabricated SL1/2/3 ladder).

### Verified invariants (v1.1)
- Zero horizontal scroll and zero page-level vertical scroll at 390 / 768 / 1024
  / 1366 / 1600 / 1920 px, in both workspaces and both modes (measured
  `scrollWidth === clientWidth` and `scrollHeight === clientHeight` via the
  DevTools Protocol against the real `dashboard.html`).
- Mode/workspace switching performs no engine call and no DOM rebuild.
- The renderer never mutates the recommendation object.
- All 13 recommendation codes render in both modes without error.

---

## Version 1.0 — "The Workstation" redesign

Complete redesign of the analysis area from a five-level card stack into the
`.qtw-*` component library: hero with animated SVG confidence ring, 8-gauge
Market Health panel, trade ticket, market-structure timeline, score/confidence
bars, evidence panels, qualification-gate checklist, MTF panel, grouped
warnings, and closed-by-default Technical / Engine-Inspection accordions. Native
`<details>/<summary>` for progressive disclosure; inline SVG for gauges; zero
external chart libraries.

---

## Version 0.x — original dashboard

TradingView chart embed + a text-oriented analysis card. Superseded by 1.0.

---

## Compatibility & determinism

- No build step. Plain `<script>` tags; runs from `file://` or any static host.
- No external runtime dependencies in the browser (jsdom is a dev-only test dep).
- Deterministic: the presentation layer contains no `Math.random` / `Date.now`
  in any analytical path (enforced by test).
