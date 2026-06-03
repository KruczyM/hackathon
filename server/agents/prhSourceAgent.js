import { dateRangeForDays } from "../lib/dates.js";
import { describeFetchError } from "../lib/fetchErrors.js";
import { stableHash } from "../lib/hash.js";
import { expandMarketArea, marketAreaLabel } from "../lib/regions.js";
import { getDatabase } from "../lib/database.js";
import { ENDPOINT_SKIP_CACHE_MS } from "./companyCacheAgent.js";

const YTJ_BASE = "https://avoindata.prh.fi/opendata-ytj-api/v3";
const NOTICES_BASE = "https://avoindata.prh.fi/opendata-registerednotices-api/v3";
const XBRL_BASE = "https://avoindata.prh.fi/opendata-xbrl-api/v3";

function withTimeout(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { controller, clear: () => clearTimeout(timer) };
}

async function fetchJson(url, timeoutMs = 20000) {
  const timeout = withTimeout(timeoutMs);
  try {
    const response = await fetch(url, {
      signal: timeout.controller.signal,
      headers: {
        accept: "application/json",
        "user-agent": "NovapolisLeadRadar/1.0"
      }
    });
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    throw new Error(describeFetchError(error, url));
  } finally {
    timeout.clear();
  }
}

function buildUrl(base, path, params) {
  const url = new URL(`${base}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "" && value !== "ANY") {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

async function fetchPaged({ base, path, params, maxPages, pageSize }) {
  const first = await fetchJson(buildUrl(base, path, params));
  const items = first.companies ?? first.financials ?? [];
  const totalResults = first.totalResults ?? items.length;
  const totalPages = Math.min(maxPages, Math.max(1, Math.ceil(totalResults / pageSize)));

  for (let page = 2; page <= totalPages; page += 1) {
    const pageResult = await fetchJson(buildUrl(base, path, { ...params, page }));
    items.push(...(pageResult.companies ?? pageResult.financials ?? []));
  }

  return { totalResults, items, pagesFetched: totalPages };
}

function useOfficialSourceCache(options = {}) {
  return options.useCache !== false && options.useCache !== "false";
}

function shouldReadOfficialSourceCache(options = {}) {
  return useOfficialSourceCache(options) && options.refreshCache !== true && options.refreshCache !== "true";
}

function officialCacheKey({ options, range, cities, profile, maxPages }) {
  return stableHash({
    marketMode: profile.marketMode,
    region: options.region || "kuopio-hub",
    range,
    cities,
    companyForms: profile.companyForms,
    companyForm: options.companyForm || "ANY",
    maxPages
  });
}

function readOfficialMarketCache(cacheKey) {
  const row = getDatabase()
    .prepare("SELECT fetched_at AS fetchedAt, payload_json AS payloadJson FROM official_market_cache WHERE cache_key = ?")
    .get(cacheKey);
  if (!row) return null;
  const fetchedAtMs = Date.parse(row.fetchedAt || "");
  if (!Number.isFinite(fetchedAtMs)) return null;
  const ageMs = Date.now() - fetchedAtMs;
  if (ageMs > ENDPOINT_SKIP_CACHE_MS) return null;
  try {
    const payload = JSON.parse(row.payloadJson);
    return {
      ...payload,
      sourceCache: {
        status: "hit",
        fetchedAt: row.fetchedAt,
        ageMs
      },
      totals: {
        ...payload.totals,
        sourceCacheHit: true,
        sourceCacheAgeMs: ageMs
      }
    };
  } catch {
    return null;
  }
}

function saveOfficialMarketCache(cacheKey, result, options) {
  const now = new Date().toISOString();
  getDatabase()
    .prepare(`
      INSERT INTO official_market_cache (cache_key, fetched_at, market_mode, region, payload_json)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(cache_key) DO UPDATE SET
        fetched_at = excluded.fetched_at,
        market_mode = excluded.market_mode,
        region = excluded.region,
        payload_json = excluded.payload_json
    `)
    .run(
      cacheKey,
      now,
      result.totals.searchMode || options.marketMode || "",
      options.region || "kuopio-hub",
      JSON.stringify(result)
    );
}

function mergeCompanies(companies) {
  const map = new Map();
  for (const company of companies) {
    const businessId = company?.businessId?.value ?? company?.businessId;
    if (!businessId) continue;

    const existing = map.get(businessId);
    if (!existing) {
      map.set(businessId, company);
      continue;
    }

    const publicNotices = [
      ...(existing.publicNotices ?? []),
      ...(company.publicNotices ?? [])
    ];
    map.set(businessId, {
      ...existing,
      ...company,
      publicNotices: dedupeNotices(publicNotices)
    });
  }
  return [...map.values()];
}

function dedupeNotices(notices) {
  const seen = new Set();
  return notices.filter((notice) => {
    const key = `${notice.recordNumber}:${notice.registrationDate}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function splitCompanyForms(companyForm) {
  if (!companyForm || companyForm === "ANY") return [undefined];
  if (companyForm === "OY_PLUS") return ["OY", "OYJ"];
  return [companyForm];
}

function isEstablishedLikeMode(marketMode) {
  return ["established", "mid-market", "large-opportunities", "enterprise-watch"].includes(marketMode);
}

export function sourceProfileFor(options = {}) {
  const marketMode = options.marketMode || "new-changes";
  const companyForm = options.companyForm || "ANY";
  if (marketMode === "listed-growth") {
    return {
      marketMode,
      companyForms: ["OYJ"],
      companyDateFilter: false,
      noticeSearch: false,
      note: "Listed-growth mode searches existing Finnish OYJ companies without a registration-date filter."
    };
  }
  if (isEstablishedLikeMode(marketMode)) {
    return {
      marketMode,
      companyForms: companyForm === "ANY" ? ["OY", "OYJ"] : splitCompanyForms(companyForm),
      companyDateFilter: false,
      noticeSearch: true,
      note: "Size-segment mode searches existing limited companies without a registration-date filter, then uses sourced employee counts for segment filtering."
    };
  }
  return {
    marketMode: "new-changes",
    companyForms: splitCompanyForms(companyForm),
    companyDateFilter: true,
    noticeSearch: true,
    note: "New-and-changed mode searches recent registrations and recent registered notices."
  };
}

export async function fetchOfficialMarketData(options) {
  const days = options.days ?? 30;
  const range = options.range ?? dateRangeForDays(days);
  const cities = expandMarketArea(options.region || "kuopio-hub");
  const profile = sourceProfileFor(options);
  const forms = profile.companyForms;
  const searchLocations = profile.marketMode === "listed-growth" && options.region === "whole-finland"
    ? [undefined]
    : cities;
  const maxPages = options.maxPages ?? 2;
  const cacheKey = officialCacheKey({ options, range, cities, profile, maxPages });
  if (shouldReadOfficialSourceCache(options)) {
    const cached = readOfficialMarketCache(cacheKey);
    if (cached) return cached;
  }

  const companyRuns = [];
  const noticeRuns = [];
  const errors = [];

  for (const city of searchLocations) {
    const cityLabel = city || "Whole Finland";
    for (const form of forms) {
      try {
        const result = await fetchPaged({
          base: YTJ_BASE,
          path: "/companies",
          params: {
            location: city,
            companyForm: form,
            registrationDateStart: profile.companyDateFilter ? range.start : undefined,
            registrationDateEnd: profile.companyDateFilter ? range.end : undefined
          },
          maxPages,
          pageSize: 100
        });
        companyRuns.push({ city: cityLabel, companyForm: form || "ANY", ...result });
      } catch (error) {
        errors.push({ source: "PRH YTJ companies", city: cityLabel, message: error.message });
      }

      if (profile.noticeSearch) {
        try {
          const result = await fetchPaged({
            base: NOTICES_BASE,
            path: "/",
            params: {
              location: city,
              companyForm: form,
              noticeRegistrationDateStart: range.start,
              noticeRegistrationDateEnd: range.end
            },
            maxPages,
            pageSize: 50
          });
          noticeRuns.push({ city: cityLabel, companyForm: form || "ANY", ...result });
        } catch (error) {
          errors.push({ source: "PRH registered notices", city: cityLabel, message: error.message });
        }
      }
    }
  }

  const companies = mergeCompanies([
    ...companyRuns.flatMap((run) => run.items),
    ...noticeRuns.flatMap((run) => run.items)
  ]);

  const result = {
    range,
    marketArea: {
      label: marketAreaLabel(options.region || "kuopio-hub"),
      cities
    },
    companies,
    totals: {
      searchMode: profile.marketMode,
      sourceProfile: profile.note,
      effectiveCompanyForms: forms.map((form) => form || "ANY"),
      companySearchResults: companyRuns.reduce((sum, run) => sum + run.totalResults, 0),
      noticeSearchResults: noticeRuns.reduce((sum, run) => sum + run.totalResults, 0),
      listedCandidateSearchResults: profile.marketMode === "listed-growth" ? companyRuns.reduce((sum, run) => sum + run.totalResults, 0) : 0,
      companiesReturned: companies.length,
      pagesFetched:
        companyRuns.reduce((sum, run) => sum + run.pagesFetched, 0) +
        noticeRuns.reduce((sum, run) => sum + run.pagesFetched, 0)
    },
    errors,
    sources: [
      {
        name: "PRH Open Data: YTJ companies",
        url: "https://avoindata.prh.fi/en/ytj/swagger-ui",
        note: "Official Finnish Trade Register data, updated once per day by PRH."
      },
      {
        name: "PRH Open Data: registered notices",
        url: "https://avoindata.prh.fi/en/krek/swagger-ui",
        note: "Official registered company notices from 7 November 2014 onwards."
      },
      {
        name: "PRH Open Data: XBRL financial statements",
        url: "https://avoindata.prh.fi/en/xbrl/swagger-ui",
        note: "Official digital financial statements used to extract employee/personnel count facts when available."
      }
    ]
  };
  if (useOfficialSourceCache(options) && (companies.length > 0 || errors.length === 0)) {
    saveOfficialMarketCache(cacheKey, result, options);
  }
  return result;
}

export async function fetchFinancialPeriods(businessId) {
  return fetchJson(buildUrl(XBRL_BASE, "/financials", { businessId }));
}

export async function fetchFinancialStatementXml(businessId, financialDate) {
  const url = buildUrl(XBRL_BASE, "/financial", { businessId, financialDate });
  const timeout = withTimeout(20000);
  try {
    const response = await fetch(url, {
      signal: timeout.controller.signal,
      headers: {
        accept: "text/xml",
        "user-agent": "NovapolisLeadRadar/1.0"
      }
    });
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    return {
      url,
      xml: await response.text()
    };
  } catch (error) {
    throw new Error(describeFetchError(error, url));
  } finally {
    timeout.clear();
  }
}

export function prhCompanyUrl(businessId) {
  return buildUrl(YTJ_BASE, "/companies", { businessId });
}

export function prhNoticeUrl(businessId) {
  return `${NOTICES_BASE}/${encodeURIComponent(businessId)}`;
}
