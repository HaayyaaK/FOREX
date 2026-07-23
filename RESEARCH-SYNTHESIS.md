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
