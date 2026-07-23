/**
 * Phase 2 verification — Mathematical Indicator Engine.
 *
 * Three layers of assurance:
 *   1. Analytic tests   — closed-form cases where the correct answer is provable.
 *   2. Invariant tests  — bar alignment, NaN containment, determinism, edge cases.
 *   3. Regression lock  — golden values from 600 real BTC/USD daily bars, so any
 *                          future edit that changes a calculation fails loudly.
 *
 * Cross-validation against the `technicalindicators` package (30/30 series matched)
 * is documented in VALIDATION.md; that library is a test oracle only and is never
 * shipped, so this suite stays dependency-free.
 */
'use strict';

require('../engine/qt-config.js');
require('../engine/qt-utils.js');
require('../engine/qt-indicators.js');

var QT = globalThis.QT;
var I = QT.indicators;
var U = QT.utils;
var T = require('./harness.js');
var fs = require('fs');

var FIX = JSON.parse(fs.readFileSync(__dirname + '/fixtures/btcusd-1d.json', 'utf8'));
var GOLD = JSON.parse(fs.readFileSync(__dirname + '/fixtures/golden-indicators.json', 'utf8'));
var BARS = FIX.bars;
var CLOSE = U.pluck(BARS, 'close');

function tail(arr, n) {
    return (arr || []).filter(U.isFiniteNumber).slice(-(n || 3)).map(function (v) { return +v.toFixed(6); });
}
function bar(o, h, l, c, v, t) {
    return { time: t || 0, open: o, high: h, low: l, close: c, volume: v === undefined ? 0 : v };
}

T.suite('Phase 2 — Indicator Engine (analytic)');

/* ---- Closed-form cases -------------------------------------------- */
T.test('SMA of a constant series equals the constant', function () {
    var v = [5, 5, 5, 5, 5, 5];
    var out = I.sma(v, 3);
    T.equal(out[0], NaN, 'warm-up padded');
    T.close(out[5], 5, 1e-12, 'constant preserved');
});

T.test('SMA of an arithmetic ramp equals the window midpoint', function () {
    var v = [1, 2, 3, 4, 5, 6, 7];
    var out = I.sma(v, 3);
    T.close(out[2], 2, 1e-12, 'mean(1,2,3)=2');
    T.close(out[6], 6, 1e-12, 'mean(5,6,7)=6');
});

T.test('EMA seeds on the SMA and converges to a constant', function () {
    var v = [];
    for (var i = 0; i < 60; i++) v.push(10);
    var out = I.ema(v, 10);
    T.close(out[9], 10, 1e-12, 'seed equals SMA of first 10');
    T.close(out[59], 10, 1e-12, 'stays at the constant');

    // Known recurrence check on a step input.
    var step = [1, 1, 1, 1, 1, 11];
    var e = I.ema(step, 5);
    T.close(e[4], 1, 1e-12, 'seed = 1');
    T.close(e[5], 1 + (11 - 1) * (2 / 6), 1e-12, 'one EMA step matches k=2/(n+1)');
});

T.test('WMA weights the most recent value highest', function () {
    var out = I.wma([1, 2, 3], 3);
    T.close(out[2], (1 * 1 + 2 * 2 + 3 * 3) / 6, 1e-12, 'linear weights 1..n');
});

T.test('RSI is 100 for a monotonically rising series and 0 for falling', function () {
    var up = [], dn = [];
    for (var i = 0; i < 40; i++) { up.push(100 + i); dn.push(100 - i); }
    T.close(U.lastFinite(I.rsi(up, 14)), 100, 1e-9, 'all gains => 100');
    T.close(U.lastFinite(I.rsi(dn, 14)), 0, 1e-9, 'all losses => 0');
});

T.test('RSI of a flat series is neutral-by-definition (no losses)', function () {
    var flat = [];
    for (var i = 0; i < 40; i++) flat.push(50);
    var r = U.lastFinite(I.rsi(flat, 14));
    T.equal(r, 100, 'zero average loss yields 100 by the guard, not NaN');
});

