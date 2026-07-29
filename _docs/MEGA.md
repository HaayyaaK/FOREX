# Architecture Decision Record (ADR)

Each record: **Problem → Alternatives → Decision → Trade-offs → Reasoning.**
These are the load-bearing decisions of the project.

---

## ADR-001 — Deterministic engine
**Problem.** Trading analysis must be auditable and reproducible; the same inputs
must always yield the same output, and past decisions must never change.
**Alternatives.** (a) Stateful/streaming engine with cached intermediate state;
(b) ML model with non-deterministic training; (c) pure deterministic replay.
**Decision.** Pure deterministic replay: everything recomputed from bar history
each run; no persisted state; no `Math.random`; no `Date.now` in analytical paths
(timestamps are injected).
**Trade-offs.** Recompute cost on every run; no "learning". Gains: reproducibility,
testability (regression locks on real BTC/USD bars), and adversarial no-future-leak
guarantees.
**Reasoning.** Auditability and trust outweigh raw performance for this domain.

## ADR-002 — Capability-aware architecture
**Problem.** Data feeds are uneven — sometimes no volume, no news, few swings.
**Alternatives.** (a) Assume defaults / fabricate missing inputs; (b) hard-fail
when anything is missing; (c) observe capabilities and adapt.
**Decision.** Observe available capabilities; **exclude** unavailable categories
and **renormalise** weights over what remains. Never fabricate.
**Trade-offs.** More bookkeeping and explanation surface. Gains: honest output,
graceful degradation, no phantom signals.
**Reasoning.** Fabricated data is worse than absent data in a decision tool.

## ADR-003 — The Recommendation Object as the single contract
**Problem.** The UI and any consumer need a stable interface to the analysis.
**Alternatives.** (a) UI reaches into engine internals; (b) many ad-hoc return
shapes; (c) one versioned JSON object.
**Decision.** One plain-JSON recommendation object with an engine/config version,
consumed verbatim by the renderer.
**Trade-offs.** The object is large. Gains: the UI can be rebuilt freely without
touching analysis; the contract is testable and portable.
**Reasoning.** A single, explicit contract is the backbone of the whole system.

## ADR-004 — Strict presentation separation
**Problem.** UI code tends to accrete "just one calculation".
**Alternatives.** (a) Let the UI compute conveniences; (b) forbid it and enforce.
**Decision.** The presentation layer performs only formatting, scaling, and text
classification. Enforced by grep-based tests over `qt-card.js`, `qt-app.js` and
the dashboard inline script.
**Trade-offs.** Occasionally the UI must display something the object doesn't yet
expose (handled by extending the engine, or — once — a documented display-only
render argument for current price).
**Reasoning.** The boundary is only real if it is mechanically enforced.

## ADR-005 — Provider Registry & Gateway (proxy)
**Problem.** Multiple market-data providers with different quotas, health, and
reliability; the browser must never hold API keys.
**Alternatives.** (a) Call providers directly from the browser; (b) single
provider; (c) a server-side registry with priority/failover/health/quota.
**Decision.** A Node proxy with a provider registry (priority, failover,
health/degradation/cooldown, quota budgets), exposing one consolidated
`/api/v1/bundle` endpoint. The browser only talks to the proxy.
**Trade-offs.** An extra service to run and secure. Gains: key safety, resilience,
one clean contract for the client. *(Status: designed/reviewed; server
implementation and failover validation are pending — see PROJECT_STATUS.md.)*
**Reasoning.** Keys and provider complexity belong on the server.

## ADR-006 — Multi-Timeframe (MTF) consensus as a decision layer
**Problem.** Signals conflict across timeframes.
**Alternatives.** (a) Sum MTF into the composite score; (b) ignore other
timeframes; (c) a strategic arbitration layer.
**Decision.** MTF consensus is a separate arbitration step (rules M0–M6:
not_evaluated/none/strengthen/weaken/demote/block) that can adjust the band and
confidence — **never** summed into the composite score.
**Trade-offs.** More explanation surface. Gains: MTF influence is explicit and
auditable, not hidden in a number.
**Reasoning.** Cross-timeframe conflict is a strategic decision, not a weight.

## ADR-007 — Trader Mode / Analyst Mode
**Problem.** One UI must serve a first-time trader (decide fast) and an analyst
(inspect everything).
**Alternatives.** (a) Two separate pages/builds; (b) one dense page for all;
(c) one render, CSS-visibility modes.
**Decision.** Render the full DOM once; a `data-mode` attribute + `.qtw-analyst-only`
class control visibility. No duplicate rendering logic.
**Trade-offs.** All content is always in the DOM (slightly larger). Gains: instant
switching, no re-render, no re-analysis, single source of truth.
**Reasoning.** Same data, two lenses — cheapest and safest as pure visibility.

## ADR-008 — Charts / KEEN two-workspace layout
**Problem.** One long scrolling page mixed chart-watching and decision-reading.
**Alternatives.** (a) Keep one page; (b) separate routes/reloads; (c) two
in-page workspaces toggled by attribute.
**Decision.** Two workspaces (Charts, KEEN) stacked in the same area, toggled
by `data-workspace`. Both stay mounted; switching is instant with no reload and no
re-analysis.
**Trade-offs.** Both panels occupy the DOM at once. Gains: a focused terminal feel;
the chart is never rebuilt on switch.
**Reasoning.** Different jobs deserve different surfaces without a reload.

## ADR-009 — Viewport-pinned shell with internal scrolling
**Problem.** A professional terminal should not scroll the browser page.
**Alternatives.** (a) Normal document flow with page scroll; (b) fixed shell,
internal scroll regions.
**Decision.** `body { overflow:hidden }`, `.app { height:100dvh }`, and internal
`overflow:auto` regions. Verified zero page scroll at all supported widths.
**Trade-offs.** Requires careful `min-height:0` flex plumbing. Gains: navigation
and Analyze always visible; nothing scrolls off-screen.
**Reasoning.** Fixed chrome + internal scroll is the terminal idiom.

## ADR-010 — Backtesting isolation & no future-data leakage
**Problem.** Backtests can accidentally use future information.
**Alternatives.** (a) Trust the code; (b) adversarial tests.
**Decision.** Walk-forward backtesting with adversarial tests that corrupt future
bars and assert identical past decisions; portfolio/lifecycle state kept isolated
from the per-bar decision.
**Trade-offs.** Extra test machinery. Gains: leakage is caught mechanically.
**Reasoning.** No-lookahead is the one guarantee a backtest must never break.

## ADR-011 — Portability (zero-dependency, no build step)
**Problem.** The tool should run anywhere with minimal setup.
**Alternatives.** (a) Bundler + framework; (b) plain scripts.
**Decision.** Vanilla JS under a `QT.*` global, loaded via `<script>` tags; runs
from `file://` or any static host; no runtime dependencies in the browser (jsdom
is dev-only for tests).
**Trade-offs.** No framework conveniences. Gains: trivial hosting, long-term
stability, easy audit.
**Reasoning.** Fewer moving parts = fewer ways to break in production.

## ADR-012 — Inline SVG gauges instead of a chart library
**Problem.** The workstation needs rings/gauges/bars.
**Alternatives.** (a) A charting library; (b) hand-built inline SVG.
**Decision.** Inline SVG via `createElementNS`; geometry is pure scaling of an
already-computed 0..1 value.
**Trade-offs.** More hand-written geometry. Gains: no dependency, no CSP issues,
full control, tiny footprint.
**Reasoning.** The shapes are simple; a library would be pure cost.

## ADR-013 — Session persistence
**Problem.** Reopening should feel like returning, not restarting.
**Alternatives.** (a) Reset every load; (b) persist UI state to localStorage.
**Decision.** Persist workspace, analysis mode, symbol, interval, profile and
chart style; restore before first paint. Presentation state only.
**Trade-offs.** Slight care to restore before render. Gains: "reopen exactly as
left"; no analysis re-run.
**Reasoning.** Cheap, high-value continuity for a daily-use tool.
# Audit Report — dashboard.html, calc.html, validation.html, disclaimer.html

Scope: static source audit of the four root-level HTML files (7,915 lines
combined) plus `assets/site.webmanifest`. Verified against the automated
test suite (`node tests/run-all.js`, 1791/1791 passing at time of writing)
and static cross-file diffing. **Browser visual rendering could not be
confirmed this session** — the connected Chrome tab reports
`document.hidden: true` / a 0×0 viewport, an environment limitation, not a
site defect — so this report is source-level, not a rendered/visual QA
pass. Every finding below was actually located in the code; nothing here
is generic advice.

---

## 1. Detected Issues

### 1.1 disclaimer.html has two `<h1>` elements
`disclaimer.html:295` (brand mark, "KEEN") and `disclaimer.html:308`
(`<h1 class="doc-title">Disclaimer</h1>`). A page should expose exactly one
`<h1>` as its document-outline root; two competing top-level headings is
invalid heading semantics and confuses screen-reader users navigating by
heading level.

### 1.2 calc.html skips a heading level (h1 → h3, no h2)
`calc.html` has exactly one `<h1>` (the page title) and then 30 occurrences
of `<h3 class="card-title">` (one per calculator card, e.g. lines 677, 719,
771…) — there is no `<h2>` anywhere in the document. Jumping two levels
breaks the logical outline that assistive-technology users rely on to skim
the page by heading rank.

### 1.3 calc.html's tab UI is an incomplete ARIA-tabs pattern
`calc.html:638-665`: the container has `role="tablist"` and each button has
`role="tab"`, but:
- No button has an `id` or `aria-controls` pointing at its panel.
- No `<section class="tab-content">` panel (e.g. `id="tab-core"`, line 671)
  has `role="tabpanel"` or `aria-labelledby`.
- The default-active button (`data-tab="core"`, line 639) has no
  `aria-selected="true"` in the static markup — it's only ever set by the
  click handler (`calc.html:~2898-2901`).

### 1.4 calc.html: `aria-selected` is never set on initial load in the common case
`calc.html:2957-2968` (the init IIFE): if the tab restored from
`localStorage.getItem('calc.tab')` is `'core'` (the default, and also what
a first-time visitor gets), the code takes the `else { recalcAll(); }`
branch and **never calls `.click()`** — so no tab button ever receives
`aria-selected="true"`, leaving every tab marked unselected to assistive
tech until the user manually switches tabs at least once.

### 1.5 validation.html's async state changes are not announced
`validation.html:372-394`: `#emptyState` → `#loadingState` →
`#errorState`/`#results` are swapped via `showOnly()` with plain
`.hidden` toggling — none of the four containers carry `aria-live` or
`role="status"`. A screen-reader user gets no announcement when a backtest
starts, fails, or completes. This is a direct inconsistency with the same
codebase: `dashboard.html:2777` and `dashboard.html:2807` already use
`aria-live="polite"` (plus `role="status"` on the toast) for the equivalent
async-state-swap pattern.

### 1.6 Branding drift between the manifest name and the in-app UI — ✅ RESOLVED
`assets/site.webmanifest:2-3` previously carried a two-word product name
that predated the in-app rename to "KEEN" (seen at, e.g.,
`dashboard.html:2630`'s `aria-label` and `disclaimer.html:6`'s `<title>`),
so an installed PWA would have shown the old name in its install prompt,
home-screen label, and OS app-switcher while the in-app chrome said
"KEEN". **Fixed in the same pass that standardized the product name to
"KEEN" repo-wide** — the manifest's `name`/`short_name` now both read
"KEEN".

### 1.7 `dir="ltr"` is declared on only one of the four `<html>` tags
`disclaimer.html:2` is `<html lang="en" dir="ltr">`; `dashboard.html:2`,
`calc.html:2`, `validation.html:2` are all `<html lang="en">` with no
`dir`. Functionally inert (ltr is the default), but the attribute set on
the root element is inconsistent across otherwise design-unified pages.

### 1.8 `<!doctype html>` casing is inconsistent
`validation.html:1` is `<!DOCTYPE html>` (uppercase); `dashboard.html:1`,
`calc.html:1`, `disclaimer.html:1` are all `<!doctype html>` (lowercase).
Zero functional effect (HTML doctype matching is case-insensitive) — this
is a residual artifact of calc.html/dashboard.html/disclaimer.html having
been run through a code formatter that validation.html hasn't been.

### 1.9 No `<meta name="description">` on any of the four pages
Confirmed absent in dashboard.html, calc.html, validation.html, and
disclaimer.html. Affects link-preview text and search-result snippets.

---

## 2. Required Adjustments

These contradict either an established in-repo convention or a real
correctness rule (not stylistic opinions):

1. **Fix the duplicate `<h1>` in disclaimer.html** (finding 1.1). Keep
   exactly one — either demote the brand mark's `<h1>` (line 295) to a
   non-heading element (it's already decorative/brand chrome, matching how
   calc.html/validation.html render their header brand) or demote the
   content title (line 308) to `<h2>`. The brand mark is the better
   candidate to demote, since it mirrors calc.html/validation.html's header
   pattern where the brand text is inside the `.header` chrome, not the
   document's content heading.

2. **Complete calc.html's ARIA-tabs wiring** (findings 1.3, 1.4): give each
   `.tab-btn` a stable `id` and `aria-controls="tab-<name>"`; give each
   `.tab-content` panel `role="tabpanel"` and `aria-labelledby` pointing
   back at its tab button; and fix the init path (`calc.html:2957-2968`) so
   `aria-selected="true"` is applied to the resolved starting tab even when
   it's the default `'core'` tab and `.click()` is skipped.

3. **Add an `aria-live` region to validation.html's state container**
   (finding 1.5), matching the `aria-live="polite"` convention
   `dashboard.html` already established for the same async-state-swap
   pattern (empty → loading → result/error).

4. ~~Reconcile the manifest name with the in-app UI~~ (finding 1.6) —
   **✅ DONE.** The product confirmed "KEEN" as the standardized name; the
   manifest was updated and every other lingering occurrence of the old
   two-word name was renamed repo-wide in the same pass (manifest,
   `engine/qt-card.js`'s `keen-live-price` CSS hook, tests, README, and the
   `_docs/` set).

---

## 3. Recommended / Suggested Improvements

Optional, non-blocking polish — listed separately so it's clear none of
this is mandatory:

- **Add `dir="ltr"`** to `dashboard.html`, `calc.html`, and
  `validation.html`'s `<html>` tag for attribute-set consistency with
  disclaimer.html (finding 1.7). No behavioral change.
- **Normalize `<!doctype html>` casing** in validation.html to lowercase,
  matching the other three files (finding 1.8).
- **Add `<meta name="description">`** to each of the four pages (finding
  1.9) for SEO / link-preview quality.
- **Unify the localStorage key-naming scheme.** `dashboard.html` namespaces
  everything under `qt.*` (`qt.workspace`, `qt.profileSaveEnabled`,
  `qt.uiMode` — see `dashboard.html:3323`, `3398`, `3559`), while
  `calc.html` uses a `calc.*` prefix (`calc.tab`, plus one key per input
  id). No collision risk today since the prefixes differ, but a single
  shared scheme would read as more deliberate if more pages gain
  persistence later.
- **Consider `aria-live` on calc.html's `.results` panels too** — lower
  priority than validation.html's case (finding 1.5) because calc's results
  update on every keystroke, so a naive `aria-live="polite"` copy could
  fire far too often and become noisy for screen-reader users; this would
  need a deliberate design choice (e.g. announce only on blur/debounce)
  rather than a blind copy of the dashboard pattern.
