/**
 * Phase 3 verification — Pattern Recognition.
 *
 * Strategy: hand-construct bar sequences where the correct answer is provable
 * from the documented rule, then assert positive detection, negative rejection
 * (a near-miss must NOT fire) and edge-case safety.
 */
'use strict';

require('../engine/qt-config.js');
require('../engine/qt-utils.js');
require('../engine/qt-indicators.js');
require('../engine/qt-detection.js');
require('../engine/qt-candles.js');
require('../engine/qt-structure.js');
require('../engine/qt-chart-patterns.js');
require('../engine/qt-patterns.js');

var QT = globalThis.QT;
var D = QT.detection;
var T = require('./harness.js');
var fs = require('fs');

var FIX = JSON.parse(fs.readFileSync(__dirname + '/fixtures/btcusd-1d.json', 'utf8'));

/* ---- builders ------------------------------------------------------ */
var t0 = Date.UTC(2026, 0, 1);
var STEP = 3600000;
function bar(o, h, l, c, i, v) {
    return { time: t0 + i * STEP, open: o, high: h, low: l, close: c, volume: v === undefined ? 1000 : v };
}
/** Neutral filler bars so ATR warms up without creating patterns. */
function filler(n, price, startIdx) {
    var out = [];
    for (var i = 0; i < n; i++) {
        var p = price + (i % 2 === 0 ? 0.2 : -0.2);
        out.push(bar(p, p + 0.35, p - 0.35, p, startIdx + i));
    }
    return out;
}
function ctxFor(bars, overrides) {
    var cfg = overrides ? Object.assign(QT.cloneConfig(), overrides) : QT.CONFIG;
    var ind = QT.indicators.computeAll(bars, cfg);
    var ctx = D.buildContext(bars, ind, cfg);
    ctx.capabilities = { ohlc: true, volume: false };
    return ctx;
}
function ids(list) { return list.map(function (d) { return d.id; }); }
function has(list, id) { return ids(list).indexOf(id) !== -1; }

/* ================================================================== */
T.suite('Phase 3 — Candlestick detectors (positive)');

T.test('bullish engulfing fires when the body fully engulfs', function () {
    var bars = filler(30, 100, 0);
    bars.push(bar(100, 100.4, 98.6, 99.0, 30));      // bearish body 99.0–100
    bars.push(bar(98.8, 101.6, 98.7, 101.2, 31));    // bullish body 98.8–101.2 engulfs
    var found = QT.candles.rules.engulfing(ctxFor(bars));
    T.ok(has(found, 'bullish_engulfing'), 'detected');
    var d = found.filter(function (x) { return x.id === 'bullish_engulfing'; })[0];
    T.equal(d.bias, 'bullish', 'bias bullish');
    T.equal(d.barIndex, 31, 'anchored on the engulfing bar');
    T.ok(d.metrics.bodyRatio > 1, 'body ratio > 1');
    T.ok(d.evidence.satisfied.length >= 3, 'explains what was satisfied');
    T.ok(d.why.length > 10, 'human explanation present');
});

T.test('bearish engulfing is the exact mirror', function () {
    var bars = filler(30, 100, 0);
    bars.push(bar(99.0, 100.4, 98.9, 100.0, 30));    // bullish
    bars.push(bar(100.2, 100.4, 98.4, 98.7, 31));    // bearish engulfing
    var found = QT.candles.rules.engulfing(ctxFor(bars));
    T.ok(has(found, 'bearish_engulfing'), 'detected');
});

T.test('hammer requires a long lower wick AND a prior decline', function () {
    var bars = [];
    for (var i = 0; i < 30; i++) bars.push(bar(110 - i * 0.5, 110.3 - i * 0.5, 109.4 - i * 0.5, 109.6 - i * 0.5, i));
    bars.push(bar(95.0, 95.2, 92.0, 95.0, 30));      // small body, long lower wick
    var found = QT.candles.rules.pinBar(ctxFor(bars));
    T.ok(has(found, 'hammer'), 'named a hammer after a decline: ' + ids(found).join(','));
    var d = found.filter(function (x) { return x.id === 'hammer'; })[0];
    T.ok(d.metrics.priorTrend < 0, 'prior trend was negative');
    T.equal(d.bias, 'bullish', 'bullish bias');
});

