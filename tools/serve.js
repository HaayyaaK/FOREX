/**
 * tools/serve.js — minimal static server for local testing.
 *
 * Portable: resolves paths relative to this file, reads the port from the
 * environment, and has no dependencies. Production uses IIS (see web.config).
 *
 *   node tools/serve.js            -> http://localhost:8322
 *   PORT=9000 node tools/serve.js
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = parseInt(process.env.PORT, 10) || 8322;

const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.md': 'text/markdown; charset=utf-8'
};

/** Blocked from static serving, mirroring the IIS rules in web.config. */
const BLOCKED = /^(\.env|\.git|node_modules|tests|backtest)(\/|$)/;

http.createServer((req, res) => {
    let rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
    if (rel === '') rel = 'dashboard.html';

    if (BLOCKED.test(rel)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('Not found');
    }

    // Contain the resolved path inside ROOT (path-traversal guard).
    const target = path.resolve(ROOT, rel);
    if (!target.startsWith(ROOT)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        return res.end('Forbidden');
    }

    let body;
    try {
        body = fs.readFileSync(target);          // read BEFORE writing headers
    } catch (e) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('Not found');
    }

    res.writeHead(200, {
        'Content-Type': TYPES[path.extname(target).toLowerCase()] || 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': path.extname(target) === '.html' ? 'no-store' : 'no-cache'
    });
    res.end(body);
}).listen(PORT, () => {
    console.log(`Dashboard served from ${ROOT}`);
    console.log(`  http://localhost:${PORT}/dashboard.html`);
    console.log('  (the analysis proxy must also be running — see README.md)');
});
