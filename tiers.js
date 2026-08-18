/**
 * Positional Tier Board - drag-and-drop tier rankings for a Sleeper league.
 *
 * Runs fully client-side from a double-clicked index.html (no server, no auth).
 * Pick a position tab to get players pre-sorted by a blend of two ranking
 * sources, then drag them into the order you actually believe and drop tier
 * breaks between them. Everything auto-saves to localStorage.
 *
 * Ranking sources:
 *   1. The Fantasy Footballers' draft rankings, full PPR - weighted FFB_WEIGHT.
 *      Read from ffb-rankings.js, a local snapshot, because their site sends an
 *      Access-Control-Allow-Origin locked to its own domain and a file:// page
 *      cannot fetch it. Refresh it with `node dev/fetch-ffb.js`.
 *   2. Sleeper's own ADP for this league's scoring - weighted SLEEPER_WEIGHT.
 *      Fetched live, cached 12h.
 *
 * This tool is published separately from the keeper Draft Helper and shares no
 * files with it. Every storage key is under the `tb_` namespace so the two tools
 * cannot clobber each other's caches.
 */

/** Seed Sleeper league id; the app auto-advances to the latest season from here. */
const SEED_LEAGUE_ID = "1248017523933196288";

/** Sleeper public API base and GraphQL endpoint (both CORS-open, no auth). */
const SLEEPER = "https://api.sleeper.app/v1";
const SLEEPER_GQL = "https://sleeper.com/graphql";

/**
 * The order comes from The Fantasy Footballers' rankings alone. Sleeper ADP is
 * shown alongside for context (with the round it implies) but does not affect
 * the ordering: it is an overall draft position, not a positional rank, so
 * blending it with a positional ranking would be comparing two different things.
 */

/**
 * localStorage keys for the trimmed player map (full file is ~15 MB). The version
 * suffix is bumped whenever the trim shape changes, which forces a one-time
 * re-download - v2 added the depth-chart fields.
 *
 * Cached forever on open; PLAYERS_STALE_MS is only how old it must be before "Get
 * latest rankings" bothers re-downloading it.
 */
const PLAYERS_KEY = "tb_players_v2";
const PLAYERS_TS_KEY = "tb_players_ts_v2";
const PLAYERS_STALE_MS = 24 * 60 * 60 * 1000;

/** Positions where a team depth-chart slot is worth showing. */
const DEPTH_POSITIONS = new Set(["RB", "WR"]);

/** How old the Footballers snapshot can get before the footer nags about it. */
const FFB_STALE_DAYS = 7;

/**
 * Print sheet layout: three fixed columns, QB and TE sharing the first. Because a
 * position never splits across columns, the tallest column decides the type size,
 * and WR alone is usually the tallest.
 */
const PRINT_COLUMNS = [["QB", "TE"], ["RB"], ["WR"]];

/**
 * Usable page height in points: Letter (11in) minus the 0.3in @page margins, times
 * a safety factor. The factor is measured, not guessed: heading margins and borders
 * cost a little more than the line weights below account for, and without it a
 * fitted 7.9pt sheet came out 1% too tall and spilled onto a second page.
 */
const PRINT_PAGE_PT = 748.8 * 0.965;

/** Type is auto-fitted between these sizes, in points. */
const PRINT_MAX_PT = 8;
const PRINT_MIN_PT = 5.5;

/** Line-height multiplier used by the print rows, and what headings cost in lines. */
const PRINT_LINE_HEIGHT = 1.14;
const PRINT_POS_LINES = 1.5;
const PRINT_TIER_LINES = 1.35;

/**
 * localStorage keys for Sleeper ADP. There is deliberately no TTL: cached ADP is
 * used no matter how old, and only "Get latest rankings" fetches. See loadAdp.
 */
const ADP_KEY_BASE = "tb_adp_v2";
const ADP_TS_KEY = "tb_adp_ts_v2";

/**
 * Baseline ADP - the ADP the board held before the last refresh, which is what the
 * dADP column measures against. Sleeper publishes no ADP history, so this can only
 * be built up locally: the first refresh records it and every refresh after that
 * has something to compare to. Before then dADP is blank, which is the truth.
 */
const ADP_PREV_KEY = "tb_adp_prev_v1";

/**
 * A baseline younger than this is not replaced on refresh. Without this, clicking
 * Refresh twice would move the baseline to a minute ago and flatten every delta to
 * zero - destroying the comparison with an idle click. Mirrors BASELINE_MIN_MS in
 * dev/fetch-ffb.js, which does the same for the FFB side.
 */
const ADP_BASELINE_MIN_MS = 60 * 60 * 1000;

/**
 * Smallest movement worth drawing, in ranks or ADP picks. Not cosmetic: FFB ranks
 * are ordinal, so one player climbing ten spots pushes every player he passed down
 * by exactly one, and rendering those would report one man's move as if eleven
 * things had happened. Suppressing them means a visible arrow is a real change of
 * view rather than displacement. A two-pick ADP drift is noise on the same grounds.
 */
const DELTA_MIN = 3;

/**
 * The rankings snapshot, re-fetchable at runtime by "Get latest rankings".
 *
 * The scrape itself can never happen in the browser - the Footballers send an
 * Access-Control-Allow-Origin locked to their own domain, so the fetch is refused
 * from a file:// page, from localhost, and from GitHub Pages alike. A GitHub Action
 * runs the scrape and commits a new snapshot instead; this button is how a page
 * that is already open goes and gets it.
 */
const SNAPSHOT_FILE = "ffb-rankings.js";

/** localStorage keys + TTL for the resolved latest league id and its league object. */
const LEAGUE_ID_KEY = "tb_league_id_v1";
const LEAGUE_OBJ_KEY = "tb_league_obj_v1";
const LEAGUE_SEED_KEY = "tb_league_seed_v1";
const LEAGUE_TS_KEY = "tb_league_ts_v1";
const LEAGUE_TTL_MS = 24 * 60 * 60 * 1000;

/** localStorage key for the saved board, and the format version stamped into it. */
const BOARD_KEY = "tb_board_v1";
const BOARD_VERSION = 1;

/** Positions this tool tiers. K and DEF are excluded on purpose. */
const POSITIONS = ["QB", "RB", "WR", "TE"];

/**
 * Seed depth, per position - the positions are nowhere near the same size. You
 * draft a lot of receivers and very few quarterbacks, so a single global depth
 * either buries you in QBs or starves you of WRs.
 */
const DEFAULT_COUNTS = { QB: 30, RB: 60, WR: 80, TE: 30 };

/** Fallback depth for a position not listed above. */
const DEFAULT_COUNT = 60;

/** Depths offered in the "Show" dropdown, filtered to what a position can fill. */
const COUNT_CHOICES = [24, 30, 40, 60, 80, 100, 120];

/** Upper bound accepted from a saved or imported board. */
const MAX_COUNT = 400;

/**
 * Bumped when the default depths change, so saved boards migrate once. v3 dropped
 * WR from 100 to 80, which buys a bigger type size on the printed sheet (WR is the
 * tallest column, so it alone decides that).
 */
const COUNTS_VERSION = 3;

/** Flex roster slots expanded to the real positions they can hold. */
const FLEX_SLOTS = {
  FLEX: ["RB", "WR", "TE"],
  WRRB_FLEX: ["RB", "WR"],
  REC_FLEX: ["WR", "TE"],
  SUPER_FLEX: ["QB", "RB", "WR", "TE"],
  IDP_FLEX: ["DL", "LB", "DB"],
};

/** Roster slots that are not real on-field positions. */
const NON_POSITION_SLOTS = new Set(["BN", "IR", "TAXI"]);

/** In-memory state assembled on load. */
const state = {
  leagueName: "",
  leagueSeason: 0, // season of the latest draft-complete league
  targetSeason: 0, // season the board is being built for
  numTeams: 0,
  players: {}, // pid -> { name, pos, team, rank, rookie, adp, ffbRank, sleeperRank }
  adpField: "adp_ppr", // which Sleeper ADP field matches this league's scoring
  adpSeason: 0, // season the loaded ADP came from
  adpUpdatedAt: 0, // epoch ms ADP was last fetched
  usingAdp: false, // whether Sleeper ADP loaded at all
  adpPrev: null, // { at, field, season, byId } - the ADP dADP measures against
  ffb: null, // the Footballers snapshot from ffb-rankings.js, or null
  matchStats: { matched: 0, total: 0, unmatched: [] }, // FFB -> Sleeper name matching
  nameIndex: {}, // "POS|normalized name" -> [pid]
  positions: POSITIONS.slice(), // positions with a tab (intersected with the league)
  poolByPos: {}, // pos -> [pid] in blended order (the seed order)
  poolIndex: {}, // pos -> { pid -> index in poolByPos }
  activePos: "RB",
  board: null, // { version, season, positions: { pos: { count, order: [] } } }
};

/** Live drag operation, or null. */
let drag = null;

/** Timer for the "Saved" flash. */
let savedTimer = null;

// ---------------------------------------------------------------------------
// Sleeper data layer
// ---------------------------------------------------------------------------

/**
 * Fetch JSON from a URL, throwing a readable error on failure.
 *
 * @param {string} url - the endpoint to fetch.
 * @param {number} [timeoutMs] - abort after this many ms.
 * @returns {Promise<any>} parsed JSON body.
 */
