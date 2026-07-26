# Changelog

All notable changes to the **Quantitative Trading Analysis Platform** (this repo — engine, dashboard, backtester, tests) are documented here. The sibling gateway at `C:\trading-proxy` is a separate project and is **not** covered by this file.

The format follows [Keep a Changelog](https://keepachangelog.com/); dates are ISO-8601. This project is not yet publicly versioned, so entries are grouped by working date rather than semver release.

## [Unreleased] — 2026-07-27

### Added
- **Strategy Validation Dashboard** (`validation.html`) — a new UI surface over the existing backtester (`backtest/qt-backtest.js`). It fetches history through the same proxy bundle the dashboard uses, then renders `QTBacktest.run` / `.walkForward` / `.monteCarlo` output: a performance-summary tile grid, an inline-SVG equity curve, a signal funnel with regime distribution, a walk-forward IS/OOS stability table, a Monte-Carlo percentile band, and a trade log. It **computes nothing itself** — every number comes from the backtester — honouring the "presentation never calculates" rule. Carries a permanent honesty banner (not financial advice, no profitability claim, sample-size caveat). Fully self-contained: no CDN, charts are inline SVG.
- Header link (violet flask-vial icon, `#validationLink`) from `dashboard.html` to the new validation dashboard.
- **Phase 10 test suite** (`tests/phase10-validation.test.js`, 69 assertions) — functionally exercises the backtester over the immutable fixture (run/walk-forward/Monte-Carlo well-formedness + Monte-Carlo determinism) and statically verifies `validation.html` self-containment, script load order, backtester/proxy consumption, honesty banner, and the wiring changes below.
- `.webmanifest`, `.ico`, `application/manifest+json` and `image/x-icon` MIME types to the dev server (`tools/serve.js`) so it matches the production IIS MIME map.

### Changed
- `backtest/` is now servable over HTTP (dev server **and** `web.config`) because `validation.html` loads `backtest/qt-backtest.js` as a client-side runtime asset. It holds no secrets and consumes the public engine exactly as a user does. `.env`, `.git`, `node_modules` and `tests/` remain blocked.

### Fixed
- Four stale presentation-test assertions that contradicted intentional, documented design decisions (they had been failing since before this session):
  - Calculator link expectation `protrade_calc.html` → `calc.html` (the file was renamed).
  - Removed the `qt.style` persistence assertion — the chart-style picker was intentionally removed (the Charts-workspace TradingView widget supplies its own).
  - Icon-only button check now strips the child `<i>` glyph markup, so it no longer trips on FontAwesome class names after the FontAwesome-7 migration.

### Verified
- Full suite green: **1730 / 1730 assertions** (`node tests/run-all.js`), up from 1661.
- End-to-end browser verification against the running proxy: dashboard Analyze (live recommendation), calculator maths, and the new validation dashboard (live BTC/USD daily backtest — trades, equity curve, walk-forward, Monte-Carlo, trade log) all render with zero page-level console errors.

## 2026-07-24 — UI v1.1 hosting & polish

### Added
- `calc.html` — self-contained trading calculator (Core / Forex / Crypto / Stocks / Futures / Options), merged from the former `tool.html` + `tool2.html` with corrected liquidation, Greeks and pip-value maths. No CDN.
- `disclaimer.html`, PWA `site.webmanifest` + favicons, footer + disclaimer link.

### Changed
- Migrated the chart from the deprecated `tv.js` widget to the maintained `embed-widget-advanced-chart.js` pipeline; added a ticker-tape re-mount watchdog and moved the ticker bar to the bottom.
- Replaced all emoji/CDN icons with locally hosted FontAwesome 7; WCAG-AA brand/action palette; Save-Profile toggle gating all settings persistence.
- Enabled the IIS ARR reverse proxy and fixed the URL-rewrite rule so same-origin `/api/*` reaches the gateway; `qt-app.js` resolves the proxy same-origin on the public domain.
- Rebuilt the Keen Eye card system into four colour-coded data-type families with a proportional Key Levels ladder; added the hero executive summary and the display-only live-quote embed.

## 2026-07-23 — Initial platform

### Added
- Deterministic quantitative trading engine — 18 `QT.*` modules (indicators → patterns → trend → risk → scoring → recommendation), MTF consensus, capability-aware renormalisation. No build step, no runtime dependencies.
- Backtesting subsystem (`backtest/qt-backtest.js`) — candle-by-candle replay with adversarially-verified no-future-leak, walk-forward IS/OOS, Sharpe/Sortino/PF/expectancy/MAE/MFE, seeded Monte-Carlo.
- Presentation layer (`dashboard.html`, `engine/qt-card.js`) — two workspaces (Charts / Keen Eye), Trader/Analyst modes, session persistence, accessibility, responsive.
- Phase 1–9 test suites; indicator cross-validation (30/30 vs an external oracle on 600 real BTC/USD bars).
- Locally hosted assets; `web.config` for IIS + Cloudflare Tunnel hosting.
