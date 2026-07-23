/**
 * Phase 1 verification — Market Data Layer.
 * Deterministic: uses a virtual clock and a mock transport, no network, no API keys.
 */
'use strict';

require('../engine/qt-config.js');
require('../engine/qt-utils.js');
require('../engine/qt-data.js');

var QT = globalThis.QT;
var T = require('./harness.js');

/* ---- virtual clock & helpers ------------------------------------- */
function makeClock(start) {
    var now = start;
    return { now: function () { return now; },
             advance: function (ms) { now += ms; },
             set: function (v) { now = v; } };
}
function memStorage(seed) {
    var m = Object.assign({}, seed || {});
    return { get: function (k) { return k in m ? m[k] : null; },
             set: function (k, v) { m[k] = v; } };
}
function jsonResponse(body, status) {
    return { ok: (status || 200) < 400, status: status || 200,
             json: function () { return Promise.resolve(body); } };
}
/** Builds a TwelveData-shaped DESC payload from ascending bars. */
function tdPayload(bars) {
    return {
        meta: { symbol: 'BTC/USD', interval: '1h' },
        values: bars.slice().reverse().map(function (b) {
            return {
                datetime: new Date(b.time).toISOString().slice(0, 19).replace('T', ' '),
                open: String(b.open), high: String(b.high),
                low: String(b.low), close: String(b.close),
                volume: String(b.volume === undefined ? 100 : b.volume)
            };
        }),
        status: 'ok'
    };
}
function synthBars(n, startTime, stepMs) {
    var bars = [], price = 100;
    for (var i = 0; i < n; i++) {
        var o = price, c = price + (i % 7 - 3) * 0.5;
        var h = Math.max(o, c) + 0.4, l = Math.min(o, c) - 0.4;
        bars.push({ time: startTime + i * stepMs, open: o, high: h, low: l, close: c, volume: 1000 + i });
        price = c;
    }
    return bars;
}

/* ================================================================== */
T.suite('Phase 1 — Market Data Layer');

/* ---- RateLimiter -------------------------------------------------- */
T.test('rate limiter allows up to the limit then defers', function () {
    var clk = makeClock(1000);
    var rl = new QT.RateLimiter(3, 60000, clk.now);
    T.equal(rl.delayMs(), 0, 'first slot free');
    rl.record(); rl.record(); rl.record();
    T.ok(rl.delayMs() > 0, 'fourth call must wait');
    T.equal(rl.delayMs(), 60000, 'waits the full window from the oldest stamp');
    clk.advance(60001);
    T.equal(rl.delayMs(), 0, 'window slides open again');
});

/* ---- Cache -------------------------------------------------------- */
T.test('cache honours TTL and evicts least-recently-used', function () {
    var clk = makeClock(0);
    var c = new QT.Cache(2, clk.now);
    c.set('a', 1, 100);
    T.equal(c.get('a'), 1, 'value returned before expiry');
    clk.advance(101);
    T.equal(c.get('a'), undefined, 'value expires');

    clk.set(0);
    c.set('x', 1, 1000); c.set('y', 2, 1000);
    c.get('x');                       // refresh x so y is the LRU
    c.set('z', 3, 1000);
    T.equal(c.get('y'), undefined, 'LRU entry evicted');
    T.equal(c.get('x'), 1, 'recently used entry retained');
    T.equal(c.get('z'), 3, 'newest entry retained');
});

/* ---- Normalisation ------------------------------------------------ */
T.test('normalises DESC payload to ascending canonical bars', function () {
    var md = new QT.MarketData({ clock: makeClock(0).now, storage: memStorage() });
    var bars = synthBars(5, Date.UTC(2026, 0, 1), 3600000);
    var out = md.normalizeTwelveData(tdPayload(bars));
    T.equal(out.length, 5, 'all bars kept');
    for (var i = 1; i < out.length; i++) {
        T.ok(out[i].time > out[i - 1].time, 'ascending at ' + i);
    }
    T.ok(Math.abs(out[0].open - bars[0].open) < 1e-9, 'numeric coercion from strings');
    T.equal(typeof out[0].volume, 'number', 'volume coerced to number');
});

