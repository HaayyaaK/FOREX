/**
 * qt-patterns.js — Phase 3 orchestrator.
 *
 * Wires every detector module into one registry and exposes a single entry
 * point, `analyze(bars, indicators, options)`, returning a structured pattern
 * report that the trend, structure, scoring, recommendation and explainability
 * engines all consume.
 *
 * Performance: shared intermediates (candle anatomy, swings, ATR) are computed
 * once in `buildContext`; each detector then runs a bounded scan over the most
 * recent `patterns.scanBars` bars, so a full pass is linear in bar count.
 */
(function (root) {
    'use strict';

    var QT = root.QT = root.QT || {};
    var U = QT.utils;
    var D = QT.detection;

    /** Registry is built once at load and reused across analyses. */
    var registry = new D.Registry();

    function registerAll() {
        [QT.candles, QT.structure, QT.chartPatterns].forEach(function (mod) {
            if (!mod || !mod.detectors) return;
            mod.detectors.forEach(function (def) { registry.register(def); });
        });
    }
    registerAll();

    /**
     * Runs the full pattern pass.
     *
     * @param {Array}  bars        canonical OHLCV, ascending, completed bars only
     * @param {Object} indicators  output of QT.indicators.computeAll
     * @param {Object} [options]
     * @param {Object} [options.config]        config override (defaults to QT.CONFIG)
     * @param {Object} [options.capabilities]  e.g. { ohlc:true, volume:false }
     * @returns {Object} pattern report
     */
    function analyze(bars, indicators, options) {
        options = options || {};
        var cfg = options.config || QT.CONFIG;

        if (!Array.isArray(bars) || bars.length === 0) {
            return emptyReport('no bars supplied');
        }

        var ctx = D.buildContext(bars, indicators, cfg);
        ctx.capabilities = options.capabilities || { ohlc: true, volume: !!indicators.meta.hasVolume };

        var run = registry.run(ctx);
        var detections = run.detections;

        /* ---- Aggregate views ------------------------------------- */
        var byCategory = {};
        var byBias = { bullish: [], bearish: [], neutral: [] };
        var active = [];

        detections.forEach(function (d) {
            (byCategory[d.category] = byCategory[d.category] || []).push(d);
            byBias[d.bias].push(d);
            if (!d.invalidated) active.push(d);
        });

        /* ---- Net bias ---------------------------------------------
         * Weighted by score × detector weight, with a recency decay so a
         * pattern 80 bars ago cannot outvote one that just completed. */
        var bullWeight = 0, bearWeight = 0;
        active.forEach(function (d) {
            if (d.bias === D.BIAS.NEUTRAL) return;
            var recency = Math.exp(-(d.barsAgo || 0) / cfg.patterns.candleExpiryBars / 4);
            var w = d.score * (d.detectorWeight || 1) * recency;
            d.effectiveWeight = w;
            if (d.bias === D.BIAS.BULLISH) bullWeight += w; else bearWeight += w;
        });
        var total = bullWeight + bearWeight;
        var netBias = total > U.EPS ? (bullWeight - bearWeight) / total : 0;

        /* ---- Structural summary (consumed by the Trend engine) ---- */
        var labelled = QT.structure.labelSwings(ctx.swings.major.length ? ctx.swings.major : ctx.swings.minor);
        var state = QT.structure.structuralBias(labelled);

        return {
            ok: true,
            barCount: bars.length,
            lastBarTime: ctx.lastBar.time,
            capabilities: ctx.capabilities,

            detections: detections,
            active: active,
            byCategory: byCategory,
            byBias: byBias,

            summary: {
                total: detections.length,
                activeCount: active.length,
                invalidated: detections.length - active.length,
                bullish: byBias.bullish.length,
                bearish: byBias.bearish.length,
                neutral: byBias.neutral.length,
                netBias: netBias,
                bullWeight: bullWeight,
                bearWeight: bearWeight,
                dominant: netBias > 0.15 ? D.BIAS.BULLISH
                        : netBias < -0.15 ? D.BIAS.BEARISH : D.BIAS.NEUTRAL
            },

            structure: {
                bias: state.bias,
                lastSwingHigh: state.lastHigh ? state.lastHigh.price : null,
                lastSwingLow: state.lastLow ? state.lastLow.price : null,
                labelledSwings: labelled.slice(-8).map(function (s) {
                    return { index: s.index, type: s.type, label: s.label, price: s.price };
                }),
                swingCounts: { major: ctx.swings.major.length, minor: ctx.swings.minor.length },
                confirmationLag: ctx.confirmationLag
            },

            /* Diagnostics for the traceability + explainability requirements. */
            diagnostics: {
                skipped: run.skipped,
                errors: run.errors,
                rejections: run.rejections,
                detectorsRun: registry.detectors.length - run.skipped.length
            }
        };
    }

    function emptyReport(reason) {
        return {
            ok: false, reason: reason, barCount: 0, lastBarTime: null,
            capabilities: {}, detections: [], active: [], byCategory: {},
            byBias: { bullish: [], bearish: [], neutral: [] },
            summary: { total: 0, activeCount: 0, invalidated: 0, bullish: 0, bearish: 0,
                       neutral: 0, netBias: 0, bullWeight: 0, bearWeight: 0, dominant: D.BIAS.NEUTRAL },
            structure: { bias: D.BIAS.NEUTRAL, lastSwingHigh: null, lastSwingLow: null,
                         labelledSwings: [], swingCounts: { major: 0, minor: 0 }, confirmationLag: null },
            diagnostics: { skipped: [], errors: [], rejections: [], detectorsRun: 0 }
        };
    }

    QT.patterns = {
        registry: registry,
        analyze: analyze,
        /** Exposed so tests and future phases can register additional detectors. */
        register: function (def) { return registry.register(def); },
        listDetectors: function () {
            return registry.detectors.map(function (d) {
                return { id: d.id, category: d.category, weight: d.weight, minBars: d.minBars };
            });
        }
    };

})(typeof globalThis !== 'undefined' ? globalThis : this);

if (typeof module !== 'undefined' && module.exports) {
    module.exports = (typeof globalThis !== 'undefined' ? globalThis : this).QT.patterns;
}