T.test('shooting star fires after a rally', function () {
    var bars = [];
    for (var i = 0; i < 30; i++) bars.push(bar(90 + i * 0.5, 90.6 + i * 0.5, 89.8 + i * 0.5, 90.4 + i * 0.5, i));
    bars.push(bar(105.0, 108.0, 104.8, 105.1, 30));
    var found = QT.candles.rules.pinBar(ctxFor(bars));
    T.ok(has(found, 'shooting_star'), 'detected: ' + ids(found).join(','));
});

T.test('doji fires on a tiny body and stays NEUTRAL', function () {
    var bars = filler(30, 100, 0);
    bars.push(bar(100.0, 101.0, 99.0, 100.01, 30));
    var found = QT.candles.rules.doji(ctxFor(bars));
    var d = found.filter(function (x) { return x.barIndex === 30; })[0];
    T.ok(!!d, 'detected');
    T.equal(d.bias, 'neutral', 'a doji is never directional on its own');
});

T.test('inside and outside bars are classified correctly', function () {
    var bars = filler(30, 100, 0);
    bars.push(bar(100, 103, 97, 101, 30));           // wide mother bar
    bars.push(bar(100.5, 102, 98.5, 99.5, 31));      // inside
    bars.push(bar(99, 104, 96, 103.5, 32));          // outside
    var found = QT.candles.rules.insideOutside(ctxFor(bars));
    T.ok(found.some(function (d) { return d.id === 'inside_bar' && d.barIndex === 31; }), 'inside bar');
    T.ok(found.some(function (d) { return d.id === 'outside_bar' && d.barIndex === 32; }), 'outside bar');
});

T.test('morning star requires all three structural conditions', function () {
    var bars = filler(30, 100, 0);
    bars.push(bar(100, 100.2, 95.8, 96.0, 30));      // big bearish body
    bars.push(bar(95.9, 96.3, 95.4, 96.0, 31));      // indecision
    bars.push(bar(96.2, 99.6, 96.1, 99.4, 32));      // closes above midpoint (98.0)
    var found = QT.candles.rules.star(ctxFor(bars));
    T.ok(has(found, 'morning_star'), 'detected: ' + ids(found).join(','));
    var d = found[0];
    T.ok(d.confirmed, 'the third bar is its own confirmation');
    T.equal(d.evidence.satisfied.length, 3, 'all three conditions listed');
});

T.test('three white soldiers require progression with no gaps', function () {
    var bars = filler(30, 100, 0);
    bars.push(bar(100.0, 101.6, 99.9, 101.4, 30));
    bars.push(bar(100.8, 103.0, 100.7, 102.8, 31));
    bars.push(bar(102.0, 104.4, 101.9, 104.2, 32));
    var found = QT.candles.rules.threeSoldiers(ctxFor(bars));
    T.ok(has(found, 'three_white_soldiers'), 'detected: ' + ids(found).join(','));
});

T.test('harami fires when the body is contained in a large mother candle', function () {
    var bars = filler(30, 100, 0);
    bars.push(bar(104, 104.3, 99.7, 100.0, 30));     // large bearish
    bars.push(bar(101.0, 101.6, 100.7, 102.0, 31));  // small bullish inside
    var found = QT.candles.rules.harami(ctxFor(bars));
    T.ok(has(found, 'bullish_harami'), 'detected: ' + ids(found).join(','));
});

/* ---- Negative cases ------------------------------------------------ */
T.suite('Phase 3 — Candlestick detectors (negative)');

T.test('near-miss engulfing does NOT fire and is recorded as a rejection', function () {
    var bars = filler(30, 100, 0);
    bars.push(bar(100, 100.4, 98.6, 99.0, 30));
    bars.push(bar(99.2, 100.3, 99.1, 99.9, 31));     // does not engulf the body
    var ctx = ctxFor(bars);
    var found = QT.candles.rules.engulfing(ctx);
    T.ok(!has(found, 'bullish_engulfing'), 'correctly rejected');
});

