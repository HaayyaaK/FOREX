/**
 * qt-recommendation.js — Phase 7: Recommendation Engine.
 *
 * The orchestration and decision layer. It performs NO market analysis: every
 * field it emits is derived from the structured outputs of Phases 1–6.
 *
 * ── TIMESTAMP AND DETERMINISM ────────────────────────────────────────────────
 * The recommendation object must carry a timestamp, but reading the wall clock
 * inside the analysis path would break the determinism guarantee that every
 * earlier phase upholds. Resolution: `generatedAt` is INJECTED by the caller and
 * defaults to the last completed bar's time. It is metadata only — no
 * calculation reads it — so identical inputs still yield identical output.
 *
 * ── BAND STABILITY ───────────────────────────────────────────────────────────
 * Because the analyzer is stateless per run, cross-run hysteresis is impossible
 * without persisting state. Instead the engine applies BAND-EDGE DAMPING: when
 * the composite score sits within `bandEdgeMargin` of a boundary, the stronger
 * band is only claimed if confidence clears `bandEdgeConfidence`. Otherwise the
 * weaker band is reported. This is deterministic, configurable, and removes the
 * flip-flopping that a bare threshold produces near a boundary.
 */
(function (root) {
    'use strict';

    var QT = root.QT = root.QT || {};
    var U = QT.utils;

    var ENGINE_VERSION = '1.0.0';

    /** Directional recommendation bands, strongest-first. */
    var BANDS = [
        { code: 'STRONG_BUY',  label: 'Strong Buy',  direction: 'bullish', min:  0.55, strength: 1.00 },
        { code: 'BUY',         label: 'Buy',         direction: 'bullish', min:  0.28, strength: 0.70 },
        { code: 'WEAK_BUY',    label: 'Weak Buy',    direction: 'bullish', min:  0.10, strength: 0.40 },
        { code: 'NEUTRAL',     label: 'Neutral',     direction: 'neutral', min: -0.10, strength: 0.00 },
        { code: 'WEAK_SELL',   label: 'Weak Sell',   direction: 'bearish', min: -0.28, strength: 0.40 },
        { code: 'SELL',        label: 'Sell',        direction: 'bearish', min: -0.55, strength: 0.70 },
        { code: 'STRONG_SELL', label: 'Strong Sell', direction: 'bearish', min: -1.01, strength: 1.00 }
    ];

    /** Non-directional outcomes — first-class recommendations, not error states. */
    var OUTCOMES = {
        NO_TRADE:                  { code: 'NO_TRADE', label: 'No Trade', direction: 'none' },
        LOW_CONFIDENCE:            { code: 'LOW_CONFIDENCE', label: 'Low Confidence', direction: 'none' },
        INSUFFICIENT_CONFIRMATION: { code: 'INSUFFICIENT_CONFIRMATION', label: 'Insufficient Confirmation', direction: 'none' },
        HIGH_RISK:                 { code: 'HIGH_RISK', label: 'High Risk', direction: 'none' },
        WAITING_FOR_CONFIRMATION:  { code: 'WAITING_FOR_CONFIRMATION', label: 'Waiting for Confirmation', direction: 'none' },
        DATA_INSUFFICIENT:         { code: 'DATA_INSUFFICIENT', label: 'Data Insufficient', direction: 'none' }
    };

    var REC = {};
    REC.ENGINE_VERSION = ENGINE_VERSION;
    REC.BANDS = BANDS;
    REC.OUTCOMES = OUTCOMES;

    /**
     * Resolves the directional band with edge damping.
     * Returns { band, damped, reason }.
     */
    REC.resolveBand = function (score, confidence01, cfg) {
        var r = cfg.recommendation;
        var idx = 0;
        for (var i = 0; i < BANDS.length; i++) {
            if (score >= BANDS[i].min) { idx = i; break; }
            idx = i;
        }
        var band = BANDS[idx];

        // Distance to the boundary that would demote this band one step.
        var demoteTo = null, damped = false, reason = null;
        if (band.direction === 'bullish' && idx + 1 < BANDS.length) {
            var edge = band.min;
            if (score - edge <= r.bandEdgeMargin && confidence01 < r.bandEdgeConfidence) {
                demoteTo = BANDS[idx + 1];
            }
        } else if (band.direction === 'bearish' && idx > 0) {
            // For bearish bands the "stronger" direction is more negative.
            var upper = BANDS[idx - 1].min;
            if (upper - score <= r.bandEdgeMargin && confidence01 < r.bandEdgeConfidence) {
                demoteTo = BANDS[idx - 1];
            }
        }

        if (demoteTo && demoteTo.code !== band.code) {
            reason = 'score ' + score.toFixed(3) + ' sits within ' + r.bandEdgeMargin +
                     ' of the ' + band.label + ' boundary and confidence ' +
                     (confidence01 * 100).toFixed(0) + '% is below the ' +
                     (r.bandEdgeConfidence * 100).toFixed(0) + '% required to claim it';
            damped = true;
            band = demoteTo;
        }
        return { band: band, damped: damped, dampingReason: reason };
    };

    /* ================================================================
     * MULTI-TIMEFRAME CONSENSUS ARBITRATION
     *
     * Consensus is a strategic decision layer, not another score. It is never
     * summed or multiplied into the composite. Instead it inspects the proposed
     * band and decides one of five actions:
     *
     *   NONE       consensus agrees, or is too thin to act on — no change
     *   STRENGTHEN full agreement in the same direction — confidence raised
     *   WEAKEN     fractured or neutral consensus — confidence reduced
     *   DEMOTE     opposing consensus below the block threshold — band steps down
     *   BLOCK      opposing consensus with sufficient confidence — no directional call
     *
     * Rules are evaluated in order and the first match wins. Every outcome is
     * reported, including NONE, together with the rule that produced it.
     * ================================================================ */
    var MTF_ACTION = {
        NONE: 'none', STRENGTHEN: 'strengthen', WEAKEN: 'weaken',
        DEMOTE: 'demote', BLOCK: 'block', NOT_EVALUATED: 'not_evaluated'
    };
    REC.MTF_ACTION = MTF_ACTION;

    /**
     * @param {Object|null} consensus  QT.trend.consensus() output
     * @param {Object|null} band       the proposed directional band (null if already non-directional)
     * @param {Object} cfg
     */
    REC.arbitrateConsensus = function (consensus, band, cfg) {
        var m = cfg.mtf;
        var rules = [];

        function result(action, ruleId, reason, extra) {
            return Object.assign({
                evaluated: action !== MTF_ACTION.NOT_EVALUATED,
                action: action,
                rule: ruleId,
                reason: reason,
                confidenceAdjustment: 0,
                bandChange: null,
                blocked: action === MTF_ACTION.BLOCK,
                rulesConsidered: rules,
                evaluation: consensus ? {
                    direction: consensus.direction,
                    agreement: consensus.agreement,
                    dominantTimeframe: consensus.dominant,
                    conflictingTimeframes: consensus.conflicting || [],
                    consensusConfidence: consensus.confidence,
                    consensusStrength: consensus.strength,
                    quality: consensus.quality,
                    conflicted: !!consensus.conflicted,
                    perTimeframe: consensus.perTimeframe || {},
                    rulesApplied: consensus.rulesApplied || []
                } : null
            }, extra || {});
        }

        /* M0 — consensus unavailable. Reported, never silently skipped. */
        if (!consensus) {
            rules.push('M0: no consensus supplied');
            return result(MTF_ACTION.NOT_EVALUATED, 'M0',
                'Multi-timeframe consensus was not supplied to the recommendation engine, ' +
                'so no cross-timeframe arbitration was performed.');
        }

        /* M1 — consensus too thin to act on in either direction. */
        if (consensus.quality < m.minQuality || consensus.confidence < m.minConsensusConfidence) {
            rules.push('M1: consensus below actionable quality/confidence');
            return result(MTF_ACTION.NONE, 'M1',
                'Consensus quality ' + consensus.quality.toFixed(2) + ' / confidence ' +
                consensus.confidence.toFixed(2) + ' is below the actionable threshold (' +
                m.minQuality + ' / ' + m.minConsensusConfidence + '), so it neither ' +
                'strengthens nor weakens the recommendation.');
        }

        /* Nothing directional to arbitrate. */
        if (!band || band.direction === 'neutral') {
            rules.push('M2: recommendation is not directional');
            return result(MTF_ACTION.NONE, 'M2',
                'The recommendation is non-directional, so cross-timeframe agreement ' +
                'cannot strengthen or oppose it.');
        }

        var agrees = consensus.direction === band.direction;
        var opposes = consensus.direction !== 'neutral' && consensus.direction !== band.direction;

        /* M3 — opposing consensus. Block or demote. */
        if (opposes) {
            rules.push('M3: consensus opposes the proposed direction');
            if (m.blockOnOpposition && consensus.confidence >= m.oppositionBlockConfidence) {
                return result(MTF_ACTION.BLOCK, 'M3a',
                    'Higher-timeframe consensus is ' + consensus.direction + ' while the ' +
                    'recommendation would be ' + band.direction + '. Consensus confidence ' +
                    consensus.confidence.toFixed(2) + ' meets the blocking threshold ' +
                    m.oppositionBlockConfidence + ', so no directional call is issued. ' +
                    'Conflicting timeframes: ' + ((consensus.conflicting || []).join(', ') || 'none') + '.',
                    { confidenceAdjustment: -m.opposeConfidencePenalty });
            }
            return result(MTF_ACTION.DEMOTE, 'M3b',
                'Higher-timeframe consensus is ' + consensus.direction + ', opposing the ' +
                band.direction + ' recommendation, but consensus confidence ' +
                consensus.confidence.toFixed(2) + ' is below the blocking threshold ' +
                m.oppositionBlockConfidence + '. The recommendation is demoted one band ' +
                'and confidence reduced.',
                { confidenceAdjustment: -m.opposeConfidencePenalty });
        }

        /* M4 — consensus neutral or fractured. */
        if (!agrees || consensus.agreement < m.weakAgreement || consensus.conflicted) {
            rules.push('M4: consensus neutral or fractured');
            return result(MTF_ACTION.WEAKEN, 'M4',
                'Consensus is ' + consensus.direction + ' with only ' +
                (consensus.agreement * 100).toFixed(0) + '% timeframe agreement' +
                (consensus.conflicted ? ' and is flagged conflicted' : '') +
                '. The ' + band.direction + ' recommendation stands but confidence is reduced.',
                { confidenceAdjustment: -m.weakenConfidencePenalty });
        }

        /* M5 — full alignment. */
        if (agrees && consensus.agreement >= m.strongAgreement) {
            rules.push('M5: full timeframe alignment');
            return result(MTF_ACTION.STRENGTHEN, 'M5',
                'All available timeframes agree on the ' + consensus.direction +
                ' direction (dominant: ' + consensus.dominant + '), reinforcing the ' +
                'recommendation. Confidence raised.',
                { confidenceAdjustment: +m.strengthenConfidenceBonus });
        }

        /* M6 — agreement present but partial: aligned, no adjustment. */
        rules.push('M6: partial agreement, direction aligned');
        return result(MTF_ACTION.NONE, 'M6',
            'Consensus agrees with the ' + band.direction + ' direction at ' +
            (consensus.agreement * 100).toFixed(0) + '% agreement, which is above the ' +
            'fracture threshold but below full alignment. No adjustment applied.');
    };

    /** Steps a band one notch toward Neutral. */
    function demoteBand(band) {
        var idx = -1;
        for (var i = 0; i < BANDS.length; i++) if (BANDS[i].code === band.code) { idx = i; break; }
        if (idx === -1) return band;
        var neutralIdx = 3;   // index of NEUTRAL
        if (idx < neutralIdx) return BANDS[idx + 1];
        if (idx > neutralIdx) return BANDS[idx - 1];
        return band;
    }

    /* ================================================================
     * Consistency validation — surfaced, never silently corrected
     * ================================================================ */
    REC.validateConsistency = function (rec) {
        var issues = [];

        function check(id, ok, message, severity) {
            if (!ok) issues.push({ id: id, severity: severity || 'error', message: message });
        }

        var dir = rec.recommendation.direction;
        var trendDir = rec.trend.direction;

        /* Divergence from the trend engine is not automatically a defect.
         * A profile may deliberately weight trend down (research_structure_only
         * uses 0.05 for trend and 0.55 for structure), in which case a WEAK
         * directional call against the trend is the intended behaviour and is
         * reported as a warning. A high-strength call against the trend remains
         * a genuine contradiction and stays an error. */
        var profileDef = QT.profiles && QT.profiles.get ? QT.profiles.get(rec.profile.id) : null;
        var trendWeight = profileDef && profileDef.categoryWeights
            ? profileDef.categoryWeights.trend : null;
        var diverges = dir !== 'none' && dir !== 'neutral' && trendDir !== 'neutral' && dir !== trendDir;
        var severe = rec.recommendation.strength >= 0.7;

        check('direction_vs_trend',
            !(diverges && severe),
            'recommendation is ' + rec.recommendation.label + ' while the dominant trend is ' +
            trendDir, 'error');

        if (diverges && !severe) {
            issues.push({
                id: 'direction_vs_trend_divergence',
                severity: 'warning',
                message: 'recommendation is ' + rec.recommendation.label + ' while the dominant trend is ' +
                         trendDir + (trendWeight !== null
                            ? ' — the ' + rec.profile.name + ' profile weights trend at only ' +
                              trendWeight + ', so other evidence is permitted to outweigh it'
                            : '')
            });
        }

        check('strong_band_requires_agreement',
            !(Math.abs(rec.recommendation.strength) >= 1 && trendDir !== dir),
            'a maximum-strength recommendation disagrees with the dominant trend', 'error');

        var hasTrade = !!(rec.trade && rec.trade.entry);
        check('no_trade_has_no_executables',
            !(dir === 'none' && hasTrade),
            'a non-directional recommendation must not carry executable entry/targets', 'error');

        check('directional_requires_trade_or_reason',
            !(dir !== 'none' && dir !== 'neutral' && !hasTrade && rec.tradeQualification.tradeable),
            'a directional recommendation claims to be tradeable but carries no trade construction',
            'error');

        check('qualification_agrees_with_recommendation',
            !(rec.tradeQualification.tradeable === false && dir !== 'none' && dir !== 'neutral'),
            'trade qualification refused the trade but the recommendation is directional', 'error');

        check('strength_vs_confidence',
            !(rec.recommendation.strength >= 0.7 && rec.confidence < 30),
            'recommendation strength ' + rec.recommendation.strength +
            ' is high while confidence is only ' + rec.confidence.toFixed(1) + '%', 'warning');

        check('probability_agrees_with_direction',
            !(dir === 'bullish' && rec.probabilities.sell > rec.probabilities.buy) &&
            !(dir === 'bearish' && rec.probabilities.buy > rec.probabilities.sell),
            'directional probabilities contradict the recommended direction', 'error');

        if (rec.trade && rec.trade.riskReward) {
            check('rr_positive',
                rec.trade.riskReward.toFinalTarget === null || rec.trade.riskReward.toFinalTarget > 0,
                'final-target risk/reward is not positive', 'error');
        }

        return {
            valid: issues.filter(function (i) { return i.severity === 'error'; }).length === 0,
            issueCount: issues.length,
            errorCount: issues.filter(function (i) { return i.severity === 'error'; }).length,
            warningCount: issues.filter(function (i) { return i.severity === 'warning'; }).length,
            issues: issues,
            note: issues.length
                ? 'Inconsistencies are reported, never silently corrected. Review before acting.'
                : 'All internal consistency checks passed.'
        };
    };

    /* ================================================================
     * Evidence selection
     * ================================================================ */
    function collectEvidence(scored, trend, patterns) {
        var supporting = [], opposing = [];

        (scored.trace.contributions || []).forEach(function (c) {
            (c.supporting || []).forEach(function (e) {
                supporting.push({ source: c.id, weight: c.normalizedWeight,
                                  contribution: c.contribution, detail: e });
            });
            (c.opposing || []).forEach(function (e) {
                opposing.push({ source: c.id, weight: c.normalizedWeight,
                                contribution: c.contribution, detail: e });
            });
        });

        // Rank by the absolute influence of the category the evidence came from.
        supporting.sort(function (a, b) { return Math.abs(b.contribution) - Math.abs(a.contribution); });
        opposing.sort(function (a, b) { return Math.abs(b.contribution) - Math.abs(a.contribution); });

        return {
            supporting: supporting,
            opposing: opposing,
            strongestSupporting: supporting[0] || null,
            strongestOpposing: opposing[0] || null
        };
    }

    /**
     * Identifies the single factor most responsible for preventing a stronger
     * recommendation. Checked in order of decisiveness.
     */
    function limitingFactor(scored, trend, proposal, band, damping, mtf) {
        if (mtf && (mtf.action === 'block' || mtf.action === 'demote' || mtf.action === 'weaken')) {
            return { factor: 'mtf_consensus', detail: mtf.reason };
        }
        if (damping.damped) {
            return { factor: 'band_edge_damping', detail: damping.dampingReason };
        }
        var failed = (scored.qualification.pre.failures || [])
            .concat(scored.qualification.post.failures || []);
        if (failed.length) {
            return { factor: 'qualification_gate',
                     detail: failed[0].message + ' (' + failed[0].tier + ' gate)' };
        }
        var excluded = scored.trace.excluded || [];
        if (excluded.length) {
            return { factor: 'capability_exclusion',
                     detail: excluded.map(function (e) { return e.id; }).join(', ') +
                             ' unavailable — ' + excluded[0].reason };
        }
        var opp = (scored.trace.contributions || [])
            .filter(function (c) { return c.opposing.length > 0; })
            .sort(function (a, b) { return Math.abs(b.contribution) - Math.abs(a.contribution); })[0];
        if (opp) {
            return { factor: 'opposing_evidence',
                     detail: opp.id + ': ' + opp.opposing[0] };
        }
        if (scored.agreement < 1) {
            return { factor: 'partial_agreement',
                     detail: 'only ' + (scored.agreement * 100).toFixed(0) +
                             '% of directional categories agree' };
        }
        return { factor: 'none', detail: 'no material limiting factor identified' };
    }

    /* ================================================================
     * Explanations — built ONLY from structured prior-phase output
     * ================================================================ */
    function buildExecutive(rec) {
        var parts = [];
        if (rec.recommendation.direction === 'none') {
            parts.push(rec.recommendation.label + ': ' + rec.reasoning.primaryReason);
            parts.push('Dominant trend is ' + rec.trend.direction + ' in a ' +
                       rec.regime.name + ' regime.');
        } else {
            parts.push(rec.recommendation.label + ' with ' + rec.confidence.toFixed(0) +
                       '% confidence.');
            parts.push('Dominant trend is ' + rec.trend.direction + ' (' +
                       (rec.trend.strength * 100).toFixed(0) + '% strength) in a ' +
                       rec.regime.name + ' regime.');
            if (rec.trade && rec.trade.entry) {
                parts.push('Entry ' + U.formatPrice(rec.trade.entry.price) + ', stop ' +
                           U.formatPrice(rec.trade.stop.price) + ', final target R:R ' +
                           (rec.trade.riskReward.toFinalTarget !== null
                               ? rec.trade.riskReward.toFinalTarget.toFixed(2) : 'n/a') + '.');
            }
        }
        if (rec.evidence.strongestSupporting) {
            parts.push('Strongest support: ' + rec.evidence.strongestSupporting.detail + '.');
        }
        if (rec.evidence.strongestOpposing) {
            parts.push('Main counter-argument: ' + rec.evidence.strongestOpposing.detail + '.');
        }
        return parts.join(' ');
    }

    function buildTechnical(rec, scored, trend, patterns, proposal) {
        var lines = [];
        lines.push('PROFILE: ' + rec.profile.name + ' (' + rec.profile.id + ')');
        lines.push('COMPOSITE: directional score ' + scored.directionalScore +
                   ', quality score ' + scored.qualityScore +
                   ', agreement ' + (scored.agreement * 100).toFixed(0) + '%' +
                   ', capability ratio ' + (scored.capabilityRatio * 100).toFixed(0) + '%');
        lines.push('BAND: ' + rec.recommendation.code + ' (strength ' + rec.recommendation.strength +
                   ')' + (rec.reasoning.bandDamped ? ' — DAMPED: ' + rec.reasoning.dampingReason : ''));
        lines.push('TREND: direction ' + trend.direction + ', strength ' + trend.strength.toFixed(3) +
                   ', confidence ' + trend.confidence.toFixed(3) + ', state ' + trend.state +
                   ' held ' + trend.barsInState + ' bars');
        lines.push('REGIME: ' + trend.regime.primary + ' (confidence ' +
                   trend.regime.confidence.toFixed(3) + ')');
        lines.push('OUTCOME PROBABILITIES: ' + Object.keys(trend.probabilities).map(function (k) {
            return k + ' ' + (trend.probabilities[k] * 100).toFixed(1) + '%';
        }).join(', '));
        lines.push('PATTERNS: ' + patterns.summary.activeCount + ' active (' +
                   patterns.summary.bullish + ' bullish / ' + patterns.summary.bearish +
                   ' bearish / ' + patterns.summary.neutral + ' neutral), net bias ' +
                   patterns.summary.netBias.toFixed(3));

        lines.push('CONTRIBUTIONS (ranked by |contribution|):');
        (scored.trace.contributions || []).forEach(function (c) {
            lines.push('  ' + c.id.padEnd(18) + ' kind=' + c.kind.padEnd(11) +
                       ' score=' + String(c.score).padEnd(8) +
                       ' w=' + String(c.normalizedWeight).padEnd(7) +
                       ' contrib=' + c.contribution);
        });

        if ((scored.trace.excluded || []).length) {
            lines.push('EXCLUDED CATEGORIES:');
            scored.trace.excluded.forEach(function (e) {
                lines.push('  ' + e.id + ' — ' + e.reason);
            });
            lines.push('  ' + scored.trace.normalisation.note);
        }

        lines.push('QUALIFICATION:');
        ['pre', 'post'].forEach(function (stage) {
            var s = scored.qualification[stage];
            if (!s || s.skipped) {
                lines.push('  ' + stage + ': ' + (s && s.skipped ? s.skipped : 'not evaluated'));
                return;
            }
            (s.hard || []).forEach(function (g) {
                lines.push('  [hard]          ' + g.id + ': ' + (g.passed ? 'PASS' : 'FAIL — ' + g.message));
            });
            (s.configurable || []).forEach(function (g) {
                lines.push('  [configurable]  ' + g.id + ': ' + (g.passed ? 'PASS' : 'FAIL') +
                           ' (value ' + g.value + ' vs threshold ' + g.threshold + ', profile ' + g.profile + ')');
            });
            (s.informational || []).forEach(function (g) {
                lines.push('  [informational] ' + g.id + ': ' + g.message);
            });
        });

        if (proposal && proposal.tradeable) {
            lines.push('TRADE CONSTRUCTION:');
            lines.push('  entry ' + proposal.entry.model + ' @ ' + U.formatPrice(proposal.entry.price) +
                       ' (execution quality ' + proposal.entry.quality.toFixed(2) + ')');
            lines.push('  stop ' + proposal.stop.id + ' @ ' + U.formatPrice(proposal.stop.price) +
                       ' basis=' + proposal.stop.basis + ' (' + proposal.stop.distanceAtr.toFixed(2) + ' ATR)');
            (proposal.targets || []).forEach(function (t) {
                lines.push('  ' + t.id + ' @ ' + U.formatPrice(t.price) + ' R:R ' + t.rr.toFixed(2) +
                           ' probability ' + (t.probability * 100).toFixed(0) + '% sources=' + t.sources.join('+'));
            });
            lines.push('  expected value ' + proposal.riskReward.expectedValueR + 'R' +
                       ', weighted R:R ' + proposal.riskReward.weighted);
        }

        lines.push('LIMITING FACTOR: ' + rec.reasoning.limitingFactor.factor + ' — ' +
                   rec.reasoning.limitingFactor.detail);

        if (!rec.consistency.valid || rec.consistency.issueCount) {
            lines.push('CONSISTENCY ISSUES:');
            rec.consistency.issues.forEach(function (i) {
                lines.push('  [' + i.severity + '] ' + i.id + ': ' + i.message);
            });
        }
        return lines.join('\n');
    }

    /* ================================================================
     * Main entry point
     * ================================================================ */
    /**
     * @param {Object} input
     * @param {Object} input.scored          Phase 6 output
     * @param {Object} input.trend           Phase 4 output
     * @param {Object} input.patternReport   Phase 3 output
     * @param {Object} input.proposal        Phase 5 output
     * @param {Object} [input.levels]
     * @param {Object} [input.sentiment]
     * @param {Object} [input.series]        { symbol, interval, bars, warnings }
     * @param {number} [input.generatedAt]   injected timestamp (defaults to last bar time)
     * @param {Object} [input.config]
     */
    REC.build = function (input) {
        var cfg = input.config || QT.CONFIG;
        var scored = input.scored;
        var trend = input.trend;
        var patterns = input.patternReport;
        var proposal = input.proposal;
        var series = input.series || {};

        var barTime = series.bars && series.bars.length
            ? series.bars[series.bars.length - 1].time
            : (proposal && proposal.barTime) || null;
        var generatedAt = U.isFiniteNumber(input.generatedAt) ? input.generatedAt : barTime;

        /* ---- Decide the recommendation ---- */
        var outcome = null, band = null, damping = { damped: false, dampingReason: null };
        var primaryReason;

        var pre = scored.qualification.pre;
        var post = scored.qualification.post;

        if (!pre.hardPassed) {
            outcome = OUTCOMES.DATA_INSUFFICIENT;
            primaryReason = (pre.hard.filter(function (g) { return !g.passed; })[0] || {}).message ||
                            'a hard validation gate failed';
        } else if (proposal && !proposal.tradeable) {
            var map = {
                NO_TRADE: OUTCOMES.NO_TRADE,
                LOW_CONFIDENCE: OUTCOMES.LOW_CONFIDENCE,
                INSUFFICIENT_CONFIRMATION: OUTCOMES.INSUFFICIENT_CONFIRMATION,
                HIGH_RISK: OUTCOMES.HIGH_RISK
            };
            outcome = map[proposal.qualification.status] || OUTCOMES.NO_TRADE;
            primaryReason = (proposal.qualification.blockers || [])[0] ||
                            (proposal.qualification.reasons || [])[0] ||
                            'trade qualification declined the setup';
        } else if (!pre.passed || (post && !post.skipped && !post.passed)) {
            var firstFail = (pre.failures || []).concat(post.failures || [])[0];
            outcome = firstFail && firstFail.tier === 'hard'
                ? OUTCOMES.DATA_INSUFFICIENT
                : OUTCOMES.WAITING_FOR_CONFIRMATION;
            primaryReason = firstFail ? firstFail.message : 'a qualification gate did not pass';
        } else {
            damping = REC.resolveBand(scored.directionalScore, scored.confidence01, cfg);
            band = damping.band;
            primaryReason = 'composite directional score ' + scored.directionalScore.toFixed(3) +
                            ' places the market in the ' + band.label + ' band with ' +
                            scored.confidence.toFixed(0) + '% confidence';
        }

        /* ---- MTF arbitration: a recommendation may not finalise without it ----
         * Runs even for non-directional outcomes so the object always records
         * whether consensus was evaluated and what it concluded. */
        var mtf = REC.arbitrateConsensus(input.consensus || null, band, cfg);
        var bandBeforeMtf = band ? band.code : null;
        var confidenceValue = scored.confidence;

        if (band && mtf.action === MTF_ACTION.BLOCK) {
            outcome = OUTCOMES.WAITING_FOR_CONFIRMATION;
            primaryReason = mtf.reason;
            band = null;
        } else if (band && mtf.action === MTF_ACTION.DEMOTE) {
            var demoted = demoteBand(band);
            mtf.bandChange = { from: band.code, to: demoted.code };
            band = demoted;
            primaryReason = mtf.reason;
        }
        if (mtf.confidenceAdjustment) {
            confidenceValue = Math.max(0, Math.min(
                cfg.scoring.tuning ? cfg.scoring.tuning.confidenceCeiling : 95,
                confidenceValue + mtf.confidenceAdjustment));
        }

        /* A required-but-missing consensus is surfaced, never ignored. */
        if (cfg.mtf.required && !mtf.evaluated) {
            mtf.warning = 'Configuration requires multi-timeframe consensus, but none was supplied. ' +
                          'The recommendation was finalised on the primary timeframe alone.';
        }

        var recommendation = outcome
            ? { code: outcome.code, label: outcome.label, direction: outcome.direction,
                band: null, strength: 0 }
            : { code: band.code, label: band.label, direction: band.direction,
                band: band.code, strength: band.strength };

        var evidence = collectEvidence(scored, trend, patterns);
        var limiting = limitingFactor(scored, trend, proposal, band, damping, mtf);

        /* Executable trade data is attached ONLY for directional recommendations.
         * A non-directional outcome must never carry entries or targets. */
        var tradeBlock = null;
        if (!outcome && proposal && proposal.tradeable) {
            tradeBlock = {
                entry: proposal.entry,
                entryCandidates: proposal.entryCandidates,
                stop: proposal.stop,
                stopCandidates: proposal.stops.candidates,
                stopsRejected: proposal.stops.rejected,
                targets: proposal.targets,
                riskReward: proposal.riskReward,
                positionRisk: proposal.positionRisk,
                lifecycle: proposal.lifecycle,
                levels: proposal.levels
            };
        }

        var rec = {
            /* ---- identity ---- */
            engineVersion: ENGINE_VERSION,
            configVersion: cfg.version,
            generatedAt: generatedAt,
            barTime: barTime,
            symbol: series.symbol || null,
            timeframe: series.interval || null,
            profile: scored.profile,

            /* ---- the decision ---- */
            recommendation: recommendation,
            confidence: confidenceValue,

            /* ---- the five independent quantitative concepts ---- */
            metrics: {
                recommendationStrength: recommendation.strength,
                confidenceBeforeMtf: scored.confidence,
                mtfConfidenceAdjustment: mtf.confidenceAdjustment,
                trendStrength: +trend.strength.toFixed(4),
                confidence: confidenceValue,
                tradeQuality: proposal && proposal.positionRisk
                    ? proposal.positionRisk.tradeQuality : null,
                directionalScore: scored.directionalScore,
                qualityScore: scored.qualityScore,
                agreement: scored.agreement,
                capabilityRatio: scored.capabilityRatio
            },

            tradeQualification: {
                status: proposal ? proposal.qualification.status : 'NOT_EVALUATED',
                tradeable: !!(proposal && proposal.tradeable),
                reasons: proposal ? proposal.qualification.reasons : [],
                blockers: proposal ? proposal.qualification.blockers : [],
                warnings: proposal ? proposal.qualification.warnings : [],
                gates: {
                    pre: scored.qualification.pre,
                    post: scored.qualification.post,
                    passed: scored.qualification.passed
                }
            },

            regime: {
                primary: trend.regime.primary,
                name: trend.regime.name,
                confidence: trend.regime.confidence,
                evidence: trend.regime.evidence,
                rejected: trend.regime.rejected
            },

            trend: {
                direction: trend.direction,
                strength: trend.strength,
                confidence: trend.confidence,
                state: trend.state,
                barsInState: trend.barsInState,
                dimensions: trend.dimensions
            },

            probabilities: {
                buy: scored.probabilities.buy,
                sell: scored.probabilities.sell,
                neutral: scored.probabilities.neutral,
                outcome: trend.probabilities
            },

            trade: tradeBlock,

            evidence: evidence,

            /* How multi-timeframe consensus participated in this decision. */
            mtf: {
                evaluated: mtf.evaluated,
                action: mtf.action,
                rule: mtf.rule,
                reason: mtf.reason,
                blocked: mtf.blocked,
                bandBeforeArbitration: bandBeforeMtf,
                bandChange: mtf.bandChange,
                confidenceAdjustment: mtf.confidenceAdjustment,
                consensus: mtf.evaluation,
                warning: mtf.warning || null
            },

            reasoning: {
                primaryReason: primaryReason,
                limitingFactor: limiting,
                bandDamped: damping.damped,
                dampingReason: damping.dampingReason,
                capabilityExclusions: scored.trace.excluded,
                decisiveGates: (pre.failures || []).concat(post.failures || []),
                normalisation: scored.trace.normalisation
            },

            capability: {
                ratio: scored.capabilityRatio,
                excluded: (scored.trace.excluded || []).map(function (e) { return e.id; }),
                available: (scored.trace.contributions || []).map(function (c) { return c.id; }),
                note: scored.trace.normalisation.note
            },

            warnings: buildWarnings(scored, trend, proposal, series),
            assumptions: buildAssumptions(cfg, scored, proposal),

            /* Inspection block: everything the "Show Analysis Details" view needs,
             * exposed here so the presentation layer never has to reach into an
             * earlier phase's internals or derive anything itself. */
            inspection: {
                contributions: scored.trace.contributions,
                excluded: scored.trace.excluded,
                normalisation: scored.trace.normalisation,
                profileAdjustments: scored.trace.profileAdjustments,
                patternSummary: patterns.summary,
                structureSummary: patterns.structure,
                detectorDiagnostics: patterns.diagnostics,
                trendDimensions: trend.dimensions,
                trendExplanation: trend.explanation
            }
        };

        rec.consistency = REC.validateConsistency(rec);

        rec.explanations = {
            executive: buildExecutive(rec),
            technical: buildTechnical(rec, scored, trend, patterns, proposal)
        };

        return rec;
    };

    function buildWarnings(scored, trend, proposal, series) {
        var w = [];
        (series.warnings || []).forEach(function (x) { w.push({ source: 'data', message: x }); });
        (scored.trace.excluded || []).forEach(function (e) {
            w.push({ source: 'capability', message: e.id + ' excluded: ' + e.reason });
        });
        if (proposal && proposal.qualification.warnings) {
            proposal.qualification.warnings.forEach(function (x) {
                w.push({ source: 'risk', message: x });
            });
        }
        if (trend.regime.rejected && trend.regime.rejected[0] &&
            trend.regime.rejected[0].score > trend.regime.confidence * 0.9) {
            w.push({ source: 'regime',
                     message: 'regime classification is close-run: ' + trend.regime.rejected[0].name +
                              ' scored ' + trend.regime.rejected[0].score.toFixed(2) });
        }
        if (proposal && proposal.riskReward && proposal.riskReward.expectedValueR < 0) {
            w.push({ source: 'risk',
                     message: 'expected value is negative (' + proposal.riskReward.expectedValueR +
                              'R) — the reward-to-risk ratio is not supported by target probabilities' });
        }
        return w;
    }

    function buildAssumptions(cfg, scored, proposal) {
        var a = [
            'Signals are computed on completed bars only; the forming bar is excluded.',
            'Confidence expresses the engine\'s certainty that market conditions match the ' +
            'configured strategy — it is NOT a probability of trade success.',
            'Scoring weights and gate thresholds are calibration assumptions from the active ' +
            'profile, not mathematical constants.'
        ];
        if ((scored.trace.excluded || []).length) {
            a.push('Unavailable evidence categories were excluded and remaining weights ' +
                   'renormalised; no values were fabricated.');
        }
        if (proposal && proposal.positionRisk) {
            a.push('Position sizing, leverage and capital allocation are deliberately out of scope.');
        }
        a.push('Analysis is educational and does not constitute financial advice.');
        return a;
    }

    QT.recommendation = REC;

})(typeof globalThis !== 'undefined' ? globalThis : this);

if (typeof module !== 'undefined' && module.exports) {
    module.exports = (typeof globalThis !== 'undefined' ? globalThis : this).QT.recommendation;
}
