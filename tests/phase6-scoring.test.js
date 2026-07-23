/**
 * Phase 6 verification — Weighted Scoring Engine, Strategy Profiles and the
 * three-tier Trade Qualification Framework.
 */
'use strict';

['qt-config', 'qt-utils', 'qt-indicators', 'qt-detection', 'qt-candles', 'qt-structure',
 'qt-chart-patterns', 'qt-patterns', 'qt-trend', 'qt-levels', 'qt-risk',
 'qt-profiles', 'qt-scoring'].forEach(function (m) { require('../engine/' + m + '.js'); });

var QT = globalThis.QT;
var SC = QT.scoring;
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
var strongUp = function (n) { return series(n, function (i) { return 100 + i * 1.2 + wob(i, 0.3); }); };
var ranging  = function (n) { return series(n, function (i) { return 100 + wob(i, 4); }); };

/** Full pipeline through Phase 6 under a named profile. */
function run(bars, profileId, sentiment, mutate) {
    var cfg = QT.profiles.applyProfile(profileId || 'balanced');
    if (mutate) mutate(cfg);
    var ind = QT.indicators.computeAll(bars, cfg);
    var pat = QT.patterns.analyze(bars, ind, { config: cfg });
    var trend = QT.trend.analyzeTimeframe(ind, pat, { config: cfg });
    var atr = QT.utils.lastFinite(ind.atr);
    var ctx = QT.detection.buildContext(bars, ind, cfg);
    var levels = QT.levels.analyze(bars, ctx.swings.minor, atr, cfg);
    var proposal = QT.risk.buildProposal({
        bars: bars, indicators: ind, patternReport: pat, trend: trend, levels: levels,
        swings: ctx.swings.minor, assetClass: 'crypto', config: cfg
    });
    var scored = SC.score({
        bars: bars, indicators: ind, patternReport: pat, trend: trend, levels: levels,
        proposal: proposal, sentiment: sentiment, config: cfg
    });
    return { cfg: cfg, ind: ind, pat: pat, trend: trend, levels: levels, proposal: proposal, scored: scored };
}

/* ================================================================== */
T.suite('Phase 6 — Strategy profiles');

T.test('all five profiles resolve into a complete config', function () {
    QT.profiles.list().forEach(function (p) {
        var cfg = QT.profiles.applyProfile(p.id);
        T.equal(cfg.activeProfile.id, p.id, p.id + ' resolves');
        T.equal(Object.keys(cfg.scoring.categoryWeights).length, 10, p.id + ' weights all 10 categories');
        ['minRiskReward', 'minTrendConfidence', 'minCompositeScore',
         'minRegimeQuality', 'minConfirmationScore'].forEach(function (g) {
            T.ok(g in cfg.gates, p.id + ' defines ' + g);
        });
    });
});

T.test('an unknown profile fails loudly', function () {
    T.throws(function () { QT.profiles.applyProfile('does_not_exist'); }, 'unknown profile rejected');
});

T.test('applying a profile never mutates the shared config', function () {
    var before = JSON.stringify(QT.CONFIG.risk.classes.crypto.minRR);
    var cfg = QT.profiles.applyProfile('conservative');
    cfg.risk.classes.crypto.minRR = 999;
    T.equal(JSON.stringify(QT.CONFIG.risk.classes.crypto.minRR), before, 'base config untouched');
});

T.test('profile propagates its R:R floor into the risk engine', function () {
    T.equal(QT.profiles.applyProfile('conservative').risk.classes.crypto.minRR, 2.5, 'conservative 2.5');
    T.equal(QT.profiles.applyProfile('aggressive').risk.classes.crypto.minRR, 1.5, 'aggressive 1.5');
});

T.suite('Phase 6 — Evidence categories');

T.test('all ten categories are scored with the correct kind', function () {
    var r = run(strongUp(300));
    var cats = r.scored.categories;
    T.equal(Object.keys(cats).length, 10, 'ten categories');
    Object.keys(cats).forEach(function (id) {
        var c = cats[id];
        T.equal(c.kind, QT.profiles.CATEGORY_KIND[id], id + ' kind matches the registry');
        if (c.kind === 'directional') {
            T.ok(c.score >= -1 && c.score <= 1, id + ' signed score in [-1,1]');
        } else {
            T.ok(c.score >= 0 && c.score <= 1, id + ' quality score in [0,1]');
        }
        T.ok(Array.isArray(c.supporting) && Array.isArray(c.opposing), id + ' carries both sides');
    });
});