T.test('ATR of constant-range bars equals that range', function () {
    var bars = [];
    for (var i = 0; i < 40; i++) bars.push(bar(10, 12, 8, 10, 100, i * 60000));
    T.close(U.lastFinite(I.atr(bars, 14)), 4, 1e-9, 'true range constant at 4');
});

T.test('Bollinger Bands collapse onto the mean when variance is zero', function () {
    var v = [];
    for (var i = 0; i < 40; i++) v.push(7);
    var bb = I.bollinger(v, 20, 2);
    T.close(U.lastFinite(bb.upper), 7, 1e-12, 'upper = mean');
    T.close(U.lastFinite(bb.lower), 7, 1e-12, 'lower = mean');
    T.close(U.lastFinite(bb.bandwidth), 0, 1e-12, 'bandwidth = 0');
});

T.test('Bollinger uses the POPULATION standard deviation', function () {
    var v = [2, 4, 4, 4, 5, 5, 7, 9];          // population sd = 2 exactly
    var bb = I.bollinger(v, 8, 1);
    T.close(bb.middle[7], 5, 1e-12, 'mean = 5');
    T.close(bb.upper[7], 7, 1e-12, 'mean + 1 population sd = 7');
    T.close(bb.lower[7], 3, 1e-12, 'mean - 1 population sd = 3');
});

T.test('Williams %R hits its bounds at range extremes', function () {
    var bars = [];
    for (var i = 0; i < 20; i++) bars.push(bar(10, 20, 0, 20, 100, i));
    T.close(U.lastFinite(I.williamsR(bars, 14)), 0, 1e-9, 'close at high => 0');
    bars[19] = bar(10, 20, 0, 0, 100, 19);
    T.close(U.lastFinite(I.williamsR(bars, 14)), -100, 1e-9, 'close at low => -100');
});

T.test('Stochastic %K is 100 at the top of its range', function () {
    var bars = [];
    for (var i = 0; i < 30; i++) bars.push(bar(10, 20, 0, 20, 100, i));
    T.close(U.lastFinite(I.stochastic(bars, 14, 3, 3).rawK), 100, 1e-9, 'close at highest high');
});

T.test('OBV accumulates signed volume', function () {
    var bars = [bar(1, 1, 1, 10, 0, 0), bar(1, 1, 1, 11, 100, 1),
                bar(1, 1, 1, 10, 50, 2), bar(1, 1, 1, 10, 30, 3)];
    var o = I.obv(bars);
    T.equal(o[1], 100, 'up bar adds volume');
    T.equal(o[2], 50, 'down bar subtracts volume');
    T.equal(o[3], 50, 'unchanged close leaves OBV flat');
});

T.test('Donchian channel excludes the current bar (non-repainting)', function () {
    var bars = [];
    for (var i = 0; i < 30; i++) bars.push(bar(10, 10 + i, 10 - i, 10, 100, i));
    var d = I.donchian(bars, 5);
    // At index 20 the channel must reflect bars 15..19 only, not bar 20.
    T.close(d.upper[20], 10 + 19, 1e-9, 'upper uses prior window high, not the current bar');
    T.ok(d.upper[20] < bars[20].high, 'current bar can therefore break its own channel');
});

T.test('CMF is +1 when every close is at the high, -1 at the low', function () {
    var up = [], dn = [], i;
    for (i = 0; i < 30; i++) up.push(bar(5, 10, 0, 10, 100, i));
    for (i = 0; i < 30; i++) dn.push(bar(5, 10, 0, 0, 100, i));
    T.close(U.lastFinite(I.cmf(up, 20)), 1, 1e-9, 'closes at high => +1');
    T.close(U.lastFinite(I.cmf(dn, 20)), -1, 1e-9, 'closes at low => -1');
});

