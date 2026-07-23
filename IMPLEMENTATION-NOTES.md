# Implementation Notes

Running record of every change made outside the analysis engine itself, and of the
decisions behind them. Engine-side decisions live in `RESEARCH-SYNTHESIS.md`;
indicator evidence lives in `VALIDATION.md`.

---

## 2026-07-22 — Backend rebuild (`C:\trading-proxy`)

Approved in Decisions 1–3. Every change below was verified by running the server
and calling the endpoints; results are quoted inline.

### Files added

| File | Purpose |
|------|---------|
| `.gitignore` | `.env`, `node_modules/`, logs. **Previously missing** — three live keys were one `git init && git add .` away from being committed. |
| `src/config.js` | Centralized configuration. No other module reads `process.env`. Holds the symbol registry, interval map, MTF ladders, budgets, cache and CORS policy. |
| `src/core.js` | Structured logger, `ProxyError`, upstream status classifier, TTL+LRU cache, sliding-window budget governor, request coalescer. |
| `src/http.js` | Upstream client: timeout, bounded retry, status preservation, budget enforcement, coalescing, caching. |
| `src/providers.js` | Provider abstraction + normalization + **observed** capability detection. Registry is the extension point for future providers. |
| `src/routes.js` | `/api/v1/*` (standard envelope) and `/api/*` (legacy, unchanged contracts). |
| `tests/proxy.test.js` | 21 deterministic tests. No network, no keys. |

`server.js` was rewritten as a thin composition root. `package.json` gained
`main: server.js` (previously pointed at a non-existent `index.js`) and
`start` / `test` scripts.

### Defects fixed

**1. `/api/rates` was dead (PROXY-REVIEW §3).**
Line 79 held 3,644 characters of rendered KaTeX HTML instead of the template
literal — the file had been pasted from rendered Markdown. The API key and base
currency were never interpolated. Restored from `Proxy.md` line 112 and moved
into `providers.exchangerate.latest()`.

- Before: `{"error":"Failed to fetch exchange rates"}` HTTP 500 on every call.
- After: `{"result":"success","time_last_update_unix":1784678401,…}` HTTP 200.

**2. Upstream status codes were flattened to 500 (PROXY-REVIEW §8).**
Every route used `catch { res.status(500) }`, destroying the distinction my
Phase 1 client depends on: 5xx/429 are transient (retry), 4xx are permanent
(fail fast). Replaced with `classifyUpstream()` and a typed error envelope.

- Before: bad symbol → `500 {"error":"Failed to fetch price data"}`
- After: `400 {"ok":false,"error":{"code":"UNKNOWN_SYMBOL","message":"Unknown symbol \"NOPE\"","retryable":false,…}}`

Providers that answer **HTTP 200 with an error body** (TwelveData
`{status:'error'}`, ExchangeRate `{result:'error'}`) are detected too, so a
soft failure is no longer cached as if it were data.

**3. No timeouts.** A slow upstream held a socket indefinitely. Now
`UPSTREAM_TIMEOUT_MS` (default 15 s) per request, surfaced as `UPSTREAM_TIMEOUT` / HTTP 504.

**4. CORS was wide open.** `app.use(cors())` accepted every origin while
`Proxy.md` claimed the opposite. Now an explicit allow-list from
`ALLOWED_ORIGINS`, with `CORS_ALLOW_ALL=true` as a deliberate opt-out that logs
a warning at boot. Requests without an `Origin` header (curl, server-to-server)
still pass, so nothing operational broke.

### Capabilities added

- **Server-side cache.** TTL scales with bar interval — a closed 1 h bar is
  immutable for an hour. Bounded LRU, hit-rate reported by `/api/v1/health`.
- **Upstream budget governor.** Sliding window per provider (TwelveData 8/min).
  Requests defer rather than burning quota and eating a 429.
- **Request coalescing.** Concurrent identical requests share one upstream call —
  material during a bundle fetch. Verified: three concurrent callers → one call.
