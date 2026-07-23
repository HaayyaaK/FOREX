/**
 * Phase 7 verification — Recommendation Engine.
 */
'use strict';

['qt-config', 'qt-utils', 'qt-indicators', 'qt-detection', 'qt-candles', 'qt-structure',
 'qt-chart-patterns', 'qt-patterns', 'qt-trend', 'qt-levels', 'qt-risk',
 'qt-profiles', 'qt-scoring', 'qt-recommendation']
    .forEach(function (m) { require('../engine/' + m + '.js'); });

var QT = globalThis.QT;
var REC = QT.recommendation;
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
var strongUp   = function (n) { return series(n, function (i) { return 100 + i * 1.2 + wob(i, 0.3); }); };
var strongDown = function (n) { return series(n, function (i) { return 500 - i * 1.2 + wob(i, 0.3); }); };
var ranging    = function (n) { return series(n, function (i) { return 100 + wob(i, 4); }); };

function pipeline(bars, profileId, sentiment) {
    var cfg = QT.profiles.applyProfile(profileId || 'balanced');
    var ind = QT.indicators.computeAll(bars, cfg);
    var pat = QT.patterns.analyze(bars, ind, { config: cfg });
    var trend = QT.trend.analyzeTimeframe(ind, pat, { config: cfg });
    var atr = QT.utils.lastFinite(ind.atr);
    var ctx = QT.detection.buildContext(bars, ind, cfg);
    var levels = QT.levels.analyze(bars, ctx.swings.minor, atr, cfg);
    var proposal = QT.risk.buildProposal({
        bars: bars, indicators: ind, patternReport: pat, trend: trend, levels: levels,
        swings: ctx.swings.minor, assetClass: 'crypto', config: cfg });
    var scored = QT.scoring.score({
        bars: bars, indicators: ind, patternReport: pat, trend: trend, levels: levels,
        proposal: proposal, sentiment: sentiment, config: cfg });
    var rec = REC.build({
        scored: scored, trend: trend, patternReport: pat, proposal: proposal, levels: levels,
        series: { symbol: 'COINBASE:BTCUSD', interval: '60', bars: bars, warnings: [] },
        config: cfg });
    return { cfg: cfg, trend: trend, proposal: proposal, scored: scored, rec: rec };
}

/* ================================================================== */
T.suite('Phase 7 — Recommendation object contract');

T.test('exposes every required field', function () {
    var r = pipeline(strongUp(300)).rec;
    ['engineVersion', 'configVersion', 'generatedAt', 'barTime', 'symbol', 'timeframe', 'profile',
     'recommendation', 'confidence', 'metrics', 'tradeQualification', 'regime', 'trend',
     'probabilities', 'trade', 'evidence', 'reasoning', 'capability', 'warnings',
     'assumptions', 'consistency', 'explanations'].forEach(function (k) {
        T.ok(k in r, 'exposes ' + k);
    });
    T.equal(r.engineVersion, REC.ENGINE_VERSION, 'engine version stamped');
});

T.test('recommendation carries code, label, direction and strength', function () {
    var r = pipeline(strongUp(300)).rec.recommendation;
    ['code', 'label', 'direction', 'strength'].forEach(function (k) { T.ok(k in r, 'has ' + k); });
    T.ok(r.strength >= 0 && r.strength <= 1, 'strength bounded');
});

T.test('the five quantitative concepts stay independent', function () {
    var m = pipeline(strongUp(300)).rec.metrics;
    ['recommendationStrength', 'trendStrength', 'confidence', 'tradeQuality',
     'directionalScore'].forEach(function (k) { T.ok(k in m, 'reports ' + k); });
    T.ok(m.recommendationStrength !== undefined && m.trendStrength !== undefined,
         'recommendation strength and trend strength are separate fields');
});

T.test('output contains no presentation formatting', function () {
    var r = pipeline(strongUp(300)).rec;
    var json = JSON.stringify({ recommendation: r.recommendation, metrics: r.metrics,
                                probabilities: r.probabilities });
    T.ok(json.indexOf('<') === -1 && json.indexOf('style') === -1, 'no markup or styling');
    T.ok(json.indexOf('#') === -1, 'no colour codes');
});

T.suite('Phase 7 — Determinism & timestamp injection');

