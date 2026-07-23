/**
 * Runs every phase test suite. Exit code 0 means all phases are green.
 *   node tests/run-all.js
 */
'use strict';

var SUITES = [
    './phase1-data.test.js',
    './phase2-indicators.test.js',
    './phase3-patterns.test.js',
    './phase4-trend.test.js',
    './phase5-risk.test.js',
    './phase6-scoring.test.js',
    './phase7-recommendation.test.js',
    './phase8-presentation.test.js',
    './phase9-backtest.test.js'
];

var all = [];
var i = 0;

function next() {
    if (i >= SUITES.length) return Promise.resolve();
    var mod = SUITES[i++];
    delete require.cache[require.resolve(mod)];
    var T = require(mod);
    return T.run().then(function (results) {
        all = all.concat(results);
        T.reset();
        return next();
    });
}

next().then(function () {
    var bySuite = {};
    all.forEach(function (r) { (bySuite[r.suite] = bySuite[r.suite] || []).push(r); });

    var failures = all.filter(function (r) { return !r.ok; });
    Object.keys(bySuite).forEach(function (s) {
        var rs = bySuite[s];
        var bad = rs.filter(function (r) { return !r.ok; }).length;
        console.log((bad ? 'FAIL  ' : 'PASS  ') + s + '  (' + (rs.length - bad) + '/' + rs.length + ')');
    });

    if (failures.length) {
        console.log('\nFailures:');
        failures.forEach(function (f) {
            console.log('  [' + f.suite + '] ' + f.test + ' :: ' + f.message +
                        (f.detail ? '  ' + f.detail : ''));
        });
    }
    console.log('\n' + (all.length - failures.length) + '/' + all.length + ' assertions passed');
    process.exit(failures.length ? 1 : 0);
}).catch(function (e) {
    console.error('Runner crashed:', e);
    process.exit(1);
});
