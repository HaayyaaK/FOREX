/**
 * qt-detection.js — Phase 3 core: the detection contract, the shared analysis
 * context, and the detector registry.
 *
 * Every detector in the system returns the SAME structure (see `makeDetection`),
 * so downstream engines (trend, structure, scoring, recommendation,
 * explainability) can consume any detector without special-casing.
 *
 * Expensive intermediates — swing points, candle anatomy, ATR — are computed
 * once per analysis in `buildContext` and shared by every detector, keeping the
 * whole pass linear in the number of bars.
 */
(function (root) {
    'use strict';

    var QT = root.QT = root.QT || {};
    var U = QT.utils;
    var I = QT.indicators;

    /* ================================================================
     * Detection schema
     * ================================================================ */

    var BIAS = { BULLISH: 'bullish', BEARISH: 'bearish', NEUTRAL: 'neutral' };
    var CATEGORY = {
        CANDLESTICK: 'candlestick',
        STRUCTURE: 'structure',
        SMC: 'smc',
        CHART: 'chart',
        ZONE: 'zone'
    };

    /**
     * Builds a standardized detection record.
     * All scores are in [0,1] and are deterministic functions of the bar data.
     *
     * @param {Object} spec
     * @param {string} spec.id           stable machine id, e.g. 'bullish_engulfing'
     * @param {string} spec.name         display name
     * @param {string} spec.category     one of CATEGORY
     * @param {string} spec.bias         one of BIAS
     * @param {number} spec.confidence   how certain we are the pattern IS present
     * @param {number} spec.strength     how significant the pattern is if present
     * @param {number} spec.quality      data/context quality behind the reading
     * @param {number} spec.barIndex     anchor bar (usually the completing bar)
     * @param {Array}  [spec.barRange]   [startIdx, endIdx] inclusive
     * @param {Object} [spec.priceRange] { high, low }
     */
    function makeDetection(spec) {
        var range = spec.barRange || [spec.barIndex, spec.barIndex];
        return {
            id: spec.id,
            name: spec.name,
            category: spec.category,
            bias: spec.bias,

            confidence: clamp01(spec.confidence),
            strength: clamp01(spec.strength),
            quality: clamp01(spec.quality === undefined ? 1 : spec.quality),
            /** Single scalar for scoring: the product of all three dimensions. */
            get score() {
                return this.confidence * this.strength * this.quality;
            },

            barIndex: spec.barIndex,
            barRange: range,
            barsAgo: spec.barsAgo === undefined ? null : spec.barsAgo,
            time: spec.time === undefined ? null : spec.time,
            priceRange: spec.priceRange || null,

            confirmed: !!spec.confirmed,
            invalidated: !!spec.invalidated,
            completed: spec.completed === undefined ? true : !!spec.completed,

            requiredConfirmation: spec.requiredConfirmation || [],
            expiration: spec.expiration || null,

            evidence: {
                satisfied: (spec.evidence && spec.evidence.satisfied) || [],
                missing: (spec.evidence && spec.evidence.missing) || [],
                conflicting: (spec.evidence && spec.evidence.conflicting) || []
            },

            /** Raw numeric internals, retained for the traceability requirement. */
            metrics: spec.metrics || {},

            /** One-line human explanation of why this fired. */
            why: spec.why || ''
        };
    }

    /**
     * Records a detector that ALMOST fired. Powers "why it failed" in the
     * explainability engine. Only collected when config.patterns.collectRejections
     * is enabled, so the hot path stays allocation-light.
     */
    function makeRejection(id, name, barIndex, satisfied, missing) {
        return {
            id: id, name: name, barIndex: barIndex,
            satisfied: satisfied || [], missing: missing || []
        };
    }

    function clamp01(v) {
        if (!U.isFiniteNumber(v)) return 0;
        return v < 0 ? 0 : (v > 1 ? 1 : v);
    }

    /* ================================================================
     * Candle anatomy — computed once, reused by every candlestick rule
     * ================================================================ */

    /**
     * Decomposes a bar into the measurements every candlestick rule needs.
     * `range` is guarded against zero so no rule can divide by it.
     */
    function anatomy(bar) {
        var range = bar.high - bar.low;
        var body = Math.abs(bar.close - bar.open);
        var bodyTop = Math.max(bar.open, bar.close);
        var bodyBottom = Math.min(bar.open, bar.close);
        var safeRange = range > U.EPS ? range : U.EPS;
        return {
            range: range,
            safeRange: safeRange,
            body: body,
            bodyTop: bodyTop,
            bodyBottom: bodyBottom,
            upperWick: bar.high - bodyTop,
            lowerWick: bodyBottom - bar.low,
            bodyPct: body / safeRange,
            upperWickPct: (bar.high - bodyTop) / safeRange,
            lowerWickPct: (bodyBottom - bar.low) / safeRange,
            midpoint: (bar.high + bar.low) / 2,
            bodyMid: (bodyTop + bodyBottom) / 2,
            bullish: bar.close > bar.open + U.EPS,
            bearish: bar.close < bar.open - U.EPS,
            doji: body <= U.EPS
        };
    }

    /* ================================================================
     * Swing detection — the backbone of structure, SMC and chart patterns
     * ================================================================ */

    /**
     * Fractal swing detection with an ATR significance filter.
     *
     * A bar is a swing high when its high strictly exceeds the highs of the
     * `lookback` bars on BOTH sides. This means a swing is only confirmed
     * `lookback` bars after it forms — the detector therefore never revises an
     * already-emitted swing, which is what makes the structure non-repainting.
     * The unavoidable cost is a `lookback`-bar detection lag; it is reported as
     * `confirmationLag` so downstream stages can account for it.
     *
     * @returns {Array} swings ordered by bar index, each
     *   { index, type:'high'|'low', price, time, prominence, confirmedAtIndex }
     */
    function findSwings(bars, lookback, atr, minAtrMultiple) {
        var swings = [];
        var n = bars.length;
        if (n < lookback * 2 + 1) return swings;

        for (var i = lookback; i < n - lookback; i++) {
            var isHigh = true, isLow = true;
            for (var k = 1; k <= lookback; k++) {
                if (bars[i].high <= bars[i - k].high || bars[i].high <= bars[i + k].high) isHigh = false;
                if (bars[i].low >= bars[i - k].low || bars[i].low >= bars[i + k].low) isLow = false;
                if (!isHigh && !isLow) break;
            }
            if (!isHigh && !isLow) continue;

            // Significance filter: the swing must project beyond the local range
            // by a minimum fraction of ATR, so noise does not create structure.
            var localAtr = U.isFiniteNumber(atr[i]) ? atr[i] : NaN;
            var prominence;
            if (isHigh) {
                var maxNeighbour = -Infinity;
                for (var a = i - lookback; a <= i + lookback; a++) {
                    if (a !== i && bars[a].high > maxNeighbour) maxNeighbour = bars[a].high;
                }
                prominence = bars[i].high - maxNeighbour;
            } else {
                var minNeighbour = Infinity;
                for (var b = i - lookback; b <= i + lookback; b++) {
                    if (b !== i && bars[b].low < minNeighbour) minNeighbour = bars[b].low;
                }
                prominence = minNeighbour - bars[i].low;
            }

            if (U.isFiniteNumber(localAtr) && localAtr > U.EPS &&
                prominence < localAtr * minAtrMultiple) {
                continue;
            }

            swings.push({
                index: i,
                type: isHigh ? 'high' : 'low',
                price: isHigh ? bars[i].high : bars[i].low,
                time: bars[i].time,
                prominence: prominence,
                atr: localAtr,
                confirmedAtIndex: i + lookback
            });
        }

        // A bar can qualify as both (inside a tight coil); keep the more prominent
        // reading so the alternating sequence stays well defined.
        return dedupeSwings(swings);
    }

    function dedupeSwings(swings) {
        var out = [];
        for (var i = 0; i < swings.length; i++) {
            if (out.length && out[out.length - 1].index === swings[i].index) {
                if (swings[i].prominence > out[out.length - 1].prominence) out[out.length - 1] = swings[i];
            } else {
                out.push(swings[i]);
            }
        }
        return out;
    }

    /**
     * Reduces a raw swing list to a strictly alternating high/low sequence.
     * Consecutive same-type swings are collapsed to the extreme one, which is
     * what makes HH/HL/LH/LL labelling unambiguous.
     */
    function alternate(swings) {
        var out = [];
        for (var i = 0; i < swings.length; i++) {
            var s = swings[i];
            if (!out.length) { out.push(s); continue; }
            var last = out[out.length - 1];
            if (last.type === s.type) {
                var replace = s.type === 'high' ? s.price > last.price : s.price < last.price;
                if (replace) out[out.length - 1] = s;
            } else {
                out.push(s);
            }
        }
        return out;
    }

    /* ================================================================
     * Analysis context
     * ================================================================ */

    /**
     * Builds every shared intermediate exactly once.
     * Detectors receive this object and must not mutate it.
     */
    function buildContext(bars, indicators, cfg) {
        cfg = cfg || QT.CONFIG;
        var s = cfg.structure;
        var atr = indicators.atr;

        var anat = new Array(bars.length);
        for (var i = 0; i < bars.length; i++) anat[i] = anatomy(bars[i]);

        // Two resolutions: minor swings drive internal structure, major swings
        // drive external/swing structure (D1's HTF-bias principle in miniature).
        var minorRaw = findSwings(bars, s.swingLookback, atr, s.minSwingAtrMultiple);
        var majorRaw = findSwings(bars, s.swingLookback * 2, atr, s.minSwingAtrMultiple * 1.5);

        var lastIdx = bars.length - 1;
        var lastAtr = U.lastFinite(atr);

        return {
            bars: bars,
            indicators: indicators,
            config: cfg,
            anatomy: anat,
            lastIndex: lastIdx,
            lastBar: bars[lastIdx],
            atr: atr,
            lastAtr: U.isFiniteNumber(lastAtr) ? lastAtr : 0,
            swings: {
                minorRaw: minorRaw,
                majorRaw: majorRaw,
                minor: alternate(minorRaw),
                major: alternate(majorRaw)
            },
            confirmationLag: { minor: s.swingLookback, major: s.swingLookback * 2 },
            rejections: []
        };
    }

    /* ================================================================
     * Detector registry
     * ================================================================ */

    /**
     * Central registry. Detectors register themselves; the orchestrator runs
     * whatever is enabled. Adding a detector never requires touching the engine.
     */
    function Registry() {
        this.detectors = [];
    }

    /**
     * @param {Object} def
     * @param {string} def.id        unique id, also the config key for toggles
     * @param {string} def.category  one of CATEGORY
     * @param {number} def.weight    relative weight inside its category
     * @param {Function} def.detect  (ctx) => Detection[] (may be empty)
     */
    Registry.prototype.register = function (def) {
        if (!def || !def.id || typeof def.detect !== 'function') {
            throw new Error('Registry.register requires { id, category, detect }');
        }
        if (this.detectors.some(function (d) { return d.id === def.id; })) {
            throw new Error('Duplicate detector id: ' + def.id);
        }
        this.detectors.push({
            id: def.id,
            category: def.category,
            weight: def.weight === undefined ? 1 : def.weight,
            minBars: def.minBars || 0,
            requires: def.requires || [],
            detect: def.detect
        });
        return this;
    };

    Registry.prototype.get = function (id) {
        return this.detectors.filter(function (d) { return d.id === id; })[0] || null;
    };

    Registry.prototype.byCategory = function (category) {
        return this.detectors.filter(function (d) { return d.category === category; });
    };

    /**
     * Runs every enabled detector against the context.
     * Detector failures are contained: one broken detector cannot abort the pass.
     */
    Registry.prototype.run = function (ctx) {
        var cfg = ctx.config.patterns;
        var enabled = cfg.detectors || {};
        var results = [];
        var errors = [];
        var skipped = [];

        for (var i = 0; i < this.detectors.length; i++) {
            var d = this.detectors[i];
            var setting = enabled[d.id];

            if (setting && setting.enabled === false) {
                skipped.push({ id: d.id, reason: 'disabled by configuration' });
                continue;
            }
            if (ctx.bars.length < d.minBars) {
                skipped.push({ id: d.id, reason: 'needs ' + d.minBars + ' bars, have ' + ctx.bars.length });
                continue;
            }
            var missingCap = d.requires.filter(function (cap) {
                return !ctx.capabilities || ctx.capabilities[cap] !== true;
            });
            if (missingCap.length) {
                skipped.push({ id: d.id, reason: 'requires unavailable capability: ' + missingCap.join(', ') });
                continue;
            }

            try {
                var found = d.detect(ctx) || [];
                for (var j = 0; j < found.length; j++) {
                    found[j].detectorId = d.id;
                    found[j].detectorWeight = (setting && U.isFiniteNumber(setting.weight))
                                              ? setting.weight : d.weight;
                    results.push(found[j]);
                }
            } catch (err) {
                errors.push({ id: d.id, message: err && err.message ? err.message : String(err) });
            }
        }

        results.sort(function (a, b) {
            return (b.barIndex - a.barIndex) || (b.score - a.score);
        });

        return { detections: results, skipped: skipped, errors: errors, rejections: ctx.rejections };
    };

    QT.detection = {
        BIAS: BIAS,
        CATEGORY: CATEGORY,
        makeDetection: makeDetection,
        makeRejection: makeRejection,
        anatomy: anatomy,
        findSwings: findSwings,
        alternate: alternate,
        dedupeSwings: dedupeSwings,
        buildContext: buildContext,
        Registry: Registry,
        clamp01: clamp01
    };

})(typeof globalThis !== 'undefined' ? globalThis : this);

if (typeof module !== 'undefined' && module.exports) {
    module.exports = (typeof globalThis !== 'undefined' ? globalThis : this).QT.detection;
}
