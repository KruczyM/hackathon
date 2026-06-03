import assert from "node:assert/strict";
import { after, test } from "node:test";
import fs from "node:fs/promises";
import path from "node:path";

const testDataRoot = path.join(process.cwd(), "data");
await fs.mkdir(testDataRoot, { recursive: true });
const dbDir = await fs.mkdtemp(path.join(testDataRoot, "novapolis-db-test-"));
process.env.NOVAPOLIS_DB_PATH = path.join(dbDir, "test.sqlite");

const { closeDatabase } = await import("../server/lib/database.js");
const { applyMemory, filterLeadsWithUnseenSignals, resetMemory } = await import("../server/agents/memoryAgent.js");
const {
  getCachedEnrichmentMap,
  getCompanyCacheStatus,
  resetCompanyCache,
  saveEnrichmentCache
} = await import("../server/agents/companyCacheAgent.js");
const { applyGrowthDetection, resetGrowthHistory } = await import("../server/agents/companyGrowthAgent.js");
const { fetchOfficialMarketData } = await import("../server/agents/prhSourceAgent.js");

after(async () => {
  closeDatabase();
  await fs.rm(dbDir, { recursive: true, force: true });
});

function lead(overrides = {}) {
  return {
    company: { businessId: "1234567-8", name: "Testi Oy" },
    score: 40,
    rawScore: 40,
    signals: [{
      id: "signal-1",
      businessId: "1234567-8",
      companyName: "Testi Oy",
      type: "registered_notice",
      label: "Important registered notice",
      title: "Testi Oy registered notice",
      detail: "Official registry update.",
      sourceName: "PRH Open Data",
      sourceUrl: "https://avoindata.prh.fi/",
      confidence: "official",
      weight: 18
    }],
    enrichment: {
      emails: [],
      phones: [],
      decisionMakers: [],
      employeeCount: "12",
      employeeCountSourceUrl: "https://example.test/employees"
    },
    scoreBreakdown: [],
    novapolisAngles: [],
    ...overrides
  };
}

function company() {
  return {
    businessId: { value: "1234567-8" },
    names: [{ type: "1", version: 1, name: "Testi Oy" }],
    website: { url: "https://testi.fi" },
    lastModified: "2026-06-01"
  };
}

test("memory persists seen signals and displayed companies in SQLite", async () => {
  await resetMemory();

  const firstFilter = await filterLeadsWithUnseenSignals([lead()]);
  assert.equal(firstFilter.stats.candidateLeadsWithNewSignals, 1);

  const remembered = await applyMemory([lead()], { visibility: "new-signals" });
  assert.equal(remembered.stats.newSignals, 1);
  assert.equal(remembered.stats.totalSeenSignals, 1);
  assert.equal(remembered.stats.totalDisplayedCompanies, 1);

  const secondFilter = await filterLeadsWithUnseenSignals([lead()]);
  assert.equal(secondFilter.stats.candidateLeadsWithNewSignals, 0);
  assert.equal(secondFilter.stats.knownCandidateSignals, 1);
});

test("company enrichment cache reads and writes SQLite rows", async () => {
  await resetCompanyCache();

  const enrichmentMap = new Map([[
    "1234567-8",
    {
      companyWebsite: "https://testi.fi",
      employeeCount: "12",
      employeeCountSourceUrl: "https://testi.fi/about",
      emails: ["info@testi.fi"]
    }
  ]]);

  const saved = await saveEnrichmentCache([company()], enrichmentMap, {
    marketMode: "new-changes",
    region: "kuopio-hub",
    source: "test"
  });
  assert.equal(saved.saved, 1);
  assert.equal(saved.totalCompaniesCached, 1);

  const cached = await getCachedEnrichmentMap([company()]);
  assert.equal(cached.stats.hits, 1);
  assert.equal(cached.map.get("1234567-8").fromCache, true);
  assert.deepEqual(cached.map.get("1234567-8").emails, ["info@testi.fi"]);

  const status = await getCompanyCacheStatus();
  assert.equal(status.totalCompaniesCached, 1);
  assert.equal(status.recentRuns[0].source, "test");
  assert.equal(status.dailyJournal[0].modes.includes("new-changes"), true);
});

test("official market data cache avoids repeated PRH/YTJ fetches for identical fresh queries", async () => {
  await resetCompanyCache();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return {
      ok: true,
      async json() {
        return {
          totalResults: 1,
          companies: [company()]
        };
      }
    };
  };

  try {
    const query = {
      marketMode: "listed-growth",
      region: "whole-finland",
      companyForm: "OYJ",
      days: 30,
      range: { start: "2026-05-04", end: "2026-06-03" },
      maxPages: 1,
      useCache: true
    };
    const first = await fetchOfficialMarketData(query);
    const second = await fetchOfficialMarketData(query);
    const refreshed = await fetchOfficialMarketData({ ...query, refreshCache: true });

    assert.equal(calls, 2);
    assert.equal(first.companies.length, 1);
    assert.equal(second.companies.length, 1);
    assert.equal(second.sourceCache.status, "hit");
    assert.equal(second.totals.sourceCacheHit, true);
    assert.equal(refreshed.sourceCache, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("growth snapshots use the previous SQLite row for jump detection", async () => {
  await resetGrowthHistory();

  const initial = await applyGrowthDetection([lead({ score: 20, rawScore: 20 })]);
  assert.equal(initial.stats.jumpSignals, 0);
  assert.equal(initial.leads[0].growth.status, "none");

  const changed = await applyGrowthDetection([lead({
    score: 60,
    rawScore: 60,
    signals: [
      ...lead().signals,
      { ...lead().signals[0], id: "signal-2", label: "Official update", weight: 10 }
    ]
  })]);
  assert.equal(changed.stats.jumpSignals, 1);
  assert.equal(changed.leads[0].growth.status, "growth_jump");
});
