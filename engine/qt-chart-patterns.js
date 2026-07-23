/**
 * qt-chart-patterns.js — Phase 3: multi-swing chart formations.
 *
 * All formations are derived from the shared swing sequence, so no bar is
 * re-scanned per pattern. Trendlines are least-squares fits over swing points;
 * "flat" versus "sloping" is decided by comparing the fitted slope, expressed in
 * ATR per bar, against `flatSlopeAtrPerBar` — a scale-free test that behaves the
 * same on BTC at 60,000 and EUR/USD at 1.08.
 *
 * Every pattern reports `completed`, `confirmed` and `invalidated` separately:
 *   completed   — the geometry is fully formed
 *   confirmed   — price has closed beyond the trigger level (neckline / boundary)
 *   invalidated — price violated the structure that defines the pattern
 */
(function (root) {
    'use strict';

    var QT = root.QT = root.QT || {};
    var U = QT.utils;
    var D = QT.detection;

    /** Least-squares fit of price against bar index. Returns slope + intercept + R². */
    function fitLine(points) {
        var n = points.length;
        if (n < 2) return null;
        var sx = 0, sy = 0, sxx = 0, sxy = 0;
        for (var i = 0; i < n; i++) { sx += points[i].x; sy += points[i].y; sxx += points[i].x * points[i].x; sxy += points[i].x * points[i].y; }
        var denom = n * sxx - sx * sx;
        if (Math.abs(denom) < U.EPS) return null;
        var slope = (n * sxy - sx * sy) / denom;
        var intercept = (sy - slope * sx) / n;

        var meanY = sy / n, ssTot = 0, ssRes = 0;
        for (var j = 0; j < n; j++) {
            var pred = slope * points[j].x + intercept;
            ssTot += Math.pow(points[j].y - meanY, 2);
            ssRes += Math.pow(points[j].y - pred, 2);
        }
        return { slope: slope, intercept: intercept,
                 r2: ssTot > U.EPS ? 1 - ssRes / ssTot : 1,
                 at: function (x) { return slope * x + intercept; } };
    }

    function isFlat(slope, atr, p) { return Math.abs(slope) <= atr * p.flatSlopeAtrPerBar; }

    function detection(ctx, spec) {
        return D.makeDetection(Object.assign({
            category: D.CATEGORY.CHART,
            quality: 1,
            time: ctx.bars[spec.barIndex] ? ctx.bars[spec.barIndex].time : null,
            barsAgo: ctx.lastIndex - spec.barIndex
        }, spec));
    }

    var P = {};

    /* ================================================================
     * DOUBLE TOP / DOUBLE BOTTOM
     *   Two same-type swings within `doubleTopTolerance` (fraction of price),
     *   separated by an opposing swing (the neckline).
     *   Confirmed on a close beyond the neckline.
     * ================================================================ */
    P.doubleTopBottom = function (ctx) {
        var out = [], p = ctx.config.patterns;
        var sw = ctx.swings.minor;
        if (sw.length < 3) return out;

        for (var i = 2; i < sw.length; i++) {
            var a = sw[i - 2], mid = sw[i - 1], b = sw[i];
            if (a.type !== b.type || mid.type === a.type) continue;
            if (ctx.lastIndex - b.index > p.scanBars) continue;

            var diff = Math.abs(a.price - b.price);
            var tol = Math.abs(a.price) * p.doubleTopTolerance;
            if (diff > tol) continue;

            var isTop = a.type === 'high';
            var neckline = mid.price;
            var height = Math.abs((a.price + b.price) / 2 - neckline);
            if (!(height > U.EPS)) continue;

            // Confirmation: a close beyond the neckline after the second peak.
            var confirmed = false, confirmIdx = -1, invalidated = false;
            for (var k = b.index + 1; k <= ctx.lastIndex; k++) {
                if (isTop && ctx.bars[k].close < neckline - U.EPS) { confirmed = true; confirmIdx = k; break; }
                if (!isTop && ctx.bars[k].close > neckline + U.EPS) { confirmed = true; confirmIdx = k; break; }
                // Breaking beyond the peaks invalidates the reversal thesis.
                if (isTop && ctx.bars[k].close > Math.max(a.price, b.price) + U.EPS) { invalidated = true; break; }
                if (!isTop && ctx.bars[k].close < Math.min(a.price, b.price) - U.EPS) { invalidated = true; break; }
            }

            var symmetry = 1 - diff / Math.max(tol, U.EPS);
            out.push(detection(ctx, {
                id: isTop ? 'double_top' : 'double_bottom',
                name: isTop ? 'Double Top' : 'Double Bottom',
                bias: isTop ? D.BIAS.BEARISH : D.BIAS.BULLISH,
                confidence: D.clamp01(0.45 + 0.3 * symmetry + (confirmed ? 0.2 : 0)),
                strength: D.clamp01(height / Math.max(ctx.lastAtr * 3, U.EPS)),
                barIndex: confirmed ? confirmIdx : b.index,
                barRange: [a.index, confirmed ? confirmIdx : b.index],
                priceRange: { high: Math.max(a.price, b.price, neckline), low: Math.min(a.price, b.price, neckline) },
                completed: true,
                confirmed: confirmed,
                invalidated: invalidated,
                requiredConfirmation: confirmed ? [] :
                    ['close ' + (isTop ? 'below' : 'above') + ' the neckline at ' + U.formatPrice(neckline)],
                expiration: { type: 'price', value: 'invalidated beyond ' +
                              U.formatPrice(isTop ? Math.max(a.price, b.price) : Math.min(a.price, b.price)) },
                evidence: {
                    satisfied: ['two swing ' + a.type + 's within ' +
                                (diff / Math.abs(a.price) * 100).toFixed(2) + '% (tolerance ' +
                                (p.doubleTopTolerance * 100).toFixed(1) + '%)',
                                'separated by a neckline at ' + U.formatPrice(neckline)]
                        .concat(confirmed ? ['neckline broken on close'] : []),
                    missing: confirmed ? [] : ['neckline not yet broken'],
                    conflicting: invalidated ? ['price broke beyond the peaks — pattern void'] : []
                },
                metrics: { peakA: a.price, peakB: b.price, neckline: neckline, height: height,
                           symmetry: symmetry, projectedTarget: isTop ? neckline - height : neckline + height },
                why: (isTop ? 'Double Top' : 'Double Bottom') + ': twin ' + a.type + 's at ' +
                     U.formatPrice(a.price) + ' / ' + U.formatPrice(b.price) + ', neckline ' +
                     U.formatPrice(neckline) + (confirmed ? ' — broken' : ' — awaiting break')
            }));
        }
        return out;
    };

    /* ================================================================
     * HEAD AND SHOULDERS / INVERSE
     *   Five swings L-S-H-S-R where the head exceeds both shoulders and the
     *   shoulders match within `headShouldersTolerance`.
     * ================================================================ */
    P.headShoulders = function (ctx) {
        var out = [], p = ctx.config.patterns;
        var sw = ctx.swings.minor;
        if (sw.length < 5) return out;

        for (var i = 4; i < sw.length; i++) {
            var s1 = sw[i - 4], t1 = sw[i - 3], head = sw[i - 2], t2 = sw[i - 1], s2 = sw[i];
            if (s1.type !== head.type || head.type !== s2.type) continue;
            if (t1.type === head.type || t2.type === head.type) continue;
            if (ctx.lastIndex - s2.index > p.scanBars) continue;

            var isTop = head.type === 'high';
            var headDominant = isTop ? (head.price > s1.price && head.price > s2.price)
                                     : (head.price < s1.price && head.price < s2.price);
            if (!headDominant) continue;

            var shoulderDiff = Math.abs(s1.price - s2.price);
            var shoulderTol = Math.abs(head.price) * p.headShouldersTolerance;
            if (shoulderDiff > shoulderTol) continue;

            var neckline = (t1.price + t2.price) / 2;
            var height = Math.abs(head.price - neckline);
            if (!(height > U.EPS)) continue;

            var confirmed = false, confirmIdx = -1, invalidated = false;
            for (var k = s2.index + 1; k <= ctx.lastIndex; k++) {
                if (isTop && ctx.bars[k].close < neckline - U.EPS) { confirmed = true; confirmIdx = k; break; }
                if (!isTop && ctx.bars[k].close > neckline + U.EPS) { confirmed = true; confirmIdx = k; break; }
                if (isTop && ctx.bars[k].close > head.price + U.EPS) { invalidated = true; break; }
                if (!isTop && ctx.bars[k].close < head.price - U.EPS) { invalidated = true; break; }
            }

            var symmetry = 1 - shoulderDiff / Math.max(shoulderTol, U.EPS);
            out.push(detection(ctx, {
                id: isTop ? 'head_and_shoulders' : 'inverse_head_and_shoulders',
                name: isTop ? 'Head and Shoulders' : 'Inverse Head and Shoulders',
                bias: isTop ? D.BIAS.BEARISH : D.BIAS.BULLISH,
                confidence: D.clamp01(0.5 + 0.25 * symmetry + (confirmed ? 0.2 : 0)),
                strength: D.clamp01(height / Math.max(ctx.lastAtr * 3, U.EPS)),
                barIndex: confirmed ? confirmIdx : s2.index,
                barRange: [s1.index, confirmed ? confirmIdx : s2.index],
                priceRange: { high: Math.max(head.price, neckline), low: Math.min(head.price, neckline) },
                completed: true,
                confirmed: confirmed,
                invalidated: invalidated,
                requiredConfirmation: confirmed ? [] :
                    ['close ' + (isTop ? 'below' : 'above') + ' the neckline at ' + U.formatPrice(neckline)],
                expiration: { type: 'price', value: 'invalidated beyond the head at ' + U.formatPrice(head.price) },
                evidence: {
                    satisfied: ['head at ' + U.formatPrice(head.price) + ' exceeds both shoulders',
                                'shoulders within ' + (shoulderDiff / Math.abs(head.price) * 100).toFixed(2) + '%',
                                'neckline at ' + U.formatPrice(neckline)]
                        .concat(confirmed ? ['neckline broken on close'] : []),
                    missing: confirmed ? [] : ['neckline not yet broken'],
                    conflicting: invalidated ? ['price exceeded the head — pattern void'] : []
                },
                metrics: { leftShoulder: s1.price, head: head.price, rightShoulder: s2.price,
                           neckline: neckline, height: height, symmetry: symmetry,
                           projectedTarget: isTop ? neckline - height : neckline + height },
                why: (isTop ? 'Head and Shoulders' : 'Inverse Head and Shoulders') + ': head ' +
                     U.formatPrice(head.price) + ' between shoulders ' + U.formatPrice(s1.price) +
                     ' / ' + U.formatPrice(s2.price) + (confirmed ? ', neckline broken' : ', awaiting neckline break')
            }));
        }
        return out;
    };

    /* ================================================================
     * TRIANGLES / WEDGES / RECTANGLE / CHANNEL
     *
     * Classified from the fitted slopes of the swing-high and swing-low lines:
     *   flat highs  + rising lows  -> Ascending Triangle   (bullish)
     *   falling highs + flat lows  -> Descending Triangle  (bearish)
     *   converging opposite slopes -> Symmetrical Triangle (neutral)
     *   both up, converging        -> Rising Wedge         (bearish)
     *   both down, converging      -> Falling Wedge        (bullish)
     *   both flat                  -> Rectangle            (neutral)
     *   parallel, same direction   -> Channel              (trend-following)
     * ================================================================ */
    P.trendlineFormations = function (ctx) {
        var out = [], p = ctx.config.patterns;
        var sw = ctx.swings.minor;
        if (sw.length < p.trendlineMinSwings) return out;

        var recent = sw.slice(-p.trendlineSwingWindow);
        var highs = recent.filter(function (s) { return s.type === 'high'; })
                          .map(function (s) { return { x: s.index, y: s.price }; });
        var lows = recent.filter(function (s) { return s.type === 'low'; })
                         .map(function (s) { return { x: s.index, y: s.price }; });
        if (highs.length < 2 || lows.length < 2) return out;

        var hi = fitLine(highs), lo = fitLine(lows);
        if (!hi || !lo) return out;
        if (hi.r2 < p.trendlineMinR2 || lo.r2 < p.trendlineMinR2) return out;

        var atr = ctx.lastAtr;
        if (!(atr > U.EPS)) return out;

        var startIdx = recent[0].index, endIdx = ctx.lastIndex;
        var widthStart = hi.at(startIdx) - lo.at(startIdx);
        var widthEnd = hi.at(endIdx) - lo.at(endIdx);
        if (!(widthStart > U.EPS)) return out;
        var converging = widthEnd < widthStart * (1 - p.convergenceMinPct);
        var parallel = Math.abs(hi.slope - lo.slope) <= atr * p.flatSlopeAtrPerBar;

        var hiFlat = isFlat(hi.slope, atr, p);
        var loFlat = isFlat(lo.slope, atr, p);
        var hiUp = hi.slope > 0, loUp = lo.slope > 0;

        var id = null, name = null, bias = D.BIAS.NEUTRAL, rationale = '';
        if (hiFlat && !loFlat && loUp) {
            id = 'ascending_triangle'; name = 'Ascending Triangle'; bias = D.BIAS.BULLISH;
            rationale = 'flat resistance with rising support — buyers absorbing supply';
        } else if (loFlat && !hiFlat && !hiUp) {
            id = 'descending_triangle'; name = 'Descending Triangle'; bias = D.BIAS.BEARISH;
            rationale = 'flat support with falling resistance — sellers absorbing demand';
        } else if (hiFlat && loFlat) {
            id = 'rectangle'; name = 'Rectangle'; bias = D.BIAS.NEUTRAL;
            rationale = 'horizontal range between flat boundaries';
        } else if (converging && hiUp && loUp) {
            id = 'rising_wedge'; name = 'Rising Wedge'; bias = D.BIAS.BEARISH;
            rationale = 'both boundaries rising but converging — momentum decaying into the highs';
        } else if (converging && !hiUp && !loUp) {
            id = 'falling_wedge'; name = 'Falling Wedge'; bias = D.BIAS.BULLISH;
            rationale = 'both boundaries falling but converging — selling pressure decaying';
        } else if (converging && !hiUp && loUp) {
            id = 'symmetrical_triangle'; name = 'Symmetrical Triangle'; bias = D.BIAS.NEUTRAL;
            rationale = 'opposing boundaries converging — compression before expansion';
        } else if (parallel && !hiFlat) {
            id = hiUp ? 'ascending_channel' : 'descending_channel';
            name = hiUp ? 'Ascending Channel' : 'Descending Channel';
            bias = hiUp ? D.BIAS.BULLISH : D.BIAS.BEARISH;
            rationale = 'parallel boundaries in a sustained ' + (hiUp ? 'up' : 'down') + 'trend';
        }
        if (!id) return out;

        var upper = hi.at(endIdx), lower = lo.at(endIdx);
        var close = ctx.lastBar.close;
        var brokeUp = close > upper + U.EPS, brokeDown = close < lower - U.EPS;
        var confirmed = brokeUp || brokeDown;

        // A break against the pattern's own bias invalidates its thesis.
        var invalidated = (bias === D.BIAS.BULLISH && brokeDown) || (bias === D.BIAS.BEARISH && brokeUp);

        var compression = D.clamp01(1 - widthEnd / widthStart);
        var fitQuality = (hi.r2 + lo.r2) / 2;

        out.push(detection(ctx, {
            id: id, name: name,
            bias: confirmed ? (brokeUp ? D.BIAS.BULLISH : D.BIAS.BEARISH) : bias,
            confidence: D.clamp01(0.4 + 0.35 * fitQuality + (confirmed ? 0.2 : 0)),
            strength: D.clamp01(0.35 + 0.4 * compression + 0.25 * fitQuality),
            barIndex: endIdx,
            barRange: [startIdx, endIdx],
            priceRange: { high: Math.max(upper, lower), low: Math.min(upper, lower) },
            completed: converging || parallel || hiFlat || loFlat,
            confirmed: confirmed,
            invalidated: invalidated,
            requiredConfirmation: confirmed ? [] :
                ['close outside ' + U.formatPrice(lower) + '–' + U.formatPrice(upper)],
            expiration: { type: 'price', value: 'resolved on a close outside the boundaries' },
            evidence: {
                satisfied: ['upper trendline slope ' + hi.slope.toFixed(6) + '/bar (R² ' + hi.r2.toFixed(2) + ')',
                            'lower trendline slope ' + lo.slope.toFixed(6) + '/bar (R² ' + lo.r2.toFixed(2) + ')',
                            converging ? 'boundaries converging by ' + (compression * 100).toFixed(0) + '%'
                                       : (parallel ? 'boundaries parallel' : 'boundaries stable')]
                    .concat(confirmed ? ['price closed ' + (brokeUp ? 'above' : 'below') + ' the boundary'] : []),
                missing: confirmed ? [] : ['no boundary break yet'],
                conflicting: invalidated ? ['break opposes the formation bias'] : []
            },
            metrics: { upperSlope: hi.slope, lowerSlope: lo.slope, upperR2: hi.r2, lowerR2: lo.r2,
                       upperAt: upper, lowerAt: lower, widthStart: widthStart, widthEnd: widthEnd,
                       compression: compression, swingsUsed: recent.length },
            why: name + ': ' + rationale + (confirmed ? '; boundary broken ' + (brokeUp ? 'upward' : 'downward') : '')
        }));
        return out;
    };

    /* ================================================================
     * BULL / BEAR FLAG
     *   A strong impulse (>= flagPoleMinAtr × ATR over <= flagPoleMaxBars),
     *   followed by a shallow counter-trend drift that retraces less than
     *   flagMaxRetrace of the pole.
     * ================================================================ */
    P.flags = function (ctx) {
        var out = [], p = ctx.config.patterns;
        var n = ctx.bars.length;
        var atr = ctx.lastAtr;
        if (!(atr > U.EPS) || n < p.flagPoleMaxBars + p.flagMinBars + 2) return out;

        var scanFrom = Math.max(p.flagPoleMaxBars, n - p.scanBars);
        for (var poleEnd = scanFrom; poleEnd <= n - p.flagMinBars - 1; poleEnd++) {
            var poleStart = poleEnd - p.flagPoleMaxBars;
            if (poleStart < 0) continue;

            var move = ctx.bars[poleEnd].close - ctx.bars[poleStart].close;
            if (Math.abs(move) < atr * p.flagPoleMinAtr) continue;
            var bullish = move > 0;

            // Consolidation must drift against the pole and stay shallow.
            var consHigh = -Infinity, consLow = Infinity;
            for (var k = poleEnd + 1; k < n; k++) {
                if (ctx.bars[k].high > consHigh) consHigh = ctx.bars[k].high;
                if (ctx.bars[k].low < consLow) consLow = ctx.bars[k].low;
            }
            var consBars = n - 1 - poleEnd;
            if (consBars < p.flagMinBars) continue;

            var retrace = bullish
                ? (ctx.bars[poleEnd].close - consLow) / Math.abs(move)
                : (consHigh - ctx.bars[poleEnd].close) / Math.abs(move);
            if (!(retrace > 0) || retrace > p.flagMaxRetrace) continue;

            var breakout = bullish ? ctx.lastBar.close > consHigh - U.EPS
                                   : ctx.lastBar.close < consLow + U.EPS;

            out.push(detection(ctx, {
                id: bullish ? 'bull_flag' : 'bear_flag',
                name: bullish ? 'Bull Flag' : 'Bear Flag',
                bias: bullish ? D.BIAS.BULLISH : D.BIAS.BEARISH,
                confidence: D.clamp01(0.45 + 0.3 * (1 - retrace / p.flagMaxRetrace) + (breakout ? 0.2 : 0)),
                strength: D.clamp01(Math.abs(move) / (atr * p.flagPoleMinAtr * 2)),
                barIndex: n - 1,
                barRange: [poleStart, n - 1],
                priceRange: { high: consHigh, low: consLow },
                completed: true,
                confirmed: breakout,
                invalidated: retrace > p.flagMaxRetrace,
                requiredConfirmation: breakout ? [] :
                    ['close ' + (bullish ? 'above ' + U.formatPrice(consHigh) : 'below ' + U.formatPrice(consLow))],
                expiration: { type: 'price', value: 'void if retracement exceeds ' +
                              (p.flagMaxRetrace * 100).toFixed(0) + '% of the pole' },
                evidence: {
                    satisfied: ['pole of ' + (Math.abs(move) / atr).toFixed(2) + ' ATR over ' +
                                p.flagPoleMaxBars + ' bars',
                                'consolidation retraced only ' + (retrace * 100).toFixed(0) + '% of the pole',
                                consBars + ' bars of consolidation']
                        .concat(breakout ? ['price broke out of the consolidation'] : []),
                    missing: breakout ? [] : ['no breakout from the consolidation yet'],
                    conflicting: []
                },
                metrics: { poleSize: Math.abs(move), poleAtr: Math.abs(move) / atr, retrace: retrace,
                           consolidationBars: consBars, consHigh: consHigh, consLow: consLow,
                           projectedTarget: bullish ? consHigh + Math.abs(move) : consLow - Math.abs(move) },
                why: (bullish ? 'Bull' : 'Bear') + ' Flag: ' + (Math.abs(move) / atr).toFixed(1) +
                     ' ATR impulse followed by a shallow ' + (retrace * 100).toFixed(0) + '% pullback'
            }));
            break;   // report the most recent flag only
        }
        return out;
    };

    QT.chartPatterns = {
        detectors: [
            { id: 'double_top_bottom',   category: D.CATEGORY.CHART, weight: 1.5, minBars: 40,
              detect: P.doubleTopBottom },
            { id: 'head_shoulders',      category: D.CATEGORY.CHART, weight: 1.6, minBars: 60,
              detect: P.headShoulders },
            { id: 'trendline_formation', category: D.CATEGORY.CHART, weight: 1.3, minBars: 40,
              detect: P.trendlineFormations },
            { id: 'flag',                category: D.CATEGORY.CHART, weight: 1.3, minBars: 30,
              detect: P.flags }
        ],
        rules: P,
        fitLine: fitLine
    };

})(typeof globalThis !== 'undefined' ? globalThis : this);

if (typeof module !== 'undefined' && module.exports) {
    module.exports = (typeof globalThis !== 'undefined' ? globalThis : this).QT.chartPatterns;
}
