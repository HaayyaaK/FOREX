/**
 * Phase 10 verification — Strategy Validation Dashboard (validation.html).
 *
 * Two concerns, mirroring the rest of the suite:
 *   (1) FUNCTIONAL — the backtester the page consumes (QTBacktest) actually
 *       produces well-formed run / walk-forward / Monte-Carlo output. This is
 *       the "solid foundation" the UI renders; it is exercised here headlessly
 *       against the immutable BTC/USD fixture (deterministic, no network).
 *   (2) STATIC — validation.html is self-contained (no CDN), loads the engine +
 *       backtester in the right order, consumes them exactly as the dashboard
 *       does (QT.app.fetchBundle / QTBacktest), carries the honesty banner, and
 *       the surrounding wiring (dashboard link, servable backtest/ path) is in
 *       place in both the dev server and web.config.
 *
 * The page itself calculates nothing — every number it shows comes out of the
 * backtester — so there is no DOM-render assertion here; correctness of the
 * numbers is the backtester's own Phase 9 suite plus the functional block below.
 */
'use strict';

var fs = require('fs');
var path = require('path');
var T = require('./harness.js');

var ROOT = path.join(__dirname, '..');
var ENGINE = path.join(ROOT, 'engine');

/* ---- Load the engine + backtester into the global namespace --------- */
['qt-config', 'qt-utils', 'qt-indicators', 'qt-detection', 'qt-candles', 'qt-structure',
 'qt-chart-patterns', 'qt-patterns', 'qt-trend', 'qt-levels', 'qt-risk', 'qt-sentiment',
 'qt-profiles', 'qt-scoring', 'qt-recommendation'].forEach(function (m) {
    require(path.join(ENGINE, m + '.js'));
});
var QTBacktest = require(path.join(ROOT, 'backtest', 'qt-backtest.js'));
var QT = globalThis.QT;

var FIXTURE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'btcusd-1d.json'), 'utf8'));
var BARS = FIXTURE.bars || FIXTURE;

var VALIDATION_HTML = fs.readFileSync(path.join(ROOT, 'validation.html'), 'utf8');
var DASHBOARD_HTML  = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');
var WEB_CONFIG      = fs.readFileSync(path.join(ROOT, 'web.config'), 'utf8');
var SERVE_JS        = fs.readFileSync(path.join(ROOT, 'tools', 'serve.js'), 'utf8');

/* ===================================================================== *
 * 1. FUNCTIONAL — the backtester produces well-formed output
 * ===================================================================== */
T.suite('Phase 10 — Backtester functional output (what validation.html renders)');

var CFG = QT.profiles.applyProfile('balanced');
var RUN = QTBacktest.run({ bars: BARS, config: CFG, assetClass: 'crypto' });

T.test('run() returns a coherent result object over the fixture', function () {
    T.ok(RUN && typeof RUN === 'object', 'run() returns an object');
    T.ok(RUN.metrics && typeof RUN.metrics === 'object', 'has a metrics block');
    T.ok(Array.isArray(RUN.trades), 'has a trades array');
    T.ok(Array.isArray(RUN.equityCurve), 'has an equityCurve array');
    T.ok(RUN.counters && typeof RUN.counters.evaluations === 'number', 'has evaluation counters');
    T.ok(RUN.range && RUN.range.bars > 0, 'reports a positive evaluated-bar range');
});

T.test('metrics the summary tiles read are present and well-formed', function () {
    var m = RUN.metrics;
    T.ok(m.trades > 0, 'the fixture generates at least one trade (' + m.trades + ')');
    T.ok(m.winRate >= 0 && m.winRate <= 1, 'winRate is a probability');
    T.ok(isFinite(m.expectancyR), 'expectancyR is finite');
    T.ok(isFinite(m.totalR), 'totalR is finite');
    T.ok(m.profitFactor === Infinity || isFinite(m.profitFactor), 'profitFactor is a number or Infinity');
    T.ok(isFinite(m.maxDrawdownR) && m.maxDrawdownR >= 0, 'maxDrawdownR is a non-negative magnitude');
    T.equal(m.trades, m.wins + m.losses, 'wins + losses === trades');
    T.equal(RUN.equityCurve.length, m.trades, 'one equity-curve point per closed trade');
});

