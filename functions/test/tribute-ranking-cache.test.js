"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { server } = require("./helpers/tribute-edge-harness.cjs");
const { TRIBUTE_AGE_VERSION } = require("../tribute-rules");
const proto = Object.getPrototypeOf(server.createHarness().firestore.collection("x").where("x", "==", 0));
const originalGet = proto.get;
proto.get = async function () {
  const kind = this.orderings.some(x => x.field === "rankScore") ? "score" : this.orderings.some(x => x.field === "receivedGross") ? "gross" : "other";
  if (this.firestore.rankReads) this.firestore.rankReads[kind]++;
  if (this.firestore.failScore && kind === "score") { this.firestore.failScore = false; throw Error("temporary ranking failure"); }
  return originalGet.call(this);
};
function fixture() {
  const playerSafety = { attach() {}, filterVisible: async (uid, rows, owner) => rows.filter(row => uid !== "manager20" || owner(row) !== "manager1") };
  const h = server.createHarness({ playerSafety });
  h.advance(Date.parse("2026-11-01T00:11:00+09:00") - h.now());
  h.firestore.write("tributeHallOfFame/2026-10", { monthKey: "2026-10", closedAt: h.now(), gross: [], score: [] });
  for (let i = 1; i <= 20; i++) {
    const uid = `manager${i}`;
    h.firestore.write(`tributeProfiles/${uid}`, { ageConfirmedVersion: TRIBUTE_AGE_VERSION, publicManagerId: i.toString(16).padStart(24, "0"), card: { personaName: uid }, accepting: true, lastActiveAt: h.now() });
    h.firestore.write(`tributeManagerMonths/2026-11__${uid}`, { monthKey: "2026-11", managerUid: uid, rankScore: 1000-i, receivedGross: 2000-i, payers: 3 });
  }
  h.resetReads = () => { h.firestore.rankReads = { gross: 0, score: 0, other: 0 }; };
  h.resetReads();
  return h;
}
test("six concurrent ranch visits share both cache misses and ranking computations", async () => {
  const h = fixture();
  await Promise.all(Array.from({ length: 6 }, (_, i) => h.act(`manager${15+i}`, "ranch_standing")));
  assert.equal(h.firestore.rankReads.gross, 1);
  assert.equal(h.firestore.rankReads.score, 1);
  h.resetReads();
  await h.act("manager20", "ranch_standing");
  assert.equal(h.firestore.rankReads.gross, 0);
  assert.equal(h.firestore.rankReads.score, 0);
});
test("board badges and ranch standings share the same gross ranking refresh", async () => {
  const h = fixture();
  await Promise.all([h.act("manager20", "ranch_standing"), h.act("manager19", "board")]);
  assert.equal(h.firestore.rankReads.gross, 1);
});
test("a fresh score board refreshes the shared standing but keeps each viewer's blocks separate", async () => {
  const h = fixture();
  const [blocked, unblocked] = await Promise.all([h.act("manager20", "rankings"), h.act("manager19", "rankings")]);
  assert.equal(h.firestore.rankReads.score, 1);
  assert.equal(blocked.managers[0].personaName, "manager2");
  assert.equal(unblocked.managers[0].personaName, "manager1");
  h.resetReads();
  const standing = await h.act("manager1", "ranch_standing");
  assert.equal(standing.live.score.rank, 1);
  assert.equal(h.firestore.rankReads.score, 0);
  h.firestore.write("tributeManagerMonths/2026-11__manager2", { monthKey: "2026-11", managerUid: "manager2", rankScore: 9000, receivedGross: 9000, payers: 3 });
  await h.act("manager19", "rankings");
  h.resetReads();
  assert.equal((await h.act("manager2", "ranch_standing")).live.score.rank, 1);
  assert.equal(h.firestore.rankReads.score, 0);
});
test("failed shared computations are evicted and a manual retry succeeds", async () => {
  const h = fixture();
  h.firestore.failScore = true;
  await assert.rejects(h.act("manager19", "rankings"), /temporary ranking failure/);
  assert.equal((await h.act("manager19", "rankings")).managers.length, 20);
});
