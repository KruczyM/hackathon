import { dateRangeForDays, parseDays } from "../lib/dates.js";
import { marketAreaLabel } from "../lib/regions.js";
import { fetchOfficialMarketData } from "./prhSourceAgent.js";
import { enrichCompanies } from "./enrichmentAgent.js";
import { buildLead } from "./scoringAgent.js";
import { applyMemory, filterLeadsWithUnseenSignals } from "./memoryAgent.js";
import { buildNewsletter } from "./newsletterAgent.js";
import { verifyLeadsWithClaude } from "./claudeVerifierAgent.js";
import { applyGrowthDetection } from "./companyGrowthAgent.js";
import { analyzeListedCompanyMomentum, LISTED_MARKET_SOURCES } from "./listedMarketAgent.js";
import { VIRRE_SOURCES } from "./virreAgent.js";
import { WEBSITE_DISCOVERY_SOURCE } from "./websiteDiscoveryAgent.js";
import { CURRENT_EMPLOYEE_SEARCH_SOURCE } from "./currentEmployeeSearchAgent.js";
import { getCachedEnrichmentMap, saveEnrichmentCache } from "./companyCacheAgent.js";

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
    stats: {
      checked: 0,
      matched: 0,
      historyFetched: 0,
      signals: 0,
      sustainedSignals: 0,
      jumpSignals: 0
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

function hasListedMarketSignal(lead) {
  return lead.signals.some((signal) => signal.type === "listed_market_sustained_growth" || signal.type === "listed_market_jump");
}

function isSizeSegmentMode(marketMode) {
  return ["established", "mid-market", "large-opportunities", "enterprise-watch"].includes(marketMode);
}

function isSizeSegmentLead(lead, context) {
  const count = Number.parseInt(lead.enrichment?.employeeCount, 10);
  if (!Number.isFinite(count) || count < context.minEmployees) return false;
  if (context.maxEmployees && count > context.maxEmployees) return false;
  return true;
}

function mergeEnrichmentMaps(...maps) {
  const merged = new Map();
  for (const map of maps) {
    for (const [id, value] of map) merged.set(id, value);
  }
  return merged;
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
  let enrichmentCandidates = preRankedCompanies.slice(0, context.enrichmentLimit);
  let leadCompanies = preRankedCompanies;

  if (context.marketMode === "listed-growth") {
    const listedCandidates = companiesFromLeads(official.companies, baseLeads);
    listedMarket = await analyzeListedCompanyMomentum(listedCandidates, { limit: context.listedLimit });
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
    ? await getCachedEnrichmentMap(enrichmentCandidates)
    : { map: new Map(), missingCompanies: enrichmentCandidates, stats: { status: "disabled", checked: enrichmentCandidates.length, hits: 0, misses: enrichmentCandidates.length, stale: 0, ttlDays: 0 } };

  const freshEnrichment = cached.missingCompanies.length
    ? await enrichCompanies(cached.missingCompanies, {
    publicWeb: context.publicWeb,
    websiteDiscovery: context.websiteDiscovery,
    websiteDiscoveryLimit: context.websiteDiscoveryLimit,
    virrePeople: context.virrePeople,
    virreLimit: context.virreLimit,
    currentEmployeeSearch: context.currentEmployeeSearch,
    currentEmployeeSearchLimit: context.currentEmployeeSearchLimit
      })
    : { map: new Map(), stats: emptyEnrichmentStats() };

  const enrichmentMap = mergeEnrichmentMaps(cached.map, freshEnrichment.map);
  const cacheWrite = await saveEnrichmentCache(enrichmentCandidates, enrichmentMap, {
    marketMode: context.marketMode,
    region: context.region,
    source: context.recordDisplay ? "radar" : "prefetch"
  });
  const enrichment = { map: enrichmentMap, stats: freshEnrichment.stats };
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
  const claudeVerified = await verifyLeadsWithClaude(growthDetected.leads, context);
  const remembered = await applyMemory(claudeVerified.leads, {
    visibility: context.visibility,
    recordDisplay: context.recordDisplay
  });
  const visibleLeads = remembered.visibleLeads;

  return {
    context,
    startedAt,
    finishedAt: new Date().toISOString(),
    totals: {
      ...official.totals,
      leads: visibleLeads.length,
      rawLeads: rawLeads.length,
      ...candidateFilter.stats,
      officialEmployeeCounts: enrichment.stats.financials.employeeCountsFound,
      currentEmployeeCounts: enrichment.stats.currentEmployeeSearch?.found || 0,
      currentEmployeeSearchChecked: enrichment.stats.currentEmployeeSearch?.checked || 0,
      currentEmployeeSearchUrlsChecked: enrichment.stats.currentEmployeeSearch?.urlsChecked || 0,
      cacheHits: cached.stats.hits,
      cacheMisses: cached.stats.misses,
      cacheStale: cached.stats.stale,
      cacheSaved: cacheWrite.saved,
      totalCompaniesCached: cacheWrite.totalCompaniesCached,
      websitesFound: enrichment.stats.publicWeb.websitesFound,
      websitesDiscovered: enrichment.stats.websiteDiscovery.verified,
      websiteDiscoveryCandidatesChecked: enrichment.stats.websiteDiscovery.candidatesChecked,
      publicWebContacts: enrichment.stats.publicWeb.contactsFound,
      virreCompaniesChecked: enrichment.stats.virre.checked,
      virreExtractsDownloaded: enrichment.stats.virre.extractsDownloaded,
      virreDecisionMakers: enrichment.stats.virre.peopleFound,
      virreOfficialPhones: enrichment.stats.virre.phonesFound,
      listedCompaniesChecked: listedMarket.stats.checked,
      listedCompaniesMatched: listedMarket.stats.matched,
      listedPriceHistories: listedMarket.stats.historyFetched,
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
      ...(context.publicListed ? LISTED_MARKET_SOURCES : [])
    ],
    pipeline: [
      { agent: "source-agent", status: "ok", detail: `${context.marketModeLabel}: ${official.totals.companiesReturned} official PRH records returned. ${official.totals.sourceProfile}` },
      { agent: "history-prefilter", status: context.visibility !== "new-signals" || isSizeSegmentMode(context.marketMode) ? "disabled" : "ok", detail: context.visibility === "include-seen" ? "Include already shown is enabled; no pre-filtering before enrichment." : isSizeSegmentMode(context.marketMode) ? "Size-segment mode needs employee counts before history filtering, so enrichment/cache runs on the pre-ranked candidate pool." : context.visibility === "never-displayed" ? "Never-displayed mode filters after company display memory is read." : `${candidateFilter.stats.skippedKnownLeadsBeforeEnrichment} already-known leads skipped before Virre, website discovery and market enrichment.` },
      { agent: "cache-agent", status: context.useCache ? "ok" : "disabled", detail: context.useCache ? `${cached.stats.hits} enrichment cache hits, ${cached.stats.misses} misses, ${cached.stats.stale} stale; ${cacheWrite.saved} company records saved/refreshed.` : "Company enrichment cache disabled for this run." },
      { agent: "financials-agent", status: enrichment.stats.financials.employeeCountsFound ? "ok" : "partial", detail: `${enrichment.stats.financials.employeeCountsFound} official employee counts found in PRH/XBRL financial statements.` },
      { agent: "current-employee-search-agent", status: context.currentEmployeeSearch ? enrichment.stats.currentEmployeeSearch.status : "disabled", detail: context.currentEmployeeSearch ? `${enrichment.stats.currentEmployeeSearch.found} current employee counts found from ${enrichment.stats.currentEmployeeSearch.urlsChecked} fetched company-owned search-result pages/PDFs.` : "Enable Agent employee search in the UI to run deep current-employee web search." },
      { agent: "virre-agent", status: context.virrePeople ? enrichment.stats.virre.status : "disabled", detail: context.virrePeople ? `${enrichment.stats.virre.peopleFound} official Virre board/CEO people from ${enrichment.stats.virre.extractsDownloaded} Trade Register extract PDFs.` : "Virre Trade Register extract scan disabled." },
      { agent: "website-discovery-agent", status: context.websiteDiscovery ? "ok" : "disabled", detail: context.websiteDiscovery ? `${enrichment.stats.websiteDiscovery.verified} websites verified from ${enrichment.stats.websiteDiscovery.candidatesChecked} guessed candidates.` : "Website discovery disabled." },
      { agent: "enrichment-agent", status: context.publicWeb ? "ok" : "disabled", detail: context.publicWeb ? "Verified company-owned websites scanned for contacts, people and employee-count evidence." : "Public website scan disabled." },
      { agent: "listed-market-agent", status: context.publicListed ? listedMarket.status : "disabled", detail: context.publicListed ? `${listedMarket.stats.matched} listed companies matched to Finnish shares; ${listedMarket.stats.signals} sourced price-momentum signals selected for this mode.` : "Listed-market scan disabled unless the Listed rapid growth mode is selected." },
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
      ...(listedMarket.errors ?? [])
    ],
    newsletter: buildNewsletter(visibleLeads, context, remembered.stats),
    leads: visibleLeads.slice(0, 80)
  };
}
