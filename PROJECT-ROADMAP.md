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