T.test('drops malformed rows instead of poisoning the series', function () {
    var md = new QT.MarketData({ clock: makeClock(0).now, storage: memStorage() });
    var payload = tdPayload(synthBars(3, Date.UTC(2026, 0, 1), 3600000));
    payload.values.push({ datetime: '2026-01-01 09:00:00', open: 'abc', high: '1', low: '1', close: '1' });
    var out = md.normalizeTwelveData(payload);
    T.equal(out.length, 3, 'malformed row skipped');
    out.forEach(function (b) { T.ok(isFinite(b.open) && isFinite(b.close), 'all values finite'); });
});

T.test('de-duplicates repeated timestamps', function () {
    var md = new QT.MarketData({ clock: makeClock(0).now, storage: memStorage() });
    var bars = synthBars(3, Date.UTC(2026, 0, 1), 3600000);
    var payload = tdPayload(bars);
    payload.values.push(payload.values[0]);          // duplicate newest
    var out = md.normalizeTwelveData(payload);
    T.equal(out.length, 3, 'duplicate collapsed');
});

T.test('surfaces provider-level errors', function () {
    var md = new QT.MarketData({ clock: makeClock(0).now, storage: memStorage() });
    T.throws(function () { md.normalizeTwelveData({ status: 'error', message: 'bad symbol' }); },
             'provider error becomes DataError');
    T.throws(function () { md.normalizeTwelveData({ values: [] }); }, 'empty series rejected');
});

/* ---- Validation --------------------------------------------------- */
T.test('validation rejects structurally impossible candles', function () {
    var md = new QT.MarketData({ clock: makeClock(0).now, storage: memStorage() });
    var ok = synthBars(300, Date.UTC(2026, 0, 1), 3600000);
    T.equal(md.validateBars(ok, 3600000).length, 0, 'clean series produces no warnings');

    var bad = synthBars(10, Date.UTC(2026, 0, 1), 3600000);
    bad[4].high = bad[4].low - 1;
    T.throws(function () { md.validateBars(bad, 3600000); }, 'high < low rejected');

    var neg = synthBars(10, Date.UTC(2026, 0, 1), 3600000);
    neg[2].close = -5;
    T.throws(function () { md.validateBars(neg, 3600000); }, 'non-positive price rejected');

    var body = synthBars(10, Date.UTC(2026, 0, 1), 3600000);
    body[3].high = Math.min(body[3].open, body[3].close) - 0.01;
    T.throws(function () { md.validateBars(body, 3600000); }, 'body outside range rejected');

    var order = synthBars(10, Date.UTC(2026, 0, 1), 3600000);
    order[5].time = order[4].time;
    T.throws(function () { md.validateBars(order, 3600000); }, 'non-monotonic timestamps rejected');
});

T.test('warns (does not throw) on short series and gaps', function () {
    var md = new QT.MarketData({ clock: makeClock(0).now, storage: memStorage() });
    var short = synthBars(30, Date.UTC(2026, 0, 1), 3600000);
    var w = md.validateBars(short, 3600000);
    T.ok(w.some(function (m) { return /completed bars/.test(m); }), 'short series warns');

    var gapped = synthBars(300, Date.UTC(2026, 0, 1), 3600000);
    gapped.forEach(function (b, i) { if (i > 150) b.time += 50 * 3600000; });
    var w2 = md.validateBars(gapped, 3600000);
    T.ok(w2.some(function (m) { return /missing bar slots/.test(m); }), 'gap warns but does not throw');
});

/* ---- Forming-bar removal (D2 anti-leakage) ------------------------ */
T.test('drops the forming bar so signals are non-repainting', function () {
    var barStart = Date.UTC(2026, 0, 1, 10, 0, 0);
    var bars = synthBars(5, Date.UTC(2026, 0, 1, 6, 0, 0), 3600000);
    T.equal(bars[4].time, barStart, 'fixture aligned');

    var mid = new QT.MarketData({ clock: makeClock(barStart + 1800000).now, storage: memStorage() });
    T.equal(mid.dropFormingBar(bars, 3600000).length, 4, 'incomplete final bar removed');

    var after = new QT.MarketData({ clock: makeClock(barStart + 3600000).now, storage: memStorage() });
    T.equal(after.dropFormingBar(bars, 3600000).length, 5, 'completed final bar retained');
});

