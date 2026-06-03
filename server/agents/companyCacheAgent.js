import fs from "node:fs/promises";
import path from "node:path";

const CACHE_PATH = path.resolve("data/company-cache.json");
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function businessId(company) {
  return company?.businessId?.value ?? company?.businessId ?? "";
}

function currentName(company) {
  return company.names?.find((name) => name.type === "1" && name.version === 1)?.name ?? company.names?.[0]?.name ?? company.name ?? "";
}

function normalizeCache(cache = {}) {
  return {
    version: 1,
    updatedAt: cache.updatedAt || "",
    companies: cache.companies && typeof cache.companies === "object" ? cache.companies : {},
    runs: Array.isArray(cache.runs) ? cache.runs.slice(-30) : []
  };
}

async function readCache() {
  try {
    const text = await fs.readFile(CACHE_PATH, "utf8");
    return normalizeCache(JSON.parse(text));
  } catch {
    return normalizeCache();
  }
}

async function writeCache(cache) {
  await fs.mkdir(path.dirname(CACHE_PATH), { recursive: true });
  await fs.writeFile(CACHE_PATH, `${JSON.stringify(normalizeCache(cache), null, 2)}\n`, "utf8");
}

function isFresh(entry, ttlMs) {
  const fetchedAt = Date.parse(entry?.fetchedAt || "");
  if (!Number.isFinite(fetchedAt)) return false;
  return Date.now() - fetchedAt <= ttlMs;
}

export async function getCachedEnrichmentMap(companies, options = {}) {
  const ttlMs = Number.parseInt(options.ttlMs, 10) || DEFAULT_TTL_MS;
  const cache = await readCache();
  const map = new Map();
  const stale = [];
  const missing = [];

  for (const company of companies) {
    const id = businessId(company);
    const entry = cache.companies[id];
    if (entry?.enrichment && isFresh(entry, ttlMs)) {
      map.set(id, {
        ...entry.enrichment,
        fromCache: true,
        cacheFetchedAt: entry.fetchedAt
      });
    } else if (entry) {
      stale.push(company);
    } else {
      missing.push(company);
    }
  }

  return {
    map,
    missingCompanies: [...missing, ...stale],
    stats: {
      status: "ok",
      checked: companies.length,
      hits: map.size,
      misses: missing.length,
      stale: stale.length,
      ttlDays: Math.round(ttlMs / (24 * 60 * 60 * 1000))
    }
  };
}

export async function saveEnrichmentCache(companies, enrichmentMap, meta = {}) {
  const cache = await readCache();
  const now = new Date().toISOString();
  let saved = 0;

  for (const company of companies) {
    const id = businessId(company);
    const enrichment = enrichmentMap.get(id);
    if (!id || !enrichment) continue;
    cache.companies[id] = {
      businessId: id,
      companyName: currentName(company),
      fetchedAt: now,
      lastModified: company.lastModified || "",
      website: enrichment.companyWebsite || company.website?.url || "",
      employeeCount: enrichment.employeeCount || "",
      employeeCountSourceUrl: enrichment.employeeCountSourceUrl || "",
      contactSourceUrl: enrichment.contactSourceUrl || enrichment.sourceUrl || "",
      enrichment
    };
    saved += 1;
  }

  cache.updatedAt = now;
  cache.runs.push({
    at: now,
    saved,
    marketMode: meta.marketMode || "",
    region: meta.region || "",
    source: meta.source || "radar"
  });
  cache.runs = cache.runs.slice(-30);
  await writeCache(cache);
  return { saved, updatedAt: now, totalCompaniesCached: Object.keys(cache.companies).length };
}

export async function getCompanyCacheStatus() {
  const cache = await readCache();
  return {
    updatedAt: cache.updatedAt || "",
    totalCompaniesCached: Object.keys(cache.companies).length,
    recentRuns: cache.runs.slice(-10).reverse()
  };
}

export async function resetCompanyCache() {
  await writeCache(normalizeCache());
}
