/**
 * qt-card.js — Phase 8: Presentation layer ("the Workstation").
 *
 * ARCHITECTURE BOUNDARY (enforced by test — see tests/phase8-presentation.test.js):
 * This module renders the recommendation object and NOTHING else. It never
 * recalculates an indicator, recomputes a score, infers a missing value, or
 * reinterprets a recommendation. The only transformations permitted here are
 * presentational: number -> string formatting, value -> pixel/percentage
 * scaling for bars and rings, and text -> icon/tone classification for
 * already-produced strings (the same pattern `toneFor()` used before this
 * redesign, applied consistently to pattern/structure evidence labels too).
 *
 * ONE DELIBERATE, NON-ENGINE EXTENSION:
 * The recommendation object (`rec`) has no "current price" field — it was
 * never part of the Phase 7 contract, and that contract is unchanged here.
 * `CARD.render(container, rec, context)` accepts an OPTIONAL third argument,
 * `context = { price, priceTime }`, which the caller (qt-app.js) may populate
 * from the raw bars it already fetched (bars[last].close) — no new
 * calculation, just forwarding data qt-app.js already holds. This is a
 * rendering-call extension, not a change to the engine or its JSON output;
 * `rec` itself is read verbatim and `context` is entirely optional — the
 * hero degrades to "—" for price when it is omitted.
 *
 * Five progressive-disclosure levels, using native <details>/<summary> for
 * accessible, keyboard-operable expand/collapse with zero extra JS:
 *   L1 Hero + Executive Summary   (always open)
 *   L2 Market Health / Trade / Structure / Scores / Confidence / Evidence /
 *      Gates / MTF               (open by default — compact enough to scan)
 *   L3 Warnings                  (open when present)
 *   L4 Technical Details         (closed by default)
 *   L5 Engine Inspection         (closed by default, developer/diagnostic)
 *
 * PHASE 8.5 — DUAL INTERFACE MODES (Trader / Analyst):
 * `rec` is rendered exactly once per `CARD.render()` call; mode is a purely
 * cosmetic CSS-visibility concern layered on top of the SAME DOM, not a
 * different render path. Every section is tagged with a `scope` ('both' by
 * default, or 'analyst') via `section(id, level, title, { scope: 'analyst' })`
 * or, for individual rows/gauges inside one section (e.g. two Market Health
 * gauges, cleanly-passing qualification gates), a `qtw-analyst-only` class
 * added directly to that element. The mirror class `qtw-trader-only` marks
 * the rare element that exists ONLY to summarize for Trader Mode (e.g. the
 * "All N gates passed" line) and is hidden in Analyst Mode, where the full
 * detail it summarizes is already visible. The root `.qtw` element carries
 * `data-mode="trader"|"analyst"`; CSS alone (`.qtw[data-mode=trader]
 * .qtw-analyst-only { display:none }`) decides visibility. `CARD.setMode()`
 * never rebuilds the DOM — it only flips that attribute on whatever `.qtw`
 * root(s) are currently mounted, and persists the choice to localStorage so
 * it survives a reload. No analytical data is read, computed, or altered by
 * either function.
 */