/* ---- Retry / timeout semantics ------------------------------------ */
T.test('retries transient failures and gives up after the configured count', function () {
    var calls = 0;
    var md = new QT.MarketData({
        clock: makeClock(0).now,
        storage: memStorage(),
        sleep: function () { return Promise.resolve(); },     // no real waiting
        transport: function () { calls++; return Promise.resolve(jsonResponse({}, 503)); }
    });
    return md.request('twelveData', 'http://x', null, 0).then(
        function () { T.fail('should have rejected'); },
        function (err) {
            T.equal(calls, 1 + QT.CONFIG.providers.twelveData.retries, 'initial call + configured retries');
            T.ok(/TRANSIENT/.test(err.code), 'transient error surfaced: ' + err.code);
        }
    );
});

T.test('does NOT retry a non-transient rejection', function () {
    var calls = 0;
    var md = new QT.MarketData({
        clock: makeClock(0).now, storage: memStorage(),
        sleep: function () { return Promise.resolve(); },
        transport: function () { calls++; return Promise.resolve(jsonResponse({}, 401)); }
    });
    return md.request('twelveData', 'http://x', null, 0).then(
        function () { T.fail('should have rejected'); },
        function (err) {
            T.equal(calls, 1, '401 attempted exactly once');
            T.equal(err.code, 'HTTP_401', 'error code preserved');
        }
    );
});

T.test('recovers when a retry succeeds', function () {
    var calls = 0;
    var md = new QT.MarketData({
        clock: makeClock(0).now, storage: memStorage(),
        sleep: function () { return Promise.resolve(); },
        transport: function () {
            calls++;
            return Promise.resolve(calls < 3 ? jsonResponse({}, 500) : jsonResponse({ ok: 1 }, 200));
        }
    });
    return md.request('twelveData', 'http://x', null, 0).then(function (json) {
        T.equal(json.ok, 1, 'succeeded after retries');
        T.equal(calls, 3, 'took exactly three attempts');
    });
});

T.test('times out a hanging request', function () {
    var md = new QT.MarketData({
        clock: makeClock(0).now, storage: memStorage(),
        sleep: function () { return Promise.resolve(); },
        transport: function () { return new Promise(function () { /* never settles */ }); },
        config: Object.assign({}, QT.CONFIG, {
            providers: Object.assign({}, QT.CONFIG.providers, {
                twelveData: Object.assign({}, QT.CONFIG.providers.twelveData, { timeoutMs: 20, retries: 0 })
            })
        })
    });
    return md.request('twelveData', 'http://x', null, 0).then(
        function () { T.fail('should have timed out'); },
        function (err) { T.equal(err.code, 'TIMEOUT', 'timeout raised'); }
    );
});

/* ---- Caching reduces requests ------------------------------------- */
T.test('cache prevents duplicate network calls', function () {
    var calls = 0;
    var md = new QT.MarketData({
        clock: makeClock(0).now, storage: memStorage(),
        sleep: function () { return Promise.resolve(); },
        transport: function () { calls++; return Promise.resolve(jsonResponse({ v: 1 })); }
    });
    return md.request('twelveData', 'http://x', 'k1', 10000)
        .then(function () { return md.request('twelveData', 'http://x', 'k1', 10000); })
        .then(function () {
            T.equal(calls, 1, 'second call served from cache');
            T.equal(md.stats.cacheHits, 1, 'cache hit counted');
        });
});

/* ---- Credentials --------------------------------------------------- */
T.test('missing API key fails fast with an actionable code', function () {
    var md = new QT.MarketData({ clock: makeClock(0).now, storage: memStorage() });
    T.equal(md.hasCredentials().twelveData, false, 'reports missing key');
    return md.getSeries('COINBASE:BTCUSD', '60').then(
        function () { T.fail('should have rejected'); },
        function (err) { T.equal(err.code, 'NO_API_KEY', 'NO_API_KEY raised'); }
    );
});