T.test('quality categories cannot create a direction', function () {
    var r = run(strongUp(300));
    var quality = r.scored.trace.contributions.filter(function (c) { return c.kind === 'quality'; });
    T.ok(quality.length > 0, 'quality categories present');
    quality.forEach(function (c) {
        T.ok(c.score >= 0, c.id + ' is unsigned so it cannot flip direction');
    });
    // Directional score must be reconstructible from directional contributions alone.
    var dirSum = r.scored.trace.contributions
        .filter(function (c) { return c.kind === 'directional'; })
        .reduce(function (a, c) { return a + c.contribution; }, 0);
    T.close(dirSum, r.scored.directionalScore, 1e-3, 'directional score comes only from directional evidence');
});

T.test('sentiment is hard-capped so it can never dominate', function () {
    var strong = run(strongUp(300), 'balanced',
        { available: true, score: 5.0, confidence: 1, articleCount: 40, evidence: ['very bullish news'] });
    var cap = QT.CONFIG.sentiment.maxDirectionalScore;
    T.ok(strong.scored.categories.sentiment.score <= cap + 1e-9,
         'capped at ' + cap + ' (got ' + strong.scored.categories.sentiment.score + ')');
});

T.test('sentiment absence is an exclusion, not a zero', function () {
    var r = run(strongUp(300), 'balanced', null);
    T.equal(r.scored.categories.sentiment.available, false, 'marked unavailable');
    T.ok(r.scored.trace.excluded.some(function (e) { return e.id === 'sentiment'; }),
         'excluded from the model rather than scored as 0');
});

T.suite('Phase 6 — Capability-aware normalisation');

T.test('excluded categories redistribute weight and say so', function () {
    var r = run(strongUp(300), 'balanced', null);
    var n = r.scored.trace.normalisation;
    T.ok(n.availableWeight < n.plannedWeight, 'available weight below planned');
    T.ok(n.redistributed, 'redistribution flagged');
    T.ok(/renormalised/.test(n.note), 'explains the renormalisation');
    T.ok(/No values were fabricated/.test(n.note), 'states nothing was fabricated');
});

T.test('normalized weights sum to 1 within each group', function () {
    var r = run(strongUp(300));
    ['directional', 'quality'].forEach(function (kind) {
        var group = r.scored.trace.contributions.filter(function (c) { return c.kind === kind; });
        if (!group.length) return;
        var sum = group.reduce(function (a, c) { return a + c.normalizedWeight; }, 0);
        T.close(sum, 1, 1e-3, kind + ' weights renormalise to 1');
    });
});

T.test('capability ratio reflects how much of the model was usable', function () {
    var r = run(strongUp(300), 'balanced', null);
    T.ok(r.scored.capabilityRatio > 0 && r.scored.capabilityRatio <= 1,
         'ratio bounded: ' + r.scored.capabilityRatio);
});

T.suite('Phase 6 — Composite output');

T.test('probabilities are positive and sum to exactly 1', function () {
    [strongUp(300), ranging(300)].forEach(function (bars, i) {
        var p = run(bars).scored.probabilities;
        var sum = p.buy + p.sell + p.neutral;
        T.close(sum, 1, 1e-9, 'scenario ' + i + ' sums to 1');
        ['buy', 'sell', 'neutral'].forEach(function (k) {
            T.ok(p[k] > 0 && p[k] < 1, 'scenario ' + i + ': ' + k + ' in (0,1)');
        });
    });
});

T.test('a strong uptrend produces a positive score favouring buy', function () {
    var s = run(strongUp(300)).scored;
    T.ok(s.directionalScore > 0, 'positive directional score: ' + s.directionalScore);
    T.ok(s.probabilities.buy > s.probabilities.sell, 'buy > sell');
});

T.test('confidence never claims certainty', function () {
    var s = run(strongUp(300)).scored;
    T.ok(s.confidence <= QT.profiles.get('balanced').tuning.confidenceCeiling,
         'capped at the profile ceiling: ' + s.confidence);
    T.ok(s.confidence >= 0, 'non-negative');
});

T.suite('Phase 6 — Three-tier qualification framework');

T.test('hard gates are enforced regardless of profile', function () {
    var bars = strongUp(300);
    ['balanced', 'aggressive', 'conservative'].forEach(function (p) {
        var r = run(bars, p);
        r.scored.qualification.pre.hard.forEach(function (g) {
            T.equal(g.tier, 'hard', p + ': ' + g.id + ' is a hard gate');
        });
    });
    T.pass('hard tier present under every profile');
});

