import { dateRangeForDays, parseDays } from "../lib/dates.js";
import { marketAreaLabel } from "../lib/regions.js";
import { fetchOfficialMarketData } from "./prhSourceAgent.js";
import { enrichCompanies } from "./enrichmentAgent.js";
import { buildLead } from "./scoringAgent.js";
import { applyMemory, filterLeadsWithUnseenSignals } from "./memoryAgent.js";
import { buildNewsletter } from "./newsletterAgent.js";
import { verifyLeadsWithClaude } from "./claudeVerifierAgent.js";
import { applyGrowthDetection } from "./companyGrowthAgent.js";
import { analyzeListedCompanyMomentum, findListedCompanyEmployeeFallbacks, LISTED_MARKET_SOURCES } from "./listedMarketAgent.js";
import { VIRRE_SOURCES } from "./virreAgent.js";
import { WEBSITE_DISCOVERY_SOURCE } from "./websiteDiscoveryAgent.js";
import { CURRENT_EMPLOYEE_SEARCH_SOURCE } from "./currentEmployeeSearchAgent.js";
import { getCachedEnrichmentMap, getCompanyCacheStatus, saveEnrichmentCache } from "./companyCacheAgent.js";

const SEARCH_MODES = {
  "new-changes": {
    label: "New and changed companies",
    enrichmentLimit: 25,
    websiteDiscoveryLimit: 12,
    virreLimit: 12,
    listedLimit: 0,
    maxPages: 1
  },
  established: {
    label: "Medium and large companies",
    enrichmentLimit: 35,
    websiteDiscoveryLimit: 12,
    virreLimit: 12,
    listedLimit: 0,
    maxPages: 1,
    minEmployees: 51
  },
  "mid-market": {
    label: "Mid-market companies",
    enrichmentLimit: 45,
    websiteDiscoveryLimit: 14,
    virreLimit: 14,
    listedLimit: 0,
    maxPages: 1,
    minEmployees: 50,
    maxEmployees: 249
  },
  "large-opportunities": {
    label: "Large opportunities",
    enrichmentLimit: 45,
    websiteDiscoveryLimit: 14,
    virreLimit: 14,
    listedLimit: 0,
    maxPages: 1,
    minEmployees: 250,
    maxEmployees: 999
  },
  "enterprise-watch": {
    label: "Enterprise watch",
    enrichmentLimit: 45,
    websiteDiscoveryLimit: 12,
    virreLimit: 12,
    listedLimit: 0,
    maxPages: 1,
    minEmployees: 1000
  },
  "listed-growth": {
    label: "Listed rapid growth",
    enrichmentLimit: 25,
    websiteDiscoveryLimit: 10,
    virreLimit: 10,
    listedLimit: 400,
    maxPages: 3
  }
};

function normalizeMarketMode(value) {
  return SEARCH_MODES[value] ? value : "new-changes";
}

function normalizeOptions(query = {}) {
  const marketMode = normalizeMarketMode(query.marketMode);
  const modeDefaults = SEARCH_MODES[marketMode];
  const days = parseDays(query.days, 30);
  const claude = query.claude === true || query.claude === "true";
  const claudeLimit = Number.parseInt(query.claudeLimit, 10) || 5;
  return {
    marketMode,
    marketModeLabel: modeDefaults.label,
    region: query.region || "kuopio-hub",
    days,
    range: dateRangeForDays(days),
    focus: query.focus || "all",
    companyForm: marketMode === "listed-growth" ? "OYJ" : (query.companyForm || "ANY"),
    includeSeen: query.includeSeen === true || query.includeSeen === "true",
    visibility: normalizeVisibility(query.visibility, query.includeSeen),
    recordDisplay: query.recordDisplay !== false && query.recordDisplay !== "false",
    useCache: query.useCache !== false && query.useCache !== "false",
    refreshCache: query.refreshCache === true || query.refreshCache === "true",
    publicWeb: query.publicWeb !== false && query.publicWeb !== "false",
    websiteDiscovery: query.websiteDiscovery !== false && query.websiteDiscovery !== "false",
    websiteDiscoveryLimit: Number.parseInt(query.websiteDiscoveryLimit, 10) || modeDefaults.websiteDiscoveryLimit,
    claude,
    claudeLimit,
    claudeModel: query.claudeModel || process.env.CLAUDE_MODEL || "",
    virrePeople: query.virrePeople !== false && query.virrePeople !== "false",
    virreLimit: Number.parseInt(query.virreLimit, 10) || modeDefaults.virreLimit,
    currentEmployeeSearch: query.currentEmployeeSearch === true || query.currentEmployeeSearch === "true",
    currentEmployeeSearchLimit: Number.parseInt(query.currentEmployeeSearchLimit, 10) || Math.min(Math.max(claudeLimit, 1), 8),
    enrichmentLimit: Number.parseInt(query.enrichmentLimit, 10) || modeDefaults.enrichmentLimit,
    listedLimit: Number.parseInt(query.listedLimit, 10) || modeDefaults.listedLimit,
    publicListed: marketMode === "listed-growth",
    minEmployees: modeDefaults.minEmployees || 0,
    maxEmployees: modeDefaults.maxEmployees || 0,
    maxPages: Number.parseInt(query.maxPages, 10) || modeDefaults.maxPages
  };
}

