/**
 * Refresh the local snapshot of The Fantasy Footballers' draft rankings.
 *
 * Their rankings pages are public, but both the pages and their wp-json endpoint
 * send an Access-Control-Allow-Origin locked to their own domain, so a
 * double-clicked file:// page cannot fetch them. This script scrapes the four
 * position pages with the scoring selector set to full PPR and writes
 * ../ffb-rankings.js, which index.html loads with a plain <script> tag (a local
 * fetch() of a .json file would also be CORS-blocked from file://).
 *
 * Run it whenever you want fresh Footballers ranks:
 *   node dev/fetch-ffb.js
 *
 * It is also required as a module by dev/serve.js, which is what lets the board's
 * own Refresh button do this same scrape server-side. Hence refresh() is exported
 * and the CLI path only runs when this file is the entry point.
 */

const fs = require("fs");
const path = require("path");

const PLAYWRIGHT_PATHS = [
  "playwright",
  "@playwright/test",
  path.join(process.env.APPDATA || "", "npm/node_modules/@playwright/cli/node_modules/playwright"),
];

/**
 * Load Playwright from the first path that resolves.
 *
 * @returns {Object} the playwright module.
 */
function requirePlaywright() {
  for (const candidate of PLAYWRIGHT_PATHS) {
    if (!candidate) continue;
    try {
      return require(candidate);
    } catch (err) {
      // Try the next candidate.
    }
  }
  console.error("No Playwright install found. Tried:\n  " + PLAYWRIGHT_PATHS.join("\n  "));
  process.exit(2);
}

const { chromium } = requirePlaywright();

const BASE = "https://www.thefantasyfootballers.com/";

/**
 * Seasons to try in the page URLs, best first. Derived from the clock rather than
 * hardcoded so the tool keeps working in future years with no code edit: drafts run
 * in late summer, so the current calendar year is nearly always the right one, with
 * next year covered for an early look and last year as a final fallback.
 */
const SEASON_CANDIDATES = [
  new Date().getFullYear(),
  new Date().getFullYear() + 1,
  new Date().getFullYear() - 1,
];

/** Position -> the slug of its draft-rankings page. Alternates are tried in order. */
const PAGES = {
  QB: ["quarterback-rankings-draft"],
  RB: ["running-back-rankings-draft"],
  WR: ["wide-receiver-rankings-draft", "wideout-rankings-draft"],
  TE: ["tight-end-rankings-draft"],
};

const OUT_FILE = path.join(__dirname, "..", "ffb-rankings.js");

/**
 * A snapshot younger than this is not used as a movement baseline. Refreshing
 * twice in quick succession would otherwise zero out every delta, so the older
 * baseline is carried forward instead. Matches ADP_BASELINE_MIN_MS in tiers.js.
 */
const BASELINE_MIN_MS = 60 * 60 * 1000;

/**
 * Launch a browser without installing anything.
 *
 * @returns {Promise<Object>} a launched browser.
 */