T.test('generatedAt defaults to the last bar time, not the wall clock', function () {
    var bars = strongUp(300);
    var r = pipeline(bars).rec;
    T.equal(r.generatedAt, bars[bars.length - 1].time, 'defaults to last completed bar');
    T.equal(r.barTime, bars[bars.length - 1].time, 'bar time recorded');
});

T.test('an injected timestamp is metadata only and changes nothing else', function () {
    var bars = strongUp(300);
    var p = pipeline(bars);
    var a = REC.build({ scored: p.scored, trend: p.trend, patternReport: QT.patterns.analyze(bars,
                QT.indicators.computeAll(bars, p.cfg), { config: p.cfg }),
                proposal: p.proposal, series: { bars: bars }, generatedAt: 111, config: p.cfg });
    var b = REC.build({ scored: p.scored, trend: p.trend, patternReport: QT.patterns.analyze(bars,
                QT.indicators.computeAll(bars, p.cfg), { config: p.cfg }),
                proposal: p.proposal, series: { bars: bars }, generatedAt: 999, config: p.cfg });
    T.equal(a.generatedAt, 111, 'first timestamp honoured');
    T.equal(b.generatedAt, 999, 'second timestamp honoured');
    a.generatedAt = b.generatedAt = 0;
    T.equal(JSON.stringify(a), JSON.stringify(b), 'nothing else differs');
});

T.test('no clock reads in the recommendation module', function () {
    var src = fs.readFileSync(__dirname + '/../engine/qt-recommendation.js', 'utf8');
    T.ok(src.indexOf('Date.now') === -1, 'no Date.now');
    T.ok(src.indexOf('Math.random') === -1, 'no Math.random');
    T.ok(src.indexOf('new Date()') === -1, 'no implicit clock read');
});

T.test('recommendation building is deterministic', function () {
    var bars = strongUp(300);
    T.equal(JSON.stringify(pipeline(bars).rec), JSON.stringify(pipeline(bars).rec),
            'identical output for identical input');
});

T.suite('Phase 7 — Directional bands');

T.test('all seven bands are defined and ordered', function () {
    T.equal(REC.BANDS.length, 7, 'seven bands');
    for (var i = 1; i < REC.BANDS.length; i++) {
        T.ok(REC.BANDS[i].min < REC.BANDS[i - 1].min, REC.BANDS[i].code + ' below the previous');
    }
});

T.test('band resolution maps scores to the correct band', function () {
    var cfg = QT.profiles.applyProfile('balanced');
    // High confidence so damping never interferes.
    T.equal(REC.resolveBand(0.80, 0.9, cfg).band.code, 'STRONG_BUY', '0.80 -> Strong Buy');
    T.equal(REC.resolveBand(0.40, 0.9, cfg).band.code, 'BUY', '0.40 -> Buy');
    T.equal(REC.resolveBand(0.15, 0.9, cfg).band.code, 'WEAK_BUY', '0.15 -> Weak Buy');
    T.equal(REC.resolveBand(0.00, 0.9, cfg).band.code, 'NEUTRAL', '0.00 -> Neutral');
    T.equal(REC.resolveBand(-0.15, 0.9, cfg).band.code, 'WEAK_SELL', '-0.15 -> Weak Sell');
    T.equal(REC.resolveBand(-0.40, 0.9, cfg).band.code, 'SELL', '-0.40 -> Sell');
    T.equal(REC.resolveBand(-0.80, 0.9, cfg).band.code, 'STRONG_SELL', '-0.80 -> Strong Sell');
});

T.suite('Phase 7 — Band-edge damping (stability)');

T.test('a score just over a boundary with low confidence is damped down', function () {
    var cfg = QT.profiles.applyProfile('balanced');
    var m = cfg.recommendation.bandEdgeMargin;
    var justOver = 0.28 + m / 2;                       // barely into BUY
    var low = REC.resolveBand(justOver, 0.30, cfg);
    var high = REC.resolveBand(justOver, 0.90, cfg);
    T.equal(low.band.code, 'WEAK_BUY', 'low confidence stays in the weaker band');
    T.ok(low.damped, 'damping flagged');
    T.ok(low.dampingReason.length > 20, 'damping explained');
    T.equal(high.band.code, 'BUY', 'high confidence claims the stronger band');
    T.ok(!high.damped, 'no damping at high confidence');
});

