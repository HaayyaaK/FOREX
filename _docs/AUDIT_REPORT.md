# Audit Report — dashboard.html, calc.html, validation.html, disclaimer.html

Scope: static source audit of the four root-level HTML files (7,915 lines
combined) plus `assets/site.webmanifest`. Verified against the automated
test suite (`node tests/run-all.js`, 1791/1791 passing at time of writing)
and static cross-file diffing. **Browser visual rendering could not be
confirmed this session** — the connected Chrome tab reports
`document.hidden: true` / a 0×0 viewport, an environment limitation, not a
site defect — so this report is source-level, not a rendered/visual QA
pass. Every finding below was actually located in the code; nothing here
is generic advice.

---

## 1. Detected Issues

### 1.1 disclaimer.html has two `<h1>` elements
`disclaimer.html:295` (brand mark, "KEEN") and `disclaimer.html:308`
(`<h1 class="doc-title">Disclaimer</h1>`). A page should expose exactly one
`<h1>` as its document-outline root; two competing top-level headings is
invalid heading semantics and confuses screen-reader users navigating by
heading level.

### 1.2 calc.html skips a heading level (h1 → h3, no h2)
`calc.html` has exactly one `<h1>` (the page title) and then 30 occurrences
of `<h3 class="card-title">` (one per calculator card, e.g. lines 677, 719,
771…) — there is no `<h2>` anywhere in the document. Jumping two levels
breaks the logical outline that assistive-technology users rely on to skim
the page by heading rank.

### 1.3 calc.html's tab UI is an incomplete ARIA-tabs pattern
`calc.html:638-665`: the container has `role="tablist"` and each button has
`role="tab"`, but:
- No button has an `id` or `aria-controls` pointing at its panel.
- No `<section class="tab-content">` panel (e.g. `id="tab-core"`, line 671)
  has `role="tabpanel"` or `aria-labelledby`.
- The default-active button (`data-tab="core"`, line 639) has no
  `aria-selected="true"` in the static markup — it's only ever set by the
  click handler (`calc.html:~2898-2901`).

### 1.4 calc.html: `aria-selected` is never set on initial load in the common case
`calc.html:2957-2968` (the init IIFE): if the tab restored from
`localStorage.getItem('calc.tab')` is `'core'` (the default, and also what
a first-time visitor gets), the code takes the `else { recalcAll(); }`
branch and **never calls `.click()`** — so no tab button ever receives
`aria-selected="true"`, leaving every tab marked unselected to assistive
tech until the user manually switches tabs at least once.

### 1.5 validation.html's async state changes are not announced
`validation.html:372-394`: `#emptyState` → `#loadingState` →
`#errorState`/`#results` are swapped via `showOnly()` with plain
`.hidden` toggling — none of the four containers carry `aria-live` or
`role="status"`. A screen-reader user gets no announcement when a backtest
starts, fails, or completes. This is a direct inconsistency with the same
codebase: `dashboard.html:2777` and `dashboard.html:2807` already use
`aria-live="polite"` (plus `role="status"` on the toast) for the equivalent
async-state-swap pattern.

### 1.6 Branding drift between the manifest name and the in-app UI — ✅ RESOLVED
`assets/site.webmanifest:2-3` previously carried a two-word product name
that predated the in-app rename to "KEEN" (seen at, e.g.,
`dashboard.html:2630`'s `aria-label` and `disclaimer.html:6`'s `<title>`),
so an installed PWA would have shown the old name in its install prompt,
home-screen label, and OS app-switcher while the in-app chrome said
"KEEN". **Fixed in the same pass that standardized the product name to
"KEEN" repo-wide** — the manifest's `name`/`short_name` now both read
"KEEN".

### 1.7 `dir="ltr"` is declared on only one of the four `<html>` tags
`disclaimer.html:2` is `<html lang="en" dir="ltr">`; `dashboard.html:2`,
`calc.html:2`, `validation.html:2` are all `<html lang="en">` with no
`dir`. Functionally inert (ltr is the default), but the attribute set on
the root element is inconsistent across otherwise design-unified pages.

### 1.8 `<!doctype html>` casing is inconsistent
`validation.html:1` is `<!DOCTYPE html>` (uppercase); `dashboard.html:1`,
`calc.html:1`, `disclaimer.html:1` are all `<!doctype html>` (lowercase).
Zero functional effect (HTML doctype matching is case-insensitive) — this
is a residual artifact of calc.html/dashboard.html/disclaimer.html having
been run through a code formatter that validation.html hasn't been.