- **`.webmanifest` has no explicit IIS cache policy.** `web.config`'s
  `<caching><profiles>` block sets an explicit policy for `.js` and
  `.json` (`CacheUntilChange`) and disables caching for `.html`, but
  `.webmanifest` is a distinct extension and isn't listed, so it falls back
  to IIS's default static-file caching. Since Task 3 made this manifest the
  single source of truth for all four pages, giving it the same explicit,
  revalidate-friendly policy as `.json` would avoid a stale cached manifest
  surviving a future icon/name change.
- **Formatting-style split.** calc.html, dashboard.html, and
  disclaimer.html are currently in a 2-space/double-quoted/self-closing
  style (from an external formatter pass outside this session); validation.html
  is still in its original 4-space/unquoted/non-self-closing style. Purely
  cosmetic — worth a single formatter pass over validation.html if a
  consistent source style across the repo matters to the team.
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
- Rebuilt the KEEN card system into four colour-coded data-type families with a proportional Key Levels ladder; added the hero executive summary and the display-only live-quote embed.

## 2026-07-23 — Initial platform

### Added
- Deterministic quantitative trading engine — 18 `QT.*` modules (indicators → patterns → trend → risk → scoring → recommendation), MTF consensus, capability-aware renormalisation. No build step, no runtime dependencies.
- Backtesting subsystem (`backtest/qt-backtest.js`) — candle-by-candle replay with adversarially-verified no-future-leak, walk-forward IS/OOS, Sharpe/Sortino/PF/expectancy/MAE/MFE, seeded Monte-Carlo.
- Presentation layer (`dashboard.html`, `engine/qt-card.js`) — two workspaces (Charts / KEEN), Trader/Analyst modes, session persistence, accessibility, responsive.
- Phase 1–9 test suites; indicator cross-validation (30/30 vs an external oracle on 600 real BTC/USD bars).
- Locally hosted assets; `web.config` for IIS + Cloudflare Tunnel hosting.
# Implementation Notes

Running record of every change made outside the analysis engine itself, and of the
decisions behind them. Engine-side decisions live in `RESEARCH-SYNTHESIS.md`;
indicator evidence lives in `VALIDATION.md`.

---

## 2026-07-22 — Backend rebuild (`C:\trading-proxy`)

Approved in Decisions 1–3. Every change below was verified by running the server
and calling the endpoints; results are quoted inline.

### Files added

| File | Purpose |
|------|---------|
| `.gitignore` | `.env`, `node_modules/`, logs. **Previously missing** — three live keys were one `git init && git add .` away from being committed. |
| `src/config.js` | Centralized configuration. No other module reads `process.env`. Holds the symbol registry, interval map, MTF ladders, budgets, cache and CORS policy. |
| `src/core.js` | Structured logger, `ProxyError`, upstream status classifier, TTL+LRU cache, sliding-window budget governor, request coalescer. |
| `src/http.js` | Upstream client: timeout, bounded retry, status preservation, budget enforcement, coalescing, caching. |
| `src/providers.js` | Provider abstraction + normalization + **observed** capability detection. Registry is the extension point for future providers. |
| `src/routes.js` | `/api/v1/*` (standard envelope) and `/api/*` (legacy, unchanged contracts). |
| `tests/proxy.test.js` | 21 deterministic tests. No network, no keys. |

`server.js` was rewritten as a thin composition root. `package.json` gained
`main: server.js` (previously pointed at a non-existent `index.js`) and
`start` / `test` scripts.

### Defects fixed

**1. `/api/rates` was dead (PROXY-REVIEW §3).**
Line 79 held 3,644 characters of rendered KaTeX HTML instead of the template
literal — the file had been pasted from rendered Markdown. The API key and base
currency were never interpolated. Restored from `Proxy.md` line 112 and moved
into `providers.exchangerate.latest()`.

- Before: `{"error":"Failed to fetch exchange rates"}` HTTP 500 on every call.
- After: `{"result":"success","time_last_update_unix":1784678401,…}` HTTP 200.

**2. Upstream status codes were flattened to 500 (PROXY-REVIEW §8).**
Every route used `catch { res.status(500) }`, destroying the distinction my
Phase 1 client depends on: 5xx/429 are transient (retry), 4xx are permanent
(fail fast). Replaced with `classifyUpstream()` and a typed error envelope.

- Before: bad symbol → `500 {"error":"Failed to fetch price data"}`
- After: `400 {"ok":false,"error":{"code":"UNKNOWN_SYMBOL","message":"Unknown symbol \"NOPE\"","retryable":false,…}}`

Providers that answer **HTTP 200 with an error body** (TwelveData
`{status:'error'}`, ExchangeRate `{result:'error'}`) are detected too, so a
soft failure is no longer cached as if it were data.

**3. No timeouts.** A slow upstream held a socket indefinitely. Now
`UPSTREAM_TIMEOUT_MS` (default 15 s) per request, surfaced as `UPSTREAM_TIMEOUT` / HTTP 504.

**4. CORS was wide open.** `app.use(cors())` accepted every origin while
`Proxy.md` claimed the opposite. Now an explicit allow-list from
`ALLOWED_ORIGINS`, with `CORS_ALLOW_ALL=true` as a deliberate opt-out that logs
a warning at boot. Requests without an `Origin` header (curl, server-to-server)
still pass, so nothing operational broke.

### Capabilities added

- **Server-side cache.** TTL scales with bar interval — a closed 1 h bar is
  immutable for an hour. Bounded LRU, hit-rate reported by `/api/v1/health`.
- **Upstream budget governor.** Sliding window per provider (TwelveData 8/min).
  Requests defer rather than burning quota and eating a 429.
- **Request coalescing.** Concurrent identical requests share one upstream call —
  material during a bundle fetch. Verified: three concurrent callers → one call.
- **Bounded retry with backoff**, transient failures only.
- **Structured logging** with request id, path, status, latency, symbol, interval.
  Every response carries `X-Request-Id`.
- **Inbound rate limiting** (120 req/min/IP default) to protect the upstream quota.
- **Graceful shutdown**, boot-time key validation, `helmet`-style header hygiene
  (`x-powered-by` disabled).

### New endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /api/v1/health` | Status, provider configuration, cache hit-rate, remaining quota, counters |
| `GET /api/v1/meta/symbols` | Symbol registry + intervals + ladders — one authority shared with the frontend |
| `GET /api/v1/ohlcv` | Canonical ascending numeric bars + observed capabilities |
| `GET /api/v1/price` | Normalized last price |
| `GET /api/v1/news` | Symbol-aware news (accepts `symbol`, maps to the registry query) |
| `GET /api/v1/spot` | ExchangeRate cross-check for forex pairs |
| **`GET /api/v1/bundle`** | **Everything for one analysis in a single request** |

Legacy `/api/health`, `/api/price`, `/api/timeseries`, `/api/news`, `/api/rates`
keep their original response shapes and now inherit caching, retry and timeouts.

### Bundle performance

`GET /api/v1/bundle?symbol=COINBASE:BTCUSD&timeframe=60` — measured:

```
ladder: {"ltf":"60","mtf":"240","htf":"D"}
  ltf: 60  -> 499 bars
  mtf: 240 -> 499 bars
  htf: D   -> 499 bars
news articles: 50
capabilities: {"ohlc":true,"volume":false,"news":true,"spot":false}
real 0m3.464s
```

One HTTP request replaces 4–5 round trips. Partial failure is non-fatal: only
the primary timeframe is required; anything else degrades into `warnings` and
`meta.partialErrors`.

### Standard response envelope

```jsonc
{ "ok": true, "apiVersion": "v1", "requestId": "…", "timestamp": "…",
  "data": { … }, "capabilities": { … }, "warnings": [ … ], "meta": { … } }
```
```jsonc
{ "ok": false, "apiVersion": "v1", "requestId": "…", "timestamp": "…",
  "error": { "code", "message", "upstreamStatus", "retryable", "provider", "details" } }
```

---

## Decision 2 — capability-aware analysis (design record)

Rejected: hard-coding the engine to three layers because today's provider omits
volume. Adopted: **capabilities are observed per analysis and the scoring engine
normalizes across whatever is genuinely available.**

Detection is evidence-based, never assumed. `volume` is reported `true` only when
the payload carries a volume field **and** at least one non-zero value. Three
tests pin this down: field present with data → `true`; field absent → `false` +
warning; field present but all zeros → `false` + warning. Bars still expose
`volume: 0` for shape stability, but the capability flag — not the zero — is what
the engine consumes.

Measured today: `{"ohlc":true,"volume":false,"news":true,"spot":false}` for
BTC/USD, so Layer 3 will be excluded and its weight redistributed across the
remaining layers, with the exclusion reported in the explainability output. If a
provider later supplies volume, the capability flips to `true` and Layer 3
re-enters automatically — **no engine change**.

Binance was **not** added, per instruction. The provider registry in
`src/providers.js` is the extension point: a new source implements
`timeSeries()` and registers itself.

---

## Outstanding / deferred

- `helmet` and `compression` are not installed (would add dependencies); header
  hygiene is handled manually for now.
- The inbound rate limiter is in-process. A multi-instance deployment would need
  a shared store; single-laptop deployment does not.
- `Proxy.md` still documents the original single-file design. It is retained as
  the historical record — and as the source that made the line-79 recovery
  possible — rather than edited.

## Verification status

| Suite | Result |
|-------|--------|
| Proxy (deterministic) | **21/21** |
| Engine Phase 1 — data layer | **59/59** |
| Engine Phase 2 — indicators | **143/143** |
| Indicator cross-validation vs oracle | **30/30 series** |
# Production Readiness Report
### Quantitative Trading Analysis Platform — end-to-end verification
*Covers Phases 1–8, the backend proxy, and the research foundation.*

---

## 1. Verdict

**Analytical engine architecture COMPLETE. Ready for personal, single-operator use as a decision-support tool. Not ready for multi-user deployment, and not ready to inform capital allocation without a backtest.**

The engine is mathematically verified, deterministic, fully explainable and honest about what it does not know. The gap between "verified correct" and "verified profitable" is the central caveat: **no component of this platform has ever been backtested.** Every weight and threshold is a calibration assumption seeded from research priors, not an optimised value. The engine tells you what the market looks like under a configured strategy; it has never been shown that the strategy makes money.

---

## 2. Completed architecture

```
Browser (dashboard.html)                    ← presentation only, zero analysis
  └─ qt-app.js          orchestration       ← sequences calls, no maths
       ↓ HTTP
  Node proxy :3001      /api/v1/bundle      ← sole holder of API keys
       ↓
  qt-data / providers   normalise + validate
       ↓
  qt-indicators (P2) → qt-patterns (P3) → qt-trend (P4)
       ↓                     ↓                  ↓
  qt-levels ────────→ qt-risk (P5) ────→ qt-scoring (P6) → qt-recommendation (P7)
                                                                    ↓
                                                            qt-card.js (P8)
```

**18 engine modules**, single global namespace (`QT.*`), classic scripts — no build step, works from `file://` and IIS alike. Load order is explicit in `dashboard.html`.

| Layer | Modules | Responsibility |
|---|---|---|
| Foundation | `qt-config`, `qt-utils`, `qt-profiles` | configuration, numerics, strategy profiles |
| Data | `qt-data` + proxy `src/*` | fetch, retry, cache, normalise, validate |
| Analysis | `qt-indicators`, `qt-detection`, `qt-candles`, `qt-structure`, `qt-chart-patterns`, `qt-patterns` | 25+ indicators, 20 detectors |
| Interpretation | `qt-trend`, `qt-levels` | regime, state machine, S/R, Fibonacci |
| Decision | `qt-risk`, `qt-scoring`, `qt-recommendation` | trade construction, synthesis, banding |
| Presentation | `qt-card`, `qt-app` | rendering, orchestration |

---

## 3. Validation results

| Suite | Assertions | Status |
|---|---:|---|
| Phase 1 — Market data layer | 59 | PASS |
| Phase 2 — Indicator engine | 143 | PASS |
| Phase 3 — Pattern recognition | 141 | PASS |
| Phase 4 — Trend & structure | 148 | PASS |
| Phase 5 — Risk / trade construction | 149 | PASS |
| Phase 6 — Scoring & qualification | 241 | PASS |
| Phase 7 — Recommendation | 158 | PASS |
| Phase 9 — MTF arbitration | 52 | PASS |
| Phase 8 — Presentation | 80 | PASS |
| **Engine total** | **1178** | **PASS** |
| Proxy (deterministic) | 21 | PASS |
| Indicator cross-validation vs `technicalindicators` | 30 series | 30/30 matched |

**Independent validation:** 30 indicator series matched an external oracle to floating-point precision on 600 real BTC/USD daily bars. The single divergence (Parabolic SAR, 1 bar in 599) is a documented convention difference at a reversal bar, recorded in `VALIDATION.md`.

**Determinism:** asserted structurally — no `Math.random`, no `Date.now`, no `new Date()` anywhere in the analysis path, across all eight phases. Golden-value regression locks 43 indicator series.

**Live end-to-end:** dashboard → proxy → TwelveData → engine → card in **2.2–2.8 s**, producing a fully arbitrated recommendation with 5 disclosure levels, 15 qualification gates, 10 contribution rows, the MTF decision block rendered, internally consistent, zero horizontal overflow, no page errors.

---

## 4. Implemented capabilities

- **25+ indicators** implemented from authoritative definitions; no runtime third-party library.
- **20 pattern detectors** — 12 candlestick, market structure (HH/HL/LH/LL, BOS, CHoCH, internal/external), SMC (FVG, order blocks, breakers, mitigation, sweeps, equal highs/lows, premium/discount), 13 chart formations.
- **Regime classification** across 10 regimes, each with scored evidence and scored rejection reasons for every alternative.
- **Deterministic replay state machine** with Schmitt-trigger hysteresis.
- **Trade construction**: 4 entry models, 3 stop tiers with self-rejection, 3 evidence-derived targets with achievement probabilities.
- **Three-tier qualification**: hard gates / configurable gates / informational metrics.
- **5 strategy profiles** that legitimately disagree on identical data.
- **Capability-aware scoring** with transparent exclusion and renormalisation.
- **Full traceability** — every contribution back to weight and evidence.
- **MTF consensus arbitration** — a strategic decision layer that can strengthen, weaken, demote or block a recommendation.

---

## 5. Known limitations

### 5.1 ✅ RESOLVED — Multi-timeframe consensus is now a decision layer
Previously computed but never consumed. Consensus is now an **input** to `qt-recommendation.build()`, and no recommendation can finalise without arbitration running. See §12 for the full mechanism.

### 5.2 🔴 No backtest exists
No weight, threshold, temperature or band boundary has been validated against realised outcomes. `RESEARCH-SYNTHESIS.md` seeds them from published priors; `qt-profiles.js` labels them calibration assumptions. Two values are frank guesses: the softmax temperatures (0.42–0.50) and the outcome-probability scoring coefficients in `qt-trend.outcomeProbabilities`.

### 5.3 🟠 Volume layer unavailable
TwelveData returns no volume for any of the 11 symbols on the current plan. OBV, MFI, CMF, VWMA, relative volume and Volume Profile are therefore never computed. The system handles this correctly — capability observed, category excluded, weights renormalised, nothing fabricated — but **Layer 3 of the research 3-layer stack is absent**, and every setup requiring "volume > 1.5× average" loses its confirmation leg.

### 5.4 🟠 Out-of-scope data sources
On-chain metrics (MVRV, SOPR, ETF flows), DXY, real yields, yield spreads and order-flow delta appear throughout the research but are not derivable from the three approved providers. Typed extension points exist; no values are fabricated.