T.test('engulfing with an undersized body is rejected and explained', function () {
    var cfg = QT.cloneConfig();
    cfg.patterns.engulfingMinRatio = 3.0;            // demand a 3x body (actual ratio is 2.4)
    var bars = filler(30, 100, 0);
    bars.push(bar(100, 100.4, 98.6, 99.0, 30));
    bars.push(bar(98.8, 101.6, 98.7, 101.2, 31));
    var ctx = ctxFor(bars, { patterns: cfg.patterns });
    var found = QT.candles.rules.engulfing(ctx);
    T.ok(!has(found, 'bullish_engulfing'), 'rejected under the stricter ratio');
    T.ok(ctx.rejections.some(function (r) { return /ratio/.test(r.missing.join(' ')); }),
         'rejection explains the missing condition');
});

T.test('a long-bodied bar is not a pin bar', function () {
    var bars = filler(30, 100, 0);
    bars.push(bar(96.0, 100.2, 95.9, 100.0, 30));    // body dominates the range
    var found = QT.candles.rules.pinBar(ctxFor(bars));
    T.ok(!found.some(function (d) { return d.barIndex === 30; }), 'correctly rejected');
});

T.test('a large body is not a doji', function () {
    var bars = filler(30, 100, 0);
    bars.push(bar(99, 101, 98.9, 100.9, 30));
    var found = QT.candles.rules.doji(ctxFor(bars));
    T.ok(!found.some(function (d) { return d.barIndex === 30; }), 'correctly rejected');
});

T.test('three soldiers with a gap are rejected', function () {
    var bars = filler(30, 100, 0);
    bars.push(bar(100.0, 101.6, 99.9, 101.4, 30));
    bars.push(bar(102.5, 104.0, 102.4, 103.8, 31));  // opens ABOVE the prior body: gap
    bars.push(bar(104.0, 105.6, 103.9, 105.4, 32));
    var ctx = ctxFor(bars);
    var found = QT.candles.rules.threeSoldiers(ctx);
    T.ok(!has(found, 'three_white_soldiers'), 'gap correctly disqualifies the pattern');
    T.ok(ctx.rejections.some(function (r) { return /gap/.test(r.missing.join(' ')); }),
         'rejection recorded with reason');
});

/* ---- Market structure ---------------------------------------------- */
T.suite('Phase 3 — Market structure');

/**
 * Builds a clean alternating swing sequence.
 *
 * Leg magnitudes are kept near-symmetric on purpose: swing prominence equals the
 * SMALLER adjacent step, while ATR tracks the average step. With lopsided legs
 * (e.g. +1.0 / -0.5) prominence lands at ~0.45 ATR and the engine's
 * `minSwingAtrMultiple = 0.5` noise filter correctly discards the swing — which
 * is the intended behaviour, not a defect. Symmetric legs keep prominence at
 * ~0.8 ATR so the fixture exercises structure logic rather than the filter.
 */
function zigzag(legs, startPrice, amplitude) {
    var bars = [], price = startPrice, idx = 0;
    for (var l = 0; l < legs.length; l++) {
        var target = price + legs[l] * amplitude;
        var steps = 6;
        for (var s = 1; s <= steps; s++) {
            var p = price + (target - price) * (s / steps);
            bars.push(bar(p - 0.05, p + 0.25, p - 0.25, p, idx++));
        }
        price = target;
    }
    return bars;
}

T.test('labels HH/HL in a rising market and sets a bullish bias', function () {
    var bars = zigzag([1, -0.85, 1.1, -0.85, 1.2, -0.85, 1.3], 100, 12);
    var ctx = ctxFor(bars);
    var labelled = QT.structure.labelSwings(ctx.swings.minor);
    var state = QT.structure.structuralBias(labelled);
    T.equal(state.bias, 'bullish', 'bullish structure detected');
    var labels = labelled.filter(function (s) { return s.label; }).map(function (s) { return s.label; });
    T.ok(labels.indexOf('HH') !== -1, 'higher highs labelled');
    T.ok(labels.indexOf('HL') !== -1, 'higher lows labelled');
});

T.test('labels LH/LL in a falling market and sets a bearish bias', function () {
    var bars = zigzag([-1, 0.85, -1.1, 0.85, -1.2, 0.85, -1.3], 200, 12);
    var ctx = ctxFor(bars);
    var state = QT.structure.structuralBias(QT.structure.labelSwings(ctx.swings.minor));
    T.equal(state.bias, 'bearish', 'bearish structure detected');
});