async function launchBrowser() {
  const local = process.env.LOCALAPPDATA || "";
  const attempts = [
    { channel: "chrome" },
    { channel: "msedge" },
    { executablePath: path.join(local, "ms-playwright/chromium-1208/chrome-win64/chrome.exe") },
    // Playwright's own bundled browser, last. This is the one that works in CI: the
    // three above are all Windows-desktop specific, so on a Linux GitHub runner every
    // one of them fails and without this the workflow could never launch anything.
    {},
  ];
  let lastErr = null;
  for (const opts of attempts) {
    try {
      return await chromium.launch(opts);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

/**
 * Scrape one position's ranking table at full PPR.
 *
 * @param {import('playwright').Page} page - a page to navigate.
 * @param {string} pos - the position label.
 * @param {string[]} slugs - candidate page slugs.
 * @returns {Promise<{url: string, players: Object[]}|null>} the scraped ranks.
 */
async function scrapePosition(page, pos, slugs, seasons) {
  const urls = [];
  for (const season of seasons) {
    for (const slug of slugs) urls.push({ season: season, url: BASE + season + "-" + slug + "/" });
  }

  for (const candidate of urls) {
    const url = candidate.url;
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    } catch (err) {
      console.log("  " + pos + ": cannot open " + url + " (" + err.message.split("\n")[0] + ")");
      continue;
    }
    await page.waitForTimeout(1500);

    const hasTable = await page.locator("table tr").count();
    if (!hasTable) {
      console.log("  " + pos + ": no table at " + url);
      continue;
    }

    // Force full PPR. The page defaults to Half PPR and the ranks genuinely
    // differ, so this is not optional. Driven from inside the page because the
    // control re-mounts itself and a Playwright selectOption goes stale.
    const scoringSet = await page.evaluate(() => {
      // The control carries id="basic-scoring" (not name), so match either. A bare
      // "select" fallback is deliberately avoided: it could grab an unrelated
      // dropdown and report success misleadingly.
      const sel = document.querySelector('select#basic-scoring, select[name="basic-scoring"]');
      if (!sel) return { found: false, hasPpr: false, value: null };
      const hasPpr = Array.from(sel.options).some((opt) => opt.value === "ppr");
      if (!hasPpr) return { found: true, hasPpr: false, value: sel.value };
      sel.value = "ppr";
      sel.dispatchEvent(new Event("input", { bubbles: true }));
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      return { found: true, hasPpr: true, value: sel.value };
    });
    await page.waitForTimeout(2500);

    // QB pages carry no PPR option, which is correct - receptions do not affect
    // quarterback scoring, so their ranks are the same in every format.
    let scoringNote = "PPR";
    if (!scoringSet.found) {
      scoringNote = "page default (no scoring control)";
      console.log("  " + pos + ": note - no scoring control on this page");
    } else if (!scoringSet.hasPpr) {
      scoringNote = "not format-dependent";
      console.log("  " + pos + ": note - page has no PPR option (scoring does not affect this position)");
    } else if (scoringSet.value !== "ppr") {
      scoringNote = "FAILED to apply PPR";
      console.log("  " + pos + ": WARNING could not apply PPR (value is '" + scoringSet.value + "')");
    }

    const players = await page.evaluate(() => {
      const out = [];
      const rows = Array.from(document.querySelectorAll("table tr"));
      for (const row of rows) {
        const cells = Array.from(row.querySelectorAll("td"));
        if (cells.length < 2) continue; // header or spacer

        const playerText = (cells[0].innerText || "").replace(/\s+/g, " ").trim();
        const rankText = (cells[1].innerText || "").trim();
        const rank = parseInt(rankText, 10);
        if (!playerText || !isFinite(rank)) continue;

        // "Jahmyr Gibbs DET (6)" / "James Cook III BUF (7)" -> name, team, bye
        const match = playerText.match(/^(.+?)\s+([A-Z]{2,3})\s*\((\d+)\)\s*$/);
        let name = playerText;
        let team = "";
        if (match) {
          name = match[1].trim();
          team = match[2];
        } else {
          // Fall back to stripping a trailing all-caps token.
          const alt = playerText.match(/^(.+?)\s+([A-Z]{2,3})$/);
          if (alt) {
            name = alt[1].trim();
            team = alt[2];
          }
        }
        out.push({ rank: rank, name: name, team: team });
      }
      return out;
    });

    // Keep one row per player, lowest rank wins, then sort by rank.
    const byName = new Map();
    for (const player of players) {
      const prev = byName.get(player.name);
      if (!prev || player.rank < prev.rank) byName.set(player.name, player);
    }
    const cleaned = Array.from(byName.values()).sort((aPl, bPl) => aPl.rank - bPl.rank);

    if (cleaned.length >= 10) {
      return { url: url, players: cleaned, scoring: scoringNote, season: candidate.season };
    }
    console.log("  " + pos + ": only " + cleaned.length + " rows parsed at " + url);
  }
  return null;
}

/**
 * Normalize a player name for matching an old snapshot's rows to a new one. Must
 * stay in step with normalizeName() in tiers.js - the Footballers are not
 * consistent about suffixes and accents between refreshes, and a name that fails
 * to match would silently read as "brand new player, no previous rank".
 *
 * @param {string} name - a player name.
 * @returns {string} the normalized form.
 */
function normalizeName(name) {
  return String(name == null ? "" : name)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.'’]/g, "")
    .replace(/-/g, " ")
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/[^a-z ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Read the snapshot that is about to be replaced, so its ranks can become the new
 * file's baseline. Loaded by evaluating it against a fake window, which is exactly
 * how the browser consumes it.
 *
 * @returns {Object|null} the existing snapshot payload, or null if unreadable.
 */
function readExistingSnapshot() {
  try {
    if (!fs.existsSync(OUT_FILE)) return null;
    const source = fs.readFileSync(OUT_FILE, "utf8");
    const sandbox = { window: {} };
    // eslint-disable-next-line no-new-func
    new Function("window", source)(sandbox.window);
    return sandbox.window.FFB_RANKINGS || null;
  } catch (err) {
    console.log("  note - could not read the existing snapshot for a baseline (" + err.message + ")");
    return null;
  }
}

/**
 * Choose which snapshot the new file should measure movement against.
 *
 * Normally that is the snapshot being replaced. But if that snapshot is under an
 * hour old it is a poor baseline: refreshing twice in a row would reset every
 * delta to zero and throw away the comparison you actually wanted. In that case
 * its own older baseline is carried forward instead.
 *
 * @param {Object|null} existing - the snapshot about to be replaced.
 * @returns {{at: string, ranks: Object}|null} the baseline to embed.
 */
function chooseBaseline(existing) {
  if (!existing || !existing.positions) return null;

  const fetchedAt = Date.parse(existing.fetchedAt || "");
  const ageMs = isFinite(fetchedAt) ? Date.now() - fetchedAt : Infinity;

  if (ageMs < BASELINE_MIN_MS && existing.previousFetchedAt) {
    // Too fresh to be a useful baseline - keep the one it already carried.
    const ranks = {};
    for (const pos of Object.keys(existing.positions)) {
      ranks[pos] = {};
      for (const entry of existing.positions[pos]) {
        if (typeof entry.prevRank === "number") ranks[pos][normalizeName(entry.name)] = entry.prevRank;
      }
    }
    console.log(
      "  baseline - existing snapshot is " + Math.round(ageMs / 60000) +
      "m old, so carrying its own baseline (" + existing.previousFetchedAt + ") forward instead"
    );
    return { at: existing.previousFetchedAt, ranks: ranks };
  }

  const ranks = {};
  for (const pos of Object.keys(existing.positions)) {
    ranks[pos] = {};
    for (const entry of existing.positions[pos]) {
      if (typeof entry.rank === "number") ranks[pos][normalizeName(entry.name)] = entry.rank;
    }
  }
  return { at: existing.fetchedAt || "", ranks: ranks };
}

/**
 * Scrape all four positions and write the snapshot, embedding each player's rank
 * from the previous snapshot as prevRank so the board can show what moved.
 *
 * @param {(msg: string) => void} [log] - where to send progress lines.
 * @returns {Promise<Object>} the payload that was written.
 */
async function refresh(log) {
  const say = log || console.log;
  const existing = readExistingSnapshot();
  const baseline = chooseBaseline(existing);

  const browser = await launchBrowser();
  const page = await browser.newPage();

  const positions = {};
  const sources = {};
  const scoringByPos = {};
  const failedPositions = [];

  const seasonsFound = [];

  try {
    for (const pos of Object.keys(PAGES)) {
      const result = await scrapePosition(page, pos, PAGES[pos], SEASON_CANDIDATES);
      if (!result) {
        say("  " + pos + ": FAILED");
        failedPositions.push(pos);
        continue;
      }
      scoringByPos[pos] = result.scoring;
      sources[pos] = result.url;
      seasonsFound.push(result.season);

      // Attach the previous rank per player. null means the baseline did not rank
      // him, which is a different fact from "did not move" and is rendered as such.
      const prevForPos = (baseline && baseline.ranks[pos]) || {};
      positions[pos] = result.players.map((pl) => {
        const prev = prevForPos[normalizeName(pl.name)];
        return {
          rank: pl.rank,
          name: pl.name,
          team: pl.team,
          prevRank: typeof prev === "number" ? prev : null,
        };
      });

      const moved = positions[pos].filter(
        (pl) => typeof pl.prevRank === "number" && pl.prevRank !== pl.rank
      ).length;
      const isNew = positions[pos].filter((pl) => pl.prevRank === null).length;
      const top = result.players.slice(0, 3).map((pl) => pl.rank + " " + pl.name + " (" + pl.team + ")");
      say(
        "  " + pos.padEnd(3) + " " + String(result.players.length).padStart(3) + " players  " +
        top.join(", ") + "  [" + moved + " moved, " + isNew + " unbaselined]"
      );
    }
  } finally {
    await browser.close();
  }

  if (!Object.keys(positions).length) {
    throw new Error("Nothing scraped - leaving the existing snapshot alone.");
  }

  const payload = {
    source: "The Fantasy Footballers draft rankings",
    scoring: "full PPR where the format matters",
    scoringByPosition: scoringByPos,
    // The season actually scraped, not one assumed: the URLs are tried newest-first.
    season: seasonsFound.length ? Math.max.apply(null, seasonsFound) : new Date().getFullYear(),
    fetchedAt: new Date().toISOString(),
    // Which snapshot the prevRank values came from, so the board can say what its
    // movement columns are measured against.
    previousFetchedAt: (baseline && baseline.at) || "",
    pages: sources,
    positions: positions,
  };

  const banner =
    "/**\n" +
    " * The Fantasy Footballers draft rankings, full PPR - LOCAL SNAPSHOT.\n" +
    " *\n" +
    " * GENERATED FILE - do not edit by hand. Refresh it with the board's Refresh\n" +
    " * button (see start.cmd), or directly with:\n" +
    " *   node dev/fetch-ffb.js\n" +
    " *\n" +
    " * It is a .js file rather than .json on purpose: a double-clicked file:// page\n" +
    " * cannot fetch() a local .json, but it can load a script tag.\n" +
    " *\n" +
    " * Each player carries prevRank: his rank in the snapshot named by\n" +
    " * previousFetchedAt, or null if that snapshot did not rank him.\n" +
    " */\n\n";

  fs.writeFileSync(
    OUT_FILE,
    banner + "window.FFB_RANKINGS = " + JSON.stringify(payload, null, 2) + ";\n",
    "utf8"
  );

  const total = Object.values(positions).reduce((sum, list) => sum + list.length, 0);
  say(
    "\nWrote " + path.relative(process.cwd(), OUT_FILE) + " - " + total +
    " players across " + Object.keys(positions).length + " positions." +
    (baseline && baseline.at ? " Movement measured against " + baseline.at + "." : " No previous snapshot to compare against.")
  );
  if (failedPositions.length) {
    say(
      failedPositions.join(", ") + " failed to scrape; those positions are ABSENT from the new " +
      "file, not carried over. Restore from a backup if that matters."
    );
  }

  return { payload: payload, failed: failedPositions, total: total };
}

module.exports = { refresh: refresh, normalizeName: normalizeName, OUT_FILE: OUT_FILE };

// Only run the scrape when invoked directly; dev/serve.js requires this as a module.
if (require.main === module) {
  refresh().catch((err) => {
    console.error("\n" + err.message);
    process.exit(1);
  });
}
