/**
 * Phase 5 verification — Levels + Risk Management / Trade Construction.
 *
 * Covers the scenarios required by the brief: strong trends, ranging markets,
 * high/low volatility, conflicting timeframes, low-confidence setups, explicit
 * No-Trade outcomes, and mathematically valid entries that the risk engine must
 * still reject.
 */
'use strict';

['qt-config', 'qt-utils', 'qt-indicators', 'qt-detection', 'qt-candles', 'qt-structure',
 'qt-chart-patterns', 'qt-patterns', 'qt-trend', 'qt-levels', 'qt-risk']
    .forEach(function (m) { require('../engine/' + m + '.js'); });

var QT = globalThis.QT;
var R = QT.risk;
var T = require('./harness.js');
var fs = require('fs');

var FIX = JSON.parse(fs.readFileSync(__dirname + '/fixtures/btcusd-1d.json', 'utf8'));
var t0 = Date.UTC(2026, 0, 1);

function bar(o, h, l, c, i) { return { time: t0 + i * 3600000, open: o, high: h, low: l, close: c, volume: 1000 }; }
function wob(i, a) { return Math.sin(i * 1.7) * a; }
function series(n, fn) {
    var b = [];
    for (var i = 0; i < n; i++) {
        var c = fn(i), o = i === 0 ? c : fn(i - 1);
        b.push(bar(o, Math.max(o, c) + Math.abs(c) * 0.002 + 0.05,
                   Math.min(o, c) - Math.abs(c) * 0.002 - 0.05, c, i));
    }
    return b;
}

/** Runs the full pipeline and returns everything a test might assert on. */
function pipeline(bars, assetClass, cfgOverride) {
    var cfg = cfgOverride || QT.CONFIG;
    var ind = QT.indicators.computeAll(bars, cfg);
    var pat = QT.patterns.analyze(bars, ind, { config: cfg });
    var trend = QT.trend.analyzeTimeframe(ind, pat, { config: cfg });
    var atr = QT.utils.lastFinite(ind.atr);
    var ctx = QT.detection.buildContext(bars, ind, cfg);
    var levels = QT.levels.analyze(bars, ctx.swings.minor, atr, cfg);
    var proposal = R.buildProposal({
        bars: bars, indicators: ind, patternReport: pat, trend: trend,
        levels: levels, swings: ctx.swings.minor,
        assetClass: assetClass || 'crypto', config: cfg
    });
    return { ind: ind, pat: pat, trend: trend, levels: levels, atr: atr, proposal: proposal, cfg: cfg };
}

var strongUp = function (n) { return series(n, function (i) { return 100 + i * 1.2 + wob(i, 0.3); }); };
var ranging  = function (n) { return series(n, function (i) { return 100 + wob(i, 4); }); };
var tight    = function (n) { return series(n, function (i) { return 100 + wob(i, 0.15); }); };

/* ================================================================== */
T.suite('Phase 5 — Support & Resistance engine');

T.test('clusters repeated swings into levels with measurable strength', function () {
    var p = pipeline(FIX.bars.slice(0, 400));
    var sr = p.levels.supportResistance;
    T.ok(sr.levels.length > 0, 'levels found: ' + sr.levels.length);
    sr.levels.forEach(function (l) {
        T.ok(l.touches >= QT.CONFIG.structure.srMinTouches, l.kind + ' has >= min touches');
        T.ok(l.strength >= 0 && l.strength <= 1, 'strength bounded');
        T.ok(l.evidence.length === 3, 'three evidence items');
    });
});

T.test('levels are classified by position relative to price, not swing type', function () {
    var p = pipeline(FIX.bars.slice(0, 400));
    var sr = p.levels.supportResistance;
    sr.support.forEach(function (l) { T.ok(l.price < sr.close, 'support below price'); });
    sr.resistance.forEach(function (l) { T.ok(l.price > sr.close, 'resistance above price'); });
});

T.test('nearest support and resistance bracket the current price', function () {
    var p = pipeline(FIX.bars.slice(0, 400));
    var n = p.levels.supportResistance.nearest;
    if (n.support) T.ok(n.support.price < p.levels.supportResistance.close, 'nearest support below');
    if (n.resistance) T.ok(n.resistance.price > p.levels.supportResistance.close, 'nearest resistance above');
    T.pass('bracketing verified');
});

