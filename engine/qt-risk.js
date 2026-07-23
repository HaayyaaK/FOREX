/**
 * qt-risk.js — Phase 5: Risk Management / Trade Construction Engine.
 *
 * Transforms the outputs of Phases 2–4 into a complete, explainable trade
 * proposal — or into a reasoned refusal to trade. It never invents price data
 * and never recalculates an earlier phase.
 *
 * DESIGN RULE: this engine is deliberately independent of account size and
 * position sizing. It answers "what is the optimal trade construction?", not
 * "how much capital should be committed?". All outputs are expressed in price,
 * ATR multiples and percentages, so a future portfolio or execution layer can
 * consume them without this engine changing.
 */
(function (root) {
    'use strict';

    var QT = root.QT = root.QT || {};
    var U = QT.utils;
    var D = QT.detection;

    /* Trade qualification outcomes. */
    var QUALIFICATION = {
        VALID: 'VALID_TRADE',
        MARGINAL: 'MARGINAL_TRADE',
        NO_TRADE: 'NO_TRADE',
        HIGH_RISK: 'HIGH_RISK',
        LOW_CONFIDENCE: 'LOW_CONFIDENCE',
        INSUFFICIENT_CONFIRMATION: 'INSUFFICIENT_CONFIRMATION'
    };

    /* Trade lifecycle. Defined now so later phases can adopt it unchanged. */
    var LIFECYCLE = {
        PROPOSED: 'PROPOSED',
        PENDING: 'PENDING',
        TRIGGERED: 'TRIGGERED',
        ACTIVE: 'ACTIVE',
        TP1_REACHED: 'TP1_REACHED',
        TP2_REACHED: 'TP2_REACHED',
        TP3_REACHED: 'TP3_REACHED',
        STOPPED_OUT: 'STOPPED_OUT',
        CANCELLED: 'CANCELLED',
        EXPIRED: 'EXPIRED'
    };

    var LIFECYCLE_TRANSITIONS = {
        PROPOSED:    ['PENDING', 'CANCELLED'],
        PENDING:     ['TRIGGERED', 'CANCELLED', 'EXPIRED'],
        TRIGGERED:   ['ACTIVE', 'STOPPED_OUT'],
        ACTIVE:      ['TP1_REACHED', 'STOPPED_OUT'],
        TP1_REACHED: ['TP2_REACHED', 'STOPPED_OUT'],
        TP2_REACHED: ['TP3_REACHED', 'STOPPED_OUT'],
        TP3_REACHED: [],
        STOPPED_OUT: [],
        CANCELLED:   [],
        EXPIRED:     []
    };

    var R = {};

    R.QUALIFICATION = QUALIFICATION;
    R.LIFECYCLE = LIFECYCLE;
    R.LIFECYCLE_TRANSITIONS = LIFECYCLE_TRANSITIONS;
    R.canTransition = function (from, to) {
        return (LIFECYCLE_TRANSITIONS[from] || []).indexOf(to) !== -1;
    };

    /* ================================================================
     * 1. TRADE QUALIFICATION
     *
     * Runs BEFORE any trade is constructed. Standing aside is a first-class
     * outcome, not a failure path.
     * ================================================================ */
    R.qualify = function (trend, patternReport, indicators, cfg) {
        var q = cfg.risk.qualification;
        var reasons = [];
        var blockers = [];
        var warnings = [];

        var direction = trend.direction;
        var confidence = trend.confidence;
        var strength = trend.strength;
        var regime = trend.regime.primary;
        var probs = trend.probabilities;

        /* --- Hard blockers: standing aside is mathematically preferable --- */
        if (direction === 'neutral') {
            blockers.push('no directional bias — trend engine reports neutral');
        }
        if (confidence < q.minConfidence) {
            blockers.push('trend confidence ' + confidence.toFixed(2) +
                          ' below the ' + q.minConfidence + ' floor');
        }
        if (strength < q.minStrength) {
            blockers.push('trend strength ' + strength.toFixed(2) +
                          ' below the ' + q.minStrength + ' floor');
        }
        if (probs.consolidation > q.maxConsolidationProb) {
            blockers.push('consolidation probability ' + probs.consolidation.toFixed(2) +
                          ' exceeds ' + q.maxConsolidationProb);
        }
        if (q.blockedRegimes.indexOf(regime) !== -1) {
            blockers.push('regime ' + regime + ' is on the do-not-trade list');
        }

        /* --- Directional-evidence check --- */
        var aligned = (patternReport.active || []).filter(function (d) {
            return d.bias === direction && !d.invalidated;
        });
        var opposed = (patternReport.active || []).filter(function (d) {
            return d.bias !== 'neutral' && d.bias !== direction && !d.invalidated;
        });
        if (aligned.length < q.minAlignedPatterns) {
            blockers.push('only ' + aligned.length + ' aligned pattern(s), ' +
                          q.minAlignedPatterns + ' required');
        }

        /* --- Risk warnings: permitted, but degrade quality --- */
        var atrPct = trend.dimensions.volatility.metrics.atrPercentile;
        var highVol = U.isFiniteNumber(atrPct) && atrPct > q.highVolatilityPercentile;
        if (highVol) {
            warnings.push('volatility at the ' + (atrPct * 100).toFixed(0) +
                          'th percentile — stop distance and slippage risk are elevated');
        }
        if (probs.reversal > probs.continuation) {
            warnings.push('reversal probability ' + probs.reversal.toFixed(2) +
                          ' exceeds continuation ' + probs.continuation.toFixed(2));
        }
        if (probs.exhaustion > q.maxExhaustionProb) {
            warnings.push('exhaustion probability ' + probs.exhaustion.toFixed(2) +
                          ' — the move may be late');
        }
        if (opposed.length > aligned.length) {
            warnings.push(opposed.length + ' opposing pattern(s) vs ' + aligned.length + ' aligned');
        }
        if (trend.explanation.opposing && trend.explanation.opposing.length >= q.maxOpposingDimensions) {
            warnings.push(trend.explanation.opposing.length + ' trend dimensions oppose the direction');
        }

        /* --- Resolve the outcome --- */
        var status, tradeable;
        if (blockers.length) {
            tradeable = false;
            // Choose the most specific applicable code.
            if (direction === 'neutral' || /aligned pattern/.test(blockers[0])) {
                status = direction === 'neutral' ? QUALIFICATION.NO_TRADE
                                                 : QUALIFICATION.INSUFFICIENT_CONFIRMATION;
            } else if (/confidence/.test(blockers[0])) {
                status = QUALIFICATION.LOW_CONFIDENCE;
            } else {
                status = QUALIFICATION.NO_TRADE;
            }
            reasons = blockers;
        } else if (highVol && warnings.length >= q.highRiskWarningCount) {
            tradeable = true;
            status = QUALIFICATION.HIGH_RISK;
            reasons = warnings;
        } else if (warnings.length >= q.marginalWarningCount ||
                   confidence < q.marginalConfidence) {
            tradeable = true;
            status = QUALIFICATION.MARGINAL;
            reasons = warnings.length ? warnings
                                      : ['confidence ' + confidence.toFixed(2) + ' is only marginal'];
        } else {
            tradeable = true;
            status = QUALIFICATION.VALID;
            reasons = ['trend confidence ' + confidence.toFixed(2) + ' and strength ' +
                       strength.toFixed(2) + ' clear all thresholds',
                       aligned.length + ' aligned pattern(s) confirm the direction',
                       'regime ' + regime + ' permits directional trading'];
        }

        return {
            status: status,
            tradeable: tradeable,
            direction: direction,
            reasons: reasons,
            blockers: blockers,
            warnings: warnings,
            evidence: {
                alignedPatterns: aligned.slice(0, 6).map(summarisePattern),
                opposingPatterns: opposed.slice(0, 6).map(summarisePattern)
            },
            metrics: {
                confidence: confidence, strength: strength, regime: regime,
                alignedCount: aligned.length, opposedCount: opposed.length,
                atrPercentile: atrPct, probabilities: probs
            }
        };
    };

    function summarisePattern(d) {
        return { id: d.id, name: d.name, bias: d.bias, score: +d.score.toFixed(3),
                 barsAgo: d.barsAgo, confirmed: d.confirmed };
    }

    /* ================================================================
     * 2. ENTRY CONSTRUCTION
     *
     * Several entry models are generated and scored; the caller receives all of
     * them plus the recommended one, so a future execution layer can choose.
     * ================================================================ */
    R.buildEntries = function (ctxData) {
        var bars = ctxData.bars, atr = ctxData.atr, cfg = ctxData.cfg;
        var dir = ctxData.direction, isLong = dir === 'bullish';
        var price = bars[bars.length - 1].close;
        var levels = ctxData.levels, trend = ctxData.trend;
        var e = cfg.risk.entry;
        var out = [];

        /* --- Model A: immediate market entry --- */
        (function () {
            // Execution quality falls as price extends away from the mean.
            var ema = U.lastFinite(ctxData.indicators.emaFast);
            var ext = U.isFiniteNumber(ema) ? Math.abs(price - ema) / atr : 0;
            var quality = U.clamp(1 - ext / e.extensionPenaltyAtr, 0.15, 1);
            out.push({
                model: 'immediate',
                name: 'Immediate Market Entry',
                price: price,
                quality: quality,
                confidence: U.clamp(trend.confidence * quality, 0, 1),
                rationale: 'Enter now at ' + U.formatPrice(price) +
                           '; price is ' + ext.toFixed(2) + ' ATR from EMA20',
                invalidation: ['trend state leaves ' + trend.state +
                               ' before the position is opened'],
                requiresTrigger: false,
                metrics: { extensionAtr: ext }
            });
        })();

        /* --- Model B: pullback entry at a value zone --- */
        (function () {
            var target = null, why = null;
            var fib = levels.fibonacci;
            if (fib.available && fib.direction === (isLong ? 'up' : 'down')) {
                var gz = isLong ? Math.max(fib.goldenZone.from, fib.goldenZone.to)
                                : Math.min(fib.goldenZone.from, fib.goldenZone.to);
                if ((isLong && gz < price) || (!isLong && gz > price)) {
                    target = gz;
                    why = 'Fibonacci golden zone (' + (cfg.fibonacci.goldenZone[0] * 100) + '–' +
                          (cfg.fibonacci.goldenZone[1] * 100) + '% retracement)';
                }
            }
            if (target === null) {
                var ema = U.lastFinite(ctxData.indicators.emaFast);
                if (U.isFiniteNumber(ema) && ((isLong && ema < price) || (!isLong && ema > price))) {
                    target = ema;
                    why = 'EMA20 dynamic support';
                }
            }
            if (target === null) return;

            var dist = Math.abs(price - target) / atr;
            if (dist > e.maxPullbackAtr) return;
            out.push({
                model: 'pullback',
                name: 'Pullback Entry',
                price: target,
                quality: U.clamp(0.75 + 0.25 * (1 - dist / e.maxPullbackAtr), 0, 1),
                confidence: U.clamp(trend.confidence * 0.95, 0, 1),
                rationale: 'Wait for a retracement to ' + U.formatPrice(target) + ' — ' + why,
                invalidation: ['price fails to reach the zone within ' + e.pendingExpiryBars + ' bars',
                               'a close beyond the zone by more than ' + e.pullbackInvalidAtr + ' ATR'],
                requiresTrigger: true,
                expiryBars: e.pendingExpiryBars,
                metrics: { distanceAtr: dist }
            });
        })();

        /* --- Model C: breakout confirmation --- */
        (function () {
            var lvl = isLong ? levels.supportResistance.nearest.resistance
                             : levels.supportResistance.nearest.support;
            if (!lvl) return;
            var trigger = isLong ? lvl.price + atr * e.breakoutBufferAtr
                                 : lvl.price - atr * e.breakoutBufferAtr;
            out.push({
                model: 'breakout',
                name: 'Breakout Confirmation Entry',
                price: trigger,
                quality: U.clamp(0.55 + 0.45 * lvl.strength, 0, 1),
                confidence: U.clamp(trend.confidence * 0.9, 0, 1),
                rationale: 'Enter on a confirmed close beyond ' + U.formatPrice(lvl.price) +
                           ' (level tested ' + lvl.touches + ' times), with a ' +
                           e.breakoutBufferAtr + ' ATR buffer',
                invalidation: ['close back inside the level after the break (failed breakout)',
                               'break occurs without the trend state persisting'],
                requiresTrigger: true,
                expiryBars: e.pendingExpiryBars,
                metrics: { levelPrice: lvl.price, levelStrength: lvl.strength,
                           bufferAtr: e.breakoutBufferAtr }
            });
        })();

        /* --- Model D: retest of a broken level or unmitigated zone --- */
        (function () {
            var zones = (ctxData.patternReport.active || []).filter(function (d) {
                return /order_block|fvg/.test(d.id) && d.bias === dir && !d.invalidated &&
                       d.priceRange && d.barsAgo <= e.retestLookbackBars;
            });
            if (!zones.length) return;
            var z = zones[0];
            var mid = (z.priceRange.high + z.priceRange.low) / 2;
            var dist = Math.abs(price - mid) / atr;
            if (dist > e.maxPullbackAtr) return;

            out.push({
                model: 'retest',
                name: 'Retest Entry',
                price: mid,
                quality: U.clamp(0.7 + 0.3 * z.score, 0, 1),
                confidence: U.clamp(trend.confidence * 0.92, 0, 1),
                rationale: 'Enter on a retest of the ' + z.name + ' at ' +
                           U.formatPrice(z.priceRange.low) + '–' + U.formatPrice(z.priceRange.high),
                invalidation: ['a close through the far side of the zone invalidates it',
                               'zone not retested within ' + e.pendingExpiryBars + ' bars'],
                requiresTrigger: true,
                expiryBars: e.pendingExpiryBars,
                metrics: { zoneHigh: z.priceRange.high, zoneLow: z.priceRange.low,
                           zoneScore: z.score, distanceAtr: dist }
            });
        })();

        out.sort(function (a, b) { return (b.quality * b.confidence) - (a.quality * a.confidence); });
        return { candidates: out, recommended: out[0] || null };
    };

    /* ================================================================
     * 3. STOP CONSTRUCTION
     *
     * Three tiers are produced from independent evidence, never fixed distances:
     *   SL1 structural — just beyond the nearest protective swing/zone
     *   SL2 volatility — ATR-scaled by instrument class (D1 §6.2)
     *   SL3 invalidation — beyond the level that would void the entire thesis
     * ================================================================ */
    R.buildStops = function (ctxData, entryPrice) {
        var cfg = ctxData.cfg, atr = ctxData.atr, dir = ctxData.direction;
        var isLong = dir === 'bullish';
        var klass = cfg.risk.classes[ctxData.assetClass] || cfg.risk.classes[cfg.risk.defaultClass];
        var bars = ctxData.bars;
        var stops = [];

        function push(id, price, basis, evidence, confidence) {
            if (!U.isFiniteNumber(price)) return;
            // A stop on the wrong side of entry is structurally invalid.
            if (isLong ? price >= entryPrice : price <= entryPrice) return;
            var dist = Math.abs(entryPrice - price);
            stops.push({
                id: id, price: price, basis: basis,
                distance: dist,
                distanceAtr: dist / atr,
                distancePct: (dist / entryPrice) * 100,
                confidence: confidence,
                evidence: evidence
            });
        }

        /* SL1 — structural: beyond the nearest protective swing. */
        (function () {
            var swings = ctxData.swings.filter(function (s) {
                return isLong ? (s.type === 'low' && s.price < entryPrice)
                              : (s.type === 'high' && s.price > entryPrice);
            });
            if (!swings.length) return;
            var protective = swings[swings.length - 1];
            var buffer = atr * cfg.risk.structuralBufferAtr;
            push('SL1', isLong ? protective.price - buffer : protective.price + buffer,
                 'structure',
                 ['placed beyond the protective swing ' + (isLong ? 'low' : 'high') + ' at ' +
                  U.formatPrice(protective.price),
                  'buffer of ' + cfg.risk.structuralBufferAtr + ' ATR absorbs a stop-hunt wick'],
                 0.85);
        })();

        /* SL2 — volatility: ATR multiple from the instrument class (D1 §6.2). */
        (function () {
            var mult = klass.atrStopMultiplier;
            push('SL2', isLong ? entryPrice - atr * mult : entryPrice + atr * mult,
                 'atr',
                 [mult + '× ATR, the documented band for ' + ctxData.assetClass +
                  ' instruments (research D1 §6.2 range ' + klass.atrStopRange.join('–') + ')',
                  'current ATR ' + U.formatPrice(atr)],
                 0.9);
        })();

        /* SL3 — invalidation: beyond the level that voids the thesis entirely. */
        (function () {
            var anchor = null, why = null;
            var zones = (ctxData.patternReport.active || []).filter(function (d) {
                return /order_block|fvg/.test(d.id) && d.bias === dir && d.priceRange;
            });
            if (zones.length) {
                anchor = isLong ? zones[0].priceRange.low : zones[0].priceRange.high;
                why = 'beyond the ' + zones[0].name + ' — a close through it invalidates the setup';
            }
            if (anchor === null) {
                var sr = isLong ? ctxData.levels.supportResistance.nearest.support
                                : ctxData.levels.supportResistance.nearest.resistance;
                if (sr) { anchor = sr.price; why = 'beyond ' + sr.kind + ' at ' + U.formatPrice(sr.price); }
            }
            if (anchor === null) return;
            var buffer = atr * cfg.risk.invalidationBufferAtr;
            push('SL3', isLong ? anchor - buffer : anchor + buffer, 'invalidation',
                 [why, 'buffer of ' + cfg.risk.invalidationBufferAtr + ' ATR'], 0.75);
        })();

        // Order by distance so SL1 is always the tightest.
        stops.sort(function (a, b) { return a.distance - b.distance; });
        stops.forEach(function (s, i) { s.tier = i + 1; });

        /* The recommended stop respects the class ATR band: a structural stop
         * that is far tighter than the instrument's volatility warrants would be
         * stopped out by noise, so it is rejected in favour of the ATR stop. */
        var minAtr = klass.atrStopRange[0], maxAtr = klass.atrStopRange[1];
        var viable = stops.filter(function (s) { return s.distanceAtr >= minAtr; });
        var recommended = viable[0] || stops[stops.length - 1] || null;
        var rejected = stops.filter(function (s) { return s !== recommended; }).map(function (s) {
            return { id: s.id, price: s.price, distanceAtr: +s.distanceAtr.toFixed(2),
                     reason: s.distanceAtr < minAtr
                        ? 'only ' + s.distanceAtr.toFixed(2) + ' ATR — inside the ' + minAtr +
                          '–' + maxAtr + ' ATR noise band for ' + ctxData.assetClass
                        : 'wider than the selected stop' };
        });

        return { candidates: stops, recommended: recommended, rejected: rejected,
                 classBand: klass.atrStopRange, assetClass: ctxData.assetClass };
    };

    /* ================================================================
     * 4. TAKE PROFIT CONSTRUCTION
     *
     * Targets are drawn from evidence — Fibonacci extensions, structural
     * levels, measured moves — and only then checked against R:R. Each target
     * carries an achievement probability derived from distance, the opposing
     * level structure in the way, and the trend's continuation probability.
     * ================================================================ */
    R.buildTargets = function (ctxData, entryPrice, stopPrice) {
        var cfg = ctxData.cfg, atr = ctxData.atr, dir = ctxData.direction;
        var isLong = dir === 'bullish';
        var risk = Math.abs(entryPrice - stopPrice);
        if (!(risk > U.EPS)) return { candidates: [], selected: [], risk: 0 };

        var candidates = [];
        function add(price, source, evidence, baseConf) {
            if (!U.isFiniteNumber(price)) return;
            if (isLong ? price <= entryPrice : price >= entryPrice) return;
            var reward = Math.abs(price - entryPrice);
            candidates.push({
                price: price, source: source, evidence: evidence,
                reward: reward, rr: reward / risk,
                distanceAtr: reward / atr,
                distancePct: (reward / entryPrice) * 100,
                baseConfidence: baseConf
            });
        }

        /* Source 1 — Fibonacci extensions and expansions. */
        var fib = ctxData.levels.fibonacci;
        if (fib.available) {
            fib.levels.filter(function (l) {
                return l.type === 'extension' || l.type === 'expansion';
            }).forEach(function (l) {
                add(l.price, 'fibonacci', [l.label + ' of the dominant ' + fib.direction + ' leg'], 0.7);
            });
        }

        /* Source 2 — opposing structural levels (where price historically reacted). */
        var opposing = isLong ? ctxData.levels.supportResistance.resistance
                              : ctxData.levels.supportResistance.support;
        opposing.forEach(function (l) {
            add(l.price, 'structure',
                [l.kind + ' tested ' + l.touches + ' times, strength ' + l.strength.toFixed(2)],
                0.6 + 0.3 * l.strength);
        });

        /* Source 3 — measured move from a completed chart pattern. */
        (ctxData.patternReport.active || []).forEach(function (d) {
            if (d.metrics && U.isFiniteNumber(d.metrics.projectedTarget) && d.bias === dir) {
                add(d.metrics.projectedTarget, 'measured_move',
                    [d.name + ' projection (' + (d.confirmed ? 'confirmed' : 'unconfirmed') + ')'],
                    d.confirmed ? 0.7 : 0.5);
            }
        });

        /* Source 4 — volatility projection, as a floor so targets always exist. */
        [1, 2, 3].forEach(function (k) {
            var mult = cfg.risk.volatilityTargetAtr * k;
            add(isLong ? entryPrice + atr * mult : entryPrice - atr * mult,
                'volatility', [mult.toFixed(1) + '× ATR volatility projection'], 0.45);
        });

        /* Confluence targets are strongest: two methods agreeing. */
        ctxData.levels.confluence.forEach(function (c) {
            add(c.price, 'confluence', c.evidence, 0.85);
        });

        // Merge near-duplicates, keeping the best-supported source.
        var tol = atr * cfg.risk.targetMergeAtr;
        candidates.sort(function (a, b) { return a.reward - b.reward; });
        var merged = [];
        candidates.forEach(function (c) {
            var near = merged.filter(function (m) { return Math.abs(m.price - c.price) <= tol; })[0];
            if (near) {
                near.evidence = near.evidence.concat(c.evidence);
                near.sources = (near.sources || [near.source]).concat([c.source]);
                near.baseConfidence = Math.max(near.baseConfidence, c.baseConfidence);
                // Agreement between independent methods raises confidence.
                near.baseConfidence = U.clamp(near.baseConfidence + cfg.risk.confluenceBonus, 0, 0.95);
            } else {
                c.sources = [c.source];
                merged.push(c);
            }
        });

        /* Achievement probability: decays with distance, is reduced by every
         * opposing level standing in the way, and is scaled by the trend's own
         * continuation probability. */
        var contProb = ctxData.trend.probabilities.continuation;
        merged.forEach(function (m) {
            var distanceDecay = Math.exp(-m.distanceAtr / cfg.risk.targetDecayAtr);
            var blocking = opposing.filter(function (l) {
                return isLong ? (l.price > entryPrice && l.price < m.price)
                              : (l.price < entryPrice && l.price > m.price);
            }).length;
            var blockPenalty = Math.pow(cfg.risk.blockingLevelPenalty, blocking);
            m.probability = U.clamp(m.baseConfidence * distanceDecay * blockPenalty *
                                    (0.5 + 0.5 * contProb / 0.5), 0.02, 0.95);
            m.blockingLevels = blocking;
            m.expectedValueR = m.rr * m.probability - (1 - m.probability);
            m.invalidation = ['a close beyond the stop before this target is reached',
                              'structural break against the position'];
            if (blocking) m.invalidation.push(blocking + ' opposing level(s) lie between entry and target');
        });

        // Select TP1/TP2/TP3: ascending distance, each meaningfully beyond the last.
        var selected = [];
        var minStepR = cfg.risk.minTargetStepR;
        merged.filter(function (m) { return m.rr >= cfg.risk.minTargetR; })
              .forEach(function (m) {
                  if (selected.length >= 3) return;
                  if (!selected.length || m.rr >= selected[selected.length - 1].rr + minStepR) {
                      selected.push(m);
                  }
              });

        // Guarantee three targets by falling back to the ladder from D1 §6.3.
        cfg.risk.takeProfitLadder.forEach(function (rung, i) {
            if (selected.length > i) return;
            var price = isLong ? entryPrice + risk * rung.rr : entryPrice - risk * rung.rr;
            selected.push({
                price: price, source: 'rr_ladder',
                sources: ['rr_ladder'],
                evidence: ['research ladder target at ' + rung.rr + 'R (D1 §6.3)'],
                reward: Math.abs(price - entryPrice), rr: rung.rr,
                distanceAtr: Math.abs(price - entryPrice) / atr,
                distancePct: (Math.abs(price - entryPrice) / entryPrice) * 100,
                baseConfidence: 0.4,
                probability: U.clamp(0.4 * Math.exp(-(Math.abs(price - entryPrice) / atr) /
                                     cfg.risk.targetDecayAtr), 0.02, 0.9),
                blockingLevels: 0,
                expectedValueR: 0,
                invalidation: ['a close beyond the stop before this target is reached']
            });
        });

        selected.sort(function (a, b) { return a.rr - b.rr; });
        selected = selected.slice(0, 3);
        selected.forEach(function (t, i) {
            t.id = 'TP' + (i + 1);
            t.closePct = cfg.risk.takeProfitLadder[i] ? cfg.risk.takeProfitLadder[i].closePct : 25;
            if (!U.isFiniteNumber(t.expectedValueR) || t.expectedValueR === 0) {
                t.expectedValueR = t.rr * t.probability - (1 - t.probability);
            }
        });

        return { candidates: merged, selected: selected, risk: risk };
    };

    /* ================================================================
     * 5. FULL TRADE PROPOSAL
     * ================================================================ */

    /**
     * @param {Object} input
     * @param {Array}  input.bars
     * @param {Object} input.indicators   Phase 2 output
     * @param {Object} input.patternReport Phase 3 output
     * @param {Object} input.trend        Phase 4 output
     * @param {Object} [input.levels]     qt-levels output (computed if absent)
     * @param {string} [input.assetClass] 'forex' | 'metal' | 'crypto'
     * @param {Object} [input.config]
     */
    R.buildProposal = function (input) {
        var cfg = input.config || QT.CONFIG;
        var bars = input.bars;
        var ind = input.indicators;
        var trend = input.trend;
        var patternReport = input.patternReport;
        var assetClass = input.assetClass || cfg.risk.defaultClass;
        var atr = U.lastFinite(ind.atr);

        var qualification = R.qualify(trend, patternReport, ind, cfg);

        var base = {
            qualification: qualification,
            lifecycle: { state: LIFECYCLE.PROPOSED, allowedNext: LIFECYCLE_TRANSITIONS.PROPOSED },
            assetClass: assetClass,
            direction: trend.direction,
            generatedAtBar: bars.length ? bars.length - 1 : null,
            barTime: bars.length ? bars[bars.length - 1].time : null
        };

        if (!qualification.tradeable || !bars.length || !(atr > U.EPS)) {
            return Object.assign(base, {
                tradeable: false,
                entry: null, stops: null, targets: null, riskReward: null,
                positionRisk: null,
                explanation: {
                    summary: 'No trade proposed: ' + qualification.status.replace(/_/g, ' ').toLowerCase() +
                             '. ' + (qualification.reasons[0] || ''),
                    entryRationale: null, stopRationale: null, targetRationale: [],
                    supporting: qualification.evidence.alignedPatterns,
                    conflicting: qualification.evidence.opposingPatterns,
                    preEntryInvalidation: [], postEntryInvalidation: [],
                    standAsideReasons: qualification.blockers.length ? qualification.blockers
                                                                    : qualification.reasons
                }
            });
        }

        var swings = input.swings || [];
        var levels = input.levels || QT.levels.analyze(bars, swings, atr, cfg);

        var ctxData = {
            bars: bars, indicators: ind, patternReport: patternReport, trend: trend,
            levels: levels, swings: swings, atr: atr, cfg: cfg,
            direction: trend.direction, assetClass: assetClass
        };

        var entries = R.buildEntries(ctxData);
        var entry = entries.recommended;
        if (!entry) {
            return Object.assign(base, {
                tradeable: false,
                qualification: Object.assign({}, qualification, {
                    status: QUALIFICATION.INSUFFICIENT_CONFIRMATION,
                    reasons: ['no viable entry model could be constructed']
                }),
                entry: null, stops: null, targets: null, riskReward: null, positionRisk: null,
                explanation: { summary: 'No trade proposed: no viable entry construction.',
                               standAsideReasons: ['no entry model produced a valid price'] }
            });
        }

        var stops = R.buildStops(ctxData, entry.price);
        if (!stops.recommended) {
            return Object.assign(base, {
                tradeable: false,
                qualification: Object.assign({}, qualification, {
                    status: QUALIFICATION.INSUFFICIENT_CONFIRMATION,
                    reasons: ['no valid stop placement exists on the protective side of entry']
                }),
                entry: entry, stops: stops, targets: null, riskReward: null, positionRisk: null,
                explanation: { summary: 'No trade proposed: no valid stop could be constructed.',
                               standAsideReasons: ['no stop candidate sits on the protective side of entry'] }
            });
        }

        var stop = stops.recommended;
        var targets = R.buildTargets(ctxData, entry.price, stop.price);

        /* ---- Risk/Reward: several metrics, never a lone number ---- */
        var klass = cfg.risk.classes[assetClass] || cfg.risk.classes[cfg.risk.defaultClass];
        var primary = targets.selected[0] || null;
        var finalTarget = targets.selected[targets.selected.length - 1] || null;

        var weightedRR = 0, weightedProb = 0, expectancy = 0, allocated = 0;
        targets.selected.forEach(function (t) {
            var w = t.closePct / 100;
            allocated += w;
            weightedRR += t.rr * w;
            weightedProb += t.probability * w;
            expectancy += w * (t.rr * t.probability - (1 - t.probability));
        });
        // The untouched runner is assumed to exit at the final target's R.
        var runner = Math.max(0, 1 - allocated);
        if (runner > 0 && finalTarget) {
            weightedRR += finalTarget.rr * runner;
            weightedProb += finalTarget.probability * runner;
            expectancy += runner * (finalTarget.rr * finalTarget.probability - (1 - finalTarget.probability));
        }

        var meetsMinRR = primary ? (finalTarget.rr >= klass.minRR) : false;
        var riskReward = {
            nominal: primary ? +primary.rr.toFixed(3) : null,
            toFinalTarget: finalTarget ? +finalTarget.rr.toFixed(3) : null,
            weighted: +weightedRR.toFixed(3),
            probabilityWeighted: +weightedProb.toFixed(3),
            expectedValueR: +expectancy.toFixed(4),
            minimumRequired: klass.minRR,
            meetsMinimum: meetsMinRR,
            riskDistance: +stop.distance.toFixed(8),
            riskDistanceAtr: +stop.distanceAtr.toFixed(3),
            riskDistancePct: +stop.distancePct.toFixed(4),
            holdingProfile: estimateHolding(targets.selected, atr, ind, cfg)
        };

        /* Falling short of the research minimum R:R downgrades the trade —
         * D1 §1.4 treats 1:2 as a hard professional floor. */
        var finalQual = qualification;
        if (!meetsMinRR && qualification.status === QUALIFICATION.VALID) {
            finalQual = Object.assign({}, qualification, {
                status: QUALIFICATION.MARGINAL,
                reasons: qualification.reasons.concat([
                    'final-target R:R ' + (finalTarget ? finalTarget.rr.toFixed(2) : 'n/a') +
                    ' is below the ' + klass.minRR + ':1 research minimum (D1 §1.4)'])
            });
        }

        var positionRisk = {
            entryPrice: entry.price,
            stopPrice: stop.price,
            stopDistance: stop.distance,
            stopDistanceAtr: stop.distanceAtr,
            stopDistancePct: stop.distancePct,
            targetDistances: targets.selected.map(function (t) {
                return { id: t.id, distance: t.reward, distanceAtr: t.distanceAtr,
                         distancePct: t.distancePct };
            }),
            volatilityExposure: {
                atr: atr,
                atrPercentile: trend.dimensions.volatility.metrics.atrPercentile,
                regime: trend.regime.primary,
                bandwidth: trend.dimensions.volatility.metrics.bandwidth
            },
            tradeQuality: computeTradeQuality(finalQual, entry, stop, targets, trend, riskReward),
            executionQuality: entry.quality,
            /* Deliberately excluded: position size, leverage and capital
             * allocation. A portfolio layer consumes these metrics instead. */
            sizingInputsOnly: true
        };

        return Object.assign(base, {
            tradeable: true,
            qualification: finalQual,
            entry: entry,
            entryCandidates: entries.candidates,
            stop: stop,
            stops: stops,
            targets: targets.selected,
            targetCandidates: targets.candidates.slice(0, 12),
            riskReward: riskReward,
            positionRisk: positionRisk,
            levels: {
                support: levels.supportResistance.support,
                resistance: levels.supportResistance.resistance,
                fibonacci: levels.fibonacci.available ? {
                    direction: levels.fibonacci.direction,
                    goldenZone: levels.fibonacci.goldenZone,
                    currentRetracement: levels.fibonacci.currentRetracement,
                    levels: levels.fibonacci.levels
                } : null,
                confluence: levels.confluence
            },
            explanation: buildExplanation(finalQual, entry, stop, stops, targets, trend, riskReward)
        });
    };

    function estimateHolding(targets, atr, ind, cfg) {
        // Expected bars-to-target from recent per-bar range, as a planning aid only.
        var recent = ind.atr.filter(U.isFiniteNumber).slice(-cfg.risk.holdingLookback);
        var perBar = recent.length ? U.mean(recent) : atr;
        if (!(perBar > U.EPS)) return null;
        return targets.map(function (t) {
            return { id: t.id,
                     estimatedBars: Math.max(1, Math.round(t.reward / (perBar * cfg.risk.holdingEfficiency))) };
        });
    }

    function computeTradeQuality(qual, entry, stop, targets, trend, rr) {
        var statusScore = qual.status === QUALIFICATION.VALID ? 1
                        : qual.status === QUALIFICATION.MARGINAL ? 0.6
                        : qual.status === QUALIFICATION.HIGH_RISK ? 0.45 : 0.2;
        var rrScore = U.clamp((rr.toFinalTarget || 0) / 3, 0, 1);
        var probScore = targets.selected.length
            ? U.mean(targets.selected.map(function (t) { return t.probability; })) : 0;
        return +U.clamp(0.3 * statusScore + 0.2 * entry.quality + 0.2 * rrScore +
                        0.15 * probScore + 0.15 * trend.confidence, 0, 1).toFixed(4);
    }

    function buildExplanation(qual, entry, stop, stops, targets, trend, rr) {
        var pre = [], post = [];
        pre = pre.concat(entry.invalidation || []);
        pre.push('trend state leaves ' + trend.state + ' before entry triggers');
        if (entry.requiresTrigger) pre.push('entry trigger not met within ' + (entry.expiryBars || 'n/a') + ' bars');

        post.push('a close beyond the stop at ' + U.formatPrice(stop.price));
        post.push('structural break against the ' + trend.direction + ' thesis');
        if (trend.probabilities.reversal > 0.35) {
            post.push('reversal probability is already elevated at ' + trend.probabilities.reversal.toFixed(2));
        }

        return {
            summary: qual.status.replace(/_/g, ' ').toLowerCase().replace(/^./, function (c) { return c.toUpperCase(); }) +
                     ': ' + trend.direction + ' via ' + entry.name.toLowerCase() + ' at ' +
                     U.formatPrice(entry.price) + ', stop ' + U.formatPrice(stop.price) +
                     ' (' + stop.distanceAtr.toFixed(2) + ' ATR), final target R:R ' +
                     (rr.toFinalTarget !== null ? rr.toFinalTarget.toFixed(2) : 'n/a'),
            entryRationale: { model: entry.model, rationale: entry.rationale,
                              quality: entry.quality, confidence: entry.confidence },
            stopRationale: { id: stop.id, basis: stop.basis, evidence: stop.evidence,
                             distanceAtr: stop.distanceAtr,
                             rejectedAlternatives: stops.rejected },
            targetRationale: targets.selected.map(function (t) {
                return { id: t.id, price: t.price, sources: t.sources, evidence: t.evidence,
                         rr: +t.rr.toFixed(2), probability: +t.probability.toFixed(3),
                         expectedValueR: +t.expectedValueR.toFixed(3),
                         blockingLevels: t.blockingLevels, invalidation: t.invalidation };
            }),
            supporting: qual.evidence.alignedPatterns,
            conflicting: qual.evidence.opposingPatterns,
            trendEvidence: { supporting: trend.explanation.supporting,
                             opposing: trend.explanation.opposing },
            preEntryInvalidation: pre,
            postEntryInvalidation: post,
            warnings: qual.warnings
        };
    }

    QT.risk = R;

})(typeof globalThis !== 'undefined' ? globalThis : this);

if (typeof module !== 'undefined' && module.exports) {
    module.exports = (typeof globalThis !== 'undefined' ? globalThis : this).QT.risk;
}