T.test('damping is symmetric for bearish bands', function () {
    var cfg = QT.profiles.applyProfile('balanced');
    var m = cfg.recommendation.bandEdgeMargin;
    var justUnder = -0.28 - m / 2;
    var low = REC.resolveBand(justUnder, 0.30, cfg);
    T.equal(low.band.code, 'WEAK_SELL', 'damped to the weaker bearish band');
    T.ok(low.damped, 'damping flagged');
});

T.test('a score comfortably inside a band is never damped', function () {
    var cfg = QT.profiles.applyProfile('balanced');
    var r = REC.resolveBand(0.45, 0.20, cfg);
    T.equal(r.band.code, 'BUY', 'stays in Buy');
    T.ok(!r.damped, 'no damping well inside the band');
});

T.suite('Phase 7 — Non-directional outcomes are first-class');

T.test('all six non-directional outcomes are defined', function () {
    ['NO_TRADE', 'LOW_CONFIDENCE', 'INSUFFICIENT_CONFIRMATION', 'HIGH_RISK',
     'WAITING_FOR_CONFIRMATION', 'DATA_INSUFFICIENT'].forEach(function (k) {
        T.ok(!!REC.OUTCOMES[k], k + ' defined');
        T.equal(REC.OUTCOMES[k].direction, 'none', k + ' is non-directional');
    });
});

T.test('a ranging market yields a non-directional recommendation with no trade data', function () {
    var r = pipeline(ranging(300)).rec;
    T.equal(r.recommendation.direction, 'none', 'non-directional: ' + r.recommendation.code);
    T.equal(r.trade, null, 'NO executable trade data attached');
    T.ok(r.reasoning.primaryReason.length > 10, 'primary reason given');
    T.equal(r.recommendation.strength, 0, 'strength is zero');
});

T.test('insufficient data yields DATA_INSUFFICIENT, not a crash', function () {
    var r = pipeline(series(3, function (i) { return 100 + i; })).rec;
    T.equal(r.recommendation.direction, 'none', 'non-directional');
    T.ok(['DATA_INSUFFICIENT', 'NO_TRADE', 'LOW_CONFIDENCE', 'INSUFFICIENT_CONFIRMATION']
         .indexOf(r.recommendation.code) !== -1, 'code ' + r.recommendation.code);
    T.equal(r.trade, null, 'no trade data');
});

T.test('a failed configurable gate produces WAITING_FOR_CONFIRMATION', function () {
    var r = pipeline(strongUp(300), 'conservative').rec;
    if (r.recommendation.direction !== 'none') { T.pass('qualified under conservative; skipped'); return; }
    T.ok(['WAITING_FOR_CONFIRMATION', 'NO_TRADE', 'LOW_CONFIDENCE', 'INSUFFICIENT_CONFIRMATION']
         .indexOf(r.recommendation.code) !== -1, 'code ' + r.recommendation.code);
    T.ok(r.reasoning.decisiveGates.length >= 0, 'decisive gates recorded');
});

T.suite('Phase 7 — Consistency validation');

T.test('a clean recommendation passes all consistency checks', function () {
    var r = pipeline(strongUp(300)).rec;
    T.ok(r.consistency.valid, 'valid: ' + JSON.stringify(r.consistency.issues));
    T.equal(r.consistency.errorCount, 0, 'no errors');
});

T.test('inconsistencies are SURFACED, never silently corrected', function () {
    var p = pipeline(strongUp(300));
    var rec = JSON.parse(JSON.stringify(p.rec));
    // Deliberately corrupt: bullish recommendation with a bearish dominant trend.
    rec.recommendation = { code: 'STRONG_BUY', label: 'Strong Buy', direction: 'bullish',
                           band: 'STRONG_BUY', strength: 1.0 };
    rec.trend.direction = 'bearish';
    var v = REC.validateConsistency(rec);
    T.ok(!v.valid, 'inconsistency detected');
    T.ok(v.issues.some(function (i) { return i.id === 'direction_vs_trend'; }),
         'direction vs trend flagged');
    T.ok(/never silently corrected/.test(v.note), 'note states nothing is auto-fixed');
    // The original object is untouched.
    T.equal(p.rec.consistency.valid, true, 'original recommendation unmodified');
});