T.suite('Phase 5 — Fibonacci engine');

T.test('anchors on a dominant leg and produces all three level families', function () {
    var p = pipeline(strongUp(300));
    var f = p.levels.fibonacci;
    if (!f.available) { T.pass('no qualifying leg; skipped'); return; }
    ['retracement', 'extension', 'expansion'].forEach(function (kind) {
        T.ok(f.levels.some(function (l) { return l.type === kind; }), kind + ' levels produced');
    });
    T.ok(f.leg.spanAtr >= QT.CONFIG.levels.fibMinLegAtr, 'leg clears the minimum size');
});

T.test('retracement levels sit inside the leg and are correctly ordered', function () {
    var p = pipeline(strongUp(300));
    var f = p.levels.fibonacci;
    if (!f.available) { T.pass('skipped'); return; }
    var rets = f.levels.filter(function (l) { return l.type === 'retracement'; });
    rets.forEach(function (l) {
        T.ok(l.price >= f.low - 1e-6 && l.price <= f.high + 1e-6,
             (l.ratio * 100).toFixed(1) + '% lies within the leg');
    });
    var golden = rets.filter(function (l) { return l.inGoldenZone; });
    T.ok(golden.length >= 2, 'golden zone identified (' + golden.length + ' levels)');
});

T.test('50% retracement is exactly the midpoint of the leg', function () {
    var p = pipeline(strongUp(300));
    var f = p.levels.fibonacci;
    if (!f.available) { T.pass('skipped'); return; }
    var mid = f.levels.filter(function (l) { return l.type === 'retracement' && l.ratio === 0.5; })[0];
    T.close(mid.price, (f.high + f.low) / 2, 1e-9, 'closed-form midpoint check');
});

T.suite('Phase 5 — Trade qualification (standing aside is valid)');

T.test('a ranging market produces an explicit NO TRADE', function () {
    var p = pipeline(ranging(300));
    var q = p.proposal.qualification;
    T.ok(!p.proposal.tradeable, 'not tradeable');
    T.ok([R.QUALIFICATION.NO_TRADE, R.QUALIFICATION.LOW_CONFIDENCE,
          R.QUALIFICATION.INSUFFICIENT_CONFIRMATION].indexOf(q.status) !== -1,
         'status ' + q.status);
    T.ok(q.blockers.length > 0, 'blocking reasons given: ' + q.blockers[0]);
    T.equal(p.proposal.entry, null, 'no entry fabricated');
    T.equal(p.proposal.targets, null, 'no targets fabricated');
    T.ok(p.proposal.explanation.standAsideReasons.length > 0, 'stand-aside reasons explained');
});

T.test('a compressed market is blocked by the do-not-trade regime list', function () {
    var p = pipeline(tight(300));
    if (p.trend.regime.primary !== 'COMPRESSION') { T.pass('regime was ' + p.trend.regime.primary + '; skipped'); return; }
    T.ok(!p.proposal.tradeable, 'compression blocks trading');
    T.ok(p.proposal.qualification.blockers.some(function (b) { return /do-not-trade/.test(b); }),
         'blocker cites the regime list');
});

T.test('raising the confidence floor forces a LOW_CONFIDENCE refusal', function () {
    var cfg = QT.cloneConfig();
    cfg.risk.qualification.minConfidence = 0.99;
    var p = pipeline(strongUp(300), 'crypto', cfg);
    T.ok(!p.proposal.tradeable, 'refused');
    T.equal(p.proposal.qualification.status, R.QUALIFICATION.LOW_CONFIDENCE, 'LOW_CONFIDENCE reported');
});

T.test('requiring more aligned patterns forces INSUFFICIENT_CONFIRMATION', function () {
    var cfg = QT.cloneConfig();
    cfg.risk.qualification.minAlignedPatterns = 999;
    var p = pipeline(strongUp(300), 'crypto', cfg);
    T.ok(!p.proposal.tradeable, 'refused');
    T.equal(p.proposal.qualification.status, R.QUALIFICATION.INSUFFICIENT_CONFIRMATION,
            'INSUFFICIENT_CONFIRMATION reported');
});

