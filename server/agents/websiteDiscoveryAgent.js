const USER_AGENT = "NovapolisLeadRadar/1.0";
const WEBSITE_SOURCE_NAME = "Website discovery agent";

const VERIFY_PATHS = [
  "/",
  "/contact",
  "/yhteystiedot",
  "/about",
  "/yritys",
  "/company"
];

const PRIMARY_DOMAIN_TLDS = ["fi", "com"];
const SECONDARY_DOMAIN_TLDS = ["net", "eu"];

const COMPANY_WORD_STOPWORDS = new Set([
  "ab",
  "abp",
  "and",
  "company",
  "corp",
  "corporation",
  "group",
  "holding",
  "holdings",
  "inc",
  "limited",
  "ltd",
  "oy",
  "oyj",
  "plc",
  "se"
]);

const OPTIONAL_DOMAIN_WORDS = new Set([
  "operations",
  "services",
  "service",
  "solutions",
  "solution",
  "finland",
  "suomi",
  "group"
]);

const DIRECTORY_HOSTS = [
  "asiakastieto.fi",
  "finder.fi",
  "kauppalehti.fi",
  "linkedin.com",
  "facebook.com",
  "instagram.com",
  "ytj.fi",
  "prh.fi"
];

export const WEBSITE_DISCOVERY_SOURCE = {
  name: WEBSITE_SOURCE_NAME,
  url: "https://www.iana.org/domains/root/db",
  note: "Zero-key website discovery guesses likely company domains and accepts a website only after fetched page evidence matches the company."
};

function currentName(company) {
  return company.names?.find((name) => name.type === "1" && name.version === 1)?.name ?? company.names?.[0]?.name ?? company.name ?? "Unknown company";
}

function businessId(company) {
  return company.businessId?.value ?? company.businessId ?? "";
}

function auxiliaryNames(company) {
  return (company.names ?? [])
    .filter((name) => name.type === "3" && name.name)
    .map((name) => name.name);
}

function address(company) {
  const selected = company.addresses?.find((item) => item.type === 1) ?? company.addresses?.[0];
  if (!selected) return "";
  const city = selected.postOffices?.find((office) => office.languageCode === "1")?.city ?? selected.postOffices?.[0]?.city ?? "";
  return [selected.street, selected.buildingNumber, selected.postCode, city].filter(Boolean).join(" ");
}

function city(company) {
  const selected = company.addresses?.find((item) => item.type === 1) ?? company.addresses?.[0];
  return selected?.postOffices?.find((office) => office.languageCode === "1")?.city ?? selected?.postOffices?.[0]?.city ?? "";
}

function normalizeWebsite(url) {
  if (!url) return "";
  const trimmed = String(url).trim();
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
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
    .replace(/\s+/g, " ")
    .trim();
}

function withoutDiacritics(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/å/g, "a")
    .replace(/Ä/g, "A")
    .replace(/Ö/g, "O")
    .replace(/Å/g, "A");
}

