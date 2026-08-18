# Positional Tier Board - Build Plan

## Goal

A standalone, double-click HTML tool for building drag-and-drop positional tier rankings for the Sleeper league "Super Chili Bowl". Pick a position tab (QB / RB / WR / TE), get the top N players at that position pre-sorted by Sleeper ADP, then drag players into the order you actually believe and insert tier breaks between them. Auto-saves; exports/imports JSON.

This is a **separate publishable tool** from the keeper Draft Helper one folder up. It shares no files with it - the ~80 lines of Sleeper fetch/cache logic it needs are copied down, and it uses its own `tb_*` localStorage namespace so the two tools can never clobber each other's caches. Nothing in `../index.html`, `../app.js`, `../styles.css`, or `../publish/` is modified.

## Locked decisions

- **Pool**: top N per position by Sleeper ADP. Count selectable 24 / 40 / 60, default **60** (the league drafts 14 x 16 = 224 picks, so 40/position runs dry mid-draft).
- **Positions**: QB, RB, WR, TE only. No K, no DEF - Sleeper's ADP is near-useless for them and the tabs would seed unordered.
- **Placement**: own self-contained folder `tier-board/`. No tab inside the keeper helper.
- **Integration**: none. The keeper helper's math is untouched, and it gets no tier column.
- **Persistence**: auto-save to localStorage on every change, plus Export JSON / Import JSON.
- **Dragging**: Pointer Events, not HTML5 drag-and-drop (`dragstart` never fires on touch, and phone access is an open question). Drag starts from the row handle only, so touch-scrolling the list never fights the drag. Alt+Arrow reorders a focused row as a keyboard fallback.
- **Cross-position tiebreak** (matters for the future draft assistant): tier number compared within position, ADP breaks cross-position ties.

## Data model

One ordered array per position; each entry is either a tier break or a player, so a drag is a single splice.

```js
{
  version: 1,
  season: 2026,
  positions: {
    RB: { count: 60, order: [ { t: "brk", label: "" }, { t: "p", pid: "4034" }, ... ] }
  }
}
```

`label: ""` means auto-number ("Tier 1", "Tier 2", ...). A typed label overrides it. This format is the contract the optional draft-assistant tool will read, so it is versioned deliberately.

## Data sources (all Sleeper, public, no auth)

- `GET /players/nfl` -> names, positions, teams, search_rank, years_exp (~15 MB; trimmed + cached 24h)
- `POST sleeper.com/graphql` season projections -> ADP per player (cached 12h)
- `GET /league/{id}` + `/users` + forward-walk -> latest season, scoring format (picks `adp_ppr` vs `adp_2qb` etc.), roster positions

League resolution is **only** used to pick the right ADP flavor and target season. If it fails, the tool degrades to `adp_ppr` + the upcoming calendar season and the board still works.

## Files

- `index.html` - markup: position tabs, controls, board, footer
- `tiers.js` - data layer + board model + drag + render
- `tiers.css` - styling (own copy of the dark token palette so it matches the keeper helper without sharing a file)
- `README.txt` - how to use, keyboard shortcuts, export/import

## Build steps

- [x] PLAN.md
- [x] tiers.css
- [x] index.html
- [x] tiers.js - data layer (players + ADP + league resolve, `tb_*` cache namespace)
- [x] tiers.js - board model (seed from ADP, count change preserves manual order, reset)
- [x] tiers.js - render (tier bands with auto-numbering, player rows, ADP drift indicator)
- [x] tiers.js - pointer-event drag with ghost row + drop indicator
- [x] tiers.js - insert break in any gap, delete break, edit label
- [x] tiers.js - auto-save + Export/Import JSON
- [x] tiers.js - Alt+Arrow keyboard reorder
- [x] README.txt
- [x] README.txt
- [x] Verify against live Sleeper data (league resolve, ADP counts, pool sizes) - `dev/verify.js`, 40/40 pass
- [x] Verify board mutations (seed/drag/count-change/reset) with a headless harness - same script
- [x] Open in browser and eyeball the drag interaction - `dev/verify-browser.js`, 18/18 pass
- [x] Fix the two defects the screenshot showed: grip glyph was U+2807 (3-dot) not U+283F (6-dot); generic `button:hover` accent border was leaking onto the tabs so a hovered inactive tab read as active
- [x] Move the verification harnesses into `dev/` so the publishable root is exactly index.html + tiers.js + tiers.css + README.txt

