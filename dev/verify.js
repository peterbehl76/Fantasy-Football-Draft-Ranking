/**
 * Throwaway verification harness for tiers.js.
 *
 * Loads the real tiers.js (plus the ffb-rankings.js snapshot) in a vm context
 * behind a minimal DOM/localStorage stub, so the live Sleeper calls, the
 * two-source blend, and the board logic can all be checked without a browser.
 * Not part of the shipped tool.
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(ROOT, "tiers.js"), "utf8");
const FFB_SRC = fs.readFileSync(path.join(ROOT, "ffb-rankings.js"), "utf8");

/** In-memory localStorage stub. key()/length are needed by the Reset path, which
 * clears every `tb_` key by scanning rather than by a hand-listed set. */
const store = new Map();
const localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, val) => store.set(key, String(val)),
  removeItem: (key) => store.delete(key),
  key: (idx) => Array.from(store.keys())[idx] || null,
  get length() {
    return store.size;
  },
};

/** Minimal element stub - enough for module-level wiring and render calls. */
function makeEl(id) {
  const el = {
    id,
    _html: "",
    textContent: "",
    value: "",
    files: null,
    hidden: false,
    dataset: {},
    style: {},
    className: "",
    classList: { add() {}, remove() {}, contains: () => false },
    addEventListener() {},
    removeEventListener() {},
    appendChild() {},
    remove() {},
    click() {},
    focus() {},
    closest: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    getBoundingClientRect: () => ({ top: 0, bottom: 0, left: 0, width: 0, height: 0 }),
    cloneNode: () => makeEl(id + "-clone"),
    setPointerCapture() {},
    releasePointerCapture() {},
  };
  Object.defineProperty(el, "innerHTML", {
    get: () => el._html,
    set: (val) => {
      el._html = String(val);
    },
  });
  return el;
}

const elements = new Map();
const document = {
  getElementById: (id) => {
    if (!elements.has(id)) elements.set(id, makeEl(id));
    return elements.get(id);
  },
  createElement: (tag) => makeEl(tag),
  body: { appendChild() {}, remove() {} },
};

const windowStub = { confirm: () => true };

const sandbox = {
  console,
  fetch,
  setTimeout,
  clearTimeout,
  AbortController,
  Date,
  Math,
  JSON,
  Set,
  Map,
  Array,
  Object,
  String,
  Number,
  Boolean,
  Error,
  Promise,
  URL,
  isFinite,
  isNaN,
  Blob: class Blob {},
  FileReader: class FileReader {},
  localStorage,
  document,
  window: windowStub,
  // Sync reads the URL at startup to work out which repo to talk to, and a file://
  // page is exactly the case that falls back to the published repo - so model that.
  location: { protocol: "file:", hostname: "", pathname: "/index.html", origin: "file://" },
  TextEncoder,
  TextDecoder,
  btoa: (str) => Buffer.from(str, "binary").toString("base64"),
  atob: (str) => Buffer.from(str, "base64").toString("binary"),
};
sandbox.globalThis = sandbox;

const context = vm.createContext(sandbox);

// The snapshot first - index.html loads it with a script tag before tiers.js.
new vm.Script(FFB_SRC).runInContext(context);

const script = new vm.Script(
  SRC +
    "\n;globalThis.__tb = { state, boardFor, applyCount, countRemovals, moveEntry," +
    " seedOrder, sanitizeBoard, canInsertBreak, normalizeName, matchToSleeper," +
    " buildPools, roundOf, defaultCountFor, migrateCounts, absorbNewRanked," +
    " countUnrankedOnBoard, POSITIONS, DEFAULT_COUNTS, DEFAULT_COUNT," +
    " COUNTS_VERSION, MAX_COUNT, deltaCellHtml, DELTA_MIN, baselineAdpFor," +
    " captureAdpBaseline, loadAdpBaseline, countFfbMovers, ADP_PREV_KEY," +
    " ADP_BASELINE_MIN_MS, detectRepo, toBase64, fromBase64, adoptRemoteBoard," +
    " SYNC_BRANCH, SYNC_FILE, SYNC_FALLBACK_OWNER, SYNC_FALLBACK_REPO," +
    " startSync, pushRemoteBoard, fetchRemoteBoard, ensureSyncBranch };"
);
script.runInContext(context);

const tb = sandbox.__tb;

/** Poll until init() finishes (it is fire-and-forget inside tiers.js). */
async function waitForBoard(timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (tb.state.board) return true;
    await new Promise((res) => setTimeout(res, 250));
  }
  return false;
}

let failures = 0;

/**
 * Assert a condition, printing a pass/fail line.
 *
 * @param {string} label - what is being checked.
 * @param {boolean} ok - the result.
 * @param {string} [detail] - extra context to print.
 */
function check(label, ok, detail) {
  if (!ok) failures++;
  console.log((ok ? "  PASS  " : "  FAIL  ") + label + (detail ? " -- " + detail : ""));
}

