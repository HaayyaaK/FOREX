# Backend Review — `C:\trading-proxy`

*Prepared before Phase 3, as the gating deliverable for engine↔proxy integration.*
*All findings below were verified by running the server and calling its endpoints live.*

---

## 1. Current architecture summary

A single-file Express 5 application (`server.js`, 96 lines) acting as a thin credential-hiding passthrough.

```
Browser ──► Express :3001 ──► TwelveData / NewsAPI / ExchangeRate-API
```

| Item | Value |
|------|-------|
| Runtime | Node.js, CommonJS |
| Framework | Express `^5.2.1` |
| HTTP client | axios `^1.18.1` |
| Config | dotenv `^17.4.2` |
| CORS | cors `^2.8.6` |
| Port | `process.env.PORT` → 3001 |
| Structure | One file, no routers, no services, no middleware layer, no tests |

The design intent (documented in `Proxy.md`) is sound and matches the requirement that the frontend never holds API keys. The **implementation is an early scaffold** — it forwards requests correctly but implements none of the resilience or caching responsibilities the dashboard needs.

---

## 2. Existing API routes

| Route | Upstream | Live status |
|-------|----------|-------------|
| `GET /api/health` | — | ✅ works — `{"status":"ok","timestamp":…}` |
| `GET /api/price?symbol=` | TwelveData `/price` | ✅ works — returned `{"price":"66337.99"}` |
| `GET /api/timeseries?symbol=&interval=&outputsize=` | TwelveData `/time_series` | ✅ works — returns raw DESC string values |
| `GET /api/news?q=&pageSize=` | NewsAPI `/everything` | ✅ reachable |
| `GET /api/rates?base=` | ExchangeRate-API | ❌ **broken — HTTP 500 on every call** |

---

## 3. 🔴 Blocking defect: `/api/rates` source corruption

**`server.js` line 79 is corrupted.** The template literal was replaced with 3,644 characters of *rendered KaTeX HTML* — the file was pasted from rendered Markdown rather than source. The line still parses as valid JavaScript (it is a plain template string), so `node --check` passes and the fault is silent until called.

The URL actually constructed at runtime is:

```
https://v6.exchangerate-api.com/v6/<span class="katex"><span class="katex-mathml">…
```

Verified: the API key is **never interpolated** (`false`), the base currency is **never interpolated** (`false`), and the resulting URL is 3,634 characters. Every call returns `{"error":"Failed to fetch exchange rates"}` with HTTP 500.

**The correct source still exists** in `Proxy.md` line 112:

