/**
 * qt-config.js — Single source of truth for every strategy parameter.
 *
 * The analysis engine reads from this object and never hard-codes a threshold.
 * Changing the trading strategy means editing this file only.
 *
 * Citations refer to RESEARCH-SYNTHESIS.md and the source documents:
 *   D1 = Indicators_Setup_Inputs_Signs_Patterns_for_each_trading_pair.md
 *   D2 = High Win Rate BTC Trading Setups for Professional Traders.md   (peer-reviewed)
 *   D3 = High Win Rate BTC-USD Trading Setups for Professional Traders.md
 *   D4 = High Win Rate XAU-USD Trading Setups for Professional Traders.md
 */
(function (root) {
    'use strict';

    var CONFIG = {

        version: '1.0.0',

        /* ---------------------------------------------------------------
         * Data providers.
         * Keys are NEVER stored in this file. They are read from
         * localStorage at runtime (see qt-data.js -> credentials()).
         * --------------------------------------------------------------- */
        providers: {
            twelveData: {
                baseUrl: 'https://api.twelvedata.com',
                storageKey: 'qt.apikey.twelvedata',
                // Free tier: 8 requests/minute, 800/day. Respected by the limiter.
                rateLimit: { requests: 8, windowMs: 60000 },
                timeoutMs: 15000,
                retries: 3,
                retryBackoffMs: [400, 1200, 3000],
                outputSize: 500           // bars per request
            },
            exchangeRate: {
                baseUrl: 'https://v6.exchangerate-api.com/v6',
                storageKey: 'qt.apikey.exchangerate',
                rateLimit: { requests: 10, windowMs: 60000 },
                timeoutMs: 10000,
                retries: 2,
                retryBackoffMs: [500, 1500]
            },
            newsApi: {
                baseUrl: 'https://newsapi.org/v2',
                storageKey: 'qt.apikey.newsapi',
                rateLimit: { requests: 5, windowMs: 60000 },
                timeoutMs: 12000,
                retries: 2,
                retryBackoffMs: [500, 1500],
                lookbackHours: 48,
                maxArticles: 50
            }
        },

        cache: {
            // Bars for a closed period are immutable, so TTL scales with timeframe.
            ttlMultiplier: 0.5,          // fraction of one bar interval
            minTtlMs: 20000,
            maxTtlMs: 3600000,
            newsTtlMs: 900000,           // 15 min
            maxEntries: 120
        },

        /* ---------------------------------------------------------------
         * Bar integrity.
         * D2 anti-leakage gate: form signals on COMPLETED bars only.
         * --------------------------------------------------------------- */
        data: {
            dropFormingBar: true,
            minBars: 210,                // must exceed the slowest lookback (EMA200 + warmup)
            preferredBars: 500,
            maxGapRatio: 0.02            // reject a series with >2% missing/duplicate stamps
        },

        /* ---------------------------------------------------------------
         * Indicator parameters.
         * Settings are the ones actually named in the research documents.
         * --------------------------------------------------------------- */
        indicators: {
            ema:        { fast: 20, mid: 50, slow: 200 },      // D3 §3.1, D1 §2.3-A
            sma:        { periods: [9, 20, 50, 200] },          // D4 §1 uses SMA9/EMA30
            wma:        { period: 20 },
            vwma:       { period: 20 },
            rsi:        { period: 14, overbought: 70, oversold: 30,
                          bullPullback: [40, 60] },             // D1 §2.3-A step 3
            rsiFast:    { period: 9 },                          // D1 §2.3-C, §4.4-A
            macd:       { fast: 12, slow: 26, signal: 9 },      // D1 §7.1, D2 §3.1
            adx:        { period: 14, trending: 25, ranging: 20 }, // D1 §5.1/§5.2
            atr:        { period: 14, longPeriod: 21 },
            cci:        { period: 20, upper: 100, lower: -100 }, // D1 §5.2
            roc:        { period: 10 },                          // D2 §3.1 (Gerritsen ROC 10)
            momentum:   { period: 10 },
            bollinger:  { period: 20, stdDev: 2,
                          squeezePct: 5,                         // D1 §5.3 bandwidth < 5%
                          squeezePctBtc: 6,                      // D1 §2.3-C
                          squeezePctGbp: 4 },                    // D1 §4.4-A
            keltner:    { period: 20, atrPeriod: 10, multiplier: 2 },
            donchian:   { periods: [20, 50, 150, 200] },          // D2 §3.1 lookbacks
            stochastic: { kPeriod: 14, dPeriod: 3, smooth: 3,
                          overbought: 80, oversold: 20 },        // D3 §3.2
            stochFast:  { kPeriod: 5, dPeriod: 3, smooth: 3 },    // D1 §7.1 scalping
            williamsR:  { period: 14, overbought: -20, oversold: -80 },
            mfi:        { period: 14, overbought: 80, oversold: 20 },
            cmf:        { period: 20 },
            obv:        { smoothing: 20 },
            vwap:       { session: true },
            superTrend: { period: 10, multiplier: 3 },            // D1 §2.3-B, D3 §3.1
            psar:       { step: 0.02, max: 0.2 },
            ichimoku:   { conversion: 9, base: 26, spanB: 52, displacement: 26 },
            volume:     { avgPeriod: 20,
                          breakoutMultiplier: 1.5,               // D1 §2.3-C
                          strongMultiplier: 2.0,                 // D3 §3.3
                          retestMultiplier: 1.2 },               // D1 §3.3-E
            volumeProfile: { bins: 24, valueAreaPct: 0.70 }
        },

        /* ---------------------------------------------------------------
         * Market structure / swing detection.
         * --------------------------------------------------------------- */
        structure: {
            swingLookback: 3,            // fractal half-width
            minSwingAtrMultiple: 0.15,   // prominence is a single-bar increment, so 0.5 ATR starved structure on real data (see IMPLEMENTATION-NOTES)
            maxSwings: 40,
            bosConfirmBars: 1,
            fvgMinAtrMultiple: 0.15,     // ignore trivial gaps
            orderBlockLookback: 40,
            liquiditySweepAtrMultiple: 0.25,
            srClusterAtrMultiple: 0.5,   // merge levels within 0.5 ATR
            srMinTouches: 2,
            srMaxLevels: 6
        },

        /* ---------------------------------------------------------------
         * Support/Resistance and Fibonacci level engines.
         * --------------------------------------------------------------- */
        levels: {
            touchWeight: 0.40,          // weight of touch count in level strength
            recencyWeight: 0.35,        // weight of how recently it was respected
            reactionWeight: 0.25,       // weight of the average reaction size
            recencyHalfLifeBars: 60,    // exponential decay for level recency
            strongReactionAtr: 3.0,     // reaction size that saturates the score
            fibSwingWindow: 12,         // swings scanned for the dominant leg
            fibMinLegAtr: 1.5,          // minimum impulse size to anchor Fibonacci
            fibRecencyBonus: 2.0        // preference for the most recent qualifying leg
        },

        fibonacci: {
            retracements: [0.236, 0.382, 0.5, 0.618, 0.786],
            extensions: [1.272, 1.414, 1.618, 2.0, 2.618],
            expansions: [1.0, 1.618, 2.618],
            goldenZone: [0.5, 0.618],    // D1 §4.3-B
            confluenceAtrMultiple: 0.35
        },

        /* ---------------------------------------------------------------
         * Pattern recognition (Phase 3).
         * Sensitivity, tolerances and per-detector toggles/weights all live
         * here; adding or retuning a detector never touches engine code.
         * --------------------------------------------------------------- */
        patterns: {
            /* --- scan scope & diagnostics --- */
            scanBars: 120,               // only recent bars are decision-relevant
            contextBars: 10,             // window for "prior trend" context
            candleExpiryBars: 5,         // a candle signal goes stale after N bars
            collectRejections: true,     // record near-misses for explainability
            maxZonesPerType: 6,          // cap SMC zones kept per type

            /* --- candlestick tolerances --- */
            bodyDominanceRatio: 0.6,     // body / range for a decisive candle
            pinBarWickRatio: 2.0,        // dominant wick >= 2x body
            pinBarBodyMaxPct: 0.34,      // body <= 34% of range
            dojiBodyMaxPct: 0.1,         // body <= 10% of range
            engulfingMinRatio: 1.0,      // engulfing body >= 1.0x engulfed body
            haramiMaxBodyRatio: 0.6,     // inner body <= 60% of mother body
            starBodyMinAtr: 0.6,         // star bar 1 body >= 0.6 ATR
            starMiddleMaxRatio: 0.5,     // star bar 2 body <= 50% of bar 1
            soldierMinBodyPct: 0.55,     // each soldier body >= 55% of its range

            /* --- SMC tolerances --- */
            equalLevelAtrMultiple: 0.12, // "equal" highs/lows within 0.12 ATR
            equilibriumBand: 0.05,       // +/-5% around 50% counts as equilibrium

            /* --- chart formations --- */
            doubleTopTolerance: 0.02,    // 2% peak equality
            headShouldersTolerance: 0.03,
            flatSlopeAtrPerBar: 0.05,    // |slope| <= 0.05 ATR/bar counts as flat
            trendlineMinSwings: 5,
            trendlineSwingWindow: 10,
            trendlineMinR2: 0.5,         // reject poorly-fitting trendlines
            convergenceMinPct: 0.15,     // width must shrink >=15% to converge
            flagPoleMinAtr: 2.0,         // impulse >= 2 ATR
            flagPoleMaxBars: 10,
            flagMinBars: 3,
            flagMaxRetrace: 0.5,         // consolidation retraces <=50% of the pole
            minPatternBars: 5,

            /* --- per-detector registry ---
             * enabled: false removes a detector entirely.
             * weight overrides the detector's default weight in scoring. */
            detectors: {
                engulfing:            { enabled: true, weight: 1.2 },
                pin_bar:              { enabled: true, weight: 1.1 },
                doji:                 { enabled: true, weight: 0.6 },
                inside_outside:       { enabled: true, weight: 0.9 },
                harami:               { enabled: true, weight: 0.9 },
                star:                 { enabled: true, weight: 1.3 },
                three_soldiers:       { enabled: true, weight: 1.3 },
                swing_structure:      { enabled: true, weight: 1.8 },
                internal_structure:   { enabled: true, weight: 1.2 },
                external_breaks:      { enabled: true, weight: 2.0 },
                internal_breaks:      { enabled: true, weight: 1.4 },
                fair_value_gap:       { enabled: true, weight: 1.8 },
                order_block:          { enabled: true, weight: 1.7 },
                liquidity_sweep:      { enabled: true, weight: 1.7 },
                equal_levels:         { enabled: true, weight: 1.2 },
                premium_discount:     { enabled: true, weight: 1.0 },
                double_top_bottom:    { enabled: true, weight: 1.5 },
                head_shoulders:       { enabled: true, weight: 1.6 },
                trendline_formation:  { enabled: true, weight: 1.3 },
                flag:                 { enabled: true, weight: 1.3 }
            }
        },

        /* ---------------------------------------------------------------
         * Regime detection — D1 §5.
         * --------------------------------------------------------------- */
        regime: {
            trendingAdx: 25,
            rangingAdx: 20,
            squeezeBandwidthPct: 5,
            choppyAtrPercentile: 0.70,   // ATR high but ADX low => chop
            atrPercentileLookback: 100
        },

        /* ---------------------------------------------------------------
         * Trend engine (Phase 4).
         * Every stabilisation mechanism is configurable and documented.
         * --------------------------------------------------------------- */
        trend: {
            /* --- dimension sensitivity (all scale-free, expressed in ATR) --- */
            deadband: 0.08,            // |signal| below this counts as neutral
            emaDistanceAtr: 1.5,       // price-to-EMA distance that saturates the signal
            emaSeparationAtr: 1.0,     // EMA20-EMA50 separation that saturates
            macdHistAtr: 0.25,         // MACD histogram size that saturates
            slopeWindow: 8,            // bars used for every slope regression
            slopeAtrPerBar: 0.08,      // slope that saturates the signal
            adxSlopePerBar: 0.6,

            /* --- maturity / exhaustion --- */
            maturityBarsCap: 60,       // bars since last break at which a trend reads fully mature
            matureExtensionAtr: 6.0,   // distance from EMA200 that reads fully extended
            chochRecencyBars: 15,      // a CHoCH stays 'recent' for this many bars

            /* --- STABILITY: Schmitt-trigger hysteresis ---
             * enterThreshold > exitThreshold creates the hysteresis band that
             * prevents oscillation. confirmBars requires the signal to PERSIST. */
            enterThreshold: 0.30,      // |signal| needed to enter a directional state
            exitThreshold: 0.15,       // |signal| below which a state may be left
            confirmBars: 3,            // consecutive qualifying bars required
            promoteBars: 5,            // bars in TRANSITION before promotion to TREND
            rangeBars: 5,              // consecutive flat bars before declaring RANGE
            stabilityBars: 20,         // bars in state at which stability saturates
            stabilityWeight: 0.2,      // how much stability contributes to confidence

            /* --- synthesis --- */
            dimensionWeights: {
                shortTerm: 0.15, mediumTerm: 0.25, longTerm: 0.25,
                structural: 0.20, momentum: 0.15
            },
            probabilityTemperature: 0.5, // softmax temperature for outcome probabilities
            htfWeakThreshold: 0.35,      // below this the HTF can be outvoted (rule R2)
            rangeSuppressConfidence: 0.3 // min regime confidence to suppress direction in a range
        },

        /* ---------------------------------------------------------------
         * Scoring weights.
         *
         * Layer weights per regime implement D1 §7.2 (combinations by market
         * condition) and the Conflict-1 resolution: oscillators are demoted in
         * trending regimes and promoted only when RANGING.
         * --------------------------------------------------------------- */
        scoring: {
            layerWeights: {
                TRENDING: { trend: 0.42, momentum: 0.18, volume: 0.16, structure: 0.24 },
                RANGING:  { trend: 0.16, momentum: 0.38, volume: 0.14, structure: 0.32 },
                BREAKOUT: { trend: 0.34, momentum: 0.16, volume: 0.28, structure: 0.22 },
                CHOPPY:   { trend: 0.28, momentum: 0.22, volume: 0.18, structure: 0.32 },
                NEWS:     { trend: 0.24, momentum: 0.16, volume: 0.22, structure: 0.38 }
            },

            /* Per-indicator weights inside each layer.
             * Seeded from D1 §1.2's profit-factor column (the one table reporting a
             * sample size) and adjusted by the Conflict-1 / Conflict-4 resolutions:
             * Donchian promoted (D2 rank 1); RSI/BB capped as non-primary. */
            trend: {
                donchianBreakout: 2.4,   // D2 §9 rank 1 — strongest BTC evidence
                superTrend:       2.4,   // D1 §1.2 profit factor 2.4
                emaStack:         2.1,   // D1 §1.2 moving averages PF 2.1
                ichimoku:         1.7,
                psar:             1.2,
                vwap:             1.6,
                adxDirection:     1.5
            },
            momentum: {
                macd:       1.9,         // D1 §1.2 PF 1.9
                rsi:        1.9,         // D1 §1.2 PF 1.9 (regime-gated, see cap)
                stochastic: 1.2,
                cci:        1.1,
                williamsR:  0.9,
                roc:        1.0,
                momentum:   0.8
            },
            volume: {
                obv:            1.6,
                mfi:            1.3,
                cmf:            1.3,
                relativeVolume: 1.5,
                vwmaDivergence: 1.0
            },
            structure: {
                bos:             2.0,
                choch:           2.0,
                swingSequence:   1.8,
                fvg:             1.8,    // D1 §1.2 FVG PF 1.8
                orderBlock:      1.7,
                liquiditySweep:  1.7,    // D1 §1.2 sweeps PF 1.7
                srProximity:     1.6,
                fibConfluence:   1.4,
                candlePattern:   1.2,
                chartPattern:    1.3
            },

            /* Conflict-1 guard: mean-reversion oscillators alone must never
             * produce more than a Weak signal. */
            oscillatorOnlyCap: 0.34,

            /* Multi-timeframe weights — D1 §1.4 "higher timeframe bias is king". */
            timeframeWeights: { htf: 0.45, mtf: 0.33, ltf: 0.22 },
            mtfAgreementBonus: 0.12,
            mtfConflictPenalty: 0.18,

            minContributors: 6,          // below this, confidence is damped
            blockingProximityAtr: 1.0    // an opposing level nearer than this counts against quality
        },

        /* ---------------------------------------------------------------
         * Multi-timeframe consensus arbitration (Phase 9).
         * Consensus is a STRATEGIC DECISION LAYER, not an extra score: it
         * can strengthen, weaken, downgrade or block a recommendation, and
         * every outcome is reported. Thresholds are calibration parameters.
         * --------------------------------------------------------------- */
        mtf: {
            required: true,             // a recommendation may not finalise without evaluating consensus
            strongAgreement: 0.99,      // full agreement across available timeframes
            weakAgreement: 0.50,        // below this, consensus is treated as fractured
            minConsensusConfidence: 0.35,
            minQuality: 0.40,           // below this, consensus is too thin to act on
            blockOnOpposition: true,    // opposing consensus blocks rather than downgrades
            oppositionBlockConfidence: 0.45, // consensus confidence needed to block outright
            strengthenConfidenceBonus: 6,    // percentage points, applied on full alignment
            weakenConfidencePenalty: 10,     // percentage points, fractured consensus
            opposeConfidencePenalty: 22,     // percentage points, opposing consensus
            allowBandPromotion: false,  // alignment never promotes a band, only confidence
            demoteOnOpposition: true    // opposing consensus demotes the band one step
        },

        /* ---------------------------------------------------------------
         * Recommendation banding.
         * --------------------------------------------------------------- */
        recommendation: {
            bands: [
                { min:  0.55, label: 'Strong Buy',  direction: 'BUY'     },
                { min:  0.28, label: 'Buy',         direction: 'BUY'     },
                { min:  0.10, label: 'Weak Buy',    direction: 'BUY'     },
                { min: -0.10, label: 'Neutral',     direction: 'NEUTRAL' },
                { min: -0.28, label: 'Weak Sell',   direction: 'SELL'    },
                { min: -0.55, label: 'Sell',        direction: 'SELL'    },
                { min: -1.01, label: 'Strong Sell', direction: 'SELL'    }
            ],
            minConfidence: 0,
            maxConfidence: 95,
            /* Band-edge damping (Phase 7 stability). A stronger band is only
             * claimed when the score clears the boundary by bandEdgeMargin OR
             * confidence exceeds bandEdgeConfidence. */
            bandEdgeMargin: 0.04,
            bandEdgeConfidence: 0.55,           // never claim certainty (D2 / CFTC)
            choppyConfidenceCap: 45,     // D1 §5.4 "avoid or reduce size"
            lowDataConfidenceCap: 55,
            belowMinRRPenalty: 0.5
        },

        /* ---------------------------------------------------------------
         * Risk management — D1 §6, D3 §5, D4 §Risk.
         * --------------------------------------------------------------- */
        risk: {
            defaultClass: 'forex',
            classes: {
                forex:  { atrStopMultiplier: 1.25, atrStopRange: [1.0, 1.5],
                          riskPerTradePct: 1.0, minRR: 2.0, maxLeverage: 30 },
                metal:  { atrStopMultiplier: 1.75, atrStopRange: [1.5, 2.0],
                          riskPerTradePct: 1.0, minRR: 2.0, maxLeverage: 20 },
                crypto: { atrStopMultiplier: 2.5,  atrStopRange: [2.0, 3.0],
                          riskPerTradePct: 1.0, minRR: 2.0, maxLeverage: 5 }
            },
            /* Entry construction models. */
            entry: {
                extensionPenaltyAtr: 3.0,  // execution quality decays over this extension
                maxPullbackAtr: 3.0,       // ignore pullback/retest zones beyond this
                pullbackInvalidAtr: 0.5,   // overshoot that voids a pullback entry
                pendingExpiryBars: 8,      // bars a pending trigger stays live
                breakoutBufferAtr: 0.15,   // buffer beyond a level for breakout entries
                retestLookbackBars: 30     // how far back a retest zone may have formed
            },
            structuralBufferAtr: 0.25,   // buffer beyond a protective swing
            invalidationBufferAtr: 0.4,  // buffer beyond the thesis-invalidating level
            volatilityTargetAtr: 1.5,    // base ATR multiple for volatility targets
            targetMergeAtr: 0.3,         // merge target candidates within this distance
            targetDecayAtr: 6.0,         // probability decay scale with distance
            blockingLevelPenalty: 0.75,  // probability multiplier per opposing level
            confluenceBonus: 0.08,       // confidence added when methods agree
            minTargetR: 0.8,             // ignore targets below this R
            minTargetStepR: 0.5,         // each target must clear the last by this R
            holdingLookback: 30,
            holdingEfficiency: 0.45,     // fraction of ATR realised directionally per bar

            /* Trade qualification thresholds. Standing aside is a valid outcome. */
            qualification: {
                minConfidence: 0.35,
                minStrength: 0.15,
                marginalConfidence: 0.5,
                minAlignedPatterns: 1,
                maxConsolidationProb: 0.55,
                maxExhaustionProb: 0.55,
                maxOpposingDimensions: 3,
                highVolatilityPercentile: 0.85,
                marginalWarningCount: 2,
                highRiskWarningCount: 3,
                blockedRegimes: ['COMPRESSION']
            },            // D1 §6.3 ladder: 25% at 1:1, 25% at 1:2, 25% at 1:3, trail 25%.
            takeProfitLadder: [
                { rr: 1.0, closePct: 25 },
                { rr: 2.0, closePct: 25 },
                { rr: 3.0, closePct: 25 }
            ],
            trailingRunnerPct: 25,
            trailActivateAtRR: 1.0,      // D3 §5.4
            // Three stop tiers: tight structural, ATR-based, and wide invalidation.
            stopTiers: [
                { id: 'SL1', atrMultiplier: 1.0, basis: 'structure' },
                { id: 'SL2', atrMultiplier: 1.5, basis: 'atr' },
                { id: 'SL3', atrMultiplier: 2.5, basis: 'invalidation' }
            ],
            rangingRRCap: 1.5,           // D3 §3.2 mean reversion 1:1–1:1.5
            accountBalance: 10000,       // for position-size illustration only
            maxDrawdownPct: 20           // D1 §6.5
        },

        /* ---------------------------------------------------------------
         * News sentiment — confidence modifier only. Never a signal source.
         * --------------------------------------------------------------- */
        sentiment: {
            enabled: true,
            maxConfidenceShift: 8,       // percentage points, hard bound
            maxDirectionalScore: 0.25,   // hard cap on sentiment as a directional contributor
            alignBonus: 1.0,
            conflictPenalty: 1.0,
            neutralBand: 0.15,
            recencyHalfLifeHours: 12,
            minArticles: 3,
            lexicon: {
                bullish: ['surge','surges','surged','rally','rallies','rallied','soar','soars','soared',
                          'gain','gains','gained','jump','jumps','jumped','climb','climbs','climbed',
                          'rise','rises','rose','bullish','optimism','upgrade','upgraded','outperform',
                          'record high','breakout','inflow','inflows','accumulate','accumulation',
                          'boost','boosted','strengthen','strengthens','recovery','rebound','rebounds'],
                bearish: ['plunge','plunges','plunged','crash','crashes','crashed','slump','slumps',
                          'tumble','tumbles','tumbled','fall','falls','fell','drop','drops','dropped',
                          'decline','declines','declined','bearish','pessimism','downgrade','downgraded',
                          'underperform','selloff','sell-off','outflow','outflows','liquidation',
                          'weaken','weakens','weakened','slide','slides','slid','loss','losses','fear'],
                intensifiers: ['sharply','surging','massive','record','historic','steep','dramatic'],
                negators: ['not','no','never','without','fails','failed','despite','unlikely']
            }
        },

        /* ---------------------------------------------------------------
         * Timeframe mapping and multi-timeframe ladders.
         * --------------------------------------------------------------- */
        timeframes: {
            // dashboard interval value -> TwelveData interval + bar milliseconds
            map: {
                '1':   { api: '1min',  ms: 60000,    label: '1m' },
                '5':   { api: '5min',  ms: 300000,   label: '5m' },
                '15':  { api: '15min', ms: 900000,   label: '15m' },
                '30':  { api: '30min', ms: 1800000,  label: '30m' },
                '60':  { api: '1h',    ms: 3600000,  label: '1h' },
                '240': { api: '4h',    ms: 14400000, label: '4h' },
                'D':   { api: '1day',  ms: 86400000, label: '1D' }
            },
            // D3 §2.2 hierarchy: D1 bias, H4 momentum, H1 entry.
            ladders: {
                '1':   { ltf: '1',   mtf: '15',  htf: '60'  },
                '5':   { ltf: '5',   mtf: '30',  htf: '240' },
                '15':  { ltf: '15',  mtf: '60',  htf: '240' },
                '30':  { ltf: '30',  mtf: '240', htf: 'D'   },
                '60':  { ltf: '60',  mtf: '240', htf: 'D'   },
                '240': { ltf: '240', mtf: 'D',   htf: 'D'   },
                'D':   { ltf: 'D',   mtf: 'D',   htf: 'D'   }
            },
            enableMultiTimeframe: true
        },

        /* ---------------------------------------------------------------
         * Trading sessions (UTC) — D1 §8.
         * --------------------------------------------------------------- */
        sessions: {
            asian:   { start: 0,  end: 8  },
            london:  { start: 8,  end: 16 },
            newYork: { start: 13, end: 21 },
            overlap: { start: 13, end: 16 }
        },

        /* ---------------------------------------------------------------
         * Symbol registry: maps dashboard symbols to provider symbols and
         * risk classes. Extends the dashboard's PAIRS without altering it.
         * --------------------------------------------------------------- */
        symbols: {
            'COINBASE:BTCUSD': { td: 'BTC/USD', class: 'crypto', newsQuery: 'Bitcoin OR BTC',
                                 base: 'BTC', quote: 'USD', hasVolume: true },
            'OANDA:XAUUSD':    { td: 'XAU/USD', class: 'metal',  newsQuery: 'gold price OR XAUUSD',
                                 base: 'XAU', quote: 'USD', hasVolume: false },
            'FX:EURUSD':       { td: 'EUR/USD', class: 'forex',  newsQuery: 'euro OR ECB OR EURUSD',
                                 base: 'EUR', quote: 'USD', hasVolume: false },
            'FX:GBPUSD':       { td: 'GBP/USD', class: 'forex',  newsQuery: 'pound sterling OR GBPUSD',
                                 base: 'GBP', quote: 'USD', hasVolume: false },
            'FX:USDJPY':       { td: 'USD/JPY', class: 'forex',  newsQuery: 'yen OR Bank of Japan OR USDJPY',
                                 base: 'USD', quote: 'JPY', hasVolume: false },
            'FX:AUDUSD':       { td: 'AUD/USD', class: 'forex',  newsQuery: 'Australian dollar OR AUDUSD',
                                 base: 'AUD', quote: 'USD', hasVolume: false },
            'FX:GBPJPY':       { td: 'GBP/JPY', class: 'forex',  newsQuery: 'pound yen OR GBPJPY',
                                 base: 'GBP', quote: 'JPY', hasVolume: false },
            'FX:USDCAD':       { td: 'USD/CAD', class: 'forex',  newsQuery: 'Canadian dollar OR USDCAD',
                                 base: 'USD', quote: 'CAD', hasVolume: false },
            'FX:NZDUSD':       { td: 'NZD/USD', class: 'forex',  newsQuery: 'New Zealand dollar OR NZDUSD',
                                 base: 'NZD', quote: 'USD', hasVolume: false },
            'FX:USDCHF':       { td: 'USD/CHF', class: 'forex',  newsQuery: 'Swiss franc OR USDCHF',
                                 base: 'USD', quote: 'CHF', hasVolume: false },
            'FX:EURAUD':       { td: 'EUR/AUD', class: 'forex',  newsQuery: 'euro Australian dollar',
                                 base: 'EUR', quote: 'AUD', hasVolume: false }
        },

        /* ---------------------------------------------------------------
         * Backtesting subsystem (consumed by backtest/, never by the engine).
         * --------------------------------------------------------------- */
        backtest: {
            warmupBars: 210,           // must exceed the slowest indicator lookback
            stride: 1,                 // evaluate every Nth bar (raise to cut cost)
            maxBarsInTrade: 60,        // time stop
            breakevenAfterTP1: true,   // move stop to entry once TP1 pays
            walkForward: {
                inSampleBars: 150,
                outOfSampleBars: 60
            }
        },

        /* Numerical tolerance used by every float comparison in the engine. */
        epsilon: 1e-10
    };

    /** Deep-freeze so no engine stage can mutate strategy parameters at runtime. */
    function deepFreeze(obj) {
        Object.getOwnPropertyNames(obj).forEach(function (key) {
            var value = obj[key];
            if (value && typeof value === 'object' && !Object.isFrozen(value)) deepFreeze(value);
        });
        return Object.freeze(obj);
    }

    root.QT = root.QT || {};
    root.QT.CONFIG = deepFreeze(CONFIG);

    /** Returns a mutable deep copy for callers that need to override parameters. */
    root.QT.cloneConfig = function () {
        return JSON.parse(JSON.stringify(CONFIG));
    };

})(typeof globalThis !== 'undefined' ? globalThis : this);

if (typeof module !== 'undefined' && module.exports) {
    module.exports = (typeof globalThis !== 'undefined' ? globalThis : this).QT.CONFIG;
}