(async () => {
  console.log("Loading live Sleeper data (player file is ~15 MB on a cold cache)...\n");
  const ready = await waitForBoard(240000);
  if (!ready) {
    console.log("TIMED OUT waiting for init(). Status: " + elements.get("status")._html);
    process.exit(1);
  }

  const state = tb.state;

  console.log("=== League / sources ===");
  console.log("  league        : " + state.leagueName + " (latest completed draft: " + state.leagueSeason + ")");
  console.log("  target season : " + state.targetSeason);
  console.log("  Sleeper ADP   : " + state.adpField + " " + state.adpSeason + " (usingAdp=" + state.usingAdp + ")");
  console.log("  FFB snapshot  : " + (state.ffb ? state.ffb.scoring + ", fetched " + state.ffb.fetchedAt : "MISSING"));
  console.log("  teams         : " + state.numTeams);
  console.log("  name matching : " + state.matchStats.matched + "/" + state.matchStats.total + " FFB rows matched to Sleeper ids");
  console.log("");

  check("league resolved", !!state.leagueName, state.leagueName);
  check("Sleeper ADP loaded", state.usingAdp);
  check("FFB snapshot loaded", !!state.ffb);
  check("FFB snapshot is full PPR where it matters", /PPR/i.test(state.ffb.scoring), state.ffb.scoring);
  check(
    "RB/WR/TE were scraped at PPR",
    ["RB", "WR", "TE"].every((pos) => state.ffb.scoringByPosition[pos] === "PPR"),
    JSON.stringify(state.ffb.scoringByPosition)
  );
  const matchRate = state.matchStats.matched / state.matchStats.total;
  check("FFB rows match Sleeper at >95%", matchRate > 0.95, (matchRate * 100).toFixed(1) + "%");
  if (state.matchStats.unmatched.length) {
    console.log("  unmatched: " + state.matchStats.unmatched.slice(0, 12).join(", "));
  }

  console.log("\n=== Round math (" + state.numTeams + " teams) ===");
  const r1 = tb.roundOf(1);
  const r14 = tb.roundOf(14);
  const r15 = tb.roundOf(15);
  const r127 = tb.roundOf(12.7);
  console.log("  ADP 1 -> R" + r1.round + "." + r1.pick + ", 12.7 -> R" + r127.round + "." + r127.pick + ", 14 -> R" + r14.round + "." + r14.pick + ", 15 -> R" + r15.round + "." + r15.pick);
  check("pick 1 is round 1", r1.round === 1 && r1.pick === 1);
  check("the last pick of round 1 stays in round 1", r14.round === 1 && r14.pick === 14);
  check("the next pick rolls to round 2", r15.round === 2 && r15.pick === 1);
  check("a fractional ADP rounds up to a real pick", r127.round === 1 && r127.pick === 13, "12.7 -> pick 13");
  const deep = tb.roundOf(200);
  check("a deep ADP lands in a late round", deep.round === Math.ceil(200 / state.numTeams), "R" + deep.round);

  console.log("\n=== Name normalization ===");
  check("suffixes are stripped", tb.normalizeName("James Cook III") === "james cook", tb.normalizeName("James Cook III"));
  check("apostrophes are stripped", tb.normalizeName("De'Von Achane") === "devon achane");
  check("periods are stripped", tb.normalizeName("D.J. Moore") === "dj moore", tb.normalizeName("D.J. Moore"));
  check("Jr is stripped", tb.normalizeName("Marvin Harrison Jr.") === "marvin harrison");
  check("hyphens become spaces", tb.normalizeName("Ray-Ray McCloud") === "ray ray mccloud");
  check("case is folded", tb.normalizeName("JAHMYR GIBBS") === "jahmyr gibbs");

  console.log("\n=== Pools are the Footballers' order, straight through ===");
  for (const pos of state.positions) {
    const pool = state.poolByPos[pos] || [];
    const top = pool.slice(0, 5).map((pid) => {
      const player = state.players[pid];
      const adp = typeof player.adp === "number" ? player.adp.toFixed(1) : "-";
      const depth = typeof player.dcOrder === "number" ? player.pos + player.dcOrder : "-";
      return player.name + " [ffb " + player.ffbRank + ", adp " + adp + ", depth " + depth + "]";
    });
    console.log("  " + pos.padEnd(3) + " pool=" + String(pool.length).padStart(4));
    for (const line of top) console.log("        " + line);

    check(pos + " pool is non-empty", pool.length > 0, "pool=" + pool.length);
    const ranks = pool.map((pid) => state.players[pid].ffbRank);
    check(
      pos + " pool is sorted by the Footballers' rank",
      ranks.every((val, idx) => idx === 0 || ranks[idx - 1] <= val)
    );
    check(pos + " every pooled player has an FFB rank", ranks.every((val) => typeof val === "number"));
    check(pos + " pool starts at FFB rank 1", ranks[0] === 1, String(ranks[0]));
    // Sleeper must not influence the order at all now.
    const adpOrder = pool.map((pid) => state.players[pid].adp).filter((val) => typeof val === "number");
    const adpSorted = adpOrder.every((val, idx) => idx === 0 || adpOrder[idx - 1] <= val);
    check(pos + " order is NOT Sleeper's ADP order", !adpSorted || pool.length < 3, "ADP-sorted=" + adpSorted);
  }

  console.log("\n=== Per-position seed depths ===");
  console.log("  defaults: " + JSON.stringify(tb.DEFAULT_COUNTS));
  check("QB defaults to 30", tb.defaultCountFor("QB") === 30);
  check("TE defaults to 30", tb.defaultCountFor("TE") === 30);
  check("WR defaults deeper than RB", tb.defaultCountFor("WR") > tb.defaultCountFor("RB"), tb.defaultCountFor("WR") + " vs " + tb.defaultCountFor("RB"));
  check("an unknown position falls back", tb.defaultCountFor("ZZ") === tb.DEFAULT_COUNT);
  for (const pos of state.positions) {
    const entry = tb.boardFor(pos);
    const rows = entry.order.filter((item) => item.t === "p").length;
    const expected = Math.min(tb.defaultCountFor(pos), (state.poolByPos[pos] || []).length);
    console.log("  " + pos.padEnd(3) + " count=" + String(entry.count).padStart(3) + "  rows=" + String(rows).padStart(3) + "  pool=" + String((state.poolByPos[pos] || []).length).padStart(4));
    check(pos + " seeded at its own default", entry.count === tb.defaultCountFor(pos), "count=" + entry.count);
    check(pos + " row count matches the default (or the whole pool)", rows === expected, rows + " vs " + expected);
  }

  console.log("\n=== Depth-chart data ===");
  for (const pos of ["RB", "WR"]) {
    const pool = (state.poolByPos[pos] || []).slice(0, tb.defaultCountFor(pos));
    const withDepth = pool.filter((pid) => typeof state.players[pid].dcOrder === "number").length;
    const starters = pool.filter((pid) => state.players[pid].dcOrder === 1).length;
    console.log("  " + pos + ": " + withDepth + "/" + pool.length + " have a depth slot, " + starters + " are their team's #1");
    check(pos + " mostly has depth-chart data", withDepth / pool.length > 0.75, withDepth + "/" + pool.length);
    check(pos + " has a plausible number of #1s", starters > 0 && starters <= 32, String(starters));
  }
  const topRb = state.poolByPos.RB[0];
  check("the top RB is his team's #1", state.players[topRb].dcOrder === 1, state.players[topRb].name + " " + state.players[topRb].team + " depth " + state.players[topRb].dcOrder);
  const wrAlignments = new Set(
    (state.poolByPos.WR || []).slice(0, 40).map((pid) => state.players[pid].dcPos).filter(Boolean)
  );
  check("receiver alignments are captured", wrAlignments.size > 1, Array.from(wrAlignments).join(", "));

  console.log("\n=== Count migration ===");
  const stale = tb.sanitizeBoard({
    season: 2026,
    countsVersion: 0,
    positions: { QB: { count: 60, order: [{ t: "brk", label: "Keep me" }, { t: "p", pid: state.poolByPos.QB[0] }] } },
  });
  check("an old board reports an old countsVersion", stale.countsVersion === 0);

  // The case that matters right now: a saved board still holding 100 WRs from the
  // previous default must be trimmed to 80, tiers intact, on the next load.
  const wrPool = state.poolByPos.WR;
  const oldWr = { count: 100, order: [{ t: "brk", label: "Keep this tier" }] };
  for (const pid of wrPool.slice(0, 100)) oldWr.order.push({ t: "p", pid: pid });
  oldWr.order.splice(30, 0, { t: "brk", label: "Second tier" });
  const oldBoard = tb.sanitizeBoard({ season: 2026, countsVersion: 2, positions: { WR: oldWr } });
  const keptBoard = state.board;
  state.board = oldBoard;
  const wrRowsBefore = oldBoard.positions.WR.order.filter((item) => item.t === "p").length;
  const droppedWrs = wrPool.slice(80, 100);
  tb.migrateCounts();
  const wrAfter = tb.boardFor("WR").order;
  const wrRowsAfter = wrAfter.filter((item) => item.t === "p").length;
  console.log("  WR board " + wrRowsBefore + " rows -> " + wrRowsAfter + " rows");
  check("a 100-deep WR board is trimmed to 80", wrRowsAfter === 80, String(wrRowsAfter));
  check("the WR count is recorded as 80", tb.boardFor("WR").count === 80);
  check(
    "the bottom 20 are actually gone",
    droppedWrs.every((pid) => !wrAfter.some((item) => item.t === "p" && item.pid === pid)),
    droppedWrs.length + " checked"
  );
  check("both WR tier breaks survived the trim", wrAfter.filter((item) => item.t === "brk").length === 2);
  check("the surviving WRs keep their order", wrAfter.filter((item) => item.t === "p").every((item, idx) => item.pid === wrPool[idx]));
  state.board = keptBoard;
  const realBoard = state.board;
  state.board = stale;
  tb.migrateCounts();
  check("migration moved QB to the new default", tb.boardFor("QB").count === 30, "count=" + tb.boardFor("QB").count);
  check("migration stamped the new version", state.board.countsVersion === tb.COUNTS_VERSION);
  check("migration kept my tier break", stale.positions.QB.order.some((item) => item.t === "brk" && item.label === "Keep me"));
  state.board = realBoard;

  console.log("\n=== Board mutations ===");
  const pos = "RB";
  const board = tb.boardFor(pos);
  const playersOf = (order) => order.filter((item) => item.t === "p").map((item) => item.pid);

  check("seeded default count", board.count === tb.defaultCountFor(pos), "count=" + board.count);
  check("seeded row count", playersOf(board.order).length === Math.min(tb.defaultCountFor(pos), state.poolByPos[pos].length), String(playersOf(board.order).length));
  check("seed starts with a tier break", board.order[0] && board.order[0].t === "brk");
  check("seed order matches the pool", playersOf(board.order).every((pid, idx) => pid === state.poolByPos[pos][idx]));

  const sixth = playersOf(board.order)[5];
  const fromIdx = board.order.findIndex((item) => item.t === "p" && item.pid === sixth);
  tb.moveEntry(fromIdx, 1);
  check("move put the dragged player first", playersOf(board.order)[0] === sixth, state.players[sixth].name);
  check("move did not lose or duplicate rows", new Set(playersOf(board.order)).size === playersOf(board.order).length);
  const afterMoveCount = playersOf(board.order).length;

  const breakAt = board.order.findIndex((item) => item.t === "p" && playersOf(board.order).indexOf(item.pid) === 3);
  board.order.splice(breakAt, 0, { t: "brk", label: "" });
  check("tier break inserted", board.order.filter((item) => item.t === "brk").length === 2);
  check("break insert kept every player", playersOf(board.order).length === afterMoveCount);

  const removals = tb.countRemovals(pos, 24);
  tb.applyCount(pos, 24);
  check("shrink removed the expected rows", playersOf(board.order).length === afterMoveCount - removals, "removed " + removals);
  check("shrink kept the manual #1", playersOf(board.order)[0] === sixth);
  check("shrink kept both tier breaks", board.order.filter((item) => item.t === "brk").length === 2);

  tb.applyCount(pos, 60);
  check("grow restored the full row count", playersOf(board.order).length === afterMoveCount, String(playersOf(board.order).length));
  check("grow preserved the manual #1", playersOf(board.order)[0] === sixth);
  check("grow did not duplicate anyone", new Set(playersOf(board.order)).size === playersOf(board.order).length);

  const qbBefore = JSON.stringify(tb.boardFor("QB").order);
  board.order = tb.seedOrder(pos, board.count);
  check("reset returned RB to the Footballers' order", playersOf(board.order)[0] === state.poolByPos[pos][0]);
  check("reset left QB alone", JSON.stringify(tb.boardFor("QB").order) === qbBefore);

  console.log("\n=== Persistence round-trip ===");
  const reimported = tb.sanitizeBoard(JSON.parse(JSON.stringify(state.board)));
  check("export/import round-trips", !!reimported);
  check("round-trip preserved RB rows", reimported && playersOf(reimported.positions[pos].order).length === playersOf(board.order).length);
  check("rejects junk input", tb.sanitizeBoard({ nope: true }) === null);
  check("rejects a non-object", tb.sanitizeBoard("hello") === null);
  const deduped = tb.sanitizeBoard({
    positions: { RB: { count: 40, order: [{ t: "p", pid: "1" }, { t: "p", pid: "1" }, { t: "brk", label: "A" }] } },
  });
  check("import drops duplicate players", deduped && deduped.positions.RB.order.length === 2);
  check("import keeps a custom tier label", deduped && deduped.positions.RB.order[1].label === "A");
  const badCount = tb.sanitizeBoard({ positions: { RB: { count: 999, order: [{ t: "p", pid: "1" }] } } });
  check("import rejects an out-of-range count", badCount && badCount.positions.RB.count === tb.defaultCountFor("RB"), String(badCount && badCount.positions.RB.count));
  const okCount = tb.sanitizeBoard({ positions: { WR: { count: 100, order: [{ t: "p", pid: "1" }] } } });
  check("import accepts a deep but valid count", okCount && okCount.positions.WR.count === 100);

  console.log("\n=== A rankings refresh keeps my board ===");
  // Rearrange RB by hand and add a tier break, so there is real work to protect.
  const rbBoard = tb.boardFor("RB");
  rbBoard.order = tb.seedOrder("RB", rbBoard.count);
  const movedPid = rbBoard.order.filter((item) => item.t === "p")[7].pid;
  tb.moveEntry(rbBoard.order.findIndex((item) => item.t === "p" && item.pid === movedPid), 1);
  rbBoard.order.splice(4, 0, { t: "brk", label: "My tier 2" });
  const orderBefore = rbBoard.order.map((item) => (item.t === "p" ? item.pid : "brk:" + item.label));
  const rowsBefore = rbBoard.order.filter((item) => item.t === "p").length;

  // Simulate a refreshed snapshot: promote an unranked RB to the very top, and
  // drop the current RB1 out of the rankings entirely.
  const ffbRb = state.ffb.positions.RB;
  const droppedName = ffbRb[0].name;
  const droppedPid = state.poolByPos.RB[0];
  const newcomerPid = Object.keys(state.players).find(
    (pid) =>
      state.players[pid].pos === "RB" &&
      state.players[pid].team &&
      state.players[pid].team !== "FA" &&
      typeof state.players[pid].ffbRank !== "number"
  );
  const newcomer = state.players[newcomerPid];
  console.log("  promoting " + newcomer.name + " to RB1, dropping " + droppedName + " from the rankings");

  state.ffb.positions.RB = [{ rank: 0.5, name: newcomer.name, team: newcomer.team }].concat(
    ffbRb.slice(1)
  );
  tb.buildPools();
  const added = tb.absorbNewRanked();
  const orderAfter = rbBoard.order.map((item) => (item.t === "p" ? item.pid : "brk:" + item.label));

  check("the newcomer tops the refreshed pool", state.poolByPos.RB[0] === newcomerPid, newcomer.name);
  check("refresh reported the addition", added.some((entry) => entry.pos === "RB" && entry.names.indexOf(newcomer.name) !== -1), JSON.stringify(added.map((entry) => entry.pos + ":" + entry.names.length)));
  check("my existing order is untouched", JSON.stringify(orderAfter.slice(0, orderBefore.length)) === JSON.stringify(orderBefore));
  check("my manual #1 is still #1", rbBoard.order.filter((item) => item.t === "p")[0].pid === movedPid);
  check("my tier break is still there", rbBoard.order.some((item) => item.t === "brk" && item.label === "My tier 2"));
  check("the newcomer landed at the bottom", orderAfter[orderAfter.length - 1] === newcomerPid);
  check("exactly one row was added", rbBoard.order.filter((item) => item.t === "p").length === rowsBefore + 1);
  check("a de-ranked player stays on my board", rbBoard.order.some((item) => item.t === "p" && item.pid === droppedPid), droppedName);
  check("a de-ranked player loses his FFB rank", typeof state.players[droppedPid].ffbRank !== "number");
  check("unranked players on the board are counted", tb.countUnrankedOnBoard() >= 1, String(tb.countUnrankedOnBoard()));

  // A second refresh with no changes must be a no-op.
  const noopAdded = tb.absorbNewRanked();
  check("re-running the refresh adds nothing", noopAdded.length === 0);
  check("re-running the refresh changes no rows", rbBoard.order.filter((item) => item.t === "p").length === rowsBefore + 1);

  console.log("\n=== Board survives an export/import round-trip after a refresh ===");
  const exported = JSON.parse(JSON.stringify(state.board));
  exported.ffbStamp = "2026-01-01T00:00:00.000Z";
  const reloaded = tb.sanitizeBoard(exported);
  check("the snapshot stamp round-trips", reloaded.ffbStamp === "2026-01-01T00:00:00.000Z", reloaded.ffbStamp);
  check("the refreshed RB order round-trips", JSON.stringify(reloaded.positions.RB.order.map((item) => (item.t === "p" ? item.pid : "brk:" + item.label))) === JSON.stringify(orderAfter));

  console.log("\n=== Movement: the snapshot carries its own baseline ===");
  // Read the file fresh rather than using state.ffb: the refresh test above
  // deliberately mutates the in-memory snapshot (injecting a newcomer, de-ranking a
  // real player), so state.ffb is no longer what is on disk.
  const diskWindow = {};
  new vm.Script(FFB_SRC).runInContext(vm.createContext({ window: diskWindow }));
  const snap = diskWindow.FFB_RANKINGS;

  check("the snapshot names what it is measured against", typeof snap.previousFetchedAt === "string" && snap.previousFetchedAt.length > 0, snap.previousFetchedAt);
  const baselineDate = new Date(snap.previousFetchedAt);
  check("that baseline is a real, earlier date", !isNaN(baselineDate.getTime()) && baselineDate < new Date(snap.fetchedAt), snap.previousFetchedAt + " < " + snap.fetchedAt);

  let withPrev = 0;
  let nullPrev = 0;
  let missingKey = 0;
  for (const pos of Object.keys(snap.positions)) {
    for (const entry of snap.positions[pos]) {
      if (!("prevRank" in entry)) missingKey++;
      else if (typeof entry.prevRank === "number") withPrev++;
      else nullPrev++;
    }
  }
  console.log("  baselined: " + withPrev + " players, unbaselined: " + nullPrev);
  check("every snapshot row has a prevRank key", missingKey === 0, missingKey + " missing");
  check("most players have a real baseline rank", withPrev > nullPrev * 10, withPrev + " vs " + nullPrev);
  check("an unbaselined player is null, not 0 or undefined", snap.positions.WR.every((entry) => entry.prevRank === null || typeof entry.prevRank === "number"));

  console.log("\n=== Movement: prevRank reaches the players, and movers are counted ===");
  const pooledWithPrev = (state.poolByPos.WR || []).filter((pid) => typeof state.players[pid].ffbPrevRank === "number");
  check("pooled players carry ffbPrevRank", pooledWithPrev.length > 50, pooledWithPrev.length + " WRs");

  // Independently recount straight from the snapshot rows, so this is not just the
  // app agreeing with itself. Counted from state.ffb, which is the snapshot the app
  // actually built its pools from.
  let expectedMovers = 0;
  for (const pos of Object.keys(state.ffb.positions)) {
    for (const entry of state.ffb.positions[pos]) {
      if (typeof entry.prevRank !== "number") continue;
      if (Math.abs(entry.prevRank - entry.rank) >= tb.DELTA_MIN) expectedMovers++;
    }
  }
  const movers = tb.countFfbMovers();
  console.log("  movers of " + tb.DELTA_MIN + "+: " + movers + " (snapshot rows say " + expectedMovers + ")");
  check("the app counts the same movers as the snapshot rows", movers > 0 && movers === expectedMovers, movers + " vs " + expectedMovers);
  check("movers are a minority of the pool", movers < withPrev, movers + " of " + withPrev);

  console.log("\n=== Movement: the noise threshold ===");
  check("the threshold is more than 2", tb.DELTA_MIN === 3, "DELTA_MIN=" + tb.DELTA_MIN);
  const up5 = tb.deltaCellHtml(10, 15, "dffb", "rank", 0);
  const down5 = tb.deltaCellHtml(15, 10, "dffb", "rank", 0);
  const move1 = tb.deltaCellHtml(10, 11, "dffb", "rank", 0);
  const move2 = tb.deltaCellHtml(10, 12, "dffb", "rank", 0);
  const move3 = tb.deltaCellHtml(10, 13, "dffb", "rank", 0);
  const flat = tb.deltaCellHtml(10, 10, "dffb", "rank", 0);
  const noBase = tb.deltaCellHtml(10, null, "dffb", "rank", 0);
  check("a 1-place move is suppressed", /class="dlt dffb flat"/.test(move1) && !/&uarr;|&darr;/.test(move1));
  check("a 2-place move is suppressed", /class="dlt dffb flat"/.test(move2) && !/&uarr;|&darr;/.test(move2));
  check("a 3-place move is shown", /&uarr; 3/.test(move3), move3.replace(/<[^>]*>/g, ""));
  check("a rank going DOWN in number reads as up", /class="dlt dffb up"/.test(up5) && /&uarr; 5/.test(up5));
  check("a rank going UP in number reads as down", /class="dlt dffb down"/.test(down5) && /&darr; 5/.test(down5));
  check("no movement is a dot", /flat/.test(flat) && /&middot;/.test(flat));
  check("a suppressed move still reports itself on hover", /title="Moved 1 \(11 to 10\)/.test(move1), move1);
  check("an unchanged value says so on hover", /title="Unchanged at 10"/.test(flat), flat);

  console.log("\n=== Movement: no baseline is not zero movement ===");
  check("a missing baseline renders a dot", /class="dlt dffb none"/.test(noBase) && /&middot;/.test(noBase));
  check("a missing baseline says why on hover", /No earlier rank to compare/.test(noBase), noBase);
  check("a missing baseline is drawn differently from a flat one", noBase !== flat);
  check("a missing CURRENT value also yields no-baseline", /none/.test(tb.deltaCellHtml(null, 10, "dffb", "rank", 0)));

  console.log("\n=== Movement: ADP deltas keep a decimal ===");
  const adpUp = tb.deltaCellHtml(20.4, 24.9, "dadp", "ADP", 1);
  check("ADP movement shows one decimal", /&uarr; 4\.5/.test(adpUp), adpUp.replace(/<[^>]*>/g, ""));
  check("ADP movement uses its own column class", /class="dlt dadp up"/.test(adpUp));
  check("a 2.5-pick ADP drift is suppressed", /flat/.test(tb.deltaCellHtml(20, 22.5, "dadp", "ADP", 1)));

  console.log("\n=== Movement: the ADP baseline is only used when comparable ===");
  const samplePid = (state.poolByPos.RB || []).find((pid) => typeof state.players[pid].adp === "number");
  const sampleAdp = state.players[samplePid].adp;
  state.adpPrev = null;
  check("no baseline stored means no ADP delta", tb.baselineAdpFor(samplePid) === null);

  state.adpPrev = { at: Date.now() - 86400000, field: state.adpField, season: state.adpSeason, byId: { [samplePid]: 99 } };
  check("a matching baseline is used", tb.baselineAdpFor(samplePid) === 99);

  state.adpPrev = { at: Date.now() - 86400000, field: "adp_std", season: state.adpSeason, byId: { [samplePid]: 99 } };
  check("a different scoring format is refused", tb.baselineAdpFor(samplePid) === null, "adp_std vs " + state.adpField);

  state.adpPrev = { at: Date.now() - 86400000, field: state.adpField, season: state.adpSeason - 1, byId: { [samplePid]: 99 } };
  check("a different season is refused", tb.baselineAdpFor(samplePid) === null);

  state.adpPrev = { at: Date.now() - 86400000, field: state.adpField, season: state.adpSeason, byId: {} };
  check("a player absent from the baseline gets no delta", tb.baselineAdpFor(samplePid) === null);

  console.log("\n=== Movement: capturing the ADP baseline, and the one-hour rule ===");
  store.delete(tb.ADP_PREV_KEY);
  state.adpPrev = null;
  check("the first capture succeeds", tb.captureAdpBaseline() === true);
  check("it recorded the ADP actually on screen", tb.baselineAdpFor(samplePid) === sampleAdp, String(sampleAdp));
  check("it persisted to localStorage", !!store.get(tb.ADP_PREV_KEY));
  const persisted = tb.loadAdpBaseline();
  check("the persisted baseline reloads", persisted && persisted.byId[samplePid] === sampleAdp);
  check("the persisted baseline records its format", persisted.field === state.adpField && persisted.season === state.adpSeason);

  // The protection that matters: a second click must not reset the comparison.
  state.adpPrev.at = Date.now() - 60000;
  const fakeAdp = state.players[samplePid].adp;
  state.players[samplePid].adp = 123.4;
  check("a second capture within the hour is refused", tb.captureAdpBaseline() === false);
  check("the older baseline is intact after the refusal", tb.baselineAdpFor(samplePid) === sampleAdp, String(tb.baselineAdpFor(samplePid)));

  state.adpPrev.at = Date.now() - tb.ADP_BASELINE_MIN_MS - 60000;
  check("a capture after the hour is allowed", tb.captureAdpBaseline() === true);
  check("the baseline then advances to the current value", tb.baselineAdpFor(samplePid) === 123.4);
  state.players[samplePid].adp = fakeAdp;

  console.log("\n=== Sync: repo detection ===");
  // A file:// page has no repo in its URL, so it falls back to the published one. That
  // fallback is what lets a board built locally be pushed up for the Pages site.
  const detected = tb.detectRepo();
  check("a file:// page falls back to the published repo", detected && detected.owner === tb.SYNC_FALLBACK_OWNER && detected.repo === tb.SYNC_FALLBACK_REPO, JSON.stringify(detected));

  sandbox.location.hostname = "someone.github.io";
  sandbox.location.pathname = "/My-Board/";
  sandbox.location.protocol = "https:";
  const fromUrl = tb.detectRepo();
  check("a github.io URL is read for owner and repo", fromUrl.owner === "someone" && fromUrl.repo === "My-Board", JSON.stringify(fromUrl));
  check("so a rename or fork needs no code edit", fromUrl.owner !== tb.SYNC_FALLBACK_OWNER);

  sandbox.location.hostname = "";
  sandbox.location.pathname = "/index.html";
  sandbox.location.protocol = "file:";

  console.log("\n=== Sync: base64 round-trip ===");
  // Tier names are free text, so the encoding has to survive accents and emoji. Plain
  // btoa() throws on both.
  const tricky = JSON.stringify({ label: "Estimé's tier - éü字 🏈" });
  check("base64 round-trips non-ASCII", tb.fromBase64(tb.toBase64(tricky)) === tricky);
  check("base64 output is ASCII-safe", /^[A-Za-z0-9+/=]+$/.test(tb.toBase64(tricky)));
  check("wrapped base64 still decodes", tb.fromBase64(tb.toBase64(tricky).replace(/(.{8})/g, "$1\n")) === tricky);

  console.log("\n=== Sync: adopting a board from the repo ===");
  const localSnapshot = JSON.parse(JSON.stringify(state.board));
  const incoming = JSON.parse(JSON.stringify(state.board));
  incoming.updatedAt = "2030-01-01T00:00:00.000Z";
  incoming.positions.RB.order = [{ t: "brk", label: "From my phone" }].concat(
    incoming.positions.RB.order.filter((item) => item.t === "p").slice(0, 5)
  );
  check("a remote board is adopted", tb.adoptRemoteBoard(incoming) === true);
  check("its tier name came through", state.board.positions.RB.order[0].label === "From my phone", state.board.positions.RB.order[0].label);
  check("its row count came through", state.board.positions.RB.order.filter((item) => item.t === "p").length === 5);
  check("adopting also writes the local copy", /From my phone/.test(String(store.get("tb_board_v1"))));
  check("garbage from the repo is refused", tb.adoptRemoteBoard({ nonsense: true }) === false);
  check("a refused board leaves the current one alone", state.board.positions.RB.order[0].label === "From my phone");

  console.log("\n=== Sync: updatedAt survives a round-trip ===");
  const stamped = tb.sanitizeBoard(Object.assign({}, localSnapshot, { updatedAt: "2029-05-05T05:05:05.000Z" }));
  check("updatedAt is preserved", stamped.updatedAt === "2029-05-05T05:05:05.000Z", stamped.updatedAt);
  check("a board with no stamp gets an empty one, not undefined", tb.sanitizeBoard(Object.assign({}, localSnapshot, { updatedAt: undefined })).updatedAt === "");
  check("a non-string stamp is rejected", tb.sanitizeBoard(Object.assign({}, localSnapshot, { updatedAt: 12345 })).updatedAt === "");

  // Put the real board back so later checks see the state they expect.
  tb.adoptRemoteBoard(localSnapshot);

  console.log("\n=== Sync: the authenticated write path, against a mock GitHub ===");
  // The real write path needs a token, which is the user's to hold and not something to
  // ask for. So stand up a fake GitHub instead: it exercises branch bootstrap, the first
  // push, adopting a newer remote, sha-conflict resolution and a rejected token, none of
  // which would otherwise be covered by anything at all.
  const gh = {
    defaultBranch: "main",
    refs: { main: "sha-of-main" },
    file: null, // { content: base64, sha }
    calls: [],
    failAuth: false,
    writes: 0,
  };
  const realFetch = sandbox.fetch;

  /**
   * Build a fetch-like response.
   *
   * @param {number} status - HTTP status.
   * @param {Object|null} body - JSON body.
   * @returns {Object} a minimal Response.
   */
  function ghRes(status, body) {
    return { status: status, ok: status >= 200 && status < 300, json: async () => body };
  }

  sandbox.fetch = async (url, options) => {
    const target = String(url);
    if (target.indexOf("https://api.github.com") !== 0) return realFetch(url, options);

    const opts = options || {};
    const route = target.slice("https://api.github.com".length);
    gh.calls.push(opts.method || "GET");
    // ghFetch serialises the body before sending, so the mock has to parse it back.
    // Reading .ref off the raw string silently yields undefined, which is exactly the
    // bug this comment exists to stop recurring.
    const sent = opts.body ? JSON.parse(opts.body) : {};

    if (gh.failAuth) return ghRes(401, { message: "Bad credentials" });
    if (!/^Bearer .+/.test(String(opts.headers && opts.headers.Authorization))) {
      return ghRes(401, { message: "Requires authentication" });
    }

    const repoBase = "/repos/" + tb.SYNC_FALLBACK_OWNER + "/" + tb.SYNC_FALLBACK_REPO;
    if (route === repoBase) return ghRes(200, { default_branch: gh.defaultBranch });

    let match = /\/git\/ref\/heads\/(.+)$/.exec(route);
    if (match && (opts.method || "GET") === "GET") {
      const sha = gh.refs[match[1]];
      return sha ? ghRes(200, { object: { sha: sha } }) : ghRes(404, { message: "Not Found" });
    }

    if (route === repoBase + "/git/refs" && opts.method === "POST") {
      const name = String(sent.ref).replace("refs/heads/", "");
      gh.refs[name] = sent.sha;
      return ghRes(201, {});
    }

    if (route.indexOf(repoBase + "/contents/" + tb.SYNC_FILE) === 0) {
      if ((opts.method || "GET") === "GET") {
        return gh.file
          ? ghRes(200, { content: gh.file.content, sha: gh.file.sha })
          : ghRes(404, { message: "Not Found" });
      }
      if (opts.method === "PUT") {
        const expected = gh.file ? gh.file.sha : undefined;
        if (expected !== sent.sha) {
          return ghRes(409, { message: "sha does not match" });
        }
        gh.writes++;
        gh.file = { content: sent.content, sha: "sha-" + gh.writes };
        gh.lastBranch = sent.branch;
        return ghRes(200, { content: { sha: gh.file.sha } });
      }
    }
    return ghRes(404, { message: "unmocked " + route });
  };

  state.sync.owner = tb.SYNC_FALLBACK_OWNER;
  state.sync.repo = tb.SYNC_FALLBACK_REPO;
  state.sync.token = "fake-token-for-testing";
  state.sync.sha = "";

  // Nothing stored yet: it should create the branch and push this browser's board.
  state.board.updatedAt = "2026-08-18T12:00:00.000Z";
  await tb.startSync(false);
  check("the boards branch was created on first use", !!gh.refs[tb.SYNC_BRANCH], JSON.stringify(Object.keys(gh.refs)));
  check("the branch was cut from the default branch", gh.refs[tb.SYNC_BRANCH] === "sha-of-main");
  check("the board was pushed when the repo had none", gh.writes === 1, "writes=" + gh.writes);
  const stored = JSON.parse(tb.fromBase64(gh.file.content));
  check("what was pushed is a real board", !!stored.positions && !!stored.positions.RB);
  check("the pushed board carries a timestamp", !!stored.updatedAt, stored.updatedAt);
  check("saves go to the boards branch, not the published one", tb.SYNC_BRANCH !== gh.defaultBranch);

  // A newer board in the repo (another device) must win on load.
  const fromPhone = JSON.parse(JSON.stringify(state.board));
  fromPhone.updatedAt = "2031-01-01T00:00:00.000Z";
  fromPhone.positions.RB.order = [{ t: "brk", label: "Phone tier" }].concat(
    fromPhone.positions.RB.order.filter((item) => item.t === "p").slice(0, 3)
  );
  gh.file = { content: tb.toBase64(JSON.stringify(fromPhone)), sha: "sha-phone" };
  const writesBefore = gh.writes;
  await tb.startSync(false);
  check("a newer board in the repo is adopted on load", state.board.positions.RB.order[0].label === "Phone tier", state.board.positions.RB.order[0].label);
  check("adopting does not push back over it", gh.writes === writesBefore, "writes=" + gh.writes);

  // An older board in the repo must be overwritten by this browser's newer one.
  state.board.updatedAt = "2032-06-06T00:00:00.000Z";
  await tb.startSync(false);
  check("a newer local board is pushed up", gh.writes === writesBefore + 1, "writes=" + gh.writes);

  // A stale sha means another device wrote since we looked. Older remote: retry and win.
  gh.file = { content: gh.file.content, sha: "sha-moved-on" };
  state.sync.sha = "sha-stale";
  state.board.updatedAt = "2033-01-01T00:00:00.000Z";
  const conflictOutcome = await tb.pushRemoteBoard();
  check("a sha conflict is retried, not lost", conflictOutcome === "saved", conflictOutcome);
  check("the retry used the freshly read sha", gh.file.sha !== "sha-moved-on");

  // Same conflict, but the remote copy is the newer one: it must be adopted, not clobbered.
  const newerRemote = JSON.parse(JSON.stringify(state.board));
  newerRemote.updatedAt = "2040-01-01T00:00:00.000Z";
  newerRemote.positions.RB.order = [{ t: "brk", label: "Newer elsewhere" }].concat(
    newerRemote.positions.RB.order.filter((item) => item.t === "p").slice(0, 2)
  );
  gh.file = { content: tb.toBase64(JSON.stringify(newerRemote)), sha: "sha-newer" };
  state.sync.sha = "sha-stale-again";
  state.board.updatedAt = "2034-01-01T00:00:00.000Z";
  const adoptOutcome = await tb.pushRemoteBoard();
  check("a conflict with a newer remote adopts instead of overwriting", adoptOutcome === "adopted", adoptOutcome);
  check("the newer remote board is what is on screen", state.board.positions.RB.order[0].label === "Newer elsewhere");

  // A rejected token must stop, not retry forever.
  gh.failAuth = true;
  state.sync.token = "expired";
  let authError = "";
  try {
    await tb.pushRemoteBoard();
  } catch (err) {
    authError = err.message;
  }
  check("a rejected token raises a clear error", /token was rejected/.test(authError), authError);
  check("and the token is dropped so it stops retrying", state.sync.token === "", "token=" + state.sync.token);

  gh.failAuth = false;
  sandbox.fetch = realFetch;
  tb.adoptRemoteBoard(localSnapshot);

  console.log("\n=== Empty-tier guard ===");
  const guard = [{ t: "brk", label: "" }, { t: "p", pid: "a" }, { t: "p", pid: "b" }];
  check("no break slot before a leading break", tb.canInsertBreak(guard, 0) === false);
  check("break slot allowed between two players", tb.canInsertBreak(guard, 2) === true);
  check("break slot allowed at the end", tb.canInsertBreak(guard, 3) === true);
  check("no break slot right after a break", tb.canInsertBreak(guard, 1) === false);

  console.log("\n" + (failures ? failures + " FAILURE(S)" : "All checks passed."));
  process.exit(failures ? 1 : 0);
})();