### 5.5 🟡 Smaller items
- Three chart-pattern tests self-skip when synthetic geometry doesn't produce the required swing configuration; real-data coverage compensates, but the skips are not passes.
- `favicon.ico` returns 404 (cosmetic).
- Inbound rate limiter is in-process — correct for one machine, insufficient for multi-instance.
- `helmet`/`compression` not installed; header hygiene is manual.
- Sentiment lexicon is hand-built and English-only; it is capped at 0.25 directional influence, which limits the damage of a misread.

---

## 6. Research assumptions

Four documents were synthesised; **two directly contradict each other** and the resolution shapes the whole engine (`RESEARCH-SYNTHESIS.md`):

1. **RSI/Bollinger reliability** — D1/D3 rank them highly; D2 cites peer-reviewed work showing both *underperformed buy-and-hold on BTC*, and a 14,919-rule study finding no positive out-of-sample result. **Resolved by regime conditioning**: they carry weight only when ADX < 20, and are capped so oscillators alone can never exceed a Weak signal.
2. **Fixed TP vs trailing exit** — resolved by regime.
3. **Headline win rates** — 70–85% vendor claims are used *only* as relative weighting priors and are **never displayed**. The engine makes no profitability claim.
4. **Top-weighted framework** — Donchian channel breakout promoted per D2's peer-reviewed ranking.
5. **FVG definition** — canonical ICT form implemented, deliberately overriding D3's looser wording.

Confidence is defined throughout as *"the engine's certainty that market conditions match the configured strategy — NOT a probability of trade success,"* and is emitted with every recommendation.

---

## 7. Security review

| Item | Status |
|---|---|
| API keys in browser | **None.** Verified by test — no `apikey`/`apiKey` string in any client module. |
| Keys at rest | `.env` on the proxy only; `.gitignore` added (was missing — three live keys were one `git add .` from being committed). |
| CORS | Explicit allow-list; `CORS_ALLOW_ALL` is an opt-in that warns at boot. |
| Upstream error fidelity | Status codes preserved; 4xx vs 5xx/429 distinguished so retry logic is correct. |
| Inbound abuse | 120 req/min/IP; upstream budget governor prevents quota exhaustion. |
| Input validation | Symbols/intervals validated against a server-side registry before any upstream call. |
| Secrets in logs | Structured logging emits no key material. |
| Dependencies | Proxy: 4 (express, cors, dotenv, axios). Engine: **zero runtime dependencies**. |

**Residual risk:** anyone who reaches the proxy hostname can spend the API quota — there is no authentication. Acceptable on a LAN; **add a shared secret before exposing via Cloudflare tunnel**.

---

## 8. Performance

| Operation | Measured |
|---|---|
| Indicator computation, 600 bars | ~15 ms |
| Pattern pass, 600 bars, 20 detectors | **5.2 ms** (142 detections) |
| Trend + regime + state replay | < 20 ms |
| Full pipeline P2→P7 | < 200 ms |
| Card render | < 250 ms |
| **Analyze round-trip (live, incl. network)** | **2163 ms** |
| Proxy bundle (3 timeframes + news) | 3.4 s cold, cached thereafter |

One `/api/v1/bundle` call replaces 4–5 round trips — the difference between working and rate-limited on the 8 req/min free tier.

---

## 9. Deployment considerations

1. **Proxy must run** — the dashboard shows an actionable error naming the URL if it cannot connect.
2. **IIS**: serve the folder as-is; no build step. `engine/*.js` must be served as `application/javascript`.
3. **Cloudflare tunnel**: route the dashboard *and* `:3001`, set `ALLOWED_ORIGINS` to the tunnel hostname, and **add authentication** before public exposure.
4. **Proxy as a service**: `pm2 start server.js --name trading-proxy` (documented in `Proxy.md`).
5. **Quota**: 800 requests/day free tier. Cache TTL scales with bar interval; one analysis costs 1–3 upstream calls.
6. `.env` must never be committed — `.gitignore` now covers it.

---

## 10. Future extension points

| Extension | Where it plugs in | Engine change needed |
|---|---|---|
| New data provider | `src/providers.js` registry | none |
| Volume when available | capability flips to `true` automatically | **none** |
| New detector | `QT.patterns.register()` | none |
| New strategy profile | `qt-profiles.js` data | none |
| Position sizing / portfolio | consumes `positionRisk` | none — deliberately excluded |
| Broker execution | consumes `trade.lifecycle` (10 states defined) | none |
| Alerts / mobile | consumes the recommendation object | none |
| On-chain / DXY | typed extension points | new category in Phase 6 |

---

## 11. Honest assessment

**What I am confident about:** the mathematics (30/30 oracle-verified), determinism (structurally asserted), the architecture boundaries (test-enforced), and the honesty of the output — the engine excludes what it cannot measure, refuses to trade when evidence is thin, surfaces inconsistencies rather than hiding them, and states plainly what its confidence number does and does not mean.

**What I am not confident about:** whether any of it is *profitable*. The weights are informed guesses. The engine is a rigorously-built instrument for reading market conditions under a stated strategy — it is not evidence that the strategy works.

**Before risking capital:** backtest. The MTF integration is complete (§12); quantitative validation is the only remaining gap. The deterministic design and the immutable fixture make a walk-forward harness straightforward — that is the natural Phase 9, and it is the only thing that can turn calibration assumptions into calibrated parameters.

**Recommended use today:** a decision-support and research tool for a single operator on a trusted network, with every recommendation read alongside its evidence, warnings and limiting factor rather than as a signal to act on.

*Educational analysis only. Not financial advice.*

---

## 12. Multi-timeframe consensus in the analytical pipeline

### 12.1 How it participates

Consensus is a **strategic decision layer**, not another score. It is never summed or multiplied into the composite. `qt-trend.consensus()` produces the cross-timeframe view; `REC.arbitrateConsensus()` then inspects the *proposed* recommendation and decides what to do with it. Placement in the pipeline:

```
scoring (P6) → band resolution → band-edge damping → MTF ARBITRATION → final recommendation
```

Arbitration runs on **every** analysis, including non-directional ones, so the recommendation object always carries an `mtf` block recording what consensus concluded. `mtf.required = true` means a missing consensus is reported as an explicit warning rather than silently skipped.

### 12.2 The six rules

Evaluated in order; first match wins. Each returns an action, the rule id, and a written reason.

| Rule | Condition | Action |
|---|---|---|
| **M0** | consensus not supplied | `not_evaluated` + warning |
| **M1** | quality < 0.40 or confidence < 0.35 | `none` — too thin to act on |
| **M2** | recommendation is non-directional | `none` — nothing to arbitrate |
| **M3a** | consensus **opposes**, confidence ≥ 0.45 | **`block`** → WAITING_FOR_CONFIRMATION |
| **M3b** | consensus **opposes**, confidence < 0.45 | **`demote`** → band steps one notch toward Neutral |
| **M4** | agreement < 0.50, neutral, or flagged conflicted | **`weaken`** → −10 confidence points |
| **M5** | full agreement in the same direction | **`strengthen`** → +6 confidence points |
| **M6** | partial agreement, direction aligned | `none` — above fracture, below full alignment |

### 12.3 Influence on qualification

A **block** (M3a) converts a directional band into the non-directional `WAITING_FOR_CONFIRMATION` outcome. Because that outcome is non-directional, the existing consistency rule strips the executable trade — verified by test: `opposed.trade === null`. So an opposing higher timeframe does not merely lower a number; it **removes the trade from the output entirely**.

### 12.4 Influence on recommendation strength

Only M3b changes the band, stepping it one notch toward Neutral (Strong Buy → Buy → Weak Buy → Neutral, and the bearish mirror). The change is recorded as `mtf.bandChange = { from, to }`. Alignment deliberately **cannot promote** a band (`allowBandPromotion: false`) — consensus may restrain a call but never inflate one, which keeps the composite score the sole source of directional strength.

### 12.5 Influence on confidence

Confidence is adjusted after arbitration and both values are retained:

- `metrics.confidenceBeforeMtf` — the Phase 6 value
- `metrics.mtfConfidenceAdjustment` — the delta applied
- `confidence` — the final figure

Adjustments: **+6** on full alignment, **−10** on fractured consensus, **−22** on opposition. When no adjustment applies, `confidence === confidenceBeforeMtf` exactly — asserted by test.

### 12.6 How conflicting timeframes are resolved

The underlying R1–R4 rules in `qt-trend.consensus()` still govern how the timeframes themselves are reconciled: **R1** the higher timeframe sets the permitted direction; **R2** a weak HTF opposed by both lower timeframes yields NEUTRAL flagged `conflicted`; **R3** agreement bonus / proportional disagreement penalty; **R4** an unavailable timeframe is excluded and its weight redistributed.

Arbitration then consumes that outcome. A `conflicted` consensus routes to M4 (weaken) rather than M5, so an unresolved cross-timeframe disagreement can never strengthen a recommendation. Conflicting timeframe names are carried into the reason string and rendered on the card.

### 12.7 Transparency

The card renders an MTF block in Level 2 showing the action, the written reason, consensus direction, agreement %, dominant timeframe, conflicting timeframes, consensus confidence, and any band or confidence adjustment. When consensus caused **no** change, the reason still explains why — the live verification run recorded:

> *rule M2 — "The recommendation is non-directional, so cross-timeframe agreement cannot strengthen or oppose it."*

When arbitration acts, `reasoning.limitingFactor.factor` becomes `mtf_consensus`, so the limiting factor surfaced to the user names the higher timeframe as the constraint.

**Coverage:** 52 assertions across the six rules, both directions, integration into the recommendation object, and determinism.
# PROJECT STATUS — Master Checklist

**Primary reference for the whole project.** Status reflects what is verifiable in
this repository snapshot. It is intentionally conservative: nothing is marked
complete unless it is implemented **and** tested here.

**Legend:** ✅ Completed & tested · 🟢 Working · 🟡 Partial · 🔴 Not started · ⚪ Future enhancement

> Snapshot facts: whole test suite **1661/1661 passing** (`node tests/run-all.js`).
> Engine + UI are in this repo (`FOREX/`) and tested here.
> **Correction from an earlier draft of this file:** the proxy is not missing —
> it lives in a **separate sibling project** at `C:\trading-proxy` (its own
> `server.js`, `src/`, `.env`, tests, `package.json`), outside this repository.
> It was found **running** (`npm start` → `node server.js`) during this session.
> This repo (`FOREX/`) is now a git repository with the engine + UI committed;
> `C:\trading-proxy` is a separate, not-yet-git-tracked project and is
> untouched by any commit made here.

---

## 1. Core Engine  — ✅ complete & tested (Phases 1–9, deterministic)
| Item | Status | Notes |
|---|---|---|
| Indicators | ✅ | `qt-indicators.js`; golden + regression locks on 600 real BTC/USD bars. |
| Trend | ✅ | `qt-trend.js`; direction/strength/state machine, `barsInState`. |
| Patterns | ✅ | candles, structure, SMC, chart patterns; registry orchestration. |
| Risk | ✅ | `qt-risk.js`; entry/stop/targets, R:R, EV, ATR exposure. |
| Recommendation | ✅ | `qt-recommendation.js`; 7 bands + 6 non-directional outcomes; damping. |
| Scoring | ✅ | `qt-scoring.js`; directional/quality categories; capability renormalisation. |
| MTF | ✅ | consensus arbitration (M0–M6); never summed into composite. |
| Capability detection | ✅ | observed-only; exclusion + renormalisation. |
| Sentiment | 🟡 | `qt-sentiment.js` implemented; live news depends on the proxy feed. |
| Volume | 🟡 | consumed capability-aware when a volume-bearing provider is present. |
| Calibration | 🟡 | probabilities calibrated per research; no live re-calibration loop. |
| Backtesting | ✅ | `backtest/qt-backtest.js`; fill realism + metrics tested (Phase 9). |
| Walk-forward | ✅ | walk-forward + Monte-Carlo tests (Phase 9). |
| Validation | ✅ | no-future-leak adversarial tests; determinism tests. |

## 2. UI (Presentation Layer)  — ✅ v1.1 (frozen candidate)
| Item | Status | Notes |
|---|---|---|
| Charts workspace | ✅ | dominant TradingView chart + live ticker tape. |
| KEEN workspace | ✅ | full analysis workstation; internal scroll. |
| Trader Mode | ✅ | decision-focused; CSS-visibility only. |
| Analyst Mode | ✅ | full engine output exposed. |
| Presentation | ✅ | `qt-card.js` renderer; hero executive summary + trade ladder. |
| Accessibility | ✅ | tablist/radiogroup/hamburger ARIA; heading order; AA contrast; reduced motion. |
| Responsive | ✅ | zero page scroll & zero H-overflow at 390–1920 (measured). |
| Persistence | ✅ | workspace, mode, symbol, interval, profile, style. |
| Testing | ✅ | 428 presentation assertions + real-browser measurement. |

