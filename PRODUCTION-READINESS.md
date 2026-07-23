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
