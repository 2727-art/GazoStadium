"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  ACHIEVEMENT_CODE_FAILURE_LIMIT,
  ACHIEVEMENT_CODE_LOCK_MS,
  DOLLMASTER_ACHIEVEMENT_ID,
  applyDollmasterRedemptionTransaction,
  achievementCodeAttemptDecision,
  achievementCodeMatches,
  isValidAchievementCodeFormat,
  normalizeAchievementCode,
} = require("../achievement-code");
const {
  normalizeAchievementProfile,
  unlockAchievements,
} = require("../achievements");

const root = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

function memoryTransaction(initial = {}) {
  const documents = new Map(
    Object.entries(initial).map(([key, value]) => [key, structuredClone(value)]),
  );
  const operations = [];
  const transaction = {
    async get(reference) {
      const exists = documents.has(reference);
      const value = exists ? structuredClone(documents.get(reference)) : undefined;
      return {
        exists,
        data: () => structuredClone(value),
        get: (field) => value?.[field],
      };
    },
    set(reference, value) {
      documents.set(reference, structuredClone(value));
      operations.push({ type: "set", reference });
    },
    delete(reference) {
      documents.delete(reference);
      operations.push({ type: "delete", reference });
    },
  };
  return {
    transaction,
    operations,
    data: (reference) => (
      documents.has(reference) ? structuredClone(documents.get(reference)) : undefined
    ),
  };
}

function applyMemoryRedemption(memory, { matches, now }) {
  return applyDollmasterRedemptionTransaction({
    transaction: memory.transaction,
    redemptionRef: "attempt",
    receiptRef: "receipt",
    profileRef: "profile",
    matches,
    now,
    normalizeProfile: normalizeAchievementProfile,
    unlock: unlockAchievements,
  });
}

test("DOLLM＠STER code matching stays server-only and accepts friendly normalization", () => {
  const configuredCode = "T3ST";
  assert.equal(DOLLMASTER_ACHIEVEMENT_ID, "special_dollmaster");
  assert.equal(normalizeAchievementCode("  t3st  "), configuredCode);
  assert.equal(normalizeAchievementCode("Ｔ３ＳＴ"), configuredCode);
  assert.equal(isValidAchievementCodeFormat(configuredCode), true);
  assert.equal(isValidAchievementCodeFormat(`${configuredCode}X`), false);
  assert.equal(achievementCodeMatches(configuredCode, configuredCode), true);
  assert.equal(achievementCodeMatches("T3S7", configuredCode), false);
  assert.equal(achievementCodeMatches("T3-ST", configuredCode), false);
  assert.equal(achievementCodeMatches(configuredCode, ""), false);

  for (const browserAsset of ["index.html", "online.js", "achievements.js", "styles.css"]) {
    assert.doesNotMatch(read(browserAsset), /DOLLMASTER_ACHIEVEMENT_CODE/);
  }
  const server = read("functions/index.js");
  assert.match(server, /defineSecret\("DOLLMASTER_ACHIEVEMENT_CODE"\)/);
  assert.match(
    server,
    /callableOptions\("redeemAchievementCode", \[DOLLMASTER_ACHIEVEMENT_CODE\]\)/,
  );
  assert.match(server, /DOLLMASTER_ACHIEVEMENT_CODE\.value\(\)/);
  assert.doesNotMatch(read("functions/achievement-code.js"), /CODE_DIGEST|createHash/);

  const functionIgnore = read("functions/.firebaseignore");
  assert.match(functionIgnore, /^test\/$/m);
  assert.match(functionIgnore, /^\.secret\.local$/m);
  assert.match(read(".gitignore"), /^functions\/\.secret\.local$/m);
});

test("invalid code attempts lock per account and a valid code clears the attempt state", () => {
  const now = 1_900_000_000_000;
  let state = null;
  for (let index = 1; index <= ACHIEVEMENT_CODE_FAILURE_LIMIT; index += 1) {
    const decision = achievementCodeAttemptDecision(state, { matches: false, now: now + index });
    state = decision.state;
    assert.equal(
      decision.status,
      index === ACHIEVEMENT_CODE_FAILURE_LIMIT ? "locked" : "invalid",
    );
  }
  const blocked = achievementCodeAttemptDecision(state, {
    matches: true,
    now: now + ACHIEVEMENT_CODE_FAILURE_LIMIT + 1,
  });
  assert.equal(blocked.status, "locked");
  assert.ok(blocked.retryAfterMs > 0);

  const afterLock = achievementCodeAttemptDecision(state, {
    matches: true,
    now: state.lockedUntil + 1,
  });
  assert.deepEqual(afterLock, { status: "matched", retryAfterMs: 0, state: null });
  assert.equal(ACHIEVEMENT_CODE_LOCK_MS, 60_000);
});