T.test('every trade carries the fields the trade log renders', function () {
    var need = ['direction', 'entryTime', 'entryPrice', 'exitReason', 'realisedR', 'barsHeld', 'regime'];
    var ok = RUN.trades.every(function (t) {
        return need.every(function (k) { return t[k] !== undefined; });
    });
    T.ok(ok, 'all trades expose direction/entryTime/entryPrice/exitReason/realisedR/barsHeld/regime');
    T.ok(RUN.trades.every(function (t) { return isFinite(t.realisedR); }), 'every realisedR is finite');
});

T.test('walk-forward output matches what the WF table renders', function () {
    var wf = CFG.backtest.walkForward;
    var need = CFG.backtest.warmupBars + wf.inSampleBars + wf.outOfSampleBars;
    T.ok(BARS.length >= need, 'fixture is long enough for at least one WF window (' + BARS.length + ' >= ' + need + ')');
    var WF = QTBacktest.walkForward({ bars: BARS, config: CFG, assetClass: 'crypto' });
    T.ok(WF.windowCount >= 1, 'produced at least one window');
    T.ok(Array.isArray(WF.windows) && WF.windows.length === WF.windowCount, 'windows array matches windowCount');
    T.ok(WF.windows.every(function (w) {
        return w.inSample && w.inSample.metrics && w.outOfSample && w.outOfSample.metrics && w.degradation;
    }), 'each window has IS metrics, OOS metrics and a degradation delta');
    T.ok(WF.aggregate && typeof WF.aggregate === 'object', 'has an aggregate summary');
});

T.test('Monte-Carlo output matches what the MC tiles render, and is deterministic', function () {
    var mc1 = QTBacktest.monteCarlo(RUN.trades, { iterations: 1000, seed: 12345 });
    var mc2 = QTBacktest.monteCarlo(RUN.trades, { iterations: 1000, seed: 12345 });
    T.ok(mc1.finalEquityR && mc1.finalEquityR.p05 !== undefined && mc1.finalEquityR.median !== undefined &&
         mc1.finalEquityR.p95 !== undefined, 'finalEquityR exposes p05/median/p95');
    T.ok(mc1.maxDrawdownR && mc1.maxDrawdownR.median !== undefined, 'maxDrawdownR exposes percentiles');
    T.ok(mc1.probabilityOfLoss >= 0 && mc1.probabilityOfLoss <= 1, 'probabilityOfLoss is a probability');
    T.ok(mc1.finalEquityR.p05 <= mc1.finalEquityR.median &&
         mc1.finalEquityR.median <= mc1.finalEquityR.p95, 'percentiles are monotonic');
    T.deepEqual(mc1, mc2, 'same seed reproduces the identical distribution (deterministic)');
});

/* ===================================================================== *
 * 2. STATIC — validation.html is self-contained and wired correctly
 * ===================================================================== */
T.suite('Phase 10 — validation.html structure & self-containment');