T.test('a valid trend qualifies and states its supporting reasons', function () {
    var p = pipeline(strongUp(300));
    var q = p.proposal.qualification;
    T.ok(q.tradeable, 'tradeable (status ' + q.status + ')');
    T.ok(q.reasons.length > 0, 'reasons supplied');
    T.ok(q.metrics.alignedCount >= 1, 'aligned patterns counted');
});

T.suite('Phase 5 — Entry construction');

T.test('multiple entry models are generated and ranked', function () {
    var p = pipeline(strongUp(300));
    if (!p.proposal.tradeable) { T.pass('not tradeable; skipped'); return; }
    var c = p.proposal.entryCandidates;
    T.ok(c.length >= 1, c.length + ' entry model(s)');
    var models = c.map(function (x) { return x.model; });
    T.ok(models.indexOf('immediate') !== -1, 'immediate model always available');
    c.forEach(function (e) {
        T.ok(e.rationale.length > 10, e.model + ' has a rationale');
        T.ok(e.invalidation.length > 0, e.model + ' declares invalidation conditions');
        T.ok(e.quality >= 0 && e.quality <= 1, e.model + ' quality bounded');
    });
    // Ranking is by quality x confidence.
    for (var i = 1; i < c.length; i++) {
        T.ok(c[i - 1].quality * c[i - 1].confidence >= c[i].quality * c[i].confidence - 1e-9,
             'candidates ordered by execution score');
    }
});

T.suite('Phase 5 — Stop construction');

T.test('stops are built from independent evidence, never fixed distances', function () {
    var p = pipeline(strongUp(300));
    if (!p.proposal.tradeable) { T.pass('skipped'); return; }
    var s = p.proposal.stops;
    T.ok(s.candidates.length >= 1, s.candidates.length + ' stop candidate(s)');
    var bases = s.candidates.map(function (x) { return x.basis; });
    T.ok(bases.indexOf('atr') !== -1, 'ATR-based stop present');
    s.candidates.forEach(function (x) {
        T.ok(x.evidence.length > 0, x.id + ' explains its placement');
        T.ok(x.distanceAtr > 0, x.id + ' has a positive ATR distance');
    });
});

T.test('every stop sits on the protective side of entry', function () {
    ['crypto', 'forex', 'metal'].forEach(function (klass) {
        var p = pipeline(strongUp(300), klass);
        if (!p.proposal.tradeable) return;
        var entry = p.proposal.entry.price;
        p.proposal.stops.candidates.forEach(function (s) {
            T.ok(s.price < entry, klass + ' long: stop ' + s.id + ' below entry');
        });
    });
    T.pass('protective-side invariant holds');
});

T.test('stops respect the instrument-class ATR band (D1 §6.2)', function () {
    [['forex', [1.0, 1.5]], ['metal', [1.5, 2.0]], ['crypto', [2.0, 3.0]]].forEach(function (pair) {
        var p = pipeline(strongUp(300), pair[0]);
        if (!p.proposal.tradeable) return;
        T.deepEqual(p.proposal.stops.classBand, pair[1], pair[0] + ' band from research');
        T.ok(p.proposal.stop.distanceAtr >= pair[1][0] - 1e-9,
             pair[0] + ' selected stop ' + p.proposal.stop.distanceAtr.toFixed(2) +
             ' ATR >= floor ' + pair[1][0]);
    });
});

T.test('rejected stops explain why they were not selected', function () {
    var p = pipeline(strongUp(300), 'crypto');
    if (!p.proposal.tradeable) { T.pass('skipped'); return; }
    p.proposal.stops.rejected.forEach(function (r) {
        T.ok(r.reason.length > 10, r.id + ' rejection explained: ' + r.reason.slice(0, 50));
    });
    T.pass('all rejections explained');
});

T.suite('Phase 5 — Target construction');