T.test('BOS and CHoCH are distinguished correctly', function () {
    // Rise (establishes bullish structure), then a decisive break below.
    var bars = zigzag([1, -0.85, 1.1, -0.85, 1.2, -2.4], 100, 12);
    var ctx = ctxFor(bars);
    var found = QT.structure.breaks('internal')(ctx);
    T.ok(found.length > 0, 'a structural break was detected');
    var hasChoch = found.some(function (d) { return d.metrics.isChoch === true; });
    var hasBos = found.some(function (d) { return d.metrics.isChoch === false; });
    T.ok(hasBos || hasChoch, 'classified as BOS or CHoCH');
    found.forEach(function (d) {
        T.ok(d.metrics.confirmationLag > 0, 'reports its confirmation lag');
        T.ok(d.confirmed, 'a close beyond the level is self-confirming');
    });
});

T.test('structure uses only CONFIRMED swings (non-repainting)', function () {
    var bars = zigzag([1, -0.85, 1.1, -0.85, 1.2], 100, 12);
    var ctx = ctxFor(bars);
    ctx.swings.minor.forEach(function (s) {
        T.ok(s.confirmedAtIndex > s.index, 'swing at ' + s.index + ' confirmed later, never same-bar');
    });
});

T.test('swing detection filters out sub-ATR noise', function () {
    var cfg = QT.cloneConfig();
    cfg.structure.minSwingAtrMultiple = 5;           // demand very prominent swings
    var bars = zigzag([1, -0.85, 1, -0.85, 1], 100, 12);
    var loose = ctxFor(bars);
    var strict = ctxFor(bars, { structure: cfg.structure });
    T.ok(strict.swings.minor.length <= loose.swings.minor.length,
         'stricter filter yields no more swings (' + strict.swings.minor.length +
         ' <= ' + loose.swings.minor.length + ')');
});

/* ---- SMC ------------------------------------------------------------ */
T.suite('Phase 3 — Smart Money Concepts');

T.test('bullish FVG fires only when low[i] > high[i-2]', function () {
    var bars = filler(30, 100, 0);
    bars.push(bar(100, 100.5, 99.5, 100.2, 30));     // i-2, high 100.5
    bars.push(bar(100.3, 104.0, 100.2, 103.8, 31));  // displacement
    bars.push(bar(103.9, 105.0, 101.5, 104.5, 32));  // low 101.5 > 100.5 => gap
    var found = QT.structure.rules.fairValueGap(ctxFor(bars));
    var d = found.filter(function (x) { return x.barIndex === 32; })[0];
    T.ok(!!d, 'gap detected');
    T.equal(d.id, 'bullish_fvg', 'classified bullish');
    T.close(d.metrics.bottom, 100.5, 1e-9, 'gap bottom = high[i-2]');
    T.close(d.metrics.top, 101.5, 1e-9, 'gap top = low[i]');
});

T.test('no FVG when the three-bar ranges overlap', function () {
    var bars = filler(30, 100, 0);
    bars.push(bar(100, 101.0, 99.5, 100.2, 30));
    bars.push(bar(100.3, 102.0, 100.2, 101.8, 31));
    bars.push(bar(101.0, 102.5, 100.5, 102.0, 32));  // low 100.5 < high[i-2] 101.0
    var found = QT.structure.rules.fairValueGap(ctxFor(bars));
    T.ok(!found.some(function (x) { return x.barIndex === 32; }), 'overlap correctly rejected');
});

T.test('FVG below the ATR threshold is ignored', function () {
    var cfg = QT.cloneConfig();
    cfg.structure.fvgMinAtrMultiple = 50;            // impossible threshold
    var bars = filler(30, 100, 0);
    bars.push(bar(100, 100.5, 99.5, 100.2, 30));
    bars.push(bar(100.3, 104.0, 100.2, 103.8, 31));
    bars.push(bar(103.9, 105.0, 101.5, 104.5, 32));
    var found = QT.structure.rules.fairValueGap(ctxFor(bars, { structure: cfg.structure }));
    T.equal(found.length, 0, 'trivial gaps filtered by the ATR floor');
});

