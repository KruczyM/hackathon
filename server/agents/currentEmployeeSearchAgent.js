import { PDFParse } from "pdf-parse";

const USER_AGENT = "NovapolisLeadRadar/1.0";
const SEARCH_BASE = "https://html.duckduckgo.com/html/";
const SOURCE_NAME = "Current employee web search agent";

const BLOCKED_HOSTS = [
  "asiakastieto.fi",
  "finder.fi",
  "kauppalehti.fi",
  "linkedin.com",
  "facebook.com",
  "instagram.com",
  "ytj.fi",
  "prh.fi"
];

const COMPANY_SUFFIXES = new Set([
  "ab",
  "abp",
  "corp",
  "corporation",
  "group",
  "holding",
  "holdings",
  "inc",
  "ltd",
  "oy",
  "oyj",
  "plc"
]);

const EMPLOYEE_HINT_PATHS = [
  "/en/careers",
  "/careers",
  "/tyopaikat",
  "/en/about-us/alma-in-brief",
  "/en/about-us",
  "/about-us",
  "/en/company",
  "/company",
  "/en/investors",
  "/en/news-and-releases",
  "/en/reports",
  "/en/annual-report",
  "/en/financial-reports",
  "/investors",
  "/reports",
  "/annual-report",
  "/financial-reports",
  "/about",
  "/about-us/company",
  "/yritys",
  "/meista",
  "/people",
  "/en/people",
  "/sustainability"
];

export const CURRENT_EMPLOYEE_SEARCH_SOURCE = {
  name: SOURCE_NAME,
  url: SEARCH_BASE,
  note: "Zero-key web search is used only as URL discovery for current employee-count pages; final employee facts must come from fetched company-owned pages or PDFs."
};

function currentName(company) {
  return company.names?.find((name) => name.type === "1" && name.version === 1)?.name ?? company.names?.[0]?.name ?? company.name ?? "Unknown company";
}

function businessId(company) {
  return company.businessId?.value ?? company.businessId ?? "";
}

