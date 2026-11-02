"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { loadMonthlyFinalizer, reconcile } = require("../scripts/reconcile-crown-monthly.cjs");
const { normalizeCrownMonthlyStats } = require("../achievements");
const { crownCustomizationOptions } = require("../ranking-dashboard");

const KEY = "2026-10";
const PERIOD = `crownCircuitPeriods/monthly_${KEY}`;
const END = Date.parse("2026-11-01T00:00:00+09:00");
const CLOSED = END + 5 * 60_000;
const NOW = END + 36 * 60 * 60_000;
const ENTRY = `${PERIOD}/entries/champion`;
const AWARD = `serverRankingProfiles/champion/awards/monthly_${KEY}`;
const HALL = `online/crownCircuitHallOfFame/monthly/${KEY}`;
const HISTORY = `online/crownCircuitSeatHistory/monthly/${KEY}/1`;

function harness({ historical = false, entries = [entry()] } = {}) {
  const data = new Map([[PERIOD, { period: "monthly", key: KEY, endsAt: END,
    status: historical ? "finalized" : "open", participantCount: historical ? 1 : 0,
    ...(historical ? { finalizedAt: CLOSED, achievementRevision: 1 } : {}) }]]);
  entries.forEach((value, i) => data.set(`${PERIOD}/entries/${i ? `other-${i}` : "champion"}`, structuredClone(value)));
  const publicData = new Map();
  let writes = 0, failPublic = false;
  function write(key, value, options) {
    writes++;
    data.set(key, structuredClone(options?.merge ? { ...data.get(key), ...value } : value));
  }
  function snapshot(key) {
    return { id: key.split("/").pop(), ref: reference(key), exists: data.has(key),
      data: () => structuredClone(data.get(key)), get: field => data.get(key)?.[field] };
  }
  function collection(key) {
    return { doc: id => reference(`${key}/${id}`),
      get: async () => ({ docs: [...data.keys()].filter(p => p.startsWith(key + "/") && !p.slice(key.length + 1).includes("/")).map(snapshot) }) };
  }
  function reference(key) {
    return { path: key, collection: id => collection(`${key}/${id}`),
      get: async () => snapshot(key), set: async (value, options) => write(key, value, options) };
  }
  const firestore = { collection,
    batch: () => { const queued=[]; return { set: (ref,v,o) => queued.push([ref.path,v,o]), commit: async () => queued.forEach(args => write(...args)) }; },
    runTransaction: async callback => {
      const queued=[];
      const pending=callback({ get: ref => ref.get(), set: (ref,v,o) => queued.push([ref.path,v,o]) });
      assert.ok(pending instanceof Promise, "Firestore requires a native Promise from the transaction callback");
      const result=await pending;
      queued.forEach(args => write(...args));
      return result;
    },
  };
  const realtime = { ref: () => ({ update: async updates => {
    if (failPublic) { failPublic=false; throw new Error("temporary mirror failure"); }
    Object.entries(updates).forEach(([key, value]) => { writes++; publicData.set(key, structuredClone(value)); });
  } }) };
  const runtime = loadMonthlyFinalizer({ firestore, realtime });
  return { firestore, realtime, data, publicData, runtime, writes: () => writes,
    failNextPublicWrite: () => { failPublic=true; } };
}

function entry(overrides = {}) {
  return { period: "monthly", key: KEY, entryId: "public-entry-id", name: "PLAYER", rating: 1200,
    qualifyingWeeks: 3, weeklyStars: { "2026-09-28": 20, "2026-10-05": 100, "2026-10-19": 100 },
    bestWeeklyKeys: ["2026-10-19", "2026-10-05", "2026-09-28"],
    circuitScore: 220, rankScore: 220, bestCrownPower: 1300, endsAt: END, updatedAt: CLOSED,
    ...overrides };
}

test("a single qualified month awards champion, history and achievements while preserving scores", async () => {
  const h=harness();
  const result=await h.runtime.finalize(KEY, NOW);
  assert.equal(result.participantCount, 1);
  assert.equal(h.data.get(ENTRY).awardTier, "monthly_champion");
  assert.equal(h.data.get(AWARD).tier, "monthly_champion");
  assert.equal(h.data.get(AWARD).label, "月間 王者");
  assert.equal(h.data.get(AWARD).activeUntil, END + 31 * 24 * 60 * 60_000);
  assert.equal(h.publicData.get(HALL).participantCount, 1);
  assert.equal(h.publicData.get(HALL).circuitScore, 220);
  assert.equal(h.publicData.get(HISTORY).awardTier, "monthly_champion");
  const stats=normalizeCrownMonthlyStats(h.data.get("crownMonthlyAchievementStats/champion"));
  assert.equal(stats.championMonths, 1);
  assert.equal(stats.top3Months, 1);
  assert.equal(stats.top10Months, 1);
  assert.ok(h.data.get("achievementProfiles/champion").unlocked.crown_monthly_champion_1);
  assert.equal(h.data.get(PERIOD).achievementRevision, 2);
});

