POSITIONAL TIER BOARD
=====================

What it is
----------
A local web page for building your own positional tier rankings. Pick a position tab (QB / RB / WR / TE), and it loads the players at that position pre-sorted by The Fantasy Footballers' full-PPR rankings. From there you drag players into the order you actually believe and drop tier breaks between them, then print the whole thing on one sheet for draft night.

This is a standalone tool. It is separate from the keeper Draft Helper one folder up, shares no files with it, and cannot touch its saved data.

What sets the order
-------------------
The Fantasy Footballers' draft rankings, full PPR. That is the only thing that decides the starting order.

Sleeper is shown alongside for context but does NOT affect the order. That is deliberate: Sleeper's ADP is an overall draft position across every position, not a rank within a position, so averaging it against a positional ranking would be adding up two different things.

Seed depth is per position, since the positions are nowhere near the same size:

  QB  30      RB  60      WR  80      TE  30

Change them with the "Show" dropdown per tab, or edit DEFAULT_COUNTS near the top of tiers.js. Each tab's dropdown only offers depths that position can actually fill, plus an "All" option at the size of its pool (QB 36, RB 91, WR 131, TE 54).

How to use it
-------------
Open the published page, or double-click index.html. Either way it is one HTML file plus a script and a stylesheet, running entirely in your browser - no install, no sign-in, no server. Keep index.html, tiers.js, tiers.css, and ffb-rankings.js together in the same folder.

Nothing updates on its own. Opening the board pulls no new data at all: it draws from what it cached last time, so the movement columns cannot change under you before you have read them. "Get latest rankings" is the only thing that goes and fetches, and "Reset" is the only thing that throws anything away.

IMPORTANT - where your tiers live
---------------------------------
Your tiers are saved in the browser's localStorage, which is scoped per ORIGIN. That has one consequence worth knowing before you invest an evening in a board:

  - Tiers made on the published site stay on the published site.
  - Tiers made by double-clicking index.html stay under file://.
  - Those two are separate stores. The same tiers will NOT appear in both, and clearing your browser data erases them.

There is no export or import, by choice. Turning on sync (below) is what gives you a backup and lets one board follow you between the published site, a local copy, and your phone. Without sync, pick one place - the published page is the sensible one - and build your tiers there.

Syncing your board between devices
----------------------------------
With sync on, your board is saved as board.json in the repo, automatically. Both directions are automatic - there is no Save button and no Load button:

  - Every change saves. Local storage is written instantly; the repo write is held back about 8 seconds so a burst of drags becomes one commit instead of one per drag.
  - Opening the board loads. If the copy in the repo is newer than the copy in this browser - because you were working on another device - it is loaded and the status line says so. If this browser's is newer, it gets saved up instead. Newest wins, compared on a timestamp stored in the board.

Setting it up takes one paste per browser. Click the small "Sync off - click to set up" text in the footer and paste a GitHub token.

The token has to exist because GitHub Pages is a read-only static host: the only way a browser can write to your repo is the GitHub API, which requires authentication. It CANNOT be shipped in the code - the repo is public, so a token committed there would give the world write access to your repo. So it is pasted in per browser and kept in that browser's localStorage only. It is never committed, never sent anywhere except api.github.com, and never logged.

Make it a fine-grained token, scoped as tightly as possible:

  GitHub -> Settings -> Developer settings -> Personal access tokens -> Fine-grained tokens
  Repository access : Only select repositories -> this repo
  Permissions       : Repository permissions -> Contents -> Read and write
  Expiration        : your call; when it expires, sync says the token was rejected and you paste a new one

That is the whole scope: read and write files in this one repo. Nothing else, no other repo, no account access.

Two things worth knowing:

  - Saves go to a separate branch (boards), NOT the branch Pages serves. So saving your tiers never rebuilds the site, and your board file never appears on the published page.
  - The repo is public, so board.json is publicly readable by anyone who finds it. Your tier rankings are not secret. If that matters - leaguemates, say - the fix is an unlisted gist or a private repo instead, which is a small change.

If you never set up sync, nothing about the board changes: it saves locally exactly as before, and the footer just says sync is off.

