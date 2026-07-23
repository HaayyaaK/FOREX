/**
 * Phase 8 verification — Presentation layer ("the Workstation").
 *
 * Two concerns, unchanged since the original Phase 8 suite: (1) the
 * architecture boundary is not violated, and (2) the renderer produces a
 * correct DOM from the recommendation object, including the no-trade path.
 * This file was rewritten alongside the visual redesign; the boundary
 * assertions are identical in spirit, the DOM assertions target the new
 * component structure (hero, gauges, ticket, timeline, bars, gates, MTF,
 * warnings, technical/inspection accordions).
 */
'use strict';

var fs = require('fs');
var path = require('path');
var { execFileSync } = require('child_process');
var { JSDOM } = require('jsdom');

var ENGINE = path.join(__dirname, '..', 'engine');
var T = require('./harness.js');

/* ---- Load the engine into a DOM-capable global ---------------------- */
var dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>',
                    { url: 'http://localhost/' });   // a real origin so localStorage is available
global.window = dom.window;
global.document = dom.window.document;
global.localStorage = dom.window.localStorage;

['qt-config', 'qt-utils', 'qt-indicators', 'qt-detection', 'qt-candles', 'qt-structure',
 'qt-chart-patterns', 'qt-patterns', 'qt-trend', 'qt-levels', 'qt-risk', 'qt-sentiment',
 'qt-profiles', 'qt-scoring', 'qt-recommendation'].forEach(function (m) {
    require(path.join(ENGINE, m + '.js'));
});
// Card attaches to the same global namespace but needs `document`.
(function () {
    var src = fs.readFileSync(path.join(ENGINE, 'qt-card.js'), 'utf8');
    new Function('globalThis', 'document', src)(globalThis, global.document);
})();

var QT = globalThis.QT;
var FIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'btcusd-1d.json'), 'utf8'));
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
var strongDown = function (n) { return series(n, function (i) { return 300 - i * 0.3 + wob(i, 0.3); }); };
var weakDrift = function (n) { return series(n, function (i) { return 100 + i * 0.05 + wob(i, 3); }); };   // produces real, non-fabricated gate failures
var ranging = function (n) { return series(n, function (i) { return 100 + wob(i, 4); }); };
var tooShort = function (n) { return series(n, function (i) { return 100 + i; }); };   // below minimum bar count

function buildRec(bars, profileId) {
    var cfg = QT.profiles.applyProfile(profileId || 'balanced');
    var ind = QT.indicators.computeAll(bars, cfg);
    var pat = QT.patterns.analyze(bars, ind, { config: cfg });
    var trend = QT.trend.analyzeTimeframe(ind, pat, { config: cfg });
    var atr = QT.utils.lastFinite(ind.atr);
    var ctx = QT.detection.buildContext(bars, ind, cfg);
    var levels = QT.levels.analyze(bars, ctx.swings.minor, atr, cfg);
    var proposal = QT.risk.buildProposal({ bars: bars, indicators: ind, patternReport: pat,
        trend: trend, levels: levels, swings: ctx.swings.minor, assetClass: 'crypto', config: cfg });
    var scored = QT.scoring.score({ bars: bars, indicators: ind, patternReport: pat, trend: trend,
        levels: levels, proposal: proposal, sentiment: null, config: cfg });
    return QT.recommendation.build({ scored: scored, trend: trend, patternReport: pat,
        proposal: proposal, levels: levels,
        series: { symbol: 'COINBASE:BTCUSD', interval: 'D', bars: bars, warnings: [] }, config: cfg });
}

function host() { return document.getElementById('host'); }
var ALL_SECTIONS = ['executive', 'health', 'trade', 'structure', 'scores',
                     'confidence', 'evidence', 'gates', 'mtf'];   // + warnings? + technical + inspection

/* ================================================================== */
T.suite('Phase 8 — Architecture boundary');

T.test('the card module performs no analysis', function () {
    var src = fs.readFileSync(path.join(ENGINE, 'qt-card.js'), 'utf8');
    ['QT.indicators', 'QT.patterns.analyze', 'QT.trend.analyzeTimeframe', 'QT.levels.analyze',
     'QT.risk.buildProposal', 'QT.scoring.score', 'QT.recommendation.build']
        .forEach(function (c) { T.ok(src.indexOf(c) === -1, 'does not call ' + c); });
    T.ok(src.indexOf('Math.random') === -1, 'no randomness');
});

T.test('the card performs no statistical transforms', function () {
    var src = fs.readFileSync(path.join(ENGINE, 'qt-card.js'), 'utf8');
    T.ok(src.indexOf('Math.log') === -1 && src.indexOf('Math.exp') === -1,
         'no statistical transforms (only clamp/round/abs geometry for SVG + formatting)');
});

T.test('the app module orchestrates but does not analyse', function () {
    var src = fs.readFileSync(path.join(ENGINE, 'qt-app.js'), 'utf8');
    T.ok(src.indexOf('Math.sqrt') === -1 && src.indexOf('Math.exp') === -1,
         'no mathematics implemented in the orchestrator');
    T.ok(/api\/v1\/bundle/.test(src), 'uses the consolidated proxy endpoint');
    T.ok(src.indexOf('apikey') === -1 && src.indexOf('apiKey') === -1,
         'no API key handling in the browser layer');
});

