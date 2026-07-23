const assert = require("node:assert/strict");
const test = require("node:test");

const {
  PATRON_TIERS,
  normalizePatronage,
  patronUpgrade,
  publicPatronage,
  tierForSpent,
} = require("../patronage");

test("patron tiers use the intended high-value thresholds", () => {
  assert.deepEqual(PATRON_TIERS.map((tier) => tier.threshold), [0, 300, 1_500, 5_000]);
  assert.equal(tierForSpent(299).level, 0);
  assert.equal(tierForSpent(300).id, "supporter");
  assert.equal(tierForSpent(1_500).id, "patron");
  assert.equal(tierForSpent(5_000).id, "grand_patron");
});

test("patron upgrades charge only the server-derived difference", () => {
  const seasonKey = "2026-07";
  const start = normalizePatronage(null, seasonKey);
  const supporter = patronUpgrade(start, 1, seasonKey);
  assert.equal(supporter.cost, 300);

  const patron = patronUpgrade({ seasonKey, seasonSpent: 300, lifetimeSpent: 300 }, 2, seasonKey);
  assert.equal(patron.cost, 1_200);

  const grand = patronUpgrade({ seasonKey, seasonSpent: 1_500, lifetimeSpent: 1_500 }, 3, seasonKey);
  assert.equal(grand.cost, 3_500);

  const direct = patronUpgrade(start, 3, seasonKey);
  assert.equal(direct.cost, 5_000);
});

test("owned and lower patron tiers never debit again", () => {
  const seasonKey = "2026-07";
  const current = { seasonKey, seasonSpent: 1_500, lifetimeSpent: 1_500 };
  assert.deepEqual(
    [patronUpgrade(current, 1, seasonKey), patronUpgrade(current, 2, seasonKey)]
      .map((result) => [result.outcome, result.cost]),
    [["owned", 0], ["owned", 0]],
  );
});

test("a new JST month resets the badge while keeping lifetime support", () => {
  const normalized = normalizePatronage({
    seasonKey: "2026-06",
    seasonSpent: 5_000,
    lifetimeSpent: 8_200,
  }, "2026-07");
  assert.equal(normalized.seasonKey, "2026-07");
  assert.equal(normalized.seasonSpent, 0);
  assert.equal(normalized.tier, 0);
  assert.equal(normalized.lifetimeSpent, 8_200);
});

test("public patron summaries contain no UID or wallet balance", () => {
  const summary = publicPatronage({
    seasonKey: "2026-07",
    seasonSpent: 1_500,
    lifetimeSpent: 9_999,
    uid: "secret",
    balance: 88_888,
  }, "2026-07");
  assert.equal(summary.tier, 2);
  assert.equal("uid" in summary, false);
  assert.equal("balance" in summary, false);
  assert.equal("lifetimeSpent" in summary, false);
});