```js
`https://v6.exchangerate-api.com/v6/${process.env.EXCHANGERATE_API_KEY}/latest/${base}`
```

This is a one-line restoration. I have **not** applied it yet — flagging first, per your instruction to document improvements before implementing them.

---

## 4. 🔴 Blocking finding: no volume data is available

Tested across all three instrument classes through the proxy:

| Symbol | Fields returned |
|--------|----------------|
| BTC/USD | `datetime, open, high, low, close` |
| EUR/USD | `datetime, open, high, low, close` |
| XAU/USD | `datetime, open, high, low, close` |

**TwelveData returns no `volume` field on this plan for any of the 11 dashboard symbols.**

This is an architectural constraint, not a bug, and it directly affects the engine: **Layer 3 of the 3-Layer Stack (Volume / Conviction — D1 §1.1) cannot be computed.** OBV, MFI, CMF, VWMA, relative volume and Volume Profile all become unavailable, and every research setup requiring *"volume > 1.5× average"* loses its confirmation leg.

The engine already handles this **correctly and honestly** — `computeAll` detects `hasVolume === false` and suppresses those indicators rather than zero-filling them (asserted by a passing Phase 2 test: *"zero-volume instruments do not produce fabricated volume readings"*). But the Phase 6 scoring model must **renormalise its layer weights** across the three surviving layers, otherwise the volume layer contributes a silent zero and biases every score toward Neutral.

Three ways forward, in preference order:

1. **Renormalise to three layers** when volume is absent, and mark the recommendation as *volume-unconfirmed* in the explainability output. No new dependency, fully honest. **← my recommendation, will implement in Phase 6.**
2. Add a **Binance public klines** route to the proxy for crypto volume (free, keyless, genuine traded volume). Documented here as a proposal; needs your approval since it adds a provider.
3. Upgrade the TwelveData plan if it exposes volume for these symbols.

---

## 5. Middleware

| Middleware | Present |
|------------|---------|
| `cors()` | ✅ but unrestricted (see §9) |
| `express.json()` | ✅ (unused — all routes are GET) |
| Request logging | ❌ none |
| Error handler | ❌ no central handler |
| Rate limiting | ❌ none |
| Compression / helmet | ❌ none |
| Validation | ❌ none — query params passed upstream unchecked |

---

## 6. Caching

**None.** Every dashboard call reaches the upstream API. With TwelveData's free tier at **8 requests/minute**, a single multi-timeframe analysis (3 intervals) plus news consumes half the minute budget, and two users or a double-click will exhaust it. Server-side caching is the highest-value addition after the two blocking defects.

---

## 7. Environment variables

`.env` is present and correctly structured with all four values (`TWELVEDATA_API_KEY`, `NEWSAPI_KEY`, `EXCHANGERATE_API_KEY`, `PORT`). Keys are read only via `process.env` and never sent to the client — the core security goal is met.

⚠️ **No `.gitignore` exists** and the folder is not currently a git repository. If it is ever initialised, `.env` with three live keys would be committed on the first `git add .`. A `.gitignore` containing `.env` and `node_modules/` should be added **before** any version control is introduced.

There is no startup validation that the keys exist — a missing key surfaces as a generic 500 at request time rather than a clear boot error.

---

## 8. Logging & error handling

**Logging:** only the startup banner. No per-request logging, no upstream latency, no error detail. Diagnosing a failure currently requires reproducing it by hand.

**Error handling — this one materially breaks my client logic.** Every route uses the same pattern:

```js
catch (error) { res.status(500).json({ error: "Failed to fetch …" }); }
```

Every upstream failure is flattened to HTTP 500 with a generic string. Verified live: requesting a bad symbol returns

- **upstream:** HTTP 404, `"**symbol** parameter is missing or invalid…"` (actionable)
- **proxy:** HTTP 500, `"Failed to fetch price data"` (useless)

This is not cosmetic. My Phase 1 data layer classifies **5xx and 429 as transient (retry)** and **4xx as permanent (fail fast)** — a distinction verified by two passing tests. Because the proxy reports *everything* as 500, a permanently invalid symbol would be retried three times with backoff before failing, and a genuine 429 rate-limit is indistinguishable from a server fault. **Upstream status codes and messages must be preserved** for the client's resilience logic to function as designed.

---

## 9. Security observations

| # | Observation | Severity |
|---|-------------|----------|
| 1 | `app.use(cors())` allows **every origin**. `Proxy.md` §Security claims *"CORS configured to only allow your domain"* — the documentation and implementation disagree. Once exposed via Cloudflare Tunnel, anyone who learns the hostname can spend your API quota. | **High** |
| 2 | No rate limiting or authentication. A single scripted caller can exhaust the daily quota (800 req/day). | **High** |
| 3 | No `.gitignore`; live keys one `git init && git add .` away from being committed. | **Medium** |
| 4 | Query parameters forwarded upstream without validation or allow-listing. | **Medium** |
| 5 | No `helmet`, no request size limits, no timeout — a slow upstream holds a socket indefinitely. | **Medium** |
| 6 | `package.json` `main` points at `index.js`, which does not exist; no `start` script. Operational papercut. | **Low** |

---

## 10. Recommended improvements

Ordered by value. Nothing here has been implemented yet.

**Tier 1 — required before integration**
1. Restore line 79 from `Proxy.md` line 112 (fixes `/api/rates`).
2. Preserve upstream status codes and messages; map to a typed error envelope `{ error: { code, message, upstreamStatus, retryable } }`.
3. Per-request `axios` timeout (upstream currently has none).
4. Restrict CORS to the IIS origin + tunnel hostname via an env allow-list.

**Tier 2 — required for the dashboard to work within quota**
5. Server-side TTL cache keyed by `symbol+interval`, TTL scaled to the bar interval (a closed 1h bar is immutable for an hour).
6. Server-side rate-limit governor and request coalescing, so concurrent identical requests share one upstream call.
7. Response normalisation: return canonical ascending numeric OHLCV instead of raw DESC strings.
8. Structured request/error logging with latency.

**Tier 3 — hardening**
9. `.gitignore`, startup key validation, `helmet`, graceful shutdown, `start` script, health endpoint reporting cache/quota state.

---

## 11. New endpoints required by the dashboard

| Endpoint | Purpose | Why the existing routes don't suffice |
|----------|---------|--------------------------------------|
| `GET /api/ohlcv?symbol=&interval=&outputsize=` | Canonical bars: ascending, numeric, de-duplicated, forming bar flagged | `/api/timeseries` returns raw DESC strings; normalisation belongs server-side so it is done once and cached |
| `GET /api/bundle?symbol=&timeframe=` | **One** call returning the full MTF ladder (LTF/MTF/HTF) + news + spot | An analysis currently needs 4+ round trips; at 8 req/min this is the difference between working and rate-limited |
| `GET /api/meta/symbols` | Server-side symbol registry (provider symbol, class, news query) | Registry currently duplicated in `qt-config.js`; one authority prevents drift |
| `GET /api/health` *(extend)* | Report key presence, cache hit rate, remaining quota | Current health check proves the process is up but not that it can serve |

---

## 12. Integration plan (no frontend rework later)

`qt-data.js` was deliberately written with an **injectable transport** and provider-agnostic normalisation, so pointing it at the proxy is a configuration change, not a rewrite:

- Replace the three provider `baseUrl`s with a single `proxy.baseUrl`.
- Delete the `storageKey` credential path entirely — the browser will hold no keys at all, which is *stronger* than the localStorage design I built for Phase 1.
- `normalizeTwelveData()` stays as the fallback for `/api/timeseries`, and is bypassed when `/api/ohlcv` returns already-canonical bars.
- The existing 59 Phase 1 tests continue to run against the mock transport, unchanged.

---

## 13. Conclusion

The proxy is the **right architecture** and should be extended, not replaced. It is, however, an early scaffold with **two blocking issues** — a corrupted `/api/rates` route and the absence of volume data — plus missing caching, retry, timeout, rate limiting, logging and error fidelity.

**Awaiting your approval on three decisions before I touch it:**
1. Apply the Tier 1 fixes (including the one-line `/api/rates` restoration)?
2. How to handle the missing volume layer — renormalise to three layers *(recommended)*, or add a Binance klines route?
3. Add the `/api/bundle` endpoint, which is effectively required to stay inside the 8 req/min free-tier budget?