## Verified against live 2026 data

- League resolve: seed -> "Super Chili Bowl", latest completed draft 2025, so target season = **2026**. ADP field `adp_ppr`, ADP season 2026, 245 entries.
- Pool depth: **RB 74, WR 99, QB 33, TE 35**. Sleeper only publishes ADP for ~245 players, so at QB and TE the "Show 60" option yields 33 and 35 - the tab counters show the truth. Documented as a known limitation.
- Browser: drag reorders correctly and the drift arrow updates (`James Cook ↑5`); tier breaks insert and auto-number; typed labels persist; tab switching keeps per-position boards; a drag + break + label all survive a reload.

## Follow-up 1: three ADP layers - BUILT, THEN REMOVED

Built a base/incoming/overrides ADP system with a pending-review banner, a half-round movement threshold, and inline ADP overrides. Feedback: too complex. It was removed wholesale in follow-up 2. Storage keys `tb_adp_base_v1`, `tb_adp_incoming_v1`, and `tb_adp_over_v1` are no longer written or read; stale copies in a browser are simply ignored.

Kept from that round: the arrow-spacing legibility fix (`↑46.6` reads as "146.6", so the arrow is spaced off the number in the drift cell).

## Follow-up 2: two ranking sources, blended (done)

Pull Sleeper plus The Fantasy Footballers (full PPR, weighted higher because they are the trusted source), blend them into the seed order, and just allow drag and drop.

- **Blend**: `0.7 x Footballers positional rank + 0.3 x Sleeper positional rank`, lower is better. A player only one source ranks uses that source's rank as-is rather than being penalised for the other's silence. `FFB_WEIGHT` / `SLEEPER_WEIGHT` at the top of tiers.js.
- **Row now shows both inputs**: an `FFB` column (bold, the heavier weight) and an `ADP` column, so the blend is auditable at a glance.

### The CORS finding that shaped the architecture

Their rankings are public HTML with no API, and BOTH the pages and their internal `wp-json` endpoint send `Access-Control-Allow-Origin: https://www.thefantasyfootballers.com`. Verified from a real `file://` page: `TypeError: Failed to fetch`. A double-click tool therefore cannot read them live, full stop.

Hence `dev/fetch-ffb.js` writes `ffb-rankings.js`, loaded by a `<script>` tag - a local `fetch()` of a `.json` is also blocked from `file://`. The snapshot is only as fresh as the last run of that script; that is forced by their policy, not a shortcut.

### Traps hit while building the scraper

- Their pages default to **Half PPR**, and the ranks genuinely differ (full PPR puts Bijan over Gibbs at RB; half PPR reverses it). The scraper forces `ppr` and records what it actually applied, per position, in the snapshot.
- The scoring control is `id="basic-scoring"`, **not** `name=`. An early probe printed `sel.name || sel.id` and I read that as a name, so `select[name=...]` matched nothing and a scrape quietly captured Half PPR while reporting success. Now matches either.
- A bare `document.querySelector("select")` fallback is deliberately avoided - it grabs unrelated dropdowns and reports success misleadingly.
- The QB page has no scoring control at all, which is correct: receptions do not affect QB scoring, so QB ranks are format-independent.
- Playwright locators go stale against these re-mounting controls. The switch is done with in-page JS plus `input`/`change` events.

### Name matching

Position + normalized name: case folded, accents stripped, punctuation removed, generational suffixes dropped. Plus a `NAME_ALIASES` map for nicknames. Started at 307/309 - accent handling fixed "Audric Estimé" and an alias fixed "Hollywood Brown" -> "Marquise Brown". Now **309/309**.

### Verified

**66 headless + 33 browser checks pass.** Pool depth grew because the two sources union: QB 33 -> 38, RB 74 -> 94, WR 99 -> 130, TE 35 -> 53. Blend spot-check in the rendered UI: Omarion Hampton (FFB 10, ADP 18.8) correctly outranks Kenneth Walker (FFB 9, ADP 22.9).

### Yearly edit

`dev/fetch-ffb.js` has a `SEASON` constant (currently 2026) that builds the Footballers page URLs. Bump it next year. The Sleeper side still needs no yearly edit.

## Follow-up 3: drop the blend, per-position depths, labelled columns, depth chart (done)

