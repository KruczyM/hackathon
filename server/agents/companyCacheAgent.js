import fs from "node:fs/promises";
import path from "node:path";

const CACHE_PATH = path.resolve("data/company-cache.json");
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const JOURNAL_DAYS = 30;

function businessId(company) {
  return company?.businessId?.value ?? company?.businessId ?? "";
}

function currentName(company) {
  return company.names?.find((name) => name.type === "1" && name.version === 1)?.name ?? company.names?.[0]?.name ?? company.name ?? "";
}

function normalizeCache(cache = {}) {
  return {
    version: 2,
    updatedAt: cache.updatedAt || "",
    companies: cache.companies && typeof cache.companies === "object" ? cache.companies : {},
    runs: Array.isArray(cache.runs) ? cache.runs.slice(-30) : [],
    dailyJournal: cache.dailyJournal && typeof cache.dailyJournal === "object" ? cache.dailyJournal : {}
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

function dateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function todayKey() {
  return dateKey();
}

function cacheDailyStatus(cache) {
  const today = todayKey();
  const journal = cache.dailyJournal?.[today];
  const updatedToday = Boolean(journal) || dateKey(cache.updatedAt) === today;
  return {
    today,
    updatedToday,
    journal: journal || null
  };
}

function pruneDailyJournal(dailyJournal) {
  return Object.fromEntries(
    Object.entries(dailyJournal || {})
      .sort(([left], [right]) => left.localeCompare(right))
      .slice(-JOURNAL_DAYS)
  );
}

function cleanEnrichmentForCache(enrichment) {
  const cleaned = { ...enrichment };
  delete cleaned.fromCache;
  delete cleaned.cacheFetchedAt;
  return cleaned;
}

export async function getCachedEnrichmentMap(companies, options = {}) {
  const ttlMs = Number.parseInt(options.ttlMs, 10) || DEFAULT_TTL_MS;
  const cacheOnly = options.cacheOnly === true || options.cacheOnly === "true";
  const cache = await readCache();
  const daily = cacheDailyStatus(cache);
  const map = new Map();
  const stale = [];
  const missing = [];

  for (const company of companies) {
    const id = businessId(company);
    const entry = cache.companies[id];
    if (entry?.enrichment && (cacheOnly || isFresh(entry, ttlMs))) {
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
    missingCompanies: cacheOnly ? [] : [...missing, ...stale],
    skippedCompanies: cacheOnly ? [...missing, ...stale] : [],
    stats: {
      status: "ok",
      checked: companies.length,
      hits: map.size,
      misses: missing.length,
      stale: stale.length,
      skippedMissing: cacheOnly ? missing.length : 0,
      skippedStale: cacheOnly ? stale.length : 0,
      cacheOnly,
      updatedToday: daily.updatedToday,
      journalDate: daily.today,
      ttlDays: Math.round(ttlMs / (24 * 60 * 60 * 1000))
    }
  };
}

export async function saveEnrichmentCache(companies, enrichmentMap, meta = {}) {
  const cache = await readCache();
  const now = new Date().toISOString();
  const key = dateKey(now);
  let saved = 0;

  for (const company of companies) {
    const id = businessId(company);
    const enrichment = enrichmentMap.get(id);
    if (!id || !enrichment) continue;
    if (enrichment.fromCache && meta.saveCachedEntries !== true) continue;
    const cacheEnrichment = cleanEnrichmentForCache(enrichment);
    cache.companies[id] = {
      businessId: id,
      companyName: currentName(company),
      fetchedAt: now,
      lastModified: company.lastModified || "",
      website: cacheEnrichment.companyWebsite || company.website?.url || "",
      employeeCount: cacheEnrichment.employeeCount || "",
      employeeCountSourceUrl: cacheEnrichment.employeeCountSourceUrl || "",
      contactSourceUrl: cacheEnrichment.contactSourceUrl || cacheEnrichment.sourceUrl || "",
      enrichment: cacheEnrichment
    };
    saved += 1;
  }

  if (!saved) {
    return { saved: 0, updatedAt: cache.updatedAt || "", totalCompaniesCached: Object.keys(cache.companies).length };
  }

  cache.updatedAt = now;
  cache.runs.push({
    at: now,
    saved,
    checked: companies.length,
    marketMode: meta.marketMode || "",
    region: meta.region || "",
    source: meta.source || "radar"
  });
  cache.runs = cache.runs.slice(-30);
  const journal = cache.dailyJournal[key] || {
    date: key,
    firstUpdatedAt: now,
    saved: 0,
    checked: 0,
    modes: [],
    regions: [],
    sources: []
  };
  journal.updatedAt = now;
  journal.saved += saved;
  journal.checked += companies.length;
  if (meta.marketMode && !journal.modes.includes(meta.marketMode)) journal.modes.push(meta.marketMode);
  if (meta.region && !journal.regions.includes(meta.region)) journal.regions.push(meta.region);
  const source = meta.source || "radar";
  if (!journal.sources.includes(source)) journal.sources.push(source);
  cache.dailyJournal[key] = journal;
  cache.dailyJournal = pruneDailyJournal(cache.dailyJournal);
  await writeCache(cache);
  return { saved, updatedAt: now, totalCompaniesCached: Object.keys(cache.companies).length };
}

export async function getCompanyCacheStatus() {
  const cache = await readCache();
  const daily = cacheDailyStatus(cache);
  return {
    updatedAt: cache.updatedAt || "",
    updatedToday: daily.updatedToday,
    today: daily.today,
    totalCompaniesCached: Object.keys(cache.companies).length,
    recentRuns: cache.runs.slice(-10).reverse(),
    dailyJournal: Object.values(cache.dailyJournal || {})
      .sort((left, right) => String(right.date).localeCompare(String(left.date)))
      .slice(0, 10)
  };
}

export async function resetCompanyCache() {
  await writeCache(normalizeCache());
}