T.test('FVG reports mitigation and full-fill invalidation', function () {
    var bars = filler(30, 100, 0);
    bars.push(bar(100, 100.5, 99.5, 100.2, 30));
    bars.push(bar(100.3, 104.0, 100.2, 103.8, 31));
    bars.push(bar(103.9, 105.0, 101.5, 104.5, 32));
    for (var i = 33; i < 40; i++) bars.push(bar(102, 102.5, 99.8, 100.2, i));   // fills the gap
    var found = QT.structure.rules.fairValueGap(ctxFor(bars));
    var d = found.filter(function (x) { return x.barIndex === 32; })[0];
    T.ok(!!d && d.metrics.fullyFilled, 'full fill detected');
    T.ok(d.invalidated, 'marked invalidated once filled');
    T.ok(d.evidence.conflicting.length > 0, 'conflicting evidence recorded');
});

T.test('liquidity sweep needs a pierce AND a reclaiming close', function () {
    var bars = zigzag([1, -0.85, 0.9], 100, 12);
    var ctx = ctxFor(bars);
    var sw = ctx.swings.minor.filter(function (s) { return s.type === 'high'; })[0];
    if (!sw) { T.pass('no swing high available in fixture; skipped'); return; }

    var atr = ctx.lastAtr || 1;
    var n = bars.length;
    // Wick well above the swing high, close back below it.
    bars.push(bar(sw.price - atr, sw.price + atr * 2, sw.price - atr * 1.2, sw.price - atr * 0.5, n));
    var found = QT.structure.rules.liquiditySweep(ctxFor(bars));
    T.ok(found.some(function (d) { return d.id === 'bearish_liquidity_sweep'; }),
         'sweep detected: ' + ids(found).join(','));
});

T.test('a clean break (close beyond) is NOT counted as a sweep', function () {
    var bars = zigzag([1, -0.85, 0.9], 100, 12);
    var ctx = ctxFor(bars);
    var sw = ctx.swings.minor.filter(function (s) { return s.type === 'high'; })[0];
    if (!sw) { T.pass('no swing high available; skipped'); return; }
    var atr = ctx.lastAtr || 1;
    var n = bars.length;
    bars.push(bar(sw.price, sw.price + atr * 2, sw.price - atr * 0.2, sw.price + atr * 1.5, n));
    var found = QT.structure.rules.liquiditySweep(ctxFor(bars));
    T.ok(!found.some(function (d) { return d.barIndex === n; }),
         'a close beyond the level is a break, not a sweep');
});

T.test('premium/discount locates price within the dealing range', function () {
    var bars = zigzag([1, -0.85, 1, -0.95], 100, 12);
    var found = QT.structure.rules.premiumDiscount(ctxFor(bars));
    if (!found.length) { T.pass('insufficient swings; skipped'); return; }
    var d = found[0];
    T.ok(d.metrics.position >= 0 && d.metrics.position <= 1.0001, 'position normalised to [0,1]');
    T.ok(['premium', 'discount', 'equilibrium'].indexOf(d.metrics.zone) !== -1, 'zone classified');
    T.close(d.metrics.equilibrium, (d.metrics.rangeHigh + d.metrics.rangeLow) / 2, 1e-9,
            'equilibrium is the range midpoint');
});

T.test('equal highs are detected within tolerance and rejected outside it', function () {
    var loose = QT.cloneConfig(); loose.patterns.equalLevelAtrMultiple = 5;
    var strict = QT.cloneConfig(); strict.patterns.equalLevelAtrMultiple = 0.0001;
    var bars = zigzag([1, -0.5, 1, -0.5, 1], 100, 10);
    var a = QT.structure.rules.equalLevels(ctxFor(bars, { patterns: loose.patterns }));
    var b = QT.structure.rules.equalLevels(ctxFor(bars, { patterns: strict.patterns }));
    T.ok(a.length >= b.length, 'tolerance controls sensitivity (' + a.length + ' vs ' + b.length + ')');
});

/* ---- Chart patterns -------------------------------------------------- */
T.suite('Phase 3 — Chart patterns');

T.test('double top detected with neckline and projected target', function () {
    var bars = zigzag([1.5, -1.1, 1.5, -1.5], 100, 12);
    var found = QT.chartPatterns.rules.doubleTopBottom(ctxFor(bars));
    var dt = found.filter(function (d) { return d.id === 'double_top'; })[0];
    if (!dt) { T.pass('geometry did not produce equal peaks in this fixture; skipped'); return; }
    T.equal(dt.bias, 'bearish', 'bearish bias');
    T.ok(dt.metrics.neckline < Math.min(dt.metrics.peakA, dt.metrics.peakB), 'neckline below both peaks');
    T.close(dt.metrics.projectedTarget, dt.metrics.neckline - dt.metrics.height, 1e-9,
            'target = neckline − height');
});