function normalizeWebsite(url) {
  if (!url) return "";
  const trimmed = String(url).trim();
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function hostname(url) {
  try {
    return new URL(normalizeWebsite(url)).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function companyTokens(name) {
  return normalizeText(name)
    .split(/\s+/)
    .filter((token) => token.length >= 2 && !COMPANY_SUFFIXES.has(token));
}

function companyStem(name) {
  return companyTokens(name).join("");
}

function isBlockedHost(url) {
  const host = hostname(url);
  return BLOCKED_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
}

function isLikelyCompanyOwnedUrl(url, company, enrichment = {}) {
  if (!url || isBlockedHost(url)) return false;
  const host = hostname(url);
  if (!host) return false;
  const knownHosts = [
    enrichment.companyWebsite,
    enrichment.companyWebsiteSourceUrl,
    company.website?.url
  ].map(hostname).filter(Boolean);

  if (knownHosts.some((known) => host === known || host.endsWith(`.${known}`))) return true;

  const stem = companyStem(currentName(company));
  const hostStem = host.replace(/[^a-z0-9]/g, "");
  return Boolean(stem.length >= 5 && hostStem.includes(stem.slice(0, Math.min(12, stem.length))));
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h1|h2|h3|tr|td|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&auml;/g, "\u00e4")
    .replace(/&ouml;/g, "\u00f6")
    .replace(/&aring;/g, "\u00e5")
    .replace(/\s+/g, " ")
    .trim();
}

function snippet(text, index, radius = 170) {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + radius);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

function normalizeNumber(value) {
  const raw = String(value || "").trim();
  const digits = raw.replace(/[\s.,]/g, "");
  const parsed = Number.parseInt(digits, 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 500000) return null;
  return parsed;
}

function numberPattern() {
  return String.raw`(?<![\d.,])(\d{1,3}(?:[\s.,]\d{3})+|\d{1,6})(?![\d.,])`;
}

export function extractCurrentEmployeeCountFromText(text, sourceUrl = "") {
  const sourceText = String(text || "").replace(/\s+/g, " ");
  const n = numberPattern();
  const patterns = [
    new RegExp(String.raw`(?:personnel,\s*end of period|personnel at end of period|employees,\s*end of period|employees at end of period|total employees|employee count|number of employees)\D{0,80}${n}`, "gi"),
    new RegExp(String.raw`(?:employees|personnel|staff)(?:\s+(?:globally|worldwide|in\s+finland|in\s+suomi|at\s+year\s+end|at\s+end\s+of\s+year|on\s+average))?\D{0,80}${n}`, "gi"),
    new RegExp(String.raw`(?:henkil\u00f6st\u00f6,\s*kauden lopussa|henkilosto,\s*kauden lopussa|henkil\u00f6st\u00f6 kauden lopussa|henkilosto kauden lopussa|henkil\u00f6st\u00f6n\s+m\u00e4\u00e4r\u00e4|henkiloston\s+maara|henkil\u00f6st\u00f6m\u00e4\u00e4r\u00e4|henkilostomaara)\D{0,80}${n}`, "gi"),
    new RegExp(String.raw`(?:henkil\u00f6st\u00f6|henkilosto|henkil\u00f6kunta|henkilokunta|ty\u00f6ntekij\u00e4t|tyontekijat)(?:\s+(?:maailmanlaajuisesti|suomessa|kauden\s+lopussa))?\D{0,80}${n}`, "gi"),
    new RegExp(String.raw`(?:[a-z\u00e5\u00e4\u00f6]+laisia|henkil\u00f6it\u00e4|henkiloita|ty\u00f6ntekij\u00f6it\u00e4|tyontekijoita)\s+on\s+suomessa\D{0,40}${n}`, "gi"),
    new RegExp(String.raw`(?:employs|staff of|team of)\D{0,80}${n}`, "gi"),
    new RegExp(String.raw`${n}\s+(?:employees|people|professionals|experts|staff members)\b`, "gi"),
    new RegExp(String.raw`(?:ty\u00f6llist\u00e4\u00e4|tyollistaa)\D{0,80}${n}`, "gi"),
    new RegExp(String.raw`${n}\s+(?:ty\u00f6ntekij\u00e4\u00e4|tyontekijaa|ty\u00f6ntekij\u00f6it\u00e4|tyontekijoita|henkil\u00f6\u00e4|henkiloa|asiantuntijaa|ammattilaista)(?=\s|[.,;:)]|$)`, "gi")
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(sourceText))) {
      const rawNumber = match[1];
      const value = normalizeNumber(rawNumber);
      if (value === null) continue;
      const evidence = snippet(sourceText, match.index);
      if (isBadEmployeeEvidence(evidence, rawNumber, sourceUrl)) continue;
      return {
        employeeCount: String(value),
        sourceName: sourceUrl.toLowerCase().endsWith(".pdf") ? "Company-owned PDF" : "Company-owned web page",
        sourceUrl,
        evidence,
        confidence: "company-owned-current-employee-count"
      };
    }
  }

  return null;
}

function sourceYear(sourceUrl) {
  try {
    const path = new URL(sourceUrl).pathname;
    const match = path.match(/(?:^|\/)(20\d{2})(?:\/|[-_])/);
    return match ? Number.parseInt(match[1], 10) : null;
  } catch {
    return null;
  }
}

function isStaleSource(sourceUrl) {
  const year = sourceYear(sourceUrl);
  if (!year) return false;
  return year < new Date().getFullYear() - 2;
}

function isBadEmployeeEvidence(evidence, rawNumber, sourceUrl = "") {
  const text = normalizeText(evidence);
  const value = normalizeNumber(rawNumber);
  if (isStaleSource(sourceUrl) && /blog|news|release|press|tiedote|uutinen/.test(normalizeText(sourceUrl))) return true;
  if (/__typename|pagepath|contentfulmetadata|navtosubpages|disruptionnotice/.test(text)) return true;
  if (/seasonal employees|seasonal employee|kiiresesongin|kausity/.test(text)) return true;
  if (/hired|recruited|rekrytoi|palkkasi/.test(text) && /seasonal|kiiresesongin|kausi/.test(text)) return true;
  if (/personnel fund|henkilostorahast/.test(text)) return true;
  if (/employee engagement|henkiloston sitoutuneisuus|henkilostön sitoutuneisuus/.test(text) && value < 100) return true;
  if (/countries|operating countries|presence in|toimintamaata/.test(text) && value < 100) return true;
  if (/in 20\d{2} employees|vuonna 20\d{2} tyontekij/.test(text) && value >= 1900 && value <= new Date().getFullYear() + 1) return true;
  if (/eur|million|m eur|meur|dividend|revenue|liikevaihto|bonus/.test(text) && value < 100) return true;
  return false;
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'");
}

