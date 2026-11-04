"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const root = path.resolve(__dirname, "../..");
const online = fs.readFileSync(path.join(root, "online.js"), "utf8");

function between(start, end) {
  const from = online.indexOf(start), to = online.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from);
  return online.slice(from, to);
}

function dashboardHarness() {
  return Function(`
    const INITIAL_RATING = 1000;
    ${between("const CROWN_CIRCUIT_CUTOVER_KEYS", "const SERVER_RANKING_AWARD_MINIMUM_MATCHES")}
    ${between("function normalizeCrownSignatureIds", "function normalizeCrownCircuitRecords")}
    const normalizeRankingSpotlight = value => value || null;
    ${between("function normalizeRankingDashboard", "function dispatchRankingDashboardUpdated")}
    let rankingDashboard = null, rankingDashboardStatus = "idle", rankingDashboardError = "";
    const dispatchRankingDashboardUpdated = () => {};
    ${between("function applyRankingDashboard", "function getRankingDashboardStatus")}
    return { apply: applyRankingDashboard, updateRun: applyCrownRunToRankingDashboard, get: getRankingDashboard };
  `)();
}

test("old dashboard customization is discarded while proof, earned signatures and spotlight survive", () => {
  const h = dashboardHarness();
  h.apply({ enabled: true, profile: { rating: 1300 },
    crownRun: { key: "2026-11-04", status: "active", matchCount: 1, signatureIds: ["upset"] },
    customization: { crownTheme: "gold", availableThemes: ["rose", "gold"], availableSignatureIds: ["upset"] },
    spotlight: { name: "Champion", crownTheme: "gold", signatureIds: [] }, rules: { dailyKey: "2026-11-04" } });
  const first = h.get();
  assert.equal("customization" in first, false);
  assert.equal(first.overall.rating, 1300);
  assert.deepEqual(first.run.signatureIds, ["upset"]);
  h.updateRun({ key: "2026-11-04", status: "complete", matchCount: 3, signatureIds: ["upset", "triple_unbeaten"] });
  const updated = h.get();
  assert.equal(updated.run.matchCount, 3);
  assert.deepEqual(updated.run.signatureIds, ["upset", "triple_unbeaten"]);
  assert.equal(updated.spotlight.name, "Champion");
  assert.equal("customization" in updated, false);
  updated.run.signatureIds.push("dual_mode");
  assert.equal(h.get().run.signatureIds.length, 2);
});

test("starting a proof run without an existing dashboard needs no customization state", () => {
  const h = dashboardHarness();
  h.updateRun({ key: "2026-11-04", endsAt: 100, status: "active", matchCount: 0,
    entryId: "player-public-entry", ratingAtStart: 1450, crownTheme: "gold", crownSignatureId: "daily_champion" });
  const result = h.get();
  assert.equal(result.enabled, true);
  assert.equal(result.overall.rating, 1450);
  assert.equal(result.rules.dailyKey, "2026-11-04");
  assert.equal(result.run.status, "active");
  assert.equal("customization" in result, false);
});

test("changed browser assets have a customization retirement cache key", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  for (const file of ["app.js", "online.js", "styles.css"]) {
    assert.match(html, new RegExp(`${file.replace(".", "\\.")}\\?v=[^"]*retire-crown-customization-v1`));
  }
});