- **Bounded retry with backoff**, transient failures only.
- **Structured logging** with request id, path, status, latency, symbol, interval.
  Every response carries `X-Request-Id`.
- **Inbound rate limiting** (120 req/min/IP default) to protect the upstream quota.
- **Graceful shutdown**, boot-time key validation, `helmet`-style header hygiene
  (`x-powered-by` disabled).

### New endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /api/v1/health` | Status, provider configuration, cache hit-rate, remaining quota, counters |
| `GET /api/v1/meta/symbols` | Symbol registry + intervals + ladders — one authority shared with the frontend |
| `GET /api/v1/ohlcv` | Canonical ascending numeric bars + observed capabilities |
| `GET /api/v1/price` | Normalized last price |
| `GET /api/v1/news` | Symbol-aware news (accepts `symbol`, maps to the registry query) |
| `GET /api/v1/spot` | ExchangeRate cross-check for forex pairs |
| **`GET /api/v1/bundle`** | **Everything for one analysis in a single request** |

Legacy `/api/health`, `/api/price`, `/api/timeseries`, `/api/news`, `/api/rates`
keep their original response shapes and now inherit caching, retry and timeouts.

### Bundle performance

`GET /api/v1/bundle?symbol=COINBASE:BTCUSD&timeframe=60` — measured:

```
ladder: {"ltf":"60","mtf":"240","htf":"D"}
  ltf: 60  -> 499 bars
  mtf: 240 -> 499 bars
  htf: D   -> 499 bars
news articles: 50
capabilities: {"ohlc":true,"volume":false,"news":true,"spot":false}
real 0m3.464s
```

One HTTP request replaces 4–5 round trips. Partial failure is non-fatal: only
the primary timeframe is required; anything else degrades into `warnings` and
`meta.partialErrors`.

### Standard response envelope

```jsonc
{ "ok": true, "apiVersion": "v1", "requestId": "…", "timestamp": "…",
  "data": { … }, "capabilities": { … }, "warnings": [ … ], "meta": { … } }
```
```jsonc
{ "ok": false, "apiVersion": "v1", "requestId": "…", "timestamp": "…",
  "error": { "code", "message", "upstreamStatus", "retryable", "provider", "details" } }
```

---

## Decision 2 — capability-aware analysis (design record)

Rejected: hard-coding the engine to three layers because today's provider omits
volume. Adopted: **capabilities are observed per analysis and the scoring engine
normalizes across whatever is genuinely available.**

Detection is evidence-based, never assumed. `volume` is reported `true` only when
the payload carries a volume field **and** at least one non-zero value. Three
tests pin this down: field present with data → `true`; field absent → `false` +
warning; field present but all zeros → `false` + warning. Bars still expose
`volume: 0` for shape stability, but the capability flag — not the zero — is what
the engine consumes.

Measured today: `{"ohlc":true,"volume":false,"news":true,"spot":false}` for
BTC/USD, so Layer 3 will be excluded and its weight redistributed across the
remaining layers, with the exclusion reported in the explainability output. If a
provider later supplies volume, the capability flips to `true` and Layer 3
re-enters automatically — **no engine change**.

Binance was **not** added, per instruction. The provider registry in
`src/providers.js` is the extension point: a new source implements
`timeSeries()` and registers itself.

---

## Outstanding / deferred

- `helmet` and `compression` are not installed (would add dependencies); header
  hygiene is handled manually for now.
- The inbound rate limiter is in-process. A multi-instance deployment would need
  a shared store; single-laptop deployment does not.
- `Proxy.md` still documents the original single-file design. It is retained as
  the historical record — and as the source that made the line-79 recovery
  possible — rather than edited.

## Verification status

| Suite | Result |
|-------|--------|
| Proxy (deterministic) | **21/21** |
| Engine Phase 1 — data layer | **59/59** |
| Engine Phase 2 — indicators | **143/143** |
| Indicator cross-validation vs oracle | **30/30 series** |
