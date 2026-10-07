"use strict";

// Read-only, aggregate-only preflight. Never outputs UIDs, note text, or tokens.
// Usage: node audit-community-retirement.cjs <firebase-tools/lib absolute path>
const path = require("node:path");
const PROJECT = "gazostadium";
const JOBS = new Set([
  "firebase-schedule-expireAnjuPayFleaListings-us-central1",
  "firebase-schedule-cleanupDanwakuDeletionJobs-us-central1",
]);

function fieldFilter(field, op, value) {
  return { fieldFilter: { field: { fieldPath: field }, op, value } };
}

async function main() {
  const cliLib = process.argv[2];
  if (!cliLib || !path.isAbsolute(cliLib)) throw new Error("An absolute firebase-tools/lib path is required");
  const auth = require(path.join(cliLib, "auth"));
  await require(path.join(cliLib, "requireAuth")).requireAuth({
    project: PROJECT, nonInteractive: true, ...auth.getProjectDefaultAccount(process.cwd()),
  });
  const { Client } = require(path.join(cliLib, "apiv2"));
  const firestore = new Client({ urlPrefix: "https://firestore.googleapis.com" });
  const scheduler = new Client({ urlPrefix: "https://cloudscheduler.googleapis.com" });
  const checkedAt = new Date();
  const since = checkedAt.getTime() - 30 * 24 * 60 * 60 * 1000;
  const queries = [
    ["fleaListingsTotal", "anjuPayFleaListings"],
    ["fleaListingsStatusActive", "anjuPayFleaListings", fieldFilter("status", "EQUAL", { stringValue: "active" })],
    ["fleaListingsCreatedLast30Days", "anjuPayFleaListings", fieldFilter("createdAt", "GREATER_THAN_OR_EQUAL", { integerValue: String(since) })],
    ["fleaSalesTotal", "anjuPayFleaSales"],
    ["fleaSellerCardsTotal", "anjuPayFleaSellerCards"],
    ["danwakuProfilesTotal", "danwakuProfiles"],
    ["danwakuPublicEntriesTotal", "danwakuPublicEntries"],
    ["danwakuMatchBadgesTotal", "danwakuMatchBadges"],
    ["danwakuDeletionJobsTotal", "danwakuDeletionJobs"],
  ];
  const counts = {};
  for (const [alias, collectionId, where] of queries) {
    const { body } = await firestore.post(`/v1/projects/${PROJECT}/databases/(default)/documents:runAggregationQuery`, {
      structuredAggregationQuery: {
        structuredQuery: { from: [{ collectionId }], ...(where ? { where } : {}) },
        aggregations: [{ alias: "total", count: {} }],
      },
    });
    const entries = Array.isArray(body) ? body : [body];
    const value = entries.find((entry) => entry.result?.aggregateFields?.total)?.result.aggregateFields.total;
    if (!value || value.integerValue === undefined) throw new Error(`Missing aggregate count for ${alias}`);
    counts[alias] = Number(value.integerValue);
  }
  const jobs = [];
  let pageToken;
  do {
    const suffix = pageToken ? `?pageToken=${encodeURIComponent(pageToken)}` : "";
    const { body } = await scheduler.get(`/v1/projects/${PROJECT}/locations/us-central1/jobs${suffix}`);
    for (const job of body.jobs || []) {
      const name = job.name.split("/").pop();
      if (JOBS.has(name)) jobs.push({ name, state: job.state, schedule: job.schedule, timeZone: job.timeZone });
    }
    pageToken = body.nextPageToken;
  } while (pageToken);
  console.log(JSON.stringify({ project: PROJECT, checkedAt: checkedAt.toISOString(),
    readOnly: true, aggregateOnly: true, last30DaysSince: new Date(since).toISOString(), counts, jobs,
    cleanupEmptyAtCheck: counts.fleaListingsStatusActive === 0 && counts.danwakuDeletionJobsTotal === 0,
    releaseCaution: "Recheck after both callable closures are deployed and in-flight requests finish; this is not a deployment or a deletion authorization.",
  }, null, 2));
}

if (require.main === module) main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
