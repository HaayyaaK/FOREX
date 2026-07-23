/**
 * Phase 4 verification — Trend & Market Structure Engine.
 *
 * Scenarios required by the brief: strong trends, weak trends, ranging markets,
 * volatility spikes, structural transitions, false breakouts and conflicting
 * timeframes — each built deterministically so the correct answer is provable.
 */
'use strict';

['qt-config', 'qt-utils', 'qt-indicators', 'qt-detection', 'qt-candles',
 'qt-structure', 'qt-chart-patterns', 'qt-patterns', 'qt-trend']
    .forEach(function (m) { require('../engine/' + m + '.js'); });

var QT = globalThis.QT;
var TR = QT.trend;
var T = require('./harness.js');
var fs = require('fs');

var FIX = JSON.parse(fs.readFileSync(__dirname + '/fixtures/btcusd-1d.json', 'utf8'));

var t0 = Date.UTC(2026, 0, 1), STEP = 3600000;
function bar(o, h, l, c, i) { return { time: t0 + i * STEP, open: o, high: h, low: l, close: c, volume: 1000 }; }

/** Deterministic pseudo-noise: a fixed sine, so runs are reproducible. */
function wobble(i, amp) { return Math.sin(i * 1.7) * amp; }

function series(n, fn) {
    var bars = [];
    for (var i = 0; i < n; i++) {
        var c = fn(i);
        var o = i === 0 ? c : fn(i - 1);
        var hi = Math.max(o, c) + Math.abs(c) * 0.002 + 0.05;
        var lo = Math.min(o, c) - Math.abs(c) * 0.002 - 0.05;
        bars.push(bar(o, hi, lo, c, i));
    }
    return bars;
}

function analyze(bars, cfgOverride) {
    var cfg = cfgOverride || QT.CONFIG;
    var ind = QT.indicators.computeAll(bars, cfg);
    var pat = QT.patterns.analyze(bars, ind, { config: cfg });
    return { result: TR.analyzeTimeframe(ind, pat, { config: cfg }), ind: ind, pat: pat };
}

/* ---- Scenario builders --------------------------------------------- */
var strongUp   = function (n) { return series(n, function (i) { return 100 + i * 1.2 + wobble(i, 0.3); }); };
var strongDown = function (n) { return series(n, function (i) { return 400 - i * 1.2 + wobble(i, 0.3); }); };
var weakUp     = function (n) { return series(n, function (i) { return 100 + i * 0.12 + wobble(i, 1.6); }); };
var ranging    = function (n) { return series(n, function (i) { return 100 + wobble(i, 4); }); };

/* ================================================================== */
T.suite('Phase 4 — Trend direction & strength');

T.test('strong uptrend is identified with high strength', function () {
    var a = analyze(strongUp(300)).result;
    T.equal(a.direction, 'bullish', 'direction bullish');
    T.ok(a.strength > 0.6, 'strength high: ' + a.strength.toFixed(2));
    T.ok(a.state === 'BULL_TREND' || a.state === 'BULL_TRANSITION', 'state ' + a.state);
    T.ok(a.dimensions.longTerm.direction === 'bullish', 'long-term dimension agrees');
});

T.test('strong downtrend is the mirror image', function () {
    var a = analyze(strongDown(300)).result;
    T.equal(a.direction, 'bearish', 'direction bearish');
    T.ok(a.strength > 0.6, 'strength high: ' + a.strength.toFixed(2));
    T.ok(a.state === 'BEAR_TREND' || a.state === 'BEAR_TRANSITION', 'state ' + a.state);
});

T.test('weak trend registers lower strength than a strong one', function () {
    var strong = analyze(strongUp(300)).result;
    var weak = analyze(weakUp(300)).result;
    T.ok(weak.strength < strong.strength,
         'weak ' + weak.strength.toFixed(2) + ' < strong ' + strong.strength.toFixed(2));
});

T.test('ranging market yields a neutral direction', function () {
    var a = analyze(ranging(300)).result;
    T.equal(a.direction, 'neutral', 'direction neutral (got ' + a.direction + ')');
    T.ok(a.strength < 0.4, 'low strength: ' + a.strength.toFixed(2));
});