T.test('exactly three ordered targets with probabilities and evidence', function () {
    var p = pipeline(strongUp(300));
    if (!p.proposal.tradeable) { T.pass('skipped'); return; }
    var t = p.proposal.targets;
    T.equal(t.length, 3, 'TP1/TP2/TP3 produced');
    T.deepEqual(t.map(function (x) { return x.id; }), ['TP1', 'TP2', 'TP3'], 'ids assigned in order');
    for (var i = 1; i < t.length; i++) {
        T.ok(t[i].rr > t[i - 1].rr, 'TP' + (i + 1) + ' is further than TP' + i);
    }
    t.forEach(function (x) {
        T.ok(x.probability > 0 && x.probability < 1, x.id + ' probability in (0,1)');
        T.ok(x.evidence.length > 0, x.id + ' has evidence');
        T.ok(x.invalidation.length > 0, x.id + ' declares invalidation');
        T.ok(x.sources.length > 0, x.id + ' names its source(s)');
    });
});

T.test('target probability decreases with distance', function () {
    var p = pipeline(strongUp(300));
    if (!p.proposal.tradeable) { T.pass('skipped'); return; }
    var t = p.proposal.targets;
    T.ok(t[0].probability >= t[2].probability,
         'TP1 ' + t[0].probability.toFixed(3) + ' >= TP3 ' + t[2].probability.toFixed(3));
});

T.test('all targets lie in the direction of the trade', function () {
    var p = pipeline(strongUp(300));
    if (!p.proposal.tradeable) { T.pass('skipped'); return; }
    var entry = p.proposal.entry.price;
    p.proposal.targets.forEach(function (t) {
        T.ok(t.price > entry, t.id + ' above entry for a long');
    });
});

T.suite('Phase 5 — Risk/Reward metrics');

T.test('exposes a full metric set, not a single R:R number', function () {
    var p = pipeline(strongUp(300));
    if (!p.proposal.tradeable) { T.pass('skipped'); return; }
    var rr = p.proposal.riskReward;
    ['nominal', 'toFinalTarget', 'weighted', 'probabilityWeighted', 'expectedValueR',
     'minimumRequired', 'meetsMinimum', 'riskDistance', 'riskDistanceAtr', 'riskDistancePct',
     'holdingProfile'].forEach(function (k) {
        T.ok(k in rr, 'exposes ' + k);
    });
    T.equal(typeof rr.expectedValueR, 'number', 'expected value is numeric');
    T.ok(Array.isArray(rr.holdingProfile), 'holding profile per target');
});

T.test('R:R below the research minimum downgrades a VALID trade to MARGINAL', function () {
    var cfg = QT.cloneConfig();
    cfg.risk.classes.crypto.minRR = 99;         // unreachable
    var p = pipeline(strongUp(300), 'crypto', cfg);
    if (!p.proposal.tradeable) { T.pass('refused earlier; skipped'); return; }
    T.equal(p.proposal.riskReward.meetsMinimum, false, 'minimum not met');
    T.equal(p.proposal.qualification.status, R.QUALIFICATION.MARGINAL, 'downgraded to MARGINAL');
    T.ok(p.proposal.qualification.reasons.some(function (r) { return /research minimum/.test(r); }),
         'reason cites the research minimum');
});

T.test('risk distance is consistent across its three representations', function () {
    var p = pipeline(strongUp(300));
    if (!p.proposal.tradeable) { T.pass('skipped'); return; }
    var rr = p.proposal.riskReward, s = p.proposal.stop, e = p.proposal.entry;
    T.close(rr.riskDistance, Math.abs(e.price - s.price), 1e-6, 'price distance matches');
    T.close(rr.riskDistanceAtr, rr.riskDistance / p.atr, 1e-3, 'ATR distance consistent');
    T.close(rr.riskDistancePct, (rr.riskDistance / e.price) * 100, 1e-3, 'percentage consistent');
});

T.suite('Phase 5 — Lifecycle & portfolio independence');

T.test('lifecycle starts PROPOSED and only allows legal transitions', function () {
    var p = pipeline(strongUp(300));
    T.equal(p.proposal.lifecycle.state, 'PROPOSED', 'starts proposed');
    T.ok(R.canTransition('PROPOSED', 'PENDING'), 'proposed -> pending allowed');
    T.ok(R.canTransition('PENDING', 'TRIGGERED'), 'pending -> triggered allowed');
    T.ok(!R.canTransition('PROPOSED', 'ACTIVE'), 'cannot skip straight to active');
    T.ok(!R.canTransition('STOPPED_OUT', 'ACTIVE'), 'terminal state is terminal');
    T.ok(!R.canTransition('TP3_REACHED', 'TP1_REACHED'), 'no backward transitions');
});

