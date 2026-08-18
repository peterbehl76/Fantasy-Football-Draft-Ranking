/**
 * Throwaway browser check for the tier board.
 *
 * The vm harness in verify.js covers the ordering and board math; this one covers
 * what only a real browser exercises - pointer-event dragging, the insert-break
 * affordance, the column header, tab switching, and localStorage persistence
 * across a reload. Borrows whatever global Playwright exists; installs nothing.
 */

const fs = require("fs");
const http = require("http");
const path = require("path");

/** The Footballers snapshot, swapped temporarily to test a refresh. */
const SNAPSHOT = path.join(__dirname, "..", "ffb-rankings.js");

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
  console.error("Could not find a Playwright install. Tried:\n  " + PLAYWRIGHT_PATHS.join("\n  "));
  process.exit(2);
}

const { chromium } = requirePlaywright();

const PAGE_URL = "file:///" + path.join(__dirname, "..", "index.html").replace(/\\/g, "/");

/**
 * Player rows only. The column header shares the .row class for alignment, so it
 * has to be excluded or it counts as a player.
 */
const ROW = "#board .row";

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

/**
 * Drag one row's handle onto another row using real pointer moves.
 *
 * @param {import('playwright').Page} page - the page.
 * @param {number} fromRow - source row position (0-based).
 * @param {number} toRow - destination row position (0-based).
 */
async function dragRow(page, fromRow, toRow) {
  const handle = page.locator(ROW).nth(fromRow).locator(".handle");
  const dst = page.locator(ROW).nth(toRow);
  const from = await handle.boundingBox();
  const to = await dst.boundingBox();

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  const steps = 12;
  const startY = from.y + from.height / 2;
  const endY = to.y + 2;
  for (let step = 1; step <= steps; step++) {
    await page.mouse.move(from.x + from.width / 2, startY + ((endY - startY) * step) / steps);
    await page.waitForTimeout(12);
  }
  await page.mouse.up();
  await page.waitForTimeout(120);
}

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
  ];
  let lastErr = null;
  for (const opts of attempts) {
    try {
      const browser = await chromium.launch(opts);
      console.log("  browser: " + (opts.channel || "cached chromium"));
      return browser;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

/**
 * Wait for the board to finish loading.
 *
 * @param {import('playwright').Page} page - the page.
 */
async function waitForBoard(page) {
  await page.waitForSelector(ROW, { timeout: 240000 });
  // Keyed on the spinner, not on the status line being hidden: once loaded, the
  // status line may legitimately carry an informational message (for example
  // after a rankings refresh adds players).
  await page.waitForFunction(() => !document.querySelector("#status .spin"), null, {
    timeout: 240000,
  });
}

(async () => {
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 980, height: 1000 } });

  page.on("pageerror", (err) => {
    failures++;
    console.log("  FAIL  uncaught page error -- " + err.message);
  });

  console.log("Opening " + PAGE_URL + "\n");
  await page.goto(PAGE_URL);
  await waitForBoard(page);

  console.log("=== Initial render ===");
  const sub = await page.locator("#sub").textContent();
  const info = await page.locator("#adpInfo").textContent();
  console.log("  header : " + sub);
  console.log("  sources: " + info);
  const tabs = await page.locator(".tab").allTextContents();
  console.log("  tabs   : " + tabs.map((str) => str.trim()).join(" | "));
  const rowCount = await page.locator(ROW).count();
  console.log("  RB rows: " + rowCount);

  check("league name in header", /Super Chili Bowl/.test(sub), sub);
  check("four position tabs", (await page.locator(".tab").count()) === 4);
  check("RB seeded at 60", rowCount === 60, String(rowCount));
  check("one seeded tier band", (await page.locator(".brk").count()) === 1);
  check("no page errors during load", failures === 0);

  console.log("\n=== Column header ===");
  const headLabels = await page.locator(".row.head span").allTextContents();
  console.log("  labels: " + headLabels.map((str) => str.trim()).filter(Boolean).join(" | "));
  check("header row exists", (await page.locator(".row.head").count()) === 1);
  check("header labels the FFB column", headLabels.some((str) => str.trim() === "FFB"));
  check("header labels the ADP column", headLabels.some((str) => str.trim() === "ADP"));
  check("header labels the round column", headLabels.some((str) => str.trim() === "RD"));
  check("header labels the depth column", headLabels.some((str) => str.trim() === "DEPTH"));
  check("header explains itself on hover", !!(await page.locator("#hdrDepth").getAttribute("title")));
  check("header labels the FFB movement column", headLabels.some((str) => str.trim() === "ΔFFB"), headLabels.map((str) => str.trim()).join("|"));
  check("header labels the ADP movement column", headLabels.some((str) => str.trim() === "ΔADP"));
  check("the FFB movement header explains the threshold", /1 or 2 places are not shown/.test(await page.locator("#hdrDffb").getAttribute("title")));
  check("the ADP movement header explains its blank start", /no ADP history/.test(await page.locator("#hdrDadp").getAttribute("title")));

  console.log("\n=== Sources: Footballers order, Sleeper for reference ===");
  check("Footballers snapshot loaded", !/MISSING/.test(info), info);
  check("footer says the Footballers set the order", /Order: Footballers PPR/.test(info), info);
  check("footer marks Sleeper as reference only", /ADP for reference/.test(info), info);
  check("footer states the league size", /14-team rounds/.test(info), info);
  check("no unmatched players reported", !/unmatched/.test(info), info);

  const ffbCells = await page.locator(ROW + " .ffb").allTextContents();
  const adpCells = await page.locator(ROW + " .adp").allTextContents();
  const rdCells = await page.locator(ROW + " .rd").allTextContents();
  console.log("  first 6 FFB : " + ffbCells.slice(0, 6).join(", "));
  console.log("  first 6 ADP : " + adpCells.slice(0, 6).join(", "));
  console.log("  first 6 RD  : " + rdCells.slice(0, 6).join(", "));

  check("FFB column runs 1,2,3... down the seeded board", ffbCells.slice(0, 5).map((str) => str.trim()).join(",") === "1,2,3,4,5", ffbCells.slice(0, 5).join(","));
  check("ADP column is populated", adpCells.filter((str) => /^[\d.]+$/.test(str.trim())).length >= 50);
  check("round column is populated", rdCells.filter((str) => /^\d+$/.test(str.trim())).length >= 50);

  // The round must agree with the ADP beside it, for a 14-team league.
  const roundMismatch = [];
  for (let idx = 0; idx < adpCells.length; idx++) {
    const adp = parseFloat(adpCells[idx]);
    const rd = parseInt(rdCells[idx], 10);
    if (!isFinite(adp) || !isFinite(rd)) continue;
    if (Math.ceil(Math.ceil(adp) / 14) !== rd) roundMismatch.push(adp + " -> R" + rd);
  }
  check("every round matches its ADP at 14 teams", roundMismatch.length === 0, roundMismatch.slice(0, 4).join(", ") || "all agree");

  console.log("\n=== Movement columns ===");
  const dffbCells = (await page.locator(ROW + " .dffb").allTextContents()).map((str) => str.trim());
  const dadpCells = (await page.locator(ROW + " .dadp").allTextContents()).map((str) => str.trim());
  check("every row has an FFB movement cell", dffbCells.length === rowCount, dffbCells.length + " of " + rowCount);
  check("every row has an ADP movement cell", dadpCells.length === rowCount, dadpCells.length + " of " + rowCount);

  const arrows = dffbCells.filter((str) => /[↑↓]/.test(str));
  const dots = dffbCells.filter((str) => str === "·");
  console.log("  RB movement: " + arrows.length + " arrows, " + dots.length + " dots");
  console.log("  arrows: " + arrows.slice(0, 8).join("  "));
  check("real movers show an arrow", arrows.length > 0, arrows.length + " arrows");
  check("non-movers show a dot", dots.length > 0);
  check("every cell is either an arrow or a dot", arrows.length + dots.length === dffbCells.length);

  // The whole point of the threshold: nothing under 3 may be drawn, because ordinal
  // ranks shift by one whenever somebody passes you.
  const amounts = arrows.map((str) => parseFloat(str.replace(/[^\d.]/g, "")));
  console.log("  smallest drawn move: " + Math.min.apply(null, amounts));
  check("no move smaller than 3 is drawn", amounts.every((val) => val >= 3), amounts.filter((val) => val < 3).join(", ") || "none under 3");
  check("drawn moves are whole ranks", amounts.every((val) => Number.isInteger(val)));

  // A suppressed move must still be inspectable - hidden from the eye, not from you.
  const flatTitles = await page.locator(ROW + " .dffb.flat").evaluateAll((els) => els.map((el) => el.title));
  check("suppressed moves explain themselves on hover", flatTitles.some((str) => /under the 3-place threshold/.test(str)), flatTitles.find((str) => /threshold/.test(str)) || flatTitles[0]);
  check("unchanged players say so on hover", flatTitles.some((str) => /^Unchanged at/.test(str)));

  const upCount = await page.locator(ROW + " .dffb.up").count();
  const downCount = await page.locator(ROW + " .dffb.down").count();
  check("both risers and fallers are present", upCount > 0 && downCount > 0, upCount + " up, " + downCount + " down");
  const upColor = await page.locator(ROW + " .dffb.up").first().evaluate((el) => getComputedStyle(el).color);
  const downColor = await page.locator(ROW + " .dffb.down").first().evaluate((el) => getComputedStyle(el).color);
  check("risers and fallers are coloured differently", upColor !== downColor, upColor + " vs " + downColor);

  // No refresh has happened in this browser profile yet, so there is no ADP baseline
  // and every ADP cell must be an honest blank rather than a fake zero.
  const dadpNone = await page.locator(ROW + " .dadp.none").count();
  check("ADP movement is blank before any refresh", dadpNone === rowCount, dadpNone + " of " + rowCount);
  check("no ADP movement cell invents a zero", !dadpCells.some((str) => /^0/.test(str)));
  const noneTitle = await page.locator(ROW + " .dadp.none").first().getAttribute("title");
  check("a blank ADP cell says why", /No earlier ADP to compare/.test(noneTitle), noneTitle);

  const footerMovement = (await page.locator("#adpInfo").textContent()).trim();
  check("the footer names the movement baseline", /movement vs /.test(footerMovement), footerMovement);

  console.log("\n=== Depth chart column ===");
  const dcCells = (await page.locator(ROW + " .dc").allTextContents()).map((str) => str.trim());
  console.log("  first 8: " + dcCells.slice(0, 8).join(", "));
  check("depth column rendered on RB", dcCells.length === rowCount, dcCells.length + " of " + rowCount);
  check("depth values look like RB1/RB2", dcCells.filter((str) => /^RB\d+$/.test(str)).length >= 50, dcCells.filter((str) => /^RB\d+$/.test(str)).length + " parsed");
  check("the top RB is a team #1", dcCells[0] === "RB1", dcCells[0]);
  const starterClass = await page.locator(ROW + " .dc").first().getAttribute("class");
  check("a team #1 is styled as a starter", starterClass.includes("one"), starterClass);
  const dcTitle = await page.locator(ROW + " .dc").first().getAttribute("title");
  check("depth cell explains itself on hover", /depth 1/.test(dcTitle), dcTitle);

  const firstBefore = (await page.locator(ROW + " .name").first().textContent()).trim();
  const sixthBefore = (await page.locator(ROW + " .name").nth(5).textContent()).trim();
  console.log("  #1 = " + firstBefore + ", #6 = " + sixthBefore);

  console.log("\n=== Drag ===");
  await dragRow(page, 5, 0);
  const firstAfter = (await page.locator(ROW + " .name").first().textContent()).trim();
  check("dragged player is now #1", firstAfter === sixthBefore, firstAfter + " (was " + firstBefore + ")");
  check("row count unchanged after drag", (await page.locator(ROW).count()) === rowCount);
  const driftFirst = (await page.locator(ROW + " .drift").first().textContent()).trim();
  check("drift indicator shows the move", driftFirst.includes("5"), driftFirst);

  console.log("\n=== Insert tier break ===");
  const gapBtn = page.locator(".gap button").nth(3);
  await gapBtn.scrollIntoViewIfNeeded();
  await gapBtn.click({ force: true });
  await page.waitForTimeout(120);
  check("second tier band added", (await page.locator(".brk").count()) === 2);
  const labels = await page.locator(".brk input").evaluateAll((els) => els.map((el) => el.placeholder));
  check("tier bands auto-number", labels[0] === "Tier 1" && labels[1] === "Tier 2", labels.join(", "));
  await page.locator(".brk input").first().fill("Studs");
  await page.waitForTimeout(150);
  check("typed label sticks", (await page.locator(".brk input").first().inputValue()) === "Studs");

  console.log("\n=== Per-position depths ===");
  const depthByTab = {};
  for (const pos of ["QB", "WR", "TE"]) {
    await page.locator('.tab[data-pos="' + pos + '"]').click();
    await page.waitForTimeout(250);
    depthByTab[pos] = await page.locator(ROW).count();
    const options = await page.locator("#count option").allTextContents();
    console.log("  " + pos.padEnd(3) + " rows=" + String(depthByTab[pos]).padStart(3) + "  Show options: " + options.map((str) => str.trim()).join(", "));
  }
  check("QB shows 30", depthByTab.QB === 30, String(depthByTab.QB));
  check("TE shows 30", depthByTab.TE === 30, String(depthByTab.TE));
  check("WR shows 80", depthByTab.WR === 80, String(depthByTab.WR));

  console.log("\n=== Depth column only where it applies ===");
  await page.locator('.tab[data-pos="QB"]').click();
  await page.waitForTimeout(250);
  check("QB rows have no depth cell", (await page.locator(ROW + " .dc").count()) === 0);
  check("depth header hidden on QB", await page.locator("#hdrDepth").isHidden());
  await page.locator('.tab[data-pos="WR"]').click();
  await page.waitForTimeout(250);
  const wrDc = (await page.locator(ROW + " .dc").allTextContents()).map((str) => str.trim());
  check("WR rows have a depth cell", wrDc.length === depthByTab.WR, wrDc.length + " of " + depthByTab.WR);
  check("depth header visible on WR", await page.locator("#hdrDepth").isVisible());
  check("WR depth values look like WR1/WR2", wrDc.filter((str) => /^WR\d+$/.test(str)).length >= 80, wrDc.filter((str) => /^WR\d+$/.test(str)).length + " parsed");
  const slotTitle = await page.locator(ROW + " .dc").first().getAttribute("title");
  check("receiver alignment shown on hover", /\((LWR|RWR|SWR)\)/.test(slotTitle), slotTitle);

  console.log("\n=== 'All' option ===");
  // Read the pool size off the option rather than hardcoding it: the Footballers add
  // and drop players, so WR has been 130 and is now 131. A literal here is a test
  // that fails every time the rankings legitimately change.
  const wrAllLabel = (await page.locator("#count option").allTextContents())
    .map((str) => str.trim())
    .find((str) => str.startsWith("All ("));
  const wrPoolSize = parseInt((wrAllLabel || "").replace(/\D+/g, ""), 10);
  console.log("  WR pool: " + wrPoolSize);
  check("WR offers an All option", isFinite(wrPoolSize) && wrPoolSize > 100, String(wrAllLabel));
  await page.selectOption("#count", { label: wrAllLabel });
  await page.waitForTimeout(400);
  check("All shows the whole WR pool", (await page.locator(ROW).count()) === wrPoolSize, String(await page.locator(ROW).count()));

  console.log("\n=== Persistence across reload ===");
  await page.reload();
  await waitForBoard(page);
  check("RB drag survived the reload", (await page.locator(ROW + " .name").first().textContent()).trim() === sixthBefore);
  check("tier break survived the reload", (await page.locator(".brk").count()) === 2);
  check("tier label survived the reload", (await page.locator(".brk input").first().inputValue()) === "Studs");
  await page.locator('.tab[data-pos="WR"]').click();
  await page.waitForTimeout(250);
  check("the WR depth change survived the reload", (await page.locator(ROW).count()) === wrPoolSize);

  console.log("\n=== A real rankings refresh keeps my board ===");
  // Swap in a modified snapshot on disk, exactly as dev/fetch-ffb.js would, then
  // reload and check that nothing arranged by hand moved.
  await page.locator('.tab[data-pos="RB"]').click();
  await page.waitForTimeout(250);
  const rbBefore = await page.locator(ROW + " .name").allTextContents();
  const tiersBefore = await page.locator(".brk input").evaluateAll((els) => els.map((el) => el.value));
  const original = fs.readFileSync(SNAPSHOT, "utf8");

  try {
    const snap = JSON.parse(original.slice(original.indexOf("{"), original.lastIndexOf("}") + 1));
    // Promote a deep RB (beyond the 60-row board) to the very top, and backdate the
    // snapshot so the staleness warning is exercised too.
    const deep = snap.positions.RB[80];
    snap.positions.RB = [{ rank: 0.5, name: deep.name, team: deep.team }].concat(
      snap.positions.RB.filter((row) => row.name !== deep.name)
    );
    snap.fetchedAt = new Date(Date.now() - 30 * 86400000).toISOString();
    console.log("  promoted " + deep.name + " (was RB" + deep.rank + ") and backdated the snapshot 30 days");
    fs.writeFileSync(SNAPSHOT, "window.FFB_RANKINGS = " + JSON.stringify(snap, null, 2) + ";\n", "utf8");

    await page.reload();
    await waitForBoard(page);

    const rbAfter = await page.locator(ROW + " .name").allTextContents();
    const tiersAfter = await page.locator(".brk input").evaluateAll((els) => els.map((el) => el.value));
    const status = (await page.locator("#status").textContent()).trim();
    const footer = (await page.locator("#adpInfo").textContent()).trim();
    console.log("  status: " + status);

    check("my order is unchanged through the refresh", JSON.stringify(rbAfter.slice(0, rbBefore.length)) === JSON.stringify(rbBefore));
    check("my tier names survived the refresh", JSON.stringify(tiersAfter) === JSON.stringify(tiersBefore), tiersAfter.join(", "));
    check("exactly one row was added", rbAfter.length === rbBefore.length + 1, rbBefore.length + " -> " + rbAfter.length);
    check("the newly-ranked player is at the bottom", rbAfter[rbAfter.length - 1].trim() === deep.name, rbAfter[rbAfter.length - 1]);
    check("the refresh is announced", /Rankings refreshed/.test(status), status);
    check("the announcement promises the order is intact", /order and tiers are unchanged/.test(status));
    check("a stale snapshot is flagged in the footer", /refresh me/.test(footer), footer);
    check("the footer shows the snapshot age", /30d old/.test(footer), footer);
    const staleClass = await page.locator("#adpInfo").getAttribute("class");
    check("the stale footer is styled", staleClass === "stale", String(staleClass));

    // A reload with no snapshot change must add nothing more.
    await page.reload();
    await waitForBoard(page);
    const rbAgain = await page.locator(ROW + " .name").allTextContents();
    check("a plain reload adds nothing further", rbAgain.length === rbAfter.length, rbAfter.length + " -> " + rbAgain.length);
    check("a plain reload does not re-announce", !/Rankings refreshed/.test((await page.locator("#status").textContent()).trim()));
  } finally {
    fs.writeFileSync(SNAPSHOT, original, "utf8");
    console.log("  restored the original snapshot");
  }

  // Back to the real snapshot; the promoted player drops off the top again.
  await page.reload();
  await waitForBoard(page);
  await page.locator('.tab[data-pos="RB"]').click();
  await page.waitForTimeout(250);

  console.log("\n=== Keyboard nudge ===");
  await page.locator('.tab[data-pos="RB"]').click();
  await page.waitForTimeout(250);
  const beforeNudge = await page.locator(ROW + " .name").allTextContents();
  await page.locator(ROW).nth(2).focus();
  await page.keyboard.press("Alt+ArrowUp");
  await page.waitForTimeout(150);
  const afterNudge = await page.locator(ROW + " .name").allTextContents();
  check("Alt+ArrowUp reordered rows", JSON.stringify(beforeNudge) !== JSON.stringify(afterNudge));
  check("nudge kept every row", afterNudge.length === beforeNudge.length, String(afterNudge.length));

  console.log("\n=== Toolbar: Export/Import gone, Reset present ===");
  page.on("dialog", (dialog) => dialog.accept());
  // Export and Import were removed by request. Assert their absence so a later edit
  // cannot quietly reintroduce them.
  check("no Export button", (await page.locator("#export").count()) === 0);
  check("no Import button", (await page.locator("#import").count()) === 0);
  check("no hidden import file input", (await page.locator("#importFile").count()) === 0);
  const toolbarText = (await page.locator(".controls").textContent()).toLowerCase();
  check("the toolbar offers no export or import", !/export|import/.test(toolbarText), toolbarText.trim());
  check("Reset is in the toolbar", (await page.locator(".controls #reset").count()) === 1);
  check("Reset is styled as destructive", /danger/.test(String(await page.locator("#reset").getAttribute("class"))));
  check("Reset explains itself on hover", /new season/.test(String(await page.locator("#reset").getAttribute("title"))));

  // Sync is opt-in per browser, so with no token it must say so rather than looking broken.
  const syncText = (await page.locator("#syncInfo").textContent()).trim();
  check("sync reports itself as off until set up", /Sync off/.test(syncText), syncText);
  check("sync says how to turn it on", /click to set up/i.test(syncText));
  check("sync explains the trade-off on hover", /saves in this browser only/.test(String(await page.locator("#syncInfo").getAttribute("title"))));

  console.log("\n=== Printable one-pager (at the default depths) ===");
  // The real case: the depths the tool ships with.
  const DEFAULTS = { QB: 30, RB: 60, WR: 80, TE: 30 };
  const poolTotals = {};
  for (const pos of Object.keys(DEFAULTS)) {
    await page.locator('.tab[data-pos="' + pos + '"]').click();
    await page.waitForTimeout(200);
    await page.selectOption("#count", String(DEFAULTS[pos]));
    await page.waitForTimeout(300);
    poolTotals[pos] = await page.locator(ROW).count();
  }
  const worstCase = Object.values(poolTotals).reduce((sum, val) => sum + val, 0);
  console.log("  depths: " + JSON.stringify(poolTotals) + " = " + worstCase + " players");

  const built = await page.evaluate(() => buildPrintSheet());
  console.log("  sheet: " + built.players + " players, " + built.tiers + " tiers, tallest column " + built.tallest + " lines, fitted to " + built.fontPt + "pt, fits=" + built.fits);
  check("sheet covers every player on every board", built.players === worstCase, built.players + " vs " + worstCase);
  check("sheet includes all four positions", (await page.locator(".print-pos").count()) === 4);
  check("sheet includes tier headings", (await page.locator(".print-tier").count()) >= 4, String(await page.locator(".print-tier").count()));
  check("sheet rows match the player count", (await page.locator(".print-row").count()) === built.players);

  console.log("\n=== Layout is three columns: QB+TE / RB / WR ===");
  check("exactly three columns", (await page.locator(".print-col").count()) === 3, String(await page.locator(".print-col").count()));
  const colPositions = await page.locator(".print-col").evaluateAll((cols) =>
    cols.map((col) => Array.from(col.querySelectorAll(".print-pos")).map((el) => el.firstChild.textContent.trim()))
  );
  console.log("  columns: " + JSON.stringify(colPositions));
  check("column 1 is QB then TE", JSON.stringify(colPositions[0]) === JSON.stringify(["QB", "TE"]), JSON.stringify(colPositions[0]));
  check("column 2 is RB alone", JSON.stringify(colPositions[1]) === JSON.stringify(["RB"]), JSON.stringify(colPositions[1]));
  check("column 3 is WR alone", JSON.stringify(colPositions[2]) === JSON.stringify(["WR"]), JSON.stringify(colPositions[2]));

  console.log("\n=== Row content: no leading number, ADP + round + position ===");
  const sheetText = await page.locator("#printSheet").textContent();
  check("no page header", !/Super Chili Bowl/.test(sheetText) && !/printed/.test(sheetText));
  check("no leading rank numbers", (await page.locator(".print-row .pr-n").count()) === 0);
  const firstRow = await page.locator(".print-col").nth(1).locator(".print-row").first().evaluate((row) => ({
    name: row.querySelector(".pr-name").textContent.trim(),
    slot: row.querySelector(".pr-slot").textContent.trim(),
    team: row.querySelector(".pr-team").textContent.trim(),
    adp: row.querySelector(".pr-adp").textContent.trim(),
    rd: row.querySelector(".pr-rd").textContent.trim(),
  }));
  console.log("  top RB row: " + JSON.stringify(firstRow));
  check("row carries the name", firstRow.name.length > 2, firstRow.name);
  check("row carries the depth-chart slot for RB", /^RB\d+$/.test(firstRow.slot), firstRow.slot);
  check("row carries the team", /^[A-Z]{2,3}$/.test(firstRow.team), firstRow.team);
  check("row carries the ADP", /^[\d.]+$/.test(firstRow.adp), firstRow.adp);
  check("row carries the round", /^\d+$/.test(firstRow.rd), firstRow.rd);
  check("round agrees with ADP at 14 teams", Math.ceil(Math.ceil(parseFloat(firstRow.adp)) / 14) === parseInt(firstRow.rd, 10));
  const qbRow = await page.locator(".print-col").first().locator(".print-row").first().evaluate((row) => ({
    slot: row.querySelector(".pr-slot").textContent.trim(),
  }));
  check("QB rows show the position, not a depth slot", qbRow.slot === "QB", qbRow.slot);

  console.log("\n=== Print media hides the app, shows the sheet ===");
  // Size the viewport to Letter's usable area (7.9in x 10.4in at 96dpi) so the
  // measurements below reflect the real printed page.
  await page.setViewportSize({ width: 758, height: 998 });
  await page.emulateMedia({ media: "print" });
  check("the sheet is visible when printing", await page.locator("#printSheet").isVisible());
  check("the board is hidden when printing", await page.locator("#board").isHidden());
  check("the toolbar is hidden when printing", await page.locator(".controls").isHidden());
  check("the tabs are hidden when printing", await page.locator(".tabs").isHidden());
  check("the footer is hidden when printing", await page.locator(".foot").isHidden());

  // Geometry, measured directly. A page-count of 1 on its own is NOT proof: with a
  // broken column layout the overflow is clipped off the single page instead of
  // spilling onto a second one. So check that all four columns are actually used
  // and that the last row really sits inside the sheet.
  const geom = await page.evaluate(() => {
    const sheet = document.getElementById("printSheet");
    const rows = Array.from(sheet.querySelectorAll(".print-row"));
    const sheetBox = sheet.getBoundingClientRect();
    const lefts = new Set(rows.map((row) => Math.round(row.getBoundingClientRect().left)));
    const last = rows[rows.length - 1].getBoundingClientRect();
    const maxBottom = rows.reduce((acc, row) => Math.max(acc, row.getBoundingClientRect().bottom), 0);
    return {
      sheetHeight: sheetBox.height,
      sheetBottom: sheetBox.bottom,
      columnsUsed: lefts.size,
      lastRowBottom: last.bottom,
      maxRowBottom: maxBottom,
      viewport: window.innerHeight,
    };
  });
  console.log(
    "  layout: " + geom.columnsUsed + " columns, sheet " + Math.round(geom.sheetHeight) +
    "px tall, deepest row ends at " + Math.round(geom.maxRowBottom) + "px"
  );
  check("rows occupy three distinct columns", geom.columnsUsed === 3, geom.columnsUsed + " distinct column positions");
  check("no row overflows the sheet box", geom.maxRowBottom <= Math.ceil(geom.sheetBottom) + 1, Math.round(geom.maxRowBottom) + " vs " + Math.round(geom.sheetBottom));

  // 10.4in of usable height at 96dpi, i.e. Letter minus the 0.3in @page margins.
  const USABLE_PX = 998;
  check("the sheet fits the height of one page", geom.sheetHeight <= USABLE_PX, Math.round(geom.sheetHeight) + "px of " + USABLE_PX + "px");

  const pdf = await page.pdf({ format: "Letter", printBackground: false });
  const raw = pdf.toString("latin1");
  const pageObjs = (raw.match(/\/Type\s*\/Page[^s]/g) || []).length;
  console.log("  PDF: " + Math.round(pdf.length / 1024) + " KB, page objects found: " + pageObjs);
  if (pageObjs > 0) {
    check("EVERYTHING prints on one side of one sheet", pageObjs === 1, pageObjs + " page(s)");
  } else {
    console.log("  SKIP  page count not parseable from this PDF (compressed object streams)");
  }

  console.log("\n=== Past what one page holds, it warns instead of spilling ===");
  // WR alone in a column is the binding constraint: at "All" (130) no legible type
  // size fits, and the tool must say so rather than quietly print two pages.
  await page.emulateMedia({ media: null });
  await page.locator('.tab[data-pos="WR"]').click();
  await page.waitForTimeout(200);
  const allLabel = (await page.locator("#count option").allTextContents())
    .map((str) => str.trim())
    .find((str) => str.startsWith("All ("));
  await page.selectOption("#count", { label: allLabel });
  await page.waitForTimeout(300);
  const overflow = await page.evaluate(() => buildPrintSheet());
  console.log("  WR at " + allLabel + ": tallest column " + overflow.tallest + " lines, fits=" + overflow.fits);
  check("an over-long board is reported as not fitting", overflow.fits === false, "fits=" + overflow.fits);
  check("it still clamps to the minimum type size", overflow.fontPt === 5.5, overflow.fontPt + "pt");

  // Put it back to the default depth and confirm it fits again.
  await page.selectOption("#count", "80");
  await page.waitForTimeout(300);
  const restored = await page.evaluate(() => buildPrintSheet());
  check("back at the default depth it fits again", restored.fits === true, "fits=" + restored.fits + " at " + restored.fontPt + "pt");

  await page.emulateMedia({ media: null });

  console.log("\n=== 'Get latest rankings' from a file:// page ===");
  // A file:// page cannot fetch its own local files, so there is nothing to compare
  // against. It must say that plainly rather than reporting a false "no change".
  await page.locator('.tab[data-pos="RB"]').click();
  await page.waitForTimeout(250);
  check("the button is in the toolbar, not buried in the footer", (await page.locator(".controls #refresh").count()) === 1);
  check("the button says what it does", /latest rankings/i.test(await page.locator("#refresh").textContent()));
  await page.locator("#refresh").click();
  await page.waitForFunction(() => !document.querySelector("#status .spin"), null, { timeout: 120000 });
  const fileStatus = (await page.locator("#status").textContent()).trim();
  console.log("  status: " + fileStatus);
  check("it explains a local file cannot be re-read", /Opened as a local file/.test(fileStatus), fileStatus);
  check("it names the local way to update", /refresh-rankings\.cmd/.test(fileStatus));
  check("it still re-pulled ADP", !/Sleeper returned no ADP/.test(fileStatus));
  check("the button is usable again afterwards", !(await page.locator("#refresh").isDisabled()));
  check("the button label is restored", /latest rankings/i.test(await page.locator("#refresh").textContent()));

  console.log("\n=== 'Get latest rankings' when served, as on GitHub Pages ===");
  // Stand up a plain static server - no project code involved, just files over http,
  // which is all GitHub Pages is. Then publish a changed snapshot mid-session, exactly
  // as the Refresh rankings Action would, and check the open page picks it up.
  const original2 = fs.readFileSync(SNAPSHOT, "utf8");
  const staticServer = http.createServer((req, res) => {
    const name = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "") || "index.html";
    const file = path.join(__dirname, "..", name);
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      const type = name.endsWith(".css") ? "text/css"
        : name.endsWith(".js") ? "text/javascript"
        : "text/html";
      res.writeHead(200, { "Content-Type": type + "; charset=utf-8", "Cache-Control": "no-store" });
      res.end(data);
    });
  });

  try {
    await new Promise((resolve) => staticServer.listen(8794, "127.0.0.1", resolve));
    const webPage = await browser.newPage({ viewport: { width: 980, height: 1000 } });
    await webPage.goto("http://127.0.0.1:8794/index.html");
    await waitForBoard(webPage);
    check("the board loads over http", (await webPage.locator(ROW).count()) > 0);

    const orderBefore = await webPage.locator(ROW + " .name").allTextContents();
    const stampBefore = await webPage.evaluate(() => state.ffb.fetchedAt);

    // No new snapshot published yet: the button must report exactly that, and must not
    // invent movement or disturb anything.
    await webPage.locator("#refresh").click();
    await webPage.waitForFunction(() => !document.querySelector("#status .spin"), null, { timeout: 120000 });
    const sameStatus = (await webPage.locator("#status").textContent()).trim();
    console.log("  no-change status: " + sameStatus);
    check("an unchanged snapshot is reported as already latest", /already the latest/.test(sameStatus), sameStatus);
    check("nothing moved on a no-op check", JSON.stringify(await webPage.locator(ROW + " .name").allTextContents()) === JSON.stringify(orderBefore));

    // Now publish a changed snapshot on disk, as the Action's commit would.
    const snap = JSON.parse(original2.slice(original2.indexOf("{"), original2.lastIndexOf("}") + 1));
    const promoted = snap.positions.RB[70];
    snap.positions.RB = [{ rank: 0.5, name: promoted.name, team: promoted.team, prevRank: promoted.rank }]
      .concat(snap.positions.RB.filter((row) => row.name !== promoted.name));
    snap.fetchedAt = new Date(Date.now() + 1000).toISOString();
    fs.writeFileSync(SNAPSHOT, "window.FFB_RANKINGS = " + JSON.stringify(snap, null, 2) + ";\n", "utf8");
    console.log("  published a new snapshot promoting " + promoted.name + " (was RB" + promoted.rank + ")");

    await webPage.locator("#refresh").click();
    check("the button disables while it works", await webPage.locator("#refresh").isDisabled());
    await webPage.waitForFunction(() => !document.querySelector("#status .spin"), null, { timeout: 120000 });

    const newStatus = (await webPage.locator("#status").textContent()).trim();
    const stampAfter = await webPage.evaluate(() => state.ffb.fetchedAt);
    const orderAfter = await webPage.locator(ROW + " .name").allTextContents();
    console.log("  update status: " + newStatus);

    check("the page picked up the newly published snapshot", stampAfter !== stampBefore, stampBefore + " -> " + stampAfter);
    check("it announces new rankings", /New rankings from/.test(newStatus), newStatus);
    check("it reports how many really moved", /moved 3\+ places/.test(newStatus));
    check("my order is untouched by the update", JSON.stringify(orderAfter.slice(0, orderBefore.length)) === JSON.stringify(orderBefore));
    check("the newly-ranked player was added at the bottom", orderAfter[orderAfter.length - 1].trim() === promoted.name, orderAfter[orderAfter.length - 1]);
    check("the button re-enables when done", !(await webPage.locator("#refresh").isDisabled()));
    check("no error styling on a clean update", !/error/.test(String(await webPage.locator("#status").getAttribute("class"))));

    // An ADP baseline exists now, so ADP movement is live in this profile.
    const adpBaseline = await webPage.evaluate(() => (state.adpPrev ? state.adpPrev.at : 0));
    check("an ADP baseline now exists", adpBaseline > 0);
    check("the footer still names a movement baseline", /movement vs /.test((await webPage.locator("#adpInfo").textContent()).trim()));

    // The point of the whole feature: opening the page must not pull anything.
    console.log("\n=== Opening the page pulls nothing on its own ===");
    const requests = [];
    webPage.on("request", (req) => {
      const url = req.url();
      if (!url.startsWith("http://127.0.0.1:8794")) requests.push(url);
    });
    await webPage.reload();
    await waitForBoard(webPage);
    console.log("  offsite requests on load: " + (requests.length ? requests.join(", ") : "none"));
    check("a plain load fetches no new ranking or ADP data", requests.length === 0, requests.slice(0, 3).join(", ") || "none");
    check("the board still renders from cache", (await webPage.locator(ROW).count()) > 0);
    const reloadStatus = (await webPage.locator("#status").textContent()).trim();
    check("a plain load does not claim an update", !/New rankings from/.test(reloadStatus), reloadStatus);

    // Reset goes last because it deliberately destroys everything above it.
    console.log("\n=== Reset wipes everything and rebuilds ===");
    await webPage.locator('.tab[data-pos="RB"]').click();
    await webPage.waitForTimeout(250);

    // Accept confirms from here on. Registered BEFORE the mess is made, not just before
    // the Reset click: Playwright auto-dismisses dialogs, so without this the depth
    // change is silently cancelled and the board never actually shrinks - which would
    // leave "back to the default depth" comparing 60 against 60 and proving nothing.
    webPage.on("dialog", (dialog) => dialog.accept());

    // Make a mess worth losing: a drag, a renamed tier, and a shortened board.
    await dragRow(webPage, 5, 0);
    await webPage.locator("#addBreak").click();
    await webPage.waitForTimeout(200);
    await webPage.locator(".brk input").last().fill("Do not keep me");
    await webPage.selectOption("#count", "24");
    await webPage.waitForTimeout(300);
    const messyFirst = (await webPage.locator(ROW + " .name").first().textContent()).trim();
    const messyRows = await webPage.locator(ROW).count();
    const keysBefore = await webPage.evaluate(() =>
      Object.keys(localStorage).filter((key) => key.indexOf("tb_") === 0).sort()
    );
    console.log("  before reset: " + messyRows + " RB rows, #1 = " + messyFirst + ", keys = " + keysBefore.join(", "));
    check("the mess was made", messyRows === 24 && (await webPage.locator(".brk").count()) >= 2);
    check("cached data exists before the reset", keysBefore.length >= 3, keysBefore.join(", "));

    await webPage.locator("#reset").click();
    check("Reset disables while it works", await webPage.locator("#reset").isDisabled());
    await webPage.waitForFunction(() => !document.querySelector("#status .spin"), null, { timeout: 240000 });

    const resetStatus = (await webPage.locator("#status").textContent()).trim();
    console.log("  status: " + resetStatus);
    const rbAfterReset = await webPage.locator(ROW).count();
    const firstAfterReset = (await webPage.locator(ROW + " .name").first().textContent()).trim();

    check("it reports completion", /Reset complete/.test(resetStatus), resetStatus);
    check("it names the season it rebuilt for", /\b20\d\d\b/.test(resetStatus));
    check("the board went back to the default depth", rbAfterReset === 60, String(rbAfterReset));
    check("the order is the Footballers' order again", firstAfterReset !== messyFirst, firstAfterReset);
    check("my renamed tier is gone", !(await webPage.locator(".brk input").evaluateAll((els) => els.map((el) => el.value))).includes("Do not keep me"));
    check("back to a single seeded tier band", (await webPage.locator(".brk").count()) === 1);
    check("Reset re-enables when done", !(await webPage.locator("#reset").isDisabled()));

    // A reset must leave no stale baseline behind, or the movement columns would be
    // measured against a season that no longer applies.
    const adpPrevAfter = await webPage.evaluate(() => state.adpPrev);
    check("the ADP baseline was cleared", adpPrevAfter === null, JSON.stringify(adpPrevAfter));
    const dadpAfter = await webPage.locator(ROW + " .dadp.none").count();
    check("ADP movement is blank again", dadpAfter === rbAfterReset, dadpAfter + " of " + rbAfterReset);

    // And it must have genuinely re-fetched rather than reusing what it just deleted.
    const keysAfter = await webPage.evaluate(() =>
      Object.keys(localStorage).filter((key) => key.indexOf("tb_") === 0).sort()
    );
    console.log("  after reset: keys = " + keysAfter.join(", "));
    check("caches were rebuilt, not left empty", keysAfter.includes("tb_board_v1") && keysAfter.some((key) => key.indexOf("tb_players") === 0), keysAfter.join(", "));
    check("no reset error", !/error/.test(String(await webPage.locator("#status").getAttribute("class"))));

    // The board must survive a reload after a reset, i.e. the fresh state persisted.
    await webPage.reload();
    await waitForBoard(webPage);
    check("the rebuilt board persists across a reload", (await webPage.locator(ROW).count()) === 60, String(await webPage.locator(ROW).count()));

    await webPage.close();
  } finally {
    await new Promise((resolve) => staticServer.close(resolve));
    fs.writeFileSync(SNAPSHOT, original2, "utf8");
    console.log("  stopped the static server and restored the snapshot");
  }

  // board-check.png is meant to be the ON-SCREEN board, so screen media, not print.
  // It was previously captured under print media, which made it a byte-identical
  // duplicate of print-check.png - so the screen layout was never actually eyeballed.
  await page.emulateMedia({ media: null });
  await page.screenshot({ path: path.join(__dirname, "board-check.png"), fullPage: false });
  console.log("\n  screenshot: board-check.png (screen)");
  await page.emulateMedia({ media: "print" });
  await page.screenshot({ path: path.join(__dirname, "print-check.png"), fullPage: true });
  await page.emulateMedia({ media: null });
  console.log("  screenshot: print-check.png (print)");

  await browser.close();
  console.log("\n" + (failures ? failures + " FAILURE(S)" : "All browser checks passed."));
  process.exit(failures ? 1 : 0);
})();
