"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repositoryRoot = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");

test("player-facing copy uses the cute one-versus-two terminology", () => {
  const app = read("app.js");
  const index = read("index.html");
  const team = read("team.js");
  const combined = `${app}\n${index}\n${team}`;
  assert.match(combined, /推し上手！ふたりチャレンジ/);
  assert.match(team, /推し上手さん/);
  assert.match(team, /ふたり推し/);
  assert.match(team, /三人の推しトーク会/);
  assert.match(team, /ロールプレイ/);
  assert.match(team, /どなたでも演じられます/);
  assert.doesNotMatch(team, /参加資格|RATE\s*1200/);
  assert.doesNotMatch(team, /ランカー|推し嬢/);
});

test("new client uses the roleplay protocol while Functions retain cached-client compatibility", () => {
  const client = read("team-duo-challenge.mjs");
  const server = read("functions/team-duo-challenge.js");
  const functions = read("functions/index.js");
  const team = read("team.js");
  const preparation = functions.slice(
    functions.indexOf("async function prepareTeamChallenge(uid)"),
    functions.indexOf("const VERIFIED_MATCH_MODES"),
  );
  assert.match(client, /TEAM_CHALLENGE_PROTOCOL_VERSION = 2/);
  assert.match(client, /TEAM_CHALLENGE_VARIANT = "oshi_jouzu_duo"/);
  assert.match(server, /TEAM_DUO_PROTOCOL_VERSION = 2/);
  assert.match(server, /TEAM_DUO_VARIANT = "oshi_jouzu_duo"/);
  assert.match(functions, /prepare_team_challenge/);
  assert.match(preparation, /version:\s*2/);
  assert.match(preparation, /eligible:\s*true/);
  assert.match(preparation, /reason:\s*"roleplay"/);
  assert.match(preparation, /eligibilitySnapshot:\s*compatibilitySnapshot/);
  assert.doesNotMatch(preparation, /finalizeServerRankingAwards|serverProfile|rating|teamEligibility/);
  assert.doesNotMatch(team, /prepare_team_challenge|eligibilitySnapshot/);
  assert.match(team, /team-duo-challenge\.mjs\?v=oshi-jouzu-duo-v1-roleplay-v1-restore-v1/);
  assert.doesNotMatch(server, /TEAM_ELIGIBILITY|evaluateTeamEligibility|validateTeamEligibility/);
  assert.match(functions, /online\/teamDuoScores/);
  assert.match(functions, /const rankingEligibleMode = ACTIVE_SERVER_RANKING_MODES\.includes\(mode\)/);
  assert.match(functions, /const serverPeriodInfos = rankingEligibleMode\s*\?/);
  assert.doesNotMatch(functions, /teamDuo\s*\?\s*serverProfile\.rating/);
  assert.match(functions, /achievementMode:\s*"team_duo"/);
});

test("verified one-versus-two results preserve the overall rating on the client mirror", () => {
  const online = read("online.js");
  const team = read("team.js");
  assert.match(
    online,
    /const preserveOverallRating = mode === "team"\s*&& periodResult\?\.teamChallengeResult\?\.variant === "oshi_jouzu_duo"/,
  );
  assert.match(
    online,
    /record\.rating = preserveOverallRating\s*\?\s*record\.rating\s*:\s*calculateRating\(/,
  );
  assert.doesNotMatch(team, /preserveOverallRating|teamChallengeResult\s*:/);
});

test("database rules allow either role without qualification while sealing roles and scores", () => {
  const rules = JSON.parse(read("database.rules.json")).rules.online;
  const queueValidation = rules.teamQueue.$uid[".validate"];
  const roomWrite = rules.teamRooms.$roomId[".write"];
  const statusWrite = rules.teamRooms.$roomId.status[".write"];
  const compatibilitySnapshot = rules.teamRooms.$roomId.eligibilitySnapshot[".validate"];
  assert.equal(rules.teamEligibility, undefined);
  assert.equal(rules.teamEligibilityArchive, undefined);
  assert.match(queueValidation, /protocolVersion/);
  assert.match(queueValidation, /oshi_jouzu_duo/);
  assert.match(queueValidation, /role.*oshi_jouzu.*role.*challenger/);
  assert.doesNotMatch(queueValidation, /teamEligibility/);
  assert.equal(rules.teamRooms.$roomId.protocolVersion[".validate"], "newData.val() === 2");
  assert.match(roomWrite, /roster/);
  assert.doesNotMatch(roomWrite, /hasChildren\(\[[^\]]*eligibilitySnapshot/);
  assert.match(roomWrite, /!newData\.child\('eligibilitySnapshot'\)\.exists\(\)/);
  assert.match(compatibilitySnapshot, /version.*2.*eligible.*true.*roleplay/);
  assert.match(compatibilitySnapshot, /version.*1/);
  assert.match(statusWrite, /accepted/);
  assert.doesNotMatch(statusWrite, /eligibilitySnapshot|teamEligibility/);
  assert.match(rules.teamRooms.$roomId.players.$uid[".validate"], /oshi_jouzu/);
  assert.match(rules.teamRooms.$roomId.players.$uid[".validate"], /challenger/);
  assert.match(rules.teamDuoScores.$roomId[".read"], /scoreReady/);
  assert.match(rules.teamDuoScores.$roomId.$uid[".write"], /scoringStartedAt/);
  assert.match(
    rules.teamDuoScores.$roomId.$uid.values.$targetUid[".validate"],
    /newData\.val\(\) === 1.*newData\.val\(\) === 10/,
  );
  assert.match(rules.teamRooms.$roomId.rounds.$round.scores.$uid[".write"], /!root\.child.*protocolVersion/);
});

test("private decisions stay sealed until all three players reach the reveal point", () => {
  const team = read("team.js");
  assert.match(team, /online\/teamDuoScores/);
  assert.match(team, /feedbackReady/);
  assert.match(team, /team-talk-feedback/);
  assert.doesNotMatch(team, /teamRooms\/\$\{state\.roomId\}\/feedback\/\$\{state\.uid\}/);
  assert.doesNotMatch(team, /resultClaims\/\$\{state\.uid\}/);
});

test("legacy 2on2 completion achievements remain separate from role victories", () => {
  const definitions = require("../achievements").ACHIEVEMENT_DEFINITIONS;
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  assert.equal(byId.get("battle_team_1").condition.type, "battle_mode");
  assert.equal(byId.get("battle_team_1").condition.mode, "team");
  assert.equal(byId.get("team_oshi_jouzu_defense").condition.type, "battle_signal");
  assert.equal(byId.get("team_duo_breakthrough").condition.type, "battle_signal");
  assert.equal(byId.get("team_oshi_jouzu_defense").autoPublic, false);
  assert.equal(byId.get("team_duo_breakthrough").autoPublic, false);
});

test("design contract documents points, no RATE mutation, consent, and media privacy", () => {
  const design = read("TEAM_DUO_CHALLENGE_DESIGN.md");
  assert.match(design, /推し上手さんはロールプレイ/);
  assert.match(design, /戦績.*ランキング順位に関係なく/);
  assert.doesNotMatch(design, /RATE\s*1200以上|推し上手さんの資格|資格を発行/);
  assert.match(design, /勝利3点、引き分け1点、敗北0点/);
  assert.match(design, /総合RATEを変動させない/);
  assert.match(design, /3人がそれぞれ参加を選んだ場合だけ/);
  assert.match(design, /最大10分/);
  assert.match(design, /メディア本体はFirebase Database、Firestore、Storageへ保存しない/);
});