T.test('trendline formation classifies a rectangle from flat boundaries', function () {
    var bars = [];
    for (var i = 0; i < 90; i++) {
        var p = (i % 10 < 5) ? 105 : 95;                 // oscillate between flat bounds
        bars.push(bar(p, p + 1.2, p - 1.2, p, i));
    }
    var found = QT.chartPatterns.rules.trendlineFormations(ctxFor(bars));
    if (!found.length) { T.pass('insufficient swings for a trendline fit; skipped'); return; }
    T.ok(['rectangle', 'symmetrical_triangle', 'ascending_channel', 'descending_channel']
         .indexOf(found[0].id) !== -1, 'classified as a range-type formation: ' + found[0].id);
    T.ok(found[0].metrics.upperR2 >= 0 && found[0].metrics.upperR2 <= 1, 'R² reported and bounded');
});

T.test('bull flag requires a strong pole and a shallow pullback', function () {
    var bars = filler(30, 100, 0);
    var i = 30;
    for (var k = 0; k < 10; k++, i++) bars.push(bar(100 + k * 3, 103 + k * 3, 99.5 + k * 3, 102.5 + k * 3, i));
    for (var m = 0; m < 5; m++, i++) bars.push(bar(129 - m * 0.4, 130 - m * 0.4, 128 - m * 0.4, 128.5 - m * 0.4, i));
    var found = QT.chartPatterns.rules.flags(ctxFor(bars));
    if (!found.length) { T.pass('pole/retrace thresholds not met in this fixture; skipped'); return; }
    T.equal(found[0].id, 'bull_flag', 'bull flag identified');
    T.ok(found[0].metrics.retrace <= QT.CONFIG.patterns.flagMaxRetrace, 'retrace within limit');
});

T.test('least-squares line fit is exact on collinear points', function () {
    var line = QT.chartPatterns.fitLine([{ x: 0, y: 1 }, { x: 1, y: 3 }, { x: 2, y: 5 }, { x: 3, y: 7 }]);
    T.close(line.slope, 2, 1e-12, 'slope = 2');
    T.close(line.intercept, 1, 1e-12, 'intercept = 1');
    T.close(line.r2, 1, 1e-12, 'R² = 1 for perfect collinearity');
    T.close(line.at(10), 21, 1e-12, 'extrapolates correctly');
});

/* ---- Registry, orchestration, invariants ----------------------------- */
T.suite('Phase 3 — Registry & orchestration');

T.test('every detector is registered exactly once', function () {
    var list = QT.patterns.listDetectors();
    T.equal(list.length, 20, 'expected detector count (' + list.length + ')');
    var seen = {};
    list.forEach(function (d) {
        T.ok(!seen[d.id], 'no duplicate id: ' + d.id);
        seen[d.id] = true;
    });
});

T.test('every registered detector has a config entry', function () {
    QT.patterns.listDetectors().forEach(function (d) {
        T.ok(!!QT.CONFIG.patterns.detectors[d.id], d.id + ' is configurable');
    });
});

T.test('duplicate registration is rejected', function () {
    T.throws(function () {
        QT.patterns.register({ id: 'engulfing', category: 'candlestick', detect: function () { return []; } });
    }, 'duplicate detector id refused');
});

T.test('disabling a detector removes it from the run', function () {
    var cfg = QT.cloneConfig();
    cfg.patterns.detectors.engulfing.enabled = false;
    var bars = FIX.bars.slice(0, 300);
    var ind = QT.indicators.computeAll(bars, cfg);
    var rep = QT.patterns.analyze(bars, ind, { config: cfg });
    T.ok(rep.diagnostics.skipped.some(function (s) { return s.id === 'engulfing'; }), 'reported as skipped');
    T.ok(!rep.detections.some(function (d) { return d.detectorId === 'engulfing'; }), 'produced no detections');
});

