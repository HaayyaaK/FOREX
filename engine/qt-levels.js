/**
 * qt-levels.js — Support/Resistance and Fibonacci engines.
 *
 * These sit between market structure (Phase 3/4) and risk construction (Phase 5):
 * the risk engine places stops and targets at evidence-backed price levels rather
 * than at arbitrary multiples, and those levels come from here.
 *
 * Both engines are pure functions of the bar series and the shared swing set —
 * no clock, no randomness, no recalculation of anything an earlier phase produced.
 */
(function (root) {
    'use strict';

    var QT = root.QT = root.QT || {};
    var U = QT.utils;

    var L = {};

    /* ================================================================
     * SUPPORT & RESISTANCE
     *
     * Swing points are clustered into horizontal levels: two swings belong to
     * the same level when they lie within `srClusterAtrMultiple × ATR` of each
     * other. Level strength combines three measurable factors:
     *
     *   touches   — how many independent swings formed at the level
     *   recency   — how recently it was last respected (exponential decay)
     *   reaction  — the average size of the move away from the level, in ATR
     *
     * A level is classified support or resistance by its position relative to
     * the current close, not by the swing type that formed it: broken support
     * becoming resistance is the normal case and is handled by that rule.
     * ================================================================ */
    L.supportResistance = function (bars, swings, atr, cfg) {
        var s = cfg.structure;
        var lastIdx = bars.length - 1;
        if (!bars.length || !swings.length || !(atr > U.EPS)) {
            // `nearest` keeps its object shape so consumers never need a null check.
            return { levels: [], support: [], resistance: [],
                     nearest: { support: null, resistance: null },
                     tolerance: 0, close: bars.length ? bars[bars.length - 1].close : NaN };
        }

        var tolerance = atr * s.srClusterAtrMultiple;
        var clusters = [];

        for (var i = 0; i < swings.length; i++) {
            var sw = swings[i];
            var placed = false;
            for (var c = 0; c < clusters.length; c++) {
                if (Math.abs(clusters[c].price - sw.price) <= tolerance) {
                    // Running mean keeps the level centred on all its touches.
                    var n = clusters[c].members.length;
                    clusters[c].price = (clusters[c].price * n + sw.price) / (n + 1);
                    clusters[c].members.push(sw);
                    placed = true;
                    break;
                }
            }
            if (!placed) clusters.push({ price: sw.price, members: [sw] });
        }

        var levels = clusters
            .filter(function (cl) { return cl.members.length >= s.srMinTouches; })
            .map(function (cl) {
                var lastTouch = cl.members[cl.members.length - 1];
                var barsAgo = lastIdx - lastTouch.index;

                // Reaction size: how far price travelled away from the level.
                var reactions = cl.members.map(function (m) {
                    var to = Math.min(bars.length - 1, m.index + s.swingLookback * 2);
                    return Math.abs(bars[to].close - m.price) / atr;
                });
                var avgReaction = U.mean(reactions);

                var touchScore = U.clamp((cl.members.length - 1) / 3, 0, 1);
                var recencyScore = Math.exp(-barsAgo / cfg.levels.recencyHalfLifeBars);
                var reactionScore = U.clamp(avgReaction / cfg.levels.strongReactionAtr, 0, 1);

                var strength = U.clamp(
                    cfg.levels.touchWeight * touchScore +
                    cfg.levels.recencyWeight * recencyScore +
                    cfg.levels.reactionWeight * reactionScore, 0, 1);

                var price = bars[lastIdx].close;
                return {
                    price: cl.price,
                    kind: cl.price < price ? 'support' : 'resistance',
                    touches: cl.members.length,
                    lastTouchIndex: lastTouch.index,
                    barsSinceTouch: barsAgo,
                    avgReactionAtr: avgReaction,
                    strength: strength,
                    distance: Math.abs(price - cl.price),
                    distanceAtr: Math.abs(price - cl.price) / atr,
                    members: cl.members.map(function (m) { return m.index; }),
                    evidence: [
                        cl.members.length + ' swing touches',
                        'last respected ' + barsAgo + ' bars ago',
                        'average reaction ' + avgReaction.toFixed(2) + ' ATR'
                    ]
                };
            })
            .sort(function (a, b) { return b.strength - a.strength; })
            .slice(0, s.srMaxLevels * 2);

        var close = bars[lastIdx].close;
        var support = levels.filter(function (l) { return l.kind === 'support'; })
                            .sort(function (a, b) { return b.price - a.price; });
        var resistance = levels.filter(function (l) { return l.kind === 'resistance'; })
                               .sort(function (a, b) { return a.price - b.price; });

        return {
            levels: levels,
            support: support.slice(0, cfg.structure.srMaxLevels),
            resistance: resistance.slice(0, cfg.structure.srMaxLevels),
            nearest: {
                support: support[0] || null,
                resistance: resistance[0] || null
            },
            tolerance: tolerance,
            close: close
        };
    };

    /* ================================================================
     * FIBONACCI
     *
     * The dominant leg is the most recent impulse between two alternating
     * swings whose span is the largest in the recent window — measured in ATR
     * so the choice is scale-free. Retracements are drawn on that leg;
     * extensions and expansions project beyond it.
     * ================================================================ */
    L.dominantLeg = function (swings, atr, cfg) {
        if (swings.length < 2 || !(atr > U.EPS)) return null;
        var window = swings.slice(-cfg.levels.fibSwingWindow);
        var best = null;

        for (var i = 1; i < window.length; i++) {
            var a = window[i - 1], b = window[i];
            if (a.type === b.type) continue;
            var span = Math.abs(b.price - a.price);
            var spanAtr = span / atr;
            if (spanAtr < cfg.levels.fibMinLegAtr) continue;
            // Prefer the most recent leg, tie-broken by size.
            var score = spanAtr + (i / window.length) * cfg.levels.fibRecencyBonus;
            if (!best || score > best.score) {
                best = { from: a, to: b, span: span, spanAtr: spanAtr,
                         direction: b.price > a.price ? 'up' : 'down', score: score };
            }
        }
        return best;
    };

    L.fibonacci = function (bars, swings, atr, cfg) {
        var leg = L.dominantLeg(swings, atr, cfg);
        if (!leg) return { available: false, reason: 'no impulse leg of sufficient size', levels: [] };

        var f = cfg.fibonacci;
        var isUp = leg.direction === 'up';
        var low = isUp ? leg.from.price : leg.to.price;
        var high = isUp ? leg.to.price : leg.from.price;
        var span = high - low;
        var close = bars[bars.length - 1].close;

        var levels = [];

        // Retracements are measured back from the end of the leg.
        f.retracements.forEach(function (r) {
            var price = isUp ? high - span * r : low + span * r;
            levels.push({
                type: 'retracement', ratio: r, price: price,
                label: (r * 100).toFixed(1) + '% retracement',
                inGoldenZone: r >= f.goldenZone[0] && r <= f.goldenZone[1],
                distanceAtr: Math.abs(close - price) / atr
            });
        });

        // Extensions project beyond the leg in its own direction.
        f.extensions.forEach(function (e) {
            var price = isUp ? low + span * e : high - span * e;
            levels.push({
                type: 'extension', ratio: e, price: price,
                label: (e * 100).toFixed(1) + '% extension',
                inGoldenZone: false,
                distanceAtr: Math.abs(close - price) / atr
            });
        });

        // Expansions project from the retracement origin.
        f.expansions.forEach(function (x) {
            var price = isUp ? high + span * x : low - span * x;
            levels.push({
                type: 'expansion', ratio: x, price: price,
                label: (x * 100).toFixed(1) + '% expansion',
                inGoldenZone: false,
                distanceAtr: Math.abs(close - price) / atr
            });
        });

        var currentRetracement = span > U.EPS
            ? (isUp ? (high - close) / span : (close - low) / span)
            : NaN;

        return {
            available: true,
            direction: leg.direction,
            leg: { fromIndex: leg.from.index, toIndex: leg.to.index,
                   fromPrice: leg.from.price, toPrice: leg.to.price,
                   span: span, spanAtr: leg.spanAtr },
            high: high, low: low,
            levels: levels,
            goldenZone: {
                from: isUp ? high - span * f.goldenZone[1] : low + span * f.goldenZone[0],
                to: isUp ? high - span * f.goldenZone[0] : low + span * f.goldenZone[1]
            },
            currentRetracement: currentRetracement,
            inGoldenZone: U.isFiniteNumber(currentRetracement) &&
                          currentRetracement >= f.goldenZone[0] &&
                          currentRetracement <= f.goldenZone[1]
        };
    };

    /**
     * Confluence: price zones where a Fibonacci level and a structural level
     * coincide within tolerance. These are the highest-quality target and stop
     * anchors because two independent methods agree on them.
     */
    L.confluence = function (fib, sr, atr, cfg) {
        if (!fib.available || !sr.levels.length || !(atr > U.EPS)) return [];
        var tol = atr * cfg.fibonacci.confluenceAtrMultiple;
        var out = [];

        fib.levels.forEach(function (fl) {
            sr.levels.forEach(function (sl) {
                if (Math.abs(fl.price - sl.price) <= tol) {
                    out.push({
                        price: (fl.price + sl.price) / 2,
                        fibRatio: fl.ratio,
                        fibType: fl.type,
                        srStrength: sl.strength,
                        srTouches: sl.touches,
                        kind: sl.kind,
                        strength: U.clamp(0.5 + 0.5 * sl.strength, 0, 1),
                        evidence: [fl.label + ' coincides with a ' + sl.kind +
                                   ' level tested ' + sl.touches + ' times']
                    });
                }
            });
        });

        return out.sort(function (a, b) { return b.strength - a.strength; });
    };

    /** Convenience wrapper producing the whole level picture in one call. */
    L.analyze = function (bars, swings, atr, cfg) {
        cfg = cfg || QT.CONFIG;
        var sr = L.supportResistance(bars, swings, atr, cfg);
        var fib = L.fibonacci(bars, swings, atr, cfg);
        return { supportResistance: sr, fibonacci: fib, confluence: L.confluence(fib, sr, atr, cfg) };
    };

    QT.levels = L;

})(typeof globalThis !== 'undefined' ? globalThis : this);

if (typeof module !== 'undefined' && module.exports) {
    module.exports = (typeof globalThis !== 'undefined' ? globalThis : this).QT.levels;
}