(function (root) {
    'use strict';

    var QT = root.QT = root.QT || {};
    var CARD = {};

    /* ================================================================
     * Dual interface modes (Trader / Analyst) — display-only state.
     * Neither reads nor computes anything from `rec`; see the file header.
     * ================================================================ */
    var MODE_KEY = 'qt.uiMode';
    var currentMode = null;

    function loadStoredMode() {
        try {
            var stored = root.localStorage && root.localStorage.getItem(MODE_KEY);
            return stored === 'analyst' ? 'analyst' : 'trader';
        } catch (e) { return 'trader'; }
    }

    CARD.getMode = function () {
        if (currentMode === null) currentMode = loadStoredMode();
        return currentMode;
    };

    /** Flips visibility on whatever `.qtw` root(s) are already mounted — no rebuild, no re-render. */
    CARD.setMode = function (mode) {
        mode = mode === 'analyst' ? 'analyst' : 'trader';
        currentMode = mode;
        try { root.localStorage && root.localStorage.setItem(MODE_KEY, mode); } catch (e) { /* storage may be unavailable */ }
        if (typeof document !== 'undefined') {
            var roots = document.querySelectorAll('.qtw');
            for (var i = 0; i < roots.length; i++) roots[i].setAttribute('data-mode', mode);
        }
        return mode;
    };

    /* ================================================================
     * DOM helpers — presentation-only
     * ================================================================ */
    var SVG_NS = 'http://www.w3.org/2000/svg';

    function h(tag, props, children) {
        var n = document.createElement(tag);
        props = props || {};
        Object.keys(props).forEach(function (k) {
            if (k === 'class') n.className = props[k];
            else if (k === 'text') n.textContent = props[k];
            else if (k === 'html') n.innerHTML = props[k];      // only ever used with literal, static markup below
            else if (k.indexOf('on') === 0 && typeof props[k] === 'function') {
                n.addEventListener(k.slice(2), props[k]);
            } else if (k === 'dataset') {
                Object.keys(props[k]).forEach(function (dk) { n.dataset[dk] = props[k][dk]; });
            } else {
                n.setAttribute(k, props[k]);
            }
        });
        (children || []).forEach(function (c) { if (c) n.appendChild(c); });
        return n;
    }

    function svg(tag, attrs) {
        var n = document.createElementNS(SVG_NS, tag);
        Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
        return n;
    }

    function text(t) { return document.createTextNode(t === undefined || t === null ? '' : String(t)); }

    function clamp01(v) { return !isFinite(v) ? 0 : Math.max(0, Math.min(1, v)); }

    /* ================================================================
     * Formatting — presentation-only
     * ================================================================ */
    function pct(v, dp) {
        return (v === null || v === undefined || !isFinite(v)) ? '—' : v.toFixed(dp === undefined ? 0 : dp) + '%';
    }
    function num(v, dp) {
        return (v === null || v === undefined || !isFinite(v)) ? '—' : v.toFixed(dp === undefined ? 2 : dp);
    }
    function signed(v, dp, suffix) {
        if (v === null || v === undefined || !isFinite(v)) return '—';
        var s = v > 0 ? '+' : '';
        return s + v.toFixed(dp === undefined ? 2 : dp) + (suffix || '');
    }
    function price(v) { return QT.utils ? QT.utils.formatPrice(v) : (isFinite(v) ? String(v) : '—'); }
    function dash(v) { return (v === null || v === undefined || v === '') ? '—' : v; }

    function timeStr(ms) {
        if (!isFinite(ms)) return '—';
        return new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
    }

    function titleCase(id) {
        return String(id || '').replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2')
            .replace(/\w\S*/g, function (w) { return w.charAt(0).toUpperCase() + w.slice(1); });
    }

    /* ================================================================
     * Semantic tone system
     * ================================================================ */
    function toneForCode(code) {
        if (/STRONG_BUY/.test(code)) return { tone: 'bull', intensity: 'strong' };
        if (/^BUY$/.test(code)) return { tone: 'bull', intensity: 'base' };
        if (/WEAK_BUY/.test(code)) return { tone: 'bull', intensity: 'weak' };
        if (/STRONG_SELL/.test(code)) return { tone: 'bear', intensity: 'strong' };
        if (/^SELL$/.test(code)) return { tone: 'bear', intensity: 'base' };
        if (/WEAK_SELL/.test(code)) return { tone: 'bear', intensity: 'weak' };
        if (/NEUTRAL/.test(code)) return { tone: 'neutral', intensity: 'base' };
        return { tone: 'info', intensity: 'base' };   // non-directional outcomes
    }

    /**
     * Classifies an already-produced evidence/pattern NAME into a short badge
     * label. Pure text classification of strings the engine already generated
     * (identical in kind to `toneForCode` matching on `rec.recommendation.code`
     * before this redesign) — it invents no data, only shortens display text.
     */
    var BADGE_RULES = [
        [/change of character|choch/i, 'CHoCH'], [/break of structure|bos/i, 'BOS'],
        [/breaker block/i, 'BRK'], [/mitigation block/i, 'MIT'], [/order block/i, 'OB'],
        [/fair value gap/i, 'FVG'], [/liquidity sweep/i, 'SWEEP'],
        [/equal highs?/i, 'EQH'], [/equal lows?/i, 'EQL'],
        [/premium/i, 'PREM'], [/discount/i, 'DISC'],
        [/double top/i, 'DBL TOP'], [/double bottom/i, 'DBL BOT'],
        [/inverse head/i, 'IH&S'], [/head and shoulders/i, 'H&S'],
        [/ascending triangle/i, 'ASC TRI'], [/descending triangle/i, 'DESC TRI'],
        [/symmetrical triangle/i, 'SYM TRI'], [/rising wedge/i, 'RISE WDG'],
        [/falling wedge/i, 'FALL WDG'], [/bull flag/i, 'BULL FLAG'], [/bear flag/i, 'BEAR FLAG'],
        [/channel/i, 'CHANNEL'], [/rectangle/i, 'RANGE'],
        [/engulfing/i, 'ENGULF'], [/hammer/i, 'HAMMER'], [/shooting star/i, 'SHOOT STAR'],
        [/morning star/i, 'MORN STAR'], [/evening star/i, 'EVE STAR'],
        [/soldiers|crows/i, '3-BAR'], [/harami/i, 'HARAMI'],
        [/inside bar/i, 'INSIDE'], [/outside bar/i, 'OUTSIDE'], [/doji/i, 'DOJI'],
        [/swing structure|internal structure/i, 'SWING']
    ];
    function badgeFor(name) {
        for (var i = 0; i < BADGE_RULES.length; i++) if (BADGE_RULES[i][0].test(name)) return BADGE_RULES[i][1];
        return (String(name).split(/\s+/)[0] || '').slice(0, 8).toUpperCase() || 'EVT';
    }

    /* ================================================================
     * SVG ring gauge — pure presentation (stroke-dasharray geometry only)
     * ================================================================ */
    function ring(value01, opts) {
        opts = opts || {};
        var size = opts.size || 84;
        var stroke = opts.stroke || 8;
        var r = (size - stroke) / 2;
        var c = 2 * Math.PI * r;
        var v = clamp01(value01);
        var offset = c * (1 - v);

        var wrap = h('div', { class: 'qtw-ring' + (opts.dim ? ' qtw-ring-dim' : '') });
        var s = svg('svg', { viewBox: '0 0 ' + size + ' ' + size, width: size, height: size,
                             class: 'qtw-ring-svg', role: 'img',
                             'aria-label': (opts.label || 'value') + ' ' + Math.round(v * 100) + '%' });
        var track = svg('circle', { cx: size / 2, cy: size / 2, r: r, fill: 'none',
                                    stroke: 'var(--qtw-track)', 'stroke-width': stroke });
        var fill = svg('circle', {
            cx: size / 2, cy: size / 2, r: r, fill: 'none',
            stroke: 'var(--qtw-' + (opts.tone || 'ai') + ')', 'stroke-width': stroke,
            'stroke-linecap': 'round', 'stroke-dasharray': c.toFixed(2),
            'stroke-dashoffset': offset.toFixed(2),
            transform: 'rotate(-90 ' + size / 2 + ' ' + size / 2 + ')',
            class: 'qtw-ring-fill'
        });
        s.appendChild(track);
        s.appendChild(fill);
        wrap.appendChild(s);

        var center = h('div', { class: 'qtw-ring-center' });
        if (opts.centerText !== undefined) center.appendChild(h('span', { class: 'qtw-ring-value', text: opts.centerText }));
        if (opts.centerSub) center.appendChild(h('span', { class: 'qtw-ring-sub', text: opts.centerSub }));
        wrap.appendChild(center);
        return wrap;
    }

    /** Small labelled gauge used in the Market Health panel. */
    function gauge(label, value01, opts) {
        opts = opts || {};
        var unavailable = value01 === null || value01 === undefined || !isFinite(value01);
        var g = h('div', { class: 'qtw-gauge' + (unavailable ? ' qtw-gauge-na' : '') });
        g.appendChild(ring(unavailable ? 0 : value01, {
            size: 72, stroke: 7, tone: opts.tone || 'ai', dim: unavailable,
            centerText: unavailable ? '—' : Math.round(clamp01(value01) * 100),
            label: label
        }));
        g.appendChild(h('div', { class: 'qtw-gauge-label', text: label }));
        if (opts.sub) g.appendChild(h('div', { class: 'qtw-gauge-sub', text: opts.sub }));
        return g;
    }

    /* ================================================================
     * Bars
     * ================================================================ */

    /** Bidirectional bar for a signed value in [-1, 1], centred at zero. */
    function signedBar(score, tone) {
        var wrap = h('div', { class: 'qtw-sbar' });
        var track = h('div', { class: 'qtw-sbar-track' });
        var mid = h('div', { class: 'qtw-sbar-mid' });
        var fill = h('div', { class: 'qtw-sbar-fill qtw-tone-' + (score >= 0 ? 'bull' : 'bear') });
        var w = clamp01(Math.abs(score)) * 50;
        if (score >= 0) { fill.style.left = '50%'; fill.style.width = w + '%'; }
        else { fill.style.right = '50%'; fill.style.width = w + '%'; }
        track.appendChild(mid);
        track.appendChild(fill);
        wrap.appendChild(track);
        return wrap;
    }

    /** Unidirectional 0..1 bar (quality-style values). */
    function unsignedBar(value01, tone) {
        var wrap = h('div', { class: 'qtw-ubar' });
        var track = h('div', { class: 'qtw-ubar-track' });
        var fill = h('div', { class: 'qtw-ubar-fill qtw-tone-' + (tone || 'ai') });
        fill.style.width = (clamp01(value01) * 100).toFixed(1) + '%';
        track.appendChild(fill);
        wrap.appendChild(track);
        return wrap;
    }

    /* ================================================================
     * Structural sections
     * ================================================================ */
    function section(id, level, title, opts) {
        opts = opts || {};
        var cls = 'qtw-card qtw-lvl' + level + (opts.wide ? ' qtw-wide' : '') +
                  (opts.scope === 'analyst' ? ' qtw-analyst-only' : '');
        var d = h('details', { class: cls });
        if (opts.open !== false) d.open = true;
        var sum = h('summary', { class: 'qtw-card-head' }, [
            h('span', { class: 'qtw-card-badge', text: 'L' + level }),
            h('h3', { class: 'qtw-card-title', text: title }),
            opts.meta ? h('span', { class: 'qtw-card-meta', text: opts.meta }) : null,
            h('span', { class: 'qtw-card-caret', 'aria-hidden': 'true', text: '▾' })
        ]);
        d.appendChild(sum);
        var body = h('div', { class: 'qtw-card-body' });
        d.appendChild(body);
        d._body = body;
        d.dataset.section = id;
        return d;
    }

    function chip(label, tone, opts) {
        opts = opts || {};
        var c = h('span', { class: 'qtw-chip qtw-tone-' + (tone || 'neutral') + (opts.outline ? ' qtw-chip-o' : '') });
        if (opts.badge) c.appendChild(h('b', { class: 'qtw-chip-badge', text: opts.badge }));
        c.appendChild(text(label));
        if (opts.title) c.title = opts.title;
        return c;
    }

    function statusIcon(status) {
        // status: true=pass, false=fail, null=informational
        var cls = status === true ? 'pass' : status === false ? 'fail' : 'info';
        var glyph = status === true ? '✓' : status === false ? '✕' : 'ⓘ';
        return h('span', { class: 'qtw-status qtw-status-' + cls, 'aria-hidden': 'true', text: glyph });
    }

    /* ================================================================
     * 1. HERO
     * ================================================================ */
    function buildHero(rec, ctx) {
        var t = toneForCode(rec.recommendation.code);
        var hero = h('section', { class: 'qtw-hero qtw-tone-' + t.tone + ' qtw-int-' + t.intensity });

        var left = h('div', { class: 'qtw-hero-signal' });
        left.appendChild(h('div', { class: 'qtw-hero-icon', 'aria-hidden': 'true', text:
            t.tone === 'bull' ? '▲' : t.tone === 'bear' ? '▼' : t.tone === 'neutral' ? '●' : '■' }));
        var labelWrap = h('div', { class: 'qtw-hero-labelwrap' });
        labelWrap.appendChild(h('h2', { class: 'qtw-hero-label', text: rec.recommendation.label }));
        labelWrap.appendChild(h('div', { class: 'qtw-hero-sub' }, [
            chip(rec.profile.name, 'ai', { outline: true }),
            rec.recommendation.band ? chip(rec.recommendation.band.replace(/_/g, ' '), t.tone, { outline: true }) : null
        ]));
        // Trend line: direction + how long the trend has held (rec.trend.barsInState,
        // an existing engine field) + the analysis timeframe. Nothing computed here.
        var trTone = rec.trend.direction === 'bullish' ? 'bull'
            : rec.trend.direction === 'bearish' ? 'bear' : 'neutral';
        var trBars = rec.trend.barsInState;
        var trendText = titleCase(rec.trend.direction)
            + (isFinite(trBars) ? ' · active ' + trBars + ' candle' + (trBars === 1 ? '' : 's') : '')
            + (rec.timeframe ? ' · ' + rec.timeframe : '');
        labelWrap.appendChild(h('div', { class: 'qtw-hero-trend qtw-tone-' + trTone, text: trendText }));
        left.appendChild(labelWrap);
        hero.appendChild(left);

        var mid = h('div', { class: 'qtw-hero-ring' });
        mid.appendChild(ring(rec.confidence / 100, {
            size: 128, stroke: 11, tone: t.tone === 'info' || t.tone === 'neutral' ? 'ai' : t.tone,
            centerText: Math.round(rec.confidence) + '%', centerSub: 'Confidence', label: 'Confidence'
        }));
        if (rec.metrics.mtfConfidenceAdjustment) {
            mid.appendChild(chip(
                (rec.metrics.mtfConfidenceAdjustment > 0 ? '+' : '') + rec.metrics.mtfConfidenceAdjustment +
                ' pts (MTF)', rec.metrics.mtfConfidenceAdjustment > 0 ? 'bull' : 'bear', { outline: true }));
        }
        hero.appendChild(mid);

        var facts = h('div', { class: 'qtw-hero-facts' });
        function fact(label, value, tone2) {
            facts.appendChild(h('div', { class: 'qtw-fact' + (tone2 ? ' qtw-tone-' + tone2 : '') }, [
                h('span', { class: 'qtw-fact-label', text: label }),
                h('span', { class: 'qtw-fact-value', text: dash(value) })
            ]));
        }
        fact('Symbol', rec.symbol || '—');
        fact('Timeframe', rec.timeframe || '—');
        if (ctx && isFinite(ctx.price)) fact('Reference Price', price(ctx.price));
        fact('Regime', rec.regime.name);
        fact('Signal Quality', rec.metrics.tradeQuality !== null && rec.metrics.tradeQuality !== undefined
            ? pct(rec.metrics.tradeQuality * 100) : '—');
        fact('Execution Quality', rec.trade && rec.trade.entry ? pct(rec.trade.entry.quality * 100) : '—');
        hero.appendChild(facts);

        // Executive trade ladder — at-a-glance prices read from the SAME trade
        // object the Trade Setup card uses (no recomputation). The engine exposes
        // a single tiered stop (rec.trade.stop), not an SL1/2/3 ladder, so exactly
        // one Stop Loss is shown; targets are the real TP1..TP3. Degrades to just
        // the current price when there is no executable trade.
        var strip = h('div', { class: 'qtw-hero-strip' });
        function hs(label, value, tone2) {
            strip.appendChild(h('div', { class: 'qtw-hs-cell' + (tone2 ? ' qtw-tone-' + tone2 : '') }, [
                h('span', { class: 'qtw-hs-label', text: label }),
                h('span', { class: 'qtw-hs-value', text: value })
            ]));
        }
        if (ctx && isFinite(ctx.price)) hs('Current', price(ctx.price));
        if (rec.trade && rec.trade.entry) {
            hs('Entry', price(rec.trade.entry.price), 'ai');
            hs(rec.trade.stop.id || 'Stop', price(rec.trade.stop.price), 'bear');
            (rec.trade.targets || []).forEach(function (tp) { hs(tp.id, price(tp.price), 'bull'); });
        } else {
            strip.appendChild(h('div', { class: 'qtw-hs-note', text: 'No executable trade at current levels.' }));
        }
        hero.appendChild(strip);

        return hero;
    }

    /* ================================================================
     * Executive summary
     * ================================================================ */
    function buildSummary(rec) {
        var s = section('executive', 1, 'Executive Summary', { meta: null });
        s.classList.add('qtw-summary');
        s._body.appendChild(h('p', { class: 'qtw-exec', text: rec.explanations.executive }));
        var row = h('div', { class: 'qtw-exec-row' });
        row.appendChild(chip('Primary reason', 'neutral', { outline: true, title: rec.reasoning.primaryReason }));
        row.appendChild(h('span', { class: 'qtw-exec-note', text: rec.reasoning.primaryReason }));
        s._body.appendChild(row);
        if (rec.reasoning.limitingFactor && rec.reasoning.limitingFactor.factor !== 'none') {
            var lim = h('div', { class: 'qtw-exec-row' });
            lim.appendChild(chip('Limiting factor', 'warn', { outline: true }));
            lim.appendChild(h('span', { class: 'qtw-exec-note',
                text: titleCase(rec.reasoning.limitingFactor.factor) + ': ' + rec.reasoning.limitingFactor.detail }));
            s._body.appendChild(lim);
        }
        return s;
    }

    /* ================================================================
     * 2. Market Health panel
     * ================================================================ */
    function buildHealth(rec) {
        var s = section('health', 2, 'Market Health');
        var grid = h('div', { class: 'qtw-gauges' });
        var dims = rec.trend.dimensions || {};
        var riskQ = (rec.inspection.contributions || []).filter(function (c) { return c.id === 'riskQuality'; })[0];

        grid.appendChild(gauge('Trend Strength', rec.trend.strength,
            { tone: rec.trend.direction === 'bearish' ? 'bear' : rec.trend.direction === 'bullish' ? 'bull' : 'neutral' }));
        grid.appendChild(gauge('Momentum', dims.momentum ? dims.momentum.strength : null,
            { tone: dims.momentum && dims.momentum.direction === 'bearish' ? 'bear'
                   : dims.momentum && dims.momentum.direction === 'bullish' ? 'bull' : 'neutral' }));
        grid.appendChild(gauge('Volatility', dims.volatility ? dims.volatility.strength : null,
            { tone: 'info', sub: 'percentile' }));
        grid.appendChild(gauge('Regime Strength', rec.regime.confidence, { tone: 'ai' }));
        grid.appendChild(gauge('Trade Quality', rec.metrics.tradeQuality, { tone: 'ai' }));
        var capGauge = gauge('Capability Coverage', rec.capability.ratio, { tone: 'info' });
        capGauge.classList.add('qtw-analyst-only');   // data-coverage diagnostic, not a trading decision input
        grid.appendChild(capGauge);
        grid.appendChild(gauge('Confidence', rec.confidence / 100, { tone: 'ai' }));
        var riskGauge = gauge('Risk Quality', riskQ ? riskQ.score : null, { tone: 'warn' });
        riskGauge.classList.add('qtw-analyst-only');   // sub-component of Trade Quality, already reflected there
        grid.appendChild(riskGauge);

        s._body.appendChild(grid);
        return s;
    }

    /* ================================================================
     * 3. Trade Setup ticket (or graceful no-trade)
     * ================================================================ */
    function buildTrade(rec) {
        var tradeable = rec.trade && rec.trade.entry;
        var s = section('trade', 2, 'Trade Setup', {
            wide: true,
            meta: tradeable ? (rec.recommendation.direction === 'bullish' ? 'LONG' : 'SHORT') : 'NO TICKET'
        });

        if (!tradeable) {
            var none = h('div', { class: 'qtw-no-trade' });
            none.appendChild(h('div', { class: 'qtw-no-trade-icon', 'aria-hidden': 'true', text: '–' }));
            none.appendChild(h('strong', { text: 'No executable trade' }));
            none.appendChild(h('p', { text: rec.reasoning.primaryReason }));
            var blockers = (rec.tradeQualification.blockers || []);
            if (blockers.length) {
                var list = h('ul', { class: 'qtw-plainlist' });
                blockers.forEach(function (b) { list.appendChild(h('li', { text: b })); });
                none.appendChild(list);
            }
            s._body.appendChild(none);
            return s;
        }

        var t = rec.trade;
        var ticket = h('div', { class: 'qtw-ticket' });

        function cell(label, value, sub, tone2) {
            ticket.appendChild(h('div', { class: 'qtw-ticket-cell' + (tone2 ? ' qtw-tone-' + tone2 : '') }, [
                h('span', { class: 'qtw-ticket-label', text: label }),
                h('span', { class: 'qtw-ticket-value', text: value }),
                sub ? h('span', { class: 'qtw-ticket-sub', text: sub }) : null
            ]));
        }

        cell('Entry', price(t.entry.price), t.entry.name);
        cell('Stop Loss', price(t.stop.price),
            t.stop.id + ' · ' + num(t.stop.distanceAtr) + ' ATR · ' + t.stop.basis, 'bear');
        (t.targets || []).forEach(function (tp) {
            cell(tp.id, price(tp.price), 'R:R ' + num(tp.rr) + ' · ' + pct(tp.probability * 100) + ' prob', 'bull');
        });
        s._body.appendChild(ticket);

        var metrics = h('div', { class: 'qtw-metricrow' });
        var rr = t.riskReward;
        function m(label, value, tone2) {
            metrics.appendChild(h('div', { class: 'qtw-metric' + (tone2 ? ' qtw-tone-' + tone2 : '') }, [
                h('span', { class: 'qtw-metric-value', text: value }),
                h('span', { class: 'qtw-metric-label', text: label })
            ]));
        }
        m('R:R (final target)', num(rr.toFinalTarget) + (rr.meetsMinimum ? ' ✓' : ' ✕'),
            rr.meetsMinimum ? 'bull' : 'bear');
        m('Weighted R:R', num(rr.weighted));
        m('Expected Value', signed(rr.expectedValueR, 3, 'R'), rr.expectedValueR >= 0 ? 'bull' : 'bear');
        m('ATR', t.positionRisk ? num(t.positionRisk.volatilityExposure.atr, 5) : '—');
        m('Risk Distance', num(rr.riskDistanceAtr) + ' ATR (' + num(rr.riskDistancePct) + '%)');
        s._body.appendChild(metrics);

        // Levels: S/R, Fibonacci, Confluence — all already computed by qt-levels.
        if (t.levels) {
            var lv = h('div', { class: 'qtw-levels' });
            var sr = h('div', { class: 'qtw-level-col' });
            sr.appendChild(h('h4', { text: 'Support / Resistance' }));
            (t.levels.resistance || []).slice(0, 3).forEach(function (l) {
                sr.appendChild(chip('R ' + price(l.price) + ' (' + l.touches + '×)', 'bear', { outline: true }));
            });
            (t.levels.support || []).slice(0, 3).forEach(function (l) {
                sr.appendChild(chip('S ' + price(l.price) + ' (' + l.touches + '×)', 'bull', { outline: true }));
            });
            if (!(t.levels.resistance || []).length && !(t.levels.support || []).length) {
                sr.appendChild(h('span', { class: 'qtw-note', text: 'None identified within the lookback window.' }));
            }
            lv.appendChild(sr);

            if (t.levels.fibonacci) {
                var fib = h('div', { class: 'qtw-level-col' });
                fib.appendChild(h('h4', { text: 'Fibonacci (' + t.levels.fibonacci.direction + ' leg)' }));
                if (t.levels.fibonacci.currentRetracement !== null && isFinite(t.levels.fibonacci.currentRetracement)) {
                    fib.appendChild(chip(pct(t.levels.fibonacci.currentRetracement * 100) + ' retracement',
                        'ai', { outline: true }));
                }
                (t.levels.fibonacci.levels || []).filter(function (l) { return l.inGoldenZone; }).forEach(function (l) {
                    fib.appendChild(chip(l.label + ' (golden zone)', 'ai'));
                });
                lv.appendChild(fib);
            }
            if (t.levels.confluence && t.levels.confluence.length) {
                var cf = h('div', { class: 'qtw-level-col' });
                cf.appendChild(h('h4', { text: 'Confluence' }));
                t.levels.confluence.slice(0, 3).forEach(function (c) {
                    cf.appendChild(chip(price(c.price) + ' · ' + c.kind, 'ai', { title: c.evidence[0] }));
                });
                lv.appendChild(cf);
            }
            s._body.appendChild(lv);
        }

        s._body.appendChild(h('p', { class: 'qtw-note',
            text: 'Position sizing and capital allocation are intentionally outside this engine.' }));
        return s;
    }

    /* ================================================================
     * 4. Market Structure timeline
     * ================================================================ */
    function buildStructure(rec) {
        var s = section('structure', 2, 'Market Structure', { wide: true, scope: 'analyst',
            meta: rec.inspection.structureSummary.bias });
        var st = rec.inspection.structureSummary;

        if (st.labelledSwings && st.labelledSwings.length) {
            var tl = h('div', { class: 'qtw-timeline' });
            st.labelledSwings.forEach(function (sw) {
                if (!sw.label) return;
                var bull = sw.label === 'HH' || sw.label === 'HL';
                tl.appendChild(h('div', { class: 'qtw-tl-node qtw-tone-' + (bull ? 'bull' : 'bear') }, [
                    h('span', { class: 'qtw-tl-badge', text: sw.label }),
                    h('span', { class: 'qtw-tl-price', text: price(sw.price) })
                ]));
            });
            s._body.appendChild(tl);
        }

        var eventCloud = h('div', { class: 'qtw-eventcloud' });
        var seen = {};
        (rec.evidence.supporting || []).concat(rec.evidence.opposing || []).forEach(function (e) {
            if (e.source !== 'structure' && e.source !== 'pattern') return;
            var key = e.source + ':' + e.detail;
            if (seen[key]) return;
            seen[key] = true;
            var isSupporting = (rec.evidence.supporting || []).indexOf(e) !== -1;
            eventCloud.appendChild(chip(e.detail, isSupporting ? 'bull' : 'bear',
                { badge: badgeFor(e.detail), title: e.detail }));
        });
        if (eventCloud.children.length) {
            s._body.appendChild(h('h4', { class: 'qtw-subhead', text: 'Structure & SMC Events' }));
            s._body.appendChild(eventCloud);
        } else {
            s._body.appendChild(h('p', { class: 'qtw-note', text: 'No qualifying structural events in range.' }));
        }
        return s;
    }

    /* ================================================================
     * 5. Score breakdown
     * ================================================================ */
    function buildScores(rec) {
        var s = section('scores', 2, 'Score Breakdown', { wide: true, scope: 'analyst' });
        var list = h('div', { class: 'qtw-barlist' });
        (rec.inspection.contributions || []).forEach(function (c) {
            var row = h('div', { class: 'qtw-barrow' });
            row.appendChild(h('span', { class: 'qtw-barrow-label', text: titleCase(c.id) }));
            row.appendChild(c.kind === 'directional' ? signedBar(c.score) : unsignedBar(c.score, 'ai'));
            row.appendChild(h('span', { class: 'qtw-barrow-value ' +
                (c.kind === 'directional' ? (c.contribution >= 0 ? 'qtw-tone-bull' : 'qtw-tone-bear') : ''),
                text: (c.kind === 'directional' ? signed(c.contribution, 3) : num(c.contribution, 3)) }));
            list.appendChild(row);
        });
        s._body.appendChild(list);
        if ((rec.inspection.excluded || []).length) {
            var ex = h('div', { class: 'qtw-excluded' });
            ex.appendChild(h('span', { class: 'qtw-note', text: 'Excluded: ' }));
            rec.inspection.excluded.forEach(function (e) {
                ex.appendChild(chip(titleCase(e.id), 'neutral', { outline: true, title: e.reason }));
            });
            s._body.appendChild(ex);
        }
        return s;
    }

    /* ================================================================
     * 6. Confidence breakdown
     * ================================================================ */
    function buildConfidence(rec) {
        var s = section('confidence', 2, 'Confidence Breakdown', { scope: 'analyst' });
        var body = s._body;

        function row(label, value01, tone2) {
            var r = h('div', { class: 'qtw-barrow' });
            r.appendChild(h('span', { class: 'qtw-barrow-label', text: label }));
            r.appendChild(unsignedBar(value01, tone2));
            r.appendChild(h('span', { class: 'qtw-barrow-value', text: pct(clamp01(value01) * 100) }));
            body.appendChild(r);
        }
        row('Timeframe Agreement', rec.metrics.agreement, 'ai');
        row('Evidence Quality', rec.metrics.qualityScore, 'ai');
        row('Data Coverage', rec.metrics.capabilityRatio, 'info');

        if (rec.metrics.mtfConfidenceAdjustment) {
            var delta = h('div', { class: 'qtw-deltarow' });
            delta.appendChild(h('span', { text: 'Before MTF: ' + pct(rec.metrics.confidenceBeforeMtf) }));
            delta.appendChild(chip(signed(rec.metrics.mtfConfidenceAdjustment, 0, ' pts'),
                rec.metrics.mtfConfidenceAdjustment > 0 ? 'bull' : 'bear'));
            delta.appendChild(h('span', { text: 'After: ' + pct(rec.confidence) }));
            body.appendChild(delta);
        }
        return s;
    }

    /* ================================================================
     * 7. Supporting vs Opposing evidence
     * ================================================================ */
    function buildEvidence(rec) {
        var s = section('evidence', 2, 'Evidence', { wide: true });
        var cols = h('div', { class: 'qtw-evidence-cols' });

        function col(title, items, tone2) {
            var c = h('div', { class: 'qtw-evidence-col' });
            c.appendChild(h('h4', { class: 'qtw-tone-' + tone2, text: title + ' (' + items.length + ')' }));
            var wrap = h('div', { class: 'qtw-chipwrap' });
            items.slice(0, 10).forEach(function (e) {
                wrap.appendChild(chip(e.detail, tone2, { title: titleCase(e.source) }));
            });
            if (!items.length) wrap.appendChild(h('p', { class: 'qtw-note', text: 'None recorded.' }));
            c.appendChild(wrap);
            return c;
        }
        cols.appendChild(col('Supporting', rec.evidence.supporting || [], 'bull'));
        cols.appendChild(col('Opposing', rec.evidence.opposing || [], 'bear'));
        s._body.appendChild(cols);
        return s;
    }

    /* ================================================================
     * 8. Qualification gates
     * ================================================================ */
    function buildGates(rec) {
        var s = section('gates', 2, 'Qualification Gates', { wide: true,
            meta: rec.tradeQualification.gates.passed ? 'PASSED' : 'BLOCKED' });
        var body = s._body;
        var gateCount = 0, passCount = 0, failedIds = [];

        function tierBlock(stageLabel, stage) {
            if (!stage || stage.skipped) {
                body.appendChild(h('p', { class: 'qtw-note', text: stageLabel + ': ' + (stage ? stage.skipped : 'not evaluated') }));
                return;
            }
            ['hard', 'configurable', 'informational'].forEach(function (tier) {
                (stage[tier] || []).forEach(function (g) {
                    var row = h('div', { class: 'qtw-gaterow' });
                    row.appendChild(statusIcon(g.passed));
                    row.appendChild(h('span', { class: 'qtw-gate-tier', text: tier }));
                    row.appendChild(h('span', { class: 'qtw-gate-id', text: titleCase(g.id) }));
                    if ('value' in g && g.value !== undefined) {
                        row.appendChild(h('span', { class: 'qtw-gate-vt', text:
                            num(g.value, 2) + (g.threshold !== undefined ? ' / ' + num(g.threshold, 2) : '') }));
                    }
                    if (g.message) {
                        row.appendChild(h('span', { class: 'qtw-gate-msg', text: g.message }));
                    }
                    // Trader Mode: a cleanly-passing gate or an informational metric (already
                    // surfaced in the Trade Setup ticket — R:R, EV) adds no decision value here.
                    // Anything not definitively passing stays visible in both modes.
                    if (tier === 'informational' || g.passed === true) row.classList.add('qtw-analyst-only');
                    if (tier !== 'informational') {
                        gateCount++;
                        if (g.passed) passCount++; else failedIds.push(titleCase(g.id));
                    }
                    body.appendChild(row);
                });
            });
        }
        tierBlock('Pre-construction', rec.tradeQualification.gates.pre);
        tierBlock('Post-construction', rec.tradeQualification.gates.post);

        var summaryText = gateCount === 0 ? 'No gates were evaluated.'
            : failedIds.length === 0 ? ('All ' + gateCount + ' qualification gates passed.')
            : (passCount + ' of ' + gateCount + ' gates passed — failing: ' + failedIds.join(', ') + '.');
        body.insertBefore(h('p', { class: 'qtw-note qtw-trader-only', text: summaryText }), body.firstChild);
        return s;
    }

    /* ================================================================
     * MTF decision panel
     * ================================================================ */
    function buildMtf(rec) {
        var m = rec.mtf;
        var s = section('mtf', 2, 'Multi-Timeframe Consensus', { meta: titleCase(m.action) });
        var body = s._body;
        body.appendChild(h('p', { class: 'qtw-exec-note', text: m.reason }));
        if (m.consensus) {
            var c = m.consensus;
            var facts = h('div', { class: 'qtw-mtf-facts' });
            [['Direction', titleCase(c.direction)], ['Agreement', pct(c.agreement * 100)],
             ['Dominant TF', c.dominantTimeframe || '—'],
             ['Conflicting', (c.conflictingTimeframes || []).join(', ') || 'none'],
             ['Consensus Confidence', pct(c.consensusConfidence * 100)]].forEach(function (p) {
                facts.appendChild(h('div', { class: 'qtw-fact' }, [
                    h('span', { class: 'qtw-fact-label', text: p[0] }),
                    h('span', { class: 'qtw-fact-value', text: p[1] })
                ]));
            });
            body.appendChild(facts);
        }
        if (m.bandChange) {
            body.appendChild(chip('Band adjusted: ' + m.bandChange.from + ' → ' + m.bandChange.to, 'warn'));
        }
        if (m.warning) body.appendChild(h('p', { class: 'qtw-note', text: m.warning }));
        return s;
    }

    /* ================================================================
     * 9. Warnings
     * ================================================================ */
    function buildWarnings(rec) {
        if (!rec.warnings || !rec.warnings.length) return null;
        var groups = {};
        rec.warnings.forEach(function (w) { (groups[w.source] = groups[w.source] || []).push(w.message); });

        var s = section('warnings', 3, 'Warnings', { meta: String(rec.warnings.length) });
        s.classList.add('qtw-warncard');
        Object.keys(groups).forEach(function (src) {
            var g = h('div', { class: 'qtw-warngroup' });
            g.appendChild(h('span', { class: 'qtw-warngroup-title', text: titleCase(src) }));
            var list = h('ul', { class: 'qtw-plainlist' });
            groups[src].forEach(function (msg) { list.appendChild(h('li', { text: msg })); });
            g.appendChild(list);
            s._body.appendChild(g);
        });
        return s;
    }

    /* ================================================================
     * 10. Technical Details (deep dive, closed by default)
     * ================================================================ */
    function buildTechnical(rec) {
        var s = section('technical', 4, 'Technical Details', { open: false, scope: 'analyst' });
        var body = s._body;

        body.appendChild(h('h4', { class: 'qtw-subhead', text: 'Category contributions' }));
        var table = h('table', { class: 'qtw-table' });
        var thead = h('thead', {}, [h('tr', {}, ['Category', 'Kind', 'Score', 'Weight', 'Contribution']
            .map(function (t2) { return h('th', { text: t2 }); }))]);
        table.appendChild(thead);
        var tbody = h('tbody');
        (rec.inspection.contributions || []).forEach(function (c) {
            tbody.appendChild(h('tr', {}, [
                h('td', { text: titleCase(c.id) }), h('td', { text: c.kind }),
                h('td', { class: 'qtw-numeric', text: num(c.score, 3) }),
                h('td', { class: 'qtw-numeric', text: num(c.normalizedWeight, 3) }),
                h('td', { class: 'qtw-numeric ' + (c.contribution >= 0 ? 'qtw-tone-bull' : 'qtw-tone-bear'),
                          text: signed(c.contribution, 3) })
            ]));
        });
        table.appendChild(tbody);
        body.appendChild(table);

        body.appendChild(h('h4', { class: 'qtw-subhead', text: 'Capability summary' }));
        body.appendChild(h('p', { text: 'Coverage: ' + pct(rec.capability.ratio * 100) +
            (rec.capability.excluded.length ? ' · Excluded: ' + rec.capability.excluded.join(', ') : '') }));
        body.appendChild(h('p', { class: 'qtw-note', text: rec.capability.note }));

        if (rec.regime.rejected && rec.regime.rejected.length) {
            body.appendChild(h('h4', { class: 'qtw-subhead', text: 'Rejected regime alternatives' }));
            var rl = h('ul', { class: 'qtw-plainlist' });
            rec.regime.rejected.slice(0, 5).forEach(function (r) {
                rl.appendChild(h('li', { text: r.name + ' — ' + r.reason }));
            });
            body.appendChild(rl);
        }

        body.appendChild(h('h4', { class: 'qtw-subhead', text: 'Engine trace' }));
        body.appendChild(h('pre', { class: 'qtw-pre', text: rec.explanations.technical }));

        body.appendChild(h('h4', { class: 'qtw-subhead', text: 'Architecture assumptions' }));
        var al = h('ul', { class: 'qtw-plainlist' });
        rec.assumptions.forEach(function (a) { al.appendChild(h('li', { text: a })); });
        body.appendChild(al);

        if (rec.consistency && (!rec.consistency.valid || rec.consistency.issueCount)) {
            body.appendChild(h('h4', { class: 'qtw-subhead qtw-tone-warn', text: 'Consistency issues' }));
            var il = h('ul', { class: 'qtw-plainlist' });
            rec.consistency.issues.forEach(function (i) {
                il.appendChild(h('li', { text: '[' + i.severity + '] ' + i.message }));
            });
            body.appendChild(il);
            body.appendChild(h('p', { class: 'qtw-note', text: rec.consistency.note }));
        }
        return s;
    }

    /* ================================================================
     * 11. Engine Inspection (developer / diagnostic mode)
     * ================================================================ */
    function buildInspection(rec) {
        var s = section('inspection', 5, 'Engine Inspection', { open: false, scope: 'analyst', meta: 'developer' });
        var body = s._body;

        var meta = h('div', { class: 'qtw-inspect-meta' });
        [['Engine version', rec.engineVersion], ['Config version', rec.configVersion],
         ['Generated at', timeStr(rec.generatedAt)], ['Bar time', timeStr(rec.barTime)],
         ['Profile', rec.profile.id + (rec.profile.description ? ' — ' + rec.profile.description : '')]
        ].forEach(function (p) {
            meta.appendChild(h('div', { class: 'qtw-fact' }, [
                h('span', { class: 'qtw-fact-label', text: p[0] }),
                h('span', { class: 'qtw-fact-value', text: dash(p[1]) })
            ]));
        });
        body.appendChild(meta);

        body.appendChild(h('h4', { class: 'qtw-subhead', text: 'Raw inspection payload' }));
        body.appendChild(h('pre', { class: 'qtw-pre', text: JSON.stringify({
            patternSummary: rec.inspection.patternSummary,
            structureSummary: rec.inspection.structureSummary,
            detectorDiagnostics: rec.inspection.detectorDiagnostics,
            trendDimensions: rec.inspection.trendDimensions,
            profileAdjustments: rec.inspection.profileAdjustments
        }, null, 2) }));
        return s;
    }

    /* ================================================================
     * Render
     * ================================================================ */

    /**
     * @param {HTMLElement} container
     * @param {Object} rec       the recommendation object from Phase 7 — read verbatim
     * @param {Object} [context] OPTIONAL, presentation-only: { price, priceTime }
     */
    CARD.render = function (container, rec, context) {
        container.innerHTML = '';
        if (!rec) { container.appendChild(h('div', { class: 'qtw-empty', text: 'No analysis yet.' })); return null; }

        var root = h('div', { class: 'qtw' });
        root.setAttribute('data-mode', CARD.getMode());
        root.appendChild(buildHero(rec, context));
        // Trade Setup is promoted directly beneath the hero — the executable
        // ticket is the highest-value block, so it leads the page (full-width,
        // above the Executive Summary and the analysis grid).
        root.appendChild(buildTrade(rec));
        root.appendChild(buildSummary(rec));

        var grid = h('div', { class: 'qtw-grid' });
        grid.appendChild(buildHealth(rec));
        grid.appendChild(buildStructure(rec));
        grid.appendChild(buildScores(rec));
        grid.appendChild(buildConfidence(rec));
        grid.appendChild(buildEvidence(rec));
        grid.appendChild(buildGates(rec));
        grid.appendChild(buildMtf(rec));
        root.appendChild(grid);

        var warn = buildWarnings(rec);
        if (warn) root.appendChild(warn);

        root.appendChild(buildTechnical(rec));
        root.appendChild(buildInspection(rec));

        var foot = h('footer', { class: 'qtw-foot' }, [
            h('span', { text: 'Engine v' + rec.engineVersion + ' · Config v' + rec.configVersion }),
            h('span', { text: 'Educational analysis only — not financial advice.' })
        ]);
        root.appendChild(foot);

        container.appendChild(root);
        return root;
    };

    /** Renders a transient status message (loading / error) without analysis. */
    CARD.renderStatus = function (container, kind, message, detail) {
        container.innerHTML = '';
        var box = h('div', { class: 'qtw-status-box qtw-status-' + kind }, [
            h('strong', { text: message }),
            detail ? h('p', { class: 'qtw-note', text: detail }) : null
        ]);
        container.appendChild(box);
        return box;
    };

    QT.card = CARD;

})(typeof globalThis !== 'undefined' ? globalThis : this);