function decodeDuckDuckGoUrl(href) {
  const decoded = decodeHtml(href);
  try {
    const parsed = new URL(decoded, "https://duckduckgo.com");
    const uddg = parsed.searchParams.get("uddg");
    return uddg ? decodeURIComponent(uddg) : parsed.toString();
  } catch {
    return "";
  }
}

export function extractSearchResultUrls(html, limit = 8) {
  const urls = [];
  const patterns = [
    /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"/gi,
    /<a[^>]+href="([^"]+)"[^>]*class="[^"]*result__a[^"]*"/gi
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html))) {
      const url = decodeDuckDuckGoUrl(match[1]);
      if (url && /^https?:\/\//i.test(url) && !urls.includes(url)) urls.push(url);
      if (urls.length >= limit) return urls;
    }
  }
  return urls;
}

function searchQueries(company, enrichment = {}) {
  const name = currentName(company);
  const host = hostname(enrichment.companyWebsite || company.website?.url);
  return [
    host ? `site:${host} "${name}" "Personnel, end of period"` : "",
    host ? `site:${host} "${name}" "financial statements"` : "",
    host ? `site:${host} "${name}" "annual report"` : "",
    host ? `site:${host} "${name}" employees` : "",
    host ? `site:${host} "${name}" ty\u00f6ntekij\u00e4t` : "",
    host ? `site:${host} "${name}" henkil\u00f6st\u00f6` : "",
    `"${name}" "Personnel, end of period"`,
    `"${name}" "financial statements" employees`,
    `"${name}" ty\u00f6ntekij\u00e4t`,
    `"${name}" henkil\u00f6st\u00f6`,
    `"${name}" employees`
  ].filter(Boolean);
}

function financialReportPaths() {
  const currentYear = new Date().getFullYear();
  const years = [currentYear - 1, currentYear - 2, currentYear - 3];
  const templates = [
    (year) => `/en/news-and-releases/financial_statements_bulletin_${year}`,
    (year) => `/en/news-and-releases/financial-statements-bulletin-${year}`,
    (year) => `/en/financial_statements_bulletin_${year}`,
    (year) => `/en/financial-statements-bulletin-${year}`,
    (year) => `/financial_statements_bulletin_${year}`,
    (year) => `/financial-statements-bulletin-${year}`
  ];
  const paths = [];

  for (const template of templates) {
    for (const year of years) paths.push(template(year));
  }

  return paths;
}

function knownWebsiteEmployeeUrls(company, enrichment = {}) {
  const urls = new Set();
  const roots = [
    enrichment.companyWebsite,
    company.website?.url
  ].map(normalizeWebsite).filter(Boolean);

  for (const root of roots) {
    try {
      const parsed = new URL(root);
      urls.add(parsed.origin);
      for (const path of EMPLOYEE_HINT_PATHS.slice(0, 8)) urls.add(`${parsed.origin}${path}`);
      for (const path of financialReportPaths()) urls.add(`${parsed.origin}${path}`);
      for (const path of EMPLOYEE_HINT_PATHS.slice(8)) urls.add(`${parsed.origin}${path}`);
    } catch {
      // Ignore malformed official website candidates.
    }
  }
  return [...urls];
}

function mergeUrlLists(...lists) {
  const urls = [];
  for (const list of lists) {
    for (const url of list) {
      if (url && !urls.includes(url)) urls.push(url);
    }
  }
  return urls;
}

async function fetchSearchUrls(query, limit) {
  const url = new URL(SEARCH_BASE);
  url.searchParams.set("q", query);
  url.searchParams.set("kl", "fi-fi");
  const response = await fetch(url, {
    headers: {
      accept: "text/html",
      "user-agent": USER_AGENT
    }
  });
  if (!response.ok) throw new Error(`search ${response.status}`);
  return extractSearchResultUrls(await response.text(), limit);
}

async function parsePdf(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.text || "";
  } finally {
    await parser.destroy();
  }
}

