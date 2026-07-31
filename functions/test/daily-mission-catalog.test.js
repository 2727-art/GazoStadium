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
  const rows = [...catalog.matchAll(/\{([^{}]+)\}/g)].map((match) => {
    const body = match[1];
    const text = (key) => body.match(new RegExp(`\\b${key}:\\s*"([^"]+)"`))?.[1];
    const number = (key) => Number(body.match(new RegExp(`\\b${key}:\\s*(\\d+)`))?.[1]);
    return {
      id: text("id"),
      progressKey: text("progressKey"),
      target: number("target"),
      reward: number("reward"),
      ...(text("startsOn") ? { startsOn: text("startsOn") } : {}),
      ...(text("endsAfter") ? { endsAfter: text("endsAfter") } : {}),
    };
  });
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
  const rows = [...catalog.matchAll(/^\s*([a-z_]+):\s*\{([^{}]+)\},?$/gm)]
    .map((match) => {
      const body = match[2];
      const text = (key) => body.match(new RegExp(`\\b${key}:\\s*"([^"]+)"`))?.[1];
      const number = (key) => Number(body.match(new RegExp(`\\b${key}:\\s*(\\d+)`))?.[1]);
      return {
        id: match[1],
        progressKey: text("progressKey"),
        target: number("target"),
        reward: number("reward"),
        ...(text("startsOn") ? { startsOn: text("startsOn") } : {}),
        ...(text("endsAfter") ? { endsAfter: text("endsAfter") } : {}),
      };
    });
  assert.ok(rows.length > 0, "server daily mission catalog must be parseable");
  return rows;
}

function comparableMission(mission) {
  return {
    id: mission.id,
    progressKey: mission.progressKey,
    target: mission.target,
    reward: mission.reward,
    ...(mission.id !== "complete_match" && mission.startsOn
      ? { startsOn: mission.startsOn }
      : {}),
    ...(mission.id !== "complete_match" && mission.endsAfter
      ? { endsAfter: mission.endsAfter }
      : {}),
  };
}

function availableOn(mission, dateKey) {
  return (!mission.startsOn || dateKey >= mission.startsOn)
    && (!mission.endsAfter || dateKey < mission.endsAfter);
}

test("client and server keep retired mode missions as closed historical definitions", () => {
  const { source: browserSource, rows: browserRows } = browserDailyMissions();
  const serverRows = serverDailyMissions();

  assert.deepEqual(
    browserRows.map(comparableMission),
    serverRows.map(comparableMission),
    "browser and Functions must expose the same daily missions",
  );

  for (const rows of [browserRows, serverRows]) {
    const byId = new Map(rows.map((mission) => [mission.id, mission]));
    assert.equal(byId.has("play_royale"), false);
    assert.equal(rows.some((mission) => mission.progressKey === "royaleMatches"), false);
    assert.equal(byId.get("play_team")?.endsAfter, "2026-07-28");
    assert.equal(byId.get("play_training")?.startsOn, "2026-07-28");
    assert.equal(byId.get("play_training")?.endsAfter, "2026-08-01");

    const activeModeRewards = (dateKey) => Object.fromEntries(rows
      .filter((mission) => mission.id.startsWith("play_") && availableOn(mission, dateKey))
      .map((mission) => [mission.id, mission.reward]));
    assert.deepEqual(activeModeRewards("2026-07-27"), {
      play_solo: 70,
      play_strategy: 80,
      play_team: 100,
    });
    assert.deepEqual(activeModeRewards("2026-07-28"), {
      play_solo: 70,
      play_strategy: 80,
      play_training: 100,
    });
    assert.deepEqual(activeModeRewards("2026-08-01"), {
      play_solo: 70,
      play_strategy: 80,
    });
    assert.equal(
      Object.values(activeModeRewards("2026-07-27")).reduce((sum, reward) => sum + reward, 0),
      250,
    );
    assert.equal(
      Object.values(activeModeRewards("2026-08-01")).reduce((sum, reward) => sum + reward, 0),
      150,
    );
    assert.equal(
      Object.values(activeModeRewards("2026-07-28")).reduce((sum, reward) => sum + reward, 0),
      250,
    );
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
  assert.match(browserSource, /!mission\.startsOn \|\| dateKey >= mission\.startsOn/);
  assert.match(browserSource, /!mission\.endsAfter \|\| dateKey < mission\.endsAfter/);

  const serverSource = read("functions/index.js");
  assert.match(serverSource, /mission\.startsOn && dateKey < mission\.startsOn/);
  assert.match(serverSource, /mission\.endsAfter && dateKey >= mission\.endsAfter/);
  assert.match(serverSource, /trainingMatches:\s*0/);
  assert.match(serverSource, /trainingMatches:\s*1/);
  assert.match(serverSource, /trainingSets:\s*0/);
  assert.match(serverSource, /trainingSeconds:\s*0/);
});
