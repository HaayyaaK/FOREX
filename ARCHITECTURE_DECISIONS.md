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

## ADR-008 — Charts / Keen Eye two-workspace layout
**Problem.** One long scrolling page mixed chart-watching and decision-reading.
**Alternatives.** (a) Keep one page; (b) separate routes/reloads; (c) two
in-page workspaces toggled by attribute.
**Decision.** Two workspaces (Charts, Keen Eye) stacked in the same area, toggled
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
