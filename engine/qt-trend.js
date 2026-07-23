/**
 * qt-trend.js — Phase 4: Trend & Market Structure Engine.
 *
 * This is the interpretation layer. It DETECTS NOTHING: it consumes the Phase 2
 * indicator series and the Phase 3 pattern report and answers the higher-order
 * questions — what regime are we in, what is the dominant trend, how healthy is
 * it, and is continuation or reversal more likely under the configured strategy.
 *
 * ── DETERMINISM AND THE STATE MACHINE ────────────────────────────────────────
 * A state machine implies memory, but the analyzer runs on demand and must be
 * reproducible: identical (bars, config) must always produce an identical
 * result. Persisting state between invocations would break that.
 *
 * The engine therefore REPLAYS the state machine over the bar history on every
 * run, starting from a fixed initial state. State is a pure function of the bar
 * series, so determinism is preserved AND hysteresis is genuine — the final
 * state depends on the path taken through history, not merely on the last bar.
 * This is the central design decision of Phase 4.
 *
 * ── STABILITY MECHANISM ──────────────────────────────────────────────────────
 * Direction changes use a Schmitt trigger: entering a trend state requires
 * |signal| >= enterThreshold sustained for `confirmBars` consecutive bars, while
 * leaving it only happens below the lower exitThreshold. The gap between the two
 * thresholds is the hysteresis band; it is what prevents oscillation, and both
 * ends are configurable.
 */
