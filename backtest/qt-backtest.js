/**
 * qt-backtest.js — Independent walk-forward backtesting subsystem.
 *
 * ARCHITECTURAL SEPARATION (deliberate):
 * This module lives OUTSIDE engine/ and imports the engine exactly as a live
 * user would. It never modifies, monkey-patches or reaches into engine
 * internals — it calls the same public pipeline the dashboard calls. If the
 * backtester needs something the engine does not expose, the fix belongs in the
 * engine, not here.
 *
 * ── NO FUTURE-DATA LEAKAGE ───────────────────────────────────────────────────
 * The single most important property. At simulated bar `i` the engine is handed
 * `bars.slice(0, i + 1)` — a hard slice, not a windowed view — so it is
 * physically incapable of seeing bar i+1. Trade management then advances one bar
 * at a time using only bar i+1's OHLC to resolve fills. Every fill assumption is
 * stated explicitly in `resolveBar()` and is deliberately pessimistic where
 * ambiguous (see the intrabar ordering note).
 *
 * ── DETERMINISM ──────────────────────────────────────────────────────────────
 * No clock reads, no randomness in the replay path. Monte-Carlo resampling uses
 * an explicit seeded PRNG so a given seed always reproduces the same run.
 */
(function (root) {
    'use strict';

    var QT = root.QT;
    if (!QT) throw new Error('qt-backtest requires the engine to be loaded first');

    var U = QT.utils;
    var BT = {};

    /* ================================================================
     * Seeded PRNG (mulberry32) — used ONLY for Monte-Carlo resampling
     * ================================================================ */
    function prng(seed) {
        var a = seed >>> 0;
        return function () {
            a |= 0; a = (a + 0x6D2B79F5) | 0;
            var t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }
    BT.prng = prng;

    /* ================================================================
     * Trade lifecycle during replay
     * ================================================================ */
    function openTrade(rec, entryBarIndex, entryPrice, bar) {
        var t = rec.trade;
        return {
            direction: rec.recommendation.direction,
            recommendation: rec.recommendation.code,
            confidence: rec.confidence,
            profile: rec.profile.id,
            regime: rec.regime.primary,
            trendState: rec.trend.state,

            entryBarIndex: entryBarIndex,
            entryTime: bar.time,
            entryPrice: entryPrice,
            stopPrice: t.stop.price,
            initialStop: t.stop.price,
            targets: t.targets.map(function (x) {
                return { id: x.id, price: x.price, rr: x.rr, closePct: x.closePct, hit: false, hitBar: null };
            }),
            riskPerUnit: Math.abs(entryPrice - t.stop.price),

            // Excursion tracking, in R multiples.
            maxFavourableR: 0,
            maxAdverseR: 0,
            remainingFraction: 1,
            realisedR: 0,

            exitBarIndex: null,
            exitTime: null,
            exitPrice: null,
            exitReason: null,
            barsHeld: 0
        };
    }

    /**
     * Advances an open trade by exactly one bar.
     *
     * INTRABAR ORDERING ASSUMPTION (documented, deliberately pessimistic):
     * OHLC gives no information about whether the high or the low came first
     * within a bar. When a single bar touches both a target and the stop, this
     * simulator assumes the STOP was hit first. That understates results but
     * never overstates them, which is the correct bias for validation.
     */
    function resolveBar(trade, bar, barIndex, cfg) {
        var isLong = trade.direction === 'bullish';
        var risk = trade.riskPerUnit;
        if (!(risk > 0)) return { closed: true, reason: 'invalid_risk' };

        trade.barsHeld++;

        // Excursions from the extremes actually printed this bar.
        var favourable = isLong ? (bar.high - trade.entryPrice) : (trade.entryPrice - bar.low);
        var adverse = isLong ? (trade.entryPrice - bar.low) : (bar.high - trade.entryPrice);
        trade.maxFavourableR = Math.max(trade.maxFavourableR, favourable / risk);
        trade.maxAdverseR = Math.max(trade.maxAdverseR, adverse / risk);

        var stopHit = isLong ? bar.low <= trade.stopPrice : bar.high >= trade.stopPrice;

        // Pessimistic ordering: resolve the stop before any target on the same bar.
        if (stopHit) {
            var stopR = ((isLong ? trade.stopPrice - trade.entryPrice
                                 : trade.entryPrice - trade.stopPrice) / risk);
            trade.realisedR += stopR * trade.remainingFraction;
            trade.remainingFraction = 0;
            trade.exitBarIndex = barIndex;
            trade.exitTime = bar.time;
            trade.exitPrice = trade.stopPrice;
            trade.exitReason = trade.stopPrice === trade.initialStop ? 'stop_loss' : 'trailing_stop';
            return { closed: true, reason: trade.exitReason };
        }

        // Targets, nearest first.
        for (var i = 0; i < trade.targets.length; i++) {
            var tp = trade.targets[i];
            if (tp.hit) continue;
            var reached = isLong ? bar.high >= tp.price : bar.low <= tp.price;
            if (!reached) continue;

            tp.hit = true;
            tp.hitBar = barIndex;
            var fraction = Math.min(trade.remainingFraction, tp.closePct / 100);
            trade.realisedR += tp.rr * fraction;
            trade.remainingFraction -= fraction;

            // Move the stop to breakeven once the first target pays.
            if (cfg.backtest.breakevenAfterTP1 && i === 0) {
                trade.stopPrice = trade.entryPrice;
            }
            if (trade.remainingFraction <= 1e-9) {
                trade.exitBarIndex = barIndex;
                trade.exitTime = bar.time;
                trade.exitPrice = tp.price;
                trade.exitReason = 'all_targets';
                return { closed: true, reason: 'all_targets' };
            }
        }

        // Time stop.
        if (trade.barsHeld >= cfg.backtest.maxBarsInTrade) {
            var markR = ((isLong ? bar.close - trade.entryPrice
                                 : trade.entryPrice - bar.close) / risk);
            trade.realisedR += markR * trade.remainingFraction;
            trade.remainingFraction = 0;
            trade.exitBarIndex = barIndex;
            trade.exitTime = bar.time;
            trade.exitPrice = bar.close;
            trade.exitReason = 'time_stop';
            return { closed: true, reason: 'time_stop' };
        }
        return { closed: false };
    }

    /* ================================================================
     * Core replay
     * ================================================================ */

    /**
     * @param {Object} opts
     * @param {Array}  opts.bars        full history, ascending
     * @param {string} [opts.profile]   strategy profile id
     * @param {string} [opts.assetClass]
     * @param {number} [opts.warmup]    bars reserved before the first decision
     * @param {number} [opts.stride]    evaluate every Nth bar (cost control)
     * @param {number} [opts.from]      start index (for walk-forward slicing)
     * @param {number} [opts.to]        end index, exclusive
     * @param {Object} [opts.config]    pre-resolved config (overrides profile)
     */
    BT.run = function (opts) {
        var cfg = opts.config || QT.profiles.applyProfile(opts.profile || 'balanced');
        var bars = opts.bars;
        var warmup = opts.warmup || cfg.backtest.warmupBars;
        var stride = opts.stride || cfg.backtest.stride;
        var from = Math.max(warmup, opts.from === undefined ? warmup : opts.from);
        var to = Math.min(bars.length, opts.to === undefined ? bars.length : opts.to);
        var assetClass = opts.assetClass || 'crypto';

        var trades = [];
        var open = null;
        var equityR = 0;
        var equityCurve = [];
        var signals = 0, evaluations = 0, refusals = 0;
        var regimeCounts = {};
        var blockedByMtf = 0;

        for (var i = from; i < to; i++) {
            /* --- 1. Manage an open trade using ONLY this bar --- */
            if (open) {
                var res = resolveBar(open, bars[i], i, cfg);
                if (res.closed) {
                    equityR += open.realisedR;
                    trades.push(open);
                    equityCurve.push({ barIndex: i, time: bars[i].time, equityR: equityR,
                                       tradeIndex: trades.length - 1 });
                    open = null;
                }
            }

            /* --- 2. Decide, using ONLY bars up to and including i --- */
            if (open || (i - from) % stride !== 0) continue;
            evaluations++;

            var visible = bars.slice(0, i + 1);        // hard slice: no future data can leak
            var rec;
            try {
                rec = BT.analyze(visible, cfg, assetClass);
            } catch (e) {
                continue;                               // a failed evaluation is simply no signal
            }

            regimeCounts[rec.regime.primary] = (regimeCounts[rec.regime.primary] || 0) + 1;
            if (rec.mtf && rec.mtf.action === 'block') blockedByMtf++;

            if (!rec.trade || !rec.trade.entry || rec.recommendation.direction === 'none') {
                refusals++;
                continue;
            }
            signals++;

            /* --- 3. Enter on the NEXT bar's open (no same-bar fill) --- */
            if (i + 1 >= to) break;
            var entryBar = bars[i + 1];
            open = openTrade(rec, i + 1, entryBar.open, entryBar);
        }

        // Mark any still-open trade to the final close.
        if (open) {
            var last = bars[to - 1];
            var isLong = open.direction === 'bullish';
            var markR = ((isLong ? last.close - open.entryPrice
                                 : open.entryPrice - last.close) / open.riskPerUnit);
            open.realisedR += markR * open.remainingFraction;
            open.remainingFraction = 0;
            open.exitBarIndex = to - 1;
            open.exitTime = last.time;
            open.exitPrice = last.close;
            open.exitReason = 'end_of_data';
            equityR += open.realisedR;
            trades.push(open);
            equityCurve.push({ barIndex: to - 1, time: last.time, equityR: equityR,
                               tradeIndex: trades.length - 1 });
        }

        return {
            profile: cfg.activeProfile ? cfg.activeProfile.id : 'default',
            range: { from: from, to: to, bars: to - from,
                     startTime: bars[from] ? bars[from].time : null,
                     endTime: bars[to - 1] ? bars[to - 1].time : null },
            trades: trades,
            equityCurve: equityCurve,
            counters: { evaluations: evaluations, signals: signals, refusals: refusals,
                        blockedByMtf: blockedByMtf, regimeCounts: regimeCounts },
            metrics: BT.metrics(trades, equityCurve, cfg)
        };
    };

    /** Runs the public engine pipeline exactly as the dashboard does. */
    BT.analyze = function (visibleBars, cfg, assetClass) {
        var ind = QT.indicators.computeAll(visibleBars, cfg);
        var pat = QT.patterns.analyze(visibleBars, ind, { config: cfg });
        var trend = QT.trend.analyzeTimeframe(ind, pat, { config: cfg });
        var atr = U.lastFinite(ind.atr);
        var ctx = QT.detection.buildContext(visibleBars, ind, cfg);
        var levels = QT.levels.analyze(visibleBars, ctx.swings.minor, atr, cfg);
        var proposal = QT.risk.buildProposal({
            bars: visibleBars, indicators: ind, patternReport: pat, trend: trend,
            levels: levels, swings: ctx.swings.minor, assetClass: assetClass, config: cfg });
        var scored = QT.scoring.score({
            bars: visibleBars, indicators: ind, patternReport: pat, trend: trend,
            levels: levels, proposal: proposal, sentiment: null, config: cfg });
        return QT.recommendation.build({
            scored: scored, trend: trend, patternReport: pat, proposal: proposal,
            levels: levels, consensus: null,
            series: { bars: visibleBars }, config: cfg });
    };

    /* ================================================================
     * Performance metrics
     * ================================================================ */
    BT.metrics = function (trades, equityCurve, cfg) {
        var n = trades.length;
        if (!n) {
            return { trades: 0, note: 'no trades were generated in this window' };
        }

        var rs = trades.map(function (t) { return t.realisedR; });
        var wins = rs.filter(function (r) { return r > 0; });
        var losses = rs.filter(function (r) { return r <= 0; });

        var grossWin = wins.reduce(function (a, b) { return a + b; }, 0);
        var grossLoss = Math.abs(losses.reduce(function (a, b) { return a + b; }, 0));
        var totalR = grossWin - grossLoss;

        var winRate = wins.length / n;
        var avgWin = wins.length ? grossWin / wins.length : 0;
        var avgLoss = losses.length ? grossLoss / losses.length : 0;
        var expectancy = winRate * avgWin - (1 - winRate) * avgLoss;

        // Sharpe / Sortino computed on per-trade R, annualisation left to the caller.
        var mean = U.mean(rs);
        var sd = U.stdDevPopulation(rs);
        var downside = rs.filter(function (r) { return r < 0; });
        var downsideSd = downside.length ? U.stdDevPopulation(downside) : 0;

        // Max drawdown on the R-equity curve.
        var peak = 0, maxDD = 0, ddStart = null, maxDDBars = 0, curDDBars = 0;
        equityCurve.forEach(function (p) {
            if (p.equityR > peak) { peak = p.equityR; curDDBars = 0; ddStart = null; }
            else {
                var dd = peak - p.equityR;
                curDDBars++;
                if (dd > maxDD) { maxDD = dd; maxDDBars = curDDBars; }
            }
        });

        var tpHits = { TP1: 0, TP2: 0, TP3: 0 };
        trades.forEach(function (t) {
            t.targets.forEach(function (tp) { if (tp.hit && tpHits[tp.id] !== undefined) tpHits[tp.id]++; });
        });

        var exitReasons = {};
        trades.forEach(function (t) { exitReasons[t.exitReason] = (exitReasons[t.exitReason] || 0) + 1; });

        var durations = trades.map(function (t) { return t.barsHeld; });
        var mae = trades.map(function (t) { return t.maxAdverseR; });
        var mfe = trades.map(function (t) { return t.maxFavourableR; });

        return {
            trades: n,
            wins: wins.length,
            losses: losses.length,
            winRate: +winRate.toFixed(4),
            totalR: +totalR.toFixed(4),
            grossWinR: +grossWin.toFixed(4),
            grossLossR: +grossLoss.toFixed(4),
            profitFactor: grossLoss > 0 ? +(grossWin / grossLoss).toFixed(4) : (grossWin > 0 ? Infinity : 0),
            expectancyR: +expectancy.toFixed(4),
            averageWinR: +avgWin.toFixed(4),
            averageLossR: +avgLoss.toFixed(4),
            payoffRatio: avgLoss > 0 ? +(avgWin / avgLoss).toFixed(4) : null,
            sharpe: sd > 0 ? +(mean / sd).toFixed(4) : null,
            sortino: downsideSd > 0 ? +(mean / downsideSd).toFixed(4) : null,
            maxDrawdownR: +maxDD.toFixed(4),
            maxDrawdownBars: maxDDBars,
            targetHitRates: {
                TP1: +(tpHits.TP1 / n).toFixed(4),
                TP2: +(tpHits.TP2 / n).toFixed(4),
                TP3: +(tpHits.TP3 / n).toFixed(4)
            },
            exitReasons: exitReasons,
            duration: {
                averageBars: +U.mean(durations).toFixed(2),
                minBars: Math.min.apply(null, durations),
                maxBars: Math.max.apply(null, durations)
            },
            excursion: {
                averageMaeR: +U.mean(mae).toFixed(4),
                averageMfeR: +U.mean(mfe).toFixed(4),
                worstMaeR: +Math.max.apply(null, mae).toFixed(4),
                bestMfeR: +Math.max.apply(null, mfe).toFixed(4)
            }
        };
    };

    /* ================================================================
     * Walk-forward validation
     *
     * Rolling in-sample / out-of-sample windows. The engine is NOT optimised
     * between windows (per instruction, optimisation is deferred), so this
     * currently measures STABILITY across regimes rather than the benefit of
     * re-fitting. The structure is in place for optimisation to slot in later.
     * ================================================================ */
    BT.walkForward = function (opts) {
        var cfg = opts.config || QT.profiles.applyProfile(opts.profile || 'balanced');
        var bars = opts.bars;
        var wf = cfg.backtest.walkForward;
        var isLen = opts.inSampleBars || wf.inSampleBars;
        var oosLen = opts.outOfSampleBars || wf.outOfSampleBars;
        var step = opts.step || oosLen;
        var warmup = opts.warmup || cfg.backtest.warmupBars;

        var windows = [];
        var start = warmup;
        while (start + isLen + oosLen <= bars.length) {
            var isFrom = start, isTo = start + isLen;
            var oosFrom = isTo, oosTo = isTo + oosLen;

            var inSample = BT.run({ bars: bars, config: cfg, from: isFrom, to: isTo,
                                    warmup: warmup, stride: opts.stride,
                                    assetClass: opts.assetClass });
            var outSample = BT.run({ bars: bars, config: cfg, from: oosFrom, to: oosTo,
                                     warmup: warmup, stride: opts.stride,
                                     assetClass: opts.assetClass });

            windows.push({
                index: windows.length,
                inSample: { range: inSample.range, metrics: inSample.metrics,
                            counters: inSample.counters },
                outOfSample: { range: outSample.range, metrics: outSample.metrics,
                               counters: outSample.counters },
                degradation: degradation(inSample.metrics, outSample.metrics)
            });
            start += step;
        }

        return {
            profile: cfg.activeProfile ? cfg.activeProfile.id : 'default',
            windowCount: windows.length,
            inSampleBars: isLen,
            outOfSampleBars: oosLen,
            windows: windows,
            aggregate: aggregateWalkForward(windows),
            note: 'Parameters are held constant across windows; this measures stability, ' +
                  'not the benefit of re-optimisation.'
        };
    };

    function degradation(is, oos) {
        function delta(k) {
            if (!is || !oos || is[k] === undefined || oos[k] === undefined) return null;
            if (!isFinite(is[k]) || !isFinite(oos[k])) return null;
            return +(oos[k] - is[k]).toFixed(4);
        }
        return { expectancyR: delta('expectancyR'), winRate: delta('winRate'),
                 profitFactor: delta('profitFactor'), sharpe: delta('sharpe') };
    }

    function aggregateWalkForward(windows) {
        var oos = windows.map(function (w) { return w.outOfSample.metrics; })
                         .filter(function (m) { return m && m.trades > 0; });
        if (!oos.length) return { note: 'no out-of-sample trades across any window' };
        function avg(k) {
            var v = oos.map(function (m) { return m[k]; }).filter(isFinite);
            return v.length ? +U.mean(v).toFixed(4) : null;
        }
        return {
            windowsWithTrades: oos.length,
            totalOosTrades: oos.reduce(function (a, m) { return a + m.trades; }, 0),
            averageExpectancyR: avg('expectancyR'),
            averageWinRate: avg('winRate'),
            averageProfitFactor: avg('profitFactor'),
            averageSharpe: avg('sharpe'),
            profitableWindows: oos.filter(function (m) { return m.totalR > 0; }).length
        };
    }

    /* ================================================================
     * Monte-Carlo — resamples the realised trade sequence
     * ================================================================ */
    BT.monteCarlo = function (trades, options) {
        options = options || {};
        var iterations = options.iterations || 1000;
        var rand = prng(options.seed === undefined ? 12345 : options.seed);
        if (!trades.length) return { note: 'no trades to resample' };

        var rs = trades.map(function (t) { return t.realisedR; });
        var finals = [], maxDDs = [];

        for (var it = 0; it < iterations; it++) {
            var equity = 0, peak = 0, dd = 0;
            for (var k = 0; k < rs.length; k++) {
                equity += rs[Math.floor(rand() * rs.length)];
                if (equity > peak) peak = equity;
                if (peak - equity > dd) dd = peak - equity;
            }
            finals.push(equity);
            maxDDs.push(dd);
        }
        finals.sort(function (a, b) { return a - b; });
        maxDDs.sort(function (a, b) { return a - b; });

        function q(arr, p) { return +arr[Math.floor(p * (arr.length - 1))].toFixed(4); }
        return {
            iterations: iterations,
            seed: options.seed === undefined ? 12345 : options.seed,
            finalEquityR: { p05: q(finals, 0.05), median: q(finals, 0.5), p95: q(finals, 0.95) },
            maxDrawdownR: { median: q(maxDDs, 0.5), p95: q(maxDDs, 0.95) },
            probabilityOfLoss: +(finals.filter(function (v) { return v < 0; }).length / iterations).toFixed(4)
        };
    };

    root.QTBacktest = BT;
    if (typeof module !== 'undefined' && module.exports) module.exports = BT;

})(typeof globalThis !== 'undefined' ? globalThis : this);
