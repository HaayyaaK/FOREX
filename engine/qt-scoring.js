/**
 * qt-scoring.js — Phase 6: Weighted Scoring Engine + Trade Qualification Framework.
 *
 * Consumes the structured outputs of Phases 2–5 and synthesises them. It
 * recalculates NOTHING: no indicator, pattern, trend or level is recomputed here.
 *
 * ── EVIDENCE CATEGORIES, NOT INDICATOR WEIGHTS ───────────────────────────────
 * Weighting individual indicators makes a model that is hard to explain and
 * harder to evolve. This engine scores ten higher-level evidence categories, so
 * a change to a detector never destabilises the scoring model.
 *
 * DIRECTIONAL categories (trend, structure, momentum, pattern, sentiment) carry a
 * signed score in [-1, +1]. QUALITY categories (riskQuality, srQuality,
 * fibConfluence, regimeQuality, tradeConstruction) carry an unsigned score in
 * [0, 1] and modulate confidence only. A quality category can never create a
 * direction — otherwise "good risk/reward" would read as "bullish".
 *
 * ── CAPABILITY-AWARE NORMALISATION ───────────────────────────────────────────
 * A category whose evidence is unavailable is EXCLUDED and its weight
 * redistributed across the survivors. Nothing is zero-filled or assumed. Every
 * exclusion and every renormalisation is reported in the trace.
 */