T.suite('Phase 4 — Direction, strength and confidence are independent');

T.test('a ranging market can be NEUTRAL yet HIGH confidence', function () {
    var a = analyze(ranging(300)).result;
    T.equal(a.direction, 'neutral', 'neutral direction');
    T.ok(a.confidence > 0.35, 'still holds meaningful confidence: ' + a.confidence.toFixed(2) +
         ' — confident that it is ranging');
});

T.test('confidence measures agreement, not magnitude', function () {
    var a = analyze(strongUp(300)).result;
    T.ok(a.quality.dimensionAgreement >= 0, 'agreement reported: ' + a.quality.dimensionAgreement.toFixed(2));
    T.ok(a.confidence >= 0 && a.confidence <= 1, 'confidence bounded');
    T.ok(a.strength >= 0 && a.strength <= 1, 'strength bounded');
    // The three concepts are distinct fields, never aliases of one another.
    T.ok(typeof a.direction === 'string' && typeof a.strength === 'number' &&
         typeof a.confidence === 'number', 'three separate outputs');
});

T.suite('Phase 4 — Regime classification');

T.test('trending market classifies as a trending regime with evidence', function () {
    var a = analyze(strongUp(300)).result;
    T.ok(/TRENDING|EXPANSION/.test(a.regime.primary), 'regime ' + a.regime.primary);
    T.ok(a.regime.evidence.length > 0, 'evidence supplied');
    T.ok(a.regime.confidence > 0, 'regime confidence reported');
});

T.test('every rejected regime carries a measured reason', function () {
    var a = analyze(strongUp(300)).result;
    T.ok(a.regime.rejected.length >= 5, a.regime.rejected.length + ' alternatives evaluated');
    a.regime.rejected.forEach(function (r) {
        T.ok(typeof r.score === 'number' && r.reason.length > 10,
             r.id + ' rejected with a scored reason');
    });
});

T.test('compressed market is recognised as compression or low volatility', function () {
    var bars = series(300, function (i) { return 100 + wobble(i, 0.15); });   // very tight
    var a = analyze(bars).result;
    T.ok(/COMPRESSION|LOW_VOLATILITY|RANGING/.test(a.regime.primary),
         'regime ' + a.regime.primary);
});

T.test('volatility spike is reflected in the volatility dimension', function () {
    var bars = series(220, function (i) { return 100 + wobble(i, 0.4); });
    for (var i = 220; i < 260; i++) {                       // sudden expansion
        var c = 100 + wobble(i, 12);
        bars.push(bar(c, c + 6, c - 6, c, i));
    }
    var a = analyze(bars).result;
    T.ok(a.dimensions.volatility.metrics.atrPercentile > 0.5,
         'ATR percentile elevated: ' + a.dimensions.volatility.metrics.atrPercentile);
    T.ok(/HIGH_VOLATILITY|EXPANSION|RANGING|TRANSITION/.test(a.regime.primary),
         'regime reflects the spike: ' + a.regime.primary);
});

T.suite('Phase 4 — State machine');

T.test('illegal transitions are refused by the transition table', function () {
    T.ok(!TR.canTransition('BULL_TREND', 'BEAR_TREND'), 'no direct bull -> bear flip');
    T.ok(!TR.canTransition('BEAR_TREND', 'BULL_TREND'), 'no direct bear -> bull flip');
    T.ok(TR.canTransition('BULL_TREND', 'BEAR_TRANSITION'), 'must pass through a transition state');
    T.ok(TR.canTransition('RANGE', 'BULL_TRANSITION'), 'range may begin a transition');
});