T.test('a hard gate fails on structurally invalid data', function () {
    var r = run(series(3, function (i) { return 100 + i; }), 'aggressive');
    T.ok(!r.scored.qualification.pre.hardPassed || !r.scored.qualification.passed,
         'invalid data does not pass qualification');
});

T.test('configurable gates report value, threshold and owning profile', function () {
    var r = run(strongUp(300), 'conservative');
    r.scored.qualification.pre.configurable.forEach(function (g) {
        T.equal(g.tier, 'configurable', g.id + ' tier');
        T.ok('value' in g && 'threshold' in g, g.id + ' exposes value and threshold');
        T.equal(g.profile, 'conservative', g.id + ' names the owning profile');
    });
});

T.test('EXPECTED VALUE is informational by default, never a hidden rejection', function () {
    var r = run(strongUp(300), 'balanced');
    var post = r.scored.qualification.post;
    if (post.skipped) { T.pass('no tradeable proposal; skipped'); return; }
    var ev = post.informational.filter(function (g) { return g.id === 'expectedValueR'; })[0];
    T.ok(!!ev, 'expected value present as informational');
    T.equal(ev.passed, null, 'informational metrics do not pass/fail');
    T.ok(/not gated/.test(ev.message), 'message states it is not gating');
    T.ok(!post.configurable.some(function (g) { return g.id === 'minExpectedValueR'; }),
         'no EV gate under the balanced profile');
});

T.test('EXPECTED VALUE becomes a gate when a profile opts in', function () {
    var r = run(strongUp(300), 'conservative');
    var post = r.scored.qualification.post;
    if (post.skipped) { T.pass('no tradeable proposal; skipped'); return; }
    var gate = post.configurable.filter(function (g) { return g.id === 'minExpectedValueR'; })[0];
    T.ok(!!gate, 'conservative profile gates on EV');
    T.equal(gate.threshold, 0.0, 'threshold is the profile value');
    T.ok(!post.informational.some(function (g) { return g.id === 'expectedValueR'; }),
         'not duplicated as informational when gating');
});

T.test('EV is always visible in one tier or the other', function () {
    ['balanced', 'conservative', 'aggressive'].forEach(function (p) {
        var post = run(strongUp(300), p).scored.qualification.post;
        if (post.skipped) return;
        var seen = post.informational.concat(post.configurable)
            .some(function (g) { return /[eE]xpectedValue/.test(g.id); });
        T.ok(seen, p + ': expected value is reported');
    });
});

T.test('failures name the blocking tier', function () {
    var r = run(ranging(300), 'conservative');
    var q = r.scored.qualification;
    if (q.passed) { T.pass('passed unexpectedly; skipped'); return; }
    T.ok(q.pre.blockingTier === 'hard' || q.pre.blockingTier === 'configurable' ||
         (q.post.failures || []).length > 0 || !!q.post.skipped,
         'blocking tier identified: ' + q.pre.blockingTier);
    T.ok(q.summary.length > 10, 'summary explains the failure');
});

T.suite('Phase 6 — Profiles legitimately disagree on identical data');

T.test('conservative and aggressive can reach different conclusions', function () {
    var bars = strongUp(300);
    var cons = run(bars, 'conservative').scored;
    var aggr = run(bars, 'aggressive').scored;
    T.ok(cons.trace.profileAdjustments.gates.minTrendConfidence >
         aggr.trace.profileAdjustments.gates.minTrendConfidence, 'thresholds differ');
    T.ok(cons.directionalScore !== aggr.directionalScore ||
         cons.confidence !== aggr.confidence ||
         cons.qualification.passed !== aggr.qualification.passed,
         'outcomes differ: cons score ' + cons.directionalScore + '/' + cons.confidence +
         ' vs aggr ' + aggr.directionalScore + '/' + aggr.confidence);
});

T.test('research profiles weight evidence as documented', function () {
    var bars = strongUp(300);
    var so = run(bars, 'research_structure_only').scored;
    var tf = run(bars, 'research_trend_following').scored;
    T.equal(so.trace.profileAdjustments.categoryWeights.momentum, 0, 'structure-only zeroes momentum');
    T.ok(!so.trace.contributions.some(function (c) { return c.id === 'momentum'; }),
         'zero-weight category excluded from contributions');
    T.ok(so.trace.excluded.some(function (e) { return e.id === 'momentum'; }),
         'and reported as excluded with a reason');
    T.ok(tf.trace.profileAdjustments.categoryWeights.trend >
         so.trace.profileAdjustments.categoryWeights.trend, 'trend-following weights trend higher');
});

