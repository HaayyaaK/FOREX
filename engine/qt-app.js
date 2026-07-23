/**
 * qt-app.js — Phase 8: application orchestration.
 *
 * Wires the Analyze button to: proxy fetch → engine pipeline → card render.
 * Contains no analytical logic; it sequences calls and handles UI state only.
 *
 * All market data flows through the proxy (see PROXY-REVIEW.md). The browser
 * never holds an API key and never contacts a data provider directly.
 */
(function (root) {
    'use strict';

    var QT = root.QT = root.QT || {};

    var APP = {
        proxyBaseUrl: null,
        lastRecommendation: null,
        running: false
    };

    /** Resolves the proxy base URL: explicit override, else same host on :3001. */
    function resolveProxy() {
        if (APP.proxyBaseUrl) return APP.proxyBaseUrl;
        try {
            var stored = localStorage.getItem('qt.proxyBaseUrl');
            if (stored) return stored;
        } catch (e) { /* storage may be unavailable */ }
        var loc = root.location;
        if (loc && loc.protocol.indexOf('http') === 0) {
            var h = loc.hostname;
            // Local dev: talk to the Node proxy directly on :3001.
            if (h === 'localhost' || h === '127.0.0.1') {
                return loc.protocol + '//' + h + ':3001';
            }
            // Production (tunnelled domain): use the SAME origin so the IIS ARR
            // reverse proxy forwards /api/* to 127.0.0.1:3001. The proxy port is
            // never exposed publicly, and same-origin satisfies CSP connect-src 'self'.
            return loc.origin;
        }
        return 'http://localhost:3001';
    }

    APP.setProxyBaseUrl = function (url) {
        APP.proxyBaseUrl = url;
        try { localStorage.setItem('qt.proxyBaseUrl', url); } catch (e) { /* noop */ }
    };

    /** Fetches the consolidated analysis bundle from the proxy. */
    APP.fetchBundle = function (symbol, timeframe) {
        var url = resolveProxy() + '/api/v1/bundle?symbol=' + encodeURIComponent(symbol) +
                  '&timeframe=' + encodeURIComponent(timeframe);
        return fetch(url, { method: 'GET' })
            .then(function (res) {
                return res.json().then(function (body) {
                    if (!res.ok || body.ok === false) {
                        var err = (body && body.error) || {};
                        var e = new Error(err.message || ('Proxy responded ' + res.status));
                        e.code = err.code || ('HTTP_' + res.status);
                        e.retryable = !!err.retryable;
                        throw e;
                    }
                    return body;
                });
            });
    };

    /** The resolved proxy base URL (for diagnostics / status probes). */
    APP.getProxyBase = function () { return resolveProxy(); };

    /**
     * Lightweight liveness probe of the analysis proxy (GET /api/v1/health).
     * Resolves to { ok, status, body } — never rejects — so callers can drive a
     * connection indicator without try/catch. Used by the header status chip so
     * it reflects real reachability instead of sitting at a stale "Idle".
     */
    APP.checkHealth = function () {
        var url = resolveProxy() + '/api/v1/health';
        return fetch(url, { method: 'GET', cache: 'no-store' })
            .then(function (res) {
                return res.json().then(function (body) {
                    var healthy = res.ok && (!body || body.ok !== false);
                    var status = body && body.data && body.data.status;
                    return { ok: healthy, status: status || (healthy ? 'ok' : 'error'), body: body };
                }).catch(function () {
                    return { ok: res.ok, status: res.ok ? 'ok' : 'error', body: null };
                });
            })
            .catch(function (err) {
                return { ok: false, status: 'unreachable', body: null, error: err };
            });
    };

    /**
     * Runs the full analytical pipeline over a bundle.
     * Pure orchestration: every calculation happens inside an engine module.
     */
    APP.analyzeBundle = function (bundle, options) {
        options = options || {};
        var cfg = QT.profiles.applyProfile(options.profile || 'balanced');
        var data = bundle.data;
        var series = data.series.ltf;
        if (!series || !series.bars || !series.bars.length) {
            throw new Error('Primary timeframe returned no bars');
        }
        var bars = series.bars;

        var indicators = QT.indicators.computeAll(bars, cfg);
        var patternReport = QT.patterns.analyze(bars, indicators, {
            config: cfg,
            capabilities: bundle.capabilities
        });
        var trend = QT.trend.analyzeTimeframe(indicators, patternReport, {
            config: cfg,
            capabilities: bundle.capabilities
        });

        /* Multi-timeframe consensus across whatever the bundle actually returned. */
        var perTf = {};
        ['ltf', 'mtf', 'htf'].forEach(function (slot) {
            var s = data.series[slot];
            if (!s || !s.bars || s.bars.length < 30) { perTf[slot] = null; return; }
            if (slot === 'ltf') { perTf[slot] = trend; return; }
            var ind = QT.indicators.computeAll(s.bars, cfg);
            var pat = QT.patterns.analyze(s.bars, ind, { config: cfg, capabilities: bundle.capabilities });
            perTf[slot] = QT.trend.analyzeTimeframe(ind, pat, { config: cfg, capabilities: bundle.capabilities });
        });
        var consensus = QT.trend.consensus(perTf, cfg);

        var atr = QT.utils.lastFinite(indicators.atr);
        var ctx = QT.detection.buildContext(bars, indicators, cfg);
        var levels = QT.levels.analyze(bars, ctx.swings.minor, atr, cfg);

        var meta = cfg.symbols[data.symbol] || {};
        var proposal = QT.risk.buildProposal({
            bars: bars, indicators: indicators, patternReport: patternReport, trend: trend,
            levels: levels, swings: ctx.swings.minor,
            assetClass: data.assetClass || meta.class || cfg.risk.defaultClass,
            config: cfg
        });

        var sentiment = QT.sentiment && data.news
            ? QT.sentiment.analyze(data.news, cfg)
            : { available: false, reason: 'news sentiment module not loaded' };

        var scored = QT.scoring.score({
            bars: bars, indicators: indicators, patternReport: patternReport, trend: trend,
            levels: levels, proposal: proposal, sentiment: sentiment, config: cfg
        });

        var rec = QT.recommendation.build({
            scored: scored, trend: trend, patternReport: patternReport, proposal: proposal,
            levels: levels,
            // Consensus is an INPUT to the decision, not a post-hoc decoration.
            consensus: consensus,
            series: { symbol: data.symbol, interval: series.interval, bars: bars,
                      warnings: bundle.warnings || [] },
            config: cfg
        });

        /* Presentation context — NOT part of the recommendation contract.
         * `rec` above is the unmodified Phase 7 output. This is a display-only
         * value (the last fetched close) forwarded from data qt-app.js already
         * holds, passed as the renderer's optional third argument so the card
         * can show a reference price without the engine's JSON changing. */
        var lastBar = bars[bars.length - 1];
        var context = { price: lastBar ? lastBar.close : null, priceTime: lastBar ? lastBar.time : null };

        return { rec: rec, context: context };
    };

    /**
     * End-to-end: fetch → analyze → render.
     * @param {Object} opts { symbol, timeframe, profile, container, button }
     */
    APP.run = function (opts) {
        if (APP.running) return Promise.resolve(null);
        APP.running = true;

        var container = opts.container;
        var button = opts.button;
        if (button) { button.disabled = true; button.dataset.busy = 'true'; }
        QT.card.renderStatus(container, 'loading', 'Analyzing ' + opts.symbol + '…',
                             'Fetching market data through the proxy and running the engine.');

        return APP.fetchBundle(opts.symbol, opts.timeframe)
            .then(function (bundle) {
                var result = APP.analyzeBundle(bundle, { profile: opts.profile });
                APP.lastRecommendation = result.rec;
                QT.card.render(container, result.rec, result.context);
                return result.rec;
            })
            .catch(function (err) {
                var hint = err.code === 'PROVIDER_NOT_CONFIGURED'
                    ? 'The proxy is running but a provider API key is not set in its .env file.'
                    : /Failed to fetch|NetworkError/i.test(err.message)
                        ? 'Could not reach the proxy at ' + resolveProxy() +
                          '. Start it with "npm start" in the trading-proxy folder.'
                        : (err.code ? 'Error code: ' + err.code : '');
                QT.card.renderStatus(container, 'error', 'Analysis failed: ' + err.message, hint);
                return null;
            })
            .then(function (result) {
                APP.running = false;
                if (button) { button.disabled = false; delete button.dataset.busy; }
                return result;
            });
    };

    QT.app = APP;

})(typeof globalThis !== 'undefined' ? globalThis : this);
