/**
 * qt-profiles.js — Strategy profiles.
 *
 * A profile is a named set of weights, thresholds and tolerances. The engine
 * NEVER reads a profile-specific value directly: it reads the resolved config
 * produced by `applyProfile()`. Adding or retuning a strategy is therefore a
 * data change, not a code change.
 *
 * CALIBRATION NOTE (kept deliberately separate from the engine):
 * every number below is a calibration assumption, not a mathematical constant.
 * The evidence-category weights start from the research priors documented in
 * RESEARCH-SYNTHESIS.md §3.1 and are expected to be re-optimised once the full
 * pipeline can be back-tested end to end. Nothing in the engine breaks if these
 * change; only the resulting scores move.
 */
(function (root) {
    'use strict';

    var QT = root.QT = root.QT || {};

    /**
     * Evidence-category weights.
     *
     * DIRECTIONAL categories carry a signed score in [-1, +1] and決 determine which
     * way the market is leaning. QUALITY categories carry an unsigned score in
     * [0, 1] and modulate how much the directional read can be trusted — they can
     * never, by themselves, create a direction. Keeping these separate is what
     * stops "good risk/reward" from masquerading as "bullish".
     */
    var CATEGORY_KIND = {
        trend:             'directional',
        structure:         'directional',
        momentum:          'directional',
        pattern:           'directional',
        sentiment:         'directional',
        riskQuality:       'quality',
        srQuality:         'quality',
        fibConfluence:     'quality',
        regimeQuality:     'quality',
        tradeConstruction: 'quality'
    };

    var PROFILES = {

        /* ------------------------------------------------------------------
         * BALANCED — the default. Mirrors the research synthesis directly.
         * ------------------------------------------------------------------ */
        balanced: {
            id: 'balanced',
            name: 'Balanced',
            description: 'Default profile. Weights follow RESEARCH-SYNTHESIS.md §3.1 ' +
                         'with regime-conditioned oscillators and Donchian promoted.',
            categoryWeights: {
                trend: 0.26, structure: 0.24, momentum: 0.16, pattern: 0.18, sentiment: 0.06,
                riskQuality: 0.22, srQuality: 0.18, fibConfluence: 0.12,
                regimeQuality: 0.28, tradeConstruction: 0.20
            },
            gates: {
                minExpectedValueR: null,   // informational only by default
                minRiskReward: 2.0,        // D1 §1.4 professional floor
                minTrendConfidence: 0.35,
                minCompositeScore: 0.12,
                minRegimeQuality: 0.25,
                minConfirmationScore: 0.20
            },
            tuning: {
                confidenceFloor: 0,
                confidenceCeiling: 95,     // never claim certainty (D2 / CFTC)
                agreementWeight: 0.45,
                qualityWeight: 0.35,
                capabilityWeight: 0.20,
                neutralBandScore: 0.10,
                probabilityTemperature: 0.42
            }
        },

        /* ------------------------------------------------------------------
         * CONSERVATIVE — fewer, higher-quality trades. Demands positive EV.
         * ------------------------------------------------------------------ */
        conservative: {
            id: 'conservative',
            name: 'Conservative',
            description: 'Capital preservation bias: positive expected value is required, ' +
                         'structure and regime quality outweigh momentum.',
            categoryWeights: {
                trend: 0.24, structure: 0.30, momentum: 0.10, pattern: 0.16, sentiment: 0.04,
                riskQuality: 0.30, srQuality: 0.22, fibConfluence: 0.14,
                regimeQuality: 0.34, tradeConstruction: 0.26
            },
            gates: {
                minExpectedValueR: 0.0,    // EV must not be negative
                minRiskReward: 2.5,
                minTrendConfidence: 0.55,
                minCompositeScore: 0.28,
                minRegimeQuality: 0.45,
                minConfirmationScore: 0.40
            },
            tuning: {
                confidenceFloor: 0, confidenceCeiling: 90,
                agreementWeight: 0.50, qualityWeight: 0.35, capabilityWeight: 0.15,
                neutralBandScore: 0.16,
                probabilityTemperature: 0.36
            }
        },

        /* ------------------------------------------------------------------
         * AGGRESSIVE — more trades, momentum-led, EV informational only.
         * ------------------------------------------------------------------ */
        aggressive: {
            id: 'aggressive',
            name: 'Aggressive',
            description: 'Opportunity bias: momentum and pattern evidence weighted up, ' +
                         'lower gates, expected value reported but not gated.',
            categoryWeights: {
                trend: 0.28, structure: 0.20, momentum: 0.24, pattern: 0.22, sentiment: 0.08,
                riskQuality: 0.14, srQuality: 0.14, fibConfluence: 0.10,
                regimeQuality: 0.20, tradeConstruction: 0.14
            },
            gates: {
                minExpectedValueR: null,
                minRiskReward: 1.5,
                minTrendConfidence: 0.25,
                minCompositeScore: 0.08,
                minRegimeQuality: 0.15,
                minConfirmationScore: 0.12
            },
            tuning: {
                confidenceFloor: 0, confidenceCeiling: 95,
                agreementWeight: 0.40, qualityWeight: 0.30, capabilityWeight: 0.30,
                neutralBandScore: 0.07,
                probabilityTemperature: 0.50
            }
        },

        /* ------------------------------------------------------------------
         * RESEARCH PROFILES — for controlled experiments, not live guidance.
         * ------------------------------------------------------------------ */
        research_structure_only: {
            id: 'research_structure_only',
            name: 'Research Profile A — Structure Only',
            description: 'Isolates market-structure and SMC evidence. Tests the D4 claim ' +
                         'that institutional structure outperforms indicator stacks.',
            categoryWeights: {
                trend: 0.05, structure: 0.55, momentum: 0.0, pattern: 0.30, sentiment: 0.0,
                riskQuality: 0.20, srQuality: 0.30, fibConfluence: 0.20,
                regimeQuality: 0.20, tradeConstruction: 0.20
            },
            gates: {
                minExpectedValueR: null, minRiskReward: 2.0, minTrendConfidence: 0.30,
                minCompositeScore: 0.15, minRegimeQuality: 0.20, minConfirmationScore: 0.25
            },
            tuning: {
                confidenceFloor: 0, confidenceCeiling: 90,
                agreementWeight: 0.45, qualityWeight: 0.35, capabilityWeight: 0.20,
                neutralBandScore: 0.12, probabilityTemperature: 0.42
            }
        },

        research_trend_following: {
            id: 'research_trend_following',
            name: 'Research Profile B — Trend Following',
            description: 'Implements the D2 conclusion that regime-conditioned trend/breakout ' +
                         'frameworks carry the strongest peer-reviewed evidence.',
            categoryWeights: {
                trend: 0.45, structure: 0.18, momentum: 0.12, pattern: 0.10, sentiment: 0.0,
                riskQuality: 0.22, srQuality: 0.10, fibConfluence: 0.06,
                regimeQuality: 0.36, tradeConstruction: 0.18
            },
            gates: {
                minExpectedValueR: null, minRiskReward: 2.0, minTrendConfidence: 0.45,
                minCompositeScore: 0.20, minRegimeQuality: 0.40, minConfirmationScore: 0.15
            },
            tuning: {
                confidenceFloor: 0, confidenceCeiling: 92,
                agreementWeight: 0.55, qualityWeight: 0.30, capabilityWeight: 0.15,
                neutralBandScore: 0.10, probabilityTemperature: 0.40
            }
        }
    };

    /**
     * Resolves a profile into a complete config.
     * Returns a deep copy so callers can never mutate the shared defaults.
     */
    function applyProfile(profileId, baseConfig) {
        var profile = PROFILES[profileId];
        if (!profile) {
            throw new Error('Unknown strategy profile: ' + profileId +
                            '. Available: ' + Object.keys(PROFILES).join(', '));
        }
        var cfg = baseConfig ? JSON.parse(JSON.stringify(baseConfig)) : QT.cloneConfig();

        cfg.activeProfile = {
            id: profile.id, name: profile.name, description: profile.description
        };
        cfg.scoring = cfg.scoring || {};
        cfg.scoring.categoryWeights = JSON.parse(JSON.stringify(profile.categoryWeights));
        cfg.scoring.categoryKind = JSON.parse(JSON.stringify(CATEGORY_KIND));
        cfg.scoring.tuning = JSON.parse(JSON.stringify(profile.tuning));
        cfg.gates = JSON.parse(JSON.stringify(profile.gates));

        // Keep the risk engine's own minimum in step with the profile.
        if (cfg.risk && cfg.risk.classes) {
            Object.keys(cfg.risk.classes).forEach(function (k) {
                cfg.risk.classes[k].minRR = profile.gates.minRiskReward;
            });
        }
        if (cfg.risk && cfg.risk.qualification) {
            cfg.risk.qualification.minConfidence = profile.gates.minTrendConfidence;
        }
        return cfg;
    }

    QT.profiles = {
        PROFILES: PROFILES,
        CATEGORY_KIND: CATEGORY_KIND,
        applyProfile: applyProfile,
        list: function () {
            return Object.keys(PROFILES).map(function (k) {
                return { id: k, name: PROFILES[k].name, description: PROFILES[k].description };
            });
        },
        get: function (id) { return PROFILES[id] || null; }
    };

})(typeof globalThis !== 'undefined' ? globalThis : this);

if (typeof module !== 'undefined' && module.exports) {
    module.exports = (typeof globalThis !== 'undefined' ? globalThis : this).QT.profiles;
}