function normalizeVisibility(value, includeSeen) {
  if (includeSeen === true || includeSeen === "true") return "include-seen";
  if (["new-signals", "never-displayed", "include-seen"].includes(value)) return value;
  return "new-signals";
}

function companyFromLead(companies, businessId) {
  return companies.find((company) => company.businessId?.value === businessId);
}

function businessId(company) {
  return company?.businessId?.value ?? "";
}

function disabledListedMarket() {
  return {
    map: new Map(),
    enrichmentMap: new Map(),
    stats: {
      checked: 0,
      matched: 0,
      historyFetched: 0,
      yahooProfilesFetched: 0,
      yahooEmployeeCounts: 0,
      signals: 0,
      sustainedSignals: 0,
      jumpSignals: 0
    },
    errors: [],
    status: "disabled"
  };
}

function disabledListedEmployeeFallback() {
  return {
    enrichmentMap: new Map(),
    stats: {
      checked: 0,
      matched: 0,
      searchFallbacks: 0,
      yahooProfilesFetched: 0,
      yahooEmployeeCounts: 0
    },
    errors: [],
    status: "disabled"
  };
}

function fullCandidateFilter(leads, label) {
  return {
    leads,
    stats: {
      candidateLeadsChecked: leads.length,
      candidateLeadsWithNewSignals: leads.length,
      skippedKnownLeadsBeforeEnrichment: 0,
      newCandidateSignals: 0,
      knownCandidateSignals: 0,
      candidateFilterMode: label
    }
  };
}

function emptyEnrichmentStats() {
  return {
    financials: {
      checked: 0,
      employeeCountsFound: 0,
      scaleProxiesFound: 0,
      employeeFallbacksUsed: 0,
      noDigitalFinancials: 0,
      noEmployeeFact: 0,
      errors: []
    },
    publicWeb: {
      websitesFound: 0,
      contactsFound: 0
    },
    websiteDiscovery: {
      checked: 0,
      verified: 0,
      conflicts: 0,
      notFound: 0,
      candidatesChecked: 0
    },
    virre: {
      status: "cached",
      checked: 0,
      extractsDownloaded: 0,
      peopleFound: 0,
      phonesFound: 0,
      websitesFound: 0,
      noPeopleFound: 0,
      errors: []
    },
    currentEmployeeSearch: {
      status: "cached",
      checked: 0,
      found: 0,
      urlsChecked: 0,
      noCompanyOwnedResults: 0,
      noEmployeeFact: 0,
      errors: []
    }
  };
}

function companiesFromLeads(companies, leads) {
  return leads
    .map((lead) => companyFromLead(companies, lead.company.businessId))
    .filter(Boolean);
}

function uniqueCompaniesByBusinessId(companies) {
  const seen = new Set();
  const uniqueCompanies = [];
  for (const company of companies) {
    const id = businessId(company);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    uniqueCompanies.push(company);
  }
  return uniqueCompanies;
}

function hasListedMarketSignal(lead) {
  return lead.signals.some((signal) => signal.type === "listed_market_sustained_growth" || signal.type === "listed_market_jump");
}

function isSizeSegmentMode(marketMode) {
  return ["established", "mid-market", "large-opportunities", "enterprise-watch"].includes(marketMode);
}

