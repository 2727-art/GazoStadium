"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `missing catalog markers: ${startMarker}`);
  return source.slice(start, end);
}

function browserDailyMissions() {
  const source = read("online.js");
  const catalog = sourceBetween(source, "const DAILY_MISSIONS = [", "\n];");
  const rows = [...catalog.matchAll(
    /\{\s*id:\s*"([^"]+)",\s*progressKey:\s*"([^"]+)"[\s\S]*?\btarget:\s*(\d+),\s*reward:\s*(\d+)\s*\}/g,
  )].map((match) => ({
    id: match[1],
    progressKey: match[2],
    target: Number(match[3]),
    reward: Number(match[4]),
  }));
  assert.ok(rows.length > 0, "browser daily mission catalog must be parseable");
  return { source, rows };
}

function serverDailyMissions() {
  const source = read("functions/index.js");
  const catalog = sourceBetween(
    source,
    "const DAILY_MISSIONS = Object.freeze({",
    "\n});",
  );
  const rows = [...catalog.matchAll(
    /^\s*([a-z_]+):\s*\{\s*progressKey:\s*"([^"]+)",\s*target:\s*(\d+),\s*reward:\s*(\d+)(?:,\s*endsAfter:\s*"([^"]+)")?\s*\},?$/gm,
  )].map((match) => ({
    id: match[1],
    progressKey: match[2],
    target: Number(match[3]),
    reward: Number(match[4]),
    ...(match[5] ? { endsAfter: match[5] } : {}),
  }));
  assert.ok(rows.length > 0, "server daily mission catalog must be parseable");
  return rows;
}

function comparableMission(mission) {
  return {
    id: mission.id,
    progressKey: mission.progressKey,
    target: mission.target,
    reward: mission.reward,
  };
}

test("client and server daily mission catalogs retire royale and redistribute its 90 Pay", () => {
  const { source: browserSource, rows: browserRows } = browserDailyMissions();
  const serverRows = serverDailyMissions();
  const expectedModeRewards = {
    play_solo: 70,
    play_strategy: 80,
    play_team: 100,
  };

  assert.deepEqual(
    browserRows.map(comparableMission),
    serverRows.map(comparableMission),
    "browser and Functions must expose the same daily missions",
  );

  for (const rows of [browserRows, serverRows]) {
    const byId = new Map(rows.map((mission) => [mission.id, mission]));
    assert.equal(byId.has("play_royale"), false);
    assert.equal(rows.some((mission) => mission.progressKey === "royaleMatches"), false);
    assert.deepEqual(
      Object.fromEntries(Object.keys(expectedModeRewards).map((id) => [id, byId.get(id)?.reward])),
      expectedModeRewards,
    );

    const modeCompletionTotal = [...byId.entries()]
      .filter(([id]) => id.startsWith("play_"))
      .reduce((sum, [, mission]) => sum + mission.reward, 0);
    assert.equal(modeCompletionTotal, 250);

    const currentMissionTotal = rows
      .filter((mission) => mission.id !== "complete_match")
      .reduce((sum, mission) => sum + mission.reward, 0);
    assert.equal(currentMissionTotal, 400);
  }

  assert.match(
    browserSource,
    /const GENERIC_MATCH_MISSION_END_DATE_KEY = "2026-07-23";/,
  );
  assert.match(
    browserSource,
    /mission\.id !== "complete_match" \|\| dateKey < GENERIC_MATCH_MISSION_END_DATE_KEY/,
  );
  assert.equal(
    serverRows.find((mission) => mission.id === "complete_match")?.endsAfter,
    "2026-07-23",
  );
});