test("redemption transaction persists lock state and converges repeated success", async () => {
  const memory = memoryTransaction();
  const startedAt = 1_900_000_000_000;
  for (let index = 1; index <= ACHIEVEMENT_CODE_FAILURE_LIMIT; index += 1) {
    const outcome = await applyMemoryRedemption(memory, {
      matches: false,
      now: startedAt + index,
    });
    assert.equal(outcome.status, index === ACHIEVEMENT_CODE_FAILURE_LIMIT ? "locked" : "invalid");
    assert.equal(memory.data("profile"), undefined);
    assert.equal(memory.data("receipt"), undefined);
  }

  const lockedState = memory.data("attempt");
  const blockedCorrectCode = await applyMemoryRedemption(memory, {
    matches: true,
    now: startedAt + ACHIEVEMENT_CODE_FAILURE_LIMIT + 1,
  });
  assert.equal(blockedCorrectCode.status, "locked");

  const redeemed = await applyMemoryRedemption(memory, {
    matches: true,
    now: lockedState.lockedUntil + 1,
  });
  assert.deepEqual(redeemed, { status: "redeemed", alreadyUnlocked: false });
  assert.ok(memory.data("profile").unlocked[DOLLMASTER_ACHIEVEMENT_ID] > 0);
  assert.equal(memory.data("receipt").achievementId, DOLLMASTER_ACHIEVEMENT_ID);
  assert.equal(memory.data("attempt"), undefined);

  const repeated = await applyMemoryRedemption(memory, {
    matches: true,
    now: lockedState.lockedUntil + 2,
  });
  assert.deepEqual(repeated, { status: "redeemed", alreadyUnlocked: true });
});

test("redemption transaction repairs either half of an existing entitlement", async () => {
  const receiptOnly = memoryTransaction({
    receipt: { redeemedAt: 12_345 },
  });
  assert.deepEqual(
    await applyMemoryRedemption(receiptOnly, { matches: false, now: 20_000 }),
    { status: "redeemed", alreadyUnlocked: true },
  );
  assert.equal(
    receiptOnly.data("profile").unlocked[DOLLMASTER_ACHIEVEMENT_ID],
    12_345,
  );

  const unlockedProfile = unlockAchievements(
    normalizeAchievementProfile(null),
    [DOLLMASTER_ACHIEVEMENT_ID],
    23_456,
  ).profile;
  const profileOnly = memoryTransaction({ profile: unlockedProfile });
  assert.deepEqual(
    await applyMemoryRedemption(profileOnly, { matches: false, now: 30_000 }),
    { status: "redeemed", alreadyUnlocked: true },
  );
  assert.deepEqual(profileOnly.data("receipt"), {
    schemaVersion: 1,
    codeId: "dollmaster",
    achievementId: DOLLMASTER_ACHIEVEMENT_ID,
    redeemedAt: 23_456,
  });
});

test("dedicated callable atomically records, repairs, and returns the special achievement", () => {
  const server = read("functions/index.js");
  const transactionModule = read("functions/achievement-code.js");
  const rollout = require("../app-check-rollout");
  assert.equal(rollout.APP_CHECK_ENFORCEMENT.redeemAchievementCode, true);
  assert.match(
    server,
    /exports\.redeemAchievementCode = onCall\(\s*callableOptions\("redeemAchievementCode", \[DOLLMASTER_ACHIEVEMENT_CODE\]\)/,
  );
  assert.match(server, /Reflect\.ownKeys\(request\.data\)\.some\(\(key\) => key !== "code"\)/);
  assert.match(server, /applyDollmasterRedemptionTransaction\(\{/);
  assert.match(server, /normalizeProfile: normalizeAchievementProfile/);
  assert.match(server, /unlock: unlockAchievements/);
  assert.match(transactionModule, /transaction\.get\(redemptionRef\)/);
  assert.match(transactionModule, /transaction\.get\(receiptRef\)/);
  assert.match(transactionModule, /transaction\.get\(profileRef\)/);
  assert.match(transactionModule, /unlock\(profile, \[achievementId\], redeemedAt\)/);
  assert.match(transactionModule, /unlock\(profile, \[achievementId\], now\)/);
  assert.match(server, /achievements: await getAchievements\(uid, \{ syncPublic: true \}\)/);
  assert.match(server, /achievementProfileHasActivity\(achievementSnapshot\.data\(\)\)/);
  assert.match(server, /targetAchievementCodeReceiptSnapshot\.exists/);

  const rules = read("firestore.rules");
  assert.match(
    rules,
    /match \/achievementCodeRedemptions\/\{uid\} \{\s*allow read, write: if false;[\s\S]*?match \/codes\/\{codeId\} \{\s*allow read, write: if false;/,
  );
});

test("achievement screen provides an accessible code form and dedicated luxury presentation", () => {
  const client = read("online.js");
  const achievements = read("achievements.js");
  const styles = read("styles.css");
  const html = read("index.html");

  assert.match(client, /httpsCallable\(functions, "redeemAchievementCode"\)/);
  assert.match(client, /id="achievementRewardCodeForm"/);
  assert.match(client, /id="achievementRewardCodeInput"/);
  assert.match(client, /autocomplete="one-time-code"/);
  assert.match(client, /autocapitalize="characters"/);
  assert.match(client, /applyAchievementPayload\(response\.data\.achievements, \{ notifyPending: true \}\)/);
  assert.match(client, /achievementPreview === "dollmaster"/);
  assert.match(client, /DOLLM＠STERを実績コレクションに追加しました。/);
  assert.match(achievements, /CROSSOVER COLLECTION UNLOCKED/);
  assert.match(achievements, /LIMITED LEGENDARY COLLECTION/);
  assert.match(styles, /\.achievement-family-card\.is-dollmaster/);
  assert.match(styles, /\.achievement-badge\.is-dollmaster/);
  assert.match(styles, /\.achievement-unlock-card\.is-dollmaster/);
  assert.match(styles, /@keyframes achievement-dollmaster-sheen/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.achievement-unlock-card\.is-dollmaster::after/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*?\.achievement-reward-code-form > div/);
  assert.equal((html.match(/dollmaster-achievement-v1/g) || []).length, 3);
});