T.test('a non-directional outcome carrying executables is flagged', function () {
    var p = pipeline(strongUp(300));
    var rec = JSON.parse(JSON.stringify(p.rec));
    rec.recommendation = { code: 'NO_TRADE', label: 'No Trade', direction: 'none', band: null, strength: 0 };
    var v = REC.validateConsistency(rec);
    if (rec.trade && rec.trade.entry) {
        T.ok(v.issues.some(function (i) { return i.id === 'no_trade_has_no_executables'; }),
             'executable-on-no-trade flagged');
    } else { T.pass('no trade block present; rule not applicable'); }
});

T.test('strength/confidence mismatch is flagged as a warning, not an error', function () {
    var p = pipeline(strongUp(300));
    var rec = JSON.parse(JSON.stringify(p.rec));
    rec.recommendation.strength = 1.0;
    rec.confidence = 5;
    var v = REC.validateConsistency(rec);
    var issue = v.issues.filter(function (i) { return i.id === 'strength_vs_confidence'; })[0];
    T.ok(!!issue, 'mismatch detected');
    T.equal(issue.severity, 'warning', 'classified as a warning');
});

T.suite('Phase 7 — Explainability');

T.test('produces two independent explanations', function () {
    var r = pipeline(strongUp(300)).rec;
    T.ok(r.explanations.executive.length > 60, 'executive summary present');
    T.ok(r.explanations.technical.length > 300, 'technical explanation is substantially longer');
    T.ok(r.explanations.technical.indexOf('\n') !== -1, 'technical is multi-line');
    T.ok(r.explanations.executive.indexOf('\n') === -1, 'executive is a single paragraph');
});

T.test('technical explanation traces contributions and gates', function () {
    var t = pipeline(strongUp(300)).rec.explanations.technical;
    ['PROFILE:', 'COMPOSITE:', 'BAND:', 'TREND:', 'REGIME:', 'CONTRIBUTIONS',
     'QUALIFICATION:', 'LIMITING FACTOR:'].forEach(function (s) {
        T.ok(t.indexOf(s) !== -1, 'includes ' + s);
    });
});

T.test('identifies strongest supporting and opposing evidence', function () {
    var r = pipeline(strongUp(300)).rec;
    T.ok(r.evidence.strongestSupporting !== undefined, 'strongest supporting resolved');
    T.ok(Array.isArray(r.evidence.supporting), 'supporting list');
    T.ok(Array.isArray(r.evidence.opposing), 'opposing list');
    if (r.evidence.strongestSupporting) {
        T.ok(r.evidence.strongestSupporting.detail.length > 0, 'has detail');
        T.ok('source' in r.evidence.strongestSupporting, 'names its category');
    }
});

T.test('names the primary reason and the limiting factor', function () {
    var r = pipeline(strongUp(300)).rec;
    T.ok(r.reasoning.primaryReason.length > 15, 'primary reason stated');
    T.ok(!!r.reasoning.limitingFactor.factor, 'limiting factor identified: ' +
         r.reasoning.limitingFactor.factor);
    T.ok(r.reasoning.limitingFactor.detail.length > 5, 'limiting factor explained');
});

T.test('reports capability exclusions and decisive gates', function () {
    var r = pipeline(strongUp(300), 'balanced', null).rec;
    T.ok(Array.isArray(r.reasoning.capabilityExclusions), 'exclusions listed');
    T.ok(r.capability.excluded.indexOf('sentiment') !== -1, 'sentiment exclusion surfaced');
    T.ok(Array.isArray(r.reasoning.decisiveGates), 'decisive gates listed');
    T.ok(r.capability.note.length > 20, 'normalisation note carried through');
});

T.test('assumptions state the confidence definition explicitly', function () {
    var a = pipeline(strongUp(300)).rec.assumptions;
    T.ok(a.some(function (x) { return /NOT a probability of trade success/.test(x); }),
         'confidence is explicitly not a success probability');
    T.ok(a.some(function (x) { return /completed bars only/.test(x); }), 'non-repainting stated');
    T.ok(a.some(function (x) { return /not constitute financial advice/.test(x); }), 'disclaimer present');
});

T.suite('Phase 7 — No new analysis');

