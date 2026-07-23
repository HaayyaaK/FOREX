/**
 * qt-sentiment.js — News sentiment scoring.
 *
 * Converts headlines into a bounded quantitative score. Per the research
 * synthesis, sentiment is a CONFIDENCE MODIFIER ONLY: it can never create or
 * flip a directional call, and the scoring engine additionally hard-caps its
 * contribution (config.sentiment.maxDirectionalScore).
 *
 * Method: lexicon matching with negation handling and intensifier weighting,
 * combined with exponential recency decay. Deterministic — the same articles
 * always yield the same score. `now` is injected, never read from the clock.
 */
(function (root) {
    'use strict';

    var QT = root.QT = root.QT || {};
    var U = QT.utils;

    var SENT = {};

    function tokenize(text) {
        return String(text || '').toLowerCase()
            .replace(/[^a-z0-9\s\-]/g, ' ')
            .split(/\s+/).filter(Boolean);
    }

    /**
     * Scores one piece of text in [-1, 1].
     * A negator within `negationWindow` tokens before a hit inverts that hit.
     */
    function scoreText(text, lex, negationWindow) {
        var tokens = tokenize(text);
        var joined = ' ' + tokens.join(' ') + ' ';
        var hits = 0, total = 0;

        function countPhrase(phrase, polarity) {
            if (phrase.indexOf(' ') !== -1) {
                var idx = joined.indexOf(' ' + phrase + ' ');
                while (idx !== -1) {
                    total += polarity; hits++;
                    idx = joined.indexOf(' ' + phrase + ' ', idx + 1);
                }
            }
        }

        for (var i = 0; i < tokens.length; i++) {
            var tok = tokens[i];
            var polarity = 0;
            if (lex.bullish.indexOf(tok) !== -1) polarity = 1;
            else if (lex.bearish.indexOf(tok) !== -1) polarity = -1;
            if (!polarity) continue;

            // Negation flips polarity.
            for (var b = Math.max(0, i - negationWindow); b < i; b++) {
                if (lex.negators.indexOf(tokens[b]) !== -1) { polarity = -polarity; break; }
            }
            // Intensifier immediately before amplifies.
            var weight = 1;
            if (i > 0 && lex.intensifiers.indexOf(tokens[i - 1]) !== -1) weight = 1.5;

            total += polarity * weight;
            hits++;
        }

        lex.bullish.forEach(function (p) { countPhrase(p, 1); });
        lex.bearish.forEach(function (p) { countPhrase(p, -1); });

        if (!hits) return { score: 0, hits: 0 };
        return { score: U.clamp(total / Math.max(hits, 1), -1, 1), hits: hits };
    }

    /**
     * @param {Array} articles [{ title, description, publishedAt }]
     * @param {Object} cfg
     * @param {number} [now]  reference time for recency decay; defaults to the
     *                        newest article so the result stays deterministic.
     */
    SENT.analyze = function (articles, cfg, now) {
        cfg = cfg || QT.CONFIG;
        var s = cfg.sentiment;

        if (!s.enabled) {
            return { available: false, reason: 'sentiment disabled in configuration',
                     score: 0, confidence: 0, articleCount: 0, evidence: [] };
        }
        if (!Array.isArray(articles) || articles.length === 0) {
            return { available: false, reason: 'no news articles available',
                     score: 0, confidence: 0, articleCount: 0, evidence: [] };
        }
        if (articles.length < s.minArticles) {
            return { available: false,
                     reason: 'only ' + articles.length + ' article(s); ' + s.minArticles + ' required',
                     score: 0, confidence: 0, articleCount: articles.length, evidence: [] };
        }

        var reference = U.isFiniteNumber(now) ? now : articles.reduce(function (max, a) {
            return Math.max(max, U.isFiniteNumber(a.publishedAt) ? a.publishedAt : 0);
        }, 0);

        var halfLifeMs = s.recencyHalfLifeHours * 3600000;
        var weightedSum = 0, weightTotal = 0, scored = 0;
        var bullish = 0, bearish = 0, neutral = 0;
        var samples = [];

        articles.forEach(function (a) {
            var r = scoreText((a.title || '') + '. ' + (a.description || ''),
                              s.lexicon, s.negationWindow || 3);
            if (r.hits === 0) { neutral++; return; }
            scored++;
            if (r.score > s.neutralBand) bullish++;
            else if (r.score < -s.neutralBand) bearish++;
            else neutral++;

            var ageMs = Math.max(0, reference - (U.isFiniteNumber(a.publishedAt) ? a.publishedAt : reference));
            var recency = Math.pow(0.5, ageMs / halfLifeMs);
            weightedSum += r.score * recency;
            weightTotal += recency;

            if (samples.length < 5 && Math.abs(r.score) > s.neutralBand) {
                samples.push((r.score > 0 ? 'bullish' : 'bearish') + ': "' +
                             String(a.title).slice(0, 90) + '"');
            }
        });

        if (scored === 0) {
            return { available: false, reason: 'no sentiment-bearing language found in the headlines',
                     score: 0, confidence: 0, articleCount: articles.length, evidence: [] };
        }

        var score = weightTotal > U.EPS ? weightedSum / weightTotal : 0;
        // Confidence grows with sample size and with agreement among articles.
        var coverage = U.clamp(scored / Math.max(articles.length, 1), 0, 1);
        var dominant = Math.max(bullish, bearish);
        var agreement = scored ? dominant / scored : 0;
        var confidence = U.clamp(0.3 * coverage + 0.7 * agreement, 0, 1);

        return {
            available: true,
            score: U.clamp(score, -1, 1),
            confidence: confidence,
            articleCount: articles.length,
            scoredCount: scored,
            distribution: { bullish: bullish, bearish: bearish, neutral: neutral },
            evidence: samples.concat([
                scored + ' of ' + articles.length + ' articles carried sentiment language',
                bullish + ' bullish / ' + bearish + ' bearish / ' + neutral + ' neutral'
            ]),
            note: 'Sentiment modifies confidence only; it can never create or flip a directional call.'
        };
    };

    QT.sentiment = SENT;

})(typeof globalThis !== 'undefined' ? globalThis : this);

if (typeof module !== 'undefined' && module.exports) {
    module.exports = (typeof globalThis !== 'undefined' ? globalThis : this).QT.sentiment;
}