function normalizeText(value) {
  return withoutDiacritics(value)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function nameTokens(name) {
  return normalizeText(name)
    .split(/\s+/)
    .filter((token) => token && !COMPANY_WORD_STOPWORDS.has(token));
}

function domainStemFromName(name) {
  return nameTokens(name).join("");
}

function domainStemFromHost(host) {
  const labels = String(host || "")
    .toLowerCase()
    .replace(/^www\./, "")
    .split(".")
    .filter(Boolean);
  if (labels.length === 0) return "";
  return labels.length >= 2 ? labels[labels.length - 2] : labels[0];
}

function stemsForName(name) {
  const tokens = nameTokens(name);
  const stems = new Set();
  if (tokens.length === 0) return [];

  stems.add(tokens.join(""));
  if (tokens.length >= 2) stems.add(tokens.slice(0, 2).join(""));
  if (tokens.length >= 3) stems.add(tokens.slice(0, -1).join(""));
  stems.add(tokens.filter((token) => !OPTIONAL_DOMAIN_WORDS.has(token)).join(""));
  for (const token of tokens) {
    if (token.length >= 5 && !OPTIONAL_DOMAIN_WORDS.has(token)) stems.add(token);
  }

  return [...stems].filter((stem) => stem.length >= 4 && stem.length <= 48);
}

function candidateRootUrlsFromStem(stem, tlds) {
  const urls = [];
  for (const tld of tlds) {
    urls.push(`https://www.${stem}.${tld}`);
    urls.push(`https://${stem}.${tld}`);
  }
  return urls;
}

export function generateWebsiteCandidates(input, limit = 24) {
  const known = normalizeWebsite(input.knownWebsiteFromPrh || input.knownWebsite);
  if (known) return [known];

  const stems = new Set();
  for (const name of [input.companyName, ...(input.auxiliaryNames ?? [])].filter(Boolean)) {
    for (const stem of stemsForName(name)) stems.add(stem);
  }

  const urls = [];
  for (const tlds of [PRIMARY_DOMAIN_TLDS, SECONDARY_DOMAIN_TLDS]) {
    for (const stem of stems) {
      for (const url of candidateRootUrlsFromStem(stem, tlds)) {
        if (!urls.includes(url)) urls.push(url);
        if (urls.length >= limit) return urls;
      }
    }
  }
  return urls;
}

export function generateSearchQueries(input, limit = 10) {
  const queries = [
    input.companyName && input.businessId ? `"${input.companyName}" "${input.businessId}"` : "",
    input.companyName ? `"${input.companyName}" Y-tunnus` : "",
    input.companyName ? `"${input.companyName}" official website` : "",
    input.companyName ? `"${input.companyName}" yhteystiedot` : "",
    input.companyName && input.city ? `"${input.companyName}" "${input.city}"` : "",
    input.businessId ? `"${input.businessId}"` : "",
    ...(input.auxiliaryNames ?? []).flatMap((name) => [
      input.businessId ? `"${name}" "${input.businessId}"` : "",
      `"${name}" yhteystiedot`
    ]),
    ...(input.decisionMakers ?? []).map((person) => {
      const name = person?.name || person?.label?.split(" - ")[0] || "";
      return name && input.companyName ? `"${name}" "${input.companyName}"` : "";
    })
  ].filter(Boolean);

  const deduped = [];
  for (const query of queries) {
    if (!deduped.includes(query)) deduped.push(query);
    if (deduped.length >= limit) return deduped;
  }
  return deduped;
}

function candidatePages(rootUrl, maxPages) {
  try {
    const parsed = new URL(rootUrl);
    return VERIFY_PATHS
      .slice(0, maxPages)
      .map((path) => path === "/" ? parsed.origin : `${parsed.origin}${path}`);
  } catch {
    return [];
  }
}

function withTimeout(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { controller, clear: () => clearTimeout(timer) };
}

async function fetchTextPage(url, timeoutMs) {
  const timeout = withTimeout(timeoutMs);
  try {
    const response = await fetch(url, {
      signal: timeout.controller.signal,
      headers: {
        accept: "text/html, text/plain, application/xhtml+xml",
        "user-agent": USER_AGENT
      }
    });
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok || !/text|html|xhtml/i.test(contentType)) return null;
    return {
      url: response.url || url,
      text: stripHtml((await response.text()).slice(0, 240000))
    };
  } catch {
    return null;
  } finally {
    timeout.clear();
  }
}