T.test('no external/CDN resources — everything is locally hosted', function () {
    T.ok(!/(src|href)\s*=\s*["']https?:\/\//i.test(VALIDATION_HTML),
         'no absolute http(s) src/href (no CDN, no Google Fonts)');
    ['cdn.', 'googleapis', 'unpkg', 'jsdelivr', 'cloudflare.com/ajax'].forEach(function (bad) {
        T.ok(VALIDATION_HTML.indexOf(bad) === -1, 'no reference to ' + bad);
    });
});

T.test('loads the engine in the same order as the dashboard, then backtester + app', function () {
    var order = ['qt-config', 'qt-utils', 'qt-indicators', 'qt-detection', 'qt-candles', 'qt-structure',
                 'qt-chart-patterns', 'qt-patterns', 'qt-trend', 'qt-levels', 'qt-risk', 'qt-sentiment',
                 'qt-profiles', 'qt-scoring', 'qt-recommendation', 'qt-card', 'qt-app'];
    // Match the actual <script src="…"> tags, not prose mentions in comments.
    function scriptIdx(src) {
        var m = VALIDATION_HTML.match(new RegExp('<script src="' + src.replace(/[.\/]/g, '\\$&') + '"'));
        return m ? m.index : -1;
    }
    var lastIdx = -1, inOrder = true;
    order.forEach(function (m) {
        var idx = scriptIdx('engine/' + m + '.js');
        if (idx === -1 || idx < lastIdx) inOrder = false;
        lastIdx = idx;
    });
    T.ok(inOrder, 'all 17 engine scripts present in the dashboard load order');
    var btIdx = scriptIdx('backtest/qt-backtest.js');
    T.ok(btIdx > lastIdx, 'backtester <script> loads after the engine');
});

T.test('consumes the backtester and proxy exactly as the dashboard does', function () {
    T.ok(/QTBacktest\.run\(/.test(VALIDATION_HTML), 'calls QTBacktest.run');
    T.ok(/QTBacktest\.walkForward\(/.test(VALIDATION_HTML), 'calls QTBacktest.walkForward');
    T.ok(/QTBacktest\.monteCarlo\(/.test(VALIDATION_HTML), 'calls QTBacktest.monteCarlo');
    T.ok(/QT\.app\.fetchBundle\(/.test(VALIDATION_HTML), 'fetches data via QT.app.fetchBundle (no direct provider call)');
    T.ok(/QT\.app\.checkHealth\(/.test(VALIDATION_HTML), 'probes connection via QT.app.checkHealth');
    // Presentation-never-calculates: no analytical maths inline. It may format,
    // but must not recompute indicators/scores itself.
    T.ok(!/QT\.indicators\.|QT\.scoring\.|QT\.recommendation\./.test(VALIDATION_HTML),
         'does not call engine analysis modules directly (backtester owns the pipeline)');
});

T.test('carries the honesty banner and required controls', function () {
    T.ok(/not financial advice/i.test(VALIDATION_HTML), 'states "not financial advice"');
    T.ok(/no profitability claim/i.test(VALIDATION_HTML), 'states "no profitability claim"');
    T.ok(/statistical significance/i.test(VALIDATION_HTML), 'surfaces the sample-size caveat');
    T.ok(/id="symbolSelect"/.test(VALIDATION_HTML), 'symbol picker present');
    T.ok(/id="intervalSelect"/.test(VALIDATION_HTML), 'interval picker present');
    T.ok(/id="profileSelect"/.test(VALIDATION_HTML), 'profile picker present');
    T.ok(/id="runBtn"/.test(VALIDATION_HTML), 'run button present');
    T.ok(/href="dashboard\.html"/.test(VALIDATION_HTML), 'links back to the dashboard');
});

T.test('interval options match the proxy-supported timeframe codes', function () {
    ['1', '5', '15', '30', '60', '240', 'D'].forEach(function (code) {
        T.ok(new RegExp('<option value="' + code + '"').test(VALIDATION_HTML),
             'interval option "' + code + '" present');
    });
});

/* ===================================================================== *
 * 3. WIRING — dashboard link + servable backtest/ path
 * ===================================================================== */
T.suite('Phase 10 — wiring: dashboard link & servable backtester');

T.test('the dashboard header links to validation.html', function () {
    T.ok(/id="validationLink"[^>]*href="validation\.html"/.test(DASHBOARD_HTML),
         'header-actions contains a validation link to validation.html');
    T.ok(/id="validationLink"[^>]*target="_blank"/.test(DASHBOARD_HTML),
         'opens in a new tab (does not lose dashboard state)');
});

T.test('backtest/ is servable (validation.html depends on it) but sources stay blocked', function () {
    // web.config rewrite block must no longer include "backtest", but must keep the rest.
    var m = WEB_CONFIG.match(/<match url="\^\(([^)]*)\)\(\/\.\*\)\?\$"/);
    T.ok(m, 'the "Block sensitive paths" rewrite rule is present');
    if (m) {
        var blocked = m[1].split('|');
        T.ok(blocked.indexOf('backtest') === -1, 'web.config no longer blocks backtest/');
        ['\\.env', '\\.git', 'node_modules', 'tests'].forEach(function (seg) {
            T.ok(blocked.indexOf(seg) !== -1, 'web.config still blocks ' + seg);
        });
    }
    // Dev server BLOCKED regex must match: allow backtest, keep tests/.git/node_modules/.env.
    var s = SERVE_JS.match(/const BLOCKED = \/\^\(([^)]*)\)/);
    T.ok(s, 'serve.js BLOCKED regex is present');
    if (s) {
        var sb = s[1].split('|');
        T.ok(sb.indexOf('backtest') === -1, 'serve.js no longer blocks backtest/');
        ['\\.env', '\\.git', 'node_modules', 'tests'].forEach(function (seg) {
            T.ok(sb.indexOf(seg) !== -1, 'serve.js still blocks ' + seg);
        });
    }
});

module.exports = T;