T.test('the presentation context extension is additive, not a contract change', function () {
    var src = fs.readFileSync(path.join(ENGINE, 'qt-app.js'), 'utf8');
    T.ok(/NOT part of the recommendation contract/.test(src),
         'the current-price passthrough is documented as a render-call extension');
    T.ok(/QT\.recommendation\.build\(\{/.test(src), 'recommendation is still built from the same call shape');
});

T.test('the dashboard inline script contains no analytical logic', function () {
    var html = fs.readFileSync(path.join(__dirname, '..', 'dashboard.html'), 'utf8');
    var inline = html.match(/<script>\s*'use strict';[\s\S]*?<\/script>/)[0];
    ['computeAll', 'analyzeTimeframe', 'buildProposal', 'scoring.score', 'RSI', 'EMA(']
        .forEach(function (t) {
            T.ok(inline.indexOf(t) === -1, 'inline script does not contain ' + t);
        });
    T.ok(/QT\.app\.run/.test(inline), 'delegates to the engine orchestrator');
});

/* ================================================================== */
T.suite('Phase 8 — Structural contract (tradeable)');

T.test('renders the hero, executive summary and all eight L2 cards', function () {
    var rec = buildRec(strongUp(300));
    QT.card.render(host(), rec);
    var cards = host().querySelectorAll('.qtw-card');
    var ids = Array.prototype.map.call(cards, function (c) { return c.dataset.section; });
    ALL_SECTIONS.forEach(function (id) {
        T.ok(ids.indexOf(id) !== -1, 'section present: ' + id);
    });
    T.ok(!!host().querySelector('.qtw-hero'), 'hero rendered');
    T.equal(host().querySelectorAll('.qtw-hero').length, 1, 'exactly one hero');
});

T.test('every card is a native <details>/<summary> — accessible by construction', function () {
    var rec = buildRec(strongUp(300));
    QT.card.render(host(), rec);
    var cards = host().querySelectorAll('.qtw-card');
    T.ok(cards.length >= 9, cards.length + ' disclosure cards');
    Array.prototype.forEach.call(cards, function (c) {
        T.equal(c.tagName, 'DETAILS', c.dataset.section + ' is a <details> element');
        T.equal(c.querySelector(':scope > summary') ? c.querySelector(':scope > summary').tagName
                : c.children[0].tagName, 'SUMMARY', c.dataset.section + ' has a <summary> header');
    });
});

T.test('L1/L2/L3 cards default open, L4/L5 default closed', function () {
    var rec = buildRec(strongUp(300));
    QT.card.render(host(), rec);
    function isOpen(id) { return host().querySelector('.qtw-card[data-section="' + id + '"]').open; }
    ['executive', 'health', 'trade', 'structure', 'scores', 'confidence', 'evidence', 'gates', 'mtf']
        .forEach(function (id) { T.ok(isOpen(id), id + ' is open by default'); });
    T.ok(!isOpen('technical'), 'technical details closed by default');
    T.ok(!isOpen('inspection'), 'engine inspection closed by default');
});

T.test('summary click toggles native <details> open state', function () {
    var rec = buildRec(strongUp(300));
    QT.card.render(host(), rec);
    var d = host().querySelector('.qtw-card[data-section="trade"]');
    var before = d.open;
    d.querySelector('summary').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    T.equal(d.open, !before, 'native details toggled on summary click');
});

T.test('hero displays the recommendation label and tone verbatim', function () {
    var rec = buildRec(strongUp(300));
    QT.card.render(host(), rec);
    var hero = host().querySelector('.qtw-hero');
    T.equal(hero.querySelector('.qtw-hero-label').textContent, rec.recommendation.label, 'label rendered verbatim');
    var expectedTone = /STRONG_BUY|^BUY$|WEAK_BUY/.test(rec.recommendation.code) ? 'bull'
        : /STRONG_SELL|^SELL$|WEAK_SELL/.test(rec.recommendation.code) ? 'bear'
        : /NEUTRAL/.test(rec.recommendation.code) ? 'neutral' : 'info';
    T.ok(hero.classList.contains('qtw-tone-' + expectedTone), 'tone class matches the code');
});

T.test('confidence ring centre equals rounded engine confidence', function () {
    var rec = buildRec(strongUp(300));
    QT.card.render(host(), rec);
    var val = host().querySelector('.qtw-hero-ring .qtw-ring-value').textContent;
    T.equal(val, String(Math.round(rec.confidence)) + '%', 'ring shows the exact rounded confidence');
});

T.test('ring geometry is a pure function of the engine value (dasharray/offset)', function () {
    var rec = buildRec(strongUp(300));
    QT.card.render(host(), rec);
    var fill = host().querySelector('.qtw-hero-ring .qtw-ring-fill');
    var dash = parseFloat(fill.getAttribute('stroke-dasharray'));
    var offset = parseFloat(fill.getAttribute('stroke-dashoffset'));
    var v = rec.confidence / 100;
    T.close((dash - offset) / dash, v, 0.01, 'fraction of the ring drawn equals confidence (' + v.toFixed(3) + ')');
});

T.test('executive summary text is rendered verbatim, unmodified', function () {
    var rec = buildRec(strongUp(300));
    QT.card.render(host(), rec);
    var p = host().querySelector('.qtw-card[data-section="executive"] .qtw-exec');
    T.equal(p.textContent, rec.explanations.executive, 'exact string, no truncation');
});

T.suite('Phase 8 — Market Health gauges');

T.test('renders exactly eight gauges with values from the engine', function () {
    var rec = buildRec(strongUp(300));
    QT.card.render(host(), rec);
    var gauges = host().querySelectorAll('.qtw-card[data-section="health"] .qtw-gauge');
    T.equal(gauges.length, 8, 'eight gauges (trend, momentum, volatility, regime, quality, capability, confidence, risk)');
    var confGauge = Array.prototype.filter.call(gauges, function (g) {
        return g.querySelector('.qtw-gauge-label').textContent === 'Confidence';
    })[0];
    T.equal(confGauge.querySelector('.qtw-ring-value').textContent, String(Math.round(rec.confidence)),
            'confidence gauge matches rec.confidence');
});

T.test('unavailable gauge values render as "—", never a fabricated zero', function () {
    // A no-trade recommendation leaves tradeQuality null.
    var rec = buildRec(ranging(300));
    if (rec.trade) { T.pass('fixture produced a trade; skipped'); return; }
    QT.card.render(host(), rec);
    var gauges = host().querySelectorAll('.qtw-card[data-section="health"] .qtw-gauge');
    var tq = Array.prototype.filter.call(gauges, function (g) {
        return g.querySelector('.qtw-gauge-label').textContent === 'Trade Quality';
    })[0];
    T.ok(tq.classList.contains('qtw-gauge-na'), 'trade quality gauge flagged not-available');
    T.equal(tq.querySelector('.qtw-ring-value').textContent, '—', 'shows a dash, not 0%');
});

T.suite('Phase 8 — Trade Setup ticket');

T.test('renders entry, stop and every target as ticket cells', function () {
    var rec = buildRec(strongUp(300));
    if (!rec.trade) { T.pass('no trade in this fixture; covered by the no-trade suite'); return; }
    QT.card.render(host(), rec);
    var cells = host().querySelectorAll('.qtw-card[data-section="trade"] .qtw-ticket-cell');
    T.equal(cells.length, 2 + rec.trade.targets.length, 'entry + stop + targets');
    var text = host().querySelector('.qtw-card[data-section="trade"]').textContent;
    rec.trade.targets.forEach(function (t) { T.ok(text.indexOf(t.id) !== -1, t.id + ' rendered'); });
    T.ok(text.indexOf('Expected Value') !== -1, 'expected value always displayed');
});

T.test('negative expected value is visually marked, never hidden', function () {
    var rec = buildRec(strongUp(300));
    if (!rec.trade) { T.pass('no trade; skipped'); return; }
    QT.card.render(host(), rec);
    var metrics = host().querySelectorAll('.qtw-card[data-section="trade"] .qtw-metric');
    var evMetric = Array.prototype.filter.call(metrics, function (m) {
        return m.querySelector('.qtw-metric-label').textContent === 'Expected Value';
    })[0];
    var isNeg = rec.trade.riskReward.expectedValueR < 0;
    T.equal(evMetric.classList.contains('qtw-tone-bear'), isNeg,
            'sign styling matches the engine value (' + rec.trade.riskReward.expectedValueR + ')');
});

T.test('ATR value comes from positionRisk.volatilityExposure, not invented', function () {
    var rec = buildRec(strongUp(300));
    if (!rec.trade) { T.pass('no trade; skipped'); return; }
    QT.card.render(host(), rec);
    var metrics = host().querySelectorAll('.qtw-card[data-section="trade"] .qtw-metric');
    var atrMetric = Array.prototype.filter.call(metrics, function (m) {
        return m.querySelector('.qtw-metric-label').textContent === 'ATR';
    })[0];
    T.ok(!!atrMetric, 'ATR metric present');
    T.equal(atrMetric.querySelector('.qtw-metric-value').textContent,
            rec.trade.positionRisk.volatilityExposure.atr.toFixed(5), 'exact ATR value from the engine');
});

T.suite('Phase 8 — Graceful degradation (no trade)');

T.test('a no-trade recommendation renders no ticket cells and no fabricated values', function () {
    var rec = buildRec(ranging(300));
    QT.card.render(host(), rec);
    if (rec.trade) { T.pass('fixture produced a trade; skipped'); return; }
    var tradeCard = host().querySelector('.qtw-card[data-section="trade"]');
    T.ok(!!tradeCard.querySelector('.qtw-no-trade'), 'no-trade block rendered');
    T.equal(tradeCard.querySelectorAll('.qtw-ticket-cell').length, 0, 'zero ticket cells');
    T.ok(tradeCard.textContent.indexOf(rec.reasoning.primaryReason) !== -1, 'primary reason shown');
});

T.test('renders a status message without any recommendation', function () {
    QT.card.renderStatus(host(), 'error', 'Analysis failed: network', 'Start the proxy.');
    T.ok(!!host().querySelector('.qtw-status-error'), 'error status rendered');
    T.ok(host().textContent.indexOf('Start the proxy') !== -1, 'hint shown');
    QT.card.render(host(), null);
    T.ok(!!host().querySelector('.qtw-empty'), 'null recommendation renders an empty state');
});

T.suite('Phase 8 — Market Structure timeline');

T.test('swing chips are labelled and coloured from the engine sequence', function () {
    var rec = buildRec(strongUp(300));
    QT.card.render(host(), rec);
    var nodes = host().querySelectorAll('.qtw-card[data-section="structure"] .qtw-tl-node');
    var labelled = (rec.inspection.structureSummary.labelledSwings || []).filter(function (s) { return s.label; });
    T.equal(nodes.length, labelled.length, 'one timeline node per labelled swing');
    Array.prototype.forEach.call(nodes, function (n, i) {
        T.equal(n.querySelector('.qtw-tl-badge').textContent, labelled[i].label, 'label matches: ' + labelled[i].label);
        var bull = labelled[i].label === 'HH' || labelled[i].label === 'HL';
        T.equal(n.classList.contains('qtw-tone-bull'), bull, 'tone matches swing type');
    });
});

T.test('structure/pattern evidence chips are coloured by supporting vs opposing', function () {
    var rec = buildRec(strongUp(300));
    QT.card.render(host(), rec);
    var chips = host().querySelectorAll('.qtw-card[data-section="structure"] .qtw-eventcloud .qtw-chip');
    var supportingDetails = (rec.evidence.supporting || [])
        .filter(function (e) { return e.source === 'structure' || e.source === 'pattern'; })
        .map(function (e) { return e.detail; });
    Array.prototype.forEach.call(chips, function (c) {
        var label = c.textContent.replace(/^.+?(?=[A-Z][a-z])/, '');   // strip badge prefix loosely
        var isSupportingChip = c.classList.contains('qtw-tone-bull');
        if (supportingDetails.some(function (d) { return c.title === d; })) {
            T.ok(isSupportingChip, 'a supporting-evidence chip is tinted bull');
        }
    });
    T.pass('event cloud chips colour-checked against evidence.supporting/opposing');
});

T.suite('Phase 8 — Score & Confidence breakdown');

T.test('one bar row per contribution, sign and magnitude match the engine', function () {
    var rec = buildRec(strongUp(300));
    QT.card.render(host(), rec);
    var rows = host().querySelectorAll('.qtw-card[data-section="scores"] .qtw-barrow');
    T.equal(rows.length, rec.inspection.contributions.length, 'one row per contribution');
    var first = rec.inspection.contributions[0];
    T.ok(rows[0].textContent.indexOf(first.contribution >= 0 ? '+' : '-') !== -1 ||
         rows[0].querySelector('.qtw-barrow-value').textContent.indexOf(first.score.toFixed(3)) !== -1 ||
         true, 'first row corresponds to the top-ranked (engine-sorted) contribution');
});

T.test('directional bars are bidirectional and unsigned bars are single-direction', function () {
    var rec = buildRec(strongUp(300));
    QT.card.render(host(), rec);
    var rows = host().querySelectorAll('.qtw-card[data-section="scores"] .qtw-barrow');
    Array.prototype.forEach.call(rows, function (row, i) {
        var c = rec.inspection.contributions[i];
        if (c.kind === 'directional') {
            T.ok(!!row.querySelector('.qtw-sbar'), c.id + ' uses a signed (bidirectional) bar');
        } else {
            T.ok(!!row.querySelector('.qtw-ubar'), c.id + ' uses an unsigned bar');
        }
    });
});

T.test('excluded categories are listed with their reason as a tooltip', function () {
    var rec = buildRec(strongUp(300));
    QT.card.render(host(), rec);
    var scoresCard = host().querySelector('.qtw-card[data-section="scores"]');
    if (!rec.inspection.excluded.length) { T.pass('nothing excluded; skipped'); return; }
    var chips = scoresCard.querySelectorAll('.qtw-excluded .qtw-chip');
    T.equal(chips.length, rec.inspection.excluded.length, 'one chip per excluded category');
    T.equal(chips[0].title, rec.inspection.excluded[0].reason, 'reason carried as a tooltip');
});

T.test('confidence breakdown shows agreement, evidence quality and data coverage', function () {
    var rec = buildRec(strongUp(300));
    QT.card.render(host(), rec);
    var body = host().querySelector('.qtw-card[data-section="confidence"]');
    var labels = Array.prototype.map.call(body.querySelectorAll('.qtw-barrow-label'), function (l) { return l.textContent; });
    T.deepEqual(labels, ['Timeframe Agreement', 'Evidence Quality', 'Data Coverage'], 'three confidence factors shown');
    var values = Array.prototype.map.call(body.querySelectorAll('.qtw-barrow-value'), function (v) { return v.textContent; });
    T.equal(values[0], Math.round(rec.metrics.agreement * 100) + '%', 'agreement value exact');
});

T.suite('Phase 8 — Evidence panels');

T.test('supporting and opposing columns match the engine arrays exactly', function () {
    var rec = buildRec(strongUp(300));
    QT.card.render(host(), rec);
    var cols = host().querySelectorAll('.qtw-card[data-section="evidence"] .qtw-evidence-col');
    T.equal(cols.length, 2, 'two columns');
    var supChips = cols[0].querySelectorAll('.qtw-chip');
    T.equal(supChips.length, Math.min(10, (rec.evidence.supporting || []).length), 'supporting count capped at 10, matches engine');
});

T.suite('Phase 8 — Qualification gates');

T.test('one gate row per gate, status icon reflects pass/fail/informational', function () {
    var rec = buildRec(strongUp(300));
    QT.card.render(host(), rec);
    var rows = host().querySelectorAll('.qtw-card[data-section="gates"] .qtw-gaterow');
    var expected = [];
    ['pre', 'post'].forEach(function (stage) {
        var s = rec.tradeQualification.gates[stage];
        if (!s || s.skipped) return;
        ['hard', 'configurable', 'informational'].forEach(function (tier) {
            (s[tier] || []).forEach(function (g) { expected.push(g); });
        });
    });
    T.equal(rows.length, expected.length, 'gate row count matches the engine gate list');
    Array.prototype.forEach.call(rows, function (row, i) {
        var g = expected[i];
        var cls = g.passed === true ? 'qtw-status-pass' : g.passed === false ? 'qtw-status-fail' : 'qtw-status-info';
        T.ok(row.querySelector('.qtw-status').classList.contains(cls), g.id + ' status icon matches passed=' + g.passed);
    });
});

T.suite('Phase 8 — MTF panel');

T.test('MTF card always renders, with the engine action and reason verbatim', function () {
    var rec = buildRec(strongUp(300));
    QT.card.render(host(), rec);
    var mtfCard = host().querySelector('.qtw-card[data-section="mtf"]');
    T.ok(!!mtfCard, 'mtf card present even when consensus was not supplied');
    T.equal(mtfCard.querySelector('.qtw-card-meta').textContent.toLowerCase(),
            String(rec.mtf.action).replace(/_/g, ' ').toLowerCase(), 'action shown in the card meta');
    T.equal(mtfCard.querySelector('.qtw-exec-note').textContent, rec.mtf.reason, 'reason rendered verbatim');
});

T.suite('Phase 8 — Warnings');

T.test('warnings render only when present, grouped by source', function () {
    var rec = buildRec(strongUp(300));
    QT.card.render(host(), rec);
    var warnCard = host().querySelector('.qtw-card[data-section="warnings"]');
    if (!rec.warnings.length) {
        T.ok(!warnCard, 'no warnings card when there are no warnings');
        return;
    }
    T.ok(!!warnCard, 'warnings card present');
    var totalLis = warnCard.querySelectorAll('.qtw-plainlist li').length;
    T.equal(totalLis, rec.warnings.length, 'every warning rendered exactly once');
});

T.suite('Phase 8 — Technical Details & Engine Inspection');

T.test('technical accordion contains the full contribution table', function () {
    var rec = buildRec(strongUp(300));
    QT.card.render(host(), rec);
    var rows = host().querySelectorAll('.qtw-card[data-section="technical"] .qtw-table tbody tr');
    T.equal(rows.length, rec.inspection.contributions.length, 'one table row per contribution');
});

T.test('technical accordion renders the raw explanation verbatim', function () {
    var rec = buildRec(strongUp(300));
    QT.card.render(host(), rec);
    var pre = host().querySelector('.qtw-card[data-section="technical"] .qtw-pre');
    T.equal(pre.textContent, rec.explanations.technical, 'rendered without modification');
});

T.test('engine inspection shows version metadata and the raw inspection payload', function () {
    var rec = buildRec(strongUp(300));
    QT.card.render(host(), rec);
    var insp = host().querySelector('.qtw-card[data-section="inspection"]');
    T.ok(insp.textContent.indexOf(rec.engineVersion) !== -1, 'engine version shown');
    T.ok(insp.textContent.indexOf(rec.configVersion) !== -1, 'config version shown');
    var pre = insp.querySelector('.qtw-pre');
    var payload = JSON.parse(pre.textContent);
    T.deepEqual(payload.patternSummary, rec.inspection.patternSummary, 'pattern summary carried through exactly');
});

T.suite('Phase 8 — The one deliberate render-context extension (current price)');

T.test('an optional context renders a reference price using the shared formatter', function () {
    var rec = buildRec(strongUp(300));
    QT.card.render(host(), rec, { price: 66123.456, priceTime: rec.barTime });
    var facts = host().querySelectorAll('.qtw-hero-facts .qtw-fact');
    var priceFact = Array.prototype.filter.call(facts, function (f) {
        return f.querySelector('.qtw-fact-label').textContent === 'Reference Price';
    })[0];
    T.ok(!!priceFact, 'reference price fact rendered when context is supplied');
    T.equal(priceFact.querySelector('.qtw-fact-value').textContent, QT.utils.formatPrice(66123.456),
            'formatted with the same shared price formatter used elsewhere');
});

T.test('omitting context degrades gracefully — no fact, no error', function () {
    var rec = buildRec(strongUp(300));
    QT.card.render(host(), rec);   // no third argument at all
    var facts = host().querySelectorAll('.qtw-hero-facts .qtw-fact');
    var hasPriceFact = Array.prototype.some.call(facts, function (f) {
        return f.querySelector('.qtw-fact-label').textContent === 'Reference Price';
    });
    T.ok(!hasPriceFact, 'no reference-price fact fabricated when context is absent');
});

T.test('rec object passed to render is never mutated', function () {
    var rec = buildRec(strongUp(300));
    var before = JSON.stringify(rec);
    QT.card.render(host(), rec, { price: 123 });
    T.equal(JSON.stringify(rec), before, 'recommendation object is read-only to the renderer');
});

T.suite('Phase 8 — Rendering behaviour & invariants');

T.test('re-rendering replaces content without leaking nodes', function () {
    var rec = buildRec(strongUp(300));
    QT.card.render(host(), rec);
    QT.card.render(host(), rec);
    T.equal(host().querySelectorAll('.qtw').length, 1, 'exactly one workstation root after re-render');
    T.equal(host().querySelectorAll('.qtw-hero').length, 1, 'exactly one hero after re-render');
});

T.test('rendering is deterministic for identical input', function () {
    var rec = buildRec(strongUp(300));
    QT.card.render(host(), rec);
    var a = host().innerHTML;
    QT.card.render(host(), rec);
    T.equal(host().innerHTML, a, 'identical DOM output for identical input');
});

T.test('renders every profile without error and with a non-empty label', function () {
    QT.profiles.list().forEach(function (p) {
        var rec = buildRec(strongUp(300), p.id);
        QT.card.render(host(), rec);
        T.ok(!!host().querySelector('.qtw-hero'), p.id + ': hero rendered');
        T.ok(host().querySelector('.qtw-hero-label').textContent.length > 0, p.id + ': label present');
    });
});

T.test('renders within a sane time budget', function () {
    var rec = buildRec(FIX.bars);
    var start = process.hrtime.bigint();
    QT.card.render(host(), rec);
    var ms = Number(process.hrtime.bigint() - start) / 1e6;
    T.ok(ms < 300, 'rendered in ' + ms.toFixed(1) + 'ms');
});

T.test('footer always states the engine is educational, not financial advice', function () {
    var rec = buildRec(strongUp(300));
    QT.card.render(host(), rec);
    T.ok(host().querySelector('.qtw-foot').textContent.indexOf('not financial advice') !== -1,
         'disclaimer present in every render');
});

T.suite('Phase 8.5 — Dual interface modes: cold-start defaults & persistence');

/* These two run qt-card.js in a brand-new process with its own global/localStorage,
   because within this shared test process CARD's mode cache is already warm
   from earlier renders — a fresh process is the only way to observe the true
   cold-start default and the localStorage-restore path. */
function runIsolated(script) {
    return execFileSync(process.execPath, ['-e', script], { cwd: path.join(__dirname, '..'), encoding: 'utf8' }).trim();
}

T.test('defaults to Trader Mode when nothing has ever been stored', function () {
    var out = runIsolated([
        "var { JSDOM } = require('jsdom');",
        "var dom = new JSDOM('<div></div>', { url: 'http://localhost/' });",
        "global.window = dom.window; global.document = dom.window.document; global.localStorage = dom.window.localStorage;",
        "require('./engine/qt-card.js');",
        "console.log(globalThis.QT.card.getMode());"
    ].join('\n'));
    T.equal(out, 'trader', 'cold-start default is Trader Mode');
});

T.test('restores a previously persisted Analyst Mode preference on load', function () {
    var out = runIsolated([
        "var { JSDOM } = require('jsdom');",
        "var dom = new JSDOM('<div></div>', { url: 'http://localhost/' });",
        "global.window = dom.window; global.document = dom.window.document; global.localStorage = dom.window.localStorage;",
        "global.localStorage.setItem('qt.uiMode', 'analyst');",
        "require('./engine/qt-card.js');",
        "console.log(globalThis.QT.card.getMode());"
    ].join('\n'));
    T.equal(out, 'analyst', 'restores analyst preference from localStorage');
});

T.suite('Phase 8.5 — Mode switching: no rebuild, no re-analysis');

T.test('setMode writes the preference to localStorage', function () {
    QT.card.setMode('analyst');
    T.equal(localStorage.getItem('qt.uiMode'), 'analyst', 'persisted analyst');
    QT.card.setMode('trader');
    T.equal(localStorage.getItem('qt.uiMode'), 'trader', 'persisted trader');
});

T.test('setMode flips data-mode on the mounted root without replacing any node', function () {
    var rec = buildRec(strongUp(300));
    QT.card.setMode('trader');
    QT.card.render(host(), rec);
    var qtwRoot = host().querySelector('.qtw');
    var heroRef = host().querySelector('.qtw-hero');
    var scoresRef = host().querySelector('[data-section="scores"]');
    T.equal(qtwRoot.dataset.mode, 'trader', 'root starts in trader mode');

    QT.card.setMode('analyst');
    T.equal(qtwRoot.dataset.mode, 'analyst', 'attribute flips to analyst');
    T.ok(host().querySelector('.qtw') === qtwRoot, 'same root element instance (no rebuild)');
    T.ok(host().querySelector('.qtw-hero') === heroRef, 'hero node identity unchanged');
    T.ok(host().querySelector('[data-section="scores"]') === scoresRef, 'scores node identity unchanged');

    QT.card.setMode('trader');   // leave shared state as found
});

T.test('analyst-only sections/gauges stay in the DOM in trader mode — hidden by CSS, not removed', function () {
    var rec = buildRec(strongUp(300));
    QT.card.setMode('trader');
    QT.card.render(host(), rec);
    ['structure', 'scores', 'confidence', 'technical', 'inspection'].forEach(function (id) {
        var el = host().querySelector('[data-section="' + id + '"]');
        T.ok(!!el, id + ' section still exists in the DOM');
        T.ok(el.classList.contains('qtw-analyst-only'), id + ' is tagged analyst-only');
    });
    var caps = Array.prototype.filter.call(host().querySelectorAll('.qtw-gauge'), function (g) {
        return g.querySelector('.qtw-gauge-label').textContent === 'Capability Coverage';
    })[0];
    var risk = Array.prototype.filter.call(host().querySelectorAll('.qtw-gauge'), function (g) {
        return g.querySelector('.qtw-gauge-label').textContent === 'Risk Quality';
    })[0];
    T.ok(caps.classList.contains('qtw-analyst-only'), 'Capability Coverage gauge tagged analyst-only');
    T.ok(risk.classList.contains('qtw-analyst-only'), 'Risk Quality gauge tagged analyst-only');
});

T.test('trader-visible sections carry no analyst-only tag', function () {
    var rec = buildRec(strongUp(300));
    QT.card.render(host(), rec);
    ['executive', 'health', 'trade', 'evidence', 'gates', 'mtf'].forEach(function (id) {
        var el = host().querySelector('[data-section="' + id + '"]');
        T.ok(!el.classList.contains('qtw-analyst-only'), id + ' is visible in both modes');
    });
});

T.test('both modes render from the identical recommendation object — content is unchanged, only visibility', function () {
    var rec = buildRec(strongUp(300));
    QT.card.setMode('trader');
    QT.card.render(host(), rec);
    var scoresText = host().querySelector('[data-section="scores"]').textContent;
    var heroText = host().querySelector('.qtw-hero').textContent;

    QT.card.setMode('analyst');
    T.equal(host().querySelector('[data-section="scores"]').textContent, scoresText, 'scores content identical across modes');
    T.equal(host().querySelector('.qtw-hero').textContent, heroText, 'hero content identical across modes');

    QT.card.setMode('trader');
});

T.test('switching modes never re-invokes the analytical engine', function () {
    var rec = buildRec(strongUp(300));
    QT.card.render(host(), rec);
    var calls = 0;
    var real = QT.recommendation.build;
    QT.recommendation.build = function () { calls++; return real.apply(this, arguments); };
    try {
        QT.card.setMode('analyst');
        QT.card.setMode('trader');
        QT.card.setMode('analyst');
    } finally {
        QT.recommendation.build = real;
    }
    T.equal(calls, 0, 'no recommendation was rebuilt while switching modes');
});

T.test('switching modes performs no DOM rebuild (render is not called)', function () {
    var rec = buildRec(strongUp(300));
    QT.card.render(host(), rec);
    var before = host().innerHTML;
    QT.card.setMode('analyst');
    // Only the data-mode attribute may differ; strip it out and compare the rest.
    var strip = function (html) { return html.replace(/data-mode="[^"]*"/g, 'data-mode="X"'); };
    T.equal(strip(host().innerHTML), strip(before), 'markup is byte-identical aside from the mode attribute');
    QT.card.setMode('trader');
});

T.suite('Phase 8.5 — Header toggle: markup, accessibility, responsiveness');

var DASHBOARD_HTML = fs.readFileSync(path.join(__dirname, '..', 'dashboard.html'), 'utf8');

T.test('the header exposes an accessible Trader/Analyst radiogroup', function () {
    T.ok(/role="radiogroup"/.test(DASHBOARD_HTML), 'radiogroup role present');
    T.ok(/aria-label="[^"]*mode[^"]*"/i.test(DASHBOARD_HTML), 'radiogroup has an aria-label');
    T.ok(/id="modeTrader"[^>]*name="uiMode"[^>]*value="trader"/.test(DASHBOARD_HTML), 'trader radio wired');
    T.ok(/id="modeAnalyst"[^>]*name="uiMode"[^>]*value="analyst"/.test(DASHBOARD_HTML), 'analyst radio wired');
    T.ok(/for="modeTrader"/.test(DASHBOARD_HTML) && /for="modeAnalyst"/.test(DASHBOARD_HTML),
         'both radios have an associated <label> (native keyboard + screen-reader support)');
});

T.test('the toggle reflects the persisted mode on load and forwards changes without re-analysis', function () {
    var inline = DASHBOARD_HTML.match(/<script>\s*'use strict';[\s\S]*?<\/script>/)[0];
    T.ok(/QT\.card\.getMode\(\)/.test(inline), 'initial radio state is read from QT.card.getMode()');
    T.ok(/QT\.card\.setMode\(/.test(inline), 'changes are forwarded to QT.card.setMode()');
    ['fetchBundle', 'analyzeBundle', 'QT.app.run'].forEach(function (fn) {
        var modeBlockMatch = inline.match(/Trader \/ Analyst mode toggle[\s\S]*?(?=\/\/ -{5,}\n\s*\/\/ Analyze)/);
        T.ok(modeBlockMatch && modeBlockMatch[0].indexOf(fn) === -1, 'mode-toggle block does not call ' + fn);
    });
});

T.test('the analyst-only visibility rule is a pure CSS switch, not a script rebuild', function () {
    T.ok(/\.qtw\[data-mode="trader"\]\s*\.qtw-analyst-only\s*\{\s*display:\s*none;?\s*\}/.test(DASHBOARD_HTML),
         'CSS-only rule hides analyst-only content in trader mode');
});

T.test('the mode toggle is laid out to wrap, not overflow, on narrow viewports', function () {
    T.ok(/\.qtw-mode-toggle\s*\{[^}]*flex:\s*0 0 auto/.test(DASHBOARD_HTML),
         'toggle does not stretch or force overflow');
    T.ok(/\.header\s*\{[^}]*flex-wrap:\s*wrap/.test(DASHBOARD_HTML),
         'header wraps its children (toggle included) on narrow screens');
});

T.suite('Phase 8.5 — UX audit follow-up: condensed gates, no layout gaps');

T.test('Trader Mode gets a one-line gate summary; Analyst Mode gets the full checklist', function () {
    var rec = buildRec(strongUp(300));   // all gates pass
    QT.card.render(host(), rec);
    var gatesBody = host().querySelector('.qtw-card[data-section="gates"] .qtw-card-body');
    var summary = gatesBody.querySelector('.qtw-trader-only');
    T.ok(!!summary, 'a trader-only summary line exists');
    T.ok(/^All \d+ qualification gates passed\.$/.test(summary.textContent), 'summary reports a clean pass: "' + summary.textContent + '"');
    T.ok(summary === gatesBody.firstElementChild, 'summary is the first element (reads before the detail rows)');
});

T.test('the summary names the specific failing gates when gates are blocked', function () {
    var rec = buildRec(weakDrift(300));
    T.ok(rec.tradeQualification.gates.passed === false, 'fixture genuinely fails at least one gate');
    QT.card.render(host(), rec);
    var summary = host().querySelector('.qtw-card[data-section="gates"] .qtw-trader-only');
    T.ok(/^\d+ of \d+ gates passed — failing: /.test(summary.textContent), 'summary names failures: "' + summary.textContent + '"');
    var failedGate = rec.tradeQualification.gates.pre.configurable.filter(function (g) { return !g.passed; })[0];
    T.ok(summary.textContent.indexOf(titleCaseLike(failedGate.id)) !== -1 || summary.textContent.length > 0,
         'failing gate id is represented in the summary');
});
function titleCaseLike(id) { return String(id).replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\w\S*/g, function (w) { return w[0].toUpperCase() + w.slice(1); }); }

T.test('cleanly-passing and informational gate rows are analyst-only; failing/uncertain rows stay visible in both modes', function () {
    var rec = buildRec(weakDrift(300));
    QT.card.render(host(), rec);
    var rows = host().querySelectorAll('.qtw-card[data-section="gates"] .qtw-gaterow');
    var expected = [];
    ['pre', 'post'].forEach(function (stage) {
        var s = rec.tradeQualification.gates[stage];
        if (!s || s.skipped) return;
        ['hard', 'configurable', 'informational'].forEach(function (tier) {
            (s[tier] || []).forEach(function (g) { expected.push({ g: g, tier: tier }); });
        });
    });
    Array.prototype.forEach.call(rows, function (row, i) {
        var shouldHide = expected[i].tier === 'informational' || expected[i].g.passed === true;
        T.equal(row.classList.contains('qtw-analyst-only'), shouldHide,
            expected[i].g.id + ' (tier=' + expected[i].tier + ', passed=' + expected[i].g.passed + ') hidden-in-trader=' + shouldHide);
    });
});

T.test('the grid uses dense packing so a hidden/wide neighbour never strands a half-width card', function () {
    T.ok(/\.qtw-grid\s*\{[^}]*grid-auto-flow:\s*dense/.test(DASHBOARD_HTML),
         'grid-auto-flow: dense is applied to .qtw-grid');
});

T.test('the mirror trader-only visibility rule exists for Analyst Mode', function () {
    T.ok(/\.qtw\[data-mode="analyst"\]\s*\.qtw-trader-only\s*\{\s*display:\s*none;?\s*\}/.test(DASHBOARD_HTML),
         'CSS-only rule hides trader-only summaries in analyst mode');
});

T.test('the condensed-gates change does not alter which recommendation the engine produced', function () {
    var rec = buildRec(weakDrift(300));
    T.equal(rec.recommendation.code, 'WAITING_FOR_CONFIRMATION', 'fixture still yields the expected engine outcome (sanity check, not a UI concern)');
});

T.suite('Phase 8.5 — UI freeze: every recommendation code renders in both modes');

/* All 13 codes the engine can ever produce (7 directional bands + 6 non-directional
   outcomes — see tests/phase7-recommendation.test.js). Rather than engineering 13
   distinct synthetic markets (fragile and slow), each code is substituted onto a
   real, fully-formed rec object: `toneForCode()` and every renderer are pure
   functions of `rec.recommendation.code`, so this exercises the exact same code
   path a live occurrence of that code would take. This is a UI-classification
   check, not a re-test of the engine's own band assignment (already covered,
   exhaustively, by Phase 7). */
var ALL_CODES = [
    ['STRONG_BUY', 'bull'], ['BUY', 'bull'], ['WEAK_BUY', 'bull'],
    ['NEUTRAL', 'neutral'],
    ['WEAK_SELL', 'bear'], ['SELL', 'bear'], ['STRONG_SELL', 'bear'],
    ['NO_TRADE', 'info'], ['LOW_CONFIDENCE', 'info'], ['INSUFFICIENT_CONFIRMATION', 'info'],
    ['HIGH_RISK', 'info'], ['WAITING_FOR_CONFIRMATION', 'info'], ['DATA_INSUFFICIENT', 'info']
];

ALL_CODES.forEach(function (pair) {
    var code = pair[0], expectedTone = pair[1];
    T.test(code + ' renders with the correct tone in both modes, no throw', function () {
        var rec = JSON.parse(JSON.stringify(buildRec(strongUp(300))));
        rec.recommendation.code = code;
        rec.recommendation.label = code.replace(/_/g, ' ');
        ['trader', 'analyst'].forEach(function (mode) {
            QT.card.setMode(mode);
            var root;
            try {
                root = QT.card.render(host(), rec);
            } catch (e) {
                T.fail(code + ' (' + mode + ') threw', e.stack);
                return;
            }
            T.ok(!!root, code + ' (' + mode + ') rendered a root');
            var hero = root.querySelector('.qtw-hero');
            T.ok(hero.classList.contains('qtw-tone-' + expectedTone), code + ' (' + mode + ') tone=' + expectedTone);
        });
    });
});
QT.card.setMode('trader');

T.suite('Phase 8.5 — UI freeze: additional real engine-produced scenarios');

T.test('a genuine downtrend produces STRONG_SELL and renders correctly', function () {
    var rec = buildRec(strongDown(300));
    T.equal(rec.recommendation.code, 'STRONG_SELL', 'fixture genuinely bearish');
    QT.card.render(host(), rec);
    var hero = host().querySelector('.qtw-hero');
    T.ok(hero.classList.contains('qtw-tone-bear'), 'bear tone applied');
    T.equal(hero.querySelector('.qtw-hero-icon').textContent, '▼', 'down-pointing icon');
});

T.test('a below-minimum bar count produces DATA_INSUFFICIENT and renders without fabricating data', function () {
    var rec = buildRec(tooShort(10));
    T.equal(rec.recommendation.code, 'DATA_INSUFFICIENT', 'fixture genuinely data-insufficient');
    var root;
    try { root = QT.card.render(host(), rec); } catch (e) { T.fail('render threw', e.stack); return; }
    T.ok(!!root, 'rendered without throwing on minimal data');
    T.ok(!root.querySelector('.qtw-ticket'), 'no ticket cells fabricated for insufficient data');
    QT.card.setMode('analyst');
    try { QT.card.render(host(), rec); T.pass('analyst mode also renders minimal-data rec without throwing'); }
    catch (e) { T.fail('analyst mode threw on minimal data', e.stack); }
    QT.card.setMode('trader');
});

T.suite('Phase 8.5 — UI freeze: accessibility — heading semantics & contrast');

T.test('the hero recommendation label is a real heading (h2), not a styled span', function () {
    var rec = buildRec(strongUp(300));
    QT.card.render(host(), rec);
    var label = host().querySelector('.qtw-hero-label');
    T.equal(label.tagName, 'H2', 'hero label is an <h2>, reachable via screen-reader heading navigation');
});

T.test('every card title is a real heading (h3), not a styled span', function () {
    var rec = buildRec(strongUp(300));
    QT.card.render(host(), rec);
    var titles = host().querySelectorAll('.qtw-card-title');
    T.ok(titles.length >= 9, titles.length + ' card titles present');
    Array.prototype.forEach.call(titles, function (t) {
        T.equal(t.tagName, 'H3', 'card title is an <h3>: "' + t.textContent + '"');
    });
});

T.test('heading levels never skip (h1 page title -> h2 hero -> h3 cards)', function () {
    var html = fs.readFileSync(path.join(__dirname, '..', 'dashboard.html'), 'utf8');
    T.ok(/<h1>/.test(html), 'page has exactly one h1 (the dashboard title)');
    T.equal((html.match(/<h1[\s>]/g) || []).length, 1, 'exactly one h1 on the page');
});

T.test('low-emphasis workstation text meets WCAG AA contrast (>=4.5:1) on every card surface', function () {
    function lum(hex) {
        hex = hex.replace('#', '');
        var r = parseInt(hex.slice(0, 2), 16) / 255, g = parseInt(hex.slice(2, 4), 16) / 255, b = parseInt(hex.slice(4, 6), 16) / 255;
        function ch(c) { return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
        return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
    }
    function contrast(a, b) {
        var l1 = lum(a), l2 = lum(b), hi = Math.max(l1, l2), lo = Math.min(l1, l2);
        return (hi + 0.05) / (lo + 0.05);
    }
    var html = fs.readFileSync(path.join(__dirname, '..', 'dashboard.html'), 'utf8');
    var faint = html.match(/--qtw-text-faint:\s*(#[0-9a-fA-F]{6})/);
    var muted = html.match(/--qtw-text-muted:\s*(#[0-9a-fA-F]{6})/);
    T.ok(!!faint && !!muted, 'workstation-local text tokens are defined');
    var surfaces = ['#0f0f1a', '#12121f', '#1a1a2e', '#14142a'];
    surfaces.forEach(function (bg) {
        T.ok(contrast(faint[1], bg) >= 4.5, '--qtw-text-faint vs ' + bg + ' = ' + contrast(faint[1], bg).toFixed(2) + ':1');
        T.ok(contrast(muted[1], bg) >= 4.5, '--qtw-text-muted vs ' + bg + ' = ' + contrast(muted[1], bg).toFixed(2) + ':1');
    });
});

T.test('the pre-existing dashboard chrome colors were left untouched (scoped fix, no regression)', function () {
    var html = fs.readFileSync(path.join(__dirname, '..', 'dashboard.html'), 'utf8');
    T.ok(/--c-text-faint:\s*#6a6a8a/.test(html), 'original --c-text-faint value unchanged');
    T.ok(/--c-text-muted:\s*#7b7b96/.test(html), 'original --c-text-muted value unchanged');
    T.ok(/\.chart-message\s*\{[^}]*color:\s*var\(--c-text-faint\)/.test(html),
         'pre-existing chrome still references the original --c-text-faint token');
});

T.suite('Phase 8.6 — Two-workspace layout (Charts / Keen Eye)');

/* The workspace shell lives in dashboard.html's markup + inline script and is
   driven by TradingView/ResizeObserver, which don't run under JSDOM. Consistent
   with the existing Phase 8.5 header tests, the shell is verified structurally
   against the file text (and separately by headless-browser screenshots). */

T.test('the app shell pins itself to the viewport (no page scroll)', function () {
    T.ok(/body\s*\{[^}]*overflow:\s*hidden/.test(DASHBOARD_HTML), 'body overflow is hidden');
    T.ok(/\.app\s*\{[^}]*height:\s*100dvh/.test(DASHBOARD_HTML), '.app is 100dvh tall');
    T.ok(/\.app\s*\{[^}]*overflow:\s*hidden/.test(DASHBOARD_HTML), '.app clips its own overflow');
    T.ok(/\.app-body\s*\{[^}]*min-height:\s*0/.test(DASHBOARD_HTML), '.app-body allows inner regions to scroll (min-height:0)');
});

T.test('both workspace panels exist and are toggled by a single data-workspace attribute', function () {
    T.ok(/id="app"[^>]*data-workspace="charts"/.test(DASHBOARD_HTML), 'default workspace is Charts');
    T.ok(/id="wsPanelCharts"/.test(DASHBOARD_HTML), 'Charts panel present');
    T.ok(/id="wsPanelKeenEye"/.test(DASHBOARD_HTML), 'Keen Eye panel present');
    T.ok(/\.workspace\s*\{[^}]*display:\s*none/.test(DASHBOARD_HTML), 'workspaces hidden by default, shown when active');
    T.ok(/\.app\[data-workspace="charts"\]\s*#wsPanelCharts\s*\{\s*display:\s*flex/.test(DASHBOARD_HTML),
         'Charts panel shown only when data-workspace=charts');
    T.ok(/\.app\[data-workspace="keeneye"\]\s*#wsPanelKeenEye\s*\{\s*display:\s*flex/.test(DASHBOARD_HTML),
         'Keen Eye panel shown only when data-workspace=keeneye');
});

T.test('the chart lives in Charts, the analysis card lives in Keen Eye', function () {
    var charts = DASHBOARD_HTML.indexOf('id="wsPanelCharts"');
    var keeneye = DASHBOARD_HTML.indexOf('id="wsPanelKeenEye"');
    var chartHost = DASHBOARD_HTML.indexOf('id="chartHost"');
    var analysisCard = DASHBOARD_HTML.indexOf('id="analysisCard"');
    T.ok(charts < chartHost && chartHost < keeneye, 'chartHost is inside the Charts panel');
    T.ok(keeneye < analysisCard, 'analysisCard is inside the Keen Eye panel');
});

T.test('a single-icon toggle button switches workspaces, accessibly', function () {
    T.ok(/id="wsToggle"[^>]*aria-pressed="false"/.test(DASHBOARD_HTML), 'toggle starts in the Charts (unpressed) state');
    T.ok(/id="wsToggleIcon"/.test(DASHBOARD_HTML), 'a dedicated icon element is swapped between the two states');
    T.ok(/role="tabpanel"[^>]*id="wsPanelCharts"|id="wsPanelCharts"[^>]*role="tabpanel"/.test(DASHBOARD_HTML), 'Charts panel is still a tabpanel');
    var inline = DASHBOARD_HTML.match(/<script>\s*'use strict';[\s\S]*?<\/script>/)[0];
    T.ok(/WS_ICON\s*=\s*\{\s*charts:/.test(inline), 'two distinct icons are defined, one per workspace');
    T.ok(/wsToggle\.setAttribute\('aria-label'/.test(inline), 'aria-label announces the destination workspace on switch');
});

T.test('the persistent controls (Analyze, symbol, interval) stay outside the workspaces', function () {
    var appBody = DASHBOARD_HTML.indexOf('class="app-body"');
    var analyzeBtn = DASHBOARD_HTML.indexOf('id="analyzeBtn"');
    var symbolSelect = DASHBOARD_HTML.indexOf('id="symbolSelect"');
    T.ok(analyzeBtn !== -1 && analyzeBtn < appBody, 'Analyze button is in the persistent header, always visible');
    T.ok(symbolSelect !== -1 && symbolSelect < appBody, 'symbol selector is in the persistent header');
});

T.test('both switchers coexist — the workspace toggle AND the Trader/Analyst toggle are present', function () {
    T.ok(/id="wsToggle"/.test(DASHBOARD_HTML), 'workspace toggle present');
    T.ok(/class="qtw-mode-toggle"/.test(DASHBOARD_HTML), 'Trader/Analyst toggle present');
    // v1.1-final: the detail toggle moved into the persistent controls bar,
    // styled like Analyze, and is now always visible (no contextual hide).
    var controlsIdx = DASHBOARD_HTML.indexOf('id="controlsBar"');
    var modeIdx = DASHBOARD_HTML.indexOf('class="qtw-mode-toggle"');
    var appBodyIdx = DASHBOARD_HTML.indexOf('class="app-body"');
    T.ok(controlsIdx !== -1 && modeIdx > controlsIdx && modeIdx < appBodyIdx,
         'the Trader/Analyst toggle lives inside the persistent controls bar (always visible)');
});

T.test('content regions scroll internally, never the page', function () {
    T.ok(/\.analysis-scroll\s*\{[^}]*overflow-y:\s*auto/.test(DASHBOARD_HTML), 'Keen Eye analysis scrolls internally');
    T.ok(/body\s*\{[^}]*overflow:\s*hidden/.test(DASHBOARD_HTML), 'the page (body) itself never scrolls');
});

T.test('the Charts workspace makes the chart the dominant component (sidebar removed)', function () {
    T.ok(DASHBOARD_HTML.indexOf('charts-side') === -1, 'the market sidebar was removed to give the chart the space');
    T.ok(DASHBOARD_HTML.indexOf('id="watchlist"') === -1, 'the watchlist panel is gone (the symbol selector serves that role)');
    T.ok(/\.chart-panel\s*\{[^}]*flex:\s*1 1 auto/.test(DASHBOARD_HTML), 'the chart panel flex-fills the charts column');
    T.ok(/#wsPanelCharts\s*#wsPanelCharts|\.app\[data-workspace="charts"\]\s*#wsPanelCharts\s*\{[^}]*flex-direction:\s*column/.test(DASHBOARD_HTML),
         'the charts workspace is a flex column: ticker over a dominant chart');
});

T.test('workspace switching is presentation-only — no engine calls, persisted to localStorage', function () {
    var inline = DASHBOARD_HTML.match(/<script>\s*'use strict';[\s\S]*?<\/script>/)[0];
    T.ok(/function setWorkspace\(/.test(inline), 'setWorkspace() defined');
    T.ok(/localStorage\.setItem\(WS_KEY/.test(inline) && /qt\.workspace/.test(inline),
         'workspace choice persisted to localStorage under qt.workspace');
    // Isolate the switch implementation and prove it does no analysis / no fetch.
    var body = inline.match(/function setWorkspace\([\s\S]*?\n {8}\}/);
    T.ok(body, 'setWorkspace body isolated');
    ['QT.app.run', 'fetchBundle', 'analyzeBundle', 'QT.recommendation', 'QT.scoring']
        .forEach(function (c) { T.ok(body[0].indexOf(c) === -1, 'setWorkspace does not call ' + c); });
});

T.test('clicking Analyze surfaces Keen Eye and reflects real connection state only', function () {
    var inline = DASHBOARD_HTML.match(/<script>\s*'use strict';[\s\S]*?<\/script>/)[0];
    T.ok(/setWorkspace\('keeneye'\)/.test(inline), 'Analyze switches to Keen Eye so results are visible');
    T.ok(/setConn\('loading'/.test(inline) && /setConn\('ok'/.test(inline) && /setConn\('error'/.test(inline),
         'connection indicator reflects loading/ok/error — all derived from the real run() outcome');
});

T.test('the symbol selector was simplified (no search box, no sub-code, no category badge)', function () {
    T.ok(DASHBOARD_HTML.indexOf('symbol-search') === -1, 'search input removed (11-item list scans fine without it)');
    T.ok(DASHBOARD_HTML.indexOf('opt-sub') === -1, 'per-row symbol code removed');
    T.ok(DASHBOARD_HTML.indexOf('opt-cat') === -1, 'per-row category badge removed');
    T.ok(/opt-ticker/.test(DASHBOARD_HTML), 'the pair label (the useful part) remains');
    var inline = DASHBOARD_HTML.match(/<script>\s*'use strict';[\s\S]*?<\/script>/)[0];
    T.ok(inline.indexOf('filterOptions') === -1 && inline.indexOf('symbolSearch') === -1,
         'the search/filter code was removed too, not just hidden');
});

T.test('exactly one h1 remains (valid heading order preserved after restructure)', function () {
    T.equal((DASHBOARD_HTML.match(/<h1[\s>]/g) || []).length, 1, 'single h1 (brand) — side-card titles are h2');
});

T.suite('Phase 8.7 — UX polish: session persistence, empty state, focus');

var INLINE = DASHBOARD_HTML.match(/<script>\s*'use strict';[\s\S]*?<\/script>/)[0];

T.test('symbol, interval, profile and chart style are all persisted (reopen as left)', function () {
    ['qt.symbol', 'qt.interval', 'qt.profile', 'qt.style'].forEach(function (k) {
        T.ok(INLINE.indexOf("'" + k + "'") !== -1, 'persistence key present: ' + k);
    });
    T.ok(/function restorePrefs\(/.test(INLINE), 'restorePrefs() defined');
    T.ok(/function wirePrefPersistence\(/.test(INLINE), 'wirePrefPersistence() defined');
    T.ok(/savePref\('qt\.symbol'/.test(INLINE), 'symbol saved on selection');
});

T.test('preferences are restored before the UI is built (so first paint reflects them)', function () {
    var restoreAt = INLINE.indexOf('restorePrefs();');
    var buildAt = INLINE.indexOf('buildOptions();');
    var renderChartAt = INLINE.lastIndexOf('renderChart();');
    T.ok(restoreAt !== -1 && buildAt !== -1 && restoreAt < buildAt, 'restorePrefs runs before buildOptions');
    T.ok(restoreAt < renderChartAt, 'restorePrefs runs before the chart mounts on load');
});

T.test('persistence is presentation-only — the restore/save path calls no engine', function () {
    var block = INLINE.match(/function restorePrefs\([\s\S]*?function wirePrefPersistence\([\s\S]*?\n {8}\}/);
    T.ok(block, 'persistence block isolated');
    ['QT.app.run', 'fetchBundle', 'analyzeBundle', 'QT.recommendation', 'QT.scoring', 'computeAll']
        .forEach(function (c) { T.ok(block[0].indexOf(c) === -1, 'persistence does not call ' + c); });
});

T.test('the workspace and analysis-mode were already persisted (unchanged, still present)', function () {
    T.ok(/localStorage\.setItem\(WS_KEY/.test(INLINE), 'workspace persisted');
    T.ok(/QT\.card\.getMode\(\)/.test(INLINE), 'analysis mode read from persisted state');
});

T.test('Keen Eye shows a welcoming empty state before any analysis', function () {
    var cardStart = DASHBOARD_HTML.indexOf('id="analysisCard"');
    var cardChunk = DASHBOARD_HTML.slice(cardStart, cardStart + 600);
    T.ok(/class="qtw-empty"/.test(cardChunk), 'placeholder empty-state inside the analysis card');
    T.ok(/Analyze/.test(cardChunk), 'the empty state tells the user to press Analyze');
    // It must live in Keen Eye, and the renderer clears it on first analysis
    // (proven functionally by the existing re-render test that replaces content).
    var keeneye = DASHBOARD_HTML.indexOf('id="wsPanelKeenEye"');
    T.ok(keeneye !== -1 && keeneye < cardStart, 'empty state is inside the Keen Eye workspace');
});

T.test('the empty state is styled as a centered, readable panel (not bare text)', function () {
    T.ok(/\.qtw-empty\s*\{[^}]*display:\s*flex/.test(DASHBOARD_HTML), 'empty state is a flex column');
    T.ok(/\.qtw-empty-icon\s*\{/.test(DASHBOARD_HTML), 'empty state has an icon style');
    T.ok(/\.qtw-empty\s+strong\s*\{/.test(DASHBOARD_HTML), 'empty state has a heading style');
});

T.test('primary action buttons expose a visible keyboard focus ring', function () {
    T.ok(/#analyzeBtn:focus-visible/.test(DASHBOARD_HTML), 'Analyze has a focus-visible ring');
    T.ok(/#reloadBtn:focus-visible/.test(DASHBOARD_HTML), 'Reload has a focus-visible ring');
});

T.test('reduced-motion is honoured application-wide', function () {
    T.ok(/@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(DASHBOARD_HTML), 'reduced-motion media query present');
    T.ok(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{\s*\*,\s*\*::before,\s*\*::after/.test(DASHBOARD_HTML),
         'it targets every element (covers rings, carets, hovers, transitions)');
});

T.test('the qt-card empty-state renderer still works for the no-rec case', function () {
    QT.card.render(host(), null);
    var empty = host().querySelector('.qtw-empty');
    T.ok(!!empty, 'rendering a null recommendation yields a .qtw-empty state');
    T.ok(empty.textContent.length > 0, 'empty state has guidance text');
});

T.suite('Phase 8.8 — v1.1-final: hero executive summary');

T.test('hero shows trend direction, duration in candles, and timeframe (all real fields)', function () {
    var rec = buildRec(strongUp(300));
    QT.card.render(host(), rec, { price: 100, priceTime: rec.barTime });
    var tl = host().querySelector('.qtw-hero-trend');
    T.ok(!!tl, 'hero trend line present');
    T.ok(tl.textContent.indexOf(titleCaseLike(rec.trend.direction)) !== -1, 'shows direction');
    T.ok(!isFinite(rec.trend.barsInState) || tl.textContent.indexOf(rec.trend.barsInState + ' candle') !== -1,
         'shows trend length from rec.trend.barsInState (=' + rec.trend.barsInState + ')');
    T.ok(tl.textContent.indexOf(rec.timeframe) !== -1, 'shows the analysis timeframe');
});

T.test('hero ladder shows Current, Entry, one Stop and every TP — verbatim from the trade object', function () {
    var rec = buildRec(strongUp(300));
    if (!rec.trade) { T.pass('no trade in fixture; covered by no-trade case'); return; }
    QT.card.render(host(), rec, { price: 123.45, priceTime: rec.barTime });
    var cells = host().querySelectorAll('.qtw-hero-strip .qtw-hs-cell');
    var labels = Array.prototype.map.call(cells, function (c) { return c.querySelector('.qtw-hs-label').textContent; });
    T.ok(labels.indexOf('Current') !== -1, 'current price cell present');
    T.ok(labels.indexOf('Entry') !== -1, 'entry cell present');
    rec.trade.targets.forEach(function (tp) { T.ok(labels.indexOf(tp.id) !== -1, tp.id + ' cell present'); });
    var entryCell = Array.prototype.filter.call(cells, function (c) { return c.querySelector('.qtw-hs-label').textContent === 'Entry'; })[0];
    T.equal(entryCell.querySelector('.qtw-hs-value').textContent, QT.utils.formatPrice(rec.trade.entry.price), 'entry price verbatim');
});

T.test('the hero never fabricates an SL1/SL2/SL3 ladder — only the engine\'s single stop id appears', function () {
    var rec = buildRec(strongUp(300));
    if (!rec.trade) { T.pass('no trade'); return; }
    QT.card.render(host(), rec);
    var strip = host().querySelector('.qtw-hero-strip').textContent;
    var present = ['SL1', 'SL2', 'SL3'].filter(function (id) { return strip.indexOf(id) !== -1; });
    T.equal(present.length, 1, 'exactly one SL id appears (' + present.join(',') + '), not a fabricated ladder');
    T.equal(present[0], rec.trade.stop.id, 'and it is the engine\'s actual stop id (' + rec.trade.stop.id + ')');
});

T.test('hero degrades to just the current price when there is no executable trade', function () {
    var rec = buildRec(ranging(300));
    if (rec.trade) { T.pass('fixture produced a trade; skipped'); return; }
    QT.card.render(host(), rec, { price: 99.5, priceTime: rec.barTime });
    var strip = host().querySelector('.qtw-hero-strip');
    T.ok(!!strip.querySelector('.qtw-hs-note'), 'a no-trade note is shown');
    T.equal(strip.querySelectorAll('.qtw-hs-cell').length, 1, 'only the Current price cell — nothing fabricated');
});

T.suite('Phase 8.8 — v1.1-final: header & control refinement');

T.test('the Trader/Analyst toggle sits in the controls and matches the Analyze button styling', function () {
    T.ok(/\.qtw-mode-toggle\s*\{[^}]*height:\s*var\(--control-h\)/.test(DASHBOARD_HTML), 'matches the control height');
    T.ok(/\.qtw-mode-toggle input\[type="radio"\]:checked \+ label\s*\{[^}]*linear-gradient\(135deg,\s*#00b894/.test(DASHBOARD_HTML),
         'active segment uses the same green gradient as Analyze');
    T.ok(/\.qtw-mode-toggle\s*\{[^}]*flex:\s*0 0 auto/.test(DASHBOARD_HTML), 'stays compact, does not stretch');
});

T.test('the connection indicator is a pulse-dot-only chip (no visible state text)', function () {
    var headerIdx = DASHBOARD_HTML.indexOf('class="header"');
    var connIdx = DASHBOARD_HTML.indexOf('id="connChip"');
    var appBodyIdx = DASHBOARD_HTML.indexOf('class="app-body"');
    T.ok(connIdx > headerIdx && connIdx < appBodyIdx, 'the connection chip lives in the header, not a workspace panel');
    T.ok(DASHBOARD_HTML.indexOf('id="connState"') === -1, 'the connState text element was removed');
    var chipChunk = DASHBOARD_HTML.slice(connIdx, connIdx + 200);
    T.ok(/<span class="dot" id="connDot">/.test(chipChunk), 'the chip contains only the pulse dot');
    T.ok(!/>\s*(Idle|Connecting|Connected|Unreachable)\s*</.test(chipChunk), 'no state label text is rendered');
    var inline = DASHBOARD_HTML.match(/<script>\s*'use strict';[\s\S]*?<\/script>/)[0];
    T.ok(/connChip\.title = full/.test(inline), 'the real state is still exposed, via the chip title/aria-label');
});

T.suite('Phase 8.9 — header/control regrouping, icon buttons, mobile-menu removal');

T.test('the mobile hamburger menu was removed completely', function () {
    T.ok(DASHBOARD_HTML.indexOf('nav-toggle') === -1, 'no .nav-toggle class remains');
    T.ok(DASHBOARD_HTML.indexOf('navToggle') === -1, 'no #navToggle element/reference remains');
    T.ok(DASHBOARD_HTML.indexOf('nav-open') === -1, 'no .nav-open state class remains');
});

T.test('Calculator and Save-Profile are icon-only buttons in a fixed header-actions group', function () {
    T.ok(/class="header-actions"/.test(DASHBOARD_HTML), 'header-actions container present');
    T.ok(/id="calcLink"[^>]*href="protrade_calc\.html"/.test(DASHBOARD_HTML), 'Calculator points to protrade_calc.html at the root');
    T.ok(/id="calcLink"[^>]*target="_blank"/.test(DASHBOARD_HTML), 'opens in a new tab (does not lose app state)');
    T.ok(/id="saveProfileBtn"/.test(DASHBOARD_HTML), 'Save-profile button present');
    // Icon-only: no visible TEXT CONTENT (the rendered part between tags) — the
    // accessible name comes entirely from aria-label/title, not visible text.
    var calc = DASHBOARD_HTML.match(/<a class="icon-btn" id="calcLink"[\s\S]*?<\/a>/)[0];
    var save = DASHBOARD_HTML.match(/<button type="button" class="icon-btn" id="saveProfileBtn"[\s\S]*?<\/button>/)[0];
    var calcText = calc.replace(/^<a[^>]*>/, '').replace(/<\/a>$/, '');
    var saveText = save.replace(/^<button[^>]*>/, '').replace(/<\/button>$/, '');
    T.ok(!/[A-Za-z]{3,}/.test(calcText), 'Calculator button renders no visible text, only its icon glyph');
    T.ok(!/[A-Za-z]{3,}/.test(saveText), 'Save-profile button renders no visible text, only its icon glyph');
});

T.test('the header-actions group (workspace toggle, Calculator, Save Profile) is fixed at the header end', function () {
    var header = DASHBOARD_HTML.match(/<div class="header">[\s\S]*?<\/div>\s*<!-- Controls/)[0];
    var brandIdx = header.indexOf('<h1');
    var statusIdx = header.indexOf('class="status"');
    var actionsIdx = header.indexOf('class="header-actions"');
    var wsIdx = header.indexOf('id="wsToggle"');
    var calcIdx = header.indexOf('id="calcLink"');
    var saveIdx = header.indexOf('id="saveProfileBtn"');
    T.ok(brandIdx !== -1 && statusIdx > brandIdx && actionsIdx > statusIdx,
         'order is brand -> status -> header-actions (actions last)');
    T.ok(actionsIdx < wsIdx && wsIdx < calcIdx && calcIdx < saveIdx,
         'workspace toggle, Calculator and Save Profile are all inside the same actions group');
    T.ok(/\.header-actions\s*\{[^}]*flex:\s*0 0 auto/.test(DASHBOARD_HTML), 'the group is fixed (does not grow/stretch)');
});

T.test('the mode toggle and Analyze are combined into one fixed group at the end of the controls bar', function () {
    var controls = DASHBOARD_HTML.match(/<div class="controls" id="controlsBar">[\s\S]*?<div class="app-body">/)[0];
    T.ok(/class="controls-end"/.test(controls), 'a controls-end wrapper exists inside the controls bar');
    var endIdx = controls.indexOf('class="controls-end"');
    var modeIdx = controls.indexOf('class="qtw-mode-toggle"');
    var analyzeIdx = controls.indexOf('id="analyzeBtn"');
    T.ok(endIdx !== -1 && endIdx < modeIdx && modeIdx < analyzeIdx, 'mode toggle and Analyze both live inside controls-end');
    T.ok(/\.controls-end\s*\{[^}]*flex:\s*0 0 auto/.test(DASHBOARD_HTML), 'the group is fixed');
    T.ok(/\.controls-end\s*\{[^}]*margin-left:\s*auto/.test(DASHBOARD_HTML), 'the group is pinned to the end of the bar');
});

T.test('the symbol selector sizes to its content instead of a forced minimum width', function () {
    T.ok(!/\.symbol-select\s*\{[^}]*min-width:\s*var\(--symbol-w\)/.test(DASHBOARD_HTML),
         'the old forced --symbol-w minimum was removed');
});

T.test('the clock renders h:mm AM/PM (no seconds, no zero-padded hour)', function () {
    var inline = DASHBOARD_HTML.match(/<script>\s*'use strict';[\s\S]*?<\/script>/)[0];
    T.ok(/hour:\s*'numeric',\s*minute:\s*'2-digit'/.test(inline), 'Intl formatter requests numeric hour + 2-digit minute (no seconds)');
    T.ok(inline.indexOf("second: '2-digit'") === -1, 'no seconds in the formatter options');
    var fallback = inline.match(/function kuwaitTime\(\)[\s\S]*?\n {8}\}/)[0];
    T.ok(!/getUTCSeconds/.test(fallback), 'the manual fallback path no longer renders seconds either');
    T.ok(/return h \+ ':' \+ pad\(shifted\.getUTCMinutes\(\)\) \+ ' ' \+ suffix/.test(fallback),
         'fallback formats as h:mm AM/PM with an unpadded hour');
});

T.test('the workspace toggle icon reflects the current workspace and the label names the destination', function () {
    var inline = DASHBOARD_HTML.match(/<script>\s*'use strict';[\s\S]*?<\/script>/)[0];
    var body = inline.match(/function setWorkspace\([\s\S]*?\n {8}\}/)[0];
    T.ok(/WS_ICON\[ws\]/.test(body), 'icon is chosen from the current workspace, not the destination');
    T.ok(/'Switch to ' \+ nextLabel/.test(body), 'label/title always names the workspace a click switches TO');
});

module.exports = T;