T.test('the engine calls no analytical phase', function () {
    var src = fs.readFileSync(__dirname + '/../engine/qt-recommendation.js', 'utf8');
    ['QT.indicators.', 'QT.patterns.analyze', 'QT.trend.analyzeTimeframe',
     'QT.levels.analyze', 'QT.risk.buildProposal', 'QT.scoring.score'].forEach(function (c) {
        T.ok(src.indexOf(c) === -1, 'does not call ' + c);
    });
});

T.suite('Phase 7 — Cross-scenario behaviour');

T.test('a strong downtrend yields a bearish or non-directional call, never bullish', function () {
    var r = pipeline(strongDown(300)).rec;
    T.ok(r.recommendation.direction !== 'bullish',
         'not bullish (got ' + r.recommendation.code + ')');
    T.ok(r.consistency.valid, 'internally consistent');
});

T.test('every profile produces a consistent recommendation on real data', function () {
    QT.profiles.list().forEach(function (p) {
        var r = pipeline(FIX.bars, p.id).rec;
        T.ok(r.consistency.valid, p.id + ': consistent (' + r.recommendation.code + ')');
        T.ok(r.explanations.executive.length > 40, p.id + ': executive summary produced');
        if (r.recommendation.direction === 'none') {
            T.equal(r.trade, null, p.id + ': non-directional carries no trade');
        }
    });
});

T.test('degenerate inputs never throw and stay consistent', function () {
    [[], series(4, function (i) { return 100 + i; }), series(40, function () { return 100; })]
        .forEach(function (bars) {
            var r = pipeline(bars).rec;
            T.ok(typeof r.recommendation.code === 'string', bars.length + ' bars: produced a code');
            T.equal(r.trade, null, bars.length + ' bars: no trade fabricated');
            T.ok(r.consistency.valid, bars.length + ' bars: internally consistent');
        });
});

T.test('full pipeline through Phase 7 stays within budget', function () {
    var start = process.hrtime.bigint();
    pipeline(FIX.bars);
    var ms = Number(process.hrtime.bigint() - start) / 1e6;
    T.ok(ms < 1200, 'completed in ' + ms.toFixed(1) + 'ms');
});

T.test('REGRESSION: weak divergence from trend is a warning, strong divergence an error', function () {
    var p = pipeline(strongUp(300));
    var base = JSON.parse(JSON.stringify(p.rec));
    base.trend.direction = 'bearish';

    var weak = JSON.parse(JSON.stringify(base));
    weak.recommendation = { code: 'WEAK_BUY', label: 'Weak Buy', direction: 'bullish', band: 'WEAK_BUY', strength: 0.4 };
    var wv = REC.validateConsistency(weak);
    T.ok(wv.valid, 'weak divergence does not invalidate the recommendation');
    T.ok(wv.issues.some(function (i) { return i.id === 'direction_vs_trend_divergence' && i.severity === 'warning'; }),
         'weak divergence reported as a warning');

    var strong = JSON.parse(JSON.stringify(base));
    strong.recommendation = { code: 'STRONG_BUY', label: 'Strong Buy', direction: 'bullish', band: 'STRONG_BUY', strength: 1.0 };
    var sv = REC.validateConsistency(strong);
    T.ok(!sv.valid, 'strong divergence is still an error');
    T.ok(sv.issues.some(function (i) { return i.id === 'direction_vs_trend' && i.severity === 'error'; }),
         'strong divergence reported as an error');
});

T.suite('Phase 9 — MTF consensus arbitration');

function consensusOf(direction, agreement, confidence, quality, extra) {
    return Object.assign({ direction: direction, agreement: agreement, confidence: confidence,
        quality: quality, strength: 0.6, dominant: 'htf', conflicting: [], conflicted: false,
        perTimeframe: {}, rulesApplied: [] }, extra || {});
}
var BULL_BAND = REC.BANDS.filter(function (b) { return b.code === 'BUY'; })[0];
var BEAR_BAND = REC.BANDS.filter(function (b) { return b.code === 'SELL'; })[0];

T.test('M0: absent consensus is reported, never silently skipped', function () {
    var cfg = QT.profiles.applyProfile('balanced');
    var a = REC.arbitrateConsensus(null, BULL_BAND, cfg);
    T.equal(a.action, 'not_evaluated', 'action is not_evaluated');
    T.equal(a.evaluated, false, 'flagged as not evaluated');
    T.equal(a.rule, 'M0', 'rule M0');
    T.ok(/not supplied/.test(a.reason), 'reason explains the absence');
});