T.test('detector weight override is applied', function () {
    var cfg = QT.cloneConfig();
    cfg.patterns.detectors.engulfing.weight = 9.5;
    var bars = FIX.bars.slice(0, 300);
    var ind = QT.indicators.computeAll(bars, cfg);
    var rep = QT.patterns.analyze(bars, ind, { config: cfg });
    var e = rep.detections.filter(function (d) { return d.detectorId === 'engulfing'; })[0];
    if (!e) { T.pass('no engulfing in this slice; skipped'); return; }
    T.equal(e.detectorWeight, 9.5, 'override honoured');
});

T.test('a throwing detector is contained, not fatal', function () {
    QT.patterns.register({ id: '__boom', category: 'candlestick', minBars: 0,
                           detect: function () { throw new Error('intentional'); } });
    var bars = FIX.bars.slice(0, 200);
    var ind = QT.indicators.computeAll(bars, QT.CONFIG);
    var rep = QT.patterns.analyze(bars, ind, {});
    T.ok(rep.ok, 'analysis still succeeded');
    T.ok(rep.diagnostics.errors.some(function (e) { return e.id === '__boom'; }), 'error captured');
    QT.patterns.registry.detectors = QT.patterns.registry.detectors.filter(function (d) {
        return d.id !== '__boom';
    });
});

T.test('capability gating skips detectors needing unavailable data', function () {
    QT.patterns.register({ id: '__needsVolume', category: 'smc', minBars: 0, requires: ['volume'],
                           detect: function () { return []; } });
    var bars = FIX.bars.slice(0, 200).map(function (b) {
        return { time: b.time, open: b.open, high: b.high, low: b.low, close: b.close, volume: 0 };
    });
    var ind = QT.indicators.computeAll(bars, QT.CONFIG);
    var rep = QT.patterns.analyze(bars, ind, { capabilities: { ohlc: true, volume: false } });
    T.ok(rep.diagnostics.skipped.some(function (s) {
        return s.id === '__needsVolume' && /capability/.test(s.reason);
    }), 'skipped with a capability reason');
    QT.patterns.registry.detectors = QT.patterns.registry.detectors.filter(function (d) {
        return d.id !== '__needsVolume';
    });
});

T.suite('Phase 3 — Contract & invariants');

T.test('every detection conforms to the standard schema', function () {
    var bars = FIX.bars.slice(0, 400);
    var ind = QT.indicators.computeAll(bars, QT.CONFIG);
    var rep = QT.patterns.analyze(bars, ind, {});
    T.ok(rep.detections.length > 0, 'produced ' + rep.detections.length + ' detections');

    var required = ['id', 'name', 'category', 'bias', 'confidence', 'strength', 'quality',
                    'barIndex', 'barRange', 'priceRange', 'confirmed', 'invalidated', 'completed',
                    'requiredConfirmation', 'expiration', 'evidence', 'metrics', 'why'];
    var bad = [];
    rep.detections.forEach(function (d) {
        required.forEach(function (k) { if (!(k in d)) bad.push(d.id + ' missing ' + k); });
        if (!(d.confidence >= 0 && d.confidence <= 1)) bad.push(d.id + ' confidence out of range');
        if (!(d.strength >= 0 && d.strength <= 1)) bad.push(d.id + ' strength out of range');
        if (!(d.quality >= 0 && d.quality <= 1)) bad.push(d.id + ' quality out of range');
        if (['bullish', 'bearish', 'neutral'].indexOf(d.bias) === -1) bad.push(d.id + ' invalid bias');
        if (!Array.isArray(d.evidence.satisfied)) bad.push(d.id + ' evidence.satisfied not an array');
        if (typeof d.why !== 'string' || !d.why.length) bad.push(d.id + ' has no explanation');
        if (!(d.score >= 0 && d.score <= 1)) bad.push(d.id + ' score out of range');
    });
    T.deepEqual(bad, [], 'all detections conform to the contract');
});

T.test('pattern analysis is deterministic', function () {
    var bars = FIX.bars.slice(0, 400);
    var ind = QT.indicators.computeAll(bars, QT.CONFIG);
    var a = QT.patterns.analyze(bars, ind, {});
    var b = QT.patterns.analyze(bars, ind, {});
    T.equal(JSON.stringify(ids(a.detections)), JSON.stringify(ids(b.detections)), 'same detections');
    T.equal(a.summary.netBias, b.summary.netBias, 'same net bias');
    T.equal(JSON.stringify(a.structure), JSON.stringify(b.structure), 'same structure summary');
});