Building your board
-------------------
  - Drag the grip handle on the left of any row to reorder it.
  - Hover the gap between two rows and click "+ tier break" to split a tier there.
  - "+ Tier break" in the toolbar adds a break at the bottom of the list.
  - Click a tier's name to rename it ("Studs", "Committee backs", whatever). Leave it blank and it auto-numbers as Tier 1, Tier 2, ...
  - The x on a tier band deletes that break and merges the tier into the one above.
  - Focus a row and press Alt+Up / Alt+Down to nudge it one slot - the keyboard alternative to dragging.

Every change saves immediately. The green "Saved" flash in the toolbar confirms it.

What the columns mean
--------------------
Every column is labelled in the header row, and each label has a tooltip if you forget.

  - #      : the player's rank in YOUR order for that position
  - Team   : NFL team
  - R      : rookie
  - DEPTH  : where he sits on his OWN team's depth chart at his position - RB1 is a lead back, WR3 is a third receiver. Green for a team #1, white for a clear #2, amber below that. Shown for RB and WR only; the column disappears on the QB and TE tabs. Hover it for the receiver alignment, e.g. "CIN WR depth 1 (LWR)" - a SWR1 is the slot man rather than the team's best receiver.
  - FFB    : the Fantasy Footballers' rank at that position, full PPR. Bold, because this is what sets the order.
  - dFFB   : how far that FFB rank moved at the last refresh. Green up-arrow means he climbed, red down-arrow means he fell. See "What the movement columns mean" below.
  - ADP    : Sleeper's average draft position, an overall pick number. Reference only.
  - dADP   : how far that ADP moved at the last refresh. Green up-arrow means he is being drafted EARLIER than he was.
  - RD     : the draft round that ADP lands in, for your league's team count (14). Reference only. Hover for the exact pick, e.g. "ADP 12.7 lands in round 1, pick 13 of 14".
  - YOU    : how far you have moved him from the Footballers' order. Green up-arrow means you like him more than they do, red down-arrow means less. A dot means you left him alone.

The YOU column is the useful one - it shows at a glance where your board actually disagrees with the experts, which is the whole point of making tiers. RD is the practical one: it tells you what round you would realistically have to spend to get him.

On a narrow phone screen the Team, ADP, and dADP columns drop out, so the depth chart, the FFB rank, its movement, the round, and your own drift all stay visible. dADP goes with ADP on purpose: a change with its own column hidden is a number you cannot anchor.

What the movement columns mean
-----------------------------
dFFB and dADP answer "what changed since I last pulled the numbers". Both sources count DOWN to better - FFB rank 1 is the best player, ADP pick 1 is the earliest drafted - so in both columns a falling number is a rising player, and gets the green up-arrow.

Moves of 1 or 2 places are not drawn at all. That is deliberate and it matters: a rank is a queue, so one player climbing ten spots pushes every single player he passed down by exactly one. Drawing those would fill the column with red -1s and report ONE player's move as though eleven things had happened. Only a move of 3 or more shows an arrow, which means anything you see is a real change of opinion rather than someone else's displacement. On the last refresh that was the difference between 196 raw changes and 70 real ones. The threshold is DELTA_MIN in tiers.js if you want it stricter or looser.

Three different things can appear in a movement column, and they are drawn differently on purpose:

  - An arrow and a number : he moved that far, and it cleared the threshold.
  - A faint dot           : either he did not really move, or he moved 1-2 places. Hover it - the tooltip gives you the exact number it is suppressing, so nothing is hidden from you, just de-emphasised.
  - A faint dot, no data  : there is no earlier value to compare against. Hovering says so. "Unknown" and "did not move" are different facts and should not look identical.

What each column measures against is named in the footer, e.g. "movement vs 8/6/2026".

One honest gap: dADP is blank until you have refreshed at least once. The Footballers' movement works immediately, because the previous ranks are stored inside the snapshot file itself, so even a brand-new browser shows them. Sleeper publishes no ADP history at all, so an ADP baseline can only be built by this tool recording what it held before a refresh. From your first refresh onward it works the same as dFFB.

