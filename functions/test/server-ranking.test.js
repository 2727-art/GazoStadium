const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  SERVER_RANKING_CUTOVER_KEYS,
  addServerRankingResult,
  compareServerRankingEntries,
  emptyServerRankingEntry,
  isServerRankingPeriod,
  rankingAwardFor,
  resolveServerRankingAward,
} = require("../server-ranking");

const root = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("server ranking starts only on natural boundaries after the legacy periods", () => {
  assert.deepEqual(SERVER_RANKING_CUTOVER_KEYS, {
    daily: "2026-07-24",
    weekly: "2026-07-27",
    monthly: "2026-08",
  });
  assert.equal(isServerRankingPeriod("daily", "2026-07-23"), false);
  assert.equal(isServerRankingPeriod("daily", "2026-07-24"), true);
  assert.equal(isServerRankingPeriod("weekly", "2026-07-20"), false);
  assert.equal(isServerRankingPeriod("weekly", "2026-07-27"), true);
  assert.equal(isServerRankingPeriod("monthly", "2026-07"), false);
  assert.equal(isServerRankingPeriod("monthly", "2026-08"), true);
});

test("verified ranking entries keep exact mode totals and deterministic ordering", () => {
  const base = emptyServerRankingEntry({
    period: "weekly",
    key: "2026-07-27",
    entryId: "entry-a",
    profile: { name: "A", rating: 1200 },
    endsAt: Date.now() + 1000,
    now: 10,
  });
  const win = addServerRankingResult(base, {
    mode: "strategy",
    outcome: "win",
    profile: { name: "A", rating: 1216 },
    now: 20,
  });
  assert.equal(win.points, 3);
  assert.equal(win.wins, 1);
  assert.equal(win.modePoints.strategy, 3);
  assert.equal(win.modeMatches.strategy, 1);
  const draw = addServerRankingResult({
    ...base,
    entryId: "entry-b",
    updatedAt: 30,
  }, {
    mode: "solo",
    outcome: "draw",
    profile: { name: "B", rating: 1300 },
    now: 30,
  });
  assert.ok(compareServerRankingEntries(win, draw) < 0);
});

test("ranking awards use participation gates and prestige tiers without PT", () => {
  assert.equal(rankingAwardFor("monthly", 1, 9), null);
  assert.equal(rankingAwardFor("weekly", 10, 3)?.tier, "weekly_top10");
  assert.equal(rankingAwardFor("monthly", 3, 10)?.tier, "monthly_top3");
  const champion = rankingAwardFor("monthly", 1, 10, { key: "2026-08", endsAt: 123 });
  assert.equal(champion.tier, "monthly_champion");
  assert.equal(champion.rank, 1);
  assert.equal(Object.hasOwn(champion, "reward"), false);
});

test("award finalization closes ineligible entries and retries only a missing eligible mirror", () => {
  const ownEntry = {
    period: "monthly",
    key: "2026-08",
    entryId: "entry-a",
    wins: 5,
    losses: 4,
    draws: 0,
    endsAt: 123,
  };
  const ineligible = resolveServerRankingAward("monthly", ownEntry, []);
  assert.equal(ineligible.processed, true);
  assert.equal(ineligible.award, null);

  const eligibleEntry = { ...ownEntry, wins: 6 };
  const missingMirror = resolveServerRankingAward("monthly", eligibleEntry, []);
  assert.equal(missingMirror.processed, false);
  const resolved = resolveServerRankingAward("monthly", eligibleEntry, [eligibleEntry], { now: 456 });
  assert.equal(resolved.processed, true);
  assert.equal(resolved.rank, 1);
  assert.equal(resolved.award?.tier, "monthly_champion");
});

test("server ranking wiring is Admin-only and legacy writes stop at cutover", () => {
  const server = read("functions/index.js");
  const client = read("online.js");
  const app = read("app.js");
  const rules = read("database.rules.json");
  const firestoreRules = read("firestore.rules");
  assert.match(server, /serverRankingProfileRef/);
  assert.match(server, /serverRankingPeriodEntryRef/);
  assert.match(server, /transaction\.set\(serverPeriodEntryRefs\[flatIndex\], entry\)/);
  assert.match(server, /\.collection\("serverRankingPeriods"\)/);
  assert.match(server, /mirrorServerRankingEntries/);
  assert.match(server, /legacyServerRankingSeed/);
  assert.match(server, /if \(entryEndsAt <= timestamp\) continue/);
  assert.match(server, /withdrawnAt/);
  assert.match(server, /withdrewBeforeEnd \? "withdrawn" : "ineligible"/);
  assert.doesNotMatch(server, /serverLeaderboardPeriodEntriesByUser\/\$\{uid\}`\]: null/);
  assert.doesNotMatch(server, /activeRefs\.forEach\(\(entryRef\) => batch\.delete/);
  assert.match(server, /set_server_ranking_participation/);
  assert.match(server, /get_server_ranking_awards/);
  assert.match(client, /serverLeaderboardPeriods/);
  assert.match(client, /String\(first\.entryId \|\| ""\)\.localeCompare\(String\(second\.entryId \|\| ""\)\)/);
  assert.match(client, /leaderboardPeriodEntriesByUser\/\$\{uid\}\/\$\{period\}\/\$\{key\}`\] = null/);
  assert.doesNotMatch(client, /leaderboardPeriodEntriesByUser\/\$\{uid\}`\]: null/);
  assert.match(client, /isServerRankingPeriod/);
  assert.match(client, /daily: "2026-07-24"/);
  assert.match(client, /weekly: "2026-07-27"/);
  assert.match(client, /monthly: "2026-08"/);
  assert.match(client, /serverRankingHallOfFame/);
  assert.match(app, /SERVER VERIFIED/);
  assert.match(app, /歴代月間王者/);
  assert.match(rules, /serverLeaderboardPeriods/);
  assert.match(rules, /!newData\.exists\(\) \|\| \(\(\$period === 'daily'/);
  assert.match(rules, /\$periodKey < '2026-07-24'/);
  assert.match(firestoreRules, /match \/serverRankingProfiles\/\{uid\}/);
  assert.match(firestoreRules, /match \/serverRankingPeriods\/\{periodKey\}\/entries\/\{uid\}/);
});