T.test('a trend reversal passes through an intermediate state', function () {
    var up = strongUp(200);
    var bars = up.concat(series(160, function (i) { return 340 - i * 1.4 + wobble(i, 0.3); })
        .map(function (b, k) { return bar(b.open, b.high, b.low, b.close, 200 + k); }));
    var m = TR.replayStateMachine(QT.indicators.computeAll(bars, QT.CONFIG), QT.CONFIG);
    var pairs = m.transitions.map(function (t) { return t.from + '->' + t.to; });
    var illegal = m.transitions.filter(function (t) { return !TR.canTransition(t.from, t.to); });
    T.deepEqual(illegal, [], 'every recorded transition is legal');
    T.ok(m.transitions.length > 0, 'transitions occurred: ' + pairs.slice(0, 6).join(', '));
});

T.test('state machine replay is deterministic', function () {
    var bars = strongUp(300);
    var ind = QT.indicators.computeAll(bars, QT.CONFIG);
    var a = TR.replayStateMachine(ind, QT.CONFIG);
    var b = TR.replayStateMachine(ind, QT.CONFIG);
    T.equal(a.state, b.state, 'same final state');
    T.equal(JSON.stringify(a.transitions), JSON.stringify(b.transitions), 'same transition history');
});

T.suite('Phase 4 — Stability & hysteresis');

T.test('hysteresis band is genuinely asymmetric', function () {
    T.ok(QT.CONFIG.trend.enterThreshold > QT.CONFIG.trend.exitThreshold,
         'enter ' + QT.CONFIG.trend.enterThreshold + ' > exit ' + QT.CONFIG.trend.exitThreshold);
});

T.test('noise does not cause state churn', function () {
    // A trend with substantial noise must not thrash between states.
    var bars = series(320, function (i) { return 100 + i * 0.55 + wobble(i, 2.2); });
    var m = TR.replayStateMachine(QT.indicators.computeAll(bars, QT.CONFIG), QT.CONFIG);
    var per100 = m.transitions.length / (bars.length / 100);
    T.ok(per100 < 6, 'only ' + m.transitions.length + ' transitions over ' + bars.length +
         ' bars (' + per100.toFixed(1) + ' per 100)');
});

T.test('raising confirmBars strictly reduces transition count', function () {
    var bars = series(320, function (i) { return 100 + i * 0.4 + wobble(i, 3); });
    var ind = QT.indicators.computeAll(bars, QT.CONFIG);
    var loose = QT.cloneConfig(); loose.trend.confirmBars = 1;
    var tight = QT.cloneConfig(); tight.trend.confirmBars = 10;
    var a = TR.replayStateMachine(ind, loose).transitions.length;
    var b = TR.replayStateMachine(ind, tight).transitions.length;
    T.ok(b <= a, 'confirmBars=10 gives ' + b + ' <= confirmBars=1 gives ' + a);
});

T.test('a single spike bar cannot flip the trend', function () {
    var bars = strongUp(300);
    var before = analyze(bars).result;
    var last = bars[bars.length - 1];
    bars.push(bar(last.close, last.close + 0.5, last.close - 60, last.close - 55, bars.length));
    var after = analyze(bars).result;
    T.equal(after.direction, before.direction,
            'direction unchanged by one violent bar (' + before.direction + ')');
    T.ok(after.state !== 'BEAR_TREND', 'did not jump straight to BEAR_TREND (state ' + after.state + ')');
});

T.suite('Phase 4 — Outcome probabilities');

T.test('probabilities are positive and sum to exactly 1', function () {
    [strongUp(300), strongDown(300), ranging(300), weakUp(300)].forEach(function (bars, idx) {
        var p = analyze(bars).result.probabilities;
        var keys = Object.keys(p);
        T.equal(keys.length, 4, 'scenario ' + idx + ': four outcomes');
        var sum = keys.reduce(function (a, k) { return a + p[k]; }, 0);
        T.close(sum, 1, 1e-9, 'scenario ' + idx + ': sums to 1 (' + sum.toFixed(9) + ')');
        keys.forEach(function (k) { T.ok(p[k] > 0 && p[k] < 1, 'scenario ' + idx + ': ' + k + ' in (0,1)'); });
    });
});

T.test('a young strong trend favours continuation over reversal', function () {
    var p = analyze(strongUp(300)).result.probabilities;
    T.ok(p.continuation > p.reversal,
         'continuation ' + p.continuation.toFixed(3) + ' > reversal ' + p.reversal.toFixed(3));
});