T.test('VWMA equals SMA when volume is uniform', function () {
    var closes = [1, 2, 3, 4, 5, 6], vols = [7, 7, 7, 7, 7, 7];
    var vw = I.vwma(closes, vols, 3), sm = I.sma(closes, 3);
    T.close(vw[5], sm[5], 1e-12, 'uniform volume degenerates to SMA');
});

T.test('VWMA weights toward high-volume bars', function () {
    var closes = [10, 20], vols = [1, 99];
    var vw = I.vwma(closes, vols, 2);
    T.close(vw[1], (10 * 1 + 20 * 99) / 100, 1e-12, 'volume-weighted average');
    T.ok(vw[1] > 15, 'pulled toward the heavy bar');
});

T.test('VWAP resets on each UTC day', function () {
    var day = 86400000;
    var bars = [bar(10, 10, 10, 10, 100, 0), bar(20, 20, 20, 20, 100, 3600000),
                bar(50, 50, 50, 50, 100, day)];
    var v = I.vwap(bars);
    T.close(v[1], 15, 1e-9, 'accumulates within the day');
    T.close(v[2], 50, 1e-9, 'resets at the day boundary');
});

T.test('Pivot points follow the classic floor-trader formula', function () {
    var p = I.pivotPoints(110, 90, 100);
    T.close(p.pivot, 100, 1e-12, 'P = (H+L+C)/3');
    T.close(p.r1, 110, 1e-12, 'R1 = 2P - L');
    T.close(p.s1, 90, 1e-12, 'S1 = 2P - H');
    T.close(p.r2, 120, 1e-12, 'R2 = P + (H-L)');
    T.close(p.s2, 80, 1e-12, 'S2 = P - (H-L)');
});

T.test('SuperTrend flips direction and tracks the correct band', function () {
    var bars = [], i;
    for (i = 0; i < 40; i++) bars.push(bar(100, 101, 99, 100, 100, i * 60000));   // flat
    for (i = 40; i < 70; i++) bars.push(bar(100 + i, 101 + i, 99 + i, 100 + i, 100, i * 60000)); // rally
    var st = I.superTrend(bars, 10, 3);
    T.equal(U.lastFinite(st.direction), 1, 'turns bullish in a rally');
    T.ok(U.lastFinite(st.line) < bars[bars.length - 1].close, 'bullish line sits below price');
});

T.test('Ichimoku cloud values are read at the correct displaced index', function () {
    var bars = [];
    for (var i = 0; i < 120; i++) bars.push(bar(10, 10 + i, 10, 10 + i, 100, i));
    var ich = I.ichimoku(bars, 9, 26, 52, 26);
    var idx = 100;
    T.close(ich.spanAAt[idx], ich.spanA[idx - 26], 1e-12, 'spanAAt[i] = spanA[i-26]');
    T.close(ich.spanBAt[idx], ich.spanB[idx - 26], 1e-12, 'spanBAt[i] = spanB[i-26]');
});

T.test('Volume profile POC lands in the heaviest price bin', function () {
    var bars = [], i;
    for (i = 0; i < 50; i++) bars.push(bar(100, 101, 99, 100, 10, i));       // light, wide
    for (i = 0; i < 50; i++) bars.push(bar(120, 120.5, 119.5, 120, 500, 50 + i)); // heavy, tight
    var vp = I.volumeProfile(bars, 20, 0.7);
    T.ok(vp.poc > 118 && vp.poc < 122, 'POC near the heavy cluster (' + vp.poc.toFixed(2) + ')');
    T.ok(vp.valueAreaHigh >= vp.poc && vp.valueAreaLow <= vp.poc, 'value area brackets POC');
});

/* ---- Invariants --------------------------------------------------- */
T.suite('Phase 2 — Invariants');

