/**
 * qt-data.js — Phase 1: Market Data Layer.
 *
 * Responsibilities:
 *   - credential handling (localStorage, never hard-coded)
 *   - rate limiting per provider (sliding window)
 *   - caching with timeframe-aware TTL
 *   - timeout + bounded retry with backoff
 *   - normalisation of provider payloads into a canonical OHLCV bar array
 *   - validation (ordering, gaps, price sanity) and rejection of bad series
 *   - removal of the forming bar so downstream maths is non-repainting (D2 gate)
 *
 * The network transport is injectable so the layer is fully testable offline.
 */
(function (root) {
    'use strict';

    var QT = root.QT = root.QT || {};
    var CFG = QT.CONFIG;
    var U = QT.utils;

    /* ================================================================
     * Errors
     * ================================================================ */
    function DataError(code, message, details) {
        this.name = 'DataError';
        this.code = code;
        this.message = message;
        this.details = details || null;
    }
    DataError.prototype = Object.create(Error.prototype);
    DataError.prototype.constructor = DataError;

    /* ================================================================
     * Sliding-window rate limiter
     * ================================================================ */
    function RateLimiter(limit, windowMs, clock) {
        this.limit = limit;
        this.windowMs = windowMs;
        this.clock = clock || function () { return Date.now(); };
        this.stamps = [];
    }
    RateLimiter.prototype.prune = function () {
        var cutoff = this.clock() - this.windowMs;
        while (this.stamps.length && this.stamps[0] <= cutoff) this.stamps.shift();
    };
    /** Milliseconds the caller must wait before a slot frees up (0 = go now). */
    RateLimiter.prototype.delayMs = function () {
        this.prune();
        if (this.stamps.length < this.limit) return 0;
        return Math.max(0, this.stamps[0] + this.windowMs - this.clock());
    };
    RateLimiter.prototype.record = function () {
        this.stamps.push(this.clock());
    };

    /* ================================================================
     * TTL cache
     * ================================================================ */
    function Cache(maxEntries, clock) {
        this.max = maxEntries;
        this.clock = clock || function () { return Date.now(); };
        this.map = new Map();
    }
    Cache.prototype.get = function (key) {
        var e = this.map.get(key);
        if (!e) return undefined;
        if (this.clock() > e.expires) { this.map.delete(key); return undefined; }
        // refresh LRU position
        this.map.delete(key);
        this.map.set(key, e);
        return e.value;
    };
    Cache.prototype.set = function (key, value, ttlMs) {
        if (this.map.has(key)) this.map.delete(key);
        this.map.set(key, { value: value, expires: this.clock() + ttlMs });
        while (this.map.size > this.max) {
            this.map.delete(this.map.keys().next().value);
        }
    };
    Cache.prototype.clear = function () { this.map.clear(); };

    /* ================================================================
     * MarketData
     * ================================================================ */
    function MarketData(options) {
        options = options || {};
        this.config = options.config || CFG;
        this.clock = options.clock || function () { return Date.now(); };
        this.transport = options.transport || defaultTransport;
        this.sleep = options.sleep || function (ms) {
            return new Promise(function (r) { setTimeout(r, ms); });
        };
        this.storage = options.storage || defaultStorage();
        this.cache = new Cache(this.config.cache.maxEntries, this.clock);

        var p = this.config.providers;
        this.limiters = {
            twelveData:   new RateLimiter(p.twelveData.rateLimit.requests,   p.twelveData.rateLimit.windowMs,   this.clock),
            exchangeRate: new RateLimiter(p.exchangeRate.rateLimit.requests, p.exchangeRate.rateLimit.windowMs, this.clock),
            newsApi:      new RateLimiter(p.newsApi.rateLimit.requests,      p.newsApi.rateLimit.windowMs,      this.clock)
        };
        this.stats = { requests: 0, cacheHits: 0, retries: 0, failures: 0 };
    }

    function defaultStorage() {
        try {
            if (typeof localStorage !== 'undefined') {
                return {
                    get: function (k) { return localStorage.getItem(k); },
                    set: function (k, v) { localStorage.setItem(k, v); }
                };
            }
        } catch (e) { /* access can throw in restricted contexts */ }
        var mem = {};
        return {
            get: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
            set: function (k, v) { mem[k] = v; }
        };
    }

    function defaultTransport(url, opts) {
        return fetch(url, opts);
    }

    MarketData.prototype.apiKey = function (provider) {
        var key = this.storage.get(this.config.providers[provider].storageKey);
        return key && String(key).trim() ? String(key).trim() : null;
    };

    MarketData.prototype.setApiKey = function (provider, value) {
        this.storage.set(this.config.providers[provider].storageKey, String(value || '').trim());
    };

    MarketData.prototype.hasCredentials = function () {
        return {
            twelveData:   !!this.apiKey('twelveData'),
            exchangeRate: !!this.apiKey('exchangeRate'),
            newsApi:      !!this.apiKey('newsApi')
        };
    };

    /**
     * Single HTTP GET returning parsed JSON, with timeout, retry and rate limiting.
     * Retries only on transient conditions (network, timeout, 429, 5xx).
     */
    MarketData.prototype.request = function (provider, url, cacheKey, ttlMs) {
        var self = this;
        var pCfg = this.config.providers[provider];

        if (cacheKey) {
            var hit = this.cache.get(cacheKey);
            if (hit !== undefined) { self.stats.cacheHits++; return Promise.resolve(hit); }
        }

        function attempt(n) {
            var wait = self.limiters[provider].delayMs();
            var start = wait > 0 ? self.sleep(wait) : Promise.resolve();

            return start.then(function () {
                self.limiters[provider].record();
                self.stats.requests++;
                return self.fetchWithTimeout(url, pCfg.timeoutMs);
            }).then(function (res) {
                var transient = res.status === 429 || (res.status >= 500 && res.status < 600);
                if (!res.ok && !transient) {
                    throw new DataError('HTTP_' + res.status, 'Provider rejected the request (HTTP ' + res.status + ')');
                }
                if (transient) throw new DataError('TRANSIENT_' + res.status, 'Transient provider error');
                return res.json();
            }).then(function (json) {
                if (cacheKey) self.cache.set(cacheKey, json, ttlMs);
                return json;
            }).catch(function (err) {
                var retryable = !(err instanceof DataError) || /^TRANSIENT_|^TIMEOUT$|^NETWORK$/.test(err.code || '');
                if (retryable && n < pCfg.retries) {
                    self.stats.retries++;
                    var backoff = pCfg.retryBackoffMs[Math.min(n, pCfg.retryBackoffMs.length - 1)];
                    return self.sleep(backoff).then(function () { return attempt(n + 1); });
                }
                self.stats.failures++;
                throw err;
            });
        }
        return attempt(0);
    };

    MarketData.prototype.fetchWithTimeout = function (url, timeoutMs) {
        var self = this;
        var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        var timer = null;

        var timeout = new Promise(function (_resolve, reject) {
            timer = setTimeout(function () {
                if (controller) { try { controller.abort(); } catch (e) { /* noop */ } }
                reject(new DataError('TIMEOUT', 'Request timed out after ' + timeoutMs + 'ms'));
            }, timeoutMs);
        });

        var call = Promise.resolve()
            .then(function () {
                return self.transport(url, controller ? { signal: controller.signal } : {});
            })
            .catch(function (err) {
                if (err instanceof DataError) throw err;
                throw new DataError('NETWORK', 'Network request failed: ' + (err && err.message ? err.message : err));
            });

        return Promise.race([call, timeout]).then(function (res) {
            if (timer) clearTimeout(timer);
            return res;
        }, function (err) {
            if (timer) clearTimeout(timer);
            throw err;
        });
    };

    /* ================================================================
     * Normalisation & validation
     * ================================================================ */

    /**
     * Converts a TwelveData time_series payload into ascending canonical bars.
     * Canonical bar: { time (ms), open, high, low, close, volume }
     */
    MarketData.prototype.normalizeTwelveData = function (payload) {
        if (!payload || typeof payload !== 'object') {
            throw new DataError('BAD_PAYLOAD', 'Empty response from TwelveData');
        }
        if (payload.status === 'error' || payload.code >= 400) {
            throw new DataError('PROVIDER_ERROR', payload.message || 'TwelveData returned an error');
        }
        var values = payload.values;
        if (!Array.isArray(values) || values.length === 0) {
            throw new DataError('NO_DATA', 'TwelveData returned no candles for this symbol/interval');
        }

        var bars = [];
        for (var i = 0; i < values.length; i++) {
            var v = values[i];
            var t = Date.parse(String(v.datetime).replace(' ', 'T') +
                    (/(Z|[+\-]\d{2}:?\d{2})$/.test(String(v.datetime)) ? '' : 'Z'));
            var o = U.toNumber(v.open), h = U.toNumber(v.high),
                l = U.toNumber(v.low),  c = U.toNumber(v.close);
            var vol = v.volume === undefined || v.volume === null ? 0 : U.toNumber(v.volume);
            if (!isFinite(t) || !U.isFiniteNumber(o) || !U.isFiniteNumber(h) ||
                !U.isFiniteNumber(l) || !U.isFiniteNumber(c)) {
                continue;                                    // skip malformed rows rather than poison the series
            }
            bars.push({ time: t, open: o, high: h, low: l, close: c,
                        volume: U.isFiniteNumber(vol) ? vol : 0 });
        }
        // TwelveData returns newest-first; canonical order is oldest-first.
        bars.sort(function (a, b) { return a.time - b.time; });

        // Drop duplicate timestamps, keeping the last occurrence.
        var deduped = [];
        for (var j = 0; j < bars.length; j++) {
            if (deduped.length && deduped[deduped.length - 1].time === bars[j].time) {
                deduped[deduped.length - 1] = bars[j];
            } else {
                deduped.push(bars[j]);
            }
        }
        return deduped;
    };

    /**
     * Structural validation. Throws on unusable data, returns a warning list otherwise.
     */
    MarketData.prototype.validateBars = function (bars, intervalMs) {
        var cfg = this.config.data;
        var warnings = [];

        if (!Array.isArray(bars) || bars.length === 0) {
            throw new DataError('NO_DATA', 'No candles available after normalisation');
        }

        for (var i = 0; i < bars.length; i++) {
            var b = bars[i];
            if (!(b.high >= b.low - U.EPS)) {
                throw new DataError('BAD_BAR', 'Candle ' + i + ' has high < low', b);
            }
            if (b.open <= 0 || b.close <= 0 || b.high <= 0 || b.low <= 0) {
                throw new DataError('BAD_BAR', 'Candle ' + i + ' has a non-positive price', b);
            }
            var hi = Math.max(b.open, b.close), lo = Math.min(b.open, b.close);
            if (b.high < hi - U.EPS || b.low > lo + U.EPS) {
                throw new DataError('BAD_BAR', 'Candle ' + i + ' body lies outside its range', b);
            }
            if (i > 0 && bars[i].time <= bars[i - 1].time) {
                throw new DataError('BAD_ORDER', 'Timestamps are not strictly increasing at index ' + i);
            }
        }

        if (intervalMs > 0 && bars.length > 2) {
            var expected = bars.length - 1;
            var spanned = Math.round((bars[bars.length - 1].time - bars[0].time) / intervalMs);
            var missing = Math.max(0, spanned - expected);
            var ratio = spanned > 0 ? missing / spanned : 0;
            if (ratio > cfg.maxGapRatio) {
                warnings.push('Series has ' + missing + ' missing bar slots (' +
                              (ratio * 100).toFixed(1) + '%), typical of weekends or market closures.');
            }
        }

        if (bars.length < cfg.minBars) {
            warnings.push('Only ' + bars.length + ' completed bars available; ' + cfg.minBars +
                          ' recommended. Long-period indicators will be unavailable.');
        }
        return warnings;
    };

    /**
     * Removes the still-forming bar. Non-repainting requirement (D2 anti-leakage).
     * A bar is "forming" when now < barOpenTime + intervalMs.
     */
    MarketData.prototype.dropFormingBar = function (bars, intervalMs) {
        if (!this.config.data.dropFormingBar || bars.length === 0 || !(intervalMs > 0)) return bars;
        var last = bars[bars.length - 1];
        if (this.clock() < last.time + intervalMs) return bars.slice(0, -1);
        return bars;
    };

    /* ================================================================
     * Public: OHLCV retrieval
     * ================================================================ */
    MarketData.prototype.ttlFor = function (intervalMs) {
        var c = this.config.cache;
        return U.clamp(intervalMs * c.ttlMultiplier, c.minTtlMs, c.maxTtlMs);
    };

    /**
     * Fetches, normalises, validates and trims a candle series.
     * @returns {Promise<{symbol,interval,intervalMs,bars,warnings,source,fetchedAt}>}
     */
    MarketData.prototype.getSeries = function (dashboardSymbol, timeframeKey) {
        var self = this;
        var meta = this.config.symbols[dashboardSymbol];
        var tf = this.config.timeframes.map[timeframeKey];

        if (!meta) return Promise.reject(new DataError('UNKNOWN_SYMBOL', 'No provider mapping for ' + dashboardSymbol));
        if (!tf)   return Promise.reject(new DataError('UNKNOWN_TIMEFRAME', 'No mapping for timeframe ' + timeframeKey));

        var key = this.apiKey('twelveData');
        if (!key) {
            return Promise.reject(new DataError('NO_API_KEY',
                'A TwelveData API key is required. Add it via the Analyze panel’s key settings.'));
        }

        var p = this.config.providers.twelveData;
        var url = p.baseUrl + '/time_series' +
                  '?symbol=' + encodeURIComponent(meta.td) +
                  '&interval=' + encodeURIComponent(tf.api) +
                  '&outputsize=' + encodeURIComponent(this.config.data.preferredBars) +
                  '&order=DESC&timezone=UTC&format=JSON' +
                  '&apikey=' + encodeURIComponent(key);

        var cacheKey = 'ts:' + meta.td + ':' + tf.api;

        return this.request('twelveData', url, cacheKey, this.ttlFor(tf.ms)).then(function (json) {
            var bars = self.normalizeTwelveData(json);
            bars = self.dropFormingBar(bars, tf.ms);
            var warnings = self.validateBars(bars, tf.ms);
            return {
                symbol: dashboardSymbol,
                providerSymbol: meta.td,
                interval: timeframeKey,
                intervalLabel: tf.label,
                intervalMs: tf.ms,
                bars: bars,
                warnings: warnings,
                source: 'twelvedata',
                fetchedAt: self.clock()
            };
        });
    };

    /**
     * Retrieves the ladder of timeframes for multi-timeframe confirmation.
     * Requests are de-duplicated so the same interval is never fetched twice.
     */
    MarketData.prototype.getMultiTimeframe = function (dashboardSymbol, timeframeKey) {
        var self = this;
        var ladder = this.config.timeframes.ladders[timeframeKey] ||
                     { ltf: timeframeKey, mtf: timeframeKey, htf: timeframeKey };
        var unique = [];
        ['ltf', 'mtf', 'htf'].forEach(function (slot) {
            if (unique.indexOf(ladder[slot]) === -1) unique.push(ladder[slot]);
        });

        return Promise.all(unique.map(function (tfKey) {
            return self.getSeries(dashboardSymbol, tfKey).then(
                function (s) { return { key: tfKey, series: s, error: null }; },
                function (e) { return { key: tfKey, series: null, error: e }; }
            );
        })).then(function (results) {
            var byKey = {};
            results.forEach(function (r) { byKey[r.key] = r; });

            var primary = byKey[ladder.ltf];
            if (!primary || !primary.series) {
                throw (primary && primary.error) ||
                      new DataError('NO_DATA', 'Primary timeframe unavailable');
            }
            return {
                ladder: ladder,
                ltf: byKey[ladder.ltf] ? byKey[ladder.ltf].series : null,
                mtf: byKey[ladder.mtf] ? byKey[ladder.mtf].series : null,
                htf: byKey[ladder.htf] ? byKey[ladder.htf].series : null,
                errors: results.filter(function (r) { return r.error; })
                               .map(function (r) { return { timeframe: r.key, code: r.error.code, message: r.error.message }; })
            };
        });
    };

    /**
     * ExchangeRate-API supplementary spot quote. Used only as a cross-check or
     * fallback for forex pairs; never as a substitute for OHLCV.
     */
    MarketData.prototype.getSpotRate = function (dashboardSymbol) {
        var self = this;
        var meta = this.config.symbols[dashboardSymbol];
        if (!meta) return Promise.reject(new DataError('UNKNOWN_SYMBOL', 'Unknown symbol ' + dashboardSymbol));

        var key = this.apiKey('exchangeRate');
        if (!key) return Promise.resolve(null);
        if (meta.class !== 'forex') return Promise.resolve(null);

        var p = this.config.providers.exchangeRate;
        var url = p.baseUrl + '/' + encodeURIComponent(key) + '/pair/' +
                  encodeURIComponent(meta.base) + '/' + encodeURIComponent(meta.quote);

        return this.request('exchangeRate', url, 'fx:' + meta.base + meta.quote, 60000)
            .then(function (json) {
                if (!json || json.result !== 'success' || !U.isFiniteNumber(U.toNumber(json.conversion_rate))) {
                    return null;
                }
                return { rate: U.toNumber(json.conversion_rate),
                         asOf: json.time_last_update_unix ? json.time_last_update_unix * 1000 : self.clock(),
                         source: 'exchangerate-api' };
            })
            .catch(function () { return null; });   // supplementary only: never fail the analysis
    };

    /** Retrieves recent news articles for the symbol. Returns [] when unavailable. */
    MarketData.prototype.getNews = function (dashboardSymbol) {
        var self = this;
        var meta = this.config.symbols[dashboardSymbol];
        if (!meta || !this.config.sentiment.enabled) return Promise.resolve([]);

        var key = this.apiKey('newsApi');
        if (!key) return Promise.resolve([]);

        var p = this.config.providers.newsApi;
        var fromMs = this.clock() - p.lookbackHours * 3600000;
        var from = new Date(fromMs).toISOString().slice(0, 19);
        var url = p.baseUrl + '/everything' +
                  '?q=' + encodeURIComponent(meta.newsQuery) +
                  '&from=' + encodeURIComponent(from) +
                  '&language=en&sortBy=publishedAt&pageSize=' + p.maxArticles +
                  '&apiKey=' + encodeURIComponent(key);

        return this.request('newsApi', url, 'news:' + meta.newsQuery, this.config.cache.newsTtlMs)
            .then(function (json) {
                if (!json || json.status !== 'ok' || !Array.isArray(json.articles)) return [];
                return json.articles.map(function (a) {
                    return {
                        title: String(a.title || ''),
                        description: String(a.description || ''),
                        source: a.source && a.source.name ? String(a.source.name) : 'unknown',
                        url: String(a.url || ''),
                        publishedAt: Date.parse(a.publishedAt) || self.clock()
                    };
                }).filter(function (a) { return a.title; });
            })
            .catch(function () { return []; });      // sentiment is optional by design
    };

    QT.DataError = DataError;
    QT.RateLimiter = RateLimiter;
    QT.Cache = Cache;
    QT.MarketData = MarketData;

})(typeof globalThis !== 'undefined' ? globalThis : this);

if (typeof module !== 'undefined' && module.exports) {
    var g = (typeof globalThis !== 'undefined' ? globalThis : this);
    module.exports = { MarketData: g.QT.MarketData, DataError: g.QT.DataError,
                       RateLimiter: g.QT.RateLimiter, Cache: g.QT.Cache };
}