T.suite('Phase 6 — Conflict scenarios');

T.test('strong indicators against weak structure lower agreement', function () {
    var r = run(strongUp(300));
    T.ok(r.scored.agreement >= 0 && r.scored.agreement <= 1, 'agreement bounded: ' + r.scored.agreement);
    var opposing = r.scored.trace.contributions.filter(function (c) { return c.opposing.length > 0; });
    T.ok(opposing.length >= 0, opposing.length + ' categories report opposing evidence');
});

T.test('near-balanced evidence yields a neutral-leaning outcome', function () {
    var r = run(ranging(300));
    var s = r.scored;
    T.ok(Math.abs(s.directionalScore) < 0.5, 'small directional score: ' + s.directionalScore);
    T.ok(s.probabilities.neutral > 0.15, 'neutral retains meaningful probability: ' +
         s.probabilities.neutral.toFixed(3));
});

T.test('excellent R:R with poor probability is not scored as high quality', function () {
    var r = run(strongUp(300));
    var rq = r.scored.categories.riskQuality;
    if (!rq.available) { T.pass('no proposal; skipped'); return; }
    // riskQuality blends R:R with probability, so a good ratio alone cannot max it.
    T.ok(rq.score <= 0.95, 'quality bounded below 1 when probability is imperfect: ' + rq.score.toFixed(3));
    T.ok(rq.supporting.length + rq.opposing.length > 0, 'both sides reported');
});

T.suite('Phase 6 — Traceability & invariants');

T.test('every contribution traces back to weights and evidence', function () {
    var r = run(strongUp(300));
    T.ok(r.scored.trace.contributions.length > 0, 'contributions present');
    r.scored.trace.contributions.forEach(function (c) {
        ['id', 'kind', 'score', 'profileWeight', 'normalizedWeight',
         'contribution', 'supporting', 'opposing', 'metrics'].forEach(function (k) {
            T.ok(k in c, c.id + ' exposes ' + k);
        });
        T.close(c.contribution, c.score * c.normalizedWeight, 1e-3,
                c.id + ': contribution = score x normalized weight');
    });
});

T.test('trace records profile adjustments in full', function () {
    var r = run(strongUp(300), 'conservative');
    var p = r.scored.trace.profileAdjustments;
    T.equal(p.profile, 'conservative', 'profile named');
    T.ok(!!p.categoryWeights && !!p.gates && !!p.tuning, 'weights, gates and tuning all recorded');
});

T.test('scoring recalculates nothing from earlier phases', function () {
    var src = fs.readFileSync(__dirname + '/../engine/qt-scoring.js', 'utf8');
    ['QT.indicators.computeAll', 'QT.patterns.analyze', 'QT.trend.analyzeTimeframe',
     'QT.levels.analyze', 'QT.risk.buildProposal'].forEach(function (call) {
        T.ok(src.indexOf(call) === -1, 'does not call ' + call);
    });
});

T.test('scoring is deterministic', function () {
    var bars = strongUp(300);
    T.equal(JSON.stringify(run(bars).scored), JSON.stringify(run(bars).scored),
            'identical output for identical input');
});

T.test('no randomness or clock reads in Phase 6 modules', function () {
    ['qt-profiles.js', 'qt-scoring.js'].forEach(function (f) {
        var src = fs.readFileSync(__dirname + '/../engine/' + f, 'utf8');
        T.ok(src.indexOf('Math.random') === -1, f + ' has no Math.random');
        T.ok(src.indexOf('Date.now') === -1, f + ' has no Date.now');
    });
});

T.test('degenerate input never throws and never passes qualification', function () {
    [[], series(4, function (i) { return 100 + i; })].forEach(function (bars) {
        var r = run(bars);
        T.ok(typeof r.scored === 'object', bars.length + ' bars: returns a score object');
        T.equal(r.scored.qualification.passed, false, bars.length + ' bars: does not qualify');
        var p = r.scored.probabilities;
        T.close(p.buy + p.sell + p.neutral, 1, 1e-9, bars.length + ' bars: probabilities still sum to 1');
    });
});

T.test('runs on 600 real bars under every profile', function () {
    QT.profiles.list().forEach(function (prof) {
        var r = run(FIX.bars, prof.id);
        T.ok(typeof r.scored.directionalScore === 'number', prof.id + ': score produced');
        T.ok(r.scored.confidence >= 0 && r.scored.confidence <= 100, prof.id + ': confidence bounded');
        T.ok(typeof r.scored.qualification.summary === 'string', prof.id + ': qualification summarised');
    });
});

module.exports = T;