T.test('every series is bar-aligned to the input length', function () {
    var all = I.computeAll(BARS, QT.CONFIG);
    var n = BARS.length;
    var checks = {
        emaFast: all.emaFast, emaSlow: all.emaSlow, rsi: all.rsi, atr: all.atr,
        cci: all.cci, roc: all.roc, williamsR: all.williamsR, obv: all.obv,
        mfi: all.mfi, cmf: all.cmf, vwap: all.vwap,
        macd: all.macd.macd, macdSignal: all.macd.signal, macdHist: all.macd.histogram,
        adx: all.adx.adx, plusDI: all.adx.plusDI,
        bbUpper: all.bollinger.upper, stochK: all.stochastic.k,
        superTrend: all.superTrend.line, psar: all.psar.sar,
        ichiConv: all.ichimoku.conversion
    };
    Object.keys(checks).forEach(function (k) {
        T.equal(checks[k].length, n, k + ' length matches bar count');
    });
});

T.test('no NaN appears after an indicator has warmed up', function () {
    var all = I.computeAll(BARS, QT.CONFIG);
    function contiguous(name, arr) {
        var started = false, holes = 0;
        for (var i = 0; i < arr.length; i++) {
            if (U.isFiniteNumber(arr[i])) started = true;
            else if (started) holes++;
        }
        T.equal(holes, 0, name + ' has no NaN holes after warm-up');
    }
    contiguous('rsi', all.rsi);
    contiguous('atr', all.atr);
    contiguous('adx', all.adx.adx);
    contiguous('macd', all.macd.macd);
    contiguous('bollinger', all.bollinger.upper);
    contiguous('superTrend', all.superTrend.line);
    contiguous('cci', all.cci);
    contiguous('mfi', all.mfi);
});

T.test('engine is deterministic — identical input yields identical output', function () {
    var a = I.computeAll(BARS, QT.CONFIG);
    var b = I.computeAll(BARS, QT.CONFIG);
    T.equal(JSON.stringify(tail(a.rsi, 50)), JSON.stringify(tail(b.rsi, 50)), 'rsi identical');
    T.equal(JSON.stringify(tail(a.adx.adx, 50)), JSON.stringify(tail(b.adx.adx, 50)), 'adx identical');
    T.equal(JSON.stringify(tail(a.superTrend.line, 50)), JSON.stringify(tail(b.superTrend.line, 50)),
            'supertrend identical');
    T.equal(JSON.stringify(a.pivots), JSON.stringify(b.pivots), 'pivots identical');
});

T.test('no randomness or wall-clock reads in the indicator module', function () {
    var src = fs.readFileSync(__dirname + '/../engine/qt-indicators.js', 'utf8');
    T.ok(src.indexOf('Math.random') === -1, 'no Math.random');
    T.ok(src.indexOf('Date.now') === -1, 'no Date.now');
    T.ok(!/new Date\(\)/.test(src), 'no implicit clock reads');
});

T.test('short and degenerate series degrade safely instead of throwing', function () {
    [0, 1, 2, 5].forEach(function (n) {
        var bars = [];
        for (var i = 0; i < n; i++) bars.push(bar(10, 11, 9, 10, 100, i * 60000));
        var all = I.computeAll(bars, QT.CONFIG);
        T.equal(all.rsi.length, n, n + ' bars: rsi length matches');
        T.ok(all.rsi.every(function (v) { return !U.isFiniteNumber(v); }) || n > 14,
             n + ' bars: no fabricated values before warm-up');
    });
});

T.test('zero-volume instruments do not produce fabricated volume readings', function () {
    var bars = BARS.slice(0, 300).map(function (b) {
        return { time: b.time, open: b.open, high: b.high, low: b.low, close: b.close, volume: 0 };
    });
    var all = I.computeAll(bars, QT.CONFIG);
    T.equal(all.meta.hasVolume, false, 'volume absence detected');
    T.ok(all.obv.every(function (v) { return !U.isFiniteNumber(v); }), 'OBV suppressed, not zero-filled');
    T.equal(all.volumeProfile, null, 'volume profile omitted rather than faked');
    T.ok(U.isFiniteNumber(U.lastFinite(all.rsi)), 'price-only indicators still computed');
});

