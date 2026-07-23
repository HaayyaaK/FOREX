# Enterprise Production Quantitative Trading Analysis Engine — Complete Implementation Request

## Mission

You are an expert:

- Quantitative Trading Platform Architect
- Financial Software Engineer
- Quantitative Research Engineer
- Financial Mathematician
- Algorithmic Trading Developer
- JavaScript Software Architect
- UI/UX Engineer
- Performance Optimization Specialist
- Software Quality Engineer

Your mission is to transform the existing **Live Market Dashboard** into a **professional quantitative trading analysis platform**.

The final project must be production-grade, deterministic, modular, maintainable, and mathematically accurate.

Never produce demo code, placeholder implementations, simplified formulas, or proof-of-concept architecture.

---

# IMPORTANT PROJECT CONTEXT

The project already contains a working dashboard.

Do NOT redesign or replace it.

Preserve:

- TradingView widget
- Responsive UI
- Symbol selector
- Timeframe selector
- Existing layout
- Existing styling
- Existing user experience

Your task is to EXTEND the existing project instead of rebuilding it.

Only modify existing code when absolutely necessary.

---

# FIRST TASK — RESEARCH PHASE (MANDATORY)

Before writing or modifying any code:

Search the project root directory for all research documents.

Read every relevant **.md** file that contains information about:

- Trading strategies
- Indicator combinations
- Mathematical formulas
- Technical analysis
- Market structure
- Risk management
- Fibonacci
- Trend analysis
- Support & Resistance
- Candlestick analysis
- Smart Money Concepts
- Quantitative trading
- Algorithmic trading
- Professional trading methodologies

Treat those research documents as the project's functional specification.

Your implementation must be based on those research findings whenever they provide guidance.

Do not blindly implement generic internet strategies if the research files specify a preferred methodology.

If multiple research files contain complementary ideas, intelligently synthesize them into one coherent quantitative analysis model.

If conflicts exist between documents:

- Explain the conflict.
- Choose the mathematically stronger approach.
- Document your reasoning.

---

# ARCHITECTURE

TradingView Widget

↓

Visualization Layer Only

↓

Analyze Button

↓

Market Data Layer

↓

Indicator Engine

↓

Pattern Recognition Engine

↓

Market Structure Engine

↓

Trend Engine

↓

Support & Resistance Engine

↓

Fibonacci Engine

↓

Risk Management Engine

↓

News Sentiment Engine

↓

Weighted Scoring Engine

↓

Recommendation Engine

↓

Recommendation Card

---

# TRADINGVIEW

The TradingView widget is ONLY the visualization layer.

Never attempt to extract internal indicator values from TradingView.

Never rely on TradingView calculations.

All mathematical calculations must be implemented independently.

---

# DATA SOURCES

## TwelveData

Primary market data provider.

Retrieve raw market data whenever possible.

Prefer:

- OHLCV
- Historical candles
- Latest price
- Multiple timeframes

Calculate indicators internally instead of relying on precomputed API indicators unless there is a compelling reason not to.

---

## ExchangeRate-API

Use only when appropriate as a supplementary forex data source or fallback.

---

## NewsAPI

Retrieve relevant financial news for the active symbol.

Convert news into a quantitative sentiment score.

News must never independently generate trading signals.

Sentiment should influence the confidence score only.

---

# ANALYSIS EXECUTION

The analyzer is NOT an AI agent.

The analyzer does NOT continuously run.

The analyzer executes ONLY when requested.

Workflow:

User selects:

- Symbol
- Timeframe

↓

User clicks

Analyze

↓

Collect required data

↓

Perform all calculations

↓

Generate recommendation

↓

Display recommendation card

---

# MARKET DATA LAYER

Implement:

- retries
- caching
- timeout handling
- validation
- normalization
- error recovery
- rate-limit awareness

Minimize unnecessary API requests.

---

# MATHEMATICAL ENGINE

Implement production-grade mathematical formulas.

Avoid third-party indicator libraries whenever practical.

Implement indicators using authoritative mathematical definitions.

Support configuration of:

- periods
- smoothing methods
- thresholds
- weighting
- strategy parameters

All parameters must be configurable from one centralized configuration object.

---

# INDICATOR ENGINE

Implement robust versions of:

EMA

SMA

WMA

VWMA

RSI

MACD

ADX

ATR

CCI

ROC

Momentum

Bollinger Bands

Keltner Channels

Donchian Channels

Stochastic

Williams %R

OBV

MFI

CMF

VWAP

SuperTrend

Parabolic SAR

Ichimoku Cloud

Pivot Points

Volume analysis

Volatility analysis

Trend analysis

Additional indicators may be implemented if justified by the research documents.

---

