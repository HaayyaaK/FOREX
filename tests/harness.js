/**
 * Minimal deterministic test harness.
 * No dependencies, supports sync and promise-returning tests.
 */
'use strict';

var state = { suite: '', results: [], queue: [] };

function record(ok, message, detail) {
    state.results.push({ suite: state.suite, test: state.current, ok: ok,
                         message: message, detail: detail || '' });
}

var T = {
    suite: function (name) { state.suite = name; },

    test: function (name, fn) {
        state.queue.push({ name: name, fn: fn, suite: state.suite });
    },

    pass:  function (m) { record(true, m); },
    fail:  function (m, d) { record(false, m, d); },

    ok: function (cond, message) { record(!!cond, message); return !!cond; },

    equal: function (actual, expected, message) {
        var ok = actual === expected ||
                 (typeof actual === 'number' && typeof expected === 'number' &&
                  isNaN(actual) && isNaN(expected));
        record(ok, message, ok ? '' : 'expected ' + JSON.stringify(expected) +
                                     ', got ' + JSON.stringify(actual));
        return ok;
    },

    /** Numeric comparison with absolute or relative tolerance. */
    close: function (actual, expected, tol, message) {
        var ok;
        if (!isFinite(actual) || !isFinite(expected)) {
            ok = false;
        } else {
            var diff = Math.abs(actual - expected);
            var scale = Math.max(1, Math.abs(expected));
            ok = diff <= tol || diff / scale <= tol;
        }
        record(ok, message, ok ? '' : 'expected ~' + expected + ' (tol ' + tol + '), got ' + actual);
        return ok;
    },

    deepEqual: function (actual, expected, message) {
        var a = JSON.stringify(actual), b = JSON.stringify(expected);
        record(a === b, message, a === b ? '' : 'expected ' + b + ', got ' + a);
        return a === b;
    },

    throws: function (fn, message) {
        var threw = false;
        try { fn(); } catch (e) { threw = true; }
        record(threw, message, threw ? '' : 'expected a throw');
        return threw;
    },

    run: function () {
        var i = 0;
        function next() {
            if (i >= state.queue.length) return Promise.resolve();
            var item = state.queue[i++];
            state.current = item.name;
            state.suite = item.suite;
            var out;
            try {
                out = item.fn();
            } catch (e) {
                record(false, 'threw unexpectedly: ' + item.name, e && e.stack ? e.stack.split('\n')[0] : String(e));
                return next();
            }
            if (out && typeof out.then === 'function') {
                return out.then(next, function (e) {
                    record(false, 'rejected unexpectedly: ' + item.name,
                           e && e.stack ? e.stack.split('\n')[0] : String(e));
                    return next();
                });
            }
            return next();
        }
        return next().then(function () { return state.results; });
    },

    report: function (results) {
        var bySuite = {};
        results.forEach(function (r) { (bySuite[r.suite] = bySuite[r.suite] || []).push(r); });

        var total = 0, failed = 0;
        Object.keys(bySuite).forEach(function (s) {
            console.log('\n=== ' + s + ' ===');
            var seen = {};
            bySuite[s].forEach(function (r) {
                total++;
                if (!r.ok) failed++;
                if (!seen[r.test]) { seen[r.test] = true; console.log('  ' + r.test); }
                console.log('    ' + (r.ok ? 'PASS' : 'FAIL') + '  ' + r.message +
                            (r.detail ? '  [' + r.detail + ']' : ''));
            });
        });
        console.log('\n' + (total - failed) + '/' + total + ' assertions passed');
        return failed === 0;
    },

    reset: function () { state = { suite: '', results: [], queue: [] }; }
};

module.exports = T;
