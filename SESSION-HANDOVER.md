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
  dashboard.html shell          Charts / Keen Eye workspaces (v1.1)
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
4. **Two-workspace layout** — split into **Charts** (chart-dominant trading terminal) and **Keen Eye** (the analysis workstation), viewport-pinned with internal scrolling, switchable with no reload and no re-analysis.
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
