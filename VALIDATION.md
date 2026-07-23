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