(function (root) {
    'use strict';

    var QT = root.QT = root.QT || {};
    var U = QT.utils;

    var S = {};

    function clamp01(v) { return U.isFiniteNumber(v) ? U.clamp(v, 0, 1) : 0; }
    function clampSigned(v) { return U.isFiniteNumber(v) ? U.clamp(v, -1, 1) : 0; }

    /** Standard shape returned by every category scorer. */
    function category(id, kind, score, confidence, available, supporting, opposing, reason, metrics) {
        return {
            id: id,
            kind: kind,
            score: kind === 'directional' ? clampSigned(score) : clamp01(score),
            confidence: clamp01(confidence),
            available: !!available,
            unavailableReason: available ? null : (reason || 'evidence unavailable'),
            supporting: supporting || [],
            opposing: opposing || [],
            metrics: metrics || {}
        };
    }

    /* ================================================================
     * Category scorers — each reads ONLY from prior-phase output
     * ================================================================ */
    S.scoreCategories = function (input) {
        var trend = input.trend;
        var patterns = input.patternReport;
        var levels = input.levels;
        var proposal = input.proposal;
        var sentiment = input.sentiment;
        var cfg = input.config;
        var dirSign = trend.direction === 'bullish' ? 1 : trend.direction === 'bearish' ? -1 : 0;

        var cats = {};

        /* ---- 1. Trend evidence (directional) ---- */
        (function () {
            var sup = [], opp = [];
            (trend.explanation.supporting || []).forEach(function (e) {
                sup.push(e.dimension + ' ' + e.direction + ' (signal ' + e.signal + ')');
            });
            (trend.explanation.opposing || []).forEach(function (e) {
                opp.push(e.dimension + ' ' + e.direction + ' (signal ' + e.signal + ')');
            });
            var score = dirSign * trend.strength;
            cats.trend = category('trend', 'directional', score, trend.confidence, true,
                sup, opp, null,
                { direction: trend.direction, strength: trend.strength,
                  state: trend.state, barsInState: trend.barsInState });
        })();

        /* ---- 2. Market-structure evidence (directional) ---- */
        (function () {
            var st = patterns.structure;
            var structural = trend.dimensions.structural;
            var sSign = st.bias === 'bullish' ? 1 : st.bias === 'bearish' ? -1 : 0;
            var breaks = (patterns.active || []).filter(function (d) {
                return /bos|choch/.test(d.id);
            });
            var sup = [], opp = [];
            if (st.bias !== 'neutral') {
                sup.push('swing structure is ' + st.bias + ' (' +
                         (st.labelledSwings || []).map(function (x) { return x.label; })
                            .filter(Boolean).slice(-4).join(' → ') + ')');
            }
            breaks.forEach(function (b) {
                var line = b.name + ' ' + b.barsAgo + ' bars ago';
                if (b.bias === trend.direction) sup.push(line); else opp.push(line);
            });
            var available = (patterns.structure.swingCounts.minor || 0) >= 3;
            cats.structure = category('structure', 'directional',
                sSign * structural.strength, structural.confidence, available,
                sup, opp, available ? null : 'fewer than 3 swings — structure undefined',
                { bias: st.bias, swingCounts: st.swingCounts, breakCount: breaks.length });
        })();

        /* ---- 3. Momentum evidence (directional) ---- */
        (function () {
            var m = trend.dimensions.momentum;
            var a = trend.dimensions.acceleration;
            var sign = m.direction === 'bullish' ? 1 : m.direction === 'bearish' ? -1 : 0;
            var sup = m.evidence.slice(), opp = [];
            if (a.metrics.phase === 'decelerating') opp.push('momentum is decelerating');
            else if (a.metrics.phase === 'accelerating') sup.push('momentum is accelerating');
            cats.momentum = category('momentum', 'directional', sign * m.strength,
                m.confidence, m.confidence > 0, sup, opp,
                m.confidence > 0 ? null : 'momentum indicators unavailable',
                { phase: a.metrics.phase, rsi: m.metrics.rsi, macdHistogram: m.metrics.macdHistogram });
        })();

        /* ---- 4. Pattern evidence (directional) ---- */
        (function () {
            var sum = patterns.summary;
            var sup = [], opp = [];
            (patterns.active || []).slice(0, 8).forEach(function (d) {
                var line = d.name + ' (' + d.bias + ', score ' + d.score.toFixed(2) + ')';
                if (d.bias === trend.direction) sup.push(line);
                else if (d.bias !== 'neutral') opp.push(line);
            });
            var available = sum.activeCount > 0;
            cats.pattern = category('pattern', 'directional', sum.netBias,
                available ? clamp01(0.4 + 0.6 * Math.min(1, sum.activeCount / 8)) : 0,
                available, sup, opp, available ? null : 'no active patterns detected',
                { netBias: sum.netBias, active: sum.activeCount,
                  bullish: sum.bullish, bearish: sum.bearish, invalidated: sum.invalidated });
        })();

        /* ---- 5. News sentiment (directional, hard-bounded) ---- */
        (function () {
            if (!sentiment || !sentiment.available) {
                cats.sentiment = category('sentiment', 'directional', 0, 0, false, [], [],
                    sentiment && sentiment.reason ? sentiment.reason : 'news sentiment unavailable', {});
                return;
            }
            // Sentiment can never dominate: it is capped well below a full signal.
            var capped = U.clamp(sentiment.score, -cfg.sentiment.maxDirectionalScore,
                                 cfg.sentiment.maxDirectionalScore);
            var sup = [], opp = [];
            (sentiment.evidence || []).forEach(function (e) {
                if ((capped >= 0 && dirSign >= 0) || (capped < 0 && dirSign < 0)) sup.push(e);
                else opp.push(e);
            });
            cats.sentiment = category('sentiment', 'directional', capped,
                clamp01(sentiment.confidence), true, sup, opp, null,
                { rawScore: sentiment.score, cappedScore: capped,
                  articleCount: sentiment.articleCount });
        })();

        /* ---- 6. Risk quality (quality) ---- */
        (function () {
            if (!proposal || !proposal.tradeable || !proposal.riskReward) {
                cats.riskQuality = category('riskQuality', 'quality', 0, 0, false, [], [],
                    'no tradeable proposal was constructed', {});
                return;
            }
            var rr = proposal.riskReward;
            var rrScore = clamp01((rr.toFinalTarget || 0) / (cfg.gates.minRiskReward * 1.75));
            var evScore = clamp01(0.5 + rr.expectedValueR / 2);
            var probScore = clamp01(rr.probabilityWeighted);
            var q = clamp01(0.45 * rrScore + 0.3 * probScore + 0.25 * evScore);
            var sup = [], opp = [];
            if (rr.meetsMinimum) sup.push('R:R ' + rr.toFinalTarget + ' meets the ' + rr.minimumRequired + ':1 minimum');
            else opp.push('R:R ' + rr.toFinalTarget + ' below the ' + rr.minimumRequired + ':1 minimum');
            if (rr.expectedValueR > 0) sup.push('expected value +' + rr.expectedValueR + 'R');
            else opp.push('expected value ' + rr.expectedValueR + 'R');
            cats.riskQuality = category('riskQuality', 'quality', q, 0.9, true, sup, opp, null,
                { riskReward: rr.toFinalTarget, expectedValueR: rr.expectedValueR,
                  probabilityWeighted: rr.probabilityWeighted });
        })();

        /* ---- 7. Support/Resistance quality (quality) ---- */
        (function () {
            var sr = levels && levels.supportResistance;
            var all = sr ? sr.levels : [];
            if (!all.length) {
                cats.srQuality = category('srQuality', 'quality', 0, 0, false, [], [],
                    'no support/resistance levels met the minimum touch count', {});
                return;
            }
            var avg = U.mean(all.map(function (l) { return l.strength; }));
            var sup = all.slice(0, 3).map(function (l) {
                return l.kind + ' at ' + U.formatPrice(l.price) + ' (' + l.touches +
                       ' touches, strength ' + l.strength.toFixed(2) + ')';
            });
            var opp = [];
            // Resistance directly overhead a long (or support under a short) opposes.
            var blocking = dirSign > 0 ? (sr.nearest.resistance) : (sr.nearest.support);
            if (blocking && blocking.distanceAtr < cfg.scoring.blockingProximityAtr) {
                opp.push('strong ' + blocking.kind + ' only ' + blocking.distanceAtr.toFixed(2) +
                         ' ATR away at ' + U.formatPrice(blocking.price));
            }
            cats.srQuality = category('srQuality', 'quality', avg, 0.85, true, sup, opp, null,
                { levelCount: all.length, averageStrength: avg,
                  nearestSupport: sr.nearest.support ? sr.nearest.support.price : null,
                  nearestResistance: sr.nearest.resistance ? sr.nearest.resistance.price : null });
        })();

        /* ---- 8. Fibonacci confluence (quality) ---- */
        (function () {
            var fib = levels && levels.fibonacci;
            if (!fib || !fib.available) {
                cats.fibConfluence = category('fibConfluence', 'quality', 0, 0, false, [], [],
                    fib && fib.reason ? fib.reason : 'no qualifying Fibonacci leg', {});
                return;
            }
            var conf = (levels.confluence || []);
            var base = conf.length ? U.mean(conf.map(function (c) { return c.strength; })) : 0.3;
            var inGolden = fib.inGoldenZone ? 0.25 : 0;
            var sup = conf.slice(0, 3).map(function (c) { return c.evidence[0]; });
            if (fib.inGoldenZone) sup.push('price is inside the golden zone (' +
                (fib.currentRetracement * 100).toFixed(1) + '% retracement)');
            cats.fibConfluence = category('fibConfluence', 'quality',
                clamp01(base + inGolden), 0.75, true, sup, [], null,
                { confluenceCount: conf.length, inGoldenZone: fib.inGoldenZone,
                  currentRetracement: fib.currentRetracement, legSpanAtr: fib.leg.spanAtr });
        })();

        /* ---- 9. Market-regime quality (quality) ---- */
        (function () {
            var r = trend.regime;
            // A tradeable regime scores high; chop and compression score low.
            var favourable = { STRONG_TRENDING: 1.0, WEAK_TRENDING: 0.7, EXPANSION: 0.75,
                               TRANSITION: 0.45, HIGH_VOLATILITY: 0.35, RANGING: 0.3,
                               ACCUMULATION: 0.5, DISTRIBUTION: 0.5,
                               LOW_VOLATILITY: 0.35, COMPRESSION: 0.2 };
            var base = favourable[r.primary] !== undefined ? favourable[r.primary] : 0.4;
            var q = clamp01(base * (0.6 + 0.4 * r.confidence));
            var runnerUp = r.rejected && r.rejected[0];
            var opp = [];
            if (runnerUp && runnerUp.score > r.confidence * 0.9) {
                opp.push('regime is ambiguous — ' + runnerUp.name + ' scored ' +
                         runnerUp.score.toFixed(2) + ', close behind');
            }
            cats.regimeQuality = category('regimeQuality', 'quality', q, r.confidence, true,
                r.evidence, opp, null,
                { regime: r.primary, regimeConfidence: r.confidence, favourability: base });
        })();

        /* ---- 10. Trade-construction quality (quality) ---- */
        (function () {
            if (!proposal || !proposal.tradeable) {
                cats.tradeConstruction = category('tradeConstruction', 'quality', 0, 0, false, [], [],
                    'no trade construction available', {});
                return;
            }
            var sup = ['entry via ' + proposal.entry.name + ' (execution quality ' +
                       proposal.entry.quality.toFixed(2) + ')',
                       'stop ' + proposal.stop.id + ' at ' + proposal.stop.distanceAtr.toFixed(2) +
                       ' ATR on a ' + proposal.stop.basis + ' basis'];
            var opp = [];
            (proposal.targets || []).forEach(function (t) {
                if (t.blockingLevels > 0) {
                    opp.push(t.id + ' has ' + t.blockingLevels + ' opposing level(s) in the way');
                }
            });
            cats.tradeConstruction = category('tradeConstruction', 'quality',
                proposal.positionRisk.tradeQuality, 0.85, true, sup, opp, null,
                { tradeQuality: proposal.positionRisk.tradeQuality,
                  executionQuality: proposal.positionRisk.executionQuality,
                  targetCount: (proposal.targets || []).length });
        })();

        return cats;
    };

    /* ================================================================
     * Composite synthesis with capability-aware renormalisation
     * ================================================================ */
    S.synthesise = function (cats, cfg) {
        var weights = cfg.scoring.categoryWeights;
        var kinds = cfg.scoring.categoryKind;
        var tuning = cfg.scoring.tuning;

        var directional = [], quality = [], excluded = [];

        Object.keys(cats).forEach(function (id) {
            var c = cats[id];
            var w = weights[id] || 0;
            if (!c.available || w <= 0) {
                excluded.push({ id: id, weight: w, reason: c.unavailableReason ||
                                (w <= 0 ? 'weight is zero in the active profile' : 'unavailable') });
                return;
            }
            (kinds[id] === 'quality' ? quality : directional).push({ id: id, cat: c, weight: w });
        });

        function normalise(group) {
            var total = group.reduce(function (a, g) { return a + g.weight; }, 0);
            group.forEach(function (g) {
                g.normalizedWeight = total > U.EPS ? g.weight / total : 0;
                g.contribution = g.cat.score * g.normalizedWeight;
            });
            return total;
        }
        var dirTotal = normalise(directional);
        var qualTotal = normalise(quality);

        var directionalScore = directional.reduce(function (a, g) { return a + g.contribution; }, 0);
        var qualityScore = quality.reduce(function (a, g) { return a + g.contribution; }, 0);

        /* Confidence blends three independent things:
         *   agreement  — do the directional categories point the same way?
         *   quality    — how good is the surrounding evidence?
         *   capability — how much of the intended model was actually available? */
        var signed = directional.filter(function (g) { return Math.abs(g.cat.score) > 0.02; });
        var agreeing = signed.filter(function (g) {
            return directionalScore >= 0 ? g.cat.score > 0 : g.cat.score < 0;
        });
        var agreement = signed.length ? agreeing.length / signed.length : 0;

        var plannedWeight = Object.keys(weights).reduce(function (a, k) { return a + weights[k]; }, 0);
        var availableWeight = dirTotal + qualTotal;
        var capabilityRatio = plannedWeight > U.EPS ? availableWeight / plannedWeight : 0;

        var confidence01 = clamp01(
            tuning.agreementWeight * agreement +
            tuning.qualityWeight * qualityScore +
            tuning.capabilityWeight * capabilityRatio);

        var confidencePct = U.clamp(confidence01 * 100, tuning.confidenceFloor, tuning.confidenceCeiling);

        /* Buy / sell / neutral probabilities via softmax — strictly positive, sums to 1. */
        var t = tuning.probabilityTemperature;
        var neutralPull = tuning.neutralBandScore * 2;
        var raw = {
            buy: directionalScore,
            sell: -directionalScore,
            neutral: neutralPull * (1 - Math.abs(directionalScore))
        };
        var keys = ['buy', 'sell', 'neutral'];
        var exps = keys.map(function (k) { return Math.exp(raw[k] / t); });
        var sum = exps.reduce(function (a, b) { return a + b; }, 0);
        var probabilities = {};
        keys.forEach(function (k, i) { probabilities[k] = exps[i] / sum; });

        return {
            directionalScore: directionalScore,
            qualityScore: qualityScore,
            confidence01: confidence01,
            confidencePct: confidencePct,
            agreement: agreement,
            capabilityRatio: capabilityRatio,
            probabilities: probabilities,
            contributions: directional.concat(quality).map(function (g) {
                return {
                    id: g.id,
                    kind: cfg.scoring.categoryKind[g.id],
                    score: +g.cat.score.toFixed(4),
                    profileWeight: g.weight,
                    normalizedWeight: +g.normalizedWeight.toFixed(4),
                    contribution: +g.contribution.toFixed(4),
                    confidence: +g.cat.confidence.toFixed(3),
                    supporting: g.cat.supporting,
                    opposing: g.cat.opposing,
                    metrics: g.cat.metrics
                };
            }).sort(function (a, b) { return Math.abs(b.contribution) - Math.abs(a.contribution); }),
            excluded: excluded,
            normalisation: {
                plannedWeight: +plannedWeight.toFixed(4),
                availableWeight: +availableWeight.toFixed(4),
                directionalWeightTotal: +dirTotal.toFixed(4),
                qualityWeightTotal: +qualTotal.toFixed(4),
                redistributed: excluded.length > 0,
                note: excluded.length
                    ? excluded.length + ' category(ies) excluded; remaining weights renormalised to 1 ' +
                      'within their group. No values were fabricated.'
                    : 'all categories available; no redistribution required'
            }
        };
    };

    /* ================================================================
     * TRADE QUALIFICATION FRAMEWORK  (three tiers)
     *
     *  HARD GATES        — always enforced, never configurable. A failure here
     *                      means the analysis is not structurally valid.
     *  CONFIGURABLE GATES— profile-driven thresholds. Different profiles may
     *                      legitimately reach different conclusions.
     *  INFORMATIONAL     — always computed and always shown, never gating.
     *                      Expected value lives here unless a profile opts in.
     *
     * Gates are evaluated in two stages because some need trade geometry that
     * only exists after construction: PRE gates run before the risk engine
     * builds anything, POST gates run once entry/stop/targets exist.
     * ================================================================ */

    S.HARD_GATES = [
        { id: 'valid_market_data', test: function (i) {
            return i.bars && i.bars.length >= 2; },
          message: 'insufficient market data (need at least 2 bars)' },

        { id: 'sufficient_analysis', test: function (i) {
            return !!(i.indicators && i.trend && i.patternReport); },
          message: 'one or more analysis stages did not produce output' },

        { id: 'finite_atr', test: function (i) {
            var atr = U.lastFinite(i.indicators.atr);
            return U.isFiniteNumber(atr) && atr > 0; },
          message: 'ATR is unavailable or zero — risk cannot be quantified' },

        { id: 'engine_integrity', test: function (i) {
            return !(i.patternReport.diagnostics &&
                     i.patternReport.diagnostics.errors &&
                     i.patternReport.diagnostics.errors.length > 0); },
          message: 'a detector failed during analysis — results are not trustworthy' }
    ];

    S.HARD_GATES_POST = [
        { id: 'valid_trade_geometry', test: function (p) {
            return p.entry && U.isFiniteNumber(p.entry.price) && p.entry.price > 0; },
          message: 'no valid entry price could be constructed' },

        { id: 'valid_stop_placement', test: function (p) {
            if (!p.stop || !U.isFiniteNumber(p.stop.price)) return false;
            var long = p.direction === 'bullish';
            return long ? p.stop.price < p.entry.price : p.stop.price > p.entry.price; },
          message: 'stop is missing or on the wrong side of entry' },

        { id: 'non_zero_risk', test: function (p) {
            return p.stop && p.entry && Math.abs(p.entry.price - p.stop.price) > 0; },
          message: 'stop distance is zero — risk is undefined' }
    ];

    /** Stage 1: hard gates + configurable gates that need no trade geometry. */
    S.preGates = function (input, composite, cfg) {
        var hard = [], configurable = [];

        S.HARD_GATES.forEach(function (g) {
            var passed = false;
            try { passed = !!g.test(input); } catch (e) { passed = false; }
            hard.push({ id: g.id, tier: 'hard', passed: passed,
                        message: passed ? 'ok' : g.message });
        });

        var gates = cfg.gates;
        function conf(id, value, threshold, ok, unit) {
            configurable.push({
                id: id, tier: 'configurable', passed: ok,
                value: U.isFiniteNumber(value) ? +value.toFixed(4) : value,
                threshold: threshold,
                profile: cfg.activeProfile ? cfg.activeProfile.id : 'default',
                message: ok ? 'ok'
                            : id + ' ' + (U.isFiniteNumber(value) ? value.toFixed(3) : value) +
                              ' below the profile minimum ' + threshold + (unit || '')
            });
        }
        conf('minTrendConfidence', input.trend.confidence, gates.minTrendConfidence,
             input.trend.confidence >= gates.minTrendConfidence);
        conf('minCompositeScore', Math.abs(composite.directionalScore), gates.minCompositeScore,
             Math.abs(composite.directionalScore) >= gates.minCompositeScore);
        conf('minRegimeQuality', composite.contributions
                .filter(function (c) { return c.id === 'regimeQuality'; })
                .map(function (c) { return c.score; })[0] || 0,
             gates.minRegimeQuality,
             (composite.contributions.filter(function (c) { return c.id === 'regimeQuality'; })
                 .map(function (c) { return c.score; })[0] || 0) >= gates.minRegimeQuality);
        conf('minConfirmationScore', composite.qualityScore, gates.minConfirmationScore,
             composite.qualityScore >= gates.minConfirmationScore);

        return summarise(hard, configurable, []);
    };

    /** Stage 2: gates requiring the constructed trade. */
    S.postGates = function (proposal, cfg) {
        var hard = [], configurable = [], informational = [];

        S.HARD_GATES_POST.forEach(function (g) {
            var passed = false;
            try { passed = !!g.test(proposal); } catch (e) { passed = false; }
            hard.push({ id: g.id, tier: 'hard', passed: passed,
                        message: passed ? 'ok' : g.message });
        });

        var rr = proposal.riskReward;
        if (rr) {
            var gates = cfg.gates;
            var rrOk = (rr.toFinalTarget || 0) >= gates.minRiskReward;
            configurable.push({
                id: 'minRiskReward', tier: 'configurable', passed: rrOk,
                value: rr.toFinalTarget, threshold: gates.minRiskReward,
                profile: cfg.activeProfile ? cfg.activeProfile.id : 'default',
                message: rrOk ? 'ok' : 'R:R ' + rr.toFinalTarget + ' below the profile minimum ' +
                                       gates.minRiskReward
            });

            /* Expected value: gating ONLY when the profile opts in.
             * Otherwise it stays purely informational, per the EV decision. */
            if (gates.minExpectedValueR === null || gates.minExpectedValueR === undefined) {
                informational.push({
                    id: 'expectedValueR', tier: 'informational', passed: null,
                    value: rr.expectedValueR,
                    message: 'expected value ' + rr.expectedValueR +
                             'R — reported for decision making; not gated by the ' +
                             (cfg.activeProfile ? cfg.activeProfile.name : 'active') + ' profile'
                });
            } else {
                var evOk = rr.expectedValueR >= gates.minExpectedValueR;
                configurable.push({
                    id: 'minExpectedValueR', tier: 'configurable', passed: evOk,
                    value: rr.expectedValueR, threshold: gates.minExpectedValueR,
                    profile: cfg.activeProfile ? cfg.activeProfile.id : 'default',
                    message: evOk ? 'ok' : 'expected value ' + rr.expectedValueR +
                                           'R below the profile minimum ' + gates.minExpectedValueR + 'R'
                });
            }

            // Always-visible informational metrics.
            informational.push({ id: 'probabilityWeightedRR', tier: 'informational', passed: null,
                value: rr.probabilityWeighted, message: 'probability-weighted R:R ' + rr.probabilityWeighted });
            informational.push({ id: 'weightedRR', tier: 'informational', passed: null,
                value: rr.weighted, message: 'ladder-weighted R:R ' + rr.weighted });
        }

        return summarise(hard, configurable, informational);
    };

    function summarise(hard, configurable, informational) {
        var hardFailed = hard.filter(function (g) { return !g.passed; });
        var confFailed = configurable.filter(function (g) { return !g.passed; });
        return {
            passed: hardFailed.length === 0 && confFailed.length === 0,
            hardPassed: hardFailed.length === 0,
            hard: hard,
            configurable: configurable,
            informational: informational,
            failures: hardFailed.concat(confFailed),
            blockingTier: hardFailed.length ? 'hard' : (confFailed.length ? 'configurable' : null)
        };
    }

    /* ================================================================
     * Public entry point
     * ================================================================ */
    /**
     * @param {Object} input  { bars, indicators, patternReport, trend, levels,
     *                          proposal, sentiment, config }
     */
    S.score = function (input) {
        var cfg = input.config || QT.CONFIG;
        if (!cfg.scoring || !cfg.scoring.categoryWeights) {
            cfg = QT.profiles.applyProfile('balanced', cfg);
        }

        var cats = S.scoreCategories(Object.assign({}, input, { config: cfg }));
        var composite = S.synthesise(cats, cfg);
        var pre = S.preGates(input, composite, cfg);
        var post = input.proposal && input.proposal.tradeable
                 ? S.postGates(input.proposal, cfg)
                 : { passed: false, hardPassed: true, hard: [], configurable: [], informational: [],
                     failures: [], blockingTier: null, skipped: 'no tradeable proposal to evaluate' };

        var allGatesPassed = pre.passed && (post.passed || !!post.skipped);

        return {
            profile: cfg.activeProfile || { id: 'default', name: 'Default' },
            categories: cats,
            directionalScore: +composite.directionalScore.toFixed(4),
            qualityScore: +composite.qualityScore.toFixed(4),
            confidence: +composite.confidencePct.toFixed(2),
            confidence01: +composite.confidence01.toFixed(4),
            probabilities: composite.probabilities,
            agreement: +composite.agreement.toFixed(4),
            capabilityRatio: +composite.capabilityRatio.toFixed(4),

            qualification: {
                passed: allGatesPassed,
                pre: pre,
                post: post,
                summary: allGatesPassed
                    ? 'all gates passed under the ' + (cfg.activeProfile ? cfg.activeProfile.name : 'default') + ' profile'
                    : (pre.failures.concat(post.failures || [])
                        .map(function (f) { return f.message; })[0] || 'no tradeable proposal')
            },

            /* Full trace: every contribution back to its evidence. */
            trace: {
                contributions: composite.contributions,
                excluded: composite.excluded,
                normalisation: composite.normalisation,
                profileAdjustments: {
                    profile: cfg.activeProfile ? cfg.activeProfile.id : 'default',
                    categoryWeights: cfg.scoring.categoryWeights,
                    gates: cfg.gates,
                    tuning: cfg.scoring.tuning
                }
            }
        };
    };

    QT.scoring = S;

})(typeof globalThis !== 'undefined' ? globalThis : this);

if (typeof module !== 'undefined' && module.exports) {
    module.exports = (typeof globalThis !== 'undefined' ? globalThis : this).QT.scoring;
}
