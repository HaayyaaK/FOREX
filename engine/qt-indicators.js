/**
 * qt-indicators.js — Phase 2: Mathematical Indicator Engine.
 *
 * Every indicator is implemented from its authoritative definition; no third-party
 * indicator library is used at runtime. All series are returned bar-aligned: the
 * output array has the same length as the input bars, NaN-padded at the front for
 * the warm-up period, so index i always refers to bar i.
 *
 * Wilder's smoothing (RMA) is used wherever Wilder defined it (RSI, ATR, ADX);
 * Bollinger Bands use the population standard deviation, per Bollinger.
 */
(function (root) {
    'use strict';

    var QT = root.QT = root.QT || {};
    var U = QT.utils;
    var NaNv = NaN;

    function nanArray(n) {
        var a = new Array(n);
        for (var i = 0; i < n; i++) a[i] = NaNv;
        return a;
    }
    function need(values, period) {
        return Array.isArray(values) && period > 0 && values.length >= period;
    }

    var I = {};

    /* ================================================================
     * Moving averages
     * ================================================================ */

    /** Simple Moving Average. */
    I.sma = function (values, period) {
        var out = nanArray(values.length);
        if (!need(values, period)) return out;
        var sum = 0;
        for (var i = 0; i < values.length; i++) {
            sum += values[i];
            if (i >= period) sum -= values[i - period];
            if (i >= period - 1) out[i] = sum / period;
        }
        return out;
    };

    /** Exponential Moving Average, seeded with the SMA of the first `period` values. */
    I.ema = function (values, period) {
        var out = nanArray(values.length);
        if (!need(values, period)) return out;
        var k = 2 / (period + 1);
        var seed = 0;
        for (var i = 0; i < period; i++) seed += values[i];
        var prev = seed / period;
        out[period - 1] = prev;
        for (var j = period; j < values.length; j++) {
            prev = values[j] * k + prev * (1 - k);
            out[j] = prev;
        }
        return out;
    };

    /**
     * Wilder's smoothing (a.k.a. RMA / SMMA): alpha = 1/period.
     * This is the smoothing Wilder specified for RSI, ATR and ADX.
     */
    I.rma = function (values, period) {
        var out = nanArray(values.length);
        if (!need(values, period)) return out;
        var seed = 0;
        for (var i = 0; i < period; i++) seed += values[i];
        var prev = seed / period;
        out[period - 1] = prev;
        for (var j = period; j < values.length; j++) {
            prev = (prev * (period - 1) + values[j]) / period;
            out[j] = prev;
        }
        return out;
    };

    /** Weighted Moving Average with linearly increasing weights 1..period. */
    I.wma = function (values, period) {
        var out = nanArray(values.length);
        if (!need(values, period)) return out;
        var denom = period * (period + 1) / 2;
        for (var i = period - 1; i < values.length; i++) {
            var acc = 0;
            for (var k = 0; k < period; k++) acc += values[i - period + 1 + k] * (k + 1);
            out[i] = acc / denom;
        }
        return out;
    };

    /** Volume-Weighted Moving Average. Falls back to SMA when volume is absent. */
    I.vwma = function (closes, volumes, period) {
        var out = nanArray(closes.length);
        if (!need(closes, period)) return out;
        for (var i = period - 1; i < closes.length; i++) {
            var pv = 0, v = 0;
            for (var k = i - period + 1; k <= i; k++) { pv += closes[k] * volumes[k]; v += volumes[k]; }
            out[i] = v > U.EPS ? pv / v : NaNv;
        }
        return out;
    };

    /* ================================================================
     * Oscillators
     * ================================================================ */

    /** Relative Strength Index (Wilder). */
    I.rsi = function (closes, period) {
        var n = closes.length;
        var out = nanArray(n);
        if (n < period + 1) return out;

        var gains = nanArray(n), losses = nanArray(n);
        for (var i = 1; i < n; i++) {
            var ch = closes[i] - closes[i - 1];
            gains[i] = ch > 0 ? ch : 0;
            losses[i] = ch < 0 ? -ch : 0;
        }
        var ag = 0, al = 0;
        for (var j = 1; j <= period; j++) { ag += gains[j]; al += losses[j]; }
        ag /= period; al /= period;
        out[period] = al <= U.EPS ? 100 : 100 - (100 / (1 + ag / al));

        for (var t = period + 1; t < n; t++) {
            ag = (ag * (period - 1) + gains[t]) / period;
            al = (al * (period - 1) + losses[t]) / period;
            out[t] = al <= U.EPS ? 100 : 100 - (100 / (1 + ag / al));
        }
        return out;
    };

    /** MACD line, signal line and histogram. */
    I.macd = function (closes, fastP, slowP, signalP) {
        var n = closes.length;
        var fast = I.ema(closes, fastP), slow = I.ema(closes, slowP);
        var macd = nanArray(n);
        for (var i = 0; i < n; i++) {
            if (U.isFiniteNumber(fast[i]) && U.isFiniteNumber(slow[i])) macd[i] = fast[i] - slow[i];
        }
        // The signal EMA is seeded on the first finite MACD value, not on index 0.
        var firstIdx = -1;
        for (var f = 0; f < n; f++) { if (U.isFiniteNumber(macd[f])) { firstIdx = f; break; } }
        var signal = nanArray(n), hist = nanArray(n);
        if (firstIdx >= 0) {
            var dense = macd.slice(firstIdx);
            var sig = I.ema(dense, signalP);
            for (var s = 0; s < sig.length; s++) {
                signal[firstIdx + s] = sig[s];
                if (U.isFiniteNumber(sig[s])) hist[firstIdx + s] = macd[firstIdx + s] - sig[s];
            }
        }
        return { macd: macd, signal: signal, histogram: hist };
    };

    /** Commodity Channel Index using the mean absolute deviation (Lambert). */
    I.cci = function (bars, period) {
        var n = bars.length;
        var out = nanArray(n);
        if (n < period) return out;
        var tp = new Array(n);
        for (var i = 0; i < n; i++) tp[i] = (bars[i].high + bars[i].low + bars[i].close) / 3;
        var smaTp = I.sma(tp, period);
        for (var j = period - 1; j < n; j++) {
            var mean = smaTp[j], md = 0;
            for (var k = j - period + 1; k <= j; k++) md += Math.abs(tp[k] - mean);
            md /= period;
            out[j] = md <= U.EPS ? 0 : (tp[j] - mean) / (0.015 * md);
        }
        return out;
    };

    /** Rate of Change, expressed in percent. */
    I.roc = function (closes, period) {
        var out = nanArray(closes.length);
        for (var i = period; i < closes.length; i++) {
            if (Math.abs(closes[i - period]) > U.EPS) {
                out[i] = ((closes[i] - closes[i - period]) / closes[i - period]) * 100;
            }
        }
        return out;
    };

    /** Momentum: absolute price difference over `period` bars. */
    I.momentum = function (closes, period) {
        var out = nanArray(closes.length);
        for (var i = period; i < closes.length; i++) out[i] = closes[i] - closes[i - period];
        return out;
    };

    /** Stochastic oscillator: smoothed %K (slow) and its %D signal. */
    I.stochastic = function (bars, kPeriod, dPeriod, smooth) {
        var n = bars.length;
        var rawK = nanArray(n);
        for (var i = kPeriod - 1; i < n; i++) {
            var hh = -Infinity, ll = Infinity;
            for (var k = i - kPeriod + 1; k <= i; k++) {
                if (bars[k].high > hh) hh = bars[k].high;
                if (bars[k].low < ll) ll = bars[k].low;
            }
            var range = hh - ll;
            rawK[i] = range <= U.EPS ? 50 : ((bars[i].close - ll) / range) * 100;
        }
        var kSeries = smooth > 1 ? smoothIgnoringNaN(rawK, smooth) : rawK;
        var dSeries = smoothIgnoringNaN(kSeries, dPeriod);
        return { k: kSeries, d: dSeries, rawK: rawK };
    };

    /** SMA that starts at the first finite input and stays bar-aligned. */
    function smoothIgnoringNaN(values, period) {
        var n = values.length, out = nanArray(n);
        var first = -1;
        for (var i = 0; i < n; i++) { if (U.isFiniteNumber(values[i])) { first = i; break; } }
        if (first < 0) return out;
        var dense = values.slice(first);
        var sm = I.sma(dense, period);
        for (var j = 0; j < sm.length; j++) out[first + j] = sm[j];
        return out;
    }
    I._smoothIgnoringNaN = smoothIgnoringNaN;

    /** Williams %R, in [-100, 0]. */
    I.williamsR = function (bars, period) {
        var n = bars.length, out = nanArray(n);
        for (var i = period - 1; i < n; i++) {
            var hh = -Infinity, ll = Infinity;
            for (var k = i - period + 1; k <= i; k++) {
                if (bars[k].high > hh) hh = bars[k].high;
                if (bars[k].low < ll) ll = bars[k].low;
            }
            var range = hh - ll;
            out[i] = range <= U.EPS ? -50 : ((hh - bars[i].close) / range) * -100;
        }
        return out;
    };

    /* ================================================================
     * Volatility & channels
     * ================================================================ */

    /** True Range per bar. */
    I.trueRange = function (bars) {
        var n = bars.length, out = nanArray(n);
        if (!n) return out;
        out[0] = bars[0].high - bars[0].low;
        for (var i = 1; i < n; i++) {
            var pc = bars[i - 1].close;
            out[i] = Math.max(bars[i].high - bars[i].low,
                              Math.abs(bars[i].high - pc),
                              Math.abs(bars[i].low - pc));
        }
        return out;
    };

    /** Average True Range (Wilder smoothing of True Range). */
    I.atr = function (bars, period) {
        var tr = I.trueRange(bars);
        var n = bars.length, out = nanArray(n);
        if (n < period + 1) return out;
        // Wilder seeds ATR with the simple average of the first `period` TRs (bars 1..period).
        var seed = 0;
        for (var i = 1; i <= period; i++) seed += tr[i];
        var prev = seed / period;
        out[period] = prev;
        for (var j = period + 1; j < n; j++) {
            prev = (prev * (period - 1) + tr[j]) / period;
            out[j] = prev;
        }
        return out;
    };

    /** Average Directional Index with +DI and -DI (Wilder). */
    I.adx = function (bars, period) {
        var n = bars.length;
        var res = { adx: nanArray(n), plusDI: nanArray(n), minusDI: nanArray(n) };
        if (n < period * 2 + 1) return res;

        var tr = nanArray(n), plusDM = nanArray(n), minusDM = nanArray(n);
        for (var i = 1; i < n; i++) {
            var up = bars[i].high - bars[i - 1].high;
            var dn = bars[i - 1].low - bars[i].low;
            plusDM[i] = (up > dn && up > 0) ? up : 0;
            minusDM[i] = (dn > up && dn > 0) ? dn : 0;
            var pc = bars[i - 1].close;
            tr[i] = Math.max(bars[i].high - bars[i].low,
                             Math.abs(bars[i].high - pc),
                             Math.abs(bars[i].low - pc));
        }

        var strTR = 0, strP = 0, strM = 0;
        for (var s = 1; s <= period; s++) { strTR += tr[s]; strP += plusDM[s]; strM += minusDM[s]; }

        var dxs = [];
        for (var t = period; t < n; t++) {
            if (t > period) {
                strTR = strTR - strTR / period + tr[t];
                strP  = strP  - strP  / period + plusDM[t];
                strM  = strM  - strM  / period + minusDM[t];
            }
            var pdi = strTR > U.EPS ? 100 * strP / strTR : 0;
            var mdi = strTR > U.EPS ? 100 * strM / strTR : 0;
            res.plusDI[t] = pdi;
            res.minusDI[t] = mdi;
            var denom = pdi + mdi;
            var dx = denom > U.EPS ? 100 * Math.abs(pdi - mdi) / denom : 0;
            dxs.push({ idx: t, dx: dx });
        }

        if (dxs.length >= period) {
            var acc = 0;
            for (var a = 0; a < period; a++) acc += dxs[a].dx;
            var prevAdx = acc / period;
            res.adx[dxs[period - 1].idx] = prevAdx;
            for (var b = period; b < dxs.length; b++) {
                prevAdx = (prevAdx * (period - 1) + dxs[b].dx) / period;
                res.adx[dxs[b].idx] = prevAdx;
            }
        }
        return res;
    };

    /** Bollinger Bands (population standard deviation). */
    I.bollinger = function (closes, period, mult) {
        var n = closes.length;
        var mid = I.sma(closes, period);
        var upper = nanArray(n), lower = nanArray(n), bandwidth = nanArray(n), percentB = nanArray(n);
        for (var i = period - 1; i < n; i++) {
            var win = closes.slice(i - period + 1, i + 1);
            var sd = U.stdDevPopulation(win);
            upper[i] = mid[i] + mult * sd;
            lower[i] = mid[i] - mult * sd;
            bandwidth[i] = Math.abs(mid[i]) > U.EPS ? ((upper[i] - lower[i]) / mid[i]) * 100 : NaNv;
            var span = upper[i] - lower[i];
            percentB[i] = span > U.EPS ? (closes[i] - lower[i]) / span : 0.5;
        }
        return { middle: mid, upper: upper, lower: lower, bandwidth: bandwidth, percentB: percentB };
    };

    /** Keltner Channels: EMA centre with ATR-scaled envelopes. */
    I.keltner = function (bars, period, atrPeriod, mult) {
        var closes = U.pluck(bars, 'close');
        var mid = I.ema(closes, period);
        var atr = I.atr(bars, atrPeriod);
        var n = bars.length, upper = nanArray(n), lower = nanArray(n);
        for (var i = 0; i < n; i++) {
            if (U.isFiniteNumber(mid[i]) && U.isFiniteNumber(atr[i])) {
                upper[i] = mid[i] + mult * atr[i];
                lower[i] = mid[i] - mult * atr[i];
            }
        }
        return { middle: mid, upper: upper, lower: lower };
    };

    /**
     * Donchian Channels. Uses only *prior* bars for the channel so a breakout is
     * evaluated against a range the current bar did not itself create — the
     * non-repainting convention required by D2 §3.1.
     */
    I.donchian = function (bars, period) {
        var n = bars.length;
        var upper = nanArray(n), lower = nanArray(n), middle = nanArray(n);
        for (var i = period; i < n; i++) {
            var hh = -Infinity, ll = Infinity;
            for (var k = i - period; k < i; k++) {
                if (bars[k].high > hh) hh = bars[k].high;
                if (bars[k].low < ll) ll = bars[k].low;
            }
            upper[i] = hh; lower[i] = ll; middle[i] = (hh + ll) / 2;
        }
        return { upper: upper, lower: lower, middle: middle };
    };

    /** Realised volatility: annualised standard deviation of log returns, in percent. */
    I.realizedVolatility = function (closes, period, barsPerYear) {
        var n = closes.length, out = nanArray(n);
        if (n < period + 1) return out;
        var lr = nanArray(n);
        for (var i = 1; i < n; i++) {
            if (closes[i - 1] > U.EPS && closes[i] > U.EPS) lr[i] = Math.log(closes[i] / closes[i - 1]);
        }
        for (var j = period; j < n; j++) {
            var win = lr.slice(j - period + 1, j + 1).filter(U.isFiniteNumber);
            if (win.length < 2) continue;
            out[j] = U.stdDevPopulation(win) * Math.sqrt(barsPerYear) * 100;
        }
        return out;
    };

    /* ================================================================
     * Volume
     * ================================================================ */

    /** On-Balance Volume. */
    I.obv = function (bars) {
        var n = bars.length, out = nanArray(n);
        if (!n) return out;
        var acc = 0;
        out[0] = 0;
        for (var i = 1; i < n; i++) {
            if (bars[i].close > bars[i - 1].close + U.EPS) acc += bars[i].volume;
            else if (bars[i].close < bars[i - 1].close - U.EPS) acc -= bars[i].volume;
            out[i] = acc;
        }
        return out;
    };

    /** Money Flow Index. */
    I.mfi = function (bars, period) {
        var n = bars.length, out = nanArray(n);
        if (n < period + 1) return out;
        var tp = new Array(n), rmf = new Array(n);
        for (var i = 0; i < n; i++) {
            tp[i] = (bars[i].high + bars[i].low + bars[i].close) / 3;
            rmf[i] = tp[i] * bars[i].volume;
        }
        for (var j = period; j < n; j++) {
            var pos = 0, neg = 0;
            for (var k = j - period + 1; k <= j; k++) {
                if (tp[k] > tp[k - 1] + U.EPS) pos += rmf[k];
                else if (tp[k] < tp[k - 1] - U.EPS) neg += rmf[k];
            }
            out[j] = neg <= U.EPS ? 100 : 100 - (100 / (1 + pos / neg));
        }
        return out;
    };

    /** Chaikin Money Flow. */
    I.cmf = function (bars, period) {
        var n = bars.length, out = nanArray(n);
        if (n < period) return out;
        var mfv = new Array(n);
        for (var i = 0; i < n; i++) {
            var range = bars[i].high - bars[i].low;
            var mult = range <= U.EPS ? 0 :
                       ((bars[i].close - bars[i].low) - (bars[i].high - bars[i].close)) / range;
            mfv[i] = mult * bars[i].volume;
        }
        for (var j = period - 1; j < n; j++) {
            var sm = 0, sv = 0;
            for (var k = j - period + 1; k <= j; k++) { sm += mfv[k]; sv += bars[k].volume; }
            out[j] = sv <= U.EPS ? 0 : sm / sv;
        }
        return out;
    };

    /**
     * VWAP anchored to the UTC session start. Resets whenever the UTC day changes,
     * which is the standard anchoring for a 24h instrument.
     */
    I.vwap = function (bars) {
        var n = bars.length, out = nanArray(n);
        var cumPV = 0, cumV = 0, day = null;
        for (var i = 0; i < n; i++) {
            var d = Math.floor(bars[i].time / 86400000);
            if (day === null || d !== day) { cumPV = 0; cumV = 0; day = d; }
            var tp = (bars[i].high + bars[i].low + bars[i].close) / 3;
            cumPV += tp * bars[i].volume;
            cumV += bars[i].volume;
            out[i] = cumV > U.EPS ? cumPV / cumV : tp;
        }
        return out;
    };

    /** Relative volume against the trailing average. */
    I.relativeVolume = function (bars, period) {
        var vols = U.pluck(bars, 'volume');
        var avg = I.sma(vols, period);
        var n = bars.length, out = nanArray(n);
        for (var i = 0; i < n; i++) {
            if (U.isFiniteNumber(avg[i]) && avg[i] > U.EPS) out[i] = vols[i] / avg[i];
        }
        return out;
    };

    /**
     * Volume Profile over the visible range: binned traded volume, POC and value area.
     * Derived legitimately from OHLCV by distributing each bar's volume across the
     * bins its range covers. True order-flow delta is NOT derivable and is not faked.
     */
    I.volumeProfile = function (bars, binCount, valueAreaPct) {
        if (!bars.length) return null;
        var hi = -Infinity, lo = Infinity, i;
        for (i = 0; i < bars.length; i++) {
            if (bars[i].high > hi) hi = bars[i].high;
            if (bars[i].low < lo) lo = bars[i].low;
        }
        var span = hi - lo;
        if (!(span > U.EPS)) return null;
        var binSize = span / binCount;
        var bins = new Array(binCount);
        for (i = 0; i < binCount; i++) bins[i] = { low: lo + i * binSize, high: lo + (i + 1) * binSize, volume: 0 };

        for (i = 0; i < bars.length; i++) {
            var b = bars[i];
            var range = b.high - b.low;
            var startBin = Math.max(0, Math.min(binCount - 1, Math.floor((b.low - lo) / binSize)));
            var endBin = Math.max(0, Math.min(binCount - 1, Math.floor((b.high - lo) / binSize)));
            var touched = endBin - startBin + 1;
            if (range <= U.EPS || touched <= 1) {
                bins[startBin].volume += b.volume;
            } else {
                var share = b.volume / touched;      // uniform distribution across covered bins
                for (var k = startBin; k <= endBin; k++) bins[k].volume += share;
            }
        }

        var pocIdx = 0;
        for (i = 1; i < binCount; i++) if (bins[i].volume > bins[pocIdx].volume) pocIdx = i;

        var totalVol = 0;
        for (i = 0; i < binCount; i++) totalVol += bins[i].volume;
        var target = totalVol * valueAreaPct;
        var lowIdx = pocIdx, highIdx = pocIdx, acc = bins[pocIdx].volume;
        while (acc < target && (lowIdx > 0 || highIdx < binCount - 1)) {
            var below = lowIdx > 0 ? bins[lowIdx - 1].volume : -1;
            var above = highIdx < binCount - 1 ? bins[highIdx + 1].volume : -1;
            if (above >= below) { highIdx++; acc += bins[highIdx].volume; }
            else { lowIdx--; acc += bins[lowIdx].volume; }
        }
        return {
            bins: bins,
            poc: (bins[pocIdx].low + bins[pocIdx].high) / 2,
            valueAreaHigh: bins[highIdx].high,
            valueAreaLow: bins[lowIdx].low,
            totalVolume: totalVol
        };
    };

    /* ================================================================
     * Trend systems
     * ================================================================ */

    /** SuperTrend with the standard final-band carry-forward rules. */
    I.superTrend = function (bars, period, mult) {
        var n = bars.length;
        var atr = I.atr(bars, period);
        var upper = nanArray(n), lower = nanArray(n), line = nanArray(n), dir = nanArray(n);
        var prevUpper = NaNv, prevLower = NaNv, prevDir = 1, prevClose = NaNv;

        for (var i = 0; i < n; i++) {
            if (!U.isFiniteNumber(atr[i])) continue;
            var mid = (bars[i].high + bars[i].low) / 2;
            var basicUpper = mid + mult * atr[i];
            var basicLower = mid - mult * atr[i];

            var finalUpper = (!U.isFiniteNumber(prevUpper) || basicUpper < prevUpper || prevClose > prevUpper)
                             ? basicUpper : prevUpper;
            var finalLower = (!U.isFiniteNumber(prevLower) || basicLower > prevLower || prevClose < prevLower)
                             ? basicLower : prevLower;

            var d;
            if (!U.isFiniteNumber(prevUpper)) {
                d = bars[i].close > mid ? 1 : -1;
            } else if (prevDir === 1) {
                d = bars[i].close < finalLower ? -1 : 1;
            } else {
                d = bars[i].close > finalUpper ? 1 : -1;
            }

            upper[i] = finalUpper; lower[i] = finalLower; dir[i] = d;
            line[i] = d === 1 ? finalLower : finalUpper;

            prevUpper = finalUpper; prevLower = finalLower; prevDir = d; prevClose = bars[i].close;
        }
        return { line: line, direction: dir, upper: upper, lower: lower };
    };

    /** Parabolic SAR (Wilder). */
    I.psar = function (bars, step, maxStep) {
        var n = bars.length;
        var out = nanArray(n), dir = nanArray(n);
        if (n < 2) return { sar: out, direction: dir };

        var isLong = bars[1].close >= bars[0].close;
        var af = step;
        var ep = isLong ? Math.max(bars[0].high, bars[1].high) : Math.min(bars[0].low, bars[1].low);
        var sar = isLong ? Math.min(bars[0].low, bars[1].low) : Math.max(bars[0].high, bars[1].high);
        out[1] = sar; dir[1] = isLong ? 1 : -1;

        for (var i = 2; i < n; i++) {
            sar = sar + af * (ep - sar);

            if (isLong) {
                // SAR may not exceed the prior two lows.
                sar = Math.min(sar, bars[i - 1].low, bars[i - 2].low);
                if (bars[i].low < sar) {                       // flip to short
                    isLong = false; sar = ep; ep = bars[i].low; af = step;
                } else if (bars[i].high > ep) {
                    ep = bars[i].high; af = Math.min(af + step, maxStep);
                }
            } else {
                sar = Math.max(sar, bars[i - 1].high, bars[i - 2].high);
                if (bars[i].high > sar) {                      // flip to long
                    isLong = true; sar = ep; ep = bars[i].high; af = step;
                } else if (bars[i].low < ep) {
                    ep = bars[i].low; af = Math.min(af + step, maxStep);
                }
            }
            out[i] = sar; dir[i] = isLong ? 1 : -1;
        }
        return { sar: out, direction: dir };
    };

    /**
     * Ichimoku Kinko Hyo.
     * Spans A/B are returned at their *plotted* index (displaced forward), and also
     * as `spanAAt`/`spanBAt` giving the cloud value applicable to each bar, which is
     * what a signal engine needs.
     */
    I.ichimoku = function (bars, convP, baseP, spanBP, displacement) {
        var n = bars.length;
        function midOver(period, idx) {
            if (idx < period - 1) return NaNv;
            var hh = -Infinity, ll = Infinity;
            for (var k = idx - period + 1; k <= idx; k++) {
                if (bars[k].high > hh) hh = bars[k].high;
                if (bars[k].low < ll) ll = bars[k].low;
            }
            return (hh + ll) / 2;
        }
        var conversion = nanArray(n), base = nanArray(n),
            spanARaw = nanArray(n), spanBRaw = nanArray(n),
            spanAAt = nanArray(n), spanBAt = nanArray(n), lagging = nanArray(n);

        for (var i = 0; i < n; i++) {
            conversion[i] = midOver(convP, i);
            base[i] = midOver(baseP, i);
            if (U.isFiniteNumber(conversion[i]) && U.isFiniteNumber(base[i])) {
                spanARaw[i] = (conversion[i] + base[i]) / 2;
            }
            spanBRaw[i] = midOver(spanBP, i);
            if (i - displacement >= 0) {
                spanAAt[i] = spanARaw[i - displacement];
                spanBAt[i] = spanBRaw[i - displacement];
            }
            if (i + displacement < n) lagging[i + displacement] = bars[i].close;
        }
        return { conversion: conversion, base: base,
                 spanA: spanARaw, spanB: spanBRaw,
                 spanAAt: spanAAt, spanBAt: spanBAt,
                 lagging: lagging };
    };

    /** Classic floor-trader pivot points from the previous period's HLC. */
    I.pivotPoints = function (high, low, close) {
        var p = (high + low + close) / 3;
        var range = high - low;
        return {
            pivot: p,
            r1: 2 * p - low,   s1: 2 * p - high,
            r2: p + range,     s2: p - range,
            r3: high + 2 * (p - low), s3: low - 2 * (high - p)
        };
    };

    /* ================================================================
     * Aggregate computation
     * ================================================================ */

    /**
     * Computes the full indicator set for a bar series.
     * @param {Array} bars canonical OHLCV bars, ascending, completed only
     * @param {Object} cfg QT.CONFIG (or a clone with overrides)
     */
    I.computeAll = function (bars, cfg) {
        cfg = cfg || QT.CONFIG;
        var p = cfg.indicators;
        var closes = U.pluck(bars, 'close');
        var highs = U.pluck(bars, 'high');
        var lows = U.pluck(bars, 'low');
        var volumes = U.pluck(bars, 'volume');
        var hasVolume = volumes.some(function (v) { return v > U.EPS; });

        var barsPerYear = 365;   // refined by caller via cfg if needed

        var out = {
            meta: { bars: bars.length, hasVolume: hasVolume },
            close: closes, high: highs, low: lows, volume: volumes,

            emaFast: I.ema(closes, p.ema.fast),
            emaMid:  I.ema(closes, p.ema.mid),
            emaSlow: I.ema(closes, p.ema.slow),
            sma:     {},
            wma:     I.wma(closes, p.wma.period),
            vwma:    hasVolume ? I.vwma(closes, volumes, p.vwma.period) : nanArray(bars.length),

            rsi:     I.rsi(closes, p.rsi.period),
            rsiFast: I.rsi(closes, p.rsiFast.period),
            macd:    I.macd(closes, p.macd.fast, p.macd.slow, p.macd.signal),
            cci:     I.cci(bars, p.cci.period),
            roc:     I.roc(closes, p.roc.period),
            momentum: I.momentum(closes, p.momentum.period),
            stochastic: I.stochastic(bars, p.stochastic.kPeriod, p.stochastic.dPeriod, p.stochastic.smooth),
            williamsR: I.williamsR(bars, p.williamsR.period),

            atr:  I.atr(bars, p.atr.period),
            adx:  I.adx(bars, p.adx.period),
            bollinger: I.bollinger(closes, p.bollinger.period, p.bollinger.stdDev),
            keltner:   I.keltner(bars, p.keltner.period, p.keltner.atrPeriod, p.keltner.multiplier),
            donchian:  {},
            realizedVol: I.realizedVolatility(closes, p.atr.period, barsPerYear),

            obv: hasVolume ? I.obv(bars) : nanArray(bars.length),
            mfi: hasVolume ? I.mfi(bars, p.mfi.period) : nanArray(bars.length),
            cmf: hasVolume ? I.cmf(bars, p.cmf.period) : nanArray(bars.length),
            vwap: hasVolume ? I.vwap(bars) : nanArray(bars.length),
            relativeVolume: hasVolume ? I.relativeVolume(bars, p.volume.avgPeriod) : nanArray(bars.length),
            volumeProfile: hasVolume ? I.volumeProfile(bars, p.volumeProfile.bins, p.volumeProfile.valueAreaPct) : null,

            superTrend: I.superTrend(bars, p.superTrend.period, p.superTrend.multiplier),
            psar: I.psar(bars, p.psar.step, p.psar.max),
            ichimoku: I.ichimoku(bars, p.ichimoku.conversion, p.ichimoku.base,
                                 p.ichimoku.spanB, p.ichimoku.displacement)
        };

        p.sma.periods.forEach(function (per) { out.sma[per] = I.sma(closes, per); });
        p.donchian.periods.forEach(function (per) {
            if (bars.length > per) out.donchian[per] = I.donchian(bars, per);
        });

        if (bars.length >= 2) {
            var prev = bars[bars.length - 2];
            out.pivots = I.pivotPoints(prev.high, prev.low, prev.close);
        }

        out.obvSlope = hasVolume ? I.sma(out.obv, p.obv.smoothing) : nanArray(bars.length);
        return out;
    };

    QT.indicators = I;

})(typeof globalThis !== 'undefined' ? globalThis : this);

if (typeof module !== 'undefined' && module.exports) {
    module.exports = (typeof globalThis !== 'undefined' ? globalThis : this).QT.indicators;
}