function isSizeSegmentLead(lead, context) {
  const count = Number.parseInt(lead.enrichment?.employeeCount, 10);
  if (Number.isFinite(count)) {
    if (count < context.minEmployees) return false;
    if (context.maxEmployees && count > context.maxEmployees) return false;
    return true;
  }
  return scaleProxyMatchesMode(lead.enrichment?.organizationScaleProxy, context.marketMode);
}

function scaleProxyMatchesMode(proxy, marketMode) {
  if (!proxy) return false;
  if (marketMode === "established") {
    return ["mid_market_proxy", "large_opportunity_proxy", "enterprise_watch_proxy"].includes(proxy);
  }
  if (marketMode === "mid-market") return proxy === "mid_market_proxy";
  if (marketMode === "large-opportunities") return proxy === "large_opportunity_proxy";
  if (marketMode === "enterprise-watch") return proxy === "enterprise_watch_proxy";
  return false;
}

function mergeEnrichmentMaps(...maps) {
  const merged = new Map();
  for (const map of maps) {
    for (const [id, value] of map) merged.set(id, value);
  }
  return merged;
}

function mergeFallbackEmployeeCounts(primaryMap, fallbackMap) {
  if (!fallbackMap?.size) return primaryMap;
  const merged = new Map(primaryMap);
  for (const [id, fallback] of fallbackMap) {
    if (!fallback?.employeeCount) continue;
    const current = merged.get(id) || {};
    if (current.employeeCount || current.currentEmployeeCount) continue;
    merged.set(id, {
      ...current,
      employeeCount: fallback.employeeCount,
      employeeCountSourceName: fallback.employeeCountSourceName,
      employeeCountSourceUrl: fallback.employeeCountSourceUrl,
      employeeCountEvidence: fallback.employeeCountEvidence,
      sourceName: current.sourceName || fallback.sourceName,
      sourceUrl: current.sourceUrl || fallback.sourceUrl,
      updatedAt: current.updatedAt || fallback.updatedAt,
      confidence: current.confidence && current.confidence !== "missing" ? current.confidence : fallback.confidence,
      verificationEvidence: [
        ...(current.verificationEvidence || []),
        ...(fallback.verificationEvidence || [])
      ].slice(0, 8),
      verifiedSources: [
        ...(current.verifiedSources || []),
        ...(fallback.verifiedSources || [])
      ].slice(0, 8)
    });
  }
  return merged;
}

function listedMarketFromCachedEnrichment(enrichmentMap) {
  const map = new Map();
  for (const [id, enrichment] of enrichmentMap) {
    const signals = Array.isArray(enrichment?.listedMarketSignals) ? enrichment.listedMarketSignals : [];
    if (signals.length) map.set(id, signals);
  }
  const signals = [...map.values()].flat();
  return {
    map,
    enrichmentMap: new Map(),
    stats: {
      checked: enrichmentMap.size,
      matched: map.size,
      historyFetched: 0,
      yahooProfilesFetched: 0,
      yahooEmployeeCounts: [...enrichmentMap.values()].filter((item) => {
        return /Yahoo Finance quoteSummary/i.test(item?.employeeCountSourceName || "");
      }).length,
      signals: signals.length,
      sustainedSignals: signals.filter((signal) => signal.type === "listed_market_sustained_growth").length,
      jumpSignals: signals.filter((signal) => signal.type === "listed_market_jump").length
    },
    errors: [],
    status: "cached"
  };
}

function attachListedMarketSignals(enrichmentMap, signalMap) {
  if (!signalMap?.size) return enrichmentMap;
  const merged = new Map(enrichmentMap);
  for (const [id, signals] of signalMap) {
    if (!signals?.length) continue;
    const current = merged.get(id) || {};
    merged.set(id, { ...current, listedMarketSignals: signals });
  }
  return merged;
}

function disabledCacheStats(checked) {
  return {
    status: "disabled",
    checked,
    hits: 0,
    misses: checked,
    stale: 0,
    skippedMissing: 0,
    skippedStale: 0,
    cacheOnly: false,
    freshForEndpointSkip: false,
    updatedToday: false,
    ttlDays: 0
  };
}