async function fetchJson(url, timeoutMs) {
  const controller = new AbortController();
  const timer = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error("Request failed (" + res.status + "): " + url);
    return await res.json();
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * POST a GraphQL query to Sleeper and return its data.
 *
 * @param {string} query - the GraphQL query string.
 * @param {number} timeoutMs - abort after this many ms.
 * @returns {Promise<Object>} the data object.
 */
async function fetchGraphQL(query, timeoutMs) {
  const controller = new AbortController();
  const timer = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetch(SLEEPER_GQL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: query }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error("GraphQL " + res.status);
    const json = await res.json();
    if (json.errors) throw new Error("GraphQL error");
    return json.data;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Load the player map (pid -> name/pos/team/rank), using the trimmed
 * localStorage cache when it is fresh and re-downloading otherwise.
 *
 * @param {boolean} force - skip the cache and re-download.
 * @returns {Promise<Object>} the trimmed player map.
 */
async function loadPlayers(force) {
  if (!force) {
    try {
      const cached = localStorage.getItem(PLAYERS_KEY);
      // Cache-first with no expiry, like ADP: opening the board must never kick off a
      // 15 MB download or change any number on screen. "Get latest rankings" re-pulls
      // this when it has gone stale, and the footer shows its age.
      if (cached) return JSON.parse(cached);
    } catch (err) {
      // Corrupt or oversized cache - fall through to a fresh download.
    }
  }

  setStatus("Downloading the player list from Sleeper (one-time, ~15 MB)...", false, true);
  const raw = await fetchJson(SLEEPER + "/players/nfl");
  const downloadedAt = Date.now();

  const trimmed = {};
  for (const pid in raw) {
    const player = raw[pid];
    const rank =
      typeof player.search_rank === "number" && player.search_rank < 9999990
        ? player.search_rank
        : null;
    trimmed[pid] = {
      name: player.full_name || (player.first_name + " " + player.last_name).trim() || pid,
      pos: player.position || "",
      team: player.team || "FA",
      rank: rank,
      rookie: player.years_exp === 0,
      // Depth chart: order is the player's slot within his position on his team
      // (1 = starter). dcPos is the alignment Sleeper files him under, which for
      // receivers is LWR / RWR / SWR rather than plain WR.
      dcOrder: typeof player.depth_chart_order === "number" ? player.depth_chart_order : null,
      dcPos: player.depth_chart_position || "",
    };
  }

  try {
    localStorage.setItem(PLAYERS_KEY, JSON.stringify(trimmed));
    localStorage.setItem(PLAYERS_TS_KEY, String(downloadedAt));
  } catch (err) {
    // Storage full or unavailable - keep using the in-memory copy this session.
  }
  return trimmed;
}

/**
 * Pick the Sleeper ADP field that matches this league's format.
 *
 * @param {Object} league - the Sleeper league object.
 * @returns {string} an adp_* field name.
 */
function adpFieldFor(league) {
  const positions = (league && league.roster_positions) || [];
  const qbSlots = positions.filter((slot) => slot === "QB").length;
  if (positions.indexOf("SUPER_FLEX") !== -1 || qbSlots >= 2) return "adp_2qb";
  const rec = (league && league.scoring_settings && league.scoring_settings.rec) || 0;
  if (rec >= 1) return "adp_ppr";
  if (rec >= 0.5) return "adp_half_ppr";
  return "adp_std";
}

/**
 * Load Sleeper's ADP (pid -> ADP) from season projections, cached 12h. Never
 * rejects: on any failure it returns an empty result.
 *
 * @param {number} season - the draft season.
 * @param {string} adpField - the adp_* field to read.
 * @param {boolean} force - skip the cache.
 * @returns {Promise<{byId: Object, count: number}>} ADP data.
 */
async function loadAdp(season, adpField, force) {
  const cacheKey = ADP_KEY_BASE + "_" + adpField + "_" + season;
  if (!force) {
    try {
      const ts = Number(localStorage.getItem(ADP_TS_KEY) || 0);
      const cached = localStorage.getItem(cacheKey);
      // Any cached ADP is used, however old. Deliberately no expiry: opening the page
      // must never pull new numbers on its own, or the movement columns could change
      // under you before you had a chance to read them. "Get latest rankings" is the
      // only thing that fetches, and the footer always shows this data's age.
      if (cached) {
        state.adpUpdatedAt = ts;
        return JSON.parse(cached);
      }
    } catch (err) {
      // Ignore cache issues and fetch fresh.
    }
  }

  try {
    const query =
      '{ season_stats(sport:"nfl", season:"' + season +
      '", season_type:"regular", category:"proj", order_by:"' + adpField +
      '", positions:["QB","RB","WR","TE"]){ player_id stats } }';
    const data = await fetchGraphQL(query, 12000);
    const rows = (data && data.season_stats) || [];
    const byId = {};
    for (const row of rows) {
      const adp = row.stats && row.stats[adpField];
      // Exclude the 999 "not really drafted" sentinel Sleeper uses.
      if (typeof adp === "number" && adp > 0 && adp < 900) byId[row.player_id] = adp;
    }
    const result = { byId: byId, count: Object.keys(byId).length };
    const now = Date.now();
    state.adpUpdatedAt = now;
    try {
      localStorage.setItem(cacheKey, JSON.stringify(result));
      localStorage.setItem(ADP_TS_KEY, String(now));
    } catch (err) {
      // Non-fatal cache write failure.
    }
    return result;
  } catch (err) {
    return { byId: {}, count: 0 };
  }
}

/**
 * Read the stored ADP baseline, or null if there is not one yet.
 *
 * @returns {{at: number, field: string, season: number, byId: Object}|null} the baseline.
 */
function loadAdpBaseline() {
  try {
    const raw = localStorage.getItem(ADP_PREV_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.byId || typeof parsed.byId !== "object") return null;
    return {
      at: Number(parsed.at) || 0,
      field: String(parsed.field || ""),
      season: Number(parsed.season) || 0,
      byId: parsed.byId,
    };
  } catch (err) {
    return null; // Unreadable baseline just means no deltas, which is survivable.
  }
}

/**
 * Record the ADP the board currently holds as the baseline for future deltas.
 * Called just before a refresh applies newly fetched numbers.
 *
 * Refuses when the existing baseline is under ADP_BASELINE_MIN_MS old, so a second
 * click of Refresh cannot flatten the deltas you were about to read.
 *
 * @returns {boolean} true if the baseline was advanced.
 */
function captureAdpBaseline() {
  if (!state.usingAdp) return false; // nothing meaningful to record

  const existing = state.adpPrev;
  if (existing && existing.at && Date.now() - existing.at < ADP_BASELINE_MIN_MS) {
    return false;
  }

  const byId = {};
  for (const pid in state.players) {
    const adp = state.players[pid].adp;
    if (typeof adp === "number") byId[pid] = adp;
  }
  const baseline = {
    at: state.adpUpdatedAt || Date.now(),
    field: state.adpField,
    season: state.adpSeason,
    byId: byId,
  };
  try {
    localStorage.setItem(ADP_PREV_KEY, JSON.stringify(baseline));
  } catch (err) {
    return false; // Storage full - carry on without a new baseline.
  }
  state.adpPrev = baseline;
  return true;
}

/**
 * The baseline ADP for a player, but only when it is comparable: an ADP from a
 * different scoring format or a different season is a different number, and
 * subtracting one from the other would invent movement that never happened.
 *
 * @param {string} pid - a Sleeper player id.
 * @returns {number|null} the baseline ADP, or null when there is no fair comparison.
 */
function baselineAdpFor(pid) {
  const prev = state.adpPrev;
  if (!prev) return null;
  if (prev.field !== state.adpField) return null;
  if (prev.season && state.adpSeason && prev.season !== state.adpSeason) return null;
  const adp = prev.byId[pid];
  return typeof adp === "number" ? adp : null;
}

/**
 * Try each season in turn and return the first that actually has ADP data.
 *
 * @param {number[]} seasons - seasons to try, best first.
 * @param {string} adpField - the adp_* field to read.
 * @param {boolean} force - skip the cache.
 * @returns {Promise<{byId: Object, count: number, season: number}>} ADP data.
 */
async function loadAdpForSeasons(seasons, adpField, force) {
  for (const season of seasons) {
    const result = await loadAdp(season, adpField, force);
    if (result.count > 0) return { byId: result.byId, count: result.count, season: season };
  }
  return { byId: {}, count: 0, season: seasons[0] };
}

/**
 * Whether a league's draft has already happened.
 *
 * @param {Object} league - a Sleeper league object.
 * @returns {boolean} true if the draft is complete.
 */
function draftDone(league) {
  return !!league && league.status !== "pre_draft" && league.status !== "drafting";
}

/**
 * Find the next-season league that chains back to a known league.
 *
 * @param {string[]} memberIds - user ids from the known league.
 * @param {number} season - the season to look in.
 * @param {string} prevId - the league id the next league should point back to.
 * @returns {Promise<Object|null>} the next league object, or null.
 */
async function findNextLeague(memberIds, season, prevId) {
  for (const uid of memberIds) {
    try {
      const leagues = await fetchJson(SLEEPER + "/user/" + uid + "/leagues/nfl/" + season);
      const match = leagues.find((lg) => lg.previous_league_id === prevId);
      if (match) return match;
    } catch (err) {
      // Skip this member (private/unavailable) and try the next one.
    }
  }
  return null;
}

/**
 * Walk forward from a seed league to the most recent draft-complete league.
 *
 * @param {string} seedId - the seed league id.
 * @returns {Promise<{leagueId: string, league: Object}>} the latest league.
 */
async function resolveLatestLeague(seedId) {
  let leagueId = seedId;
  let league = await fetchJson(SLEEPER + "/league/" + leagueId);

  let memberIds = [];
  try {
    const users = await fetchJson(SLEEPER + "/league/" + leagueId + "/users");
    memberIds = users.map((usr) => usr.user_id);
  } catch (err) {
    return { leagueId, league }; // cannot walk forward without members
  }

  const maxSeason = new Date().getFullYear() + 1;
  let guard = 0;
  while (Number(league.season) < maxSeason && guard < 12) {
    guard++;
    const next = await findNextLeague(memberIds, Number(league.season) + 1, leagueId);
    if (!next || !draftDone(next)) break;
    leagueId = next.league_id;
    league = next;
    try {
      const users = await fetchJson(SLEEPER + "/league/" + leagueId + "/users");
      if (users.length) memberIds = users.map((usr) => usr.user_id);
    } catch (err) {
      // Keep the previous member list if the new one cannot be fetched.
    }
  }
  return { leagueId, league };
}

/**
 * Resolve the latest league, using a 24h cache.
 *
 * @returns {Promise<{leagueId: string, league: Object}>} the latest league.
 */
async function getLatestLeague(force) {
  if (!force) {
    try {
      const ts = Number(localStorage.getItem(LEAGUE_TS_KEY) || 0);
      const seed = localStorage.getItem(LEAGUE_SEED_KEY);
      const id = localStorage.getItem(LEAGUE_ID_KEY);
      const cached = localStorage.getItem(LEAGUE_OBJ_KEY);
      // The whole league object is cached, not just its id. Caching only the id still
      // cost a network round-trip on every single open, which both slowed the load and
      // meant the board could not open at all without a connection - a bad property for
      // something you use at a draft table on hotel wifi.
      if (id && cached && seed === SEED_LEAGUE_ID && Date.now() - ts < LEAGUE_TTL_MS) {
        const league = JSON.parse(cached);
        if (league && league.league_id) return { leagueId: id, league: league };
      }
    } catch (err) {
      // Fall through to a fresh resolve on any cache problem.
    }
  }

  const resolved = await resolveLatestLeague(SEED_LEAGUE_ID);
  try {
    localStorage.setItem(LEAGUE_ID_KEY, resolved.leagueId);
    localStorage.setItem(LEAGUE_OBJ_KEY, JSON.stringify(resolved.league));
    localStorage.setItem(LEAGUE_SEED_KEY, SEED_LEAGUE_ID);
    localStorage.setItem(LEAGUE_TS_KEY, String(Date.now()));
  } catch (err) {
    // Non-fatal: we just will not have a cached league next time.
  }
  return resolved;
}

/**
 * Derive the set of positions a league actually drafts from its roster slots.
 *
 * @param {string[]} rosterPositions - the league's roster_positions array.
 * @returns {Set<string>} draftable positions.
 */
function derivePositions(rosterPositions) {
  const set = new Set();
  for (const slot of rosterPositions || []) {
    if (NON_POSITION_SLOTS.has(slot)) continue;
    if (FLEX_SLOTS[slot]) FLEX_SLOTS[slot].forEach((pos) => set.add(pos));
    else set.add(slot);
  }
  return set;
}

// ---------------------------------------------------------------------------
// Blending the two ranking sources
// ---------------------------------------------------------------------------

/**
 * Nicknames the Footballers use that Sleeper files under a legal name. Keyed and
 * valued in normalized form.
 */
const NAME_ALIASES = {
  "hollywood brown": "marquise brown",
};

/**
 * Normalize a player name for cross-source matching: case, accents, punctuation,
 * and generational suffixes all vary between the Footballers and Sleeper
 * ("James Cook III" vs "James Cook", "Estimé" vs "Estime", "De'Von" vs "DeVon").
 *
 * @param {string} name - a player name.
 * @returns {string} the normalized form.
 */
function normalizeName(name) {
  const cleaned = String(name == null ? "" : name)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip accents: Estimé -> Estime
    .toLowerCase()
    .replace(/[.'’]/g, "")
    .replace(/-/g, " ")
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/[^a-z ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return NAME_ALIASES[cleaned] || cleaned;
}

/**
 * Index Sleeper's players by position + normalized name so Footballers rows can
 * be matched to Sleeper ids.
 */
function buildNameIndex() {
  const index = {};
  for (const pid in state.players) {
    const player = state.players[pid];
    if (!player.pos) continue;
    const key = player.pos + "|" + normalizeName(player.name);
    if (!index[key]) index[key] = [];
    index[key].push(pid);
  }
  state.nameIndex = index;
}

/**
 * Find the Sleeper player id for a Footballers ranking row.
 *
 * @param {{name: string, team: string}} entry - a Footballers row.
 * @param {string} pos - the position being matched.
 * @returns {string|null} a Sleeper player id, or null when no match exists.
 */
function matchToSleeper(entry, pos) {
  const candidates = state.nameIndex[pos + "|" + normalizeName(entry.name)];
  if (!candidates || !candidates.length) return null;
  if (candidates.length === 1) return candidates[0];

  // Same name at the same position: prefer the matching NFL team, then the more
  // prominent player (Sleeper's search_rank is lower for better-known players).
  const teamMatch = candidates.filter((pid) => state.players[pid].team === entry.team);
  const pool = teamMatch.length ? teamMatch : candidates;
  let best = pool[0];
  for (const pid of pool) {
    const bestRank = state.players[best].rank;
    const thisRank = state.players[pid].rank;
    if (typeof thisRank === "number" && (typeof bestRank !== "number" || thisRank < bestRank)) {
      best = pid;
    }
  }
  return best;
}

/**
 * The depth-chart cell for a player: his slot within his position on his own NFL
 * team, e.g. "RB1" for a lead back or "WR3" for a third receiver.
 *
 * @param {Object} player - a player object.
 * @returns {string} cell HTML.
 */
function depthCellHtml(player) {
  if (!player || typeof player.dcOrder !== "number") {
    return '<span class="dc none" title="Sleeper has no depth-chart slot for him">&ndash;</span>';
  }
  const order = player.dcOrder;
  const label = player.pos + order;
  // Sleeper files receivers by alignment, which is worth surfacing: a SWR1 is the
  // slot man, not necessarily the team's best receiver.
  const alignment = player.dcPos && player.dcPos !== player.pos ? " (" + player.dcPos + ")" : "";
  const title = player.team + " " + player.pos + " depth " + order + alignment;
  const cls = order === 1 ? "dc one" : order === 2 ? "dc two" : "dc deep";
  return '<span class="' + cls + '" title="' + escapeHtml(title) + '">' + escapeHtml(label) + "</span>";
}

/**
 * A movement cell: how far a player has moved in one source since that source's
 * last refresh. Both FFB rank and ADP are "lower is better", so a decrease is a
 * rise and gets the up arrow.
 *
 * Three distinct outcomes, deliberately drawn differently:
 *   - no baseline    -> a dim dot. "Unknown" is not "did not move".
 *   - under DELTA_MIN -> a dot, with the real number in the tooltip. Ordinal ranks
 *     shift by one every time somebody passes you, and drawing that would report
 *     one player's move on every row he crossed.
 *   - DELTA_MIN or more -> an arrow and the amount.
 *
 * @param {number|null} current - the value now.
 * @param {number|null} prev - the value at the last refresh, or null if unknown.
 * @param {string} cls - the column class, "dffb" or "dadp".
 * @param {string} label - what the number is, for tooltips.
 * @param {number} [digits] - decimal places to show.
 * @returns {string} cell HTML.
 */
function deltaCellHtml(current, prev, cls, label, digits) {
  const places = digits || 0;
  if (typeof current !== "number" || typeof prev !== "number") {
    return (
      '<span class="dlt ' + cls + ' none" title="No earlier ' + escapeHtml(label) +
      ' to compare against yet">&middot;</span>'
    );
  }

  const delta = prev - current;
  const size = Math.abs(delta);
  const from = prev.toFixed(places);
  const to = current.toFixed(places);

  if (size < DELTA_MIN) {
    const detail = size === 0
      ? "Unchanged at " + to
      : "Moved " + size.toFixed(places) + " (" + from + " to " + to + "), under the " +
        DELTA_MIN + "-place threshold for a real move";
    return '<span class="dlt ' + cls + ' flat" title="' + escapeHtml(detail) + '">&middot;</span>';
  }

  const rose = delta > 0;
  const amount = size.toFixed(places);
  const title =
    escapeHtml(label) + " " + from + " to " + to + " - " +
    (rose ? "up " : "down ") + amount + " since the last refresh";
  return (
    '<span class="dlt ' + cls + (rose ? " up" : " down") + '" title="' + escapeHtml(title) + '">' +
    (rose ? "&uarr; " : "&darr; ") + amount + "</span>"
  );
}

/**
 * The draft round an ADP falls in, for this league's team count.
 *
 * @param {number} adp - an overall ADP (pick number).
 * @returns {{round: number, pick: number}} the round and the pick within it.
 */
function roundOf(adp) {
  const teams = state.numTeams || 12;
  const overall = Math.max(1, Math.ceil(adp));
  const round = Math.ceil(overall / teams);
  const pick = overall - (round - 1) * teams;
  return { round: round, pick: pick };
}

/**
 * Build the seed pool for each position, straight from The Fantasy Footballers'
 * rankings. Players with no NFL team are excluded, which also drops retired
 * players. Sleeper ADP is attached for display but never affects the order.
 */
function buildPools() {
  buildNameIndex();
  state.poolByPos = {};
  state.poolIndex = {};
  state.matchStats = { matched: 0, total: 0, unmatched: [] };

  // Clear last run's ranks so a refreshed snapshot cannot leave a stale rank on a
  // player it no longer lists.
  for (const pid in state.players) {
    if (state.players[pid].ffbRank !== undefined) delete state.players[pid].ffbRank;
    if (state.players[pid].ffbPrevRank !== undefined) delete state.players[pid].ffbPrevRank;
  }

  for (const pos of state.positions) {
    const ffbList = (state.ffb && state.ffb.positions && state.ffb.positions[pos]) || [];
    const rows = [];
    const seen = new Set();

    for (const entry of ffbList) {
      state.matchStats.total++;
      const pid = matchToSleeper(entry, pos);
      if (!pid) {
        state.matchStats.unmatched.push(pos + " " + entry.name);
        continue;
      }
      state.matchStats.matched++;
      if (seen.has(pid)) continue;
      const player = state.players[pid];
      if (!player || !player.team || player.team === "FA") continue;
      seen.add(pid);
      player.ffbRank = entry.rank;
      // His rank in the snapshot this one replaced, embedded by dev/fetch-ffb.js.
      // Absent on a snapshot written before movement tracking existed, and null for
      // a player that snapshot did not rank - both mean "no baseline", not "flat".
      player.ffbPrevRank = typeof entry.prevRank === "number" ? entry.prevRank : null;
      rows.push({ pid: pid, rank: entry.rank });
    }

    rows.sort((aRow, bRow) => aRow.rank - bRow.rank);
    const pool = rows.map((row) => row.pid);
    const index = {};
    pool.forEach((pid, idx) => {
      index[pid] = idx;
    });
    state.poolByPos[pos] = pool;
    state.poolIndex[pos] = index;
  }
}

/**
 * Attach an ADP result onto the in-memory players.
 *
 * @param {{byId: Object, count: number, season: number}} adp - an ADP result.
 */
function applyAdp(adp) {
  for (const pid in state.players) {
    if (state.players[pid].adp !== undefined) delete state.players[pid].adp;
  }
  for (const pid in adp.byId) {
    if (state.players[pid]) state.players[pid].adp = adp.byId[pid];
  }
  state.usingAdp = adp.count > 0;
  state.adpSeason = adp.season;
}

/**
 * Load everything the board needs. League resolution is best-effort: it only
 * selects the ADP flavor and target season, so failure is not fatal.
 */
async function loadAll(force) {
  setStatus("Loading league...", false, true);

  let league = null;
  try {
    const resolved = await getLatestLeague(force);
    league = resolved.league;
  } catch (err) {
    league = null;
  }

  if (league) {
    state.leagueName = league.name || "";
    state.leagueSeason = Number(league.season) || 0;
    state.numTeams = league.total_rosters || 0;
    state.adpField = adpFieldFor(league);
    state.targetSeason = state.leagueSeason + 1;
    const draftable = derivePositions(league.roster_positions);
    const kept = POSITIONS.filter((pos) => draftable.has(pos));
    state.positions = kept.length ? kept : POSITIONS.slice();
  } else {
    state.targetSeason = new Date().getFullYear();
    state.positions = POSITIONS.slice();
  }

  // The Footballers snapshot is a plain script tag, so it is already loaded (or
  // absent, in which case the board falls back to Sleeper alone).
  state.ffb = typeof window !== "undefined" && window.FFB_RANKINGS ? window.FFB_RANKINGS : null;

  const seasons = [state.targetSeason, state.targetSeason - 1];
  const [players, adp] = await Promise.all([
    loadPlayers(force),
    loadAdpForSeasons(seasons, state.adpField, force),
  ]);

  state.players = players;
  applyAdp(adp);
  state.adpPrev = loadAdpBaseline();
  buildPools();
  if (state.positions.indexOf(state.activePos) === -1) state.activePos = state.positions[0];
}

// ---------------------------------------------------------------------------
// Board model
// ---------------------------------------------------------------------------

/**
 * Read the saved board from localStorage, or start a fresh one.
 *
 * @returns {Object} a sanitized board.
 */
function loadBoard() {
  try {
    const raw = localStorage.getItem(BOARD_KEY);
    if (raw) {
      const clean = sanitizeBoard(JSON.parse(raw));
      if (clean) return clean;
    }
  } catch (err) {
    // Unreadable save - start fresh rather than dying on load.
  }
  return {
    version: BOARD_VERSION,
    season: state.targetSeason,
    countsVersion: COUNTS_VERSION, // a brand new board is already at the current depths
    positions: {},
  };
}

/**
 * The seed depth for a position.
 *
 * @param {string} pos - a position.
 * @returns {number} the default depth.
 */
function defaultCountFor(pos) {
  return typeof DEFAULT_COUNTS[pos] === "number" ? DEFAULT_COUNTS[pos] : DEFAULT_COUNT;
}

/**
 * After a rankings refresh, add players who have newly climbed into a position's
 * top-N to the BOTTOM of that board. Nothing is reordered and nobody is removed,
 * so your tiers and your ordering are untouched - a refresh can only ever hand you
 * new names to place.
 *
 * @returns {Array<{pos: string, names: string[]}>} what was added, per position.
 */
function absorbNewRanked() {
  const added = [];
  for (const pos of state.positions) {
    const entry = boardFor(pos);
    const pool = state.poolByPos[pos] || [];
    const present = new Set(entry.order.filter((item) => item.t === "p").map((item) => item.pid));
    const names = [];
    for (const pid of pool.slice(0, entry.count)) {
      if (present.has(pid)) continue;
      entry.order.push({ t: "p", pid: pid });
      names.push(state.players[pid] ? state.players[pid].name : pid);
    }
    if (names.length) added.push({ pos: pos, names: names });
  }
  return added;
}

/**
 * Count players sitting on your boards who the current Footballers snapshot no
 * longer ranks. They stay put (you ranked them deliberately) but show a dash in
 * the FFB column, so it is worth saying how many.
 *
 * @returns {number} how many boarded players are unranked.
 */
function countUnrankedOnBoard() {
  let total = 0;
  for (const pos of state.positions) {
    const entry = state.board.positions[pos];
    if (!entry) continue;
    for (const item of entry.order) {
      if (item.t !== "p") continue;
      const player = state.players[item.pid];
      if (!player || typeof player.ffbRank !== "number") total++;
    }
  }
  return total;
}

/**
 * Bring a saved board up to the current default depths, once. Uses applyCount so
 * manual ordering and tier breaks survive - only rows are added or trimmed.
 */
function migrateCounts() {
  if (Number(state.board.countsVersion) === COUNTS_VERSION) return;
  for (const pos of state.positions) {
    const target = defaultCountFor(pos);
    if (boardFor(pos).count !== target) applyCount(pos, target);
  }
  state.board.countsVersion = COUNTS_VERSION;
}

/**
 * Validate and normalize a board object (from localStorage or an import file).
 *
 * @param {any} raw - the candidate board.
 * @returns {Object|null} a sanitized board, or null if unusable.
 */
function sanitizeBoard(raw) {
  if (!raw || typeof raw !== "object" || !raw.positions || typeof raw.positions !== "object") {
    return null;
  }
  const board = {
    version: BOARD_VERSION,
    season: Number(raw.season) || state.targetSeason,
    countsVersion: Number(raw.countsVersion) || 0,
    // Which Footballers snapshot this board last absorbed, so a refresh is noticed.
    ffbStamp: typeof raw.ffbStamp === "string" ? raw.ffbStamp : "",
    positions: {},
  };
  for (const pos of POSITIONS) {
    const src = raw.positions[pos];
    if (!src || !Array.isArray(src.order)) continue;
    const order = [];
    const seen = new Set();
    for (const entry of src.order) {
      if (!entry || typeof entry !== "object") continue;
      if (entry.t === "brk") {
        order.push({ t: "brk", label: typeof entry.label === "string" ? entry.label : "" });
      } else if (entry.t === "p" && entry.pid != null) {
        const pid = String(entry.pid);
        if (seen.has(pid)) continue; // a player can only appear once
        seen.add(pid);
        order.push({ t: "p", pid: pid });
      }
    }
    const rawCount = Math.round(Number(src.count));
    const count =
      isFinite(rawCount) && rawCount > 0 && rawCount <= MAX_COUNT ? rawCount : defaultCountFor(pos);
    board.positions[pos] = { count: count, order: order };
  }
  return Object.keys(board.positions).length ? board : null;
}

/**
 * Persist the board and flash the "Saved" indicator.
 */
function saveBoard() {
  try {
    localStorage.setItem(BOARD_KEY, JSON.stringify(state.board));
    flashSaved();
  } catch (err) {
    setStatus("Could not save - browser storage is full or blocked.", true);
  }
}

/**
 * The board entry for a position, seeding it on first use.
 *
 * @param {string} pos - a position.
 * @returns {{count: number, order: Object[]}} that position's board.
 */
function boardFor(pos) {
  if (!state.board.positions[pos]) {
    state.board.positions[pos] = { count: defaultCountFor(pos), order: [] };
  }
  const entry = state.board.positions[pos];
  if (!entry.order.length) entry.order = seedOrder(pos, entry.count);
  return entry;
}

/**
 * A fresh blended-order board for a position: one tier break, then the top N.
 *
 * @param {string} pos - a position.
 * @param {number} count - how many players to seed.
 * @returns {Object[]} the seeded order.
 */
function seedOrder(pos, count) {
  const pool = state.poolByPos[pos] || [];
  const order = [{ t: "brk", label: "" }];
  for (const pid of pool.slice(0, count)) order.push({ t: "p", pid: pid });
  return order;
}

/**
 * Change the seed depth for a position, preserving manual ordering.
 *
 * @param {string} pos - a position.
 * @param {number} count - the new depth.
 */
function applyCount(pos, count) {
  const entry = boardFor(pos);
  const pool = state.poolByPos[pos] || [];
  const wanted = new Set(pool.slice(0, count));

  const kept = entry.order.filter((item) => item.t !== "p" || wanted.has(item.pid));
  const present = new Set(kept.filter((item) => item.t === "p").map((item) => item.pid));
  for (const pid of pool.slice(0, count)) {
    if (!present.has(pid)) kept.push({ t: "p", pid: pid });
  }

  entry.count = count;
  entry.order = kept;
}

/**
 * How many rows a count change would remove from a position.
 *
 * @param {string} pos - a position.
 * @param {number} count - the candidate depth.
 * @returns {number} the number of player rows that would be dropped.
 */
function countRemovals(pos, count) {
  const entry = boardFor(pos);
  const pool = state.poolByPos[pos] || [];
  const wanted = new Set(pool.slice(0, count));
  return entry.order.filter((item) => item.t === "p" && !wanted.has(item.pid)).length;
}

/**
 * Move an entry within the active position's order.
 *
 * @param {number} from - current index.
 * @param {number} to - destination index.
 */
function moveEntry(from, to) {
  const order = boardFor(state.activePos).order;
  if (from < 0 || from >= order.length) return;
  const clamped = Math.max(0, Math.min(order.length - 1, to));
  if (clamped === from) return;
  const [entry] = order.splice(from, 1);
  order.splice(clamped, 0, entry);
  saveBoard();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const boardEl = document.getElementById("board");
const tabsEl = document.getElementById("tabs");
const statusEl = document.getElementById("status");
const subEl = document.getElementById("sub");
const savedEl = document.getElementById("saved");
const countEl = document.getElementById("count");
const adpInfoEl = document.getElementById("adpInfo");
const depthHeadEl = document.getElementById("hdrDepth");

/**
 * Escape a string for safe interpolation into HTML.
 *
 * @param {string} str - raw text.
 * @returns {string} escaped text.
 */
function escapeHtml(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Show or hide the status line.
 *
 * @param {string} msg - message text; empty hides the line.
 * @param {boolean} [isError] - style it as an error.
 * @param {boolean} [busy] - prefix a spinner.
 */
function setStatus(msg, isError, busy) {
  if (!msg) {
    statusEl.className = "status hide";
    statusEl.textContent = "";
    return;
  }
  statusEl.className = "status" + (isError ? " error" : "");
  statusEl.innerHTML = (busy ? '<span class="spin"></span>' : "") + escapeHtml(msg);
}

/**
 * Briefly show the "Saved" indicator.
 */
function flashSaved() {
  savedEl.classList.add("show");
  if (savedTimer) clearTimeout(savedTimer);
  savedTimer = setTimeout(() => savedEl.classList.remove("show"), 1100);
}

/**
 * Render the position tabs with per-position player counts.
 */
function renderTabs() {
  let html = "";
  for (const pos of state.positions) {
    const order = (state.board.positions[pos] && state.board.positions[pos].order) || [];
    const players = order.filter((item) => item.t === "p").length;
    html +=
      '<button class="tab' + (pos === state.activePos ? " active" : "") +
      '" role="tab" data-pos="' + pos + '" type="button">' + pos +
      (players ? '<span class="tab-count">' + players + "</span>" : "") +
      "</button>";
  }
  tabsEl.innerHTML = html;
}

/**
 * Rebuild the "Show" dropdown for a position: only depths it can actually fill,
 * plus an "All" option at the size of its pool.
 *
 * @param {string} pos - the active position.
 */
function renderCountOptions(pos) {
  const poolSize = (state.poolByPos[pos] || []).length;
  const current = boardFor(pos).count;

  const values = new Set();
  for (const choice of COUNT_CHOICES) {
    if (choice < poolSize) values.add(choice);
  }
  if (poolSize) values.add(poolSize);
  values.add(current); // never hide the depth actually in use

  const sorted = Array.from(values).sort((aVal, bVal) => aVal - bVal);
  let html = "";
  for (const val of sorted) {
    const label = poolSize && val === poolSize ? "All (" + val + ")" : String(val);
    html += '<option value="' + val + '">' + label + "</option>";
  }
  countEl.innerHTML = html;
  countEl.value = String(current);
}

/**
 * Whether a tier break can be inserted at an index without creating an empty
 * tier (i.e. two breaks in a row).
 *
 * @param {Object[]} order - the position's order.
 * @param {number} idx - the candidate insert index.
 * @returns {boolean} true if a break there is meaningful.
 */
function canInsertBreak(order, idx) {
  const prev = idx > 0 ? order[idx - 1] : null;
  const next = idx < order.length ? order[idx] : null;
  if (prev && prev.t === "brk") return false;
  if (next && next.t === "brk") return false;
  if (!prev && !next) return false;
  return true;
}

/**
 * Render the active position's board.
 *
 * @param {number} [focusIdx] - entry index to focus after rendering.
 */
function renderBoard(focusIdx) {
  const pos = state.activePos;
  const entry = boardFor(pos);
  const order = entry.order;
  const poolIndex = state.poolIndex[pos] || {};

  if (!order.length) {
    boardEl.innerHTML =
      '<div class="empty">No players for ' + escapeHtml(pos) +
      ". Try Refresh ADP, or pick a different position.</div>";
    return;
  }

  // Pre-count players per tier so each band can show its size.
  const tierSizes = [];
  let current = -1;
  for (const item of order) {
    if (item.t === "brk") {
      tierSizes.push(0);
      current = tierSizes.length - 1;
    } else if (current >= 0) {
      tierSizes[current]++;
    }
  }

  // The depth-chart column only applies to the positions where a team slot means
  // something, so the header label is toggled to match.
  const showDepth = DEPTH_POSITIONS.has(pos);
  if (depthHeadEl) depthHeadEl.hidden = !showDepth;

  let html = "";
  let tierNo = 0;
  let playerNo = 0;

  order.forEach((item, idx) => {
    if (canInsertBreak(order, idx)) {
      html +=
        '<div class="gap"><button type="button" data-at="' + idx +
        '" title="Insert a tier break here">+ tier break</button></div>';
    }

    if (item.t === "brk") {
      tierNo++;
      const size = tierSizes[tierNo - 1] || 0;
      const auto = "Tier " + tierNo;
      html +=
        '<div class="brk t' + (tierNo % 6) + '" data-idx="' + idx + '" tabindex="0">' +
        '<span class="handle" title="Drag to move this tier break">&#10303;</span>' +
        '<input type="text" value="' + escapeHtml(item.label) +
        '" placeholder="' + escapeHtml(auto) + '" aria-label="Tier name" />' +
        '<span class="count">' + size + (size === 1 ? " player" : " players") + "</span>" +
        '<button class="del" type="button" data-del="' + idx +
        '" title="Delete this tier break">&times;</button>' +
        "</div>";
      return;
    }

    playerNo++;
    const player = state.players[item.pid];
    const name = player ? player.name : "Unknown player (" + item.pid + ")";
    const team = player ? player.team : "";
    const rookie = player && player.rookie;

    const ffbRank = player && typeof player.ffbRank === "number" ? player.ffbRank : null;
    const ffbPrevRank = player && typeof player.ffbPrevRank === "number" ? player.ffbPrevRank : null;
    const adp = player && typeof player.adp === "number" ? player.adp : null;
    const prevAdp = baselineAdpFor(item.pid);
    const rd = adp === null ? null : roundOf(adp);

    const seedIdx = poolIndex[item.pid];
    let driftHtml = '<span class="drift flat">&middot;</span>';
    if (typeof seedIdx === "number") {
      const drift = seedIdx - (playerNo - 1);
      // The arrow is spaced off the number: "↑46" otherwise reads as "146".
      if (drift > 0) {
        driftHtml =
          '<span class="drift up" title="You have him ' + drift +
          ' spots higher than the blend">&uarr; ' + drift + "</span>";
      } else if (drift < 0) {
        driftHtml =
          '<span class="drift down" title="You have him ' + -drift +
          ' spots lower than the blend">&darr; ' + -drift + "</span>";
      }
    }

    html +=
      '<div class="row" data-idx="' + idx + '" data-pid="' + escapeHtml(item.pid) + '" tabindex="0">' +
      '<span class="handle" title="Drag to reorder">&#10303;</span>' +
      '<span class="idx">' + playerNo + "</span>" +
      '<span class="name">' + escapeHtml(name) + "</span>" +
      (rookie ? '<span class="badge" title="Rookie">R</span>' : "") +
      '<span class="team">' + escapeHtml(team) + "</span>" +
      (showDepth ? depthCellHtml(player) : "") +
      '<span class="ffb" title="The Fantasy Footballers ' + pos + ' rank, full PPR - this sets the order">' +
      (ffbRank === null ? "&ndash;" : ffbRank) + "</span>" +
      deltaCellHtml(ffbRank, ffbPrevRank, "dffb", pos + " rank", 0) +
      '<span class="adp" title="Sleeper ADP, overall pick number (informational)">' +
      (adp === null ? "&ndash;" : adp.toFixed(1)) + "</span>" +
      deltaCellHtml(adp, prevAdp, "dadp", "ADP", 1) +
      '<span class="rd"' +
      (rd === null
        ? ' title="No Sleeper ADP">&ndash;'
        : ' title="ADP ' + adp.toFixed(1) + ' lands in round ' + rd.round + ", pick " + rd.pick +
          " of " + (state.numTeams || 12) + '">' + rd.round) +
      "</span>" +
      driftHtml +
      "</div>";
  });

  if (canInsertBreak(order, order.length)) {
    html +=
      '<div class="gap"><button type="button" data-at="' + order.length +
      '" title="Insert a tier break here">+ tier break</button></div>';
  }

  boardEl.innerHTML = html;

  if (typeof focusIdx === "number") {
    const target = boardEl.querySelector('[data-idx="' + focusIdx + '"]');
    if (target) target.focus();
  }
}

/**
 * Re-render tabs and board together.
 *
 * @param {number} [focusIdx] - entry index to focus after rendering.
 */
function render(focusIdx) {
  renderTabs();
  renderBoard(focusIdx);
}

/**
 * Update the header subtitle and the source note in the footer.
 */
function renderMeta() {
  const parts = [];
  if (state.leagueName) parts.push(state.leagueName);
  if (state.targetSeason) parts.push(state.targetSeason + " draft");
  subEl.textContent = parts.length ? parts.join(" · ") : "Standalone tier board";

  const bits = [];
  let stale = false;
  if (state.ffb) {
    const when = state.ffb.fetchedAt ? new Date(state.ffb.fetchedAt) : null;
    const valid = when && !isNaN(when.getTime());
    const stamp = valid ? when.toLocaleDateString() : "unknown date";
    const days = valid ? Math.floor((Date.now() - when.getTime()) / 86400000) : 0;
    stale = days >= FFB_STALE_DAYS;
    bits.push(
      "Order: Footballers PPR (" + stamp +
      (days >= 1 ? ", " + days + "d old" : "") + ")" +
      (stale ? " - refresh me" : "")
    );
  } else {
    stale = true;
    bits.push("Footballers ranks MISSING - run refresh-rankings.cmd");
  }
  if (state.usingAdp) {
    bits.push(
      "Sleeper " + state.adpField.replace("adp_", "").toUpperCase() +
      " ADP for reference" + (state.adpUpdatedAt ? " (" + timeAgo(state.adpUpdatedAt) + ")" : "")
    );
  } else {
    bits.push("Sleeper ADP unavailable");
  }
  if (state.numTeams) bits.push(state.numTeams + "-team rounds");

  // Name what the movement columns are measured against. The two baselines are
  // usually the same moment, because the Refresh button advances both together, but
  // running refresh-rankings.cmd on its own moves only the rankings one.
  const ffbBase = state.ffb && state.ffb.previousFetchedAt ? new Date(state.ffb.previousFetchedAt) : null;
  const ffbBaseOk = ffbBase && !isNaN(ffbBase.getTime());
  const adpBase = state.adpPrev && state.adpPrev.at ? new Date(state.adpPrev.at) : null;
  const adpBaseOk = adpBase && !isNaN(adpBase.getTime());
  if (ffbBaseOk && adpBaseOk && ffbBase.toLocaleDateString() === adpBase.toLocaleDateString()) {
    bits.push("movement vs " + ffbBase.toLocaleDateString());
  } else if (ffbBaseOk || adpBaseOk) {
    bits.push(
      "movement vs " +
      (ffbBaseOk ? "ranks " + ffbBase.toLocaleDateString() : "ranks n/a") + ", " +
      (adpBaseOk ? "ADP " + adpBase.toLocaleDateString() : "ADP n/a")
    );
  }
  if (state.matchStats.total) {
    const missed = state.matchStats.total - state.matchStats.matched;
    if (missed > 0) bits.push(missed + " unmatched");
  }
  adpInfoEl.textContent = bits.join(" · ");
  adpInfoEl.className = stale ? "stale" : "";
}

/**
 * Human-readable "time since" label.
 *
 * @param {number} ms - epoch milliseconds.
 * @returns {string} e.g. "3h ago".
 */
function timeAgo(ms) {
  const mins = Math.floor((Date.now() - ms) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return mins + "m ago";
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours + "h ago";
  return Math.floor(hours / 24) + "d ago";
}

// ---------------------------------------------------------------------------
// Dragging (Pointer Events - one code path for mouse and touch)
// ---------------------------------------------------------------------------

/**
 * Begin a drag from a row or tier-break handle.
 *
 * @param {PointerEvent} evt - the pointerdown event.
 */
function onPointerDown(evt) {
  if (drag) return;
  if (typeof evt.button === "number" && evt.button !== 0) return;
  const target = evt.target instanceof Element ? evt.target : null;
  const handle = target && target.closest(".handle");
  if (!handle) return;
  const el = handle.closest("[data-idx]");
  if (!el) return;

  evt.preventDefault();
  const rect = el.getBoundingClientRect();
  const ghost = el.cloneNode(true);
  ghost.classList.add("ghost");
  ghost.style.width = rect.width + "px";
  ghost.style.left = rect.left + "px";
  ghost.style.top = rect.top + "px";
  document.body.appendChild(ghost);
  el.classList.add("dragging");

  const line = document.createElement("div");
  line.className = "dropline";
  boardEl.appendChild(line);

  drag = {
    idx: Number(el.dataset.idx),
    insertAt: Number(el.dataset.idx),
    el: el,
    ghost: ghost,
    line: line,
    handle: handle,
    grabY: evt.clientY - rect.top,
    pointerId: evt.pointerId,
  };

  try {
    handle.setPointerCapture(evt.pointerId);
  } catch (err) {
    // Capture is a nicety; the handle listeners below still work.
  }
  handle.addEventListener("pointermove", onPointerMove);
  handle.addEventListener("pointerup", onPointerUp);
  handle.addEventListener("pointercancel", onPointerUp);
  onPointerMove(evt);
}

/**
 * Track the pointer: move the ghost and compute where the drop would land.
 *
 * @param {PointerEvent} evt - the pointermove event.
 */
function onPointerMove(evt) {
  if (!drag) return;
  drag.ghost.style.top = evt.clientY - drag.grabY + "px";

  // The insert index is the number of entries whose midpoint is above the
  // pointer. The dragged row is included, which is what makes a no-op drag
  // resolve back to its own slot.
  const entries = Array.from(boardEl.querySelectorAll("[data-idx]"));
  let insertAt = 0;
  let lineTop = 0;
  const boardRect = boardEl.getBoundingClientRect();

  for (const el of entries) {
    const rect = el.getBoundingClientRect();
    if (evt.clientY > rect.top + rect.height / 2) {
      insertAt = Number(el.dataset.idx) + 1;
      lineTop = rect.bottom - boardRect.top + 1;
    }
  }
  if (insertAt === 0 && entries.length) {
    lineTop = entries[0].getBoundingClientRect().top - boardRect.top - 2;
  }

  drag.insertAt = insertAt;
  drag.line.style.top = lineTop + "px";
}

/**
 * Finish a drag: splice the entry into its new slot.
 *
 * @param {PointerEvent} evt - the pointerup/pointercancel event.
 */
function onPointerUp(evt) {
  if (!drag) return;
  const from = drag.idx;
  let to = drag.insertAt;

  drag.handle.removeEventListener("pointermove", onPointerMove);
  drag.handle.removeEventListener("pointerup", onPointerUp);
  drag.handle.removeEventListener("pointercancel", onPointerUp);
  try {
    drag.handle.releasePointerCapture(drag.pointerId);
  } catch (err) {
    // Already released.
  }
  drag.ghost.remove();
  drag.line.remove();
  drag.el.classList.remove("dragging");
  drag = null;

  // Removing the entry first shifts every later index down by one.
  if (to > from) to -= 1;
  if (to !== from) moveEntry(from, to);
  render();
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/**
 * Wire up the board's delegated click / input / keyboard handlers.
 */
function setupBoardHandlers() {
  boardEl.addEventListener("pointerdown", onPointerDown);

  boardEl.addEventListener("click", (evt) => {
    const target = evt.target instanceof Element ? evt.target : null;
    if (!target) return;

    const insert = target.closest("[data-at]");
    if (insert) {
      boardFor(state.activePos).order.splice(Number(insert.dataset.at), 0, { t: "brk", label: "" });
      saveBoard();
      render();
      return;
    }

    const del = target.closest("[data-del]");
    if (del) {
      boardFor(state.activePos).order.splice(Number(del.dataset.del), 1);
      saveBoard();
      render();
    }
  });

  // Tier label edits update the model in place - no re-render, so the caret and
  // focus survive typing.
  boardEl.addEventListener("input", (evt) => {
    const target = evt.target instanceof Element ? evt.target : null;
    if (!target || target.tagName !== "INPUT") return;
    const el = target.closest("[data-idx]");
    if (!el) return;
    const item = boardFor(state.activePos).order[Number(el.dataset.idx)];
    if (item && item.t === "brk") {
      item.label = target.value;
      saveBoard();
    }
  });

  // Alt+Arrow nudges the focused entry, as a keyboard alternative to dragging.
  boardEl.addEventListener("keydown", (evt) => {
    if (!evt.altKey) return;
    if (evt.key !== "ArrowUp" && evt.key !== "ArrowDown") return;
    const target = evt.target instanceof Element ? evt.target : null;
    const el = target && target.closest("[data-idx]");
    if (!el) return;
    evt.preventDefault();
    const from = Number(el.dataset.idx);
    const to = evt.key === "ArrowUp" ? from - 1 : from + 1;
    const order = boardFor(state.activePos).order;
    if (to < 0 || to >= order.length) return;
    moveEntry(from, to);
    render(to);
  });
}

/**
 * Wire up the tabs and the control bar.
 */
function setupControls() {
  tabsEl.addEventListener("click", (evt) => {
    const target = evt.target instanceof Element ? evt.target : null;
    const tab = target && target.closest("[data-pos]");
    if (!tab) return;
    state.activePos = tab.dataset.pos;
    renderCountOptions(state.activePos);
    render();
  });

  countEl.addEventListener("change", () => {
    const count = Number(countEl.value);
    const pos = state.activePos;
    const removals = countRemovals(pos, count);
    if (removals > 0) {
      const ok = window.confirm(
        "Showing " + count + " at " + pos + " drops " + removals +
        (removals === 1 ? " player" : " players") + " from your board. Continue?"
      );
      if (!ok) {
        countEl.value = String(boardFor(pos).count);
        return;
      }
    }
    applyCount(pos, count);
    saveBoard();
    renderCountOptions(pos);
    render();
  });

  document.getElementById("addBreak").addEventListener("click", () => {
    const order = boardFor(state.activePos).order;
    if (!canInsertBreak(order, order.length)) return;
    order.push({ t: "brk", label: "" });
    saveBoard();
    render();
  });

  document.getElementById("print").addEventListener("click", printSheet);
  document.getElementById("refresh").addEventListener("click", refreshAll);
  document.getElementById("reset").addEventListener("click", resetAll);
}

/**
 * Build the print-only sheet: every position's tiers at once, in newspaper
 * columns, so the whole board fits one side of one sheet of paper.
 *
 * @returns {{lines: number, players: number, tiers: number}} what was laid out.
 */
function buildPrintSheet() {
  // Group positions into the fixed columns, and make sure a position that is not
  // named in PRINT_COLUMNS still gets printed.
  const groups = PRINT_COLUMNS
    .map((group) => group.filter((pos) => state.positions.indexOf(pos) !== -1))
    .filter((group) => group.length);
  const covered = new Set();
  for (const group of groups) group.forEach((pos) => covered.add(pos));
  const extras = state.positions.filter((pos) => !covered.has(pos));
  if (extras.length) {
    if (groups.length) groups[groups.length - 1] = groups[groups.length - 1].concat(extras);
    else groups.push(extras);
  }

  let players = 0;
  let tiers = 0;
  const colLines = [];
  const colHtml = [];

  for (const group of groups) {
    let lines = 0;
    let html = "";

    for (const pos of group) {
      const entry = boardFor(pos);
      const rows = entry.order.filter((item) => item.t === "p").length;
      html +=
        '<div class="print-pos">' + escapeHtml(pos) +
        '<span class="print-pos-n">' + rows + "</span></div>";
      lines += PRINT_POS_LINES;

      let tierNo = 0;
      for (const item of entry.order) {
        if (item.t === "brk") {
          tierNo++;
          tiers++;
          lines += PRINT_TIER_LINES;
          const label = item.label ? item.label : "Tier " + tierNo;
          html += '<div class="print-tier">' + escapeHtml(label) + "</div>";
          continue;
        }

        players++;
        lines += 1;
        const player = state.players[item.pid];
        const name = player ? player.name : item.pid;
        const team = player ? player.team : "";
        const rookie = player && player.rookie;
        // For RB and WR the depth-chart slot is more use than repeating the
        // position letter; QB and TE just get the position.
        const slot =
          player && DEPTH_POSITIONS.has(pos) && typeof player.dcOrder === "number"
            ? pos + player.dcOrder
            : pos;
        const adp = player && typeof player.adp === "number" ? player.adp : null;
        html +=
          '<div class="print-row">' +
          '<span class="pr-name">' + escapeHtml(name) +
          (rookie ? '<span class="pr-r">R</span>' : "") + "</span>" +
          '<span class="pr-slot">' + escapeHtml(slot) + "</span>" +
          '<span class="pr-team">' + escapeHtml(team) + "</span>" +
          '<span class="pr-adp">' + (adp === null ? "&ndash;" : adp.toFixed(1)) + "</span>" +
          '<span class="pr-rd">' + (adp === null ? "&ndash;" : roundOf(adp).round) + "</span>" +
          "</div>";
      }
    }

    colLines.push(lines);
    colHtml.push('<div class="print-col">' + html + "</div>");
  }

  // A position never splits across columns, so the tallest column sets the type
  // size. Fit it to the page rather than guessing.
  const tallest = colLines.length ? Math.max.apply(null, colLines) : 0;
  const ideal = tallest ? PRINT_PAGE_PT / tallest / PRINT_LINE_HEIGHT : PRINT_MAX_PT;
  const fontPt = Math.max(PRINT_MIN_PT, Math.min(PRINT_MAX_PT, Math.floor(ideal * 10) / 10));

  const sheet = document.getElementById("printSheet");
  sheet.innerHTML = '<div class="print-cols">' + colHtml.join("") + "</div>";
  sheet.style.fontSize = fontPt + "pt";

  return {
    players: players,
    tiers: tiers,
    tallest: Math.ceil(tallest),
    fontPt: fontPt,
    fits: ideal >= PRINT_MIN_PT,
    columns: groups.length,
  };
}

/**
 * Build the sheet and hand it to the browser's print dialog.
 */
function printSheet() {
  const built = buildPrintSheet();
  if (!built.fits) {
    setStatus(
      "Heads up: the longest column is " + built.tallest + " lines, which will not fit one page " +
      "even at " + PRINT_MIN_PT + "pt. Reduce a position's Show depth - WR is usually the culprit.",
      true
    );
  } else {
    setStatus(
      "Printing " + built.players + " players on one sheet at " + built.fontPt + "pt."
    );
    setTimeout(() => setStatus(""), 4000);
  }
  window.print();
}

/**
 * Whether this page can re-fetch its own snapshot file at runtime. Served over
 * http(s) it can; opened as a file:// document it cannot, because a file:// page is
 * not allowed to fetch local files - which is the same reason the snapshot is a
 * script tag rather than a .json in the first place.
 *
 * @returns {boolean} true if a runtime snapshot re-fetch is possible.
 */
function canFetchSnapshot() {
  return location.protocol === "http:" || location.protocol === "https:";
}

/**
 * Re-load the snapshot file, bypassing the browser cache, and hand back whatever it
 * now contains. Done with a script tag rather than fetch + parse: the file is a
 * script assigning window.FFB_RANKINGS, so letting the browser execute it avoids
 * hand-parsing JSON out of source text.
 *
 * @returns {Promise<Object>} the snapshot the file currently holds.
 */
function fetchSnapshot() {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    // Cache-buster: GitHub Pages will happily serve a cached copy of a file the
    // Action just replaced, which would make a real update look like "no change".
    script.src = SNAPSHOT_FILE + "?t=" + Date.now();
    script.onload = () => {
      script.remove();
      if (window.FFB_RANKINGS) resolve(window.FFB_RANKINGS);
      else reject(new Error("the snapshot file loaded but contained no rankings"));
    };
    script.onerror = () => {
      script.remove();
      reject(new Error("could not load " + SNAPSHOT_FILE));
    };
    document.head.appendChild(script);
  });
}

/**
 * How many players the current snapshot has moved by at least DELTA_MIN - i.e. the
 * number of arrows the board is about to draw, which is the honest headline for a
 * refresh.
 *
 * @returns {number} the count of real movers.
 */
function countFfbMovers() {
  let movers = 0;
  for (const pid in state.players) {
    const player = state.players[pid];
    if (typeof player.ffbRank !== "number" || typeof player.ffbPrevRank !== "number") continue;
    if (Math.abs(player.ffbPrevRank - player.ffbRank) >= DELTA_MIN) movers++;
  }
  return movers;
}

/**
 * Swap in a freshly scraped Footballers snapshot without a reload.
 *
 * Your ordering and your tiers are never touched. Players who newly climbed into a
 * position's top-N are appended at the bottom for you to place, exactly as they are
 * on a cold load.
 *
 * @param {Object} snapshot - the new snapshot payload from the server.
 * @returns {{added: Array, movers: number}} what changed.
 */
function applyFfbSnapshot(snapshot) {
  window.FFB_RANKINGS = snapshot;
  state.ffb = snapshot;
  buildPools();
  const added = absorbNewRanked();
  state.board.ffbStamp = snapshot.fetchedAt ? String(snapshot.fetchedAt) : "";
  return { added: added, movers: countFfbMovers() };
}

/**
 * Re-fetch Sleeper ADP, recording what the board currently holds as the baseline
 * for the dADP column first.
 *
 * @returns {Promise<{count: number, baselined: boolean}>} the outcome.
 */
async function refreshAdpData() {
  const baselined = captureAdpBaseline();
  const seasons = [state.targetSeason, state.targetSeason - 1];
  const adp = await loadAdpForSeasons(seasons, state.adpField, true);
  applyAdp(adp);
  return { count: adp.count, baselined: baselined };
}

/**
 * "Get latest rankings": go and look for a newer published snapshot, and re-pull
 * Sleeper ADP. This is the ONLY thing in the tool that pulls new data - opening the
 * page never does, so a movement arrow cannot appear and be missed before you have
 * had a chance to read it.
 *
 * Nothing you arranged is disturbed. A rankings update can only change the reference
 * numbers, redraw the movement columns, and add newly-ranked names at the bottom of
 * a position.
 */
async function refreshAll() {
  const button = document.getElementById("refresh");
  if (button.disabled) return;
  button.disabled = true;
  const label = button.textContent;
  button.textContent = "Checking...";

  try {
    const before = state.ffb && state.ffb.fetchedAt ? String(state.ffb.fetchedAt) : "";
    let ffb = null;
    let snapshotNote = "";

    if (canFetchSnapshot()) {
      setStatus("Checking for a newer rankings snapshot...", false, true);
      try {
        const snapshot = await fetchSnapshot();
        const after = snapshot && snapshot.fetchedAt ? String(snapshot.fetchedAt) : "";
        if (after && after !== before) {
          ffb = applyFfbSnapshot(snapshot);
          snapshotNote = "New rankings from " + new Date(after).toLocaleDateString();
        } else {
          snapshotNote = "Rankings are already the latest published set";
        }
      } catch (err) {
        snapshotNote = "Could not check the rankings file (" + err.message + ")";
      }
    } else {
      // A file:// page cannot fetch its own local files, so there is nothing to check
      // against. Say so rather than reporting a silent "no change".
      snapshotNote =
        "Opened as a local file, so the rankings file cannot be re-read - run " +
        "refresh-rankings.cmd and reload to update it";
    }

    // Top the player list up if it has gone stale. Not done on open (it is 15 MB), but
    // this is the explicit "go and get things" action, so it is the right place: a stale
    // list means missing rookies and wrong depth-chart slots after camp.
    let playersNote = "";
    const playersAge = Date.now() - Number(localStorage.getItem(PLAYERS_TS_KEY) || 0);
    if (playersAge > PLAYERS_STALE_MS) {
      setStatus("Re-downloading the Sleeper player list (about 15 MB)...", false, true);
      try {
        state.players = await loadPlayers(true);
        buildPools();
        playersNote = "player list re-downloaded";
      } catch (err) {
        playersNote = "could not re-download the player list";
      }
    }

    setStatus("Re-pulling Sleeper ADP...", false, true);
    const adp = await refreshAdpData();

    saveBoard();
    renderCountOptions(state.activePos); // pool sizes may have changed, moving "All (N)"
    renderMeta();
    render();

    const bits = [snapshotNote];
    if (ffb) {
      bits.push(
        ffb.movers
          ? ffb.movers + (ffb.movers === 1 ? " player has" : " players have") +
            " moved " + DELTA_MIN + "+ places"
          : "no player moved " + DELTA_MIN + "+ places"
      );
      if (ffb.added.length) {
        bits.push(
          "added at the bottom: " +
          ffb.added.map((entry) => entry.names.length + " to " + entry.pos).join(", ")
        );
      }
    }
    if (playersNote) bits.push(playersNote);
    if (!adp.count) bits.push("Sleeper returned no ADP");
    else if (!adp.baselined) {
      // Worth saying plainly, or a flat dADP column reads as broken.
      bits.push("ADP movement still measured from the earlier baseline (the last one is under an hour old)");
    }
    setStatus(bits.join(". ") + ".");
  } catch (err) {
    setStatus(
      "Update failed: " + err.message + ". Your board and your current rankings are unchanged.",
      true
    );
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

/**
 * Wipe every trace of this tool and rebuild from scratch: all tiers, all orderings,
 * and every cached number, then re-resolve the league, re-download the player list,
 * re-pull ADP, and take the newest published rankings.
 *
 * This is the start-of-season button. Because the league is re-resolved from the seed
 * id, it also rolls the board onto the new season without any code edit.
 *
 * Everything under the `tb_` prefix is cleared rather than a hand-listed set of keys,
 * so a key added later cannot survive a reset and quietly poison the fresh state.
 */
async function resetAll() {
  const ok = window.confirm(
    "Reset everything?\n\n" +
    "This erases every tier and every ordering you have made, at all four positions, " +
    "and clears all cached data. It then pulls the latest rankings, league and ADP " +
    "from scratch.\n\n" +
    "There is no undo, and your tiers are not recoverable. Use this at the start of a " +
    "new season."
  );
  if (!ok) return;

  const button = document.getElementById("reset");
  button.disabled = true;
  const label = button.textContent;
  button.textContent = "Resetting...";

  try {
    setStatus("Clearing everything...", false, true);
    const doomed = [];
    for (let idx = 0; idx < localStorage.length; idx++) {
      const key = localStorage.key(idx);
      if (key && key.indexOf("tb_") === 0) doomed.push(key);
    }
    for (const key of doomed) localStorage.removeItem(key);

    state.adpPrev = null;
    state.board = null;

    // Take the newest published snapshot too, so a reset genuinely lands on current
    // rankings rather than whatever this tab happened to load with.
    if (canFetchSnapshot()) {
      setStatus("Fetching the latest rankings...", false, true);
      try {
        const snapshot = await fetchSnapshot();
        state.ffb = snapshot;
      } catch (err) {
        // Keep the snapshot already loaded; loadAll picks it up from window.
      }
    }

    setStatus("Rebuilding from scratch - this re-downloads the player list...", false, true);
    await loadAll(true);

    state.board = loadBoard();
    if (!state.board.season) state.board.season = state.targetSeason;
    for (const pos of state.positions) boardFor(pos);
    state.board.ffbStamp = state.ffb && state.ffb.fetchedAt ? String(state.ffb.fetchedAt) : "";
    saveBoard();

    renderCountOptions(state.activePos);
    renderMeta();
    render();

    const seeded = state.positions
      .map((pos) => pos + " " + boardFor(pos).order.filter((item) => item.t === "p").length)
      .join(", ");
    setStatus(
      "Reset complete. Reseeded from the Footballers' order for the " + state.targetSeason +
      " draft: " + seeded + ". Movement columns start blank again, since there is now " +
      "nothing to compare against."
    );
  } catch (err) {
    setStatus(
      "Reset failed partway: " + err.message + ". Reload the page to finish rebuilding.",
      true
    );
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

/**
 * Load data, seed the board, and render.
 */
async function init() {
  setupBoardHandlers();
  setupControls();

  try {
    await loadAll();
  } catch (err) {
    setStatus("Could not load player data from Sleeper: " + err.message, true);
    return;
  }

  state.board = loadBoard();
  if (!state.board.season) state.board.season = state.targetSeason;

  // Seed any position that has no saved board yet, then bring saved boards up to
  // the current default depths (order and tiers survive - rows are just added or
  // trimmed at the bottom).
  for (const pos of state.positions) boardFor(pos);
  migrateCounts();

  // A refreshed snapshot can promote players into the top-N. Add them at the
  // bottom rather than re-seeding, so nothing you arranged moves.
  const stamp = state.ffb && state.ffb.fetchedAt ? String(state.ffb.fetchedAt) : "";
  const isNewSnapshot = !!stamp && !!state.board.ffbStamp && state.board.ffbStamp !== stamp;
  const added = absorbNewRanked();
  state.board.ffbStamp = stamp;
  saveBoard();

  renderCountOptions(state.activePos);
  renderMeta();
  render();

  if (added.length) {
    const summary = added
      .map((entry) => entry.names.length + " to " + entry.pos)
      .join(", ");
    const unranked = countUnrankedOnBoard();
    setStatus(
      (isNewSnapshot ? "Rankings refreshed. " : "") +
      "Added at the bottom: " + summary + ". Your order and tiers are unchanged." +
      (unranked ? " " + unranked + " boarded player(s) are no longer ranked (shown as -)." : "")
    );
  } else {
    setStatus("");
  }
}

init();