- **Blend removed.** Order is the Footballers' ranking, full stop. Correct call: Sleeper ADP is an *overall* draft position, not a positional rank, so blending it against a positional ranking was adding up two different units. `FFB_WEIGHT` / `SLEEPER_WEIGHT` / `blendRanks` are gone, and so is the derived "Sleeper positional rank" column that briefly existed - it was a made-up number dressed as a source.
- **Pool is now FFB-ranked players only** (QB 36, RB 91, WR 130, TE 52). Consequence worth remembering: a player the Footballers have not ranked cannot appear even with a Sleeper ADP. Documented as a limitation.
- **Per-position seed depths**: `DEFAULT_COUNTS = { QB: 30, RB: 60, WR: 100, TE: 30 }`. The `Show` dropdown is rebuilt per tab, offering only depths that position can fill plus an `All (N)` option. `sanitizeBoard` now range-checks the count (1..`MAX_COUNT`) instead of requiring membership in a fixed list.
- **One-time count migration**: `COUNTS_VERSION = 2` on the saved board. An older board is moved to the new depths via `applyCount`, so tier breaks and manual ordering survive - rows are only added or trimmed at the bottom. It will trim QB/TE boards from 60 to 30.
- **Column header row** added. It reuses the `.row` flex classes so the fixed-width columns line up (`.name` is `flex: 1` and absorbs the difference). Every label carries a tooltip. Columns: `# | Player | Team | DEPTH | FFB | ADP | RD | YOU`.
- **Sleeper is now two reference columns**: `ADP` (overall pick) and `RD` (the round that ADP implies at this league's team count, via `roundOf`). Both dimmer than the FFB rank.
- **Depth chart** from Sleeper's `depth_chart_order` / `depth_chart_position`. Probed the real data first rather than trusting the field names: it is accurate (Bijan RB1 ATL, Chase WR1 CIN, Higgins WR2, Iosivas WR3) and complete for 60/60 RBs and 100/100 WRs on the board. Rendered as `RB1` / `WR3`, green for a team #1. Shown for RB and WR only; the header label is toggled with `hidden` so the QB and TE tabs do not show a column of dashes. `depth_chart_position` gives receiver alignment (LWR/RWR/SWR), surfaced in the tooltip since a SWR1 is the slot man rather than the team's best receiver.
- **Player cache bumped to `tb_players_v2`** because the trim shape changed - forces one 15 MB re-download.
- On narrow screens the media query now drops Team and ADP (was Team and drift), keeping depth, FFB, RD, and your own drift.

### Verified

**80 headless + 60 browser checks pass.** Notable new coverage: order is the Footballers' rank and provably NOT ADP order, every round agrees with its ADP at 14 teams, per-position depths and their `Show` option lists, `All` shows the full pool, the depth column renders on RB/WR and is absent on QB/TE, and the count migration preserves a tier break.

A trap the header row introduced: it shares the `.row` class for alignment, so every browser-test selector had to be scoped to `#board .row` or the header counted as a player row.

## Follow-up 4: refresh-safe boards + printable one-pager (done)

### Refresh keeps the board

The board already persisted, but a refreshed snapshot had a real hole: players who newly climbed into a position's top-N never appeared at all.

- `absorbNewRanked()` appends them to the BOTTOM of that position. Nothing is reordered, nobody is removed. Reported in the status line.
- `buildPools()` now clears last run's `ffbRank` first, so a de-listed player cannot keep a stale rank; `countUnrankedOnBoard()` reports how many boarded players the snapshot no longer ranks (they show a dash and stay put).
- `board.ffbStamp` records which snapshot the board last absorbed, so a refresh is announced once rather than on every load.
- `refresh-rankings.cmd` - double-clickable wrapper for `dev/fetch-ffb.js`, with a Node check and a clear failure message.
- Footer shows snapshot date + age and turns amber past `FFB_STALE_DAYS` (7).

### Print sheet

- Toolbar "Print sheet" builds a print-only DOM (`#printSheet`) and calls `window.print()`. `@media print` hides the app (`.wrap > *:not(.print-sheet)`), switches to light-on-white, and sets an 0.3in `@page` margin.
- Layout is **three fixed flex columns** per the request: `PRINT_COLUMNS = [["QB","TE"],["RB"],["WR"]]`. Fixed, not CSS newspaper columns, so a position never splits across a boundary.
- Row is: name, rookie marker, position (depth-chart slot for RB/WR, plain position for QB/TE), team, ADP, round. No leading rank number - the order down the column is the rank. No page header.
- **Type size is computed, not guessed**: the tallest column's weighted line count against `PRINT_PAGE_PT`, clamped to 5.5-8pt. At the default depths (220 players) the tallest column is WR at ~103 lines, giving **6.3pt** and filling the page exactly. Past what 5.5pt can hold, `printSheet()` warns and names the lever instead of spilling to page two.

### Two traps worth remembering

1. `column-fill: auto` on an auto-height container put everything in ONE column and pushed the rest off the page - and the PDF still reported **one page**, because the overflow was clipped rather than paginated. A page count alone is not proof of fit. The test now also measures columns used and the deepest row's bottom against the sheet box. (That layout was replaced by fixed flex columns anyway.)
2. The browser test's `waitForBoard` keyed on the status line being hidden, which broke the moment a refresh legitimately put an informational message there. It now keys on the spinner being gone.

## Follow-up 5: WR depth 100 -> 80 (done)

Asked for after seeing the 6.3pt print sheet. WR is the tallest print column, so its depth alone sets the type size for the whole page.

- `DEFAULT_COUNTS.WR = 80`, `COUNTS_VERSION = 3`. The bump is what trims saved boards - verified: a 100-deep WR board goes to exactly 80 rows, both tier breaks survive, the surviving order is unchanged, and the specific bottom-20 player ids are confirmed absent.
- Print sheet now fits at **7.6pt** (was 6.3pt), 981px of the 998px available, one PDF page.
- **Calibrated the fit model.** At WR 80 the computed 7.9pt rendered 1009px against a 998px budget and spilled to two pages: heading margins and borders cost more than the line weights account for. `PRINT_PAGE_PT` now carries a measured 0.965 safety factor. The lesson is that the model needs the geometric check next to it - the arithmetic alone said it fit.
- One consequence worth knowing: trimming to 80 removes any WR you had dragged up from below rank 80, since the trim keeps only players inside the new top-N.

### Geometry note (a real constraint, not a bug)

One position per column means WR sets the type size. WR at 130 ("All") cannot fit one page at any legible size - 133 lines needs under 5.5pt. WR at 100 gives 6.3pt, 80 gives ~7pt, 60 gives ~8pt. Letting positions flow across the three columns instead would print the same 220 players at 8pt, at the cost of a column starting part-way down a list. Offered to the user; not done, because the brief was one position per column.

## Follow-up 6: one-click refresh + movement columns (in progress)

Two asks: (1) record FFB rank and Sleeper ADP before and after an update and show the net change per player, (2) a Refresh button in the page that grabs everything itself, rather than being told to run a script.

### Why the button needs a local server (the constraint, restated)

Follow-up 2's CORS finding is still binding: the Footballers send `Access-Control-Allow-Origin: https://www.thefantasyfootballers.com` on both their pages and their `wp-json` endpoint, so a button on a `file://` page cannot scrape them no matter how it is written. The refresh therefore has to run outside the page. Decision: a tiny local Node server. `start.cmd` launches `dev/serve.js` on 127.0.0.1, serves the board over `http://`, and exposes `POST /api/refresh`, which runs the existing scrape server-side (no CORS in Node) and returns the new snapshot so the page hot-swaps it with no reload. Cost, accepted: the board is launched from `start.cmd` instead of double-clicking `index.html`. Double-clicking still opens and works; only the Refresh button degrades, to a message naming `start.cmd`.

### Where each "before" value lives

The two sources are stored where each one's data actually lives, which means each baseline is written by whoever refreshes it.

- **FFB previous rank: in the snapshot file.** `dev/fetch-ffb.js` reads the `ffb-rankings.js` it is about to replace and embeds `prevRank` on every player plus a `previousFetchedAt` stamp. So the "before" survives in the generated file and needs no browser state - a fresh browser still shows real deltas.
- **ADP previous value: in localStorage** (`tb_adp_prev_v1`), captured by the app from the ADP it currently holds, just before it applies a newly fetched one. Sleeper publishes no ADP history, so this only starts accumulating from the first refresh onward - **ADP deltas are blank until then, and that is honest rather than a bug.** Guarded so a delta is only shown when the baseline's `field` and `season` match the current ones; comparing a 2026 PPR ADP against a 2025 one would be nonsense.

Baselines coincide because the Refresh button does FFB + ADP in one action. Running `refresh-rankings.cmd` alone advances only the FFB baseline, so the footer names each baseline date separately.

### Double-refresh protection

Two refreshes a minute apart would otherwise reset the baseline to a minute ago and zero out every delta - the interesting comparison destroyed by an idle click. Both sides carry the same one-hour rule: if the baseline about to be replaced is under an hour old, the **older** baseline is carried forward instead. In the scraper that means keeping the existing `previous` block rather than overwriting it; in the app it means not advancing `tb_adp_prev_v1`.

### Columns

`FFB | dFFB | ADP | dADP` - each delta sits next to the source it measures. Lower is better in both units, so a decrease renders as a green up-arrow (rising) and an increase as a red down-arrow, matching the existing `You` drift colours. A player with no baseline shows a neutral dot, not a zero, because "unknown" and "did not move" are different facts. `.wrap` grows from 780px to 860px to fit the two new columns.

**Noise threshold: `DELTA_MIN = 3`, so a move must be more than 2 to render.** This is not cosmetic. FFB ranks are ordinal, so one player climbing 10 spots mechanically pushes every player he passed down by exactly 1 - a column full of `-1`s that reports one man's move as if eleven things happened. Suppressing sub-threshold moves means a visible arrow is a real change of opinion rather than displacement. Applied to ADP as well, where a two-pick drift is likewise inside the noise. The constant sits next to the other tunables at the top of `tiers.js`.

### Steps

- [x] `dev/fetch-ffb.js` - refactor to a module (`refresh()` export, CLI preserved via `require.main`), embed `prevRank` + `previousFetchedAt`, carry an under-an-hour baseline forward
- [x] Re-run the scrape with the Aug 6 backup restored as the "before", so the first view shows the real 12-day movement instead of an empty baseline
- [x] `dev/serve.js` - static file server + `POST /api/refresh`
- [x] `start.cmd` - launch the server and open the board
- [x] `index.html` - two delta headers, footer text, Refresh button relabelled
- [x] `tiers.js` - prev-rank plumbing, delta cells, unified refresh, `file://` degradation
- [x] `tiers.css` - delta column widths + colours, wrap width
- [x] `README.txt` - launching via start.cmd, what the deltas mean, the one-hour rule
- [x] `dev/verify.js` + `dev/verify-browser.js` - update for the new columns, add delta + refresh-endpoint coverage
- [x] Re-run all three checks

### Verified

**144 headless + 124 browser checks pass** (was 80 + 60). What the new coverage actually pins down:

- The threshold, on real data: of 196 raw rank changes between Aug 6 and Aug 18, **126 were 1-2 place displacement and are suppressed; 70 are drawn.** The browser test asserts that no drawn move is under 3 and that a suppressed cell still reports its true number on hover. The canonical case appears in the RB tab: Gibbs passing Bijan renders as a dot with the tooltip "Moved 1 (2 to 1)", not a red arrow on Bijan.
- Direction: a rank going *down* in number renders as a green up-arrow, verified through computed colour rather than class name alone (`rgb(63,185,80)` vs `rgb(240,91,91)`).
- "No baseline" is drawn differently from "did not move", and both explain themselves on hover.
- The ADP baseline refuses to compare across scoring formats or seasons - a 2026 PPR ADP against a 2025 one would invent movement.
- **The one-hour rule proved itself on a live double refresh**: the server-side scrape 20 minutes after the previous one advanced `fetchedAt` to Aug 18 19:58 but kept the baseline pinned at Aug 6, preserving all 70 movers instead of flattening them.
- The end-to-end button: real scrape via `POST /api/refresh`, board updated in place, order byte-identical before and after, button disabled during and re-enabled after.
- From `file://` the button refreshes ADP, states why the ranks cannot follow, and names `start.cmd`.
- Server hardening: `dev/` is not served (404 on the rankings backup), non-POST on the refresh endpoint is 405, loopback bind only.
- Header labels align exactly with their data columns (every header cell's right edge equals its row cell's, to the pixel).
- Print sheet is untouched by all of this: still 200 players at 7.6pt on one page. The movement columns are screen-only.

### Two traps hit

1. **A test asserted a hardcoded WR pool of 130.** The refresh legitimately grew WR to 131 and the assertion failed - a test that breaks every time the source data changes is a false alarm generator. Both sites now read the pool size off the `All (N)` option, which is how one nearby check already did it.
2. **`board-check.png` was captured under `emulateMedia("print")`,** so it was a byte-identical duplicate of `print-check.png` (both exactly 160209 bytes) and the on-screen layout had never actually been eyeballed through it. Fixed to screen media; the two files are now genuinely different (80KB vs 164KB). Worth remembering that identical file sizes next to each other are a smell.

### Deliberately not done

The Aug 6 -> Aug 18 numbers are the only movement history that exists. Nothing recorded FFB or ADP before Aug 6, and Sleeper publishes no ADP history at all, so **dADP is blank on a first run until you refresh once.** A pinned preseason baseline was offered and declined in favour of "last refresh only".

### Findings from the Aug 18 refresh (already done)

- Snapshot refreshed: QB 36, RB 91, WR 131 (+1), TE 54 (+2), 312 players.
- **RB1 flipped to Gibbs over Bijan.** That is the exact signature `PLAN.md` line 97 records for a silent Half-PPR capture, so it was probed across all three formats before being trusted: `ppr` genuinely diverges from `half`/`std` (rank 4 is Jonathan Taylor at PPR, James Cook at half/std) and Gibbs is RB1 in *all three*. The toggle is working; the flip is a real 12-day ranking move. The Bijan-over-Gibbs example in the follow-up 2 notes is now stale as live data, though the trap it documents is still real.
- `dev/ffb-rankings.backup.js` holds the Aug 6 snapshot. Kept because `fetch-ffb.js` line 240 warns that a position which fails to scrape loses its previous ranks entirely - that backup is the only copy of the "before" values.

## Follow-up 7: publishable to GitHub Pages, manual updates only, full Reset (done)

Requests, in the order they arrived: saved tiers were missing; drop Export/Import; drop Reset order; no visible way to grab latest rankings, and updates must be manual so an FFB delta cannot be missed. Then: publish to GitHub Pages, so no local hosting. Then: actually do want a Reset, one that clears everything AND pulls the latest rankings, so the tool is reusable in future years.

### The missing tiers were my fault, and the lesson generalises

`localStorage` is scoped per **origin**. The board had been built at `file:///...index.html`; follow-up 6's `start.cmd` served it from `http://127.0.0.1:8777`, a different origin, so the saved board was invisible - present and safe, just in another bucket. Nothing was lost, and opening `index.html` directly brought it straight back. **Changing how a local tool is opened silently changes where its data lives.** That should have been called out when the server was proposed, not discovered by the user.

### Why a server was the wrong answer anyway

With GitHub Pages as the target, the local server had to go. It is gone: `start.cmd` and `dev/serve.js` are deleted.

Worth recording what was learned before deleting them, though: a `file://` page **can** call a loopback server once that server sends `Access-Control-Allow-Origin` - verified, ping 200 and a POST preflight 200 from origin `null`. So a local-server refresh button was achievable without moving the page off `file://`. It was still the wrong shape for a published static site.

The unmovable constraint is unchanged and now applies everywhere: the Footballers send a fixed `Access-Control-Allow-Origin` naming their own domain, so the scrape is refused from `file://`, from localhost, **and from `https://<user>.github.io`** alike. Hosting cannot fix it. A CORS proxy cannot either, because their page defaults to Half PPR and the format switch is client-side JS, so a proxied fetch returns the wrong scoring format.

### Where the scrape lives now

`.github/workflows/refresh-rankings.yml` - `workflow_dispatch` only, **no `schedule`**, because nothing should update behind the user's back. It installs Playwright, runs `dev/fetch-ffb.js`, commits `ffb-rankings.js` only if it changed, and logs the movement via the new `dev/summarise-movement.js`. `refresh-rankings.cmd` still works locally.

One trap that would have broken every CI run: `launchBrowser()` tried Chrome, Edge, then a hardcoded Windows path - all three Windows-desktop specific. On a Linux runner every attempt fails. Added Playwright's own bundled browser (`{}`) as a final fallback.

### "Nothing updates unless I ask"

`Get latest rankings` in the toolbar (it existed before, in the footer, labelled "Refresh" - easy to miss, which is why it was reported as absent). It does not scrape. It re-fetches the snapshot file via a cache-busted script tag, swaps it in if `fetchedAt` differs, re-pulls Sleeper ADP, and tops up the player list if it is over a day old.

Opening the board now makes **zero** network requests. Three changes got there, and the third was found by a test:

- ADP: cache-first with no expiry (was a 12h TTL that silently refetched).
- Players: same (was 24h). `PLAYERS_TTL_MS` became `PLAYERS_STALE_MS` - now only the threshold at which the button bothers re-downloading.
- League: `getLatestLeague` cached only the league **id**, then fetched the league object on every single open. A test asserting "no offsite requests on load" caught it - twice per load, in fact. Now the object is cached (`tb_league_obj_v1`). Side benefit that matters for the actual use case: the board opens instantly with no connection, which is what you want at a draft table on hotel wifi.

### Reset

Full wipe: clears everything under the `tb_` prefix (by prefix scan, not a hand-listed set, so a key added later cannot survive), then re-resolves the league from the seed id, re-downloads the player list, re-pulls ADP, takes the newest published snapshot, and reseeds all four boards. Confirms first; no undo.

Because it re-resolves the league, it is what rolls the tool onto a new season. Combined with removing the scraper's hardcoded `SEASON` - it now derives candidate years from the clock, tries current then next then last, and records which it found - **there are no yearly code edits left.**

### Verified

**144 headless + 152 browser checks pass.** New coverage worth naming:

- A static server stands up in the test (plain files over http, no project code - which is all Pages is), a changed snapshot is published mid-session exactly as the Action's commit would, and the open page picks it up: announces the new rankings, reports the movers, leaves the order byte-identical, appends the newly-ranked player at the bottom.
- The no-op case: an unchanged snapshot reports "already the latest" rather than inventing movement.
- "Opening the page pulls nothing on its own" - asserted by recording every request during a reload and requiring zero offsite ones.
- Reset end-to-end against a deliberately messed-up board (dragged row, renamed tier, depth cut to 24): reseeds to the defaults, clears the ADP baseline, blanks dADP, rebuilds the caches, and survives a reload.
- Absence assertions for Export/Import, so a later edit cannot quietly reintroduce them.

### Two test traps

1. A check hardcoded `WR pool === 130`. The refresh legitimately grew WR to 131 and it failed. Both sites now read the size off the `All (N)` option - a test that breaks whenever the source data legitimately changes is a false-alarm generator.
2. **Playwright auto-dismisses dialogs.** The Reset test registered its `dialog` handler after changing the depth, so the depth-change confirm was cancelled, the board never shrank, and "back to the default depth" was comparing 60 against 60 - passing while proving nothing. Handler now goes on before the state it needs to affect.

### Known consequence of dropping Export/Import

There is now no backup and no way to move a board between origins. Clearing browser data erases the tiers permanently. Flagged to the user, who chose to accept it and rebuild fresh on the published site; documented prominently in README.txt.

## Follow-up 8: the board syncs to the repo, automatically (done)

Asked for: read/write the board to a file on the Pages site, with **both** directions automatic - no Save button, no Load button - so tiers survive and follow between devices. Prompted by the tiers not appearing on the published site, which is the origin boundary from follow-up 7 biting again: `file://` and `https://…github.io` have separate `localStorage`, and with Export/Import gone there was nothing that could cross it.

### What is actually possible

GitHub Pages is a **read-only** static host. It answers GETs; there is no server-side code and no write endpoint, so no browser page can save a file back to it. Reading is fine and already used (that is how `Get latest rankings` re-reads `ffb-rankings.js`).

Writing means the GitHub API, which means a token. A token **cannot ship in the repo** - it is public, so that would hand the world write access. So the token is pasted once per browser and lives only in that browser's `localStorage`. It is never committed and never sent anywhere but `api.github.com`. Sync is therefore opt-in per browser; with no token the board saves locally exactly as before and the footer says sync is off.

### Design

- **Storage**: `board.json` on a dedicated `boards` branch, created off the default branch on first use. A separate branch specifically so saving tiers never triggers a Pages rebuild and the board file never appears on the published site.
- **Save**: automatic on every change. Local write is instant; the repo write is debounced `SYNC_DEBOUNCE_MS` (8s) so a burst of drags collapses into one commit instead of one commit per drag.
- **Load**: automatic on open, and **not awaited** - a slow or unreachable GitHub must never delay the board rendering.
- **Conflicts**: last-write-wins on a `updatedAt` stamp now carried in the board (and preserved by `sanitizeBoard`). On a 409/422 stale-sha response it re-reads: if the remote is newer it is adopted rather than clobbered, otherwise the push retries with the fresh sha. Right rule for one person on two devices.
- **Bad token**: a 401/403 clears the stored token and stops. Retrying cannot help and would hammer the API on every keystroke.
- **Repo identity** is read from the URL (`<owner>.github.io/<repo>/`), so a rename or fork needs no edit. A `file://` page has no repo in its URL and falls back to the published one - which is exactly what lets a locally-built board be pushed up for the Pages site to find.

### Verified

**174 headless + 155 browser checks pass.**

The authenticated write path is the interesting part, because it cannot be exercised with a real token - that is the user's to hold and not something to ask for. So the tests stand up a **mock GitHub** by swapping `fetch` in the sandbox, which covers what would otherwise ship completely untested: branch bootstrap off the default branch, first push when the repo has nothing, a newer remote being adopted on load *without* pushing back over it, a newer local board being pushed up, a stale-sha conflict retrying and winning, a stale-sha conflict where the remote is newer being adopted instead, and a rejected token raising a clear error and dropping itself.

Also covered: base64 round-trips non-ASCII (a tier named with an accent or an emoji would throw plain `btoa`), repo detection from both a `github.io` URL and the `file://` fallback, `updatedAt` surviving `sanitizeBoard`, and garbage from the repo being refused without disturbing the board on screen.

### A trap in the test, not the product

The first mock run failed with `["main","undefined"]` and then a base64 decode blowing up on binary garbage. Cause: `ghFetch` serialises the body before calling `fetch`, so the mock was reading `.ref` and `.content` off a JSON **string** - both silently `undefined`, one of which then got base64-encoded. The mock now parses the body, with a comment saying why. Worth remembering that a mock sitting one layer below the serialiser has to speak the serialised form.

### Deliberate limitation

The repo is public, so `board.json` is world-readable - tier rankings are not secret, and a leaguemate who finds the repo can read them. Raised with the user, who chose the public repo over an unlisted gist for the simpler setup. An unlisted gist or a private repo remains a small change.

## Re-running the checks

```
cd tier-board
node dev/fetch-ffb.js           # re-scrape the Footballers snapshot (forces full PPR)
node dev/summarise-movement.js  # print what moved in the current snapshot
node dev/verify.js              # board math + movement math + live Sleeper data, no browser
node dev/verify-browser.js      # drag, columns, print, update-check, and Reset
```

`verify-browser.js` stands up a plain static file server on port 8794 to stand in for GitHub Pages, and publishes a modified snapshot mid-run. It backs up `ffb-rankings.js` and restores it afterwards, so running the suite leaves the snapshot unchanged. It does not scrape.

`verify-browser.js` launches the machine's real Chrome (falling back to Edge, then a cached chromium) because the global Playwright's pinned browser revision is not downloaded.

## Key context to resume

- SEED_LEAGUE_ID = 1248017523933196288 (forward-walks to the latest season; 24h cache)
- localStorage keys all prefixed `tb_` - `tb_players_v2`, `tb_adp_v2_*`, `tb_adp_prev_v1` (the dADP baseline), `tb_league_*_v1`, `tb_board_v1`
- Deployed as a static site on GitHub Pages; `index.html` + `tiers.js` + `tiers.css` + `ffb-rankings.js` are the whole tool. No server (`start.cmd` and `dev/serve.js` existed in follow-up 6 and were deleted in follow-up 7)
- **Tiers are per-origin.** A board built at `file://` is invisible on the Pages site and vice versa, and with Export/Import removed there is no way to move or back one up
- Nothing fetches on load. `Get latest rankings` re-checks the snapshot + ADP; `Reset` wipes all `tb_*` keys and rebuilds, which is also how the tool rolls onto a new season
- Rankings are refreshed by the manual `Refresh rankings` GitHub Action (`workflow_dispatch`, no schedule) or locally by `refresh-rankings.cmd`. No yearly code edits remain - the scraper derives the season from the clock
- Movement baselines: FFB's lives in `ffb-rankings.js` as `prevRank` + `previousFetchedAt`, ADP's lives in localStorage. `DELTA_MIN = 3` suppresses displacement noise; a one-hour rule on both sides stops a double refresh flattening the deltas
- Target season for ADP = resolved league season + 1 (same rule the keeper helper uses)
- Drift indicator = seed pool index - current index (positive = you moved him up)
- Second tool (optional, NOT started): live draft assistant. Polls `/draft/{id}/picks`, knows your slot from `draft_order` / `slot_to_roster_id`, ranks remaining pool by these tiers, and does tier-cliff detection ("3 RBs left in this tier, 14 picks until your next turn"). Test plan: replay a completed past draft pick-by-pick rather than waiting for draft night.
