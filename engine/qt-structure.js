/**
 * qt-structure.js — Phase 3: market structure and Smart Money Concepts.
 *
 * Every rule is an explicit inequality over swing points and closes. No visual
 * interpretation is involved anywhere in this file.
 *
 * NON-REPAINTING NOTE (unavoidable ambiguity, documented per the brief):
 * A fractal swing at bar `i` can only be known once `lookback` further bars have
 * printed. Structure is therefore evaluated using swings whose
 * `confirmedAtIndex <= i`, which means the engine reacts to a swing `lookback`
 * bars after it forms. The alternative — using the swing the moment it appears —
 * repaints, because a later bar can invalidate it. The lag is reported on every
 * structure detection as `metrics.confirmationLag`.
 */
(function (root) {
    'use strict';

    var QT = root.QT = root.QT || {};
    var U = QT.utils;
    var D = QT.detection;

    var S = {};

    /* ================================================================
     * Swing labelling: HH / HL / LH / LL
     * ================================================================ */

    /**
     * Labels each swing against the previous swing of the same type.
     *   high > previous high  -> HH   else LH
     *   low  > previous low   -> HL   else LL
     */
    function labelSwings(swings) {
        var lastHigh = null, lastLow = null;
        var out = [];
        for (var i = 0; i < swings.length; i++) {
            var s = swings[i];
            var label = null;
            if (s.type === 'high') {
                if (lastHigh) label = s.price > lastHigh.price + U.EPS ? 'HH' : 'LH';
                lastHigh = s;
            } else {
                if (lastLow) label = s.price > lastLow.price + U.EPS ? 'HL' : 'LL';
                lastLow = s;
            }
            out.push(Object.assign({}, s, { label: label }));
        }
        return out;
    }

    /**
     * Derives the prevailing structural bias from the last labelled swings.
     *   HH + HL -> bullish        LH + LL -> bearish        otherwise ranging
     */
    function structuralBias(labelled) {
        var lastHigh = null, lastLow = null;
        for (var i = labelled.length - 1; i >= 0; i--) {
            if (!lastHigh && labelled[i].type === 'high' && labelled[i].label) lastHigh = labelled[i];
            if (!lastLow && labelled[i].type === 'low' && labelled[i].label) lastLow = labelled[i];
            if (lastHigh && lastLow) break;
        }
        if (!lastHigh || !lastLow) return { bias: D.BIAS.NEUTRAL, lastHigh: lastHigh, lastLow: lastLow };
        if (lastHigh.label === 'HH' && lastLow.label === 'HL') {
            return { bias: D.BIAS.BULLISH, lastHigh: lastHigh, lastLow: lastLow };
        }
        if (lastHigh.label === 'LH' && lastLow.label === 'LL') {
            return { bias: D.BIAS.BEARISH, lastHigh: lastHigh, lastLow: lastLow };
        }
        return { bias: D.BIAS.NEUTRAL, lastHigh: lastHigh, lastLow: lastLow };
    }

    S.labelSwings = labelSwings;
    S.structuralBias = structuralBias;

    /**
     * Swing-structure detector: reports the current HH/HL/LH/LL sequence.
     * `resolution` selects minor (internal) or major (external) swings.
     */
    function swingStructure(resolution) {
        return function (ctx) {
            var swings = ctx.swings[resolution === 'internal' ? 'minor' : 'major'];
            if (swings.length < 3) return [];

            var labelled = labelSwings(swings);
            var state = structuralBias(labelled);
            if (state.bias === D.BIAS.NEUTRAL && !state.lastHigh) return [];

            var recent = labelled.slice(-4);
            var seq = recent.map(function (s) { return s.label || s.type.toUpperCase(); }).join(' → ');
            var anchor = labelled[labelled.length - 1];
            var lag = ctx.confirmationLag[resolution === 'internal' ? 'minor' : 'major'];

            // Consistency of the last four labels sets confidence.
            var agree = 0, total = 0;
            recent.forEach(function (s) {
                if (!s.label) return;
                total++;
                if (state.bias === D.BIAS.BULLISH && (s.label === 'HH' || s.label === 'HL')) agree++;
                if (state.bias === D.BIAS.BEARISH && (s.label === 'LH' || s.label === 'LL')) agree++;
            });
            var consistency = total ? agree / total : 0;

            return [D.makeDetection({
                id: resolution === 'internal' ? 'internal_structure' : 'swing_structure',
                name: (resolution === 'internal' ? 'Internal' : 'Swing') + ' Structure',
                category: D.CATEGORY.STRUCTURE,
                bias: state.bias,
                confidence: D.clamp01(0.4 + 0.6 * consistency),
                strength: D.clamp01(consistency),
                quality: swings.length >= 5 ? 1 : 0.7,
                barIndex: anchor.index,
                barsAgo: ctx.lastIndex - anchor.index,
                time: anchor.time,
                barRange: [recent[0].index, anchor.index],
                priceRange: {
                    high: Math.max.apply(null, recent.map(function (s) { return s.price; })),
                    low: Math.min.apply(null, recent.map(function (s) { return s.price; }))
                },
                confirmed: true,
                completed: true,
                requiredConfirmation: [],
                expiration: { type: 'structure', value: 'until the next BOS or CHoCH' },
                evidence: {
                    satisfied: ['swing sequence ' + seq,
                                (consistency * 100).toFixed(0) + '% of recent swings agree with the bias'],
                    missing: consistency < 1 ? ['sequence is not fully consistent'] : [],
                    conflicting: []
                },
                metrics: {
                    sequence: recent.map(function (s) { return s.label; }),
                    consistency: consistency,
                    lastHigh: state.lastHigh ? state.lastHigh.price : null,
                    lastLow: state.lastLow ? state.lastLow.price : null,
                    confirmationLag: lag
                },
                why: (resolution === 'internal' ? 'Internal' : 'Swing') + ' structure is ' + state.bias +
                     ': ' + seq
            })];
        };
    }

    /* ================================================================
     * BOS and CHoCH
     *
     *   BOS   — a close beyond the last confirmed swing IN the direction of the
     *           prevailing bias (continuation).
     *   CHoCH — the first close beyond the last confirmed swing AGAINST the
     *           prevailing bias (character change).
     *
     * Only closes count; a wick through a level is a liquidity sweep, not a break.
     * ================================================================ */
    function breaks(resolution) {
        return function (ctx) {
            var key = resolution === 'internal' ? 'minor' : 'major';
            var swings = ctx.swings[key];
            if (swings.length < 2) return [];

            var labelled = labelSwings(swings);
            var lag = ctx.confirmationLag[key];
            var out = [];
            var p = ctx.config.patterns;
            var startBar = Math.max(0, ctx.bars.length - p.scanBars);

            var bias = D.BIAS.NEUTRAL;
            var activeHigh = null, activeLow = null;
            var si = 0;

            for (var i = 0; i < ctx.bars.length; i++) {
                // Adopt swings only once they are confirmed — this is the
                // non-repainting guarantee.
                while (si < labelled.length && labelled[si].confirmedAtIndex <= i) {
                    if (labelled[si].type === 'high') activeHigh = labelled[si];
                    else activeLow = labelled[si];
                    si++;
                }
                if (!activeHigh || !activeLow) continue;

                var close = ctx.bars[i].close;
                var brokeUp = close > activeHigh.price + U.EPS;
                var brokeDown = close < activeLow.price - U.EPS;
                if (!brokeUp && !brokeDown) continue;

                var dir = brokeUp ? D.BIAS.BULLISH : D.BIAS.BEARISH;
                var level = brokeUp ? activeHigh : activeLow;
                var isChoch = bias !== D.BIAS.NEUTRAL && bias !== dir;
                var kind = isChoch ? 'choch' : 'bos';

                if (i >= startBar) {
                    var atr = U.isFiniteNumber(ctx.atr[i]) ? ctx.atr[i] : 0;
                    var displacement = Math.abs(close - level.price);
                    var displacementAtr = atr > U.EPS ? displacement / atr : 0;

                    out.push(D.makeDetection({
                        id: (resolution === 'internal' ? 'internal_' : 'external_') + kind + '_' +
                            (brokeUp ? 'bullish' : 'bearish'),
                        name: (resolution === 'internal' ? 'Internal ' : 'External ') +
                              (isChoch ? 'Change of Character (CHoCH)' : 'Break of Structure (BOS)') +
                              ' — ' + (brokeUp ? 'Bullish' : 'Bearish'),
                        category: D.CATEGORY.STRUCTURE,
                        bias: dir,
                        // CHoCH is the higher-information event: it reverses character.
                        confidence: D.clamp01((isChoch ? 0.62 : 0.7) + 0.25 * Math.min(1, displacementAtr)),
                        strength: D.clamp01(0.4 + 0.6 * Math.min(1, displacementAtr / 1.5)),
                        quality: 1,
                        barIndex: i,
                        barsAgo: ctx.lastIndex - i,
                        time: ctx.bars[i].time,
                        barRange: [level.index, i],
                        priceRange: { high: Math.max(level.price, close), low: Math.min(level.price, close) },
                        confirmed: true,     // a close beyond the level IS the confirmation
                        completed: true,
                        requiredConfirmation: [],
                        expiration: { type: 'structure', value: 'until an opposing break' },
                        evidence: {
                            satisfied: [
                                'close ' + U.formatPrice(close) + (brokeUp ? ' > ' : ' < ') +
                                'confirmed swing ' + (brokeUp ? 'high ' : 'low ') + U.formatPrice(level.price),
                                'displacement ' + displacementAtr.toFixed(2) + ' ATR',
                                isChoch ? 'break opposes the prior ' + bias + ' structure'
                                        : 'break continues the ' + dir + ' structure'
                            ],
                            missing: displacementAtr < 0.5 ? ['shallow displacement beyond the level'] : [],
                            conflicting: []
                        },
                        metrics: {
                            brokenLevel: level.price, brokenSwingIndex: level.index,
                            displacement: displacement, displacementAtr: displacementAtr,
                            priorBias: bias, confirmationLag: lag, isChoch: isChoch
                        },
                        why: (isChoch ? 'Character change: ' : 'Structure break: ') + 'close ' +
                             U.formatPrice(close) + (brokeUp ? ' above ' : ' below ') +
                             'the confirmed swing ' + (brokeUp ? 'high' : 'low') + ' at ' +
                             U.formatPrice(level.price)
                    }));
                }

                bias = dir;
                // The broken level is consumed; wait for the next confirmed swing.
                if (brokeUp) activeHigh = null; else activeLow = null;
            }

            // Only the most recent break of each kind is decision-relevant.
            var seen = {};
            var latest = [];
            for (var k = out.length - 1; k >= 0; k--) {
                if (seen[out[k].id]) continue;
                seen[out[k].id] = true;
                latest.push(out[k]);
            }
            return latest;
        };
    }

    /* ================================================================
     * FAIR VALUE GAP (3-candle imbalance)
     *
     *   Bullish FVG at i: low[i] > high[i-2]      gap = low[i] − high[i-2]
     *   Bearish FVG at i: high[i] < low[i-2]      gap = low[i-2] − high[i]
     *   Gap must be >= fvgMinAtrMultiple × ATR to exclude trivial imbalances.
     *
     * Canonical ICT definition — see RESEARCH-SYNTHESIS.md Conflict 5, where D3's
     * looser wording is deliberately overridden.
     * ================================================================ */
    S.fairValueGap = function (ctx) {
        var out = [], cfg = ctx.config.structure, p = ctx.config.patterns;
        var start = Math.max(2, ctx.bars.length - p.scanBars);

        for (var i = start; i < ctx.bars.length; i++) {
            var atr = ctx.atr[i];
            if (!U.isFiniteNumber(atr) || atr <= U.EPS) continue;
            var minGap = atr * cfg.fvgMinAtrMultiple;

            var bullGap = ctx.bars[i].low - ctx.bars[i - 2].high;
            var bearGap = ctx.bars[i - 2].low - ctx.bars[i].high;
            var isBull = bullGap > minGap;
            var isBear = bearGap > minGap;
            if (!isBull && !isBear) continue;

            var gap = isBull ? bullGap : bearGap;
            var top = isBull ? ctx.bars[i].low : ctx.bars[i - 2].low;
            var bottom = isBull ? ctx.bars[i - 2].high : ctx.bars[i].high;
            var mid = (top + bottom) / 2;

            // Mitigation: has price traded back into the gap since it formed?
            var filled = 0, mitigated = false, fullyFilled = false;
            for (var j = i + 1; j < ctx.bars.length; j++) {
                var overlapTop = Math.min(top, ctx.bars[j].high);
                var overlapBottom = Math.max(bottom, ctx.bars[j].low);
                if (overlapTop > overlapBottom) {
                    var pen = (overlapTop - overlapBottom) / Math.max(top - bottom, U.EPS);
                    if (pen > filled) filled = pen;
                    if (isBull ? ctx.bars[j].low <= mid : ctx.bars[j].high >= mid) mitigated = true;
                    if (isBull ? ctx.bars[j].low <= bottom : ctx.bars[j].high >= top) fullyFilled = true;
                }
            }

            out.push(D.makeDetection({
                id: isBull ? 'bullish_fvg' : 'bearish_fvg',
                name: (isBull ? 'Bullish' : 'Bearish') + ' Fair Value Gap',
                category: D.CATEGORY.SMC,
                bias: isBull ? D.BIAS.BULLISH : D.BIAS.BEARISH,
                confidence: D.clamp01(0.5 + 0.35 * Math.min(1, gap / (atr * 0.75))),
                strength: D.clamp01((gap / atr) / 1.5) * (fullyFilled ? 0.25 : (mitigated ? 0.6 : 1)),
                quality: 1,
                barIndex: i,
                barsAgo: ctx.lastIndex - i,
                time: ctx.bars[i].time,
                barRange: [i - 2, i],
                priceRange: { high: top, low: bottom },
                confirmed: true,
                completed: true,
                invalidated: fullyFilled,
                requiredConfirmation: fullyFilled ? [] : ['price returns into ' +
                                       U.formatPrice(bottom) + '–' + U.formatPrice(top)],
                expiration: { type: 'fill', value: 'invalidated once fully filled' },
                evidence: {
                    satisfied: [
                        isBull ? 'low[i] ' + U.formatPrice(ctx.bars[i].low) + ' > high[i-2] ' +
                                 U.formatPrice(ctx.bars[i - 2].high)
                               : 'high[i] ' + U.formatPrice(ctx.bars[i].high) + ' < low[i-2] ' +
                                 U.formatPrice(ctx.bars[i - 2].low),
                        'gap ' + (gap / atr).toFixed(2) + ' ATR >= ' + cfg.fvgMinAtrMultiple + ' ATR'
                    ],
                    missing: [],
                    conflicting: fullyFilled ? ['gap has been fully filled — imbalance resolved'] :
                                 (mitigated ? ['gap has been mitigated past 50%'] : [])
                },
                metrics: { gap: gap, gapAtr: gap / atr, top: top, bottom: bottom, midpoint: mid,
                           filledFraction: filled, mitigated: mitigated, fullyFilled: fullyFilled },
                why: (isBull ? 'Bullish' : 'Bearish') + ' imbalance of ' + (gap / atr).toFixed(2) +
                     ' ATR between ' + U.formatPrice(bottom) + ' and ' + U.formatPrice(top) +
                     (fullyFilled ? ' (filled)' : mitigated ? ' (partially mitigated)' : ' (unmitigated)')
            }));
        }
        return out;
    };

    /* ================================================================
     * ORDER BLOCKS
     *
     * A bullish order block is the LAST bearish candle before an up-move that
     * closes above a confirmed swing high (i.e. before a bullish BOS). The zone
     * is that candle's range. Mirror for bearish.
     * ================================================================ */
    S.orderBlock = function (ctx) {
        var out = [], cfg = ctx.config.structure, p = ctx.config.patterns;
        var swings = ctx.swings.major.length ? ctx.swings.major : ctx.swings.minor;
        if (swings.length < 2) return [];

        var labelled = labelSwings(swings);
        var start = Math.max(1, ctx.bars.length - p.scanBars);
        var activeHigh = null, activeLow = null, si = 0;

        for (var i = 0; i < ctx.bars.length; i++) {
            while (si < labelled.length && labelled[si].confirmedAtIndex <= i) {
                if (labelled[si].type === 'high') activeHigh = labelled[si];
                else activeLow = labelled[si];
                si++;
            }
            if (!activeHigh || !activeLow || i < start) continue;

            var close = ctx.bars[i].close;
            var brokeUp = close > activeHigh.price + U.EPS;
            var brokeDown = close < activeLow.price - U.EPS;
            if (!brokeUp && !brokeDown) continue;

            // Walk back for the last opposing candle before the impulse.
            var obIdx = -1;
            var from = Math.max(0, i - cfg.orderBlockLookback);
            for (var k = i - 1; k >= from; k--) {
                var a = ctx.anatomy[k];
                if (brokeUp ? a.bearish : a.bullish) { obIdx = k; break; }
            }
            if (obIdx < 0) continue;

            var ob = ctx.bars[obIdx];
            var atr = U.isFiniteNumber(ctx.atr[i]) ? ctx.atr[i] : 0;
            var displacement = Math.abs(close - (brokeUp ? activeHigh.price : activeLow.price));

            // Mitigation and breaker classification.
            var mitigated = false, broken = false;
            for (var j = i + 1; j < ctx.bars.length; j++) {
                if (brokeUp) {
                    if (ctx.bars[j].low <= ob.high && ctx.bars[j].low >= ob.low) mitigated = true;
                    if (ctx.bars[j].close < ob.low - U.EPS) { broken = true; break; }
                } else {
                    if (ctx.bars[j].high >= ob.low && ctx.bars[j].high <= ob.high) mitigated = true;
                    if (ctx.bars[j].close > ob.high + U.EPS) { broken = true; break; }
                }
            }

            var isBreaker = broken;
            var bias = brokeUp ? D.BIAS.BULLISH : D.BIAS.BEARISH;
            // A broken order block flips polarity — that is the breaker block.
            var effectiveBias = isBreaker ? (brokeUp ? D.BIAS.BEARISH : D.BIAS.BULLISH) : bias;

            out.push(D.makeDetection({
                id: isBreaker ? (brokeUp ? 'bearish_breaker_block' : 'bullish_breaker_block')
                              : (mitigated ? (brokeUp ? 'bullish_mitigation_block' : 'bearish_mitigation_block')
                                           : (brokeUp ? 'bullish_order_block' : 'bearish_order_block')),
                name: isBreaker ? ((brokeUp ? 'Bearish' : 'Bullish') + ' Breaker Block')
                                : (mitigated ? ((brokeUp ? 'Bullish' : 'Bearish') + ' Mitigation Block')
                                             : ((brokeUp ? 'Bullish' : 'Bearish') + ' Order Block')),
                category: D.CATEGORY.SMC,
                bias: effectiveBias,
                confidence: D.clamp01(0.5 + 0.3 * Math.min(1, atr > 0 ? displacement / atr : 0)),
                strength: D.clamp01(0.45 + 0.45 * Math.min(1, atr > 0 ? displacement / (atr * 2) : 0)) *
                          (isBreaker ? 0.8 : (mitigated ? 0.65 : 1)),
                quality: 1,
                barIndex: obIdx,
                barsAgo: ctx.lastIndex - obIdx,
                time: ob.time,
                barRange: [obIdx, i],
                priceRange: { high: ob.high, low: ob.low },
                confirmed: true,
                completed: true,
                invalidated: isBreaker,
                requiredConfirmation: isBreaker ? [] :
                    ['price returns to ' + U.formatPrice(ob.low) + '–' + U.formatPrice(ob.high)],
                expiration: { type: 'price', value: 'invalidated on a close through the far side' },
                evidence: {
                    satisfied: [
                        'last ' + (brokeUp ? 'bearish' : 'bullish') + ' candle before the impulse',
                        'impulse closed ' + (brokeUp ? 'above' : 'below') + ' the confirmed swing at ' +
                        U.formatPrice(brokeUp ? activeHigh.price : activeLow.price),
                        'displacement ' + (atr > 0 ? (displacement / atr).toFixed(2) : 'n/a') + ' ATR'
                    ],
                    missing: mitigated || isBreaker ? [] : ['zone has not yet been retested'],
                    conflicting: isBreaker ? ['price closed through the block — polarity flipped'] : []
                },
                metrics: { zoneHigh: ob.high, zoneLow: ob.low, zoneMid: (ob.high + ob.low) / 2,
                           displacement: displacement, displacementAtr: atr > 0 ? displacement / atr : null,
                           mitigated: mitigated, broken: broken },
                why: (isBreaker ? 'Breaker: this block failed and now acts as opposing structure'
                                : 'Institutional zone: last ' + (brokeUp ? 'bearish' : 'bullish') +
                                  ' candle before a ' + (brokeUp ? 'bullish' : 'bearish') + ' break') +
                     ' at ' + U.formatPrice(ob.low) + '–' + U.formatPrice(ob.high)
            }));
        }

        // Keep only the most recent, decision-relevant blocks.
        return out.slice(-ctx.config.patterns.maxZonesPerType);
    };

    /* ================================================================
     * LIQUIDITY SWEEP  (stop hunt / Turtle Soup)
     *
     *   Bearish sweep: high[i] > swingHigh + k×ATR  AND  close[i] < swingHigh
     *   i.e. the level is pierced by a wick but reclaimed by the close.
     * ================================================================ */
    S.liquiditySweep = function (ctx) {
        var out = [], cfg = ctx.config.structure, p = ctx.config.patterns;
        var swings = ctx.swings.minor;
        if (!swings.length) return [];
        var start = Math.max(1, ctx.bars.length - p.scanBars);

        for (var i = start; i < ctx.bars.length; i++) {
            var atr = ctx.atr[i];
            if (!U.isFiniteNumber(atr) || atr <= U.EPS) continue;
            var threshold = atr * cfg.liquiditySweepAtrMultiple;

            for (var s = swings.length - 1; s >= 0; s--) {
                var sw = swings[s];
                if (sw.confirmedAtIndex >= i) continue;
                if (i - sw.index > cfg.orderBlockLookback) break;

                var swept = false, bias = null, pierce = 0;
                if (sw.type === 'high' &&
                    ctx.bars[i].high > sw.price + threshold &&
                    ctx.bars[i].close < sw.price - U.EPS) {
                    swept = true; bias = D.BIAS.BEARISH; pierce = ctx.bars[i].high - sw.price;
                } else if (sw.type === 'low' &&
                    ctx.bars[i].low < sw.price - threshold &&
                    ctx.bars[i].close > sw.price + U.EPS) {
                    swept = true; bias = D.BIAS.BULLISH; pierce = sw.price - ctx.bars[i].low;
                }
                if (!swept) continue;

                out.push(D.makeDetection({
                    id: bias === D.BIAS.BULLISH ? 'bullish_liquidity_sweep' : 'bearish_liquidity_sweep',
                    name: (bias === D.BIAS.BULLISH ? 'Bullish' : 'Bearish') + ' Liquidity Sweep',
                    category: D.CATEGORY.SMC,
                    bias: bias,
                    confidence: D.clamp01(0.55 + 0.35 * Math.min(1, pierce / (atr * 0.75))),
                    strength: D.clamp01(0.4 + 0.6 * Math.min(1, pierce / atr)),
                    quality: 1,
                    barIndex: i,
                    barsAgo: ctx.lastIndex - i,
                    time: ctx.bars[i].time,
                    barRange: [sw.index, i],
                    priceRange: { high: ctx.bars[i].high, low: ctx.bars[i].low },
                    confirmed: true,
                    completed: true,
                    requiredConfirmation: [],
                    expiration: { type: 'bars', value: p.candleExpiryBars },
                    evidence: {
                        satisfied: [
                            'wick pierced the swing ' + sw.type + ' at ' + U.formatPrice(sw.price) +
                            ' by ' + (pierce / atr).toFixed(2) + ' ATR',
                            'close ' + U.formatPrice(ctx.bars[i].close) +
                            ' reclaimed the level — the break failed'
                        ],
                        missing: [], conflicting: []
                    },
                    metrics: { sweptLevel: sw.price, sweptSwingIndex: sw.index,
                               pierce: pierce, pierceAtr: pierce / atr },
                    why: 'Stop hunt: price pierced ' + U.formatPrice(sw.price) + ' by ' +
                         (pierce / atr).toFixed(2) + ' ATR then closed back inside, trapping breakout traders'
                }));
                break;      // one sweep per bar
            }
        }
        return out.slice(-ctx.config.patterns.maxZonesPerType);
    };

    /* ================================================================
     * EQUAL HIGHS / EQUAL LOWS  (resting liquidity)
     *   Two same-type swings whose prices differ by <= equalLevelAtrMultiple × ATR
     * ================================================================ */
    S.equalLevels = function (ctx) {
        var out = [], p = ctx.config.patterns;
        var swings = ctx.swings.minor;
        if (swings.length < 2) return [];

        var highs = swings.filter(function (s) { return s.type === 'high'; });
        var lows = swings.filter(function (s) { return s.type === 'low'; });

        function scan(list, type) {
            for (var i = 1; i < list.length; i++) {
                var a = list[i - 1], b = list[i];
                var atr = U.isFiniteNumber(b.atr) ? b.atr : ctx.lastAtr;
                if (!(atr > U.EPS)) continue;
                var diff = Math.abs(a.price - b.price);
                if (diff > atr * p.equalLevelAtrMultiple) continue;
                if (ctx.lastIndex - b.index > p.scanBars) continue;

                var level = (a.price + b.price) / 2;
                var bias = type === 'high' ? D.BIAS.BEARISH : D.BIAS.BULLISH;
                out.push(D.makeDetection({
                    id: type === 'high' ? 'equal_highs' : 'equal_lows',
                    name: type === 'high' ? 'Equal Highs' : 'Equal Lows',
                    category: D.CATEGORY.SMC,
                    // Equal levels mark resting liquidity that price tends to take.
                    bias: bias,
                    confidence: D.clamp01(0.5 + 0.4 * (1 - diff / (atr * p.equalLevelAtrMultiple))),
                    strength: 0.6,
                    quality: 1,
                    barIndex: b.index,
                    barsAgo: ctx.lastIndex - b.index,
                    time: b.time,
                    barRange: [a.index, b.index],
                    priceRange: { high: Math.max(a.price, b.price), low: Math.min(a.price, b.price) },
                    confirmed: true,
                    completed: true,
                    requiredConfirmation: ['sweep of ' + U.formatPrice(level) + ' to collect the liquidity'],
                    expiration: { type: 'price', value: 'consumed once swept' },
                    evidence: {
                        satisfied: ['two swing ' + type + 's within ' +
                                    (diff / atr).toFixed(3) + ' ATR (tolerance ' +
                                    p.equalLevelAtrMultiple + ')'],
                        missing: [], conflicting: []
                    },
                    metrics: { level: level, difference: diff, differenceAtr: diff / atr,
                               indices: [a.index, b.index] },
                    why: 'Resting liquidity at ' + U.formatPrice(level) +
                         ': two swing ' + type + 's are effectively equal, a magnet for a stop run'
                }));
            }
        }
        scan(highs, 'high');
        scan(lows, 'low');
        return out.slice(-p.maxZonesPerType);
    };

    /* ================================================================
     * PREMIUM / DISCOUNT  (dealing-range position)
     *   range = last major swing high .. last major swing low
     *   position = (price − low) / (high − low)
     *   > 0.5 premium (favour selling), < 0.5 discount (favour buying)
     * ================================================================ */
    S.premiumDiscount = function (ctx) {
        var swings = ctx.swings.major.length >= 2 ? ctx.swings.major : ctx.swings.minor;
        if (swings.length < 2) return [];

        var lastHigh = null, lastLow = null;
        for (var i = swings.length - 1; i >= 0; i--) {
            if (!lastHigh && swings[i].type === 'high') lastHigh = swings[i];
            if (!lastLow && swings[i].type === 'low') lastLow = swings[i];
            if (lastHigh && lastLow) break;
        }
        if (!lastHigh || !lastLow) return [];

        var high = lastHigh.price, low = lastLow.price;
        var span = high - low;
        if (!(span > U.EPS)) return [];

        var price = ctx.lastBar.close;
        var rawPos = (price - low) / span;
        var eq = (high + low) / 2;

        /* Price can sit OUTSIDE the dealing range, which means the range has been
         * broken rather than that price is deeply discounted. Treating a breakdown
         * as a "discount buy" would invert the signal, so the out-of-range cases
         * are classified separately as continuation, not mean reversion. */
        var broken = rawPos < 0 || rawPos > 1;
        var pos = U.clamp(rawPos, 0, 1);
        var zone, bias;

        if (rawPos > 1) {
            zone = 'breakout';   bias = D.BIAS.BULLISH;
        } else if (rawPos < 0) {
            zone = 'breakdown';  bias = D.BIAS.BEARISH;
        } else if (pos > 0.5 + ctx.config.patterns.equilibriumBand) {
            zone = 'premium';    bias = D.BIAS.BEARISH;
        } else if (pos < 0.5 - ctx.config.patterns.equilibriumBand) {
            zone = 'discount';   bias = D.BIAS.BULLISH;
        } else {
            zone = 'equilibrium'; bias = D.BIAS.NEUTRAL;
        }

        return [D.makeDetection({
            id: 'premium_discount',
            name: broken ? ('Dealing Range ' + (zone === 'breakout' ? 'Breakout' : 'Breakdown')) : ('Premium / Discount (' + zone + ')'),
            category: D.CATEGORY.ZONE,
            bias: bias,
            confidence: broken ? 0.85 : D.clamp01(0.4 + 0.6 * Math.abs(pos - 0.5) * 2),
            strength: broken ? D.clamp01(Math.abs(rawPos - (rawPos > 1 ? 1 : 0))) : D.clamp01(Math.abs(pos - 0.5) * 2),
            quality: 1,
            barIndex: ctx.lastIndex,
            barsAgo: 0,
            time: ctx.lastBar.time,
            barRange: [Math.min(lastHigh.index, lastLow.index), ctx.lastIndex],
            priceRange: { high: high, low: low },
            confirmed: true,
            completed: true,
            requiredConfirmation: [],
            expiration: { type: 'structure', value: 'until the dealing range changes' },
            evidence: {
                satisfied: ['price at ' + (rawPos * 100).toFixed(1) + '% of the dealing range ' +
                            U.formatPrice(low) + '–' + U.formatPrice(high),
                            'equilibrium at ' + U.formatPrice(eq)],
                missing: [], conflicting: []
            },
            metrics: { position: pos, rawPosition: rawPos, rangeHigh: high, rangeLow: low, equilibrium: eq, zone: zone, rangeBroken: broken },
            why: broken
                 ? 'Price has broken ' + (rawPos > 1 ? 'above' : 'below') + ' its dealing range (' +
                   U.formatPrice(low) + '-' + U.formatPrice(high) + '), a ' + bias + ' continuation signal rather than mean reversion'
                 : 'Price sits in the ' + zone + ' of its dealing range (' + (pos * 100).toFixed(1) +
                   '%), which favours ' + (bias === D.BIAS.BEARISH ? 'selling' : bias === D.BIAS.BULLISH ? 'buying' : 'neither side')
        })];
    };

    /* ================================================================
     * Registration
     * ================================================================ */
    QT.structure = {
        detectors: [
            { id: 'swing_structure',    category: D.CATEGORY.STRUCTURE, weight: 1.8, minBars: 30,
              detect: swingStructure('external') },
            { id: 'internal_structure', category: D.CATEGORY.STRUCTURE, weight: 1.2, minBars: 20,
              detect: swingStructure('internal') },
            { id: 'external_breaks',    category: D.CATEGORY.STRUCTURE, weight: 2.0, minBars: 30,
              detect: breaks('external') },
            { id: 'internal_breaks',    category: D.CATEGORY.STRUCTURE, weight: 1.4, minBars: 20,
              detect: breaks('internal') },
            { id: 'fair_value_gap',     category: D.CATEGORY.SMC, weight: 1.8, minBars: 10,
              detect: S.fairValueGap },
            { id: 'order_block',        category: D.CATEGORY.SMC, weight: 1.7, minBars: 30,
              detect: S.orderBlock },
            { id: 'liquidity_sweep',    category: D.CATEGORY.SMC, weight: 1.7, minBars: 20,
              detect: S.liquiditySweep },
            { id: 'equal_levels',       category: D.CATEGORY.SMC, weight: 1.2, minBars: 20,
              detect: S.equalLevels },
            { id: 'premium_discount',   category: D.CATEGORY.ZONE, weight: 1.0, minBars: 30,
              detect: S.premiumDiscount }
        ],
        rules: S,
        labelSwings: labelSwings,
        structuralBias: structuralBias,
        swingStructure: swingStructure,
        breaks: breaks
    };

})(typeof globalThis !== 'undefined' ? globalThis : this);

if (typeof module !== 'undefined' && module.exports) {
    module.exports = (typeof globalThis !== 'undefined' ? globalThis : this).QT.structure;
}
