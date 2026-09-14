"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createPlayerSafetyMemory } = require("./helpers/player-safety-memory");
const { createPlayerSafetyService, pairIdFor } = require("../player-safety");
const { createPlayerSafetyContextResolver } = require("../player-safety-context");
const { createPlayerSafetyComments } = require("../player-safety-comments");
class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
function fixture() {
  const memory = createPlayerSafetyMemory();
  const realtime = { ref(path) {
    const reference = memory.realtime.ref(path);
    reference.orderByChild = () => reference; reference.limitToLast = () => reference;
    return reference;
  } };
  const deps = { ...memory, realtime, HttpsError, now: () => 2000000000000 };
  const resolver = createPlayerSafetyContextResolver(deps);
  const safety = createPlayerSafetyService({ ...deps, ...resolver });
  const comments = createPlayerSafetyComments({ ...deps, playerSafety: safety });
  for (const uid of ["A", "B", "C"]) {
    memory.rtWrite(`online/leaderboardOwners/entry${uid}`, uid);
    memory.rtWrite(`online/leaderboardEntriesByUser/${uid}`, `entry${uid}`);
    memory.rtWrite(`online/leaderboard/entry${uid}`, { name: `NAME${uid}`, commentsEnabled: true });
  }
  const block = (first, second) => memory.fsWrite(`playerContactPolicies/${pairIdFor(first, second)}`, {
    participants: [first, second].sort(), revision: 1, blockedBy: { [first]: true }, ownVersions: { [first]: 1 }, lastBlockedAt: 1999999999000 });
  return { ...memory, resolver, safety, comments, block };
}
test("context resolves an actual counterpart only for a participating room member and keeps strategy name anonymous", async () => {
  const f = fixture(); f.rtWrite("online/strategyRooms/room", { hostUid: "A", guestUid: "B", players: { B: { name: "PRIVATE" } } });
  const target = await f.resolver.resolveContext("A", { mode: "strategy", roomId: "room" });
  assert.equal(target.uid, "B"); assert.equal(target.name, "対戦相手");
  await assert.rejects(f.resolver.resolveContext("C", { mode: "strategy", roomId: "room" }), { code: "not-found" });
  assert.equal(await f.resolver.resolvePublicOwner("ranking", "unknown"), null);
});
test("ranking and shop public IDs map to private owner documents without trusting a supplied UID", async () => {
  const f = fixture();
  f.fsWrite("serverRankingProfiles/B", { entryId: "overallB", rateFloorEntryId: "floorB", name: "B" });
  f.fsWrite("valueMarketShops/B", { publicSellerId: "sellerB", shopName: "SHOP" });
  assert.equal((await f.resolver.resolvePublicOwner("ranking", "overallB")).uid, "B");
  assert.equal((await f.resolver.resolvePublicOwner("ranking", "floorB")).uid, "B");
  assert.equal((await f.resolver.resolvePublicOwner("market_shop", "sellerB")).uid, "B");
  assert.equal(await f.resolver.resolveContext("A", { mode: "public", kind: "ranking", publicEntryId: "unknown", targetUid: "B" }), null);
});
test("owned familiar entry resolves counterpart while another player's book cannot be used", async () => {
  const f = fixture(); f.fsWrite("soloFamiliarBooks/A/familiarEntries/familiarB", { counterpartUid: "B", displayName: "B" });
  assert.equal((await f.resolver.resolveContext("A", { mode: "solo_familiar", familiarId: "familiarB" })).uid, "B");
  assert.equal(await f.resolver.resolveContext("C", { mode: "solo_familiar", familiarId: "familiarB" }), null);
});
test("comments use canonical server identities and reject URL or forged author input", async () => {
  const f = fixture();
  await f.comments.save("A", { targetEntryId: "entryB", text: "ありがとう", authorEntryId: "entryC", authorName: "FORGED" });
  const row = f.documents.get("playerSafetyComments/entryB/entries/entryA");
  assert.equal(row.authorUid, "A"); assert.equal(row.authorName, "NAMEA");
  assert.equal(f.documents.has("playerSafetyComments/entryB/entries/entryC"), false);
  await assert.rejects(f.comments.save("A", { targetEntryId: "entryC", text: "https://example.com" }), { code: "invalid-argument" });
});
test("a concurrent block retries and prevents the comment transaction", async () => {
  const f = fixture(); let raced = false;
  f.hooks.beforeFirestoreCommit = () => { if (!raced) { raced = true; f.block("B", "A"); } };
  await assert.rejects(f.comments.save("A", { targetEntryId: "entryB", text: "hello" }), { code: "failed-precondition" });
  assert.equal(f.documents.has("playerSafetyComments/entryB/entries/entryA"), false);
});
test("legacy comment history is filtered in both viewer and target directions; deletion tombstones survive unblock", async () => {
  const f = fixture();
  f.rtWrite("online/leaderboardComments/entryB/entryA", { authorName: "A", text: "legacy", updatedAt: 1 });
  f.rtWrite("online/leaderboardComments/entryB/entryC", { authorName: "C", text: "allowed", updatedAt: 2 });
  f.block("B", "A");
  assert.deepEqual((await f.comments.list("C", { targetEntryId: "entryB" })).comments.map((row) => row.text), ["allowed"]);
  await f.comments.remove("A", { targetEntryId: "entryB", authorEntryId: "entryA" });
  f.fsWrite(`playerContactPolicies/${pairIdFor("A", "B")}`, { participants: ["A", "B"], revision: 2, blockedBy: { B: false }, ownVersions: { B: 2 } });
  assert.deepEqual((await f.comments.list("C", { targetEntryId: "entryB" })).comments.map((row) => row.text), ["allowed"]);
  await assert.rejects(f.comments.remove("A", { targetEntryId: "entryB", authorEntryId: "entryC" }), { code: "permission-denied" });
});
