import {
  CACHE_UPDATED_AT_KEY,
  deleteMetadata,
  getDatabase,
  getMetadata,
  runInTransaction
} from "../lib/database.js";

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const ENDPOINT_SKIP_CACHE_MS = 12 * 60 * 60 * 1000;
const JOURNAL_DAYS = 30;

function businessId(company) {
  return company?.businessId?.value ?? company?.businessId ?? "";
}

function currentName(company) {
  return company.names?.find((name) => name.type === "1" && name.version === 1)?.name ?? company.names?.[0]?.name ?? company.name ?? "";
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

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function placeholders(values) {
  return values.map(() => "?").join(", ");
}

function countCompaniesCached() {
  return getDatabase().prepare("SELECT COUNT(*) AS count FROM company_enrichment_cache").get().count;
}

function cacheUpdatedAt() {
  const metadataValue = getMetadata(CACHE_UPDATED_AT_KEY);
  if (metadataValue) return metadataValue;
  return getDatabase().prepare("SELECT MAX(fetched_at) AS updatedAt FROM company_enrichment_cache").get().updatedAt || "";
}

function cacheAgeMs(updatedAt = cacheUpdatedAt()) {
  const parsed = Date.parse(updatedAt || "");
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Date.now() - parsed);
}

function dailyJournalValues(dates) {
  if (!dates.length) return {};
  const rows = getDatabase()
    .prepare(`
      SELECT date, kind, value
      FROM company_cache_daily_values
      WHERE date IN (${placeholders(dates)})
      ORDER BY kind, value
    `)
    .all(...dates);
  const grouped = Object.fromEntries(dates.map((date) => [date, { modes: [], regions: [], sources: [] }]));
  for (const row of rows) {
    const target = grouped[row.date];
    if (!target) continue;
    if (row.kind === "mode") target.modes.push(row.value);
    if (row.kind === "region") target.regions.push(row.value);
    if (row.kind === "source") target.sources.push(row.value);
  }
  return grouped;
}

function dailyJournalByDate(date) {
  const row = getDatabase()
    .prepare(`
      SELECT
        date,
        first_updated_at AS firstUpdatedAt,
        updated_at AS updatedAt,
        saved,
        checked
      FROM company_cache_daily_journal
      WHERE date = ?
    `)
    .get(date);
  if (!row) return null;
  const values = dailyJournalValues([date])[date] || { modes: [], regions: [], sources: [] };
  return { ...row, ...values };
}

function cacheDailyStatus() {
  const today = todayKey();
  const journal = dailyJournalByDate(today);
  const updatedToday = Boolean(journal) || dateKey(cacheUpdatedAt()) === today;
  return {
    today,
    updatedToday,
    journal: journal || null
  };
}

function cleanEnrichmentForCache(enrichment) {
  const cleaned = { ...enrichment };
  delete cleaned.fromCache;
  delete cleaned.cacheFetchedAt;
  return cleaned;
}

function loadCacheEntriesByIds(ids) {
  const uniqueIds = unique(ids);
  if (!uniqueIds.length) return {};
  const rows = getDatabase()
    .prepare(`
      SELECT
        business_id AS businessId,
        company_name AS companyName,
        fetched_at AS fetchedAt,
        last_modified AS lastModified,
        website,
        employee_count AS employeeCount,
        employee_count_source_url AS employeeCountSourceUrl,
        contact_source_url AS contactSourceUrl,
        enrichment_json AS enrichmentJson
      FROM company_enrichment_cache
      WHERE business_id IN (${placeholders(uniqueIds)})
    `)
    .all(...uniqueIds);

  return Object.fromEntries(
    rows.map((row) => {
      try {
        return [row.businessId, { ...row, enrichment: JSON.parse(row.enrichmentJson) }];
      } catch {
        return [row.businessId, { ...row, enrichment: null }];
      }
    })
  );
}

export async function getCachedEnrichmentMap(companies, options = {}) {
  const ttlMs = Number.parseInt(options.ttlMs, 10) || DEFAULT_TTL_MS;
  const cacheOnly = options.cacheOnly === true || options.cacheOnly === "true";
  const daily = cacheDailyStatus();
  const entries = loadCacheEntriesByIds(companies.map(businessId));
  const map = new Map();
  const stale = [];
  const missing = [];

  for (const company of companies) {
    const id = businessId(company);
    const entry = entries[id];
    const entryIsFresh = entry && isFresh(entry, cacheOnly ? ENDPOINT_SKIP_CACHE_MS : ttlMs);
    if (entry?.enrichment && entryIsFresh) {
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
      freshForEndpointSkip: cacheAgeMs() !== null && cacheAgeMs() <= ENDPOINT_SKIP_CACHE_MS,
      journalDate: daily.today,
      ttlDays: Math.round(ttlMs / (24 * 60 * 60 * 1000))
    }
  };
}