(function (root) {
    'use strict';

    var QT = root.QT = root.QT || {};
    var U = QT.utils;
    var D = QT.detection;

    var DIRECTION = { BULLISH: 'bullish', BEARISH: 'bearish', NEUTRAL: 'neutral' };

    var STATE = {
        BULL_TREND: 'BULL_TREND',
        BEAR_TREND: 'BEAR_TREND',
        RANGE: 'RANGE',
        BULL_TRANSITION: 'BULL_TRANSITION',
        BEAR_TRANSITION: 'BEAR_TRANSITION',
        UNDEFINED: 'UNDEFINED'
    };

    /**
     * Allowed transitions. A trend can never flip straight to its opposite: it
     * must pass through RANGE or the opposing TRANSITION state first, which is
     * what stops a single violent bar from inverting the read.
     */
    var TRANSITIONS = {
        UNDEFINED:       ['BULL_TREND', 'BEAR_TREND', 'RANGE', 'BULL_TRANSITION', 'BEAR_TRANSITION'],
        RANGE:           ['BULL_TRANSITION', 'BEAR_TRANSITION', 'RANGE'],
        BULL_TRANSITION: ['BULL_TREND', 'RANGE', 'BEAR_TRANSITION', 'BULL_TRANSITION'],
        BEAR_TRANSITION: ['BEAR_TREND', 'RANGE', 'BULL_TRANSITION', 'BEAR_TRANSITION'],
        BULL_TREND:      ['BULL_TREND', 'BULL_TRANSITION', 'BEAR_TRANSITION', 'RANGE'],
        BEAR_TREND:      ['BEAR_TREND', 'BEAR_TRANSITION', 'BULL_TRANSITION', 'RANGE']
    };

    function canTransition(from, to) {
        return (TRANSITIONS[from] || []).indexOf(to) !== -1;
    }

    /* ================================================================
     * Dimension helpers
     * ================================================================ */

    /** Every dimension returns this shape so synthesis can treat them uniformly. */
    function dimension(name, direction, strength, confidence, evidence, metrics) {
        return {
            name: name,
            direction: direction,
            strength: D.clamp01(strength),
            confidence: D.clamp01(confidence),
            /** Signed contribution in [-1, 1]: direction × strength. */
            get signal() {
                return this.direction === DIRECTION.BULLISH ? this.strength
                     : this.direction === DIRECTION.BEARISH ? -this.strength : 0;
            },
            evidence: evidence || [],
            metrics: metrics || {}
        };
    }

    function dirOf(value, deadband) {
        var db = deadband === undefined ? 0 : deadband;
        if (value > db) return DIRECTION.BULLISH;
        if (value < -db) return DIRECTION.BEARISH;
        return DIRECTION.NEUTRAL;
    }

    /** Slope of the last `n` finite values, normalised by ATR so it is scale-free. */
    function normalisedSlope(series, n, atr) {
        var vals = [];
        for (var i = series.length - 1; i >= 0 && vals.length < n; i--) {
            if (U.isFiniteNumber(series[i])) vals.unshift(series[i]);
        }
        if (vals.length < 2) return NaN;
        var pts = vals.map(function (v, i) { return { x: i, y: v }; });
        var sx = 0, sy = 0, sxx = 0, sxy = 0, k;
        for (k = 0; k < pts.length; k++) { sx += pts[k].x; sy += pts[k].y; sxx += pts[k].x * pts[k].x; sxy += pts[k].x * pts[k].y; }
        var denom = pts.length * sxx - sx * sx;
        if (Math.abs(denom) < U.EPS) return NaN;
        var slope = (pts.length * sxy - sx * sy) / denom;
        return (U.isFiniteNumber(atr) && atr > U.EPS) ? slope / atr : slope;
    }

    /* ================================================================
     * The eight trend dimensions
     * ================================================================ */

    function computeDimensions(ind, patternReport, cfg, capabilities) {
        var t = cfg.trend;
        var atr = U.lastFinite(ind.atr);
        var price = U.lastFinite(ind.close);
        var dims = {};

        /* ---- 1. Short-term: price vs EMA20 and the slope of EMA20 ---- */
        (function () {
            var ema = U.lastFinite(ind.emaFast);
            var slope = normalisedSlope(ind.emaFast, t.slopeWindow, atr);
            var dist = (U.isFiniteNumber(ema) && atr > U.EPS) ? (price - ema) / atr : NaN;
            var sig = 0, ev = [];
            if (U.isFiniteNumber(dist)) {
                sig += U.clamp(dist / t.emaDistanceAtr, -1, 1) * 0.6;
                ev.push('price is ' + dist.toFixed(2) + ' ATR ' + (dist >= 0 ? 'above' : 'below') + ' EMA20');
            }
            if (U.isFiniteNumber(slope)) {
                sig += U.clamp(slope / t.slopeAtrPerBar, -1, 1) * 0.4;
                ev.push('EMA20 slope ' + slope.toFixed(4) + ' ATR/bar');
            }
            dims.shortTerm = dimension('shortTerm', dirOf(sig, t.deadband), Math.abs(sig),
                                       U.isFiniteNumber(dist) && U.isFiniteNumber(slope) ? 0.9 : 0.5,
                                       ev, { distanceAtr: dist, slope: slope });
        })();

        /* ---- 2. Medium-term: EMA20 vs EMA50 separation ---- */
        (function () {
            var f = U.lastFinite(ind.emaFast), m = U.lastFinite(ind.emaMid);
            var sep = (U.isFiniteNumber(f) && U.isFiniteNumber(m) && atr > U.EPS) ? (f - m) / atr : NaN;
            var slope = normalisedSlope(ind.emaMid, t.slopeWindow, atr);
            var sig = U.isFiniteNumber(sep) ? U.clamp(sep / t.emaSeparationAtr, -1, 1) : 0;
            var ev = [];
            if (U.isFiniteNumber(sep)) ev.push('EMA20 is ' + sep.toFixed(2) + ' ATR ' + (sep >= 0 ? 'above' : 'below') + ' EMA50');
            if (U.isFiniteNumber(slope)) ev.push('EMA50 slope ' + slope.toFixed(4) + ' ATR/bar');
            dims.mediumTerm = dimension('mediumTerm', dirOf(sig, t.deadband), Math.abs(sig),
                                        U.isFiniteNumber(sep) ? 0.9 : 0.3, ev,
                                        { separationAtr: sep, slope: slope });
        })();

        /* ---- 3. Long-term: price vs EMA200 and the 50/200 relationship ---- */
        (function () {
            var slow = U.lastFinite(ind.emaSlow), mid = U.lastFinite(ind.emaMid);
            var ev = [], sig = 0, conf = 0.3;
            if (U.isFiniteNumber(slow) && atr > U.EPS) {
                var dist = (price - slow) / atr;
                sig += U.clamp(dist / (t.emaDistanceAtr * 3), -1, 1) * 0.5;
                ev.push('price is ' + dist.toFixed(2) + ' ATR ' + (dist >= 0 ? 'above' : 'below') + ' EMA200');
                conf = 0.9;
            }
            if (U.isFiniteNumber(slow) && U.isFiniteNumber(mid)) {
                var cross = mid > slow;
                sig += (cross ? 1 : -1) * 0.5;
                ev.push('EMA50 is ' + (cross ? 'above' : 'below') + ' EMA200 (' +
                        (cross ? 'golden-cross' : 'death-cross') + ' configuration)');
            }
            dims.longTerm = dimension('longTerm', dirOf(sig, t.deadband), Math.abs(sig), conf, ev,
                                      { ema200: slow, ema50: mid });
        })();

        /* ---- 4. Structural: consumes the Phase 3 structure report ---- */
        (function () {
            var st = patternReport && patternReport.structure ? patternReport.structure : null;
            if (!st) {
                dims.structural = dimension('structural', DIRECTION.NEUTRAL, 0, 0,
                                            ['no structure report available'], {});
                return;
            }
            var sig = st.bias === DIRECTION.BULLISH ? 1 : st.bias === DIRECTION.BEARISH ? -1 : 0;
            var labels = (st.labelledSwings || []).filter(function (s) { return s.label; });
            var agree = labels.filter(function (s) {
                return sig > 0 ? (s.label === 'HH' || s.label === 'HL')
                     : sig < 0 ? (s.label === 'LH' || s.label === 'LL') : false;
            }).length;
            var consistency = labels.length ? agree / labels.length : 0;

            // A recent CHoCH degrades structural conviction — character has changed.
            var choch = (patternReport.active || []).filter(function (d) {
                return /choch/.test(d.id) && d.barsAgo <= t.chochRecencyBars;
            });
            var ev = ['swing bias ' + st.bias,
                      'sequence ' + labels.map(function (s) { return s.label; }).join(' → ')];
            if (choch.length) ev.push('recent CHoCH ' + choch[0].barsAgo + ' bars ago');

            dims.structural = dimension('structural', st.bias, Math.abs(sig) * consistency,
                                        labels.length >= 3 ? 0.9 : 0.5, ev,
                                        { consistency: consistency, swingCount: labels.length,
                                          recentChoch: choch.length > 0 });
        })();

        /* ---- 5. Momentum: MACD histogram + RSI displacement from 50 ---- */
        (function () {
            var hist = U.lastFinite(ind.macd.histogram);
            var rsi = U.lastFinite(ind.rsi);
            var ev = [], sig = 0, parts = 0;
            if (U.isFiniteNumber(hist) && atr > U.EPS) {
                sig += U.clamp(hist / (atr * t.macdHistAtr), -1, 1) * 0.5; parts++;
                ev.push('MACD histogram ' + hist.toFixed(4) + ' (' + (hist >= 0 ? 'positive' : 'negative') + ')');
            }
            if (U.isFiniteNumber(rsi)) {
                sig += U.clamp((rsi - 50) / 25, -1, 1) * 0.5; parts++;
                ev.push('RSI ' + rsi.toFixed(1) + (rsi >= 50 ? ' above' : ' below') + ' the 50 midline');
            }
            dims.momentum = dimension('momentum', dirOf(sig, t.deadband), Math.abs(sig),
                                      parts === 2 ? 0.9 : parts === 1 ? 0.5 : 0, ev,
                                      { macdHistogram: hist, rsi: rsi });
        })();

        /* ---- 6. Volatility regime (non-directional) ---- */
        (function () {
            var bw = U.lastFinite(ind.bollinger.bandwidth);
            var hist = ind.atr.filter(U.isFiniteNumber).slice(-cfg.regime.atrPercentileLookback);
            var pct = hist.length > 10 ? U.percentileRank(hist, atr) : NaN;
            var ev = [];
            if (U.isFiniteNumber(pct)) ev.push('ATR sits at the ' + (pct * 100).toFixed(0) + 'th percentile of its recent range');
            if (U.isFiniteNumber(bw)) ev.push('Bollinger bandwidth ' + bw.toFixed(2) + '%');
            dims.volatility = dimension('volatility', DIRECTION.NEUTRAL, U.isFiniteNumber(pct) ? pct : 0.5,
                                        U.isFiniteNumber(pct) ? 0.9 : 0.3, ev,
                                        { atr: atr, atrPercentile: pct, bandwidth: bw,
                                          compressed: U.isFiniteNumber(bw) && bw < cfg.regime.squeezeBandwidthPct });
        })();

        /* ---- 7. Maturity: how far the move has already travelled ---- */
        (function () {
            var slow = U.lastFinite(ind.emaSlow);
            var extension = (U.isFiniteNumber(slow) && atr > U.EPS) ? Math.abs(price - slow) / atr : NaN;
            var lastBreak = null;
            (patternReport && patternReport.active || []).forEach(function (d) {
                if (/bos|choch/.test(d.id) && (lastBreak === null || d.barsAgo < lastBreak)) lastBreak = d.barsAgo;
            });
            /* No observed structural break is ABSENCE OF EVIDENCE, not evidence of
             * an ancient trend. Scoring it as fully mature made every long series
             * read as exhausted, so an unknown age contributes a neutral 0.5. */
            var ageKnown = lastBreak !== null;
            var barsSince = ageKnown ? lastBreak : null;
            var ageScore = ageKnown ? D.clamp01(lastBreak / t.maturityBarsCap) : 0.5;
            var extScore = U.isFiniteNumber(extension) ? D.clamp01(extension / t.matureExtensionAtr) : 0;
            var maturity = D.clamp01(0.5 * ageScore + 0.5 * extScore);

            dims.maturity = dimension('maturity', DIRECTION.NEUTRAL, maturity,
                                      U.isFiniteNumber(extension) ? 0.8 : 0.4,
                                      ['price extended ' + (U.isFiniteNumber(extension) ? extension.toFixed(2) : 'n/a') +
                                       ' ATR from EMA200',
                                       (ageKnown ? barsSince + ' bars since the last structural break'
                                                 : 'no structural break observed — trend age unknown, scored neutral')],
                                      { extensionAtr: extension, barsSinceBreak: barsSince, ageKnown: ageKnown, maturity: maturity });
        })();

        /* ---- 8. Acceleration: is the move gaining or losing drive? ---- */
        (function () {
            var histSlope = normalisedSlope(ind.macd.histogram, t.slopeWindow, atr);
            var adxSlope = normalisedSlope(ind.adx.adx, t.slopeWindow, 1);
            var ev = [], sig = 0, parts = 0;
            if (U.isFiniteNumber(histSlope)) {
                sig += U.clamp(histSlope / t.slopeAtrPerBar, -1, 1) * 0.6; parts++;
                ev.push('MACD histogram slope ' + histSlope.toFixed(5) + ' ATR/bar');
            }
            if (U.isFiniteNumber(adxSlope)) {
                sig += U.clamp(adxSlope / t.adxSlopePerBar, -1, 1) * 0.4; parts++;
                ev.push('ADX slope ' + adxSlope.toFixed(3) + '/bar (' +
                        (adxSlope >= 0 ? 'strengthening' : 'weakening') + ')');
            }
            dims.acceleration = dimension('acceleration', dirOf(sig, t.deadband), Math.abs(sig),
                                          parts ? 0.8 : 0, ev,
                                          { macdHistSlope: histSlope, adxSlope: adxSlope,
                                            accelerating: sig > t.deadband,
                                            decelerating: sig < -t.deadband,
                                            phase: sig > t.deadband ? 'accelerating'
                                                 : sig < -t.deadband ? 'decelerating' : 'steady' });
        })();

        return dims;
    }

    /* ================================================================
     * Market regime classification
     *
     * Every candidate regime is scored from measurable evidence; the highest
     * score wins and the rest are retained WITH their scores so the engine can
     * explain why each alternative was rejected.
     * ================================================================ */
    function classifyRegime(ind, dims, patternReport, cfg) {
        var r = cfg.regime;
        var adx = U.lastFinite(ind.adx.adx);
        var bw = U.lastFinite(ind.bollinger.bandwidth);
        var atrPct = dims.volatility.metrics.atrPercentile;
        var trendMag = Math.abs((dims.shortTerm.signal + dims.mediumTerm.signal + dims.longTerm.signal) / 3);
        var structural = dims.structural;

        var bwHist = ind.bollinger.bandwidth.filter(U.isFiniteNumber).slice(-r.atrPercentileLookback);
        var bwPct = bwHist.length > 10 ? U.percentileRank(bwHist, bw) : NaN;

        var candidates = [];
        function candidate(id, name, score, evidence) {
            candidates.push({ id: id, name: name, score: D.clamp01(score), evidence: evidence });
        }

        var adxTrend = U.isFiniteNumber(adx) ? U.clamp((adx - r.rangingAdx) / (r.trendingAdx - r.rangingAdx), 0, 2) : 0;

        candidate('STRONG_TRENDING', 'Strong Trending',
            (U.isFiniteNumber(adx) && adx >= r.trendingAdx ? 0.55 : 0) + 0.45 * trendMag,
            ['ADX ' + (U.isFiniteNumber(adx) ? adx.toFixed(1) : 'n/a') + ' vs trending threshold ' + r.trendingAdx,
             'aggregate MA trend magnitude ' + trendMag.toFixed(2)]);

        candidate('WEAK_TRENDING', 'Weak Trending',
            (U.isFiniteNumber(adx) && adx >= r.rangingAdx && adx < r.trendingAdx ? 0.6 : 0) + 0.25 * trendMag,
            ['ADX ' + (U.isFiniteNumber(adx) ? adx.toFixed(1) : 'n/a') + ' between ' + r.rangingAdx + ' and ' + r.trendingAdx]);

        candidate('RANGING', 'Ranging',
            (U.isFiniteNumber(adx) && adx < r.rangingAdx ? 0.6 : 0) + 0.4 * (1 - trendMag),
            ['ADX below ' + r.rangingAdx + ' indicates no directional conviction',
             'MA trend magnitude only ' + trendMag.toFixed(2)]);

        candidate('COMPRESSION', 'Compression',
            (U.isFiniteNumber(bw) && bw < r.squeezeBandwidthPct ? 0.6 : 0) +
            (U.isFiniteNumber(bwPct) ? 0.4 * (1 - bwPct) : 0),
            ['Bollinger bandwidth ' + (U.isFiniteNumber(bw) ? bw.toFixed(2) + '%' : 'n/a') +
             ' vs squeeze threshold ' + r.squeezeBandwidthPct + '%',
             'bandwidth percentile ' + (U.isFiniteNumber(bwPct) ? (bwPct * 100).toFixed(0) : 'n/a')]);

        candidate('EXPANSION', 'Expansion',
            (U.isFiniteNumber(bwPct) ? 0.5 * bwPct : 0) + (U.isFiniteNumber(atrPct) ? 0.5 * atrPct : 0),
            ['bandwidth percentile ' + (U.isFiniteNumber(bwPct) ? (bwPct * 100).toFixed(0) : 'n/a'),
             'ATR percentile ' + (U.isFiniteNumber(atrPct) ? (atrPct * 100).toFixed(0) : 'n/a')]);

        candidate('HIGH_VOLATILITY', 'High Volatility',
            U.isFiniteNumber(atrPct) ? (atrPct >= r.choppyAtrPercentile ? 0.5 + 0.5 * atrPct : 0.4 * atrPct) : 0,
            ['ATR percentile ' + (U.isFiniteNumber(atrPct) ? (atrPct * 100).toFixed(0) : 'n/a') +
             ' vs high-volatility threshold ' + (r.choppyAtrPercentile * 100).toFixed(0)]);

        candidate('LOW_VOLATILITY', 'Low Volatility',
            U.isFiniteNumber(atrPct) ? (1 - atrPct) * 0.8 : 0,
            ['ATR percentile ' + (U.isFiniteNumber(atrPct) ? (atrPct * 100).toFixed(0) : 'n/a')]);

        // Transition: a recent CHoCH is the defining evidence.
        var recentChoch = (patternReport && patternReport.active || []).filter(function (d) {
            return /choch/.test(d.id) && d.barsAgo <= cfg.trend.chochRecencyBars;
        });
        candidate('TRANSITION', 'Transition',
            recentChoch.length ? 0.55 + 0.35 * (1 - recentChoch[0].barsAgo / cfg.trend.chochRecencyBars) : 0,
            recentChoch.length ? ['CHoCH detected ' + recentChoch[0].barsAgo + ' bars ago']
                               : ['no recent change of character']);

        /* Accumulation / Distribution.
         * Without volume these are inferred from range position plus swing
         * behaviour only, and confidence is reduced accordingly — they are never
         * asserted on price alone as if volume had confirmed them. */
        var pd = (patternReport && patternReport.active || []).filter(function (d) {
            return d.id === 'premium_discount';
        })[0];
        var rangePos = pd ? pd.metrics.position : NaN;
        var isRangebound = U.isFiniteNumber(adx) && adx < r.rangingAdx;

        candidate('ACCUMULATION', 'Accumulation',
            (isRangebound && U.isFiniteNumber(rangePos) && rangePos < 0.4 ? 0.45 : 0) +
            (structural.direction === DIRECTION.BULLISH ? 0.25 : 0),
            ['range-bound with price in the lower part of the dealing range' +
             (U.isFiniteNumber(rangePos) ? ' (' + (rangePos * 100).toFixed(0) + '%)' : ''),
             'volume confirmation unavailable — inferred from price structure only']);

        candidate('DISTRIBUTION', 'Distribution',
            (isRangebound && U.isFiniteNumber(rangePos) && rangePos > 0.6 ? 0.45 : 0) +
            (structural.direction === DIRECTION.BEARISH ? 0.25 : 0),
            ['range-bound with price in the upper part of the dealing range' +
             (U.isFiniteNumber(rangePos) ? ' (' + (rangePos * 100).toFixed(0) + '%)' : ''),
             'volume confirmation unavailable — inferred from price structure only']);

        candidates.sort(function (a, b) { return b.score - a.score; });
        var winner = candidates[0];
        var runnerUp = candidates[1];

        return {
            primary: winner.id,
            primaryName: winner.name,
            confidence: D.clamp01(winner.score * (runnerUp ? (1 - runnerUp.score * 0.5) : 1)),
            score: winner.score,
            evidence: winner.evidence,
            /** Every alternative with the measured reason it lost. */
            rejected: candidates.slice(1).map(function (c) {
                return { id: c.id, name: c.name, score: c.score,
                         reason: 'scored ' + c.score.toFixed(2) + ' vs ' + winner.score.toFixed(2) +
                                 ' for ' + winner.name + ' — ' + (c.evidence[0] || 'insufficient evidence') };
            }),
            all: candidates,
            metrics: { adx: adx, adxTrendNorm: adxTrend, bandwidth: bw, bandwidthPercentile: bwPct,
                       atrPercentile: atrPct, trendMagnitude: trendMag }
        };
    }

    /* ================================================================
     * State machine replay with Schmitt-trigger hysteresis
     * ================================================================ */

    /**
     * Computes the per-bar directional signal used to drive the state machine.
     * Deliberately cheap and indicator-only: it must be evaluable at EVERY bar.
     */
    function barSignals(ind, cfg) {
        var n = ind.close.length;
        var out = new Array(n);
        var t = cfg.trend;
        for (var i = 0; i < n; i++) {
            var atr = ind.atr[i];
            if (!U.isFiniteNumber(atr) || atr <= U.EPS) { out[i] = NaN; continue; }
            var s = 0, parts = 0;
            if (U.isFiniteNumber(ind.emaFast[i])) {
                s += U.clamp((ind.close[i] - ind.emaFast[i]) / (atr * t.emaDistanceAtr), -1, 1); parts++;
            }
            if (U.isFiniteNumber(ind.emaMid[i]) && U.isFiniteNumber(ind.emaSlow[i])) {
                s += U.clamp((ind.emaMid[i] - ind.emaSlow[i]) / (atr * t.emaSeparationAtr), -1, 1); parts++;
            }
            if (U.isFiniteNumber(ind.macd.histogram[i])) {
                s += U.clamp(ind.macd.histogram[i] / (atr * t.macdHistAtr), -1, 1); parts++;
            }
            out[i] = parts ? s / parts : NaN;
        }
        return out;
    }

    /**
     * Replays the machine from UNDEFINED across the whole series.
     * Pure function of (indicators, config) — no persisted state, so identical
     * inputs always yield an identical final state and transition history.
     */
    function replayStateMachine(ind, cfg) {
        var t = cfg.trend;
        var sig = barSignals(ind, cfg);
        var adx = ind.adx.adx;

        var state = STATE.UNDEFINED;
        var barsInState = 0;
        var streakUp = 0, streakDown = 0, streakFlat = 0;
        var history = [];

        for (var i = 0; i < sig.length; i++) {
            if (!U.isFiniteNumber(sig[i])) continue;
            var v = sig[i];
            var a = U.isFiniteNumber(adx[i]) ? adx[i] : 0;

            // Streaks implement the "sustained for confirmBars" requirement.
            if (v >= t.enterThreshold) { streakUp++; streakDown = 0; }
            else if (v <= -t.enterThreshold) { streakDown++; streakUp = 0; }
            else { streakUp = 0; streakDown = 0; }

            if (Math.abs(v) <= t.exitThreshold && a < cfg.regime.rangingAdx) streakFlat++;
            else streakFlat = 0;

            var next = state;

            if (streakUp >= t.confirmBars) {
                next = (state === STATE.BULL_TREND || state === STATE.BULL_TRANSITION)
                     ? STATE.BULL_TREND
                     : (canTransition(state, STATE.BULL_TRANSITION) ? STATE.BULL_TRANSITION : state);
                // Promotion to a full trend also requires directional strength.
                if (next === STATE.BULL_TRANSITION && a >= cfg.regime.trendingAdx &&
                    barsInState >= t.promoteBars && canTransition(state, STATE.BULL_TREND)) {
                    next = STATE.BULL_TREND;
                }
            } else if (streakDown >= t.confirmBars) {
                next = (state === STATE.BEAR_TREND || state === STATE.BEAR_TRANSITION)
                     ? STATE.BEAR_TREND
                     : (canTransition(state, STATE.BEAR_TRANSITION) ? STATE.BEAR_TRANSITION : state);
                if (next === STATE.BEAR_TRANSITION && a >= cfg.regime.trendingAdx &&
                    barsInState >= t.promoteBars && canTransition(state, STATE.BEAR_TREND)) {
                    next = STATE.BEAR_TREND;
                }
            } else if (streakFlat >= t.rangeBars && canTransition(state, STATE.RANGE)) {
                next = STATE.RANGE;
            }

            if (next !== state) {
                history.push({ atBar: i, from: state, to: next, signal: v, adx: a });
                state = next;
                barsInState = 0;
            } else {
                barsInState++;
            }
        }

        return {
            state: state,
            barsInState: barsInState,
            transitions: history,
            lastTransition: history.length ? history[history.length - 1] : null,
            recentTransitions: history.slice(-5),
            signalSeries: sig
        };
    }

    /* ================================================================
     * Outcome probabilities
     *
     * Four mutually exclusive outcomes scored from evidence, then normalised
     * with a softmax so they always sum to exactly 1 and later phases can
     * consume them numerically without reinterpretation.
     * ================================================================ */
    function outcomeProbabilities(dims, regime, machine, patternReport, cfg) {
        var t = cfg.trend;
        var trendMag = Math.abs(dims.shortTerm.signal * 0.3 + dims.mediumTerm.signal * 0.35 +
                                dims.longTerm.signal * 0.35);
        var aligned = dims.structural.direction !== DIRECTION.NEUTRAL &&
                      dims.structural.direction === dirOf(dims.mediumTerm.signal, t.deadband);
        var maturity = dims.maturity.strength;
        var phase = dims.acceleration.metrics.phase || 'steady';
        var accelerating = phase === 'accelerating';
        var decelerating = phase === 'decelerating';
        var trending = regime.primary === 'STRONG_TRENDING' || regime.primary === 'WEAK_TRENDING';
        var compressed = regime.primary === 'COMPRESSION' || regime.primary === 'RANGING';

        var reversalPatterns = (patternReport && patternReport.active || []).filter(function (d) {
            return /choch|double_top|double_bottom|head_and_shoulders|liquidity_sweep|evening_star|morning_star/.test(d.id) &&
                   d.barsAgo <= t.chochRecencyBars;
        });

        var scores = {
            continuation: 0.2 + 1.4 * trendMag * (trending ? 1 : 0.5) +
                          (aligned ? 0.5 : 0) + (accelerating ? 0.35 : decelerating ? -0.25 : 0) - 0.5 * maturity,
            reversal:     0.15 + 0.9 * reversalPatterns.length * 0.4 +
                          0.6 * maturity + (accelerating ? -0.3 : decelerating ? 0.3 : 0) +
                          (regime.primary === 'TRANSITION' ? 0.5 : 0),
            exhaustion:   0.1 + 1.2 * maturity * (trending ? 1 : 0.4) +
                          (accelerating ? -0.4 : decelerating ? 0.4 : 0) +
                          (dims.volatility.metrics.atrPercentile > 0.8 ? 0.3 : 0),
            consolidation: 0.15 + (compressed ? 1.1 : 0) + 0.6 * (1 - trendMag) +
                          (dims.volatility.metrics.compressed ? 0.5 : 0)
        };

        // Softmax with a configurable temperature: strictly positive, sums to 1.
        var keys = Object.keys(scores);
        var temp = t.probabilityTemperature;
        var exps = keys.map(function (k) { return Math.exp(scores[k] / temp); });
        var sum = exps.reduce(function (a, b) { return a + b; }, 0);
        var probs = {};
        keys.forEach(function (k, i) { probs[k] = exps[i] / sum; });

        return { probabilities: probs, rawScores: scores,
                 inputs: { trendMagnitude: trendMag, aligned: aligned, maturity: maturity,
                           accelerating: accelerating, accelerationPhase: phase, trending: trending,
                           reversalPatternCount: reversalPatterns.length } };
    }

    /* ================================================================
     * Single-timeframe analysis
     * ================================================================ */
    function analyzeTimeframe(indicators, patternReport, options) {
        options = options || {};
        var cfg = options.config || QT.CONFIG;
        var capabilities = options.capabilities || { ohlc: true, volume: false };

        var dims = computeDimensions(indicators, patternReport, cfg, capabilities);
        var regime = classifyRegime(indicators, dims, patternReport, cfg);
        var machine = replayStateMachine(indicators, cfg);
        var outcome = outcomeProbabilities(dims, regime, machine, patternReport, cfg);
        var t = cfg.trend;

        /* ---- Direction, strength and confidence are computed SEPARATELY ---- */
        var weights = t.dimensionWeights;
        var weighted = 0, totalW = 0, confAcc = 0;
        ['shortTerm', 'mediumTerm', 'longTerm', 'structural', 'momentum'].forEach(function (k) {
            var d = dims[k];
            if (!d || d.confidence <= 0) return;
            var w = weights[k] * d.confidence;
            weighted += d.signal * w;
            totalW += w;
            confAcc += d.confidence * weights[k];
        });
        var composite = totalW > U.EPS ? weighted / totalW : 0;

        // Direction from the state machine (stable), magnitude from the dimensions.
        var stateDir = (machine.state === STATE.BULL_TREND || machine.state === STATE.BULL_TRANSITION) ? DIRECTION.BULLISH
                     : (machine.state === STATE.BEAR_TREND || machine.state === STATE.BEAR_TRANSITION) ? DIRECTION.BEARISH
                     : DIRECTION.NEUTRAL;
        var rawDir = dirOf(composite, t.deadband);
        var direction = stateDir !== DIRECTION.NEUTRAL ? stateDir : rawDir;

        /* A non-trending regime must not emit a directional call from a
         * momentary composite reading. Only a CONFIRMED trend state may assert
         * direction inside a range — this is what produces 'neutral direction,
         * high confidence that the market is ranging'. */
        var nonTrendingRegime = ['RANGING', 'COMPRESSION', 'LOW_VOLATILITY'].indexOf(regime.primary) !== -1;
        var confirmedTrend = machine.state === STATE.BULL_TREND || machine.state === STATE.BEAR_TREND;
        var regimeSuppressed = false;
        if (nonTrendingRegime && !confirmedTrend && regime.confidence >= t.rangeSuppressConfidence) {
            direction = DIRECTION.NEUTRAL;
            regimeSuppressed = true;
        }

        var strength = D.clamp01(Math.abs(composite));

        /* Confidence is AGREEMENT, not magnitude: a strong move that the
         * dimensions disagree about is strong but low-confidence. */
        var dirs = ['shortTerm', 'mediumTerm', 'longTerm', 'structural', 'momentum']
            .map(function (k) { return dims[k].signal; })
            .filter(function (v) { return Math.abs(v) > t.deadband; });
        var agreeing = dirs.filter(function (v) {
            return direction === DIRECTION.BULLISH ? v > 0 : direction === DIRECTION.BEARISH ? v < 0 : false;
        }).length;
        var agreement = dirs.length ? agreeing / dirs.length : 0;
        var dataQuality = D.clamp01((confAcc / Object.keys(weights).reduce(function (a, k) {
            return a + weights[k]; }, 0)));

        var confidence = direction === DIRECTION.NEUTRAL
            ? D.clamp01(0.4 + 0.6 * (1 - strength) * regime.confidence)   // confident it is ranging
            : D.clamp01(0.25 + 0.45 * agreement + 0.3 * dataQuality);

        // Stability bonus: a state held for many bars is more trustworthy.
        var stability = D.clamp01(machine.barsInState / t.stabilityBars);
        confidence = D.clamp01(confidence * (1 - t.stabilityWeight) + stability * t.stabilityWeight);

        /* ---- Explainability ---- */
        var supporting = [], opposing = [];
        ['shortTerm', 'mediumTerm', 'longTerm', 'structural', 'momentum'].forEach(function (k) {
            var d = dims[k];
            if (Math.abs(d.signal) <= t.deadband) return;
            var entry = { dimension: k, direction: d.direction, signal: +d.signal.toFixed(4),
                          weight: weights[k], evidence: d.evidence };
            var agrees = direction === DIRECTION.BULLISH ? d.signal > 0 : d.signal < 0;
            if (direction !== DIRECTION.NEUTRAL && agrees) supporting.push(entry); else opposing.push(entry);
        });
        supporting.sort(function (a, b) { return Math.abs(b.signal) * b.weight - Math.abs(a.signal) * a.weight; });
        opposing.sort(function (a, b) { return Math.abs(b.signal) * b.weight - Math.abs(a.signal) * a.weight; });

        return {
            direction: direction,
            strength: strength,
            confidence: confidence,

            state: machine.state,
            barsInState: machine.barsInState,
            stateTransitions: machine.recentTransitions,
            lastTransition: machine.lastTransition,

            regime: {
                primary: regime.primary,
                name: regime.primaryName,
                confidence: regime.confidence,
                evidence: regime.evidence,
                rejected: regime.rejected,
                metrics: regime.metrics
            },

            probabilities: outcome.probabilities,
            probabilityInputs: outcome.inputs,

            dimensions: Object.keys(dims).reduce(function (acc, k) {
                acc[k] = { direction: dims[k].direction, strength: +dims[k].strength.toFixed(4),
                           confidence: +dims[k].confidence.toFixed(4), signal: +dims[k].signal.toFixed(4),
                           evidence: dims[k].evidence, metrics: dims[k].metrics };
                return acc;
            }, {}),

            explanation: {
                summary: buildSummary(direction, strength, confidence, regime, machine),
                supporting: supporting,
                opposing: opposing,
                rejectedRegimes: regime.rejected,
                stability: { barsInState: machine.barsInState, stabilityScore: stability,
                             regimeSuppressed: regimeSuppressed,
                             mechanism: 'Schmitt trigger: enter at |signal| >= ' + t.enterThreshold +
                                        ' sustained ' + t.confirmBars + ' bars, exit below ' + t.exitThreshold }
            },

            quality: {
                dataQuality: dataQuality,
                dimensionAgreement: agreement,
                contributingDimensions: dirs.length,
                capabilities: capabilities
            }
        };
    }

    function buildSummary(direction, strength, confidence, regime, machine) {
        var s = strength > 0.66 ? 'strong' : strength > 0.33 ? 'moderate' : 'weak';
        var c = confidence > 0.66 ? 'high' : confidence > 0.4 ? 'moderate' : 'low';
        if (direction === DIRECTION.NEUTRAL) {
            return 'No directional trend; market classified as ' + regime.primaryName +
                   ' with ' + c + ' confidence (state ' + machine.state + ', held ' +
                   machine.barsInState + ' bars).';
        }
        return s.charAt(0).toUpperCase() + s.slice(1) + ' ' + direction + ' trend in a ' +
               regime.primaryName + ' regime, ' + c + ' confidence. State ' + machine.state +
               ' held for ' + machine.barsInState + ' bars.';
    }

    /* ================================================================
     * Multi-timeframe consensus
     *
     * Documented resolution rules (applied in order):
     *   R1 The higher timeframe defines the PERMITTED direction. Lower
     *      timeframes modulate confidence; they cannot flip the call.
     *   R2 Exception — if HTF is weak (strength < htfWeakThreshold) AND both
     *      lower timeframes oppose it, the consensus becomes NEUTRAL and is
     *      flagged as conflicted rather than following either side.
     *   R3 Full agreement grants a confidence bonus; any disagreement applies a
     *      penalty proportional to the weight of the dissenting timeframes.
     *   R4 A timeframe that failed to load is excluded and its weight is
     *      redistributed across the survivors (capability-aware, no gap-filling).
     * ================================================================ */
    function consensus(perTimeframe, cfg) {
        var w = cfg.scoring.timeframeWeights;
        var slots = ['htf', 'mtf', 'ltf'];
        var present = slots.filter(function (s) { return perTimeframe[s]; });

        if (!present.length) {
            return { direction: DIRECTION.NEUTRAL, strength: 0, confidence: 0, agreement: 0,
                     conflicting: [], dominant: null, quality: 0,
                     rulesApplied: ['no timeframes available'], perTimeframe: {} };
        }

        // R4: redistribute weight across available timeframes.
        var totalW = present.reduce(function (a, s) { return a + w[s]; }, 0);
        var norm = {};
        present.forEach(function (s) { norm[s] = w[s] / totalW; });

        var htf = perTimeframe.htf || perTimeframe.mtf || perTimeframe.ltf;
        var rules = [];
        if (present.length < slots.length) {
            rules.push('R4: ' + (slots.length - present.length) + ' timeframe(s) unavailable; weight redistributed');
        }

        var weightedSignal = 0;
        present.forEach(function (s) {
            var tf = perTimeframe[s];
            var sig = tf.direction === DIRECTION.BULLISH ? tf.strength
                    : tf.direction === DIRECTION.BEARISH ? -tf.strength : 0;
            weightedSignal += sig * norm[s];
        });

        var agreeing = present.filter(function (s) {
            return perTimeframe[s].direction === htf.direction && htf.direction !== DIRECTION.NEUTRAL;
        });
        var conflicting = present.filter(function (s) {
            return perTimeframe[s].direction !== htf.direction &&
                   perTimeframe[s].direction !== DIRECTION.NEUTRAL &&
                   htf.direction !== DIRECTION.NEUTRAL;
        });
        var agreement = present.length ? agreeing.length / present.length : 0;

        // R1: HTF defines the permitted direction.
        var direction = htf.direction;
        rules.push('R1: higher timeframe (' + (perTimeframe.htf ? 'htf' : 'fallback') +
                   ') sets the permitted direction as ' + direction);

        // R2: weak HTF outvoted by both lower timeframes -> neutral & conflicted.
        var lowers = present.filter(function (s) { return s !== 'htf'; });
        var allLowersOppose = lowers.length >= 2 && lowers.every(function (s) {
            return perTimeframe[s].direction !== DIRECTION.NEUTRAL &&
                   perTimeframe[s].direction !== htf.direction;
        });
        var conflicted = false;
        if (allLowersOppose && htf.strength < cfg.trend.htfWeakThreshold) {
            direction = DIRECTION.NEUTRAL;
            conflicted = true;
            rules.push('R2: higher timeframe is weak (' + htf.strength.toFixed(2) + ' < ' +
                       cfg.trend.htfWeakThreshold + ') and both lower timeframes oppose it — consensus neutral');
        }

        // R3: agreement bonus / disagreement penalty.
        var baseConf = present.reduce(function (a, s) {
            return a + perTimeframe[s].confidence * norm[s]; }, 0);
        var adj = agreement >= 1 ? cfg.scoring.mtfAgreementBonus
                                 : -cfg.scoring.mtfConflictPenalty * (1 - agreement);
        rules.push('R3: agreement ' + (agreement * 100).toFixed(0) + '% → confidence ' +
                   (adj >= 0 ? '+' : '') + (adj * 100).toFixed(0) + ' points');

        var dominant = present.reduce(function (best, s) {
            var score = perTimeframe[s].strength * perTimeframe[s].confidence * norm[s];
            return (!best || score > best.score) ? { slot: s, score: score } : best;
        }, null);

        return {
            direction: direction,
            strength: D.clamp01(Math.abs(weightedSignal)),
            confidence: D.clamp01(baseConf + adj),
            agreement: agreement,
            conflicting: conflicting,
            conflicted: conflicted,
            dominant: dominant ? dominant.slot : null,
            quality: D.clamp01(agreement * 0.6 + (present.length / slots.length) * 0.4),
            rulesApplied: rules,
            perTimeframe: present.reduce(function (acc, s) {
                acc[s] = { direction: perTimeframe[s].direction,
                           strength: +perTimeframe[s].strength.toFixed(4),
                           confidence: +perTimeframe[s].confidence.toFixed(4),
                           state: perTimeframe[s].state,
                           regime: perTimeframe[s].regime.primary,
                           weight: +norm[s].toFixed(4) };
                return acc;
            }, {})
        };
    }

    QT.trend = {
        DIRECTION: DIRECTION,
        STATE: STATE,
        TRANSITIONS: TRANSITIONS,
        canTransition: canTransition,
        analyzeTimeframe: analyzeTimeframe,
        consensus: consensus,
        computeDimensions: computeDimensions,
        classifyRegime: classifyRegime,
        replayStateMachine: replayStateMachine,
        outcomeProbabilities: outcomeProbabilities,
        barSignals: barSignals,
        normalisedSlope: normalisedSlope
    };

})(typeof globalThis !== 'undefined' ? globalThis : this);

if (typeof module !== 'undefined' && module.exports) {
    module.exports = (typeof globalThis !== 'undefined' ? globalThis : this).QT.trend;
}