T.test('no API key is ever embedded in the shipped config', function () {
    var text = require('fs').readFileSync(__dirname + '/../engine/qt-config.js', 'utf8');
    T.ok(!/apikey\s*[:=]\s*['"][A-Za-z0-9]{12,}/i.test(text), 'no literal key in config');
    T.ok(/storageKey/.test(text), 'keys are read from storage instead');
});

/* ---- End-to-end with mock transport -------------------------------- */
T.test('getSeries returns validated ascending bars', function () {
    var barMs = 3600000;
    var start = Date.UTC(2026, 0, 1);
    var bars = synthBars(300, start, barMs);
    var lastOpen = bars[bars.length - 1].time;

    var md = new QT.MarketData({
        clock: makeClock(lastOpen + barMs).now,             // final bar just completed
        storage: memStorage({ 'qt.apikey.twelvedata': 'TEST_KEY' }),
        sleep: function () { return Promise.resolve(); },
        transport: function (url) {
            T.ok(url.indexOf('BTC%2FUSD') !== -1, 'provider symbol mapped');
            T.ok(url.indexOf('interval=1h') !== -1, 'timeframe mapped to provider interval');
            return Promise.resolve(jsonResponse(tdPayload(bars)));
        }
    });

    return md.getSeries('COINBASE:BTCUSD', '60').then(function (s) {
        T.equal(s.bars.length, 300, 'all completed bars returned');
        T.equal(s.intervalMs, barMs, 'interval milliseconds resolved');
        T.equal(s.warnings.length, 0, 'no warnings on a clean series');
        T.equal(s.source, 'twelvedata', 'source tagged');
        for (var i = 1; i < s.bars.length; i++) {
            if (s.bars[i].time <= s.bars[i - 1].time) T.fail('ordering broken at ' + i);
        }
        T.pass('series strictly ascending');
    });
});

T.test('multi-timeframe fetch de-duplicates repeated intervals', function () {
    var urls = [];
    var barMs = 86400000;
    var bars = synthBars(300, Date.UTC(2025, 0, 1), barMs);
    var md = new QT.MarketData({
        clock: makeClock(bars[bars.length - 1].time + barMs).now,
        storage: memStorage({ 'qt.apikey.twelvedata': 'TEST_KEY' }),
        sleep: function () { return Promise.resolve(); },
        transport: function (url) { urls.push(url); return Promise.resolve(jsonResponse(tdPayload(bars))); }
    });
    // ladder for 'D' is { ltf:'D', mtf:'D', htf:'D' } => exactly one network call
    return md.getMultiTimeframe('COINBASE:BTCUSD', 'D').then(function (r) {
        T.equal(urls.length, 1, 'identical intervals fetched once');
        T.ok(r.ltf && r.mtf && r.htf, 'all three slots populated');
        T.equal(r.errors.length, 0, 'no errors');
    });
});

T.test('news and spot rate degrade gracefully without keys', function () {
    var md = new QT.MarketData({ clock: makeClock(0).now, storage: memStorage() });
    return Promise.all([
        md.getNews('COINBASE:BTCUSD'),
        md.getSpotRate('FX:EURUSD')
    ]).then(function (r) {
        T.deepEqual(r[0], [], 'news returns empty array, never throws');
        T.equal(r[1], null, 'spot rate returns null, never throws');
    });
});

T.test('news failure never breaks analysis', function () {
    var md = new QT.MarketData({
        clock: makeClock(0).now,
        storage: memStorage({ 'qt.apikey.newsapi': 'K' }),
        sleep: function () { return Promise.resolve(); },
        transport: function () { return Promise.reject(new Error('offline')); }
    });
    return md.getNews('COINBASE:BTCUSD').then(function (list) {
        T.deepEqual(list, [], 'swallowed transport failure');
    });
});

module.exports = T;