export async function saveEnrichmentCache(companies, enrichmentMap, meta = {}) {
  const now = new Date().toISOString();
  const key = dateKey(now);
  let saved = 0;

  runInTransaction((db) => {
    const upsertCache = db.prepare(`
      INSERT INTO company_enrichment_cache
        (
          business_id, company_name, fetched_at, last_modified, website, employee_count,
          employee_count_source_url, contact_source_url, enrichment_json
        )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(business_id) DO UPDATE SET
        company_name = excluded.company_name,
        fetched_at = excluded.fetched_at,
        last_modified = excluded.last_modified,
        website = excluded.website,
        employee_count = excluded.employee_count,
        employee_count_source_url = excluded.employee_count_source_url,
        contact_source_url = excluded.contact_source_url,
        enrichment_json = excluded.enrichment_json
    `);

    for (const company of companies) {
      const id = businessId(company);
      const enrichment = enrichmentMap.get(id);
      if (!id || !enrichment) continue;
      if (enrichment.fromCache && meta.saveCachedEntries !== true) continue;
      const cacheEnrichment = cleanEnrichmentForCache(enrichment);
      upsertCache.run(
        id,
        currentName(company),
        now,
        company.lastModified || "",
        cacheEnrichment.companyWebsite || company.website?.url || "",
        cacheEnrichment.employeeCount || "",
        cacheEnrichment.employeeCountSourceUrl || "",
        cacheEnrichment.contactSourceUrl || cacheEnrichment.sourceUrl || "",
        JSON.stringify(cacheEnrichment)
      );
      saved += 1;
    }

    if (!saved) return;

    db.prepare(`
      INSERT INTO app_metadata (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(CACHE_UPDATED_AT_KEY, now, now);

    db.prepare(`
      INSERT INTO company_cache_runs (at, saved, checked, market_mode, region, source)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(now, saved, companies.length, meta.marketMode || "", meta.region || "", meta.source || "radar");

    db.prepare(`
      INSERT INTO company_cache_daily_journal
        (date, first_updated_at, updated_at, saved, checked)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(date) DO UPDATE SET
        updated_at = excluded.updated_at,
        saved = company_cache_daily_journal.saved + excluded.saved,
        checked = company_cache_daily_journal.checked + excluded.checked
    `).run(key, now, now, saved, companies.length);

    const insertValue = db.prepare(`
      INSERT OR IGNORE INTO company_cache_daily_values (date, kind, value)
      VALUES (?, ?, ?)
    `);
    if (meta.marketMode) insertValue.run(key, "mode", meta.marketMode);
    if (meta.region) insertValue.run(key, "region", meta.region);
    insertValue.run(key, "source", meta.source || "radar");

    db.prepare(`
      DELETE FROM company_cache_daily_journal
      WHERE date NOT IN (
        SELECT date
        FROM company_cache_daily_journal
        ORDER BY date DESC
        LIMIT ?
      )
    `).run(JOURNAL_DAYS);
  });

  if (!saved) {
    return { saved: 0, updatedAt: cacheUpdatedAt(), totalCompaniesCached: countCompaniesCached() };
  }

  return { saved, updatedAt: now, totalCompaniesCached: countCompaniesCached() };
}

export async function getCompanyCacheStatus() {
  const db = getDatabase();
  const updatedAt = cacheUpdatedAt();
  const ageMs = cacheAgeMs(updatedAt);
  const daily = cacheDailyStatus();
  const journalRows = db.prepare(`
    SELECT
      date,
      first_updated_at AS firstUpdatedAt,
      updated_at AS updatedAt,
      saved,
      checked
    FROM company_cache_daily_journal
    ORDER BY date DESC
    LIMIT 10
  `).all();
  const values = dailyJournalValues(journalRows.map((row) => row.date));

  return {
    updatedAt,
    cacheAgeMs: ageMs,
    cacheMaxEndpointSkipHours: Math.round(ENDPOINT_SKIP_CACHE_MS / (60 * 60 * 1000)),
    freshForEndpointSkip: ageMs !== null && ageMs <= ENDPOINT_SKIP_CACHE_MS,
    updatedToday: daily.updatedToday,
    today: daily.today,
    totalCompaniesCached: countCompaniesCached(),
    recentRuns: db.prepare(`
      SELECT
        at,
        saved,
        checked,
        market_mode AS marketMode,
        region,
        source
      FROM company_cache_runs
      ORDER BY at DESC
      LIMIT 10
    `).all(),
    dailyJournal: journalRows.map((row) => ({ ...row, ...(values[row.date] || { modes: [], regions: [], sources: [] }) }))
  };
}

export async function resetCompanyCache() {
  runInTransaction((db) => {
    db.prepare("DELETE FROM company_enrichment_cache").run();
    db.prepare("DELETE FROM official_market_cache").run();
    db.prepare("DELETE FROM company_cache_runs").run();
    db.prepare("DELETE FROM company_cache_daily_values").run();
    db.prepare("DELETE FROM company_cache_daily_journal").run();
  });
  deleteMetadata(CACHE_UPDATED_AT_KEY);
}