T.test('flat market produces no NaN and no division blow-ups', function () {
    var bars = [];
    for (var i = 0; i < 300; i++) bars.push(bar(100, 100, 100, 100, 100, i * 60000));
    var all = I.computeAll(bars, QT.CONFIG);
    T.ok(U.isFiniteNumber(U.lastFinite(all.rsi)), 'rsi finite');
    T.ok(U.isFiniteNumber(U.lastFinite(all.cci)), 'cci finite (zero mean deviation guarded)');
    T.close(U.lastFinite(all.bollinger.bandwidth), 0, 1e-9, 'bandwidth zero');
    T.close(U.lastFinite(all.atr), 0, 1e-9, 'atr zero');
    T.close(U.lastFinite(all.stochastic.rawK), 50, 1e-9, 'stochastic guarded to midpoint');
});

/* ---- Regression lock ----------------------------------------------- */
T.suite('Phase 2 — Regression lock (600 real BTC/USD daily bars)');

T.test('indicator outputs match the locked golden values', function () {
    var all = I.computeAll(BARS, QT.CONFIG);
    var actual = {
        emaFast: tail(all.emaFast), emaMid: tail(all.emaMid), emaSlow: tail(all.emaSlow),
        wma: tail(all.wma), vwma: tail(all.vwma),
        rsi: tail(all.rsi), rsiFast: tail(all.rsiFast),
        macd: tail(all.macd.macd), macdSignal: tail(all.macd.signal), macdHist: tail(all.macd.histogram),
        cci: tail(all.cci), roc: tail(all.roc), momentum: tail(all.momentum),
        stochK: tail(all.stochastic.k), stochD: tail(all.stochastic.d), williamsR: tail(all.williamsR),
        atr: tail(all.atr), adx: tail(all.adx.adx), plusDI: tail(all.adx.plusDI), minusDI: tail(all.adx.minusDI),
        bbUpper: tail(all.bollinger.upper), bbLower: tail(all.bollinger.lower),
        bbBandwidth: tail(all.bollinger.bandwidth), bbPercentB: tail(all.bollinger.percentB),
        keltnerUpper: tail(all.keltner.upper), keltnerLower: tail(all.keltner.lower),
        donchian50Upper: tail(all.donchian[50].upper), donchian50Lower: tail(all.donchian[50].lower),
        realizedVol: tail(all.realizedVol),
        obv: tail(all.obv), mfi: tail(all.mfi), cmf: tail(all.cmf),
        vwap: tail(all.vwap), relVol: tail(all.relativeVolume),
        superTrendLine: tail(all.superTrend.line), superTrendDir: tail(all.superTrend.direction),
        psar: tail(all.psar.sar),
        ichiConv: tail(all.ichimoku.conversion), ichiBase: tail(all.ichimoku.base),
        ichiSpanAAt: tail(all.ichimoku.spanAAt), ichiSpanBAt: tail(all.ichimoku.spanBAt)
    };
    Object.keys(actual).forEach(function (k) {
        T.deepEqual(actual[k], GOLD[k], k + ' unchanged');
    });
    var piv = {};
    Object.keys(all.pivots).forEach(function (k) { piv[k] = +all.pivots[k].toFixed(6); });
    T.deepEqual(piv, GOLD.pivots, 'pivot points unchanged');
    T.deepEqual({ poc: +all.volumeProfile.poc.toFixed(4),
                  vah: +all.volumeProfile.valueAreaHigh.toFixed(4),
                  val: +all.volumeProfile.valueAreaLow.toFixed(4) },
                GOLD.volumeProfile, 'volume profile unchanged');
});

T.test('fixture itself is intact (guards against silent data drift)', function () {
    T.equal(BARS.length, GOLD.bars, 'bar count matches the golden generation run');
    var sum = 0;
    for (var i = 0; i < BARS.length; i++) sum += BARS[i].close;
    T.close(sum, 25186829.56, 0.01, 'fixture close-sum checksum');
});

module.exports = T;
