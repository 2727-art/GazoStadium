const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  ACTIVE_SERVER_RANKING_MODES,
  SERVER_RANKING_MODES,
} = require("../server-ranking");

const root = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("battle royale has no playable client or realtime room surface", () => {
  const index = read("index.html");
  const app = read("app.js");
  const online = read("online.js");
  const styles = read("styles.css");
  const rules = JSON.parse(read("database.rules.json")).rules.online;

  assert.equal(fs.existsSync(path.join(root, "royale.js")), false);
  assert.doesNotMatch(index, /src=["']royale\.js/);
  for (const moduleName of ["account", "strategy", "online", "flea-market", "market", "team"]) {
    assert.match(index, new RegExp(`${moduleName}\\.js\\?v=[^"]*remove-royale-v1`), moduleName);
  }
  assert.doesNotMatch(app, /royaleBattleButton|HariaiRoyale/);
  assert.doesNotMatch(online, /royaleBattleButton|HariaiRoyale/);
  assert.doesNotMatch(styles, /\.royale[-_a-zA-Z0-9]*/);

  for (const retiredPath of ["royaleQueue", "royaleActive", "royaleInvites", "royaleRooms"]) {
    assert.equal(Object.hasOwn(rules, retiredPath), false, retiredPath);
  }
  assert.doesNotMatch(rules.publicPresence.$sessionId[".validate"], /royale/);
  assert.doesNotMatch(rules.publicPresence.$sessionId.mode[".validate"], /royale/);
});

test("battle royale cannot receive new rewards or ranking results", () => {
  const server = read("functions/index.js");
  const browser = read("online.js");
  const rules = JSON.parse(read("database.rules.json")).rules.online;
  const daily = rules.economy.$uid.daily;

  assert.doesNotMatch(server, /id:\s*"play_royale"/);
  assert.doesNotMatch(browser, /id:\s*"play_royale"/);
  assert.doesNotMatch(browser, /4モードのサーバー検証済み完走/);
  assert.match(browser, /現在遊べる3モードのサーバー検証済み完走/);
  assert.equal(Object.hasOwn(daily, "royaleMatches"), false);
  assert.doesNotMatch(daily.claimed.$missionId[".validate"], /play_royale/);
  assert.deepEqual(ACTIVE_SERVER_RANKING_MODES, ["solo", "strategy"]);
});

test("retired history and purchased cosmetics remain compatible", () => {
  const rules = JSON.parse(read("database.rules.json")).rules.online;
  const stamps = read("stamps.js");
  const titles = read("player-titles.js");
  const achievements = read("achievements.js");

  assert.equal(rules.royaleProfiles.$uid[".write"], false);
  assert.match(rules.overallProfiles.$uid[".validate"], /modes\/royale/);
  assert.match(rules.overallProfiles.$uid.modes.$mode[".validate"], /\$mode !== 'royale'/);
  assert.match(rules.overallProfiles.$uid.modes.$mode[".validate"], /newData\.child\('wins'\)\.val\(\) === data\.child\('wins'\)\.val\(\)/);
  assert.match(rules.leaderboardPeriods.$period.$periodKey.$entryId.modePoints.royale[".validate"], /newData\.val\(\) === data\.val\(\)/);
  assert.match(rules.leaderboardPeriods.$period.$periodKey.$entryId.modeMatches.royale[".validate"], /newData\.val\(\) === data\.val\(\)/);
  assert.deepEqual(SERVER_RANKING_MODES, ["solo", "strategy", "team", "royale"]);
  for (const id of ["stamp_survived", "stamp_close_call", "stamp_champion", "stamp_last_card"]) {
    assert.match(stamps, new RegExp(`id:\\s*"${id}"`), id);
  }
  assert.match(titles, /id:\s*"title_still_surviving"/);
  assert.match(achievements, /legacyFamily \? "終了モードの記録"/);
});