# FIBONACCI ENGINE

Automatically detect swing highs and lows.

Calculate:

- Retracements
- Extensions
- Expansions

Generate exact price levels.

---

# SUPPORT & RESISTANCE

Automatically detect:

- major support
- major resistance
- swing highs
- swing lows
- zones
- strength ranking

---

# PATTERN DETECTION

Support detection of:

- trend continuation
- trend reversal
- market structure
- break of structure
- change of character
- double top
- double bottom
- head and shoulders
- triangles
- wedges
- flags
- engulfing
- pin bars
- inside bars

Additional patterns may be implemented if supported by the research.

---

# TREND ENGINE

Determine:

- Bullish
- Bearish
- Neutral
- Trend strength
- Trend quality

---

# MULTI-TIMEFRAME ANALYSIS

Support confirmation across multiple timeframes.

Higher timeframes should generally carry greater weight unless the strategy documented in the research specifies otherwise.

---

# NEWS SENTIMENT

Convert news into:

- bullish score
- bearish score
- neutral score

Use sentiment only as a confidence modifier.

Never allow sentiment alone to produce a BUY or SELL recommendation.

---

# WEIGHTED SCORING ENGINE

Implement a configurable quantitative scoring model.

Indicators may agree or disagree.

Each indicator should contribute according to configurable weights.

The final engine should calculate:

- Buy probability
- Sell probability
- Neutral probability
- Trade quality score
- Confidence percentage

Avoid simple indicator counting.

Use weighted quantitative analysis.

---

# RISK MANAGEMENT

Calculate:

- Entry
- Exit
- TP1
- TP2
- TP3
- SL1
- SL2
- SL3
- Risk/Reward Ratio
- Volatility-adjusted stop loss
- ATR-based stop loss

---

# RECOMMENDATION ENGINE

Possible outputs:

- Strong Buy
- Buy
- Weak Buy
- Neutral
- Weak Sell
- Sell
- Strong Sell

Every recommendation must include:

- reasoning summary
- confidence percentage
- contributing indicators
- conflicting indicators
- primary risk factors

---

# RECOMMENDATION CARD

Display:

- Recommendation
- Confidence %
- Trend
- Trend Strength
- Entry
- Exit
- TP1
- TP2
- TP3
- SL1
- SL2
- SL3
- Support Levels
- Resistance Levels
- Fibonacci Levels
- Risk / Reward Ratio
- Volatility
- News Sentiment
- Indicator Summary
- Reasoning Summary
- Timestamp
- Active Symbol
- Active Timeframe

---

# SOFTWARE ENGINEERING REQUIREMENTS

Implement the project in clearly defined phases.

Recommended implementation order:

Phase 1

Market Data Layer

↓

Phase 2

Mathematical Indicator Engine

↓

Phase 3

Pattern Detection

↓

Phase 4

Trend & Market Structure

↓

Phase 5

Risk Management

↓

Phase 6

Weighted Scoring Engine

↓

Phase 7

Recommendation Engine

↓

Phase 8

Recommendation Card UI

Each phase must be fully completed and verified before beginning the next.

---

# VALIDATION

Validate every implemented indicator by comparing its output against trusted references using identical OHLCV data.

Document any unavoidable deviations.

---

# CONFIGURATION

All strategy settings must be centralized, including:

- indicator periods
- thresholds
- smoothing methods
- scoring weights
- confidence thresholds
- risk settings

The trading strategy should be adjustable without modifying the analysis engine itself.

---

# DETERMINISTIC BEHAVIOR

The analyzer must be deterministic.

Given the same:

- market data
- configuration
- strategy

it must always produce the same result.

No randomness.

No hidden AI decisions.

No non-repeatable outputs.

---

# TESTING

Create a reusable validation dataset from historical market snapshots.

Use it to verify that future modifications do not unintentionally change indicator calculations or recommendation logic.

---

# CODE QUALITY

Production-grade only.

No placeholders.

No TODO comments.

No pseudo-code.

No mocked calculations.

No fake values.

No simplified implementations.

Keep responsibilities separated.

Design for long-term maintainability and extensibility.

---

# PERFORMANCE

Optimize for:

- minimal API requests
- fast execution
- efficient memory usage
- responsive UI
- scalable architecture

---

# FINAL DELIVERABLE

Produce a fully integrated implementation that extends the existing dashboard.

The user workflow must be:

1. Open the dashboard.
2. Select a trading symbol.
3. Select a timeframe.
4. Click **Analyze**.
5. Retrieve market and news data.
6. Execute all mathematical calculations internally.
7. Generate a deterministic, research-driven quantitative trading analysis.
8. Display a professional recommendation card while the TradingView widget continues to serve as the visualization layer.