function cachePipelineDetail(context, cached, cacheWrite, cacheStatus) {
  if (!context.useCache) return "Company enrichment cache disabled for this run.";
  if (context.refreshCache) {
    return `${cached.stats.checked} companies forced through live refresh; ${cacheWrite.saved} company records saved/refreshed.`;
  }
  if (cached.stats.cacheOnly) {
    const skipped = (cached.stats.skippedMissing || 0) + (cached.stats.skippedStale || 0);
    const maxHours = cacheStatus.cacheMaxEndpointSkipHours || 12;
    return [
      `Cache is younger than ${maxHours}h; ${cached.stats.hits} company IDs served from SQLite.`,
      skipped ? `${skipped} companies were not enriched now because they are missing/stale in cache.` : "No live enrichment endpoints were needed.",
      "Turn off Use cached enrichment to force a live refresh."
    ].join(" ");
  }
  return `${cached.stats.hits} enrichment cache hits, ${cached.stats.misses} misses, ${cached.stats.stale} stale; ${cacheWrite.saved} company records saved/refreshed.`;
}

function summarizeEnrichmentMap(enrichmentMap) {
  const values = [...enrichmentMap.values()];
  return {
    officialEmployeeCounts: values.filter((item) => item?.employeeCount && /PRH XBRL/i.test(item.employeeCountSourceName || "")).length,
    financialScaleProxies: values.filter((item) => item?.organizationScaleProxy).length,
    currentEmployeeCounts: values.filter((item) => item?.currentEmployeeCount).length,
    websitesFound: values.filter((item) => item?.companyWebsite).length,
    publicWebContacts: values.reduce((sum, item) => {
      return sum + (item?.emails?.length || 0) + (item?.phones?.length || 0);
    }, 0),
    virreDecisionMakers: values.reduce((sum, item) => {
      return sum + (item?.decisionMakers || []).filter((person) => {
        if (typeof person !== "object") return false;
        return /Virre/i.test(`${person.sourceName || ""} ${person.sourceUrl || ""} ${person.evidence || ""}`);
      }).length;
    }, 0)
  };
}