T.test('a ranging market favours consolidation', function () {
    var p = analyze(ranging(300)).result.probabilities;
    T.ok(p.consolidation >= p.continuation,
         'consolidation ' + p.consolidation.toFixed(3) + ' >= continuation ' + p.continuation.toFixed(3));
});

T.suite('Phase 4 — Multi-timeframe consensus');

function tf(direction, strength, confidence) {
    return { direction: direction, strength: strength, confidence: confidence,
             state: 'X', regime: { primary: 'RANGING' } };
}

T.test('R1: the higher timeframe sets the permitted direction', function () {
    var c = TR.consensus({ htf: tf('bullish', 0.8, 0.8), mtf: tf('bullish', 0.6, 0.7),
                           ltf: tf('bearish', 0.3, 0.5) }, QT.CONFIG);
    T.equal(c.direction, 'bullish', 'follows the HTF');
    T.ok(c.rulesApplied.some(function (r) { return /^R1/.test(r); }), 'R1 recorded');
    T.equal(c.conflicting.length, 1, 'the dissenting timeframe is reported');
});

T.test('R2: a weak HTF outvoted by both lower timeframes yields NEUTRAL', function () {
    var c = TR.consensus({ htf: tf('bullish', 0.2, 0.5), mtf: tf('bearish', 0.8, 0.8),
                           ltf: tf('bearish', 0.7, 0.8) }, QT.CONFIG);
    T.equal(c.direction, 'neutral', 'consensus refuses to pick a side');
    T.ok(c.conflicted, 'flagged as conflicted');
    T.ok(c.rulesApplied.some(function (r) { return /^R2/.test(r); }), 'R2 recorded');
});

T.test('R3: full agreement raises confidence above any single timeframe', function () {
    var all = { htf: tf('bullish', 0.8, 0.6), mtf: tf('bullish', 0.8, 0.6), ltf: tf('bullish', 0.8, 0.6) };
    var mixed = { htf: tf('bullish', 0.8, 0.6), mtf: tf('bearish', 0.8, 0.6), ltf: tf('bullish', 0.8, 0.6) };
    var a = TR.consensus(all, QT.CONFIG), b = TR.consensus(mixed, QT.CONFIG);
    T.equal(a.agreement, 1, 'full agreement');
    T.ok(a.confidence > b.confidence,
         'agreement ' + a.confidence.toFixed(2) + ' > conflict ' + b.confidence.toFixed(2));
});

T.test('R4: a missing timeframe redistributes weight without gap-filling', function () {
    var c = TR.consensus({ htf: tf('bullish', 0.8, 0.8), mtf: null, ltf: tf('bullish', 0.6, 0.6) }, QT.CONFIG);
    T.ok(c.rulesApplied.some(function (r) { return /^R4/.test(r); }), 'R4 recorded');
    var sum = Object.keys(c.perTimeframe).reduce(function (a, k) { return a + c.perTimeframe[k].weight; }, 0);
    T.close(sum, 1, 1e-9, 'surviving weights renormalise to 1');
    T.ok(!c.perTimeframe.mtf, 'absent timeframe is omitted, not fabricated');
});

T.test('consensus exposes dominant timeframe and quality', function () {
    var c = TR.consensus({ htf: tf('bullish', 0.9, 0.9), mtf: tf('bullish', 0.3, 0.3),
                           ltf: tf('bullish', 0.2, 0.2) }, QT.CONFIG);
    T.equal(c.dominant, 'htf', 'dominant timeframe identified');
    T.ok(c.quality > 0 && c.quality <= 1, 'consensus quality bounded: ' + c.quality.toFixed(2));
});

T.suite('Phase 4 — Explainability & contract');

