"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const online = JSON.parse(
  fs.readFileSync(path.join(root, "database.rules.json"), "utf8"),
).rules.online;

test("retired team realtime surfaces preserve data behind closed client rules", () => {
  for (const retiredPath of [
    "teamQueue",
    "teamActive",
    "teamMatchLock",
    "teamInvites",
    "teamProfiles",
    "teamChats",
    "teamDuoScores",
    "teamRooms",
  ]) {
    assert.deepEqual(
      online[retiredPath],
      { ".read": false, ".write": false },
      retiredPath,
    );
  }
});

test("team ranking history remains representable but cannot grow", () => {
  const periodEntry = online.leaderboardPeriods.$period.$periodKey.$entryId;
  const overall = online.overallProfiles.$uid;

  assert.match(periodEntry.modePoints.team[".validate"], /newData\.val\(\) === 0/);
  assert.match(
    periodEntry.modePoints.team[".validate"],
    /newData\.val\(\) === data\.val\(\)/,
  );
  assert.match(periodEntry.modeMatches.team[".validate"], /newData\.val\(\) === 0/);
  assert.match(
    periodEntry.modeMatches.team[".validate"],
    /newData\.val\(\) === data\.val\(\)/,
  );
  assert.match(periodEntry.lastResultMode[".validate"], /data\.val\(\) === 'team'/);

  assert.match(overall[".validate"], /data\.child\('modes\/team'\)\.exists\(\)/);
  assert.match(overall[".validate"], /newData\.child\('modes\/team\/wins'\)/);
  assert.match(overall.modes.$mode[".validate"], /\$mode !== 'team'/);
  assert.match(overall.modes.$mode[".validate"], /newData\.child\('wins'\)\.val\(\) === 0/);
  assert.match(
    overall.modes.$mode[".validate"],
    /newData\.child\('wins'\)\.val\(\) === data\.child\('wins'\)\.val\(\)/,
  );
  assert.match(overall.lastResultMode[".validate"], /data\.val\(\) === 'team'/);
});

test("team daily history remains valid while new training progress is allowed", () => {
  const daily = online.economy.$uid.daily;
  const missions = daily.claimed.$missionId[".validate"];

  assert.equal(Object.hasOwn(daily, "teamMatches"), true);
  assert.match(missions, /play_team/);
  assert.equal(Object.hasOwn(daily, "trainingSets"), true);
  assert.match(missions, /play_training/);
});