Refreshing twice in a row will NOT wipe your movement columns. If the baseline about to be replaced is under an hour old, the older baseline is kept instead - otherwise an idle second click would reset everything to "a minute ago" and flatten every arrow to a dot. The status line tells you when that has happened.

Printing a one-pager
--------------------
"Print sheet" in the toolbar builds a printable version of EVERY position at once - all four boards, all your tiers, your ordering - and hands it to your browser's print dialog. Everything lands on one side of one sheet of Letter paper.

Three columns, each position kept whole:

  QB  |  RB  |  WR
  TE  |      |

Each line is: the player, an "R" if he is a rookie, his position (the depth-chart slot for RB and WR - RB1, WR3 - or just QB / TE), his NFL team, his Sleeper ADP, and the round that ADP falls in. No leading rank number: the order down the column IS the rank.

Type size is fitted automatically. Because no position splits across a column, the tallest column sets the size, and that is nearly always WR. At the default depths (QB 30, RB 60, WR 80, TE 30 - 200 players) it prints at 7.6pt with a little room to spare.

WR depth is the lever if you want to change that: every 10 WRs you drop buys roughly half a point of type, and every 10 you add costs the same. WR at 100 drops you to about 6.3pt. If you would rather have bigger type than strict one-position-per-column, letting the positions flow across the three columns instead would print the same players at the 8pt maximum, at the cost of a column sometimes starting part-way down a list.

If a board grows past what one page can hold - WR set to "All" is the case that does it - the status line says so and tells you what to trim, rather than quietly handing you a second page.

Print in portrait with margins at default. Turning off "Headers and footers" in the browser's print dialog gives the cleanest sheet.

Where the Footballers ranks come from (and how to refresh them)
--------------------------------------------------------------
Their site sends an Access-Control-Allow-Origin header locked to its own domain - both on the rankings pages and on their internal JSON endpoint. A double-clicked file:// page is therefore NOT allowed to fetch them, and no amount of code in tiers.js can change that. Their ranks are also public HTML rather than an API, so they have to be scraped.

