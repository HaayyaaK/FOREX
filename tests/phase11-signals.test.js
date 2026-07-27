/**
 * Phase 11 verification — Signal-card data completeness & workspace stability.
 *
 * Covers the presentation upgrades layered on top of the frozen v1.1 card:
 *   (1) Pivot points flow from the indicator engine through the risk proposal's
 *       trade.levels (display-only passthrough) and are rendered in Key Zones.
 *   (2) The Live Price block carries a stable, descriptive CSS hook.
 *   (3) The ticker tape is re-mounted on return to the Charts workspace so it
 *       cannot be left blank/frozen by a display:none TradingView iframe.
 *
 * The pivot check is FUNCTIONAL (a real engine run over the immutable fixture);
 * the rest are static source assertions, matching the rest of the suite's style.
 */
'use strict';

var fs = require('fs');
var path = require('path');
var T = require('./harness.js');

var ROOT = path.join(__dirname, '..');
var ENGINE = path.join(ROOT, 'engine');

['qt-config', 'qt-utils', 'qt-indicators', 'qt-detection', 'qt-candles', 'qt-structure',
 'qt-chart-patterns', 'qt-patterns', 'qt-trend', 'qt-levels', 'qt-risk', 'qt-sentiment',
 'qt-profiles', 'qt-scoring', 'qt-recommendation'].forEach(function (m) {
    require(path.join(ENGINE, m + '.js'));
});
var QT = globalThis.QT;

var BARS = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'btcusd-1d.json'), 'utf8')).bars;
var CARD_JS       = fs.readFileSync(path.join(ENGINE, 'qt-card.js'), 'utf8');
var RISK_JS       = fs.readFileSync(path.join(ENGINE, 'qt-risk.js'), 'utf8');
var DASHBOARD_HTML = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');

/* ---- Build a real proposal from the fixture ------------------------- */
var cfg = QT.profiles.applyProfile('balanced');
var ind = QT.indicators.computeAll(BARS, cfg);
var pat = QT.patterns.analyze(BARS, ind, { config: cfg });
var trend = QT.trend.analyzeTimeframe(ind, pat, { config: cfg });
var atr = QT.utils.lastFinite(ind.atr);
var ctx = QT.detection.buildContext(BARS, ind, cfg);
var levels = QT.levels.analyze(BARS, ctx.swings.minor, atr, cfg);
var proposal = QT.risk.buildProposal({
    bars: BARS, indicators: ind, patternReport: pat, trend: trend,
    levels: levels, swings: ctx.swings.minor, assetClass: 'crypto', config: cfg
});

T.suite('Phase 11 — Pivot points reach the trade proposal (display passthrough)');

T.test('the indicator engine still computes classic pivots', function () {
    T.ok(ind.pivots && typeof ind.pivots === 'object', 'indicators expose a pivots object');
    ['pivot', 'r1', 's1', 'r2', 's2', 'r3', 's3'].forEach(function (k) {
        T.ok(isFinite(ind.pivots[k]), 'pivots.' + k + ' is finite');
    });
});

T.test('trade.levels forwards pivots without recomputing them', function () {
    // buildProposal returns levels at the top level; the recommendation later
    // exposes this same object as rec.trade.levels (what the card renders).
    T.ok(proposal.levels && typeof proposal.levels === 'object', 'proposal exposes a levels object');
    var pv = proposal.levels.pivots;
    T.ok(pv && typeof pv === 'object', 'trade.levels exposes a pivots object');
    T.deepEqual(pv, ind.pivots, 'trade.levels.pivots is the same object the indicator engine produced (no recompute)');
    // Ordering sanity: resistances above pivot, supports below.
    T.ok(pv.r1 > pv.pivot && pv.r2 > pv.r1 && pv.r3 > pv.r2, 'resistance bands ascend above the pivot');
    T.ok(pv.s1 < pv.pivot && pv.s2 < pv.s1 && pv.s3 < pv.s2, 'support bands descend below the pivot');
});

T.test('the passthrough is documented as display-only in the risk engine', function () {
    T.ok(/pivots:\s*ind\.pivots/.test(RISK_JS), 'risk engine assigns pivots from indicators');
    T.ok(/DISPLAY only|display[- ]only/i.test(RISK_JS.slice(RISK_JS.indexOf('pivots: ind.pivots') - 400,
         RISK_JS.indexOf('pivots: ind.pivots') + 40)), 'annotated as display-only near the assignment');
});

T.suite('Phase 11 — Signal card renders the full level set');

T.test('the card renders every requested level family', function () {
    T.ok(/Support \/ Resistance/.test(CARD_JS), 'Support / Resistance rendered');
    T.ok(/Fibonacci/.test(CARD_JS), 'Fibonacci rendered');
    T.ok(/Confluence/.test(CARD_JS), 'Confluence rendered');
    T.ok(/Pivot Points/.test(CARD_JS), 'Pivot Points rendered');
    T.ok(/t\.levels\.pivots/.test(CARD_JS), 'card reads t.levels.pivots');
    // Entry / Stop / Targets live in the Key Levels ladder.
    T.ok(/buildLadder/.test(CARD_JS), 'Entry/Stop/Targets ladder present');
});

T.test('pivot rows are coloured like S/R (resistance bear, support bull)', function () {
    var block = CARD_JS.slice(CARD_JS.indexOf('Pivot Points'), CARD_JS.indexOf('Pivot Points') + 700);
    T.ok(/'R1'.*'R2'.*'R3'/s.test(block) || /R1[\s\S]*R2[\s\S]*R3/.test(block), 'three resistance bands');
    T.ok(/S1[\s\S]*S2[\s\S]*S3/.test(block), 'three support bands');
    T.ok(/'bear'/.test(block) && /'bull'/.test(block), 'bear/bull tones applied');
});

T.suite('Phase 11 — Live Price CSS hook & ticker stability');

T.test('the Live Price block carries a descriptive class', function () {
    T.ok(/keeneye-live-price/.test(CARD_JS), 'qt-card applies the keeneye-live-price class');
    T.ok(/qtw-live-quote-wrap keeneye-live-price/.test(CARD_JS),
         'the descriptive class sits alongside the structural qtw- class (not a replacement)');
});

T.test('the ticker tape is re-mounted on return to the Charts workspace', function () {
    var wire = DASHBOARD_HTML.match(/function wireWorkspaceSwitch\(\)[\s\S]*?\n {8}\}/)[0];
    T.ok(/goingTo === 'charts'/.test(wire), 'detects a switch back to Charts');
    T.ok(/mountTickerTape\(\)/.test(wire), 're-mounts the ticker tape on that switch');
    T.ok(/tickerRetries = 0/.test(wire), 'resets the watchdog retry counter so it stays available');
});

module.exports = T;
