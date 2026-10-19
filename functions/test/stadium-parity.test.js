"use strict";

// 画面の stadium-core.mjs が、サーバーの stadium-rules.js と同じ表・同じ計算を持っていること。
const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");
const server = require("../stadium-rules");

const root = path.resolve(__dirname, "..", "..");
const loadClient = () => import(pathToFileURL(path.join(root, "stadium-core.mjs")).href);

const START = Date.parse("2026-10-20T21:30:00+09:00");
const HOUR = 60 * 60 * 1_000;

test("the client tables and constants equal the server's", async () => {
  const client = await loadClient();
  for (const name of [
    "DAILY_COLLECT_LIMIT",
    "FANS_PER_MATCH",
    "FACILITY_IDS",
    "HOUR_MS",
    "MILLI_PER_PAY",
    "STADIUM_SCHEMA_VERSION",
  ]) {
    assert.deepEqual(client[name], server[name], name);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(client.FACILITIES)), JSON.parse(JSON.stringify(server.FACILITIES)));
});

test("the client and the server compute the same settle, collect, build and view", async () => {
  const client = await loadClient();
  const scenarios = [
    { facilities: { stand: 1, shop: 1, vault: 1 }, fansAtSettle: 420, fans: 510, elapsed: 5 * HOUR, vaultMilli: 0 },
    { facilities: { stand: 2, shop: 2, vault: 1 }, fansAtSettle: 2_400, fans: 2_400, elapsed: 30 * HOUR, vaultMilli: 3_000 },
    { facilities: { stand: 6, shop: 4, vault: 4 }, fansAtSettle: 6_000, fans: 6_300, elapsed: 9 * HOUR, vaultMilli: 120_500 },
    { facilities: { stand: 3, shop: 1, vault: 2 }, fansAtSettle: 0, fans: 0, elapsed: 2 * HOUR, vaultMilli: 0 },
  ];
  for (const scenario of scenarios) {
    const make = (rules) => ({
      ...rules.createStadiumRecord({ now: START - scenario.elapsed, baselineMatches: 7 }),
      facilities: scenario.facilities,
      fansAtSettle: scenario.fansAtSettle,
      lastSeenFans: scenario.fansAtSettle,
      vaultMilli: scenario.vaultMilli,
    });
    const options = { now: START, fans: scenario.fans };
    assert.deepEqual(client.settleStadium(make(client), options), server.settleStadium(make(server), options));
    assert.deepEqual(
      client.collectStadium(make(client), { ...options, walletCapacity: 150 }),
      server.collectStadium(make(server), { ...options, walletCapacity: 150 }),
    );
    for (const facility of server.FACILITY_IDS) {
      const level = scenario.facilities[facility] + 1;
      assert.deepEqual(
        client.buildStadium(make(client), { ...options, facility, level, balance: 5_000 }),
        server.buildStadium(make(server), { ...options, facility, level, balance: 5_000 }),
      );
    }
    assert.deepEqual(
      client.stadiumView(make(client), { ...options, walletBalance: 900 }),
      server.stadiumView(make(server), { ...options, walletBalance: 900 }),
    );
  }
});
