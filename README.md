# Quantitative Trading Analysis Platform

A deterministic, research-driven market analysis engine with a TradingView dashboard front end. TradingView provides visualisation only — **every calculation is performed independently** by a zero-dependency JavaScript engine.

> **Educational analysis only. Not financial advice.** The engine measures how well current market conditions match a configured strategy. It makes no profitability claim and has not been validated by statistically significant backtesting.

---

## What it does

Select a symbol and timeframe, press **Analyze**, and the engine produces a fully explainable recommendation: direction, confidence, market regime, a constructed trade (entry / 3 stop tiers / 3 targets), risk metrics including probability-adjusted expected value, and a complete evidence trail showing exactly which factors drove the decision and which opposed it.

It is equally willing to conclude **No Trade** — refusing is a first-class outcome, not a failure.

---

## Quick start

**Prerequisites:** Node.js ≥ 18 (developed on v24.15.0), npm ≥ 9.

```bash
# 1. Backend gateway — holds all API keys
cd C:\trading-proxy
npm install
copy .env.example .env          # then edit .env (see below)
npm start                       # -> http://localhost:3001

# 2. Dashboard (separate terminal)
cd path\to\FOREX
npm install                     # dev dependency only (jsdom, for tests)
npm run serve                   # -> http://localhost:8322/dashboard.html
```

**Zero keys still works.** Binance (crypto OHLCV *with volume*), Frankfurter and exchangerate.host (FX), Alternative.me, Blockchain.com and DefiLlama are all keyless. Add `TWELVEDATA_API_KEY` for forex/metals and `NEWSAPI_KEY` for sentiment. See `C:\trading-proxy\.env.example` — every variable is documented as required / optional / auto-detected.

Check what is actually live: `GET http://localhost:3001/api/v1/capabilities`

---

## Architecture

```
Browser (dashboard.html)          presentation only — zero analysis
  └─ qt-app.js                    orchestration — no maths
       ↓ HTTP
  Node Gateway :3001              sole holder of API keys, 11 providers
       ↓ normalised OHLCV + observed capabilities
  ENGINE (18 modules, QT.* namespace, no build step)
   indicators → patterns → trend → risk → scoring → recommendation
       ↓
  qt-card.js                      renders the recommendation object
       ↕
  backtest/                       independent; consumes the engine as a user
```

**Three rules the codebase enforces by test:**
1. The presentation layer never calculates. If a display needs a value, it goes in the engine.
2. Each phase consumes the previous phase's output and recalculates nothing.
3. No `Math.random`, no `Date.now` in any analysis path — identical inputs always produce identical output.

---

## Testing

```bash
npm test                    # 1276 assertions across 9 phases
cd C:\trading-proxy && npm test   # 21 proxy assertions
```

Indicators are cross-validated against the `technicalindicators` npm package — **30/30 series matched** on 600 real BTC/USD daily bars (`VALIDATION.md`). That library is a test oracle only and is never shipped.

---

## Deployment (Windows + IIS + Cloudflare Tunnel)

### Prerequisites
| Requirement | Notes |
|---|---|
| Node.js ≥ 18 | for the gateway |
| IIS with static content | serves the dashboard |
| **URL Rewrite 2.1** | [download](https://www.iis.net/downloads/microsoft/url-rewrite) |
| **ARR 3.0** | [download](https://www.iis.net/downloads/microsoft/application-request-routing) — then enable: IIS Manager → server node → *Application Request Routing Cache* → *Server Proxy Settings* → tick **Enable proxy** |

Without ARR the dashboard still works — point the browser at `:3001` directly and add that origin to `ALLOWED_ORIGINS`.

### Sequence
1. Copy the project folder to the target machine (no absolute paths — it is portable).
2. `cd trading-proxy && npm ci` — reproducible install from the lockfile.
3. Create `.env` from `.env.example`; fill in keys.
4. Start the gateway: `npm start`, or as a service: `npm i -g pm2 && pm2 start server.js --name trading-proxy && pm2 save`.
5. Point an IIS site at the dashboard folder. `web.config` is already present.
6. Verify: `http://localhost/api/v1/health` should return provider health.
7. Cloudflare Tunnel: route the hostname to `http://localhost:80`, then set `ALLOWED_ORIGINS=https://yourdomain.com` in `.env` and restart the gateway.

### Firewall
Only IIS (80/443) needs to be reachable. The gateway binds `127.0.0.1:3001` and should **not** be exposed directly.

### 🔴 Before exposing publicly
**The gateway has no authentication.** Anyone who reaches the hostname can consume your API quota. This is the top-priority task for the next session (see `PROJECT-ROADMAP.md` §7, task C1). Until then, keep the tunnel private or restrict it with Cloudflare Access.

### Rollback
The project is stateless — no database, no migrations. Roll back by restoring the previous folder and restarting the gateway. Caches are in-memory and rebuild automatically.

### Troubleshooting
| Symptom | Cause / fix |
|---|---|
| "Could not reach the proxy" | Gateway not running → `npm start` in `trading-proxy` |
| `PROVIDER_NOT_CONFIGURED` | Missing key in `.env` |
| Engine scripts 404 under IIS | MIME map missing — confirm `web.config` deployed |
| `/api/*` 404 under IIS | ARR not installed or proxy not enabled |
| CORS rejection | Add the origin to `ALLOWED_ORIGINS`, restart gateway |
| No volume for forex | Expected — only Binance (crypto) supplies volume |

---

## Documentation

| File | Purpose |
|---|---|
| **`PROJECT-ROADMAP.md`** | **Start here** — status, tasks, next-session bootstrap |
| `RESEARCH-SYNTHESIS.md` | Research conflicts and resolutions — the functional spec |
| `VALIDATION.md` | Indicator cross-validation evidence |
| `PRODUCTION-READINESS.md` | Readiness assessment; §12 covers MTF consensus |
| `IMPLEMENTATION-NOTES.md` | Change log + Architecture Evolution |
| `PROXY-REVIEW.md` | Original backend audit |

---

## Project status

**~78% complete.** Analytical engine and backtesting framework are finished and verified. Outstanding: proxy authentication (blocks public deployment), provider-failover testing, Strategy Validation Dashboard, and statistically significant backtesting.

See `PROJECT-ROADMAP.md` for the prioritised task list.