function rootUrl(url) {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

function hostname(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function isDirectoryHost(url) {
  const host = hostname(url);
  return DIRECTORY_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
}

function addEvidence(list, type, value, evidence, weight) {
  list.push({ type, value, evidence, weight });
}

function includesNormalized(text, needle) {
  if (!needle) return false;
  return normalizeText(text).includes(normalizeText(needle));
}

function businessIdsIn(text) {
  return [...new Set((text.match(/\b\d{7}-\d\b/g) ?? []))];
}

function emailsIn(text) {
  return [...new Set((text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) ?? []).map((email) => email.toLowerCase()))];
}

function scoreToStatus(score, hasExactBusinessId, hasStrongNonIdEvidence, conflict) {
  if (conflict) return { status: "conflict", confidence: "low" };
  if (score >= 70 && hasExactBusinessId) return { status: "verified", confidence: "high" };
  if (score >= 60 && hasStrongNonIdEvidence) return { status: "verified", confidence: "medium" };
  if (score >= 35) return { status: "candidate", confidence: "medium" };
  return { status: "candidate", confidence: "low" };
}

export async function verifyWebsiteCandidate(input, candidateUrl, options = {}) {
  const timeoutMs = Number.parseInt(options.timeoutMs, 10) || 3500;
  const maxPages = Number.parseInt(options.maxPages, 10) || 5;
  const pages = [];

  for (const url of candidatePages(candidateUrl, maxPages)) {
    const page = await fetchTextPage(url, timeoutMs);
    if (page?.text) pages.push(page);
  }

  if (pages.length === 0) {
    return {
      url: rootUrl(candidateUrl),
      status: "not_found",
      confidence: "low",
      score: 0,
      matchedEvidence: [],
      checkedAt: new Date().toISOString(),
      sourceName: WEBSITE_SOURCE_NAME,
      sourceUrl: candidateUrl,
      notes: ["Candidate did not return fetchable text/html pages."]
    };
  }

  const text = pages.map((page) => page.text).join("\n");
  const matchedEvidence = [];
  let score = 0;
  const id = input.businessId || "";
  const foundBusinessIds = businessIdsIn(text);
  const hasExactBusinessId = Boolean(id && foundBusinessIds.includes(id));
  const conflictingBusinessIds = foundBusinessIds.filter((found) => found !== id);

  if (hasExactBusinessId) {
    score += 60;
    addEvidence(matchedEvidence, "business_id", id, `Y-tunnus ${id} found on fetched website.`, 60);
  }
  if (conflictingBusinessIds.length > 0) {
    score -= 100;
    addEvidence(matchedEvidence, "conflict_business_id", conflictingBusinessIds[0], `Different Y-tunnus ${conflictingBusinessIds[0]} found on candidate website.`, -100);
  }
  if (includesNormalized(text, input.companyName)) {
    score += 35;
    addEvidence(matchedEvidence, "company_name", input.companyName, `Exact company name ${input.companyName} found on fetched website.`, 35);
  }
  for (const auxiliaryName of input.auxiliaryNames ?? []) {
    if (includesNormalized(text, auxiliaryName)) {
      score += 25;
      addEvidence(matchedEvidence, "auxiliary_name", auxiliaryName, `Auxiliary name ${auxiliaryName} found on fetched website.`, 25);
      break;
    }
  }
  if (input.address && includesNormalized(text, input.address)) {
    score += 25;
    addEvidence(matchedEvidence, "address", input.address, "Registered address found on fetched website.", 25);
  } else if (input.city && includesNormalized(text, input.city)) {
    score += 10;
    addEvidence(matchedEvidence, "city", input.city, `Registered city ${input.city} found on fetched website.`, 10);
  }
  for (const person of input.decisionMakers ?? []) {
    const name = person?.name || person?.label?.split(" - ")[0] || "";
    if (name && includesNormalized(text, name)) {
      score += 20;
      addEvidence(matchedEvidence, "decision_maker", name, `Decision maker ${name} found on fetched website.`, 20);
      break;
    }
  }

  const host = hostname(pages[0]?.url || candidateUrl);
  const companyStem = domainStemFromName(input.companyName);
  const hostStem = domainStemFromHost(host);
  if (companyStem && hostStem && hostStem === companyStem) {
    score += 30;
    addEvidence(matchedEvidence, "exact_domain_stem", host, "Domain exactly matches company name after removing legal suffix such as Oy/Oyj.", 30);
  }
  if (companyStem && host.replace(/[^a-z0-9]/g, "").includes(companyStem.slice(0, Math.min(12, companyStem.length)))) {
    score += 20;
    addEvidence(matchedEvidence, "domain_similarity", host, "Domain resembles company name.", 20);
  }
  if (pages.some((page) => !new URL(page.url).pathname.match(/^\/?$/))) {
    score += 10;
    addEvidence(matchedEvidence, "contact_or_about_page", pages.find((page) => !new URL(page.url).pathname.match(/^\/?$/))?.url || "", "Contact/about/company page exists.", 10);
  }
  if (emailsIn(text).some((email) => email.endsWith(`@${host}`))) {
    score += 15;
    addEvidence(matchedEvidence, "official_email_domain", host, "Email domain matches website domain.", 15);
  }
  if (isDirectoryHost(candidateUrl)) {
    score -= 40;
    addEvidence(matchedEvidence, "directory_penalty", host, "Directory/register/social host is supporting evidence only, not an official website.", -40);
  }

  const conflict = conflictingBusinessIds.length > 0;
  const hasStrongNonIdEvidence = matchedEvidence.some((item) => item.type === "company_name") &&
    matchedEvidence.some((item) => ["address", "auxiliary_name", "decision_maker", "official_email_domain", "exact_domain_stem"].includes(item.type));
  const status = scoreToStatus(score, hasExactBusinessId, hasStrongNonIdEvidence, conflict);
  return {
    url: rootUrl(pages[0]?.url || candidateUrl),
    ...status,
    score,
    matchedEvidence,
    checkedAt: new Date().toISOString(),
    sourceName: hasExactBusinessId ? "Fetched official website" : WEBSITE_SOURCE_NAME,
    sourceUrl: pages[0]?.url || candidateUrl,
    notes: conflict ? ["Business ID conflict found on candidate website."] : []
  };
}

function inputForCompany(company, enrichment = {}) {
  return {
    businessId: businessId(company),
    companyName: currentName(company),
    auxiliaryNames: auxiliaryNames(company),
    address: address(company),
    city: city(company),
    decisionMakers: enrichment.decisionMakers ?? [],
    knownWebsiteFromPrh: normalizeWebsite(company.website?.url || enrichment.companyWebsite || "")
  };
}

function pickBest(results) {
  return results
    .filter((result) => result.status !== "not_found")
    .sort((a, b) => {
      const rank = { verified: 3, candidate: 2, conflict: 1, not_found: 0 };
      return (rank[b.status] || 0) - (rank[a.status] || 0) || b.score - a.score;
    })[0] || null;
}

export async function discoverCompanyWebsite(company, enrichment = {}, options = {}) {
  if (options.enabled === false) {
    return { website: null, stats: { status: "disabled", candidatesChecked: 0 } };
  }

  const input = inputForCompany(company, enrichment);
  const candidates = generateWebsiteCandidates(input, Number.parseInt(options.candidateLimit, 10) || 24);
  const results = [];
  const maxCandidates = Math.min(Number.parseInt(options.maxCandidates, 10) || 8, candidates.length);

  for (const candidate of candidates.slice(0, maxCandidates)) {
    const result = await verifyWebsiteCandidate(input, candidate, options);
    results.push(result);
    if (result.status === "verified" && result.confidence === "high") break;
  }

  const best = pickBest(results);
  return {
    website: best,
    stats: {
      status: best?.status || "not_found",
      candidatesGenerated: candidates.length,
      candidatesChecked: results.length,
      verified: best?.status === "verified" ? 1 : 0,
      conflicts: results.filter((result) => result.status === "conflict").length,
      notFound: best ? 0 : 1
    }
  };
}