## 3. Provider Gateway  — 🟢 implemented in `C:\trading-proxy` (per prior session; not re-verified now)
| Item | Status | Notes |
|---|---|---|
| Registry | 🟢 | `C:\trading-proxy\src\registry.js` exists (priority/failover/health/quota design — PROXY-REVIEW.md). |
| Providers | 🟢 | 11 providers per `SESSION-HANDOVER.md`'s prior claim; **not re-checked this session.** |
| Health | 🟢 | health/degradation/cooldown implemented per prior session; not adversarially re-verified. |
| Failover | 🔴 | failover test suite not implemented/validated (stated as a blocker in the prior handover too). |
| Quota / Caching / Retry / Timeout | 🟢 | present per prior session's claims; not re-verified now. |
| Capabilities | 🟢 | the engine consumes `bundle.capabilities` today (verified in this repo's tests). |
| Endpoints | 🟢 | consolidated `/api/v1/bundle` contract; consumed by `qt-app.js` in this repo. |
| Authentication | 🔴 | not started — **the one blocker for safe public exposure**. |

## 4. Proxy (server)  — 🟢 exists and was observed running, in a separate project
| Item | Status | Notes |
|---|---|---|
| Location | — | **`C:\trading-proxy`** — a sibling project, NOT inside this `FOREX` repo. |
| Server | 🟢 | `server.js` confirmed present; a `node server.js` process (started via `npm start`) was observed running during this session — **not started or stopped by this session's work.** |
| Configuration | 🟢 | `package.json`, documented in `PROXY_GUIDANCE.md`/`PROXY-REVIEW.md`. |
| Environment (.env) | 🟢 | a real `.env` is present in `C:\trading-proxy` — **never read, copied, or committed from here.** |
| Logging / Validation / CORS | 🟡 | present per the prior session's review (`PROXY-REVIEW.md`); not re-verified in this session. |
| Security hardening | 🔴 | rate limiting and shared-secret auth not started. |
| Shared secret | 🔴 | not started — this is milestone #1 below. |

## 5. Deployment  — 🔴 planned (not verified)
| Item | Status | Notes |
|---|---|---|
| IIS | 🔴 | `web.config` present; deployment not verified. |
| Cloudflare Tunnel | 🔴 | not started. |
| ARR (reverse proxy) | 🔴 | not started. |
| URL Rewrite | 🟡 | rules in `web.config`. |
| web.config | 🟢 | present at repo root. |
| Portability | ✅ | no build step; runs from `file://` or any static host; `tools/serve.js`. |
| Documentation | 🟡 | PRODUCTION-READINESS.md; deployment guide incomplete. |

## 6. Testing
| Item | Status | Notes |
|---|---|---|
| Engine tests | ✅ | Phases 1–9 (this repo). |
| UI tests | ✅ | Phase 8 + 8.5–8.9 (428 assertions, this repo). |
| Proxy tests | 🟡 | `C:\trading-proxy\tests\proxy.test.js` exists (21/21 per prior session); not re-run in this session. |
| Integration tests | 🟡 | client↔proxy contract only, not end-to-end. |
| Regression tests | ✅ | indicator/recommendation regression locks. |
| Manual tests | 🟢 | real-browser (DevTools Protocol) screenshots at all breakpoints. |
| **Total (this repo)** | ✅ | **1661 / 1661 assertions passing** (`node tests/run-all.js`). |

## 7. Documentation
| Item | Status | Notes |
|---|---|---|
| README | ✅ | `README.md`. |
| Roadmap | ✅ | `PROJECT-ROADMAP.md`. |
| Production readiness | 🟢 | `PRODUCTION-READINESS.md`. |
| Architecture | ✅ | `UI_ARCHITECTURE.md` (+ engine docs). |
| Known issues | 🟢 | `UI_KNOWN_LIMITATIONS.md` (UI); general known-issues doc 🔴. |
| Testing results | ✅ | `UI_TEST_RESULTS.md`, `VALIDATION.md`. |
| Changelog | 🔴 | not started. |
| ADR | ✅ | `ARCHITECTURE_DECISIONS.md`. |
| Deployment guide | 🟡 | partial (IIS/Cloudflare pending). |
| UI docs set | ✅ | UI_VERSION / UI_ARCHITECTURE / UI_COMPONENTS / UI_TEST_RESULTS / UI_KNOWN_LIMITATIONS. |

## 8. Repository
| Item | Status | Notes |
|---|---|---|
| Cleanup | 🟢 | no stray temp files; dead code removed during UI freeze. |
| Git status | ✅ | `FOREX/` initialised as a git repo and committed this session. |
| .gitignore | ✅ | created (excludes `node_modules`, `.env*`, OS/editor cruft — defensive, even though none exist here). |
| Commit plan | ✅ | single initial commit of the current tree (engine + UI + tests + docs). |
| GitHub push | 🔴 | not started — no remote configured. |
| Release preparation | 🟡 | UI v1.1 frozen; engine tagged internally as complete. |
| **`C:\trading-proxy`** | 🔴 | separate project, **not a git repo**, **not touched by this session's commit.** |

---

## Remaining Work (prioritised)

| # | Milestone | Priority | Depends on | Blockers |
|---|---|---|---|---|
| 1 | Proxy authentication (shared secret / key) in `C:\trading-proxy` | High | proxy server (exists, running) | none — ready to start |
| 2 | IIS production deployment + `web.config` verify | High | 1 | Windows/IIS host |
| 3 | Cloudflare Tunnel hardening (domain access) | High | 2 | domain, tunnel creds |
| 4 | Provider gateway failover + resilience validation | High | proxy server (exists) | failover test suite |
| 5 | Strategy Validation Dashboard | Medium | engine (done) | UI surface for backtests |
| 6 | Walk-forward validation & large-scale backtesting | Medium | engine (done) | data volume |
| 7 | Production hardening (rate limit, CORS, logging) | Medium | 1 | — |
| 8 | `CHANGELOG.md` + repository polish | Low | — | `FOREX/` git init already done this session |
| 9 | Git strategy & GitHub push (`FOREX/`), and decide whether `trading-proxy` becomes its own repo or a submodule | Medium | 8 | remote repo, decision on proxy repo structure |

### Future enhancements (⚪, not blocking a freeze)
- ⚪ Live provider-health panel in the header (needs a proxy health endpoint).
- ⚪ Global keyboard shortcuts for workspace/symbol switching.
- ⚪ Per-card independent scroll regions in KEEN (currently one scroll region).

---

## What is production-ready today
- The **analytical engine** (deterministic, tested, 1624 assertions, this repo).
- The **presentation layer** (UI v1.1: two workspaces, dual modes, persistence,
  accessibility, responsive, zero page scroll — all verified, this repo).
- The **proxy** (`C:\trading-proxy`) exists, is implemented per its own prior
  session's verification, and was observed running — but has **no
  authentication**, so it is not yet safe to expose publicly.

## What still needs validation / building
- **Proxy authentication** (the actual blocker — the server itself already runs).
- Provider failover validation, deployment (IIS + Cloudflare), and everything
  else in the Remaining Work table above.
# Project Roadmap & Status
### Quantitative Trading Analysis Platform — master reference
*The primary reference document. Start every future session here.*

---

## 1. Objective

Transform a TradingView dashboard into a **production-grade quantitative trading analysis platform**: deterministic, research-driven, fully explainable, and honest about what it does not know. TradingView remains the visualisation layer only — every calculation is performed independently.

---

## 2. Architecture

```
Browser (dashboard.html)                     presentation only, zero analysis
  └─ qt-app.js                               orchestration, no maths
       ↓ HTTP
  Node Gateway :3001                         sole holder of API keys
   ├─ registry.js      priority · failover · health · quota
   ├─ provider-defs.js 11 providers
   ├─ gateway.js       capability resolution
   └─ routes-v1.js     /api/v1/*
       ↓  normalised OHLCV + capabilities
  ENGINE  (18 modules, single QT.* namespace, no build step)
   P2 indicators → P3 patterns → P4 trend → P5 risk → P6 scoring → P7 recommendation
                                    ↑ qt-levels (S/R + Fibonacci)
       ↓
  qt-card.js                                 renders the recommendation object
       ↕
  backtest/qt-backtest.js                    independent; consumes the engine as a user
```

**Data flow rule:** each phase consumes the previous phase's structured output and recalculates nothing.

---

## 3. Subsystems

| Subsystem | Location | Status |
|---|---|---|
| Analytical engine | `engine/*.js` (18 modules) | ✅ Complete |
| Provider gateway | `C:\trading-proxy\src\` | 🟡 85% — failover untested |
| Backtesting | `backtest/qt-backtest.js` | ✅ Framework complete |
| Presentation | `engine/qt-card.js`, `dashboard.html` | ✅ Complete |
| Validation dashboard | — | ❌ Not started |
| Security layer | — | ❌ Not started |
| Deployment | `web.config` | 🟡 Written, unverified on IIS |

---

## 4. Progress report

### Completed phases

| Phase | Deliverable | Assertions |
|---|---|---|
| 1 | Market data layer | 59 |
| 2 | Indicator engine (25+ indicators) | 143 |
| 3 | Pattern recognition (20 detectors) | 141 |
| 4 | Trend & market structure | 148 |
| 5 | Risk / trade construction | 149 |
| 6 | Weighted scoring + qualification | 241 |
| 7 | Recommendation engine | 158 |
| 8 | Presentation layer | 80 |
| 9a | MTF consensus arbitration | 52 |
| 9b | Backtesting framework | 98 |
| **Total** | | **1276 + 21 proxy** |

### Current phase
**Provider Gateway (Milestone 1)** — registry wired into production routes and verified end-to-end. Failover/health/quota implemented but exercised only on the happy path.

### Pending
1. Failover test suite · 2. Proxy authentication · 3. IIS verification · 4. Portability audit · 5. Strategy Validation Dashboard · 6. Final verification & repo finalisation

### Completion: **~78%**

| Area | % |
|---|---:|
| Analytical engine | 100 |
| Backtesting framework | 100 |
| Provider gateway | 85 |
| Presentation | 100 |
| Security | 15 |
| Deployment | 40 |
| Validation dashboard | 0 |

---

## 5. Feature inventory

### ✅ Production ready

**Indicators (25+)** — SMA, EMA, WMA, VWMA, RMA, RSI, MACD, ADX/DI, ATR, CCI, ROC, Momentum, Stochastic (slow), Williams %R, Bollinger, Keltner, Donchian, OBV, MFI, CMF, VWAP, Relative Volume, Volume Profile (POC/VAH/VAL), SuperTrend, PSAR, Ichimoku, Pivot Points, Realised Volatility. *30/30 cross-validated against an external oracle.*

**Pattern recognition (20 detectors)** — Candlestick: engulfing, pin bar/hammer/shooting star, doji, inside/outside bar, harami, morning/evening star, three soldiers/crows. Structure: HH/HL/LH/LL, BOS, CHoCH (internal + external). SMC: FVG, order blocks, breaker blocks, mitigation blocks, liquidity sweeps, equal highs/lows, premium/discount. Chart: double top/bottom, H&S ±inverse, triangles (asc/desc/sym), wedges, rectangle, channels, flags.

**Trend engine** — 8 dimensions, 10 regimes with scored rejections, deterministic replay state machine with Schmitt-trigger hysteresis, 4 outcome probabilities, MTF consensus (R1–R4).

**Risk engine** — 6 qualification outcomes, 4 entry models, 3 stop tiers with self-rejection, 3 evidence-derived targets with probabilities, multi-metric R:R, 10-state lifecycle. Portfolio-independent (test-enforced).

**Scoring** — 10 evidence categories (directional vs quality separated), 5 strategy profiles, capability-aware renormalisation, three-tier qualification, full traceability.

**Recommendation** — 7 directional bands + 6 non-directional outcomes, band-edge damping, MTF arbitration (6 rules), consistency validation, executive + technical explanations.

**Presentation** — 5-level progressive disclosure, meters, probability bars, gate display, contribution table, graceful no-trade handling.

**Backtesting** — candle-by-candle replay, adversarially-verified leakage prevention, walk-forward IS/OOS, Sharpe/Sortino/PF/expectancy/MAE/MFE, seeded Monte-Carlo.

**Gateway** — 11 providers, capability resolution, caching, coalescing, quota budgets, structured logging, typed errors.

### 🟡 Implemented, awaiting verification
- Provider failover / health degradation / cooldown recovery
- `web.config` (never deployed to real IIS)
- FRED + Finnhub providers (keys not configured)
- Blockchain / DeFi / Economic endpoints (built, not consumed by the engine)

### ❌ Not started
Strategy Validation Dashboard · proxy authentication · portability audit · repo finalisation · engine consumption of Fear & Greed / on-chain / macro data

---

## 6. Capability matrix

| Markets | 11 symbols — BTC/USD (crypto), XAU/USD (metal), 9 forex pairs |
|---|---|
| **Timeframes** | 1m, 5m, 15m, 30m, 1h, 4h, D |
| **Providers** | Binance*, TwelveData, Finnhub, ExchangeRate-API, Frankfurter*, exchangerate.host*, NewsAPI, FRED, Alternative.me*, Blockchain.com*, DefiLlama*  (*keyless) |
| **Capabilities live** | ohlcv ✅ · **volume ✅ (crypto)** · price ✅ · news ✅ · fxRates ✅ · fearGreed ✅ · blockchain ✅ · defi ✅ · economic ⚠️ (needs key) |
| **APIs** | `/api/v1/` health, capabilities, meta/symbols, ohlcv, price, news, fx, fear-greed, blockchain, defi, economic, bundle · legacy `/api/*` preserved |
| **Deployment** | Windows + IIS + Cloudflare Tunnel (target) · Node ≥18 · works from `file://` and http |

---

## 7. Outstanding tasks (prioritised)

### 🔴 CRITICAL

**C1 — Proxy authentication**
*Objective:* shared-secret or token auth on `/api/*`.
*Reason:* the gateway is unauthenticated; anyone reaching the tunnel hostname can spend your API quota.
*Depends on:* nothing. *Effort:* ~1 hour. **Blocks public exposure.**

**C2 — Provider failover test suite**
*Objective:* adversarially kill providers; assert fallthrough → degradation → cooldown → recovery.
*Reason:* failover is the gateway's core value and has only run on the happy path.
*Depends on:* nothing. *Effort:* ~1–2 hours.

### 🟠 HIGH

**H1 — IIS deployment verification** — deploy, confirm ARR proxying, MIME types, CSP doesn't break TradingView. *Effort:* ~1–2 h. *Depends on:* ARR + URL Rewrite installed.

**H2 — Portability audit** — remove absolute paths from test/serve helpers; verify clean-clone startup. *Effort:* ~1 h.

**H3 — Strategy Validation Dashboard** — renders existing backtester output. *Effort:* ~3–4 h. *Depends on:* nothing (backtester complete).

### 🟡 MEDIUM

**M1 — Statistically meaningful backtests** — multi-symbol, multi-year history. *Effort:* ~2–3 h. *Depends on:* C2, gateway history depth.
**M2 — Engine consumption of Fear & Greed / on-chain / macro** — new evidence categories. *Effort:* ~3 h.
**M3 — Remove superseded `src/routes.js` v1 block** — dead code. *Effort:* ~15 min.

### 🟢 LOW

**L1** favicon (404) · **L2** helmet/compression deps · **L3** shared-store rate limiter for multi-instance · **L4** multilingual sentiment lexicon

---

## 8. Deployment readiness

| Item | Status | Blocker |
|---|---|---|
| Dashboard (static) | ✅ Ready | none — no build step |
| Engine | ✅ Ready | none |
| `web.config` | 🟡 Written | needs **URL Rewrite + ARR**; never tested on real IIS |
| Node gateway | 🟡 Functional | **no authentication** |
| Cloudflare Tunnel | 🔴 Not ready | C1 — unauthenticated API would be publicly reachable |
| Portability | 🟡 Mostly | absolute paths in test/serve helpers |
| Secrets | ✅ Safe | `.gitignore` covers `.env`; `.env.example` documents all |

**Safe today:** LAN / localhost testing.
**Before the tunnel goes public:** implement C1.

---

## 9. Technical debt

1. **No backtest at statistical significance** — 12 trades vs the 1,000+ the research demands. Every weight remains an unvalidated calibration assumption.
2. Provider failover untested.
3. `src/routes.js` still exports a superseded v1 router.
4. Three chart-pattern tests self-skip on synthetic geometry.
5. Softmax temperatures + outcome-probability coefficients are frank guesses.
6. Fear & Greed / blockchain / DeFi endpoints exist but nothing consumes them.

---

## 10. Known limitations

- **Volume is crypto-only.** TwelveData supplies none for forex/metals, so Layer 3 is excluded for those (transparently, with renormalisation).
- **Confidence is not a success probability** — it measures fit to the configured strategy. Stated in every recommendation.
- **No profitability claim.** Vendor win rates are used only as weighting priors and are never displayed.
- Sentiment lexicon is English-only, hand-built, capped at 0.25 influence.
- MTF consensus uses the LTF trend for its own slot (not independently recomputed).

---

## 11. Extension points

| Extension | Where | Engine change? |
|---|---|---|
| New provider | `provider-defs.js` + registry | none |
| New detector | `QT.patterns.register()` | none |
| New strategy profile | `qt-profiles.js` data | none |
| Position sizing / portfolio | consumes `positionRisk` | none |
| Broker execution | consumes `trade.lifecycle` | none |
| Alerts / mobile | consumes the recommendation object | none |
| New evidence category | `qt-scoring.js` + profile weights | additive |

---

## 12. Testing checklist (for your break)

### UI & responsiveness
- [ ] Resize 320px → ultrawide; no horizontal scroll at any width
- [ ] Symbol dropdown: search, keyboard (↑↓/Enter/Esc), click-outside
- [ ] All arrows identical across Symbol / Interval / Style / Profile
- [ ] Header shows dot + Kuwait 12h time only
- [ ] Card sections expand/collapse; only L1 open by default

### Charts
- [ ] Chart loads for all 11 symbols
- [ ] All 7 intervals switch correctly; chart fills its panel
- [ ] Ticker tape stays dark at narrow widths

### Recommendation card
- [ ] Analyze works for several symbol × timeframe combinations
- [ ] No-trade outcomes show **no** entry/stop/targets
- [ ] Expected value visible even when negative
- [ ] MTF block always present with a written reason
- [ ] Switch profiles on the same symbol — do conclusions differ sensibly?
- [ ] Technical trace readable and complete

### API & errors
- [ ] Stop the proxy → Analyze shows an actionable error naming the URL
- [ ] Restart → recovers without page reload
- [ ] `GET /api/v1/health` — provider health sensible
- [ ] `GET /api/v1/capabilities?assetClass=crypto` — volume true
- [ ] Rapid repeat Analyze — no double-run (button disables)

### Consistency & edge cases
- [ ] Same symbol/timeframe twice in a row → identical recommendation
- [ ] Forex symbol → volume-related evidence absent, not zeroed
- [ ] Any consistency warnings displayed?
- [ ] Browsers: Edge, Chrome, Firefox; mobile if convenient

**Please note for each issue:** symbol, timeframe, profile, what you expected, what happened, and whether it reproduces.

---

## 13. Next Session Bootstrap

**Where development stopped:** Provider gateway wired into production routes and verified end-to-end — Binance delivers genuine crypto volume (Layer 3 restored), news sentiment is now a live scoring contributor, Fear & Greed flows. `web.config` written but never deployed.

**Implement first, in order:**
1. **C1 proxy authentication** — blocks the tunnel
2. **C2 failover test suite** — validates the gateway's core value
3. **H1 IIS verification** — needs ARR installed
4. **H2 portability audit**
5. **H3 Strategy Validation Dashboard**

**Do NOT change:**
- Engine module load order in `dashboard.html`
- The determinism guarantees — no `Math.random` / `Date.now` in any analysis path
- The architecture boundary — presentation never calculates; if a display needs a value, add it to the engine
- Capability-aware behaviour — never fabricate or zero-fill missing data
- `tests/fixtures/*.json` — immutable regression anchors
- Weights and thresholds — **do not hand-tune**; optimisation is reserved for walk-forward backtesting

**Key architectural decisions (do not re-litigate):**
1. Capability-aware analysis over hard-coded layers
2. Deterministic **replay** state machine instead of persisted state
3. MTF consensus as a decision layer, not a score
4. Three-tier qualification (hard / configurable / informational) with EV informational by default
5. Directional vs quality categories kept separate in scoring
6. Backtester lives outside `engine/` and consumes it as a user
7. Timestamps injected, never read from the clock in analysis

**Assumptions:** research conflicts resolved by regime conditioning (`RESEARCH-SYNTHESIS.md`); all weights are calibration assumptions, not constants; the platform is decision-support, not a validated strategy.

**Verify on resume:** `node tests/run-all.js` → 1276 passing; `node tests/proxy.test.js` (in `C:\trading-proxy`) → 21 passing.

---

## 14. Document index

| File | Purpose |
|---|---|
| `PROJECT-ROADMAP.md` | **this file** — start here |
| `RESEARCH-SYNTHESIS.md` | research conflicts & resolutions — the functional spec |
| `VALIDATION.md` | indicator cross-validation evidence |
| `PROXY-REVIEW.md` | original backend audit |
| `IMPLEMENTATION-NOTES.md` | change log + Architecture Evolution |
| `PRODUCTION-READINESS.md` | readiness assessment + MTF mechanism (§12) |

*Educational analysis only. Not financial advice.*
# Enterprise Production Quantitative Trading Analysis Engine — Complete Implementation Request

## Mission

You are an expert:

- Quantitative Trading Platform Architect
- Financial Software Engineer
- Quantitative Research Engineer
- Financial Mathematician
- Algorithmic Trading Developer
- JavaScript Software Architect
- UI/UX Engineer
- Performance Optimization Specialist
- Software Quality Engineer

Your mission is to transform the existing **Live Market Dashboard** into a **professional quantitative trading analysis platform**.

The final project must be production-grade, deterministic, modular, maintainable, and mathematically accurate.

Never produce demo code, placeholder implementations, simplified formulas, or proof-of-concept architecture.

---

# IMPORTANT PROJECT CONTEXT

The project already contains a working dashboard.

Do NOT redesign or replace it.

Preserve:

- TradingView widget
- Responsive UI
- Symbol selector
- Timeframe selector
- Existing layout
- Existing styling
- Existing user experience

Your task is to EXTEND the existing project instead of rebuilding it.

Only modify existing code when absolutely necessary.

---

# FIRST TASK — RESEARCH PHASE (MANDATORY)

Before writing or modifying any code:

Search the project root directory for all research documents.

Read every relevant **.md** file that contains information about:

- Trading strategies
- Indicator combinations
- Mathematical formulas
- Technical analysis
- Market structure
- Risk management
- Fibonacci
- Trend analysis
- Support & Resistance
- Candlestick analysis
- Smart Money Concepts
- Quantitative trading
- Algorithmic trading
- Professional trading methodologies

Treat those research documents as the project's functional specification.

Your implementation must be based on those research findings whenever they provide guidance.

Do not blindly implement generic internet strategies if the research files specify a preferred methodology.

If multiple research files contain complementary ideas, intelligently synthesize them into one coherent quantitative analysis model.

If conflicts exist between documents:

- Explain the conflict.
- Choose the mathematically stronger approach.
- Document your reasoning.

---

# ARCHITECTURE

TradingView Widget

↓

Visualization Layer Only

↓

Analyze Button

↓

Market Data Layer

↓

Indicator Engine

↓

Pattern Recognition Engine

↓

Market Structure Engine

↓

Trend Engine

↓

Support & Resistance Engine

↓

Fibonacci Engine

↓

Risk Management Engine

↓

News Sentiment Engine

↓

Weighted Scoring Engine

↓

Recommendation Engine

↓

Recommendation Card

---

# TRADINGVIEW

The TradingView widget is ONLY the visualization layer.

Never attempt to extract internal indicator values from TradingView.

Never rely on TradingView calculations.

All mathematical calculations must be implemented independently.

---

# DATA SOURCES

## TwelveData

Primary market data provider.

Retrieve raw market data whenever possible.

Prefer:

- OHLCV
- Historical candles
- Latest price
- Multiple timeframes

Calculate indicators internally instead of relying on precomputed API indicators unless there is a compelling reason not to.

---

## ExchangeRate-API

Use only when appropriate as a supplementary forex data source or fallback.

---

## NewsAPI

Retrieve relevant financial news for the active symbol.

Convert news into a quantitative sentiment score.

News must never independently generate trading signals.

Sentiment should influence the confidence score only.

---

# ANALYSIS EXECUTION

The analyzer is NOT an AI agent.

The analyzer does NOT continuously run.

The analyzer executes ONLY when requested.

Workflow:

User selects:

- Symbol
- Timeframe

↓

User clicks

Analyze

↓

Collect required data

↓

Perform all calculations

↓

Generate recommendation

↓

Display recommendation card

---

# MARKET DATA LAYER

Implement:

- retries
- caching
- timeout handling
- validation
- normalization
- error recovery
- rate-limit awareness

Minimize unnecessary API requests.

---

# MATHEMATICAL ENGINE

Implement production-grade mathematical formulas.

Avoid third-party indicator libraries whenever practical.

Implement indicators using authoritative mathematical definitions.

Support configuration of:

- periods
- smoothing methods
- thresholds
- weighting
- strategy parameters

All parameters must be configurable from one centralized configuration object.

---

# INDICATOR ENGINE

Implement robust versions of:

EMA

SMA

WMA

VWMA

RSI

MACD

ADX

ATR

CCI

ROC

Momentum

Bollinger Bands

Keltner Channels

Donchian Channels

Stochastic

Williams %R

OBV

MFI

CMF

VWAP

SuperTrend

Parabolic SAR

Ichimoku Cloud

Pivot Points

Volume analysis

Volatility analysis

Trend analysis

Additional indicators may be implemented if justified by the research documents.

---

# FIBONACCI ENGINE

Automatically detect swing highs and lows.

Calculate:

- Retracements
- Extensions
- Expansions

Generate exact price levels.

---

# SUPPORT & RESISTANCE

Automatically detect:

- major support
- major resistance
- swing highs
- swing lows
- zones
- strength ranking

---

# PATTERN DETECTION

Support detection of:

- trend continuation
- trend reversal
- market structure
- break of structure
- change of character
- double top
- double bottom
- head and shoulders
- triangles
- wedges
- flags
- engulfing
- pin bars
- inside bars

Additional patterns may be implemented if supported by the research.

---

# TREND ENGINE

Determine:

- Bullish
- Bearish
- Neutral
- Trend strength
- Trend quality

---

# MULTI-TIMEFRAME ANALYSIS

Support confirmation across multiple timeframes.

Higher timeframes should generally carry greater weight unless the strategy documented in the research specifies otherwise.

---

# NEWS SENTIMENT

Convert news into:

- bullish score
- bearish score
- neutral score

Use sentiment only as a confidence modifier.

Never allow sentiment alone to produce a BUY or SELL recommendation.

---

# WEIGHTED SCORING ENGINE

Implement a configurable quantitative scoring model.

Indicators may agree or disagree.

Each indicator should contribute according to configurable weights.

The final engine should calculate:

- Buy probability
- Sell probability
- Neutral probability
- Trade quality score
- Confidence percentage

Avoid simple indicator counting.

Use weighted quantitative analysis.

---

# RISK MANAGEMENT

Calculate:

- Entry
- Exit
- TP1
- TP2
- TP3
- SL1
- SL2
- SL3
- Risk/Reward Ratio
- Volatility-adjusted stop loss
- ATR-based stop loss

---

# RECOMMENDATION ENGINE

Possible outputs:

- Strong Buy
- Buy
- Weak Buy
- Neutral
- Weak Sell
- Sell
- Strong Sell

Every recommendation must include:

- reasoning summary
- confidence percentage
- contributing indicators
- conflicting indicators
- primary risk factors

---

# RECOMMENDATION CARD

Display:

- Recommendation
- Confidence %
- Trend
- Trend Strength
- Entry
- Exit
- TP1
- TP2
- TP3
- SL1
- SL2
- SL3
- Support Levels
- Resistance Levels
- Fibonacci Levels
- Risk / Reward Ratio
- Volatility
- News Sentiment
- Indicator Summary
- Reasoning Summary
- Timestamp
- Active Symbol
- Active Timeframe

---

# SOFTWARE ENGINEERING REQUIREMENTS

Implement the project in clearly defined phases.

Recommended implementation order:

Phase 1

Market Data Layer

↓

Phase 2

Mathematical Indicator Engine

↓

Phase 3

Pattern Detection

↓

Phase 4

Trend & Market Structure

↓

Phase 5

Risk Management

↓

Phase 6

Weighted Scoring Engine

↓

Phase 7

Recommendation Engine

↓

Phase 8

Recommendation Card UI

Each phase must be fully completed and verified before beginning the next.

---

# VALIDATION

Validate every implemented indicator by comparing its output against trusted references using identical OHLCV data.

Document any unavoidable deviations.

---

# CONFIGURATION

All strategy settings must be centralized, including:

- indicator periods
- thresholds
- smoothing methods
- scoring weights
- confidence thresholds
- risk settings

The trading strategy should be adjustable without modifying the analysis engine itself.

---

# DETERMINISTIC BEHAVIOR

The analyzer must be deterministic.

Given the same:

- market data
- configuration
- strategy

it must always produce the same result.

No randomness.

No hidden AI decisions.

No non-repeatable outputs.

---

# TESTING

Create a reusable validation dataset from historical market snapshots.

Use it to verify that future modifications do not unintentionally change indicator calculations or recommendation logic.

---

# CODE QUALITY

Production-grade only.

No placeholders.

No TODO comments.

No pseudo-code.

No mocked calculations.

No fake values.

No simplified implementations.

Keep responsibilities separated.

Design for long-term maintainability and extensibility.

---

# PERFORMANCE

Optimize for:

- minimal API requests
- fast execution
- efficient memory usage
- responsive UI
- scalable architecture

---

# FINAL DELIVERABLE

Produce a fully integrated implementation that extends the existing dashboard.

The user workflow must be:

1. Open the dashboard.
2. Select a trading symbol.
3. Select a timeframe.
4. Click **Analyze**.
5. Retrieve market and news data.
6. Execute all mathematical calculations internally.
7. Generate a deterministic, research-driven quantitative trading analysis.
8. Display a professional recommendation card while the TradingView widget continues to serve as the visualization layer.
# Backend Review — `C:\trading-proxy`

*Prepared before Phase 3, as the gating deliverable for engine↔proxy integration.*
*All findings below were verified by running the server and calling its endpoints live.*

---

## 1. Current architecture summary

A single-file Express 5 application (`server.js`, 96 lines) acting as a thin credential-hiding passthrough.

```
Browser ──► Express :3001 ──► TwelveData / NewsAPI / ExchangeRate-API
```

| Item | Value |
|------|-------|
| Runtime | Node.js, CommonJS |
| Framework | Express `^5.2.1` |
| HTTP client | axios `^1.18.1` |
| Config | dotenv `^17.4.2` |
| CORS | cors `^2.8.6` |
| Port | `process.env.PORT` → 3001 |
| Structure | One file, no routers, no services, no middleware layer, no tests |

The design intent (documented in `Proxy.md`) is sound and matches the requirement that the frontend never holds API keys. The **implementation is an early scaffold** — it forwards requests correctly but implements none of the resilience or caching responsibilities the dashboard needs.

---

## 2. Existing API routes

| Route | Upstream | Live status |
|-------|----------|-------------|
| `GET /api/health` | — | ✅ works — `{"status":"ok","timestamp":…}` |
| `GET /api/price?symbol=` | TwelveData `/price` | ✅ works — returned `{"price":"66337.99"}` |
| `GET /api/timeseries?symbol=&interval=&outputsize=` | TwelveData `/time_series` | ✅ works — returns raw DESC string values |
| `GET /api/news?q=&pageSize=` | NewsAPI `/everything` | ✅ reachable |
| `GET /api/rates?base=` | ExchangeRate-API | ❌ **broken — HTTP 500 on every call** |

---

## 3. 🔴 Blocking defect: `/api/rates` source corruption

**`server.js` line 79 is corrupted.** The template literal was replaced with 3,644 characters of *rendered KaTeX HTML* — the file was pasted from rendered Markdown rather than source. The line still parses as valid JavaScript (it is a plain template string), so `node --check` passes and the fault is silent until called.

The URL actually constructed at runtime is:

```
https://v6.exchangerate-api.com/v6/<span class="katex"><span class="katex-mathml">…
```

Verified: the API key is **never interpolated** (`false`), the base currency is **never interpolated** (`false`), and the resulting URL is 3,634 characters. Every call returns `{"error":"Failed to fetch exchange rates"}` with HTTP 500.

**The correct source still exists** in `Proxy.md` line 112:

```js
`https://v6.exchangerate-api.com/v6/${process.env.EXCHANGERATE_API_KEY}/latest/${base}`
```

This is a one-line restoration. I have **not** applied it yet — flagging first, per your instruction to document improvements before implementing them.

---

## 4. 🔴 Blocking finding: no volume data is available

Tested across all three instrument classes through the proxy:

| Symbol | Fields returned |
|--------|----------------|
| BTC/USD | `datetime, open, high, low, close` |
| EUR/USD | `datetime, open, high, low, close` |
| XAU/USD | `datetime, open, high, low, close` |

**TwelveData returns no `volume` field on this plan for any of the 11 dashboard symbols.**

This is an architectural constraint, not a bug, and it directly affects the engine: **Layer 3 of the 3-Layer Stack (Volume / Conviction — D1 §1.1) cannot be computed.** OBV, MFI, CMF, VWMA, relative volume and Volume Profile all become unavailable, and every research setup requiring *"volume > 1.5× average"* loses its confirmation leg.

The engine already handles this **correctly and honestly** — `computeAll` detects `hasVolume === false` and suppresses those indicators rather than zero-filling them (asserted by a passing Phase 2 test: *"zero-volume instruments do not produce fabricated volume readings"*). But the Phase 6 scoring model must **renormalise its layer weights** across the three surviving layers, otherwise the volume layer contributes a silent zero and biases every score toward Neutral.

Three ways forward, in preference order:

1. **Renormalise to three layers** when volume is absent, and mark the recommendation as *volume-unconfirmed* in the explainability output. No new dependency, fully honest. **← my recommendation, will implement in Phase 6.**
2. Add a **Binance public klines** route to the proxy for crypto volume (free, keyless, genuine traded volume). Documented here as a proposal; needs your approval since it adds a provider.
3. Upgrade the TwelveData plan if it exposes volume for these symbols.

---

## 5. Middleware

| Middleware | Present |
|------------|---------|
| `cors()` | ✅ but unrestricted (see §9) |
| `express.json()` | ✅ (unused — all routes are GET) |
| Request logging | ❌ none |
| Error handler | ❌ no central handler |
| Rate limiting | ❌ none |
| Compression / helmet | ❌ none |
| Validation | ❌ none — query params passed upstream unchecked |

---

## 6. Caching

**None.** Every dashboard call reaches the upstream API. With TwelveData's free tier at **8 requests/minute**, a single multi-timeframe analysis (3 intervals) plus news consumes half the minute budget, and two users or a double-click will exhaust it. Server-side caching is the highest-value addition after the two blocking defects.

---

## 7. Environment variables

`.env` is present and correctly structured with all four values (`TWELVEDATA_API_KEY`, `NEWSAPI_KEY`, `EXCHANGERATE_API_KEY`, `PORT`). Keys are read only via `process.env` and never sent to the client — the core security goal is met.

⚠️ **No `.gitignore` exists** and the folder is not currently a git repository. If it is ever initialised, `.env` with three live keys would be committed on the first `git add .`. A `.gitignore` containing `.env` and `node_modules/` should be added **before** any version control is introduced.

There is no startup validation that the keys exist — a missing key surfaces as a generic 500 at request time rather than a clear boot error.

---

## 8. Logging & error handling

**Logging:** only the startup banner. No per-request logging, no upstream latency, no error detail. Diagnosing a failure currently requires reproducing it by hand.

**Error handling — this one materially breaks my client logic.** Every route uses the same pattern:

```js
catch (error) { res.status(500).json({ error: "Failed to fetch …" }); }
```

Every upstream failure is flattened to HTTP 500 with a generic string. Verified live: requesting a bad symbol returns

- **upstream:** HTTP 404, `"**symbol** parameter is missing or invalid…"` (actionable)
- **proxy:** HTTP 500, `"Failed to fetch price data"` (useless)

This is not cosmetic. My Phase 1 data layer classifies **5xx and 429 as transient (retry)** and **4xx as permanent (fail fast)** — a distinction verified by two passing tests. Because the proxy reports *everything* as 500, a permanently invalid symbol would be retried three times with backoff before failing, and a genuine 429 rate-limit is indistinguishable from a server fault. **Upstream status codes and messages must be preserved** for the client's resilience logic to function as designed.

---

## 9. Security observations

| # | Observation | Severity |
|---|-------------|----------|
| 1 | `app.use(cors())` allows **every origin**. `Proxy.md` §Security claims *"CORS configured to only allow your domain"* — the documentation and implementation disagree. Once exposed via Cloudflare Tunnel, anyone who learns the hostname can spend your API quota. | **High** |
| 2 | No rate limiting or authentication. A single scripted caller can exhaust the daily quota (800 req/day). | **High** |
| 3 | No `.gitignore`; live keys one `git init && git add .` away from being committed. | **Medium** |
| 4 | Query parameters forwarded upstream without validation or allow-listing. | **Medium** |
| 5 | No `helmet`, no request size limits, no timeout — a slow upstream holds a socket indefinitely. | **Medium** |
| 6 | `package.json` `main` points at `index.js`, which does not exist; no `start` script. Operational papercut. | **Low** |

---

## 10. Recommended improvements

Ordered by value. Nothing here has been implemented yet.

**Tier 1 — required before integration**
1. Restore line 79 from `Proxy.md` line 112 (fixes `/api/rates`).
2. Preserve upstream status codes and messages; map to a typed error envelope `{ error: { code, message, upstreamStatus, retryable } }`.
3. Per-request `axios` timeout (upstream currently has none).
4. Restrict CORS to the IIS origin + tunnel hostname via an env allow-list.

**Tier 2 — required for the dashboard to work within quota**
5. Server-side TTL cache keyed by `symbol+interval`, TTL scaled to the bar interval (a closed 1h bar is immutable for an hour).
6. Server-side rate-limit governor and request coalescing, so concurrent identical requests share one upstream call.
7. Response normalisation: return canonical ascending numeric OHLCV instead of raw DESC strings.
8. Structured request/error logging with latency.

**Tier 3 — hardening**
9. `.gitignore`, startup key validation, `helmet`, graceful shutdown, `start` script, health endpoint reporting cache/quota state.

---

## 11. New endpoints required by the dashboard

| Endpoint | Purpose | Why the existing routes don't suffice |
|----------|---------|--------------------------------------|
| `GET /api/ohlcv?symbol=&interval=&outputsize=` | Canonical bars: ascending, numeric, de-duplicated, forming bar flagged | `/api/timeseries` returns raw DESC strings; normalisation belongs server-side so it is done once and cached |
| `GET /api/bundle?symbol=&timeframe=` | **One** call returning the full MTF ladder (LTF/MTF/HTF) + news + spot | An analysis currently needs 4+ round trips; at 8 req/min this is the difference between working and rate-limited |
| `GET /api/meta/symbols` | Server-side symbol registry (provider symbol, class, news query) | Registry currently duplicated in `qt-config.js`; one authority prevents drift |
| `GET /api/health` *(extend)* | Report key presence, cache hit rate, remaining quota | Current health check proves the process is up but not that it can serve |

---

## 12. Integration plan (no frontend rework later)

`qt-data.js` was deliberately written with an **injectable transport** and provider-agnostic normalisation, so pointing it at the proxy is a configuration change, not a rewrite:

- Replace the three provider `baseUrl`s with a single `proxy.baseUrl`.
- Delete the `storageKey` credential path entirely — the browser will hold no keys at all, which is *stronger* than the localStorage design I built for Phase 1.
- `normalizeTwelveData()` stays as the fallback for `/api/timeseries`, and is bypassed when `/api/ohlcv` returns already-canonical bars.
- The existing 59 Phase 1 tests continue to run against the mock transport, unchanged.

---

## 13. Conclusion

The proxy is the **right architecture** and should be extended, not replaced. It is, however, an early scaffold with **two blocking issues** — a corrupted `/api/rates` route and the absence of volume data — plus missing caching, retry, timeout, rate limiting, logging and error fidelity.

**Awaiting your approval on three decisions before I touch it:**
1. Apply the Tier 1 fixes (including the one-line `/api/rates` restoration)?
2. How to handle the missing volume layer — renormalise to three layers *(recommended)*, or add a Binance klines route?
3. Add the `/api/bundle` endpoint, which is effectively required to stay inside the 8 req/min free-tier budget?
# Quantitative Trading Analysis Platform

A deterministic, research-driven market analysis engine with a TradingView dashboard front end. TradingView provides visualisation only — **every calculation is performed independently** by a zero-dependency JavaScript engine.

> **Educational analysis only. Not financial advice.** The engine measures how well current market conditions match a configured strategy. It makes no profitability claim and has not been validated by statistically significant backtesting.

---

## What it does

Select a symbol and timeframe, press **Analyze**, and the engine produces a fully explainable recommendation: direction, confidence, market regime, a constructed trade (entry / 3 stop tiers / 3 targets), risk metrics including probability-adjusted expected value, and a complete evidence trail showing exactly which factors drove the decision and which opposed it.

It is equally willing to conclude **No Trade** — refusing is a first-class outcome, not a failure.

---

## Quick start

**Prerequisites:** Node.js ≥ 18 (developed on v24.15.0), npm ≥ 9.

```bash
# 1. Backend gateway — holds all API keys
cd C:\trading-proxy
npm install
copy .env.example .env          # then edit .env (see below)
npm start                       # -> http://localhost:3001

# 2. Dashboard (separate terminal)
cd path\to\FOREX
npm install                     # dev dependency only (jsdom, for tests)
npm run serve                   # -> http://localhost:8322/dashboard.html
```

**Zero keys still works.** Binance (crypto OHLCV *with volume*), Frankfurter and exchangerate.host (FX), Alternative.me, Blockchain.com and DefiLlama are all keyless. Add `TWELVEDATA_API_KEY` for forex/metals and `NEWSAPI_KEY` for sentiment. See `C:\trading-proxy\.env.example` — every variable is documented as required / optional / auto-detected.

Check what is actually live: `GET http://localhost:3001/api/v1/capabilities`

---

## Architecture

```
Browser (dashboard.html)          presentation only — zero analysis
  └─ qt-app.js                    orchestration — no maths
       ↓ HTTP
  Node Gateway :3001              sole holder of API keys, 11 providers
       ↓ normalised OHLCV + observed capabilities
  ENGINE (18 modules, QT.* namespace, no build step)
   indicators → patterns → trend → risk → scoring → recommendation
       ↓
  qt-card.js                      renders the recommendation object
       ↕
  backtest/                       independent; consumes the engine as a user
```

**Three rules the codebase enforces by test:**
1. The presentation layer never calculates. If a display needs a value, it goes in the engine.
2. Each phase consumes the previous phase's output and recalculates nothing.
3. No `Math.random`, no `Date.now` in any analysis path — identical inputs always produce identical output.

---

## Testing

```bash
npm test                    # 1276 assertions across 9 phases
cd C:\trading-proxy && npm test   # 21 proxy assertions
```

Indicators are cross-validated against the `technicalindicators` npm package — **30/30 series matched** on 600 real BTC/USD daily bars (`VALIDATION.md`). That library is a test oracle only and is never shipped.

---

## Deployment (Windows + IIS + Cloudflare Tunnel)

### Prerequisites
| Requirement | Notes |
|---|---|
| Node.js ≥ 18 | for the gateway |
| IIS with static content | serves the dashboard |
| **URL Rewrite 2.1** | [download](https://www.iis.net/downloads/microsoft/url-rewrite) |
| **ARR 3.0** | [download](https://www.iis.net/downloads/microsoft/application-request-routing) — then enable: IIS Manager → server node → *Application Request Routing Cache* → *Server Proxy Settings* → tick **Enable proxy** |

Without ARR the dashboard still works — point the browser at `:3001` directly and add that origin to `ALLOWED_ORIGINS`.

### Sequence
1. Copy the project folder to the target machine (no absolute paths — it is portable).
2. `cd trading-proxy && npm ci` — reproducible install from the lockfile.
3. Create `.env` from `.env.example`; fill in keys.
4. Start the gateway: `npm start`, or as a service: `npm i -g pm2 && pm2 start server.js --name trading-proxy && pm2 save`.
5. Point an IIS site at the dashboard folder. `web.config` is already present.
6. Verify: `http://localhost/api/v1/health` should return provider health.
7. Cloudflare Tunnel: route the hostname to `http://localhost:80`, then set `ALLOWED_ORIGINS=https://yourdomain.com` in `.env` and restart the gateway.

### Firewall
Only IIS (80/443) needs to be reachable. The gateway binds `127.0.0.1:3001` and should **not** be exposed directly.

### 🔴 Before exposing publicly
**The gateway has no authentication.** Anyone who reaches the hostname can consume your API quota. This is the top-priority task for the next session (see `PROJECT-ROADMAP.md` §7, task C1). Until then, keep the tunnel private or restrict it with Cloudflare Access.

### Rollback
The project is stateless — no database, no migrations. Roll back by restoring the previous folder and restarting the gateway. Caches are in-memory and rebuild automatically.

### Troubleshooting
| Symptom | Cause / fix |
|---|---|
| "Could not reach the proxy" | Gateway not running → `npm start` in `trading-proxy` |
| `PROVIDER_NOT_CONFIGURED` | Missing key in `.env` |
| Engine scripts 404 under IIS | MIME map missing — confirm `web.config` deployed |
| `/api/*` 404 under IIS | ARR not installed or proxy not enabled |
| CORS rejection | Add the origin to `ALLOWED_ORIGINS`, restart gateway |
| No volume for forex | Expected — only Binance (crypto) supplies volume |

---

## Documentation

| File | Purpose |
|---|---|
| **`PROJECT-ROADMAP.md`** | **Start here** — status, tasks, next-session bootstrap |
| `RESEARCH-SYNTHESIS.md` | Research conflicts and resolutions — the functional spec |
| `VALIDATION.md` | Indicator cross-validation evidence |
| `PRODUCTION-READINESS.md` | Readiness assessment; §12 covers MTF consensus |
| `IMPLEMENTATION-NOTES.md` | Change log + Architecture Evolution |
| `PROXY-REVIEW.md` | Original backend audit |

---

## Project status

**~78% complete.** Analytical engine and backtesting framework are finished and verified. Outstanding: proxy authentication (blocks public deployment), provider-failover testing, Strategy Validation Dashboard, and statistically significant backtesting.

See `PROJECT-ROADMAP.md` for the prioritised task list.
# Research Synthesis & Conflict Resolution
### Functional specification for the Quantitative Trading Analysis Engine
*Derived from the four research documents in the project root. This file is the authority the engine implements against.*

---

## 1. Source inventory and evidence tier

| # | Document | Nature of evidence | Tier |
|---|----------|-------------------|------|
| **D1** | `Indicators_Setup_Inputs_Signs_Patterns_for_each_trading_pair.md` | Operational playbook: 3-layer stack, regime matrix, per-instrument risk, sessions. Reports backtest methodology (1,000+ trades) but no independent verification. | **B** — structurally sound, self-reported metrics |
| **D2** | `High Win Rate BTC Trading Setups for Professional Traders.md` | Peer-reviewed literature: Gerritsen et al. (Finance Research Letters 2020), Hudson & Urquhart (Annals of OR 2021), BIS WP1087, CFTC advisory, CME CF BRR. | **A** — peer-reviewed / regulator |
| **D3** | `High Win Rate BTC-USD Trading Setups for Professional Traders.md` | Vendor/blog-sourced setups quoting 65–85% win rates (quant-signals.com and similar). Exact indicator settings and entry logic are specific and usable. | **C** — unverified vendor claims, useful mechanics |
| **D4** | `High Win Rate XAU-USD Trading Setups for Professional Traders.md` | SMC/ICT institutional methodology for gold; cites Medium + TradingView user backtests (69/83/85% win rates) and a World Bank gold handbook. | **C** for win rates, **B** for mechanics |

**Adopted precedence rule:** where documents disagree on *whether an edge exists*, Tier A governs. Where they disagree on *how a technique is constructed*, the most precisely specified source governs (usually D1/D3), because construction detail is a definition, not a claim.

---

## 2. Conflicts and resolutions

### Conflict 1 — Are RSI and Bollinger Bands reliable signals? **(critical)**

- **D1 §1.2** ranks RSI 3rd overall (62% win rate, 1.9 profit factor). **D3 §3.2** builds a whole mean-reversion setup on BB(20,2) + RSI(14) 30/70 claiming 55–65%.
- **D2 §2 and §7** state the opposite from peer-reviewed work: Gerritsen et al. tested exactly `RSI(14) 30/70` and `Bollinger(20,2)` on Bitcoin and found they **significantly underperformed buy-and-hold, sometimes with negative Sharpe**. Moving-average rules were **not statistically different** from buy-and-hold. Hudson & Urquhart tested **14,919 rule specifications with multiple-testing correction** and found **no positive out-of-sample return** in their 2018 holdout.

**Resolution — regime conditioning, not rejection.**
The academic tests evaluated these indicators as **unconditional, always-on standalone strategies**. D1 §5.2 and D3 §3.2 both deploy them **only in ranging markets**. These are different hypotheses, and the conflict largely dissolves once that is made explicit. The mathematically stronger position is therefore:

1. RSI and Bollinger Bands are **never primary directional signals** and never carry top weight in a trending regime.
2. Their weight is **raised only when the regime detector reports RANGING** (ADX < 20), which is the sole context in which either non-academic source claims they work.
3. Their standalone contribution is capped so they can never, by themselves, move the recommendation past `Weak Buy`/`Weak Sell`.

This is implemented as `REGIME_WEIGHTS` in `qt-config.js`.

### Conflict 2 — Fixed take-profit vs trailing exit

- **D1 §6.3** prescribes a ladder: close 25% at 1:1, 25% at 1:2, 25% at 1:3, trail the last 25%.
- **D2 §3.2** warns that a fixed TP "can truncate exactly the right tail that trend following seeks" and that a trailing/opposite-channel exit is the coherent default.

**Resolution — both, selected by regime.** The documents are describing different market states, and D1's own ladder already ends in a trailing runner. The engine emits TP1/TP2/TP3 **plus** an explicit trailing-stop rule, and marks which is primary:
- **Trending regime** → ladder is advisory, trailing exit is primary (D2).
- **Ranging regime** → fixed targets primary, capped near 1:1–1:1.5 (D3 §3.2), because mean reversion has no right tail to protect.

### Conflict 3 — Headline win rates

D3 §8 and D4 quote 70–85% (and one 90%+ for funding arbitrage). D2 quotes the CFTC: *"There is no such thing as a guaranteed investment or trading strategy,"* and demonstrates with its own screen that a **47.37% win-rate** rule beat a 66.67% one on Sharpe and drawdown.

**Resolution.** The engine **never displays or implies a win rate, expectancy, or profitability claim.** D1's §1.2 table is used *only* as a Bayesian prior for relative indicator weighting (it is the one table that states a sample size), and is documented in config as a heuristic prior — not a performance promise. All output is framed as analysis, not advice.

### Conflict 4 — What deserves the highest weight?

D2 §9 ranks **daily 50/150/200-day channel breakout, regime-conditioned** as the single best-evidenced directional framework for BTC. D1 mentions Donchian channels only inside its breakout row (§5.3).

**Resolution.** Donchian channel breakout is promoted to a **first-class Layer 1 signal** with the highest single trend weight, using D2's reported lookbacks (50/150/200, plus a shorter 20 for intraday timeframes). D2's non-repainting execution convention is honoured: **signals are computed only on completed bars** — the engine discards the live forming candle before any calculation.

### Conflict 5 — FVG definition ambiguity

D3 §3.4 defines a bullish FVG as "3-candle imbalance where middle candle's low > previous candle's high" — this describes bar₂ vs bar₁ and leaves no gap for price to return to. The canonical ICT definition (and the one consistent with D4's "areas where price moves rapidly, creating an imbalance") is the gap between **bar₁ high and bar₃ low**.

**Resolution.** Implement the canonical form: bullish FVG when `low[i] > high[i-2]`, bearish when `high[i] < low[i-2]`. Deviation from D3's literal wording is deliberate and recorded here.

---

## 3. Unified model the engine implements

### 3.1 The 3-Layer Stack (D1 §1.1) — enforced structurally

D1's key rule is *"Combine indicators from DIFFERENT categories. Never stack indicators from the same category."* Naively summing 8 oscillators violates this. The engine enforces it by **normalising within each layer first, then combining layers**, so adding more oscillators cannot inflate momentum's influence:

| Layer | Question | Members |
|-------|----------|---------|
| **L1 Trend / Location** | "Which side may I trade?" | Donchian breakout, EMA 20/50/200 stack, SuperTrend, Ichimoku, PSAR, VWAP, ADX direction |
| **L2 Momentum / Timing** | "Is now the moment?" | MACD, RSI, Stochastic, CCI, Williams %R, ROC, Momentum |
| **L3 Volume / Conviction** | "Is there fuel?" | OBV, MFI, CMF, VWMA divergence, relative volume |
| **L4 Structure / SMC** | "What is price actually doing?" | BOS, CHoCH, swing sequence, FVG, order blocks, liquidity sweeps, S/R proximity, Fibonacci confluence |
| **Risk layer** | "How much can I lose?" | ATR, BB bandwidth, Keltner, realised volatility |

Score for layer *L*: `S_L = Σ(wᵢ · sᵢ) / Σ(wᵢ)` over **contributing** members only, with `sᵢ ∈ [-1, +1]`.
Composite: `S = Σ(W_L · S_L) / Σ(W_L)`, where `W_L` comes from the active regime profile.

### 3.2 Regime detection (D1 §5)

| Regime | Condition (D1) | Layer emphasis |
|--------|----------------|----------------|
| `TRENDING` | ADX > 25, MAs fanned | L1 dominant; RSI/BB demoted to pullback timing |
| `RANGING` | ADX < 20, flat MAs, BB squeezing | L2 oscillators promoted; fade extremes |
| `BREAKOUT` | BB bandwidth < 5% of price, ATR at multi-day low | Donchian + volume dominant |
| `CHOPPY` | ADX < 20 **and** ATR elevated | All weights damped; D1 §5.4 says *avoid or reduce size significantly* → engine caps confidence |
| `NEWS` | High-impact window | Post-spike structure only; sentiment gate |

### 3.3 Instrument-class risk (D1 §6.2)

| Class | ATR stop multiplier | Risk/trade | Min R:R |
|-------|--------------------|-----------|---------|
| Forex majors | 1.0 – 1.5× ATR(14) | 1–2% | 1:2 |
| XAU/USD | 1.5 – 2.0× ATR(14) | 1–2% | 1:2 (D4 prefers 1:3) |
| BTC/USD | 2.0 – 3.0× ATR(14) | 0.5–1% of the 5–10% crypto sleeve | 1:2 |

### 3.4 Multi-timeframe (D1 §1.4, D3 §2.2, D2 §5)

All three sources agree higher-timeframe bias governs. Weighting is `HTF > MTF > LTF`; D2 adds that the weekly direction filter is a *hypothesis*, so it is a **confidence modifier**, not a veto — except in `CHOPPY`, where D1 §5.4 justifies a hard damp.

### 3.5 News sentiment (all sources)

Sentiment maps to `[-1, +1]` and **only scales confidence** within a bounded band. It can never create or flip a directional call. D4's DXY/real-yield macro filter is represented as a documented, optional correlation input.

---

## 4. Determinism guarantees

- Signals computed on **completed bars only** (D2 anti-leakage gate).
- No `Math.random`, no wall-clock in any calculation path; timestamps are display-only.
- Identical `(OHLCV, config)` ⇒ byte-identical result, enforced by the regression fixtures in `tests/`.
- All floating-point comparisons use an explicit epsilon; no NaN propagation (validated).

---

## 5. Explicitly out of scope

On-chain metrics (MVRV, SOPR, ETF flows — D1 §2.2), DXY/real-yield series (D1 §3.2, D4), yield spreads (D1 §4.2), order-flow/footprint and Volume Profile HVN/LVN (D3 §4.2), and funding-rate arbitrage (D3 §4.3) require data feeds outside TwelveData / ExchangeRate-API / NewsAPI. The engine exposes typed extension points for these rather than fabricating values — fabricating them would violate the no-mocked-calculations requirement.

*Volume Profile is approximated where volume is available as a **binned traded-volume histogram (POC/VAH/VAL)** computed from OHLCV, which is a legitimate derivation; true order-flow delta is not derivable from OHLCV and is therefore omitted, not faked.*

---

*Compiled from D1–D4 as the engine's functional specification. Educational analysis only — not financial advice.*
# Session Handover
### Read this before starting any future development session.

---

## Executive summary

A deterministic quantitative trading analysis platform. TradingView provides visualisation only; a zero-dependency JavaScript engine performs all analysis independently and produces a fully explainable recommendation — or a reasoned refusal to trade.

**The analytical engine is complete and verified. The presentation layer (UI) reached Version 1.1 this session and is frozen.** Combined test suite: **1624/1624 assertions passing** in this repo (`FOREX/`).

**Correction versus earlier drafts of this document: the proxy is not missing.** It lives in a **separate sibling project at `C:\trading-proxy`** (its own `server.js`, `src/`, `.env`, tests, `package.json`) — outside this repo. During this session a `node server.js` process (started via `npm start`) was observed already running. It was **not started or stopped by this session** and its code was **not modified**. The one thing it still needs is **authentication** — that is the actual next blocker, not "build the proxy."

This repo (`FOREX/`) was **git-initialised and committed for the first time this session**. `C:\trading-proxy` is a separate, not-yet-git project and was not touched.

The platform is honest about its limits by construction: it excludes evidence it cannot measure, refuses to trade on thin evidence, surfaces internal inconsistencies rather than hiding them, and never claims profitability. **No component has been validated by statistically significant backtesting** — every weight is a calibration assumption, not an optimised value.

---

## Architecture status — ✅ stable, do not restructure

```
Browser (dashboard.html)        presentation only, zero analysis
  └─ qt-app.js                  orchestration, no maths
       ↓ HTTP
  Node Gateway (C:\trading-proxy, separate project) :3001
       sole holder of API keys, 11 providers, currently running
       ↓ normalised OHLCV + observed capabilities
  ENGINE (18 modules, QT.* namespace, no build step, in this repo)
   indicators → patterns → trend → risk → scoring → recommendation
                     ↑ qt-levels (S/R + Fibonacci)
       ↓
  qt-card.js                    renders the recommendation object
       ↕
  dashboard.html shell          Charts / KEEN workspaces (v1.1)
       ↕
  backtest/                     independent; consumes the engine as a user
```

Rules enforced by test: presentation never calculates · each phase consumes the prior phase and recalculates nothing · no `Math.random` / `Date.now` in any analysis path · mode/workspace switching never re-renders or re-analyses.

---

## What happened this session (UI v1.1 arc)

Starting from a working engine + a single-page dashboard, the presentation layer went through several deliberate phases, each verified before moving to the next:

1. **Complete Workstation redesign** — replaced the old 5-level card stack with the `.qtw-*` component library (hero, gauges, trade ticket, structure timeline, score/confidence bars, evidence, gates, MTF panel, warnings, technical/inspection accordions).
2. **Trader Mode / Analyst Mode** — one DOM, one render, pure CSS-visibility toggle between a decision-focused view and the full engine output.
3. **UX audit fixes** — condensed the qualification-gate list in Trader Mode; fixed a real CSS-grid gap (`grid-auto-flow: dense`); fixed a real WCAG contrast failure (new `--qtw-text-faint/-muted` tokens, scoped to the workstation only).
4. **Two-workspace layout** — split into **Charts** (chart-dominant trading terminal) and **KEEN** (the analysis workstation), viewport-pinned with internal scrolling, switchable with no reload and no re-analysis.
5. **Session persistence** — workspace, analysis mode, symbol, interval, profile, chart style all restored on reload.
6. **Hero executive summary** — added a trend line (direction · duration in candles via `rec.trend.barsInState` · timeframe) and a trade ladder (Current/Entry/Stop/TP1-3) to the hero card, reading only fields that actually exist (the engine exposes **one** stop, not an SL1/2/3 ladder — never fabricated).
7. **Final header/control refinement** — Calculator (icon-only, links to `protrade_calc.html`) and Save-Profile (icon-only, ON/OFF localStorage toggle) buttons added; the two-button workspace switch became a single icon-toggle button; the mobile hamburger menu was **removed completely**; the Trader/Analyst toggle and Analyze button were combined into one fixed group at the end of the controls bar; the workspace toggle + Calculator + Save-Profile were combined into one fixed group at the end of the header; the connection indicator became a dot-only chip; the clock now shows `h:mm AM/PM` (no seconds).

Every phase was verified with real-browser measurement (Chrome DevTools Protocol driving the actual `dashboard.html`, not a mock) proving **zero horizontal overflow and zero page-level vertical scroll** at 390/768/1024/1366/1600/1920px, in both workspaces and both modes.

**Documentation produced this session:** `UI_VERSION.md`, `UI_ARCHITECTURE.md`, `UI_COMPONENTS.md`, `UI_TEST_RESULTS.md`, `UI_KNOWN_LIMITATIONS.md`, `ARCHITECTURE_DECISIONS.md` (13 ADRs), `PROJECT_STATUS.md` (master checklist — **read this next**, it is the most current single source of truth).

---

## Status by area

| Area | Status | Evidence |
|---|---|---|
| Indicators (25+) | ✅ **Verified** | 30/30 vs oracle on 600 real bars |
| Pattern recognition (20 detectors) | ✅ **Verified** | 141 assertions, positive/negative/edge |
| Trend & regime engine | ✅ **Verified** | 148 assertions |
| Risk / trade construction | ✅ **Verified** | 149 assertions |
| Scoring + 5 profiles | ✅ **Verified** | 241 assertions |
| Recommendation + MTF | ✅ **Verified** | 210 assertions |
| Presentation layer (UI v1.1) | ✅ **Verified** | 428 assertions + real-browser DevTools-Protocol measurement |
| Backtesting framework | ✅ **Verified** | 98 assertions incl. adversarial leakage test |
| Provider gateway (11 providers) | 🟢 **Implemented** (separate project) | per `C:\trading-proxy`'s own prior verification; not re-run this session |
| Proxy server | 🟢 **Exists, observed running** | `C:\trading-proxy\server.js`; not modified or restarted this session |
| Portability | ✅ **Verified** | this repo: no absolute paths, no secrets, no build step |
| IIS `web.config` | 🟡 **Implemented, unverified** | XML valid; never deployed to real IIS |
| Authentication | ❌ **Not started** | **blocks public deployment of the proxy** |
| Strategy Validation Dashboard | ❌ **Not started** | backtester output has no UI |

---

## Current blockers

| # | Blocker | Impact | Effort |
|---|---|---|---|
| **1** | **Proxy has no authentication** (`C:\trading-proxy`) | Anyone reaching the tunnel hostname can spend your API quota | ~1 h |
| 2 | Provider failover untested | Gateway's core value unproven | ~1–2 h |
| 3 | No statistically significant backtest | All weights remain unvalidated | ~2–3 h + data |

---

## Known limitations

- **Volume is crypto-only.** TwelveData supplies none for forex/metals; excluded transparently with weight renormalisation.
- **Confidence ≠ probability of success.** It measures fit to the configured strategy. Stated in every recommendation.
- **No profitability claim.** Vendor win rates are used only as weighting priors and are never displayed.
- Sentiment lexicon is English-only, hand-built, capped at 0.25 influence.
- MTF consensus uses the LTF trend for its own slot rather than recomputing it.
- Softmax temperatures and outcome-probability coefficients are frank guesses awaiting calibration.
- **UI:** no sparklines (no time-series in the recommendation object); the hero shows one stop, not SL1/2/3 (the engine exposes only one); see `UI_KNOWN_LIMITATIONS.md` for the full list.

---

## Readiness

| | Status |
|---|---|
| **Deployment** | 🟡 LAN/localhost safe. **Public exposure blocked** by missing proxy auth. |
| **Testing** | ✅ `FOREX/` → `npm test` (1624/1624). `C:\trading-proxy` → `npm test` (21/21 per its own prior verification; not re-run this session). |
| **Provider gateway** | 🟢 Implemented; failover not adversarially tested. |
| **Security** | 🟡 CORS allow-list, no secrets in this repo. `C:\trading-proxy\.env` holds real keys — never read/copied/committed from `FOREX/`. **No authentication yet.** |
| **Portability** | ✅ Verified — this repo has no absolute paths, no build step, `npm ci` reproducible. |

---

## Next session roadmap

1. **Proxy authentication** — shared secret / API key on `/api/*` in `C:\trading-proxy`. *Unblocks public deployment.*
2. **Provider failover test suite** — kill providers adversarially; assert fallthrough → degradation → cooldown → recovery.
3. **IIS deployment verification** — needs URL Rewrite + ARR installed.
4. **Strategy Validation Dashboard** — renders existing backtester output; no new analysis.
5. **Walk-forward statistical validation** — multi-symbol, multi-year; converts assumptions into calibrated parameters.
6. **Repository follow-up** — `FOREX/` is now git-initialised with one commit; still needed: `CHANGELOG.md`, a remote (GitHub), and a decision on whether `C:\trading-proxy` becomes its own repo, a submodule, or stays separate.

---

## Files created or modified this session (UI v1.1 arc)

**Engine (modified, presentation-adjacent only):** `engine/qt-card.js` (hero executive summary, mode scoping, gate condensation), `engine/qt-app.js` (render-context passthrough for current price — documented as the one non-contract extension).
**No other engine file was touched.** (Verified: every other `engine/qt-*.js` file's mtime predates this session.)
**Presentation:** `dashboard.html` — extensively restructured (two-workspace shell, dual modes, header/control regrouping, mobile-menu removal, hero ladder, persistence).
**Tests:** `tests/phase8-presentation.test.js` — grew from the original Phase 8 suite to Phase 8.5 through 8.9 (428 assertions total).
**Docs (new, this session):** `UI_VERSION.md`, `UI_ARCHITECTURE.md`, `UI_COMPONENTS.md`, `UI_TEST_RESULTS.md`, `UI_KNOWN_LIMITATIONS.md`, `ARCHITECTURE_DECISIONS.md`, `PROJECT_STATUS.md`.
**Repository:** `.gitignore` added; `git init` + first commit performed in `FOREX/`.

*(For the engine/proxy files created in the session before this one — `qt-detection.js` through `qt-recommendation.js`, the original proxy build, etc. — see the file list embedded in git history / earlier documentation; none of those files were touched this session.)*

---

## Architectural decisions — do not change without strong justification

See **`ARCHITECTURE_DECISIONS.md`** for the full ADR set (13 decisions with problem/alternatives/trade-offs). Highlights:

1. **Capability-aware analysis.** Unavailable evidence is excluded and weights renormalise. Never fabricate, never zero-fill.
2. **Deterministic replay state machine.** State is recomputed from bar history each run, never persisted.
3. **MTF consensus is a decision layer, not a score.** Never summed into the composite.
4. **Three-tier qualification.** Hard gates / configurable gates / informational metrics.
5. **Directional vs quality categories are separate.**
6. **Backtester lives outside `engine/`** and consumes the engine exactly as a user does.
7. **Timestamps are injected**, never read from the clock inside analysis.
8. **Presentation never calculates.** If a display needs a value, add it to the engine — or, if it's truly just a display convenience already implied by existing data (like the current-price passthrough), document it explicitly as the one deliberate exception.
9. **Weights are calibration assumptions.** Do not hand-tune.
10. **Trader Mode / Analyst Mode is a CSS-visibility split of one render**, never two render paths.
11. **The two-workspace shell is viewport-pinned**; scrolling is always internal, never on `<body>`.

**Do not modify:** engine load order in `dashboard.html` · `tests/fixtures/*.json` (regression anchors) · the determinism guarantees · the single-stop trade contract (do not invent an SL1/2/3 ladder in the UI).

---

## Resume checklist

```bash
cd FOREX && npm test                      # expect 1624/1624
cd C:\trading-proxy && npm test           # expect 21/21 (per its own prior verification)
cd C:\trading-proxy && npm start          # if not already running
```

Then read, in this order:
1. **`PROJECT_STATUS.md`** — the master checklist, most current single source of truth.
2. **`UI_KNOWN_LIMITATIONS.md`** — what the UI honestly cannot do and why.
3. **`ARCHITECTURE_DECISIONS.md`** — why things are built the way they are.
4. `PROJECT-ROADMAP.md` for the original, longer-form roadmap (some of it now superseded by `PROJECT_STATUS.md`).

*Educational analysis only. Not financial advice.*
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
  .app  [data-workspace="charts|KEEN"]  (100dvh flex column)
    .app-header  (flex:0 0 auto)
      .header       — hamburger · brand · connection chip + clock · workspace switch (last)
      .controls     — symbol · interval · style · reload · profile · Trader/Analyst · Analyze
    .app-body  (flex:1, min-height:0, position:relative)
      #wsPanelCharts   (absolute inset:0; shown when data-workspace=charts)
        .ticker-bar + .chart-panel (the dominant chart)
      #wsPanelKEEN     (absolute inset:0; shown when data-workspace=KEEN)
        .analysis-scroll → .analysis-area → #analysisCard  (qt-card renders here)
```

### Viewport model
- `body { overflow: hidden }` and `.app { height: 100dvh }` pin the app to the
  viewport. Scrolling happens **inside** regions, never on the page.
- Internal scroll regions: `.analysis-scroll` (KEEN), and the mobile
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
| Empty state | `.qtw-empty` | Welcoming KEEN placeholder before first analysis. |

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
# UI Known Limitations — Presentation Layer v1.1

Honest limitations. None of these are defects in the analytical engine; they are
constraints or deliberate scope choices in the presentation layer.

## Data availability (never fabricated)
- **Single stop, not a ladder.** The engine's recommendation object exposes one
  tiered stop (`rec.trade.stop`, e.g. id `SL2`). The hero requested "SL1/SL2/SL3";
  because only one stop exists, exactly **one** Stop Loss is rendered. No SL1/2/3
  ladder is fabricated.
- **No live price series in the object.** The recommendation object carries no
  time-series of prices, so there are **no sparklines**. "Current price" is the
  last close, passed as an optional display-only render argument.
- **Live prices come from TradingView, not the engine.** The ticker tape and
  chart show live quotes via TradingView embeds (visualisation only). The engine
  analyses bar history through the proxy; it is not a live-quote source.

## External dependencies / environment
- **TradingView requires network.** The chart and ticker tape load from
  TradingView's CDN. Offline or CDN-blocked, they show their own loading/empty
  state; the chart panel still occupies its space and the rest of the app works.
  This is the only external runtime dependency in the browser.
- **Proxy required for real analysis.** `Analyze` calls the proxy
  (`/api/v1/bundle`). The proxy **server** is not part of this repository
  snapshot (it is referenced by `qt-app.js` and reviewed in `PROXY-REVIEW.md`).
  Without a running proxy, `Analyze` surfaces a clear "Unreachable" error state.

## Layout / responsive
- **Very small screens** (≈≤380px, or short landscape phones) make the header
  wrap to multiple rows, reducing the height available to the chart/analysis.
  This is spec-permitted ("unavoidable on extremely small devices"); the page
  still never scrolls — content scrolls internally.
- **Headless measurement floor.** Some headless-Chromium builds enforce a ~500px
  minimum window width for `--window-size`; true sub-500px verification was done
  via the DevTools Protocol viewport override, which has no such floor.

## Deliberate scope choices (not bugs)
- **Provider status is connection state, not a health dashboard.** The header
  connection chip reflects the real observed outcome of the last `Analyze`
  (idle/connecting/connected/unreachable). A richer provider-health panel needs a
  proxy health endpoint that does not exist yet — deferred to the proxy milestone
  rather than faked.
- **No global keyboard shortcuts** for workspace/symbol switching. The tablist
  and all controls are fully keyboard-accessible; global hotkeys were left out to
  avoid conflicts and were not needed for the core workflow.
- **Snapshot is self-contained, not a live quote widget.** The earlier
  single-quote TradingView widget flashed a large white loading box and
  duplicated the ticker tape, so the sidebar (and that widget) were removed to
  make the chart dominant.

## Testing gaps (acknowledged)
- The live TradingView widgets and a real proxy round-trip are not exercised by
  the automated suite (they need network / a running server). Everything the
  presentation layer itself controls is covered; see
  [UI_TEST_RESULTS.md](UI_TEST_RESULTS.md).
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
- **KEEN workspace** — the full AI decision workstation rendered by
  `qt-card.js`, scrolling inside its own region.
- Switching between workspaces is a pure CSS attribute flip (`data-workspace`);
  no reload, no re-analysis, both panels stay mounted.

### 1.1 refinements (in order of delivery)
1. **Dual interface modes** — Trader (decision-focused) and Analyst (everything
   exposed). Same recommendation object, same DOM, CSS-visibility only.
2. **UX audit** — condensed qualification-gate summary in Trader Mode; dense grid
   packing to remove stranded gaps.
3. **Two-workspace layout** — Charts / KEEN; viewport-pinned; internal scroll.
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
# Indicator Validation Report

**Fixture:** 600 real BTC/USD daily bars, 2021-01-01 → 2022-08-23 (Yahoo Finance snapshot, stored immutably at `tests/fixtures/btcusd-1d.json`, close-sum checksum `25186829.56`).
**Oracle:** [`technicalindicators`](https://www.npmjs.com/package/technicalindicators) npm package.
**Oracle is a test dependency only** — it is never loaded by the dashboard and is not present in `engine/`. The shipped engine implements every formula from its authoritative definition, as required.

## Result: 30 / 30 series matched, 0 mismatched

| Indicator | Max relative error | Verdict |
|-----------|-------------------|---------|
| SMA(20), SMA(200) | 3.8e-15 / 0 | exact to float precision |
| EMA(20), EMA(50), EMA(200) | ≤ 5.8e-15 | exact |
| WMA(20) | 4.2e-16 | exact |
| RSI(14), RSI(9) | 0 | exact (see note 1) |
| MACD line / signal / histogram | ≤ 2.2e-11 | exact |
| CCI(20) | 5.9e-13 | exact |
| ROC(10) | 0 | exact |
| Williams %R(14) | 0 | exact |
| Stochastic fast %K / %D | 0 / 3.0e-14 | exact (see note 2) |
| ATR(14) | 7.2e-16 | exact |
| ADX(14), +DI, −DI | ≤ 7.6e-16 | exact |
| Bollinger upper / middle / lower | ≤ 5.1e-15 | exact |
| OBV | 0 | exact |
| MFI(14) | 0 | exact (see note 1) |
| Parabolic SAR | 598/599 bars identical | see note 3 |
| Ichimoku conversion / base / spanA / spanB | 0 | exact |

### Note 1 — apparent RSI/MFI drift was oracle rounding
An initial run showed a maximum absolute difference of `4.98e-3` on RSI and `4.99e-3` on MFI. Investigation showed the oracle rounds its output to 2 decimal places (`32.91`, `35.72`, …) while the engine returns full precision (`32.91054786`, `35.71658426`, …). Rounding the engine's output to 2 dp reproduces the oracle **exactly, to the last digit**. The engine is the more precise of the two; no correction was needed.

### Note 2 — Stochastic: fast vs slow is a definitional difference, not an error
The oracle computes the **fast** stochastic (`%K` raw, `%D` = SMA(%K, 3)). The engine computes the **slow** stochastic `(14, 3, 3)` — the setting D3 §3.2 actually specifies — where `%K` is itself smoothed by 3 before `%D` is taken. Verified by direct comparison:
- engine `rawK` ≡ oracle `k` (exact)
- SMA(engine `rawK`, 3) ≡ oracle `d` (exact, 3.0e-14)
- engine `k` (slow) ≡ oracle `d`, as the definition requires

The smoothing chain is therefore provably correct, and the engine implements the variant the research specifies.

### Note 3 — Parabolic SAR: one documented convention deviation
Across 599 comparable bars, the engine matches the oracle on **598**. The single divergence is at index 249, a trend-reversal bar:

| | value |
|---|---|
| bar 249 high / low | 52 853.77 / 43 285.21 |
| engine SAR | 52 700.94 |
| oracle SAR | 52 853.77 |

Both are defensible readings of Wilder. The question is whether the **reversal bar's own high** updates the extreme point (EP) before the flip is applied. The engine follows Wilder's literal sequence and TA-Lib's ordering: the reversal bar begins the *new* trade, so the new SAR is the EP reached during the *previous* trade — i.e. the high through bar 248 (52 700.94). The oracle folds bar 249's high into the prior uptrend first.

The divergence is provably confined to reversal bars: the validation asserts `count(differences) === count(differences occurring on a direction change)`, which passes. This is an **unavoidable deviation** in the sense the brief requires — PSAR has no single normative implementation — and it is recorded here rather than silently absorbed.

## Coverage not provided by the oracle

`VWMA`, `CMF`, `VWAP`, `SuperTrend`, `Donchian`, `Keltner`, `Volume Profile`, `Pivot Points`, `Momentum` and `Realised Volatility` have no directly comparable oracle output. Each is instead covered by **closed-form analytic tests** where the correct answer is provable — for example:

- CMF is exactly `+1` when every close prints at the bar high and `−1` at the low.
- VWMA collapses to SMA under uniform volume, and is pulled to `(10·1 + 20·99)/100` under a 1:99 volume split.
- Bollinger is confirmed to use the **population** standard deviation via the series `[2,4,4,4,5,5,7,9]`, whose population σ is exactly 2.
- Pivot points are checked against the closed-form floor-trader identities (`P=(H+L+C)/3`, `R1=2P−L`, …).
- Donchian is asserted to exclude the current bar, so a bar can break the channel it is being measured against — the non-repainting requirement from D2 §3.1.

## Regression locking

`tests/fixtures/golden-indicators.json` stores the last three finite values of 43 series computed from the fixture. `tests/phase2-indicators.test.js` re-derives them on every run, so any future edit that changes a calculation fails immediately and visibly. The fixture's own integrity is checked by bar count and a close-sum checksum, guarding against silent data drift.

## Determinism

Asserted directly: the module contains no `Math.random`, no `Date.now`, and no `new Date()`; two consecutive `computeAll` runs over the fixture produce byte-identical output.

**Totals:** 30/30 oracle series matched · 143/143 Phase 2 assertions passed · 59/59 Phase 1 assertions passed.
