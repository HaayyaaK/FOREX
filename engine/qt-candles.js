/**
 * qt-candles.js — Phase 3: candlestick detectors.
 *
 * Every rule below is a deterministic inequality over candle anatomy. No fuzzy
 * heuristics, no visual interpretation. Notation for a bar:
 *
 *   range  = high − low
 *   body   = |close − open|
 *   bodyTop/bodyBottom = max/min(open, close)
 *   upperWick = high − bodyTop      lowerWick = bodyBottom − low
 *   bodyPct = body / range          (range guarded against zero)
 *
 * Tolerances come from config.patterns; nothing is hard-coded.
 * Detectors scan only the most recent `scanBars` candles: a pattern 300 bars ago
 * has no bearing on the current decision, and this keeps the pass linear.
 */
(function (root) {
    'use strict';

    var QT = root.QT = root.QT || {};
    var U = QT.utils;
    var D = QT.detection;

    /** Strength scales with how large the pattern is relative to recent ATR. */
    function atrStrength(size, atr) {
        if (!U.isFiniteNumber(atr) || atr <= U.EPS) return 0.5;
        return D.clamp01(size / (atr * 1.5));
    }

    /** Prior directional context, measured over `n` closed bars before `i`. */
    function priorTrend(ctx, i, n) {
        var bars = ctx.bars;
        var from = Math.max(0, i - n);
        if (i - from < 2) return 0;
        var change = bars[i - 1].close - bars[from].close;
        var atr = ctx.atr[i - 1];
        if (!U.isFiniteNumber(atr) || atr <= U.EPS) return 0;
        return U.clamp(change / (atr * n * 0.5), -1, 1);
    }

    function reject(ctx, id, name, idx, satisfied, missing) {
        if (ctx.config.patterns.collectRejections) {
            ctx.rejections.push(D.makeRejection(id, name, idx, satisfied, missing));
        }
    }

    function scanRange(ctx) {
        var p = ctx.config.patterns;
        var start = Math.max(2, ctx.bars.length - p.scanBars);
        return { start: start, end: ctx.bars.length - 1 };
    }

    function base(ctx, i, extra) {
        return {
            barIndex: i,
            barsAgo: ctx.lastIndex - i,
            time: ctx.bars[i].time,
            priceRange: { high: ctx.bars[i].high, low: ctx.bars[i].low },
            quality: extra && extra.quality !== undefined ? extra.quality : 1
        };
    }

    var C = {};

    /* ================================================================
     * ENGULFING
     *   Bullish: prev bearish, curr bullish,
     *            curr.bodyBottom <= prev.bodyBottom AND curr.bodyTop >= prev.bodyTop
     *            AND curr.body >= engulfingMinRatio × prev.body
     * ================================================================ */
    C.engulfing = function (ctx) {
        var out = [], r = scanRange(ctx), p = ctx.config.patterns;
        for (var i = Math.max(1, r.start); i <= r.end; i++) {
            var a = ctx.anatomy[i - 1], b = ctx.anatomy[i];
            var prev = ctx.bars[i - 1], cur = ctx.bars[i];
            if (a.body <= U.EPS || b.body <= U.EPS) continue;

            var engulfs = b.bodyBottom <= a.bodyBottom + U.EPS && b.bodyTop >= a.bodyTop - U.EPS;
            var ratio = b.body / a.body;
            var bigEnough = ratio >= p.engulfingMinRatio;

            var bullish = a.bearish && b.bullish && engulfs && bigEnough;
            var bearish = a.bullish && b.bearish && engulfs && bigEnough;
            if (!bullish && !bearish) {
                if (engulfs && !bigEnough) {
                    reject(ctx, 'engulfing', 'Engulfing', i,
                           ['body engulfs previous body'],
                           ['body ratio ' + ratio.toFixed(2) + ' < required ' + p.engulfingMinRatio]);
                }
                continue;
            }

            var trend = priorTrend(ctx, i, p.contextBars);
            // A reversal pattern means more when it reverses something.
            var contextBonus = bullish ? D.clamp01(-trend) : D.clamp01(trend);
            var satisfied = [
                'previous candle is ' + (bullish ? 'bearish' : 'bullish'),
                'current candle is ' + (bullish ? 'bullish' : 'bearish'),
                'current body fully engulfs previous body',
                'body ratio ' + ratio.toFixed(2) + ' >= ' + p.engulfingMinRatio
            ];
            var missing = [];
            if (contextBonus < 0.2) missing.push('little prior move to reverse');

            out.push(D.makeDetection(Object.assign(base(ctx, i), {
                id: bullish ? 'bullish_engulfing' : 'bearish_engulfing',
                name: (bullish ? 'Bullish' : 'Bearish') + ' Engulfing',
                category: D.CATEGORY.CANDLESTICK,
                bias: bullish ? D.BIAS.BULLISH : D.BIAS.BEARISH,
                confidence: D.clamp01(0.55 + 0.25 * Math.min(1, ratio - 1) + 0.2 * contextBonus),
                strength: atrStrength(b.body, ctx.atr[i]),
                barRange: [i - 1, i],
                priceRange: { high: Math.max(prev.high, cur.high), low: Math.min(prev.low, cur.low) },
                confirmed: false,
                requiredConfirmation: [(bullish ? 'close above ' : 'close below ') +
                                       U.formatPrice(bullish ? cur.high : cur.low)],
                expiration: { type: 'bars', value: p.candleExpiryBars },
                evidence: { satisfied: satisfied, missing: missing, conflicting: [] },
                metrics: { bodyRatio: ratio, body: b.body, priorTrend: trend },
                why: 'Current ' + (bullish ? 'bullish' : 'bearish') + ' body (' + b.body.toFixed(4) +
                     ') fully engulfs the previous body (' + a.body.toFixed(4) + '), ratio ' + ratio.toFixed(2)
            })));
        }
        return out;
    };

    /* ================================================================
     * PIN BAR / HAMMER / SHOOTING STAR
     *   Pin bar: dominantWick >= pinBarWickRatio × body AND bodyPct <= pinBarBodyMaxPct
     *   Hammer        = bullish pin bar after a decline (long LOWER wick)
     *   Shooting star = bearish pin bar after a rally  (long UPPER wick)
     * ================================================================ */
    C.pinBar = function (ctx) {
        var out = [], r = scanRange(ctx), p = ctx.config.patterns;
        for (var i = r.start; i <= r.end; i++) {
            var a = ctx.anatomy[i];
            if (a.range <= U.EPS) continue;

            var bodySmall = a.bodyPct <= p.pinBarBodyMaxPct;
            var lowerDominant = a.lowerWick >= p.pinBarWickRatio * Math.max(a.body, U.EPS) &&
                                a.lowerWick > a.upperWick * 2;
            var upperDominant = a.upperWick >= p.pinBarWickRatio * Math.max(a.body, U.EPS) &&
                                a.upperWick > a.lowerWick * 2;

            if (!bodySmall || (!lowerDominant && !upperDominant)) {
                if ((lowerDominant || upperDominant) && !bodySmall) {
                    reject(ctx, 'pin_bar', 'Pin Bar', i, ['dominant wick present'],
                           ['body is ' + (a.bodyPct * 100).toFixed(0) + '% of range, max ' +
                            (p.pinBarBodyMaxPct * 100).toFixed(0) + '%']);
                }
                continue;
            }

            var bullish = lowerDominant;
            var trend = priorTrend(ctx, i, p.contextBars);
            var wick = bullish ? a.lowerWick : a.upperWick;
            var wickRatio = wick / Math.max(a.body, a.safeRange * 0.01);
            // A hammer requires a preceding decline; a shooting star a preceding rally.
            var contextOk = bullish ? trend < -0.1 : trend > 0.1;
            var isNamed = contextOk;
            var name = bullish ? (isNamed ? 'Hammer' : 'Bullish Pin Bar')
                               : (isNamed ? 'Shooting Star' : 'Bearish Pin Bar');
            var id = bullish ? (isNamed ? 'hammer' : 'bullish_pin_bar')
                             : (isNamed ? 'shooting_star' : 'bearish_pin_bar');

            var missing = [];
            if (!contextOk) missing.push('no clear prior ' + (bullish ? 'decline' : 'rally') + ' to reverse');

            out.push(D.makeDetection(Object.assign(base(ctx, i), {
                id: id, name: name,
                category: D.CATEGORY.CANDLESTICK,
                bias: bullish ? D.BIAS.BULLISH : D.BIAS.BEARISH,
                confidence: D.clamp01(0.45 + 0.25 * Math.min(1, (wickRatio - p.pinBarWickRatio) / 3) +
                                      (contextOk ? 0.25 : 0)),
                strength: atrStrength(wick, ctx.atr[i]),
                confirmed: false,
                requiredConfirmation: [(bullish ? 'close above ' : 'close below ') +
                                       U.formatPrice(bullish ? ctx.bars[i].high : ctx.bars[i].low)],
                expiration: { type: 'bars', value: p.candleExpiryBars },
                evidence: {
                    satisfied: [
                        (bullish ? 'lower' : 'upper') + ' wick ' + wick.toFixed(4) +
                        ' >= ' + p.pinBarWickRatio + '× body',
                        'body is ' + (a.bodyPct * 100).toFixed(0) + '% of range'
                    ].concat(contextOk ? ['follows a prior ' + (bullish ? 'decline' : 'rally')] : []),
                    missing: missing, conflicting: []
                },
                metrics: { wickRatio: wickRatio, bodyPct: a.bodyPct, priorTrend: trend },
                why: name + ': ' + (bullish ? 'lower' : 'upper') + ' wick is ' +
                     wickRatio.toFixed(1) + '× the body with a ' + (a.bodyPct * 100).toFixed(0) + '% body'
            })));
        }
        return out;
    };

    /* ================================================================
     * DOJI — body <= dojiBodyMaxPct × range
     * ================================================================ */
    C.doji = function (ctx) {
        var out = [], r = scanRange(ctx), p = ctx.config.patterns;
        for (var i = r.start; i <= r.end; i++) {
            var a = ctx.anatomy[i];
            if (a.range <= U.EPS || a.bodyPct > p.dojiBodyMaxPct) continue;

            // Classify the doji by wick symmetry.
            var sym = Math.abs(a.upperWick - a.lowerWick) / a.safeRange;
            var kind = sym < 0.15 ? 'Doji'
                     : (a.lowerWick > a.upperWick ? 'Dragonfly Doji' : 'Gravestone Doji');

            out.push(D.makeDetection(Object.assign(base(ctx, i), {
                id: 'doji',
                name: kind,
                category: D.CATEGORY.CANDLESTICK,
                bias: D.BIAS.NEUTRAL,        // indecision: never directional on its own
                confidence: D.clamp01(0.5 + 0.5 * (1 - a.bodyPct / p.dojiBodyMaxPct)),
                strength: atrStrength(a.range, ctx.atr[i]) * 0.6,
                confirmed: true,
                requiredConfirmation: ['directional close on the following bar'],
                expiration: { type: 'bars', value: p.candleExpiryBars },
                evidence: {
                    satisfied: ['body ' + (a.bodyPct * 100).toFixed(1) + '% of range <= ' +
                                (p.dojiBodyMaxPct * 100).toFixed(0) + '%'],
                    missing: [], conflicting: []
                },
                metrics: { bodyPct: a.bodyPct, wickSymmetry: sym },
                why: kind + ': body is only ' + (a.bodyPct * 100).toFixed(1) + '% of the bar range — indecision'
            })));
        }
        return out;
    };

    /* ================================================================
     * INSIDE / OUTSIDE BAR
     *   Inside : high <= prev.high AND low >= prev.low
     *   Outside: high >  prev.high AND low <  prev.low
     * ================================================================ */
    C.insideOutside = function (ctx) {
        var out = [], r = scanRange(ctx), p = ctx.config.patterns;
        for (var i = Math.max(1, r.start); i <= r.end; i++) {
            var prev = ctx.bars[i - 1], cur = ctx.bars[i];
            var a = ctx.anatomy[i];

            if (cur.high <= prev.high + U.EPS && cur.low >= prev.low - U.EPS) {
                var compression = (cur.high - cur.low) / Math.max(prev.high - prev.low, U.EPS);
                out.push(D.makeDetection(Object.assign(base(ctx, i), {
                    id: 'inside_bar', name: 'Inside Bar',
                    category: D.CATEGORY.CANDLESTICK,
                    bias: D.BIAS.NEUTRAL,
                    confidence: D.clamp01(0.6 + 0.4 * (1 - compression)),
                    strength: D.clamp01(1 - compression),
                    barRange: [i - 1, i],
                    priceRange: { high: prev.high, low: prev.low },
                    confirmed: false,
                    requiredConfirmation: ['break of ' + U.formatPrice(prev.high) + ' or ' + U.formatPrice(prev.low)],
                    expiration: { type: 'bars', value: p.candleExpiryBars },
                    evidence: { satisfied: ['range contained within the previous bar'], missing: [], conflicting: [] },
                    metrics: { compression: compression },
                    why: 'Volatility compression: range is ' + (compression * 100).toFixed(0) +
                         '% of the prior bar, coiling for a breakout'
                })));
            } else if (cur.high > prev.high + U.EPS && cur.low < prev.low - U.EPS) {
                var expansion = (cur.high - cur.low) / Math.max(prev.high - prev.low, U.EPS);
                var bull = a.bullish;
                out.push(D.makeDetection(Object.assign(base(ctx, i), {
                    id: 'outside_bar', name: 'Outside Bar',
                    category: D.CATEGORY.CANDLESTICK,
                    bias: bull ? D.BIAS.BULLISH : (a.bearish ? D.BIAS.BEARISH : D.BIAS.NEUTRAL),
                    confidence: D.clamp01(0.5 + 0.3 * Math.min(1, expansion - 1) + 0.2 * a.bodyPct),
                    strength: atrStrength(cur.high - cur.low, ctx.atr[i]),
                    barRange: [i - 1, i],
                    priceRange: { high: cur.high, low: cur.low },
                    confirmed: a.bodyPct > 0.5,
                    requiredConfirmation: a.bodyPct > 0.5 ? [] : ['decisive close in the following bar'],
                    expiration: { type: 'bars', value: p.candleExpiryBars },
                    evidence: {
                        satisfied: ['range engulfs the previous bar (expansion ' + expansion.toFixed(2) + '×)'],
                        missing: a.bodyPct <= 0.5 ? ['close is not decisive (body ' +
                                 (a.bodyPct * 100).toFixed(0) + '% of range)'] : [],
                        conflicting: []
                    },
                    metrics: { expansion: expansion, bodyPct: a.bodyPct },
                    why: 'Range expansion ' + expansion.toFixed(2) + '× the prior bar, closing ' +
                         (bull ? 'bullish' : a.bearish ? 'bearish' : 'flat')
                })));
            }
        }
        return out;
    };

    /* ================================================================
     * HARAMI — previous body large, current body contained within it
     *   curr.bodyTop <= prev.bodyTop AND curr.bodyBottom >= prev.bodyBottom
     *   AND curr.body <= haramiMaxBodyRatio × prev.body
     *   AND opposite colours
     * ================================================================ */
    C.harami = function (ctx) {
        var out = [], r = scanRange(ctx), p = ctx.config.patterns;
        for (var i = Math.max(1, r.start); i <= r.end; i++) {
            var a = ctx.anatomy[i - 1], b = ctx.anatomy[i];
            if (a.body <= U.EPS || b.body <= U.EPS) continue;

            var contained = b.bodyTop <= a.bodyTop + U.EPS && b.bodyBottom >= a.bodyBottom - U.EPS;
            var ratio = b.body / a.body;
            if (!contained || ratio > p.haramiMaxBodyRatio) continue;

            var bullish = a.bearish && b.bullish;
            var bearish = a.bullish && b.bearish;
            if (!bullish && !bearish) continue;

            // The mother candle must itself be meaningful.
            if (a.body < (ctx.atr[i] || 0) * 0.5) {
                reject(ctx, 'harami', 'Harami', i, ['body contained in previous body'],
                       ['mother candle body is below 0.5 ATR']);
                continue;
            }

            out.push(D.makeDetection(Object.assign(base(ctx, i), {
                id: bullish ? 'bullish_harami' : 'bearish_harami',
                name: (bullish ? 'Bullish' : 'Bearish') + ' Harami',
                category: D.CATEGORY.CANDLESTICK,
                bias: bullish ? D.BIAS.BULLISH : D.BIAS.BEARISH,
                confidence: D.clamp01(0.45 + 0.35 * (1 - ratio)),
                strength: atrStrength(a.body, ctx.atr[i]) * 0.8,
                barRange: [i - 1, i],
                priceRange: { high: ctx.bars[i - 1].high, low: ctx.bars[i - 1].low },
                confirmed: false,
                requiredConfirmation: [(bullish ? 'close above ' : 'close below ') +
                                       U.formatPrice(bullish ? a.bodyTop : a.bodyBottom)],
                expiration: { type: 'bars', value: p.candleExpiryBars },
                evidence: {
                    satisfied: ['body contained within the previous body',
                                'body ratio ' + ratio.toFixed(2) + ' <= ' + p.haramiMaxBodyRatio,
                                'colours are opposite'],
                    missing: [], conflicting: []
                },
                metrics: { bodyRatio: ratio, motherBody: a.body },
                why: 'Momentum stall: body is only ' + (ratio * 100).toFixed(0) +
                     '% of the prior opposite-coloured body'
            })));
        }
        return out;
    };

    /* ================================================================
     * MORNING / EVENING STAR (3 bars)
     *   Morning: bar1 bearish with body >= starBodyMinAtr × ATR
     *            bar2 body <= starMiddleMaxRatio × bar1.body   (indecision)
     *            bar3 bullish, close > midpoint of bar1 body
     * ================================================================ */
    C.star = function (ctx) {
        var out = [], r = scanRange(ctx), p = ctx.config.patterns;
        for (var i = Math.max(2, r.start); i <= r.end; i++) {
            var a = ctx.anatomy[i - 2], b = ctx.anatomy[i - 1], c = ctx.anatomy[i];
            var atr = ctx.atr[i];
            if (!U.isFiniteNumber(atr) || atr <= U.EPS) continue;
            if (a.body < atr * p.starBodyMinAtr) continue;
            if (b.body > a.body * p.starMiddleMaxRatio) continue;

            var morning = a.bearish && c.bullish && ctx.bars[i].close > a.bodyMid + U.EPS;
            var evening = a.bullish && c.bearish && ctx.bars[i].close < a.bodyMid - U.EPS;
            if (!morning && !evening) continue;

            // Penetration depth into bar 1's body is the pattern's real strength.
            var penetration = morning
                ? (ctx.bars[i].close - a.bodyMid) / Math.max(a.body / 2, U.EPS)
                : (a.bodyMid - ctx.bars[i].close) / Math.max(a.body / 2, U.EPS);

            out.push(D.makeDetection(Object.assign(base(ctx, i), {
                id: morning ? 'morning_star' : 'evening_star',
                name: morning ? 'Morning Star' : 'Evening Star',
                category: D.CATEGORY.CANDLESTICK,
                bias: morning ? D.BIAS.BULLISH : D.BIAS.BEARISH,
                confidence: D.clamp01(0.6 + 0.3 * Math.min(1, penetration)),
                strength: atrStrength(a.body, atr),
                barRange: [i - 2, i],
                priceRange: {
                    high: Math.max(ctx.bars[i - 2].high, ctx.bars[i - 1].high, ctx.bars[i].high),
                    low: Math.min(ctx.bars[i - 2].low, ctx.bars[i - 1].low, ctx.bars[i].low)
                },
                confirmed: true,          // the third bar IS the confirmation
                requiredConfirmation: [],
                expiration: { type: 'bars', value: p.candleExpiryBars },
                evidence: {
                    satisfied: [
                        'bar 1 ' + (morning ? 'bearish' : 'bullish') + ' with body >= ' +
                        p.starBodyMinAtr + ' ATR',
                        'bar 2 indecision (body <= ' + (p.starMiddleMaxRatio * 100).toFixed(0) + '% of bar 1)',
                        'bar 3 closes ' + (morning ? 'above' : 'below') + ' the midpoint of bar 1'
                    ],
                    missing: [], conflicting: []
                },
                metrics: { penetration: penetration, bar1Body: a.body, bar2Body: b.body },
                why: (morning ? 'Morning' : 'Evening') + ' Star: indecision bar between two opposing ' +
                     'bodies, third bar reclaims ' + (penetration * 100).toFixed(0) + '% of the first body'
            })));
        }
        return out;
    };

    /* ================================================================
     * THREE WHITE SOLDIERS / THREE BLACK CROWS
     *   Three consecutive same-direction candles, each body >= soldierMinBodyPct
     *   of its range, each close beyond the previous close, and each open inside
     *   the previous body (no runaway gaps).
     * ================================================================ */
    C.threeSoldiers = function (ctx) {
        var out = [], r = scanRange(ctx), p = ctx.config.patterns;
        for (var i = Math.max(2, r.start); i <= r.end; i++) {
            var x = [ctx.anatomy[i - 2], ctx.anatomy[i - 1], ctx.anatomy[i]];
            var bars = [ctx.bars[i - 2], ctx.bars[i - 1], ctx.bars[i]];

            var allBull = x.every(function (v) { return v.bullish && v.bodyPct >= p.soldierMinBodyPct; });
            var allBear = x.every(function (v) { return v.bearish && v.bodyPct >= p.soldierMinBodyPct; });
            if (!allBull && !allBear) continue;

            var progressing = allBull
                ? bars[1].close > bars[0].close && bars[2].close > bars[1].close
                : bars[1].close < bars[0].close && bars[2].close < bars[1].close;
            if (!progressing) continue;

            var opensInside = allBull
                ? bars[1].open >= x[0].bodyBottom && bars[1].open <= x[0].bodyTop &&
                  bars[2].open >= x[1].bodyBottom && bars[2].open <= x[1].bodyTop
                : bars[1].open <= x[0].bodyTop && bars[1].open >= x[0].bodyBottom &&
                  bars[2].open <= x[1].bodyTop && bars[2].open >= x[1].bodyBottom;
            if (!opensInside) {
                reject(ctx, 'three_soldiers', 'Three Soldiers/Crows', i,
                       ['three same-direction bodies', 'progressive closes'],
                       ['an open fell outside the previous body (gap)']);
                continue;
            }

            var total = Math.abs(bars[2].close - bars[0].open);
            out.push(D.makeDetection(Object.assign(base(ctx, i), {
                id: allBull ? 'three_white_soldiers' : 'three_black_crows',
                name: allBull ? 'Three White Soldiers' : 'Three Black Crows',
                category: D.CATEGORY.CANDLESTICK,
                bias: allBull ? D.BIAS.BULLISH : D.BIAS.BEARISH,
                confidence: D.clamp01(0.65 + 0.3 * U.mean(x.map(function (v) { return v.bodyPct; }))),
                strength: atrStrength(total, ctx.atr[i]),
                barRange: [i - 2, i],
                priceRange: {
                    high: Math.max(bars[0].high, bars[1].high, bars[2].high),
                    low: Math.min(bars[0].low, bars[1].low, bars[2].low)
                },
                confirmed: true,
                requiredConfirmation: [],
                expiration: { type: 'bars', value: p.candleExpiryBars },
                evidence: {
                    satisfied: [
                        'three consecutive ' + (allBull ? 'bullish' : 'bearish') + ' candles',
                        'each body >= ' + (p.soldierMinBodyPct * 100).toFixed(0) + '% of its range',
                        'closes progress in one direction',
                        'each open falls inside the previous body'
                    ],
                    missing: [], conflicting: []
                },
                metrics: { totalMove: total, avgBodyPct: U.mean(x.map(function (v) { return v.bodyPct; })) },
                why: 'Sustained ' + (allBull ? 'buying' : 'selling') + ': three decisive candles covering ' +
                     total.toFixed(4) + ' with no gaps'
            })));
        }
        return out;
    };

    /* ================================================================
     * Registration
     * ================================================================ */
    QT.candles = {
        detectors: [
            { id: 'engulfing',       category: D.CATEGORY.CANDLESTICK, weight: 1.2, minBars: 3,  detect: C.engulfing },
            { id: 'pin_bar',         category: D.CATEGORY.CANDLESTICK, weight: 1.1, minBars: 3,  detect: C.pinBar },
            { id: 'doji',            category: D.CATEGORY.CANDLESTICK, weight: 0.6, minBars: 2,  detect: C.doji },
            { id: 'inside_outside',  category: D.CATEGORY.CANDLESTICK, weight: 0.9, minBars: 3,  detect: C.insideOutside },
            { id: 'harami',          category: D.CATEGORY.CANDLESTICK, weight: 0.9, minBars: 3,  detect: C.harami },
            { id: 'star',            category: D.CATEGORY.CANDLESTICK, weight: 1.3, minBars: 4,  detect: C.star },
            { id: 'three_soldiers',  category: D.CATEGORY.CANDLESTICK, weight: 1.3, minBars: 4,  detect: C.threeSoldiers }
        ],
        rules: C
    };

})(typeof globalThis !== 'undefined' ? globalThis : this);

if (typeof module !== 'undefined' && module.exports) {
    module.exports = (typeof globalThis !== 'undefined' ? globalThis : this).QT.candles;
}