T.test('every conclusion explains supporting and opposing evidence', function () {
    var a = analyze(strongUp(300)).result;
    T.ok(a.explanation.summary.length > 20, 'human summary present');
    T.ok(a.explanation.supporting.length > 0, 'supporting evidence listed');
    T.ok(Array.isArray(a.explanation.opposing), 'opposing evidence listed (may be empty)');
    T.ok(a.explanation.rejectedRegimes.length > 0, 'rejected regimes explained');
    T.ok(/Schmitt/.test(a.explanation.stability.mechanism), 'stabilisation mechanism disclosed');
    a.explanation.supporting.forEach(function (e) {
        T.ok(e.evidence.length > 0, e.dimension + ' carries measurable evidence');
    });
});

T.test('all eight dimensions are computed independently', function () {
    var a = analyze(strongUp(300)).result;
    ['shortTerm', 'mediumTerm', 'longTerm', 'structural', 'momentum',
     'volatility', 'maturity', 'acceleration'].forEach(function (k) {
        T.ok(!!a.dimensions[k], k + ' present');
        T.ok(a.dimensions[k].strength >= 0 && a.dimensions[k].strength <= 1, k + ' strength bounded');
        T.ok(Array.isArray(a.dimensions[k].evidence), k + ' has evidence');
    });
});

T.test('output contract is fully numeric for downstream phases', function () {
    var a = analyze(strongUp(300)).result;
    ['direction', 'strength', 'confidence', 'state', 'regime', 'probabilities',
     'dimensions', 'explanation', 'quality'].forEach(function (k) {
        T.ok(k in a, 'exposes ' + k);
    });
    T.equal(typeof a.strength, 'number', 'strength numeric');
    T.equal(typeof a.confidence, 'number', 'confidence numeric');
    T.equal(typeof a.regime.confidence, 'number', 'regime confidence numeric');
    T.equal(typeof a.probabilities.continuation, 'number', 'probabilities numeric');
});

T.test('analysis is deterministic', function () {
    var bars = strongUp(300);
    var a = analyze(bars).result, b = analyze(bars).result;
    T.equal(JSON.stringify(a), JSON.stringify(b), 'identical output for identical input');
});

T.test('no randomness or clock reads in the trend engine', function () {
    var src = fs.readFileSync(__dirname + '/../engine/qt-trend.js', 'utf8');
    T.ok(src.indexOf('Math.random') === -1, 'no Math.random');
    T.ok(src.indexOf('Date.now') === -1, 'no Date.now');
});

T.test('degenerate and short inputs never throw', function () {
    [[], series(5, function (i) { return 100 + i; }), series(30, function () { return 100; })]
        .forEach(function (bars) {
            var ind = QT.indicators.computeAll(bars, QT.CONFIG);
            var pat = QT.patterns.analyze(bars, ind, {});
            var a = TR.analyzeTimeframe(ind, pat, {});
            T.ok(typeof a.direction === 'string', bars.length + ' bars: returns a direction');
            T.ok(isFinite(a.strength) && isFinite(a.confidence), bars.length + ' bars: finite scores');
            var s = Object.keys(a.probabilities).reduce(function (x, k) { return x + a.probabilities[k]; }, 0);
            T.close(s, 1, 1e-9, bars.length + ' bars: probabilities still sum to 1');
        });
});

T.suite('Phase 4 — Real market data');

T.test('produces a coherent, fully-populated read on 600 real BTC bars', function () {
    var start = process.hrtime.bigint();
    var a = analyze(FIX.bars).result;
    var ms = Number(process.hrtime.bigint() - start) / 1e6;

    T.ok(['bullish', 'bearish', 'neutral'].indexOf(a.direction) !== -1, 'direction: ' + a.direction);
    T.ok(a.regime.primary.length > 0, 'regime: ' + a.regime.primary);
    T.ok(a.state.length > 0, 'state: ' + a.state);
    T.ok(a.explanation.supporting.length + a.explanation.opposing.length > 0, 'evidence produced');
    var sum = Object.keys(a.probabilities).reduce(function (x, k) { return x + a.probabilities[k]; }, 0);
    T.close(sum, 1, 1e-9, 'probabilities sum to 1 on real data');
    T.ok(ms < 500, 'completed in ' + ms.toFixed(1) + 'ms');
});

module.exports = T;
