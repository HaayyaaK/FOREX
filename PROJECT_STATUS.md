# PROJECT STATUS — Master Checklist

**Primary reference for the whole project.** Status reflects what is verifiable in
this repository snapshot. It is intentionally conservative: nothing is marked
complete unless it is implemented **and** tested here.

**Legend:** ✅ Completed & tested · 🟢 Working · 🟡 Partial · 🔴 Not started · ⚪ Future enhancement

> Snapshot facts: whole test suite **1624/1624 passing** (`node tests/run-all.js`).
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
| Keen Eye workspace | ✅ | full analysis workstation; internal scroll. |
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
| **Total (this repo)** | ✅ | **1624 / 1624 assertions passing** (`node tests/run-all.js`). |

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
- ⚪ Per-card independent scroll regions in Keen Eye (currently one scroll region).

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