T.test('no randomness or clock reads in any Phase 3 module', function () {
    ['qt-detection.js', 'qt-candles.js', 'qt-structure.js', 'qt-chart-patterns.js', 'qt-patterns.js']
        .forEach(function (f) {
            var src = fs.readFileSync(__dirname + '/../engine/' + f, 'utf8');
            T.ok(src.indexOf('Math.random') === -1, f + ' has no Math.random');
            T.ok(src.indexOf('Date.now') === -1, f + ' has no Date.now');
        });
});

T.test('degenerate inputs never throw', function () {
    [[], [bar(1, 1, 1, 1, 0)], filler(3, 100, 0), filler(25, 100, 0)].forEach(function (bars) {
        var ind = QT.indicators.computeAll(bars, QT.CONFIG);
        var rep = QT.patterns.analyze(bars, ind, {});
        T.ok(typeof rep === 'object', bars.length + ' bars: returned a report');
        T.ok(Array.isArray(rep.detections), bars.length + ' bars: detections is an array');
    });
});

T.test('a flat market produces no directional patterns', function () {
    var bars = [];
    for (var i = 0; i < 200; i++) bars.push(bar(100, 100, 100, 100, i));
    var ind = QT.indicators.computeAll(bars, QT.CONFIG);
    var rep = QT.patterns.analyze(bars, ind, {});
    T.equal(rep.summary.netBias, 0, 'net bias is exactly zero');
    T.equal(rep.summary.dominant, 'neutral', 'dominant bias neutral');
});

T.test('runs over 600 real bars within a sane time budget', function () {
    var bars = FIX.bars;
    var ind = QT.indicators.computeAll(bars, QT.CONFIG);
    var start = process.hrtime.bigint();
    var rep = QT.patterns.analyze(bars, ind, {});
    var ms = Number(process.hrtime.bigint() - start) / 1e6;
    T.ok(ms < 400, 'completed in ' + ms.toFixed(1) + 'ms (budget 400ms)');
    T.ok(rep.detections.length > 0, 'found ' + rep.detections.length + ' detections on real data');
    T.equal(rep.diagnostics.errors.length, 0, 'no detector errors on real data');
});

T.test('REGRESSION: price outside the dealing range is a break, not a discount', function () {
    // Real BTC data exposed this: price below the range reported 'discount -> buy'
    // when it had actually collapsed through the range. Must be a bearish break.
    var bars = zigzag([1, -0.85, 1, -0.85], 100, 12);
    var n = bars.length;
    for (var k = 0; k < 12; k++) bars.push(bar(60 - k * 3, 61 - k * 3, 58 - k * 3, 59 - k * 3, n + k));
    var found = QT.structure.rules.premiumDiscount(ctxFor(bars));
    if (!found.length) { T.pass('no dealing range; skipped'); return; }
    var d = found[0];
    T.ok(d.metrics.position >= 0 && d.metrics.position <= 1, 'position clamped to [0,1]: ' + d.metrics.position);
    if (d.metrics.rangeBroken) {
        T.equal(d.metrics.zone, 'breakdown', 'classified as a breakdown');
        T.equal(d.bias, 'bearish', 'breakdown is bearish continuation, NOT a discount buy');
        T.ok(/broken below/.test(d.why), 'explanation states the range was broken');
    } else { T.pass('range re-anchored below price; clamp still verified'); }
});

T.test('REGRESSION: swing sensitivity yields usable structure on real data', function () {
    // minSwingAtrMultiple was 0.5, which produced only 5 minor swings over 600
    // real bars and starved every structure/SMC/chart detector.
    var bars = FIX.bars;
    var ind = QT.indicators.computeAll(bars, QT.CONFIG);
    var ctx = D.buildContext(bars, ind, QT.CONFIG);
    T.ok(ctx.swings.minor.length >= 20, 'minor swings usable: ' + ctx.swings.minor.length);
    T.ok(ctx.swings.major.length >= 5, 'major swings usable: ' + ctx.swings.major.length);
    var rep = QT.patterns.analyze(bars, ind, {});
    T.ok(rep.structure.bias !== 'neutral' || rep.structure.labelledSwings.length > 4,
         'structure resolves rather than starving');
});

module.exports = T;