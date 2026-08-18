/**
 * Print what moved in the current rankings snapshot.
 *
 * Used by the Refresh rankings GitHub Action to put the movement in the run log,
 * so you can see what changed without opening the board. Also handy locally after
 * running dev/fetch-ffb.js:
 *
 *   node dev/summarise-movement.js
 */

const path = require("path");

/** Matches DELTA_MIN in tiers.js: below this, a move is displacement, not news. */
const DELTA_MIN = 3;

/** How many movers to name individually. */
const TOP_N = 15;

// The snapshot is a browser file that assigns window.FFB_RANKINGS, so give it a
// window to assign to and then require it.
global.window = {};
require(path.join(__dirname, "..", "ffb-rankings.js"));
const snapshot = global.window.FFB_RANKINGS;

if (!snapshot || !snapshot.positions) {
  console.error("ffb-rankings.js did not define any rankings.");
  process.exit(1);
}

console.log("Snapshot: " + snapshot.fetchedAt);
console.log("Baseline: " + (snapshot.previousFetchedAt || "(none - no movement to report)"));

const movers = [];
let unbaselined = 0;
let suppressed = 0;
let total = 0;

for (const pos of Object.keys(snapshot.positions)) {
  for (const player of snapshot.positions[pos]) {
    total++;
    if (typeof player.prevRank !== "number") {
      unbaselined++;
      continue;
    }
    const delta = player.prevRank - player.rank;
    if (delta === 0) continue;
    if (Math.abs(delta) < DELTA_MIN) {
      suppressed++;
      continue;
    }
    movers.push({ pos: pos, name: player.name, from: player.prevRank, to: player.rank, delta: delta });
  }
}

console.log(
  "\n" + total + " players: " + movers.length + " moved " + DELTA_MIN + "+ places, " +
  suppressed + " moved 1-2 (not shown on the board), " + unbaselined + " have no baseline."
);

movers.sort((aPl, bPl) => Math.abs(bPl.delta) - Math.abs(aPl.delta));
if (movers.length) {
  console.log("\nBiggest movers:");
  for (const mover of movers.slice(0, TOP_N)) {
    console.log(
      "  " + mover.pos.padEnd(3) + " " + mover.name.padEnd(24) +
      String(mover.from).padStart(3) + " -> " + String(mover.to).padStart(3) +
      "  " + (mover.delta > 0 ? "up " : "down ") + Math.abs(mover.delta)
    );
  }
  if (movers.length > TOP_N) console.log("  ... and " + (movers.length - TOP_N) + " more.");
}