So the ranks live in a local snapshot, ffb-rankings.js, and index.html loads it with a plain <script> tag. (It is a .js file rather than .json on purpose: a file:// page cannot fetch a local .json either, but it can load a script.)

The scrape cannot run in a browser page - not on the published site, not on localhost, not from a file. So it runs somewhere else, and there are two ways to trigger it:

  - **GitHub Action (the published site).** Go to the repo's Actions tab -> "Refresh rankings" -> "Run workflow". It scrapes on GitHub's runners, commits a new ffb-rankings.js, and the site redeploys in a minute or two. Then press "Get latest rankings" on the open board, or just reload. There is deliberately NO schedule on the workflow: nothing updates behind your back.
  - **Locally.** Double-click refresh-rankings.cmd, wait for it to finish, then reload the board. (Same thing from a terminal: `node dev/fetch-ffb.js`.) Needs Node installed.

Either way it opens their four position pages in a background browser, switches the scoring selector to full PPR, scrapes the consensus rank column, and rewrites ffb-rankings.js, recording each player's PREVIOUS rank as it goes - that embedded baseline is what the dFFB column reads. It prints what it found so you can see it worked, and if it fails it says so and leaves your previous ranks untouched.

"Get latest rankings" on the page does not scrape. What it does is go and check whether a newer snapshot has been published, load it if so, and re-pull Sleeper ADP (which the browser CAN fetch, since Sleeper allows it). It also re-downloads the Sleeper player list if that has gone over a day old. If it finds nothing new it says so rather than pretending.

Publishing it (GitHub Pages)
----------------------------
The board is plain HTML, JS and CSS, so it publishes as a static site with nothing to build:

  1. Push the folder to a GitHub repo.
  2. Settings -> Pages -> Source: "Deploy from a branch", branch main, folder / (root). Save.
  3. Wait a minute, then open the URL Pages gives you.
  4. Actions tab -> "Refresh rankings" -> "Run workflow" whenever you want fresh ranks.

The dev/ folder and PLAN.md get published along with everything else. They are harmless - nothing links to them - but they are not needed to run the board.

One caveat on failure: if a single position fails to scrape while the others succeed, that position is absent from the new file rather than carried over from the old one. The scrape says so loudly when it happens. Recovery is `git checkout HEAD~1 -- ffb-rankings.js` (or the previous run's commit) - every snapshot is in the repo history, which is a better safety net than a backup file.

Your tiers and your ordering survive a refresh. Specifically:

  - Nothing is reordered. Your board keeps exactly the order you put it in.
  - Nobody is removed. A player the Footballers have dropped stays on your board and simply shows a dash in the FFB column; the status line tells you how many are in that state.
  - Players who have newly climbed into your top N are ADDED AT THE BOTTOM of that position, so you can place them yourself. The status line names how many went where.

The footer shows the snapshot's date and age, and nags in amber once it is more than a week old.

Two things worth knowing about that script:

  - Their pages default to HALF PPR, and the ranks genuinely differ from full PPR. The script forces full PPR and records what it applied, per position, in the snapshot. As of the August 2026 snapshot the difference at the top of RB is at rank 4 - full PPR has Jonathan Taylor there, half PPR and standard have James Cook - while Jahmyr Gibbs is RB1 in all three formats. Do not use a specific player pair as your test of whether the scrape got full PPR, because their rankings move: check scoringByPosition in the snapshot, which records what was actually applied.
  - The QB page has no scoring selector at all, which is correct - receptions do not affect quarterback scoring, so QB ranks are the same in every format. The snapshot records that as "not format-dependent".

Sleeper ADP is fetched live the first time and then cached indefinitely; "Get latest rankings" forces a fresh pull of it alongside the rankings check. Your ordering and tiers are never touched by an update - only the reference numbers, the movement columns, and the drift arrows.

If ffb-rankings.js is missing or fails to load, the tool still works on Sleeper ADP alone, and the footer says so.

Name matching
-------------
The two sources spell players differently, so Footballers rows are matched to Sleeper ids on position plus a normalized name: case folded, accents stripped ("Estimé" -> "Estime"), punctuation removed ("De'Von" -> "DeVon"), and generational suffixes dropped ("James Cook III" -> "James Cook"). A handful of nicknames need an explicit alias - NAME_ALIASES in tiers.js currently maps "Hollywood Brown" to "Marquise Brown".

All 309 Footballers rows currently match. If a future snapshot introduces a new nickname the footer will show a "N unmatched" note, and the fix is one line in NAME_ALIASES.

Controls
--------
  - Show                : how deep to seed the position, including an "All" option. Growing appends the newly included players at the bottom and leaves your ordering alone. Shrinking drops players who fall outside the new top-N, and asks first if that would remove anything.
  - + Tier break        : adds a tier break at the bottom of the list.
  - Get latest rankings : checks for a newly published rankings snapshot, re-pulls Sleeper ADP, and tops up the player list if it is over a day old. Updates the board in place, never reorders it, and reports what actually moved. This is the only thing that fetches new data.
  - Print sheet         : the one-page printable version of all four boards.
  - Reset               : start over. Erases EVERY tier and ordering at all four positions, clears every cached number, then re-resolves the league, re-downloads the player list, re-pulls ADP, and takes the newest rankings. Asks first, and there is no undo. This is the start-of-a-new-season button - it is what rolls the tool onto next year with no code edit.

Caching
-------
The first open downloads the player list from Sleeper (~15 MB, one time) and caches it. After that, opening the board makes NO network requests at all - the player list, the ADP and the league are all served from cache regardless of age, so it loads instantly and works with no connection (useful at a draft table on bad wifi). Nothing expires on its own; "Get latest rankings" and "Reset" are what refetch. The footer always shows how old the data is.

All storage keys are prefixed "tb_" so this tool and the keeper Draft Helper can never overwrite each other's caches:

  tb_players_v2    - trimmed player list (v2 added the depth-chart fields)
  tb_league_id_v1  - resolved league id
  tb_league_obj_v1 - the league itself, cached so opening needs no network
  tb_adp_v2_*      - Sleeper ADP
  tb_adp_prev_v1   - the ADP baseline the dADP column measures against
  tb_board_v1      - your tiers and ordering
  tb_gh_token_v1   - your GitHub token, if you turned sync on (this browser only)

Reset clears everything under the tb_ prefix, so it cannot leave a stale key behind to poison the fresh state - including the sync token, so you will need to paste that again after a reset.

New seasons (no yearly edit needed)
-----------------------------------
Sleeper creates a NEW league id every season and only links them backwards, so tiers.js keeps a starting "seed" id near the top:

  const SEED_LEAGUE_ID = "1248017523933196288";

On load the app walks that chain forward to the most recent season whose draft is complete, then builds the board for the season AFTER it - the draft that has not happened yet. The seed is only a fallback; you normally never touch it.

The league lookup is used for exactly two things: picking the Sleeper ADP flavor that matches your scoring (PPR vs half-PPR vs standard vs 2QB) and choosing the target season. If Sleeper is unreachable, it falls back to PPR ADP and the current calendar year.

Because the league is cached indefinitely, the thing that rolls the board onto a new season is pressing **Reset** - it re-resolves the league from the seed id, so it picks up the new year's league, scoring and team count on its own.

There are now NO yearly code edits. The scraper used to carry a hardcoded SEASON for the Footballers page URLs; it now derives the season from the clock, trying the current year first and then next and last year, and records in the snapshot which one it actually found.

Known limitations
-----------------
  - The Footballers ranks are a snapshot, not live. They are only as current as the last time the scrape was run. This is forced by their CORS policy, not a shortcut - and it is why the scrape lives in a GitHub Action or a local .cmd rather than in the page.
  - dADP has no history before your first refresh, because Sleeper does not publish past ADP. dFFB does not have this gap, since the previous ranks travel inside the snapshot file.
  - Movement is measured against your LAST refresh, not against a fixed preseason baseline. Refresh weekly and the columns show a week of movement; refresh twice in an hour and the one-hour rule keeps the older comparison rather than showing you nothing.
  - The pool is only players the Footballers rank. Someone they have not ranked will not appear even if he has a Sleeper ADP. Their lists are deep enough that this rarely bites (WR goes 130 deep), but it is a real consequence of ordering by one source.
  - Depth-chart slots come from Sleeper and are currently complete for every RB and WR on the board, but they can go stale during camp and after injuries. Treat a surprising RB2 as a prompt to check the news, not as fact.
  - K and DEF are excluded on purpose.
  - Dragging starts from the grip handle only, so the rest of the row stays free for touch-scrolling on a phone.
  - Requires an internet connection on first load and whenever a cache expires.

Files
-----
Needed to run or publish the tool:

  index.html           - markup
  tiers.js             - data, ordering, board logic, print sheet
  tiers.css            - screen and print styling
  ffb-rankings.js      - the Footballers snapshot (generated)
  README.txt           - this file

Those four files ARE the tool. Nothing else is needed to run or publish it.

  refresh-rankings.cmd - double-click to refresh the snapshot locally (needs Node)
  .github/workflows/refresh-rankings.yml - the manual "Refresh rankings" Action

refresh-rankings.cmd calls into dev/, so it only works from this folder with dev/ alongside it.

PLAN.md is the build log. The dev/ folder holds the scraper, a backup of the previous rankings snapshot, and the verification harnesses. None of it is needed at runtime.

  dev/fetch-ffb.js          - the scraper; run by the .cmd and by the Action
  dev/summarise-movement.js - prints what moved; the Action logs this
  dev/verify.js             - headless checks (data, board and movement math)
  dev/verify-browser.js     - browser checks (drag, columns, print, update, reset)

Saved format
------------
The board is stored under the localStorage key "tb_board_v1" and exports as:

  { version: 1, season: 2026,
    positions: { RB: { count: 60, order: [ {t:"brk", label:""}, {t:"p", pid:"4034"}, ... ] } } }

Entries are either a tier break ("brk", with an empty label meaning auto-number) or a player ("p", by Sleeper player id), in board order. This format is versioned on purpose: a future live-draft assistant is meant to read it to rank the remaining player pool.