async function fetchSourceText(url, timeoutMs = 7000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: "text/html,text/plain,application/pdf",
        "user-agent": USER_AGENT
      }
    });
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") || "";
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > 4_000_000) return null;
    if (/pdf/i.test(contentType) || /\.pdf(?:$|[?#])/i.test(response.url || url)) {
      return { url: response.url || url, text: await parsePdf(buffer) };
    }
    if (/text|html|xhtml/i.test(contentType)) {
      return { url: response.url || url, text: stripHtml(buffer.toString("utf8").slice(0, 260000)) };
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function employeeEnrichment(fact) {
  return {
    currentEmployeeCount: fact.employeeCount,
    currentEmployeeCountSourceName: fact.sourceName,
    currentEmployeeCountSourceUrl: fact.sourceUrl,
    currentEmployeeCountEvidence: fact.evidence,
    employeeCount: fact.employeeCount,
    employeeCountSourceName: fact.sourceName,
    employeeCountSourceUrl: fact.sourceUrl,
    employeeCountEvidence: fact.evidence,
    sourceName: fact.sourceName,
    sourceUrl: fact.sourceUrl,
    updatedAt: new Date().toISOString(),
    confidence: fact.confidence,
    verificationStatus: "company-owned-current-employee-count",
    verificationEvidence: [fact.evidence],
    verifiedSources: [{
      url: fact.sourceUrl,
      provider: SOURCE_NAME,
      sourceKind: "company-owned-current-employee-count",
      verificationScore: 80,
      verificationEvidence: [fact.evidence]
    }]
  };
}

export async function findCurrentEmployeeCount(company, enrichment = {}, options = {}) {
  const maxSearchResults = Number.parseInt(options.maxSearchResults, 10) || 6;
  const maxPages = Number.parseInt(options.maxPages, 10) || 6;
  const queries = searchQueries(company, enrichment);
  const knownUrls = knownWebsiteEmployeeUrls(company, enrichment).filter((url) => isLikelyCompanyOwnedUrl(url, company, enrichment));
  const searchUrls = [];

  for (const query of queries.slice(0, 5)) {
    try {
      const results = await fetchSearchUrls(query, maxSearchResults);
      for (const resultUrl of results) {
        if (!searchUrls.includes(resultUrl) && isLikelyCompanyOwnedUrl(resultUrl, company, enrichment)) searchUrls.push(resultUrl);
      }
    } catch {
      // Search is a best-effort discovery hint; failure should not block the pipeline.
    }
  }

  const urls = mergeUrlLists(searchUrls, knownUrls);
  let urlsChecked = 0;

  for (const url of urls.slice(0, maxPages)) {
    urlsChecked += 1;
    const page = await fetchSourceText(url);
    if (!page?.text) continue;
    const fact = extractCurrentEmployeeCountFromText(page.text, page.url);
    if (fact) return { enrichment: employeeEnrichment(fact), stats: { status: "ok", urlsChecked, candidateUrls: urls.length } };
  }

  return { enrichment: null, stats: { status: urls.length ? "no_employee_fact" : "no_company_owned_results", urlsChecked, candidateUrls: urls.length } };
}

export async function findCurrentEmployeeCountsForCompanies(companies, enrichmentMap = new Map(), options = {}) {
  const limit = Math.min(Number.parseInt(options.limit, 10) || 5, companies.length);
  const map = new Map();
  const stats = {
    status: "disabled",
    checked: 0,
    found: 0,
    urlsChecked: 0,
    noCompanyOwnedResults: 0,
    noEmployeeFact: 0,
    errors: []
  };

  if (options.enabled === false || limit <= 0) return { map, stats };

  stats.status = "ok";
  for (const company of companies.slice(0, limit)) {
    const id = businessId(company);
    if (!id) continue;
    stats.checked += 1;
    try {
      const result = await findCurrentEmployeeCount(company, enrichmentMap.get(id) || {}, options);
      stats.urlsChecked += result.stats.urlsChecked || 0;
      if (result.enrichment) {
        map.set(id, result.enrichment);
        stats.found += 1;
      } else if (result.stats.status === "no_company_owned_results") {
        stats.noCompanyOwnedResults += 1;
      } else if (result.stats.status === "no_employee_fact") {
        stats.noEmployeeFact += 1;
      }
    } catch (error) {
      stats.errors.push(`${id}: ${error.message}`);
    }
  }

  stats.status = stats.errors.length && stats.found === 0 ? "partial" : "ok";
  return { map, stats };
}