### 1.9 No `<meta name="description">` on any of the four pages
Confirmed absent in dashboard.html, calc.html, validation.html, and
disclaimer.html. Affects link-preview text and search-result snippets.

---

## 2. Required Adjustments

These contradict either an established in-repo convention or a real
correctness rule (not stylistic opinions):

1. **Fix the duplicate `<h1>` in disclaimer.html** (finding 1.1). Keep
   exactly one — either demote the brand mark's `<h1>` (line 295) to a
   non-heading element (it's already decorative/brand chrome, matching how
   calc.html/validation.html render their header brand) or demote the
   content title (line 308) to `<h2>`. The brand mark is the better
   candidate to demote, since it mirrors calc.html/validation.html's header
   pattern where the brand text is inside the `.header` chrome, not the
   document's content heading.

2. **Complete calc.html's ARIA-tabs wiring** (findings 1.3, 1.4): give each
   `.tab-btn` a stable `id` and `aria-controls="tab-<name>"`; give each
   `.tab-content` panel `role="tabpanel"` and `aria-labelledby` pointing
   back at its tab button; and fix the init path (`calc.html:2957-2968`) so
   `aria-selected="true"` is applied to the resolved starting tab even when
   it's the default `'core'` tab and `.click()` is skipped.

3. **Add an `aria-live` region to validation.html's state container**
   (finding 1.5), matching the `aria-live="polite"` convention
   `dashboard.html` already established for the same async-state-swap
   pattern (empty → loading → result/error).

4. ~~Reconcile the manifest name with the in-app UI~~ (finding 1.6) —
   **✅ DONE.** The product confirmed "KEEN" as the standardized name; the
   manifest was updated and every other lingering occurrence of the old
   two-word name was renamed repo-wide in the same pass (manifest,
   `engine/qt-card.js`'s `keen-live-price` CSS hook, tests, README, and the
   `_docs/` set).

---

## 3. Recommended / Suggested Improvements

Optional, non-blocking polish — listed separately so it's clear none of
this is mandatory:

- **Add `dir="ltr"`** to `dashboard.html`, `calc.html`, and
  `validation.html`'s `<html>` tag for attribute-set consistency with
  disclaimer.html (finding 1.7). No behavioral change.
- **Normalize `<!doctype html>` casing** in validation.html to lowercase,
  matching the other three files (finding 1.8).
- **Add `<meta name="description">`** to each of the four pages (finding
  1.9) for SEO / link-preview quality.
- **Unify the localStorage key-naming scheme.** `dashboard.html` namespaces
  everything under `qt.*` (`qt.workspace`, `qt.profileSaveEnabled`,
  `qt.uiMode` — see `dashboard.html:3323`, `3398`, `3559`), while
  `calc.html` uses a `calc.*` prefix (`calc.tab`, plus one key per input
  id). No collision risk today since the prefixes differ, but a single
  shared scheme would read as more deliberate if more pages gain
  persistence later.
- **Consider `aria-live` on calc.html's `.results` panels too** — lower
  priority than validation.html's case (finding 1.5) because calc's results
  update on every keystroke, so a naive `aria-live="polite"` copy could
  fire far too often and become noisy for screen-reader users; this would
  need a deliberate design choice (e.g. announce only on blur/debounce)
  rather than a blind copy of the dashboard pattern.
- **`.webmanifest` has no explicit IIS cache policy.** `web.config`'s
  `<caching><profiles>` block sets an explicit policy for `.js` and
  `.json` (`CacheUntilChange`) and disables caching for `.html`, but
  `.webmanifest` is a distinct extension and isn't listed, so it falls back
  to IIS's default static-file caching. Since Task 3 made this manifest the
  single source of truth for all four pages, giving it the same explicit,
  revalidate-friendly policy as `.json` would avoid a stale cached manifest
  surviving a future icon/name change.
- **Formatting-style split.** calc.html, dashboard.html, and
  disclaimer.html are currently in a 2-space/double-quoted/self-closing
  style (from an external formatter pass outside this session); validation.html
  is still in its original 4-space/unquoted/non-self-closing style. Purely
  cosmetic — worth a single formatter pass over validation.html if a
  consistent source style across the repo matters to the team.