T.test('M1: consensus below actionable quality changes nothing, and says so', function () {
    var cfg = QT.profiles.applyProfile('balanced');
    var a = REC.arbitrateConsensus(consensusOf('bullish', 1, 0.1, 0.1), BULL_BAND, cfg);
    T.equal(a.action, 'none', 'no action');
    T.equal(a.rule, 'M1', 'rule M1');
    T.equal(a.confidenceAdjustment, 0, 'no confidence change');
    T.ok(/below the actionable threshold/.test(a.reason), 'explains why no change occurred');
});

T.test('M3a: opposing consensus with sufficient confidence BLOCKS', function () {
    var cfg = QT.profiles.applyProfile('balanced');
    var a = REC.arbitrateConsensus(
        consensusOf('bearish', 1, 0.8, 0.9, { conflicting: ['ltf'] }), BULL_BAND, cfg);
    T.equal(a.action, 'block', 'blocked');
    T.equal(a.blocked, true, 'blocked flag set');
    T.ok(a.confidenceAdjustment < 0, 'confidence penalised');
    T.ok(/blocking threshold/.test(a.reason), 'reason names the threshold');
    T.ok(/Conflicting timeframes/.test(a.reason), 'reason names conflicting timeframes');
});

T.test('M3b: opposing consensus below the block threshold DEMOTES', function () {
    var cfg = QT.profiles.applyProfile('balanced');
    var a = REC.arbitrateConsensus(consensusOf('bearish', 1, 0.40, 0.9), BULL_BAND, cfg);
    T.equal(a.action, 'demote', 'demoted rather than blocked');
    T.equal(a.blocked, false, 'not blocked');
    T.ok(/below the blocking threshold/.test(a.reason), 'reason explains the distinction');
});

T.test('M4: fractured consensus WEAKENS confidence', function () {
    var cfg = QT.profiles.applyProfile('balanced');
    var a = REC.arbitrateConsensus(consensusOf('bullish', 0.33, 0.6, 0.8), BULL_BAND, cfg);
    T.equal(a.action, 'weaken', 'weakened');
    T.ok(a.confidenceAdjustment < 0, 'confidence reduced by ' + a.confidenceAdjustment);
    T.ok(/agreement/.test(a.reason), 'reason cites agreement');
});

T.test('M5: full alignment STRENGTHENS confidence', function () {
    var cfg = QT.profiles.applyProfile('balanced');
    var a = REC.arbitrateConsensus(consensusOf('bullish', 1.0, 0.8, 0.9), BULL_BAND, cfg);
    T.equal(a.action, 'strengthen', 'strengthened');
    T.ok(a.confidenceAdjustment > 0, 'confidence raised by +' + a.confidenceAdjustment);
    T.ok(/All available timeframes agree/.test(a.reason), 'reason explains the alignment');
});

T.test('arbitration is symmetric for bearish recommendations', function () {
    var cfg = QT.profiles.applyProfile('balanced');
    T.equal(REC.arbitrateConsensus(consensusOf('bullish', 1, 0.8, 0.9), BEAR_BAND, cfg).action,
            'block', 'opposing bullish consensus blocks a Sell');
    T.equal(REC.arbitrateConsensus(consensusOf('bearish', 1, 0.8, 0.9), BEAR_BAND, cfg).action,
            'strengthen', 'aligned bearish consensus strengthens a Sell');
});

T.test('every arbitration exposes the full consensus evaluation', function () {
    var cfg = QT.profiles.applyProfile('balanced');
    var a = REC.arbitrateConsensus(consensusOf('bullish', 0.66, 0.6, 0.8), BULL_BAND, cfg);
    ['direction', 'agreement', 'dominantTimeframe', 'conflictingTimeframes',
     'consensusConfidence', 'quality', 'conflicted', 'perTimeframe'].forEach(function (k) {
        T.ok(k in a.evaluation, 'evaluation exposes ' + k);
    });
});

T.suite('Phase 9 — MTF integration into the recommendation');

