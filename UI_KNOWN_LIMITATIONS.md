# UI Known Limitations — Presentation Layer v1.1

Honest limitations. None of these are defects in the analytical engine; they are
constraints or deliberate scope choices in the presentation layer.

## Data availability (never fabricated)
- **Single stop, not a ladder.** The engine's recommendation object exposes one
  tiered stop (`rec.trade.stop`, e.g. id `SL2`). The hero requested "SL1/SL2/SL3";
  because only one stop exists, exactly **one** Stop Loss is rendered. No SL1/2/3
  ladder is fabricated.
- **No live price series in the object.** The recommendation object carries no
  time-series of prices, so there are **no sparklines**. "Current price" is the
  last close, passed as an optional display-only render argument.
- **Live prices come from TradingView, not the engine.** The ticker tape and
  chart show live quotes via TradingView embeds (visualisation only). The engine
  analyses bar history through the proxy; it is not a live-quote source.

## External dependencies / environment
- **TradingView requires network.** The chart and ticker tape load from
  TradingView's CDN. Offline or CDN-blocked, they show their own loading/empty
  state; the chart panel still occupies its space and the rest of the app works.
  This is the only external runtime dependency in the browser.
- **Proxy required for real analysis.** `Analyze` calls the proxy
  (`/api/v1/bundle`). The proxy **server** is not part of this repository
  snapshot (it is referenced by `qt-app.js` and reviewed in `PROXY-REVIEW.md`).
  Without a running proxy, `Analyze` surfaces a clear "Unreachable" error state.

## Layout / responsive
- **Very small screens** (≈≤380px, or short landscape phones) make the header
  wrap to multiple rows, reducing the height available to the chart/analysis.
  This is spec-permitted ("unavoidable on extremely small devices"); the page
  still never scrolls — content scrolls internally.
- **Headless measurement floor.** Some headless-Chromium builds enforce a ~500px
  minimum window width for `--window-size`; true sub-500px verification was done
  via the DevTools Protocol viewport override, which has no such floor.

## Deliberate scope choices (not bugs)
- **Provider status is connection state, not a health dashboard.** The header
  connection chip reflects the real observed outcome of the last `Analyze`
  (idle/connecting/connected/unreachable). A richer provider-health panel needs a
  proxy health endpoint that does not exist yet — deferred to the proxy milestone
  rather than faked.
- **No global keyboard shortcuts** for workspace/symbol switching. The tablist
  and all controls are fully keyboard-accessible; global hotkeys were left out to
  avoid conflicts and were not needed for the core workflow.
- **Snapshot is self-contained, not a live quote widget.** The earlier
  single-quote TradingView widget flashed a large white loading box and
  duplicated the ticker tape, so the sidebar (and that widget) were removed to
  make the chart dominant.

## Testing gaps (acknowledged)
- The live TradingView widgets and a real proxy round-trip are not exercised by
  the automated suite (they need network / a running server). Everything the
  presentation layer itself controls is covered; see
  [UI_TEST_RESULTS.md](UI_TEST_RESULTS.md).