test("zero qualified players, one-week players, and withdrawn players do not become champion", async () => {
  for (const entries of [[], [entry({ qualifyingWeeks: 1, rankScore: 0 })], [entry({ withdrawnAt: END - 1 })]]) {
    const h=harness({ entries });
    const result=await h.runtime.finalize(KEY,NOW);
    assert.equal(result.participantCount,0);
    assert.equal(h.publicData.has(HALL),false);
    assert.equal(h.data.has(AWARD),false);
    const stats=normalizeCrownMonthlyStats(h.data.get("crownMonthlyAchievementStats/champion"));
    assert.equal(stats.championMonths,0);
  }
});

test("two-player months still rank by existing score and do not change awards", async () => {
  const h=harness({entries:[entry(),entry({entryId:"other-entry",rankScore:180,circuitScore:180})]});
  const result=await h.runtime.finalize(KEY,NOW);
  assert.equal(result.participantCount,2);
  assert.equal(h.publicData.get(HALL).participantCount,2);
  assert.equal(h.data.get(ENTRY).rank,1);
  assert.equal(h.data.get(`${PERIOD}/entries/other-1`).rank,2);
});

test("October backfill updates titles and achievements once without changing ranks, times or X privacy", async () => {
  const original=entry({rank:1,participantCount:1,starScore:20,status:"finalized",finalizedAt:CLOSED,awardTier:"monthly_opening",xHandle:"private_x"});
  const h=harness({historical:true,entries:[original]});
  h.data.set(AWARD,{tier:"monthly_opening",awardedAt:CLOSED,activeUntil:END+31*24*60*60_000});
  const before=h.writes();
  const plan=await reconcile({...h,key:KEY,now:NOW});
  assert.equal(plan.targetRevision,2);
  assert.equal(h.writes(),before);
  const report=await reconcile({...h,key:KEY,now:NOW,apply:true});
  assert.equal(report.result.reconciledChampions,1);
  assert.equal(report.finalizedAtPreserved,true);
  assert.deepEqual(h.data.get(ENTRY),{...original,awardTier:"monthly_champion"});
  assert.equal(h.data.get(AWARD).awardedAt,CLOSED);
  assert.equal(h.publicData.get(HALL).finalizedAt,CLOSED);
  assert.equal(h.publicData.get(HALL).startsAt,CLOSED);
  for(const key of [HALL,HISTORY,`online/rankingSpotlights/history/monthly/${KEY}`]) {
    assert.equal(Object.hasOwn(h.publicData.get(key),"xHandle"),false);
  }
  const unlocked=h.data.get("achievementProfiles/champion");
  const after=h.writes();
  await reconcile({...h,key:KEY,now:NOW+1000,apply:true});
  assert.equal(h.writes(),after);
  assert.deepEqual(h.data.get("achievementProfiles/champion"),unlocked);
});

test("a failed history write leaves the revision pending and replay safely completes", async () => {
  const h=harness({historical:true,entries:[entry({rank:1,participantCount:1,starScore:20,status:"finalized",finalizedAt:CLOSED,awardTier:"monthly_opening"})]});
  h.failNextPublicWrite();
  await assert.rejects(reconcile({...h,key:KEY,now:NOW,apply:true}),/temporary mirror failure/);
  assert.equal(h.data.get(PERIOD).achievementRevision,1);
  await reconcile({...h,key:KEY,now:NOW,apply:true});
  assert.equal(h.data.get(PERIOD).achievementRevision,2);
  assert.equal(h.publicData.get(HALL).participantCount,1);
  assert.equal(h.data.get("crownMonthlyAchievementStats/champion").championMonths,1);
});

test("administrative reconciliation refuses an open month without writes", async () => {
  const h=harness();
  await assert.rejects(reconcile({...h,key:KEY,now:NOW,apply:true}),/already-finalized/);
  assert.equal(h.writes(),0);
});

test("monthly champion signature grants both top-three and champion crown colors", () => {
  const options=crownCustomizationOptions({completedRun:true,topThreeAward:false,signatureIds:["monthly_champion"]});
  assert.ok(options.availableThemes.includes("gold"));
  assert.ok(options.availableThemes.includes("violet"));
});