export async function runRadar(query) {
  const context = normalizeOptions(query);
  const startedAt = new Date().toISOString();
  const official = await fetchOfficialMarketData(context);
  context.marketArea = official.marketArea || { label: marketAreaLabel(context.region), cities: [] };

  const baseLeads = official.companies
    .map((company) => buildLead(company, { range: context.range, focus: context.focus }))
    .sort((a, b) => b.score - a.score);
  let candidateFilter = context.visibility !== "new-signals" || isSizeSegmentMode(context.marketMode)
    ? fullCandidateFilter(baseLeads, isSizeSegmentMode(context.marketMode) ? "size-scan-before-history-filter" : context.visibility)
    : await filterLeadsWithUnseenSignals(baseLeads);
  let preRankedCompanies = companiesFromLeads(official.companies, candidateFilter.leads);
  let listedMarket = disabledListedMarket();
  let listedEmployeeFallback = disabledListedEmployeeFallback();
  let enrichmentCandidates = preRankedCompanies.slice(0, context.enrichmentLimit);
  let listedCacheCandidates = [];
  let leadCompanies = preRankedCompanies;
  const cacheStatus = context.useCache
    ? await getCompanyCacheStatus()
    : {
      updatedAt: "",
      updatedToday: false,
      freshForEndpointSkip: false,
      cacheMaxEndpointSkipHours: 12,
      today: "",
      totalCompaniesCached: 0
    };
  const useFreshCacheOnly = context.useCache && !context.refreshCache && cacheStatus.freshForEndpointSkip;
  const readCache = context.useCache && !context.refreshCache;

  if (context.marketMode === "listed-growth") {
    const listedCandidates = companiesFromLeads(official.companies, baseLeads);
    listedCacheCandidates = listedCandidates;
    if (readCache && useFreshCacheOnly) {
      const cachedListedMarket = await getCachedEnrichmentMap(listedCandidates, { cacheOnly: true });
      listedMarket = listedMarketFromCachedEnrichment(cachedListedMarket.map);
    } else {
      listedMarket = await analyzeListedCompanyMomentum(listedCandidates, { limit: context.listedLimit });
    }
    const listedLeads = listedCandidates
      .map((company) => buildLead(company, {
        range: context.range,
        focus: context.focus,
        marketSignals: listedMarket.map.get(businessId(company)) ?? []
      }))
      .filter(hasListedMarketSignal)
      .sort((a, b) => b.score - a.score);
    candidateFilter = context.visibility === "include-seen"
      ? fullCandidateFilter(listedLeads, "listed-growth-include-seen")
      : await filterLeadsWithUnseenSignals(listedLeads);
    preRankedCompanies = companiesFromLeads(official.companies, candidateFilter.leads);
    enrichmentCandidates = preRankedCompanies.slice(0, context.enrichmentLimit);
    leadCompanies = enrichmentCandidates;
  }

  const cached = context.useCache
    ? (readCache
      ? await getCachedEnrichmentMap(enrichmentCandidates, { cacheOnly: useFreshCacheOnly })
      : { map: new Map(), missingCompanies: enrichmentCandidates, skippedCompanies: [], stats: { ...disabledCacheStats(enrichmentCandidates.length), status: "refresh" } })
    : { map: new Map(), missingCompanies: enrichmentCandidates, skippedCompanies: [], stats: disabledCacheStats(enrichmentCandidates.length) };

  if (isSizeSegmentMode(context.marketMode) && (!readCache || !useFreshCacheOnly) && cached.missingCompanies.length) {
    listedEmployeeFallback = await findListedCompanyEmployeeFallbacks(cached.missingCompanies, {
      limit: context.enrichmentLimit
    });
  }

  const freshEnrichment = cached.missingCompanies.length
    ? await enrichCompanies(cached.missingCompanies, {
      publicWeb: context.publicWeb,
      websiteDiscovery: context.websiteDiscovery,
      websiteDiscoveryLimit: context.websiteDiscoveryLimit,
      virrePeople: context.virrePeople,
      virreLimit: context.virreLimit,
      currentEmployeeSearch: context.currentEmployeeSearch,
      currentEmployeeSearchLimit: context.currentEmployeeSearchLimit,
      employeeFallbackMap: listedEmployeeFallback.enrichmentMap
    })
    : { map: new Map(), stats: emptyEnrichmentStats() };

  const fallbackEnrichmentMap = mergeEnrichmentMaps(listedMarket.enrichmentMap, listedEmployeeFallback.enrichmentMap);
  const liveWriteBaseMap = attachListedMarketSignals(
    mergeEnrichmentMaps(freshEnrichment.map, fallbackEnrichmentMap),
    listedMarket.map
  );
  const enrichmentMap = mergeFallbackEmployeeCounts(
    attachListedMarketSignals(mergeEnrichmentMaps(cached.map, freshEnrichment.map), listedMarket.map),
    fallbackEnrichmentMap
  );
  const cacheWriteMap = mergeFallbackEmployeeCounts(
    liveWriteBaseMap,
    fallbackEnrichmentMap
  );
  const cacheWriteCompanies = uniqueCompaniesByBusinessId([
    ...cached.missingCompanies,
    ...listedCacheCandidates
  ]);
  const cacheWrite = await saveEnrichmentCache(cacheWriteCompanies, cacheWriteMap, {
    marketMode: context.marketMode,
    region: context.region,
    source: context.recordDisplay ? "radar" : "prefetch"
  });
  const enrichment = { map: enrichmentMap, stats: freshEnrichment.stats };
  const enrichmentTotals = summarizeEnrichmentMap(enrichmentMap);
  const listedMarketMap = listedMarket.map;

  const rawLeads = leadCompanies
    .map((company) => {
      const id = company.businessId?.value;
      return buildLead(company, {
        range: context.range,
        focus: context.focus,
        enrichment: enrichmentMap.get(id),
        marketSignals: listedMarketMap.get(id) ?? []
      });
    })
    .filter((lead) => {
      if (isSizeSegmentMode(context.marketMode)) return isSizeSegmentLead(lead, context);
      if (context.marketMode === "listed-growth") return hasListedMarketSignal(lead);
      return lead.signals.length > 0;
    })
    .sort((a, b) => b.score - a.score);

  const growthDetected = await applyGrowthDetection(rawLeads);
  const remembered = await applyMemory(growthDetected.leads, {
    visibility: context.visibility,
    recordDisplay: context.recordDisplay
  });
  const claudeVerified = await verifyLeadsWithClaude(remembered.visibleLeads, context);
  const visibleLeads = claudeVerified.leads;

  return {
    context,
    startedAt,
    finishedAt: new Date().toISOString(),
    totals: {
      ...official.totals,
      leads: visibleLeads.length,
      rawLeads: rawLeads.length,
      ...candidateFilter.stats,
      officialEmployeeCounts: Math.max(enrichment.stats.financials.employeeCountsFound, enrichmentTotals.officialEmployeeCounts),
      financialScaleProxies: Math.max(enrichment.stats.financials.scaleProxiesFound || 0, enrichmentTotals.financialScaleProxies),
      currentEmployeeCounts: Math.max(enrichment.stats.currentEmployeeSearch?.found || 0, enrichmentTotals.currentEmployeeCounts),
      currentEmployeeSearchChecked: enrichment.stats.currentEmployeeSearch?.checked || 0,
      currentEmployeeSearchUrlsChecked: enrichment.stats.currentEmployeeSearch?.urlsChecked || 0,
      cacheHits: cached.stats.hits,
      cacheMisses: cached.stats.misses,
      cacheStale: cached.stats.stale,
      cacheOnly: cached.stats.cacheOnly,
      cacheSkippedMissing: cached.stats.skippedMissing || 0,
      cacheSkippedStale: cached.stats.skippedStale || 0,
      cacheUpdatedToday: cacheStatus.updatedToday,
      cacheFreshForEndpointSkip: cacheStatus.freshForEndpointSkip,
      cacheAgeMs: cacheStatus.cacheAgeMs ?? null,
      cacheSaved: cacheWrite.saved,
      totalCompaniesCached: cacheWrite.totalCompaniesCached || cacheStatus.totalCompaniesCached || 0,
      websitesFound: Math.max(enrichment.stats.publicWeb.websitesFound, enrichmentTotals.websitesFound),
      websitesDiscovered: enrichment.stats.websiteDiscovery.verified,
      websiteDiscoveryCandidatesChecked: enrichment.stats.websiteDiscovery.candidatesChecked,
      publicWebContacts: Math.max(enrichment.stats.publicWeb.contactsFound, enrichmentTotals.publicWebContacts),
      virreCompaniesChecked: enrichment.stats.virre.checked,
      virreExtractsDownloaded: enrichment.stats.virre.extractsDownloaded,
      virreDecisionMakers: Math.max(enrichment.stats.virre.peopleFound, enrichmentTotals.virreDecisionMakers),
      virreOfficialPhones: enrichment.stats.virre.phonesFound,
      listedCompaniesChecked: listedMarket.stats.checked,
      listedCompaniesMatched: listedMarket.stats.matched,
      listedPriceHistories: listedMarket.stats.historyFetched,
      listedYahooProfiles: (listedMarket.stats.yahooProfilesFetched || 0) + (listedEmployeeFallback.stats.yahooProfilesFetched || 0),
      listedYahooEmployeeCounts: (listedMarket.stats.yahooEmployeeCounts || 0) + (listedEmployeeFallback.stats.yahooEmployeeCounts || 0),
      listedYahooEmployeeFallbacksChecked: listedEmployeeFallback.stats.checked || 0,
      listedGrowthSignals: listedMarket.stats.signals,
      listedSustainedSignals: listedMarket.stats.sustainedSignals,
      listedJumpSignals: listedMarket.stats.jumpSignals,
      ...growthDetected.stats,
      ...remembered.stats,
      knownSignals: remembered.stats.knownSignals + candidateFilter.stats.knownCandidateSignals
    },
    sources: [
      ...official.sources,
      WEBSITE_DISCOVERY_SOURCE,
      ...(context.currentEmployeeSearch ? [CURRENT_EMPLOYEE_SEARCH_SOURCE] : []),
      ...VIRRE_SOURCES,
      ...(context.publicListed || isSizeSegmentMode(context.marketMode) ? LISTED_MARKET_SOURCES : [])
    ],
    pipeline: [
      { agent: "source-agent", status: "ok", detail: `${context.marketModeLabel}: ${official.totals.companiesReturned} official PRH records returned. ${official.totals.sourceProfile}${official.sourceCache?.status === "hit" ? " Source snapshot served from SQLite cache." : ""}` },
      { agent: "history-prefilter", status: context.visibility !== "new-signals" || isSizeSegmentMode(context.marketMode) ? "disabled" : "ok", detail: context.visibility === "include-seen" ? "Include already shown is enabled; no pre-filtering before enrichment." : isSizeSegmentMode(context.marketMode) ? "Size-segment mode needs employee count or financial scale evidence before history filtering, so enrichment/cache runs on the pre-ranked candidate pool." : context.visibility === "never-displayed" ? "Never-displayed mode filters after company display memory is read." : `${candidateFilter.stats.skippedKnownLeadsBeforeEnrichment} already-known leads skipped before Virre, website discovery and market enrichment.` },
      { agent: "cache-agent", status: context.useCache ? "ok" : "disabled", detail: cachePipelineDetail(context, cached, cacheWrite, cacheStatus) },
      { agent: "financials-agent", status: enrichment.stats.financials.employeeCountsFound || enrichment.stats.financials.scaleProxiesFound ? "ok" : "partial", detail: `${enrichment.stats.financials.employeeCountsFound} official employee counts and ${enrichment.stats.financials.scaleProxiesFound || 0} financial scale proxies found in PRH/XBRL financial statements.` },
      { agent: "current-employee-search-agent", status: context.currentEmployeeSearch ? enrichment.stats.currentEmployeeSearch.status : "disabled", detail: context.currentEmployeeSearch ? `${enrichment.stats.currentEmployeeSearch.found} current employee counts found from ${enrichment.stats.currentEmployeeSearch.urlsChecked} fetched company-owned search-result pages/PDFs.` : "Enable Agent employee search in the UI to run deep current-employee web search." },
      { agent: "virre-agent", status: context.virrePeople ? enrichment.stats.virre.status : "disabled", detail: context.virrePeople ? `${enrichment.stats.virre.peopleFound} official Virre board/CEO people from ${enrichment.stats.virre.extractsDownloaded} Trade Register extract PDFs.` : "Virre Trade Register extract scan disabled." },
      { agent: "website-discovery-agent", status: context.websiteDiscovery ? "ok" : "disabled", detail: context.websiteDiscovery ? `${enrichment.stats.websiteDiscovery.verified} websites verified from ${enrichment.stats.websiteDiscovery.candidatesChecked} guessed candidates.` : "Website discovery disabled." },
      { agent: "enrichment-agent", status: context.publicWeb ? "ok" : "disabled", detail: context.publicWeb ? "Verified company-owned websites scanned for contacts, people and employee-count evidence." : "Public website scan disabled." },
      { agent: "listed-market-agent", status: context.publicListed ? listedMarket.status : "disabled", detail: context.publicListed ? `${listedMarket.stats.matched} listed companies matched to Finnish shares; ${listedMarket.stats.signals} sourced price-momentum signals selected for this mode; ${listedMarket.stats.yahooEmployeeCounts || 0} Yahoo Finance employee-count fallbacks found.` : "Listed-market scan disabled unless the Listed rapid growth mode is selected." },
      { agent: "listed-employee-fallback-agent", status: listedEmployeeFallback.status, detail: isSizeSegmentMode(context.marketMode) ? (useFreshCacheOnly ? "Fresh SQLite cache is active, so Nasdaq/Yahoo employee fallback endpoints were skipped." : `${listedEmployeeFallback.stats.checked} Oyj candidates checked against Nasdaq/Yahoo before slower enrichment; ${listedEmployeeFallback.stats.yahooEmployeeCounts} Yahoo Finance employee-count fallbacks found.`) : "Yahoo employee fallback for size modes runs only for medium/large/enterprise scans." },
      { agent: "growth-agent", status: "ok", detail: `${growthDetected.stats.jumpSignals} jump signals, ${growthDetected.stats.sustainedSignals} sustained-growth signals, ${growthDetected.stats.currentMomentumSignals} current-momentum signals.` },
      { agent: "claude-verifier", status: claudeVerified.meta.status, detail: claudeVerified.meta.message || (claudeVerified.meta.reviewedLeads ? `${claudeVerified.meta.reviewedLeads} top leads checked by Claude.` : "Claude verification not run.") },
      { agent: "memory-agent", status: "ok", detail: `${remembered.stats.newSignals} new signals, ${remembered.stats.knownSignals} already seen.` }
    ],
    claude: claudeVerified.meta,
    enrichment: enrichment.stats,
    errors: [
      ...official.errors,
      ...((enrichment.stats.virre.errors ?? []).map((message) => ({ source: "PRH Virre", city: "extract", message }))),
      ...((enrichment.stats.currentEmployeeSearch?.errors ?? []).map((message) => ({ source: "Current employee search", city: "web", message }))),
      ...(listedMarket.errors ?? []),
      ...(listedEmployeeFallback.errors ?? [])
    ],
    newsletter: buildNewsletter(visibleLeads, context, remembered.stats),
    leads: visibleLeads.slice(0, 80)
  };
}
