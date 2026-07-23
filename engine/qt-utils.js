/**
 * qt-utils.js — Numeric and structural helpers shared by every engine stage.
 * Pure functions only: no I/O, no clock reads, no randomness.
 */
(function (root) {
    'use strict';

    var QT = root.QT = root.QT || {};
    var EPS = (QT.CONFIG && QT.CONFIG.epsilon) || 1e-10;

    var U = {

        EPS: EPS,

        isFiniteNumber: function (v) {
            return typeof v === 'number' && isFinite(v);
        },

        /** Strict numeric coercion: returns NaN for anything not cleanly numeric. */
        toNumber: function (v) {
            if (typeof v === 'number') return isFinite(v) ? v : NaN;
            if (typeof v === 'string') {
                var t = v.trim();
                if (t === '') return NaN;
                var n = Number(t);
                return isFinite(n) ? n : NaN;
            }
            return NaN;
        },

        eq: function (a, b, eps) {
            return Math.abs(a - b) <= (eps === undefined ? EPS : eps);
        },

        clamp: function (v, lo, hi) {
            return v < lo ? lo : (v > hi ? hi : v);
        },

        /** Rounds to `dp` decimals without float drift artefacts. */
        round: function (v, dp) {
            if (!isFinite(v)) return NaN;
            var f = Math.pow(10, dp === undefined ? 8 : dp);
            return Math.round((v + (v >= 0 ? 1 : -1) * Number.EPSILON * Math.abs(v)) * f) / f;
        },

        sum: function (arr) {
            var s = 0;
            for (var i = 0; i < arr.length; i++) s += arr[i];
            return s;
        },

        mean: function (arr) {
            return arr.length ? U.sum(arr) / arr.length : NaN;
        },

        /** Population standard deviation — the definition Bollinger Bands use. */
        stdDevPopulation: function (arr) {
            var n = arr.length;
            if (n === 0) return NaN;
            var m = U.mean(arr), acc = 0;
            for (var i = 0; i < n; i++) { var d = arr[i] - m; acc += d * d; }
            return Math.sqrt(acc / n);
        },

        highest: function (arr, from, len) {
            var h = -Infinity;
            for (var i = from; i < from + len; i++) if (arr[i] > h) h = arr[i];
            return h;
        },

        lowest: function (arr, from, len) {
            var l = Infinity;
            for (var i = from; i < from + len; i++) if (arr[i] < l) l = arr[i];
            return l;
        },

        /** Percentile rank of `value` within `arr`, in [0,1]. Deterministic. */
        percentileRank: function (arr, value) {
            if (!arr.length) return NaN;
            var below = 0;
            for (var i = 0; i < arr.length; i++) if (arr[i] < value) below++;
            return below / arr.length;
        },

        /** Extracts a named field from an OHLCV bar array. */
        pluck: function (bars, field) {
            var out = new Array(bars.length);
            for (var i = 0; i < bars.length; i++) out[i] = bars[i][field];
            return out;
        },

        /** Fills `len` leading positions with NaN so indicator arrays stay bar-aligned. */
        padLeft: function (values, len) {
            var pad = new Array(Math.max(0, len));
            for (var i = 0; i < pad.length; i++) pad[i] = NaN;
            return pad.concat(values);
        },

        /** Last finite value in an array, or NaN. */
        lastFinite: function (arr) {
            for (var i = arr.length - 1; i >= 0; i--) {
                if (U.isFiniteNumber(arr[i])) return arr[i];
            }
            return NaN;
        },

        /** Linear map from [inLo,inHi] to [outLo,outHi], clamped. */
        rescale: function (v, inLo, inHi, outLo, outHi) {
            if (!isFinite(v)) return NaN;
            if (Math.abs(inHi - inLo) <= EPS) return (outLo + outHi) / 2;
            var t = (v - inLo) / (inHi - inLo);
            return U.clamp(outLo + t * (outHi - outLo), Math.min(outLo, outHi), Math.max(outLo, outHi));
        },

        /** Bounded tanh-style squash mapping any real to [-1,1] without clipping artefacts. */
        squash: function (v, scale) {
            if (!isFinite(v)) return 0;
            var s = scale || 1;
            return Math.tanh(v / s);
        },

        /** True crossover of a over b between the previous and current index. */
        crossedAbove: function (a, b, i) {
            if (i < 1) return false;
            return U.isFiniteNumber(a[i]) && U.isFiniteNumber(b[i]) &&
                   U.isFiniteNumber(a[i - 1]) && U.isFiniteNumber(b[i - 1]) &&
                   a[i - 1] <= b[i - 1] + EPS && a[i] > b[i] + EPS;
        },

        crossedBelow: function (a, b, i) {
            if (i < 1) return false;
            return U.isFiniteNumber(a[i]) && U.isFiniteNumber(b[i]) &&
                   U.isFiniteNumber(a[i - 1]) && U.isFiniteNumber(b[i - 1]) &&
                   a[i - 1] >= b[i - 1] - EPS && a[i] < b[i] - EPS;
        },

        /** Number of decimals appropriate for displaying a price at this magnitude. */
        priceDecimals: function (price) {
            var p = Math.abs(price);
            if (p >= 1000) return 2;
            if (p >= 100) return 3;
            if (p >= 1) return 5;
            return 6;
        },

        formatPrice: function (price) {
            if (!U.isFiniteNumber(price)) return 'n/a';
            return price.toFixed(U.priceDecimals(price));
        },

        /** Stable deep clone for plain data (no functions/dates). */
        clone: function (v) {
            return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
        }
    };

    QT.utils = U;

})(typeof globalThis !== 'undefined' ? globalThis : this);

if (typeof module !== 'undefined' && module.exports) {
    module.exports = (typeof globalThis !== 'undefined' ? globalThis : this).QT.utils;
}