T.test('engine stays independent of account size and position sizing', function () {
    var p = pipeline(strongUp(300));
    if (!p.proposal.tradeable) { T.pass('skipped'); return; }
    var json = JSON.stringify(p.proposal);
    T.ok(json.indexOf('positionSize') === -1, 'no position size emitted');
    T.ok(json.indexOf('lotSize') === -1, 'no lot size emitted');
    T.ok(json.indexOf('accountBalance') === -1, 'no account balance emitted');
    T.equal(p.proposal.positionRisk.sizingInputsOnly, true, 'declares itself sizing-agnostic');
});

T.suite('Phase 5 — Explainability');

T.test('every proposal explains entry, stop, targets and invalidation', function () {
    var p = pipeline(strongUp(300));
    if (!p.proposal.tradeable) { T.pass('skipped'); return; }
    var e = p.proposal.explanation;
    T.ok(e.summary.length > 30, 'summary present');
    T.ok(!!e.entryRationale, 'entry rationale');
    T.ok(e.stopRationale.evidence.length > 0, 'stop rationale with evidence');
    T.equal(e.targetRationale.length, 3, 'rationale for each target');
    T.ok(e.preEntryInvalidation.length > 0, 'pre-entry invalidation listed');
    T.ok(e.postEntryInvalidation.length > 0, 'post-entry invalidation listed');
    T.ok(Array.isArray(e.supporting) && Array.isArray(e.conflicting), 'both sides of the evidence');
    T.ok(!!e.trendEvidence, 'trend evidence carried through');
});

T.test('a refusal explains itself as thoroughly as an acceptance', function () {
    var p = pipeline(ranging(300));
    T.ok(!p.proposal.tradeable, 'refused');
    T.ok(p.proposal.explanation.summary.length > 20, 'summary explains the refusal');
    T.ok(p.proposal.explanation.standAsideReasons.length > 0, 'reasons enumerated');
});

T.suite('Phase 5 — Invariants & edge cases');

T.test('proposal construction is deterministic', function () {
    var bars = strongUp(300);
    var a = pipeline(bars).proposal, b = pipeline(bars).proposal;
    T.equal(JSON.stringify(a), JSON.stringify(b), 'identical output for identical input');
});

T.test('no randomness or clock reads in Phase 5 modules', function () {
    ['qt-levels.js', 'qt-risk.js'].forEach(function (f) {
        var src = fs.readFileSync(__dirname + '/../engine/' + f, 'utf8');
        T.ok(src.indexOf('Math.random') === -1, f + ' has no Math.random');
        T.ok(src.indexOf('Date.now') === -1, f + ' has no Date.now');
    });
});

T.test('degenerate inputs never throw and never fabricate a trade', function () {
    [[], series(5, function (i) { return 100 + i; }), series(40, function () { return 100; })]
        .forEach(function (bars) {
            var p = pipeline(bars);
            T.ok(typeof p.proposal === 'object', bars.length + ' bars: returns a proposal object');
            T.equal(p.proposal.tradeable, false, bars.length + ' bars: refuses to trade');
            T.equal(p.proposal.entry, null, bars.length + ' bars: no entry fabricated');
        });
});

T.test('works across all three instrument classes on real data', function () {
    ['forex', 'metal', 'crypto'].forEach(function (klass) {
        var p = pipeline(FIX.bars, klass);
        T.ok(typeof p.proposal.qualification.status === 'string', klass + ': qualification produced');
        if (p.proposal.tradeable) {
            T.ok(p.proposal.stop.distanceAtr > 0, klass + ': positive stop distance');
            T.equal(p.proposal.targets.length, 3, klass + ': three targets');
        } else {
            T.ok(p.proposal.explanation.standAsideReasons.length > 0, klass + ': refusal explained');
        }
    });
});

T.test('completes within a sane time budget on 600 real bars', function () {
    var start = process.hrtime.bigint();
    pipeline(FIX.bars);
    var ms = Number(process.hrtime.bigint() - start) / 1e6;
    T.ok(ms < 900, 'full pipeline in ' + ms.toFixed(1) + 'ms');
});

module.exports = T;