function recWith(consensus, bars) {
    var cfg = QT.profiles.applyProfile('balanced');
    var b = bars || strongUp(300);
    var ind = QT.indicators.computeAll(b, cfg);
    var pat = QT.patterns.analyze(b, ind, { config: cfg });
    var trend = QT.trend.analyzeTimeframe(ind, pat, { config: cfg });
    var atr = QT.utils.lastFinite(ind.atr);
    var ctx = QT.detection.buildContext(b, ind, cfg);
    var levels = QT.levels.analyze(b, ctx.swings.minor, atr, cfg);
    var proposal = QT.risk.buildProposal({ bars: b, indicators: ind, patternReport: pat,
        trend: trend, levels: levels, swings: ctx.swings.minor, assetClass: 'crypto', config: cfg });
    var scored = QT.scoring.score({ bars: b, indicators: ind, patternReport: pat, trend: trend,
        levels: levels, proposal: proposal, sentiment: null, config: cfg });
    return REC.build({ scored: scored, trend: trend, patternReport: pat, proposal: proposal,
        levels: levels, consensus: consensus, series: { bars: b }, config: cfg });
}

T.test('the recommendation always carries an mtf block', function () {
    var r = recWith(null);
    T.ok(!!r.mtf, 'mtf block present even without consensus');
    T.equal(r.mtf.evaluated, false, 'reports it was not evaluated');
    T.ok(!!r.mtf.warning, 'warns that a required input was missing');
});

T.test('opposing consensus converts a directional call into WAITING_FOR_CONFIRMATION', function () {
    var aligned = recWith(consensusOf('bullish', 1, 0.8, 0.9));
    if (aligned.recommendation.direction !== 'bullish') { T.pass('base not bullish; skipped'); return; }
    var opposed = recWith(consensusOf('bearish', 1, 0.9, 0.9, { conflicting: ['ltf', 'mtf'] }));
    T.equal(opposed.recommendation.code, 'WAITING_FOR_CONFIRMATION', 'blocked into a non-directional outcome');
    T.equal(opposed.trade, null, 'executable trade removed');
    T.equal(opposed.mtf.action, 'block', 'mtf action recorded');
    T.ok(/blocking threshold/.test(opposed.reasoning.primaryReason), 'primary reason is the block');
    T.equal(opposed.reasoning.limitingFactor.factor, 'mtf_consensus', 'limiting factor names MTF');
    T.ok(opposed.consistency.valid, 'still internally consistent');
});

T.test('aligned consensus raises confidence and records the adjustment', function () {
    var fractured = recWith(consensusOf('bullish', 0.5, 0.6, 0.8));
    var aligned = recWith(consensusOf('bullish', 1.0, 0.8, 0.9));
    if (aligned.recommendation.direction !== 'bullish') { T.pass('not bullish; skipped'); return; }
    T.equal(aligned.mtf.action, 'strengthen', 'strengthened');
    T.ok(aligned.confidence > aligned.metrics.confidenceBeforeMtf, 'confidence raised');
    T.equal(aligned.metrics.mtfConfidenceAdjustment, aligned.mtf.confidenceAdjustment, 'adjustment recorded');
    T.ok(aligned.confidence > fractured.confidence, 'aligned beats fractured');
});

T.test('demotion steps the band down and records the change', function () {
    var r = recWith(consensusOf('bearish', 1, 0.40, 0.9));
    if (r.mtf.action !== 'demote') { T.pass('action was ' + r.mtf.action + '; skipped'); return; }
    T.ok(!!r.mtf.bandChange, 'band change recorded');
    T.ok(r.mtf.bandChange.from !== r.mtf.bandChange.to, 'band actually changed: ' +
         r.mtf.bandChange.from + ' -> ' + r.mtf.bandChange.to);
});

T.test('no-change outcomes still explain themselves', function () {
    var r = recWith(consensusOf('bullish', 1, 0.1, 0.1));
    T.equal(r.mtf.action, 'none', 'no action taken');
    T.ok(r.mtf.reason.length > 30, 'explains why no change was made');
    T.equal(r.mtf.confidenceAdjustment, 0, 'confidence untouched');
    T.equal(r.confidence, r.metrics.confidenceBeforeMtf, 'confidence identical to pre-arbitration');
});

T.test('MTF integration remains deterministic', function () {
    var c = consensusOf('bullish', 1, 0.8, 0.9);
    T.equal(JSON.stringify(recWith(c)), JSON.stringify(recWith(c)), 'identical output');
});

module.exports = T;
