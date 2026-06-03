import { fetchOfficialEmployeeCount } from "./financialStatementAgent.js";
import { fetchVirreResponsiblePeopleForCompanies } from "./virreAgent.js";
import { discoverCompanyWebsite } from "./websiteDiscoveryAgent.js";
import { extractCurrentEmployeeCountFromText, findCurrentEmployeeCountsForCompanies } from "./currentEmployeeSearchAgent.js";

const CONTACT_PATHS = [
  "/",
  "/en/careers",
  "/careers",
  "/tyopaikat",
  "/en/about-us/alma-in-brief",
  "/en/about-us",
  "/about-us",
  "/contact",
  "/contact-us",
  "/contacts",
  "/en/contact",
  "/en/contacts",
  "/yhteystiedot",
  "/yhteys",
  "/ota-yhteytta",
  "/about",
  "/en/about",
  "/team",
  "/en/team",
  "/people",
  "/staff",
  "/management",
  "/leadership",
  "/henkilosto",
  "/johto",
  "/tiimi",
  "/hallitus",
  "/yritys",
  "/meista"
];

const DECISION_TITLES = [
  "CEO",
  "Chief Executive",
  "Managing Director",
  "Founder",
  "Co-founder",
  "Owner",
  "Partner",
  "Sales Director",
  "Business Director",
  "toimitusjohtaja",
  "perustaja",
  "omistaja",
  "yritt\u00e4j\u00e4",
  "myyntijohtaja",
  "liiketoimintajohtaja",
  "hallituksen puheenjohtaja"
];

function emptyEnrichment() {
  return {
    employeeCount: "",
    employeeCountSourceName: "",
    employeeCountSourceUrl: "",
    employeeCountEvidence: "",
    currentEmployeeCount: "",
    currentEmployeeCountSourceName: "",
    currentEmployeeCountSourceUrl: "",
    currentEmployeeCountEvidence: "",
    decisionMakers: [],
    emails: [],
    phones: [],
    contactSourceName: "",
    contactSourceUrl: "",
    contactEvidence: "",
    investments: "",
    notes: "",
    companyWebsite: "",
    companyWebsiteSourceName: "",
    companyWebsiteSourceUrl: "",
    sourceName: "",
    sourceUrl: "",
    updatedAt: "",
    confidence: "missing",
    verificationStatus: "",
    verificationEvidence: [],
    verifiedSources: []
  };
}

function normalizeWebsite(url) {
  if (!url) return null;
  const trimmed = String(url).trim();
  if (!trimmed) return null;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h1|h2|h3|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function extractEmails(text) {
  const normalized = text
    .replace(/\s*(\[at\]|\(at\))\s*/gi, "@")
    .replace(/\s*(\[dot\]|\(dot\))\s*/gi, ".");
  const matches = normalized.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) ?? [];
  return [...new Set(matches.map((email) => email.toLowerCase()))]
    .filter((email) => !/\.(png|jpg|jpeg|gif|svg|webp)$/i.test(email))
    .slice(0, 10);
}

function extractPhones(text) {
  const matches = text.match(/(?:\+358|0)\s?(?:\d[\s-]?){6,12}\d/g) ?? [];
  return [...new Set(matches
    .map((phone) => phone.replace(/\s+/g, " ").trim())
    .filter((phone) => {
      const digits = phone.replace(/\D/g, "");
      if (phone.startsWith("+358")) return digits.length >= 10 && digits.length <= 13;
      if (/[\s-]/.test(phone)) return digits.length >= 8 && digits.length <= 12;
      return digits.length >= 9 && digits.length <= 12;
    }))].slice(0, 10);
}

function snippet(text, index, radius = 140) {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + radius);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

function extractEmployeeCount(page) {
  const fact = extractCurrentEmployeeCountFromText(page.text, page.url);
  if (!fact) return null;
  return {
    value: fact.employeeCount,
    sourceName: "Verified company website",
    sourceUrl: fact.sourceUrl,
    evidence: fact.evidence
  };
}

function extractDecisionMakers(pages) {
  const people = [];
  const seen = new Set();

  for (const page of pages) {
    const lower = page.text.toLowerCase();
    for (const title of DECISION_TITLES) {
      const titleLower = title.toLowerCase();
      let index = lower.indexOf(titleLower);
      while (index !== -1) {
        const evidence = snippet(page.text, index, 220);
        const emails = extractEmails(evidence);
        const phones = extractPhones(evidence);
        const name = nearestName(evidence, titleLower);
        const label = name ? `${name} - ${title}` : title;
        addPerson(people, seen, {
          label,
          title,
          email: emails[0] || "",
          phone: phones[0] || "",
          sourceName: "Verified company website",
          sourceUrl: page.url,
          evidence
        });
        if (people.length >= 5) return people;
        index = lower.indexOf(titleLower, index + titleLower.length);
      }
    }
  }

  for (const page of pages) {
    for (const email of extractEmails(page.text)) {
      const index = page.text.toLowerCase().indexOf(email.toLowerCase());
      if (index === -1) continue;
      const evidence = snippet(page.text, index, 180);
      const name = nearestName(evidence, email.toLowerCase());
      if (!name) continue;
      addPerson(people, seen, {
        label: `${name} - Contact person`,
        title: "Contact person",
        email,
        phone: extractPhones(evidence)[0] || "",
        sourceName: "Verified company website",
        sourceUrl: page.url,
        evidence
      });
      if (people.length >= 5) return people;
    }
  }

  return people;
}

function nearestName(text, anchorLower) {
  const anchor = text.toLowerCase().indexOf(anchorLower);
  const before = anchor >= 0 ? text.slice(0, anchor) : text;
  const matches = [...before.matchAll(/([A-Z\u00c4\u00d6\u00c5][a-z\u00e4\u00f6\u00e5]+(?:\s+[A-Z\u00c4\u00d6\u00c5][a-z\u00e4\u00f6\u00e5]+){1,3})/g)]
    .map((match) => match[1])
    .filter((name) => !/\b(Oy|Oyj|Ab|Ltd|Group|Holding)\b/i.test(name));
  return matches.at(-1) || "";
}

function addPerson(people, seen, person) {
  const key = `${person.label}:${person.email}:${person.phone}:${person.sourceUrl}`;
  if (seen.has(key)) return;
  seen.add(key);
  people.push(person);
}

async function fetchText(url, timeoutMs = 4500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: "text/html, text/plain",
        "user-agent": "NovapolisLeadRadar/1.0"
      }
    });
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok || !contentType.includes("text")) return null;
    const html = (await response.text()).slice(0, 220000);
    return { url: response.url || url, text: stripHtml(html) };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function urlsForCompanySources(sources) {
  const urls = new Map();
  for (const source of sources) {
    const normalized = normalizeWebsite(source.url);
    if (!normalized) continue;
    try {
      const parsed = new URL(normalized);
      urls.set(normalized, source);
      for (const contactPath of CONTACT_PATHS) {
        const candidate = contactPath === "/" ? parsed.origin : `${parsed.origin}${contactPath}`;
        if (!urls.has(candidate)) urls.set(candidate, source);
      }
    } catch {
      // Ignore malformed candidates after normalization.
    }
  }
  return [...urls.entries()].map(([url, source]) => ({ url, source })).slice(0, 18);
}

async function publicWebsiteEnrichment(company, enabled, companySources) {
  if (!enabled || companySources.length === 0) return null;
  const primarySource = companySources[0];
  const sourceLabel = primarySource.provider || "Verified company website";
  const sourceUrl = primarySource.sourceUrl || primarySource.url || "";
  const verificationStatus = primarySource.verificationStatus || (primarySource.sourceKind === "verified-company-website" ? "official-company-website-verified" : "official-prh-website-field");
  const verificationEvidence = primarySource.verificationEvidence?.length
    ? primarySource.verificationEvidence
    : [primarySource.sourceKind === "verified-company-website" ? "Website verified by fetched company-owned source evidence." : "Website URL is present in the official PRH company record."];
  const websiteOnly = {
    ...emptyEnrichment(),
    companyWebsite: primarySource?.url || "",
    companyWebsiteSourceName: sourceLabel,
    companyWebsiteSourceUrl: sourceUrl,
    sourceName: primarySource ? sourceLabel : "",
    sourceUrl,
    updatedAt: new Date().toISOString(),
    confidence: primarySource.confidence || (primarySource ? "official-website-field" : "missing"),
    verificationStatus: primarySource ? verificationStatus : "",
    verificationEvidence: primarySource ? verificationEvidence : [],
    verifiedSources: companySources.map((source) => ({
      url: source.url,
      provider: source.provider || "",
      sourceKind: source.sourceKind || "",
      verificationScore: source.verificationScore ?? 100,
      verificationEvidence: source.verificationEvidence?.length ? source.verificationEvidence : ["Website URL is present in the official PRH company record."]
    }))
  };

  const urls = urlsForCompanySources(companySources);
  const settled = await Promise.allSettled(urls.map(async ({ url, source }) => {
    const page = await fetchText(url);
    return page ? { ...page, verifiedSource: source } : null;
  }));
  const pages = settled
    .filter((item) => item.status === "fulfilled" && item.value?.text)
    .map((item) => item.value);

  if (pages.length === 0) return websiteOnly;

  const joined = pages.map((page) => page.text).join("\n");
  const emails = extractEmails(joined);
  const phones = extractPhones(joined);
  const employeeEvidence = pages.map(extractEmployeeCount).find(Boolean) || null;
  const decisionMakers = extractDecisionMakers(pages);

  if (emails.length === 0 && phones.length === 0 && !employeeEvidence && decisionMakers.length === 0) return websiteOnly;

  return {
    ...websiteOnly,
    employeeCount: employeeEvidence?.value || "",
    employeeCountSourceName: employeeEvidence?.sourceName || "",
    employeeCountSourceUrl: employeeEvidence?.sourceUrl || "",
    employeeCountEvidence: employeeEvidence?.evidence || "",
    decisionMakers,
    emails,
    phones,
    contactSourceName: emails.length || phones.length ? "Verified company website" : "",
    contactSourceUrl: emails.length || phones.length ? pages[0]?.url ?? "" : "",
    contactEvidence: emails.length || phones.length ? "Email/phone extracted from a company-owned website URL present in the official PRH company record." : "",
    sourceName: "Verified company website",
    sourceUrl: pages[0]?.url ?? companySources[0]?.url ?? "",
    updatedAt: new Date().toISOString(),
    confidence: "company-owned-public-web",
    verificationStatus,
    verificationEvidence,
    verifiedSources: companySources.map((source) => ({
      url: source.url,
      provider: source.provider || "",
      sourceKind: source.sourceKind || "",
      verificationScore: source.verificationScore ?? 100,
      verificationEvidence: source.verificationEvidence?.length ? source.verificationEvidence : ["Website URL is present in the official PRH company record."]
    }))
  };
}

function sourceFromWebsiteDiscovery(discovery) {
  const website = discovery?.website;
  if (!website || website.status !== "verified") return null;
  return {
    url: website.url,
    provider: website.sourceName || "Fetched official website",
    sourceKind: "verified-company-website",
    sourceUrl: website.sourceUrl || website.url,
    confidence: `official-company-website-${website.confidence}`,
    verificationStatus: "official-company-website-verified",
    verificationScore: website.score,
    verificationEvidence: website.matchedEvidence?.length
      ? website.matchedEvidence.map((item) => item.evidence)
      : ["Website verified by fetched company-owned source evidence."]
  };
}

function dedupeSources(sources) {
  const byUrl = new Map();
  for (const source of sources.filter(Boolean)) {
    const normalized = normalizeWebsite(source.url);
    if (!normalized) continue;
    if (!byUrl.has(normalized) || source.sourceKind === "verified-company-website") {
      byUrl.set(normalized, { ...source, url: normalized });
    }
  }
  return [...byUrl.values()];
}

function mergeEnrichment(...items) {
  const valid = items.filter(Boolean);
  const officialEmployees = valid.find((item) => item.employeeCount && item.confidence === "official-xbrl");
  const currentEmployees = valid.find((item) => item.currentEmployeeCount);
  const anyEmployees = valid.find((item) => item.employeeCount);
  const employee = currentEmployees || officialEmployees || anyEmployees;
  const website = valid.find((item) => item.companyWebsite && item.verificationStatus === "official-company-website-verified") || valid.find((item) => item.companyWebsite);
  const contactSource = valid.find((item) => (item.emails?.length || item.phones?.length) && (item.contactSourceUrl || item.sourceUrl));
  const peopleSource = valid.find((item) => item.decisionMakers?.length && item.sourceUrl);
  const verification = valid.find((item) => item.companyWebsite && item.verificationStatus === "official-company-website-verified") ||
    valid.find((item) => item.companyWebsite && item.verificationStatus) ||
    valid.find((item) => item.verificationStatus);
  const verificationOrder = [verification, ...valid.filter((item) => item !== verification)].filter(Boolean);
  const primary = peopleSource || contactSource || employee || valid.find((item) => item.sourceName);
  const notes = valid.map((item) => item.notes).filter(Boolean);
  const investments = valid.map((item) => item.investments).filter(Boolean);

  return {
    ...emptyEnrichment(),
    employeeCount: employee?.employeeCount || "",
    employeeCountSourceName: employee?.employeeCountSourceName || "",
    employeeCountSourceUrl: employee?.employeeCountSourceUrl || "",
    employeeCountEvidence: employee?.employeeCountEvidence || "",
    currentEmployeeCount: currentEmployees?.currentEmployeeCount || "",
    currentEmployeeCountSourceName: currentEmployees?.currentEmployeeCountSourceName || "",
    currentEmployeeCountSourceUrl: currentEmployees?.currentEmployeeCountSourceUrl || "",
    currentEmployeeCountEvidence: currentEmployees?.currentEmployeeCountEvidence || "",
    decisionMakers: valid.flatMap((item) => item.decisionMakers || []).slice(0, 8),
    emails: [...new Set(valid.flatMap((item) => item.emails || []))].slice(0, 12),
    phones: [...new Set(valid.flatMap((item) => item.phones || []))].slice(0, 12),
    contactSourceName: contactSource?.contactSourceName || contactSource?.sourceName || "",
    contactSourceUrl: contactSource?.contactSourceUrl || contactSource?.sourceUrl || "",
    contactEvidence: contactSource?.contactEvidence || "",
    investments: investments.join(" | "),
    notes: notes.join(" | "),
    companyWebsite: website?.companyWebsite || "",
    companyWebsiteSourceName: website?.companyWebsiteSourceName || "",
    companyWebsiteSourceUrl: website?.companyWebsiteSourceUrl || "",
    sourceName: primary?.sourceName || "",
    sourceUrl: primary?.sourceUrl || "",
    updatedAt: primary?.updatedAt || "",
    confidence: primary?.confidence || "missing",
    verificationStatus: verification?.verificationStatus || "",
    verificationEvidence: verificationOrder.flatMap((item) => item.verificationEvidence || []).slice(0, 8),
    verifiedSources: verificationOrder.flatMap((item) => item.verifiedSources || []).slice(0, 8)
  };
}

export async function enrichCompanies(companies, options = {}) {
  const publicWeb = options.publicWeb !== false;
  const websiteDiscovery = options.websiteDiscovery !== false;
  const websiteDiscoveryLimit = Math.min(Number.parseInt(options.websiteDiscoveryLimit, 10) || 12, companies.length);
  const virrePeople = options.virrePeople !== false;
  const virreLimit = Math.min(Number.parseInt(options.virreLimit, 10) || 12, companies.length);
  const currentEmployeeSearch = options.currentEmployeeSearch === true || options.currentEmployeeSearch === "true";
  const currentEmployeeSearchLimit = Math.min(Number.parseInt(options.currentEmployeeSearchLimit, 10) || 5, companies.length);
  const result = new Map();
  const disabledVirreStats = {
    status: "disabled",
    checked: 0,
    extractsDownloaded: 0,
    peopleFound: 0,
    phonesFound: 0,
    websitesFound: 0,
    noPeopleFound: 0,
    errors: []
  };
  const virrePromise = virrePeople
    ? fetchVirreResponsiblePeopleForCompanies(companies.slice(0, virreLimit), { limit: virreLimit }).catch((error) => ({
      map: new Map(),
      stats: { ...disabledVirreStats, status: "error", errors: [error.message] }
    }))
    : Promise.resolve({ map: new Map(), stats: disabledVirreStats });
  const virre = await virrePromise;

  const settled = await Promise.allSettled(companies.map(async (company, index) => {
    const businessId = company?.businessId?.value;
    if (!businessId) return null;
    const sources = [];
    const prhWebsite = normalizeWebsite(company?.website?.url);
    const virreHit = virre.map.get(businessId);
    const virreWebsite = normalizeWebsite(virreHit?.companyWebsite);

    if (prhWebsite) {
      sources.push({
        url: prhWebsite,
        provider: "PRH Open Data",
        sourceKind: "prh-website"
      });
    }
    if (virreWebsite) {
      sources.push({
        url: virreWebsite,
        provider: virreHit.companyWebsiteSourceName || "PRH Virre company details",
        sourceKind: "virre-website",
        sourceUrl: virreHit.companyWebsiteSourceUrl || virreHit.sourceUrl || virreWebsite,
        confidence: "official-virre-website-field",
        verificationStatus: virreHit.verificationStatus || "official-public-register-extract",
        verificationEvidence: ["Website URL is present in the official Virre company details."]
      });
    }

    const [financial, discovery] = await Promise.all([
      fetchOfficialEmployeeCount(company),
      publicWeb && websiteDiscovery && index < websiteDiscoveryLimit
        ? discoverCompanyWebsite(company, virreHit || {}, { enabled: true, maxCandidates: prhWebsite || virreWebsite ? 1 : 8, maxPages: 5 })
        : Promise.resolve({ website: null, stats: { status: publicWeb ? "skipped" : "disabled", candidatesChecked: 0, verified: 0, conflicts: 0, notFound: 0 } })
    ]);
    const discoveredSource = sourceFromWebsiteDiscovery(discovery);
    const publicHit = await publicWebsiteEnrichment(company, publicWeb, dedupeSources([discoveredSource, ...sources]));

    return [businessId, financial.enrichment, publicHit, {
      financial: financial.stats,
      publicWeb: {
        status: publicHit ? "ok" : (prhWebsite ? "no_extractable_data" : "missing_website"),
        websiteFound: Boolean(prhWebsite || publicHit?.companyWebsite),
        contactsFound: (publicHit?.emails?.length || 0) + (publicHit?.decisionMakers?.length || 0)
      },
      websiteDiscovery: discovery.stats
    }];
  }));

  const stats = {
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
    virre: virre.stats
  };

  for (const item of settled) {
    if (item.status === "fulfilled" && item.value) {
      const id = item.value[0];
      const financial = item.value[1];
      const publicHit = item.value[2];
      const virreHit = virre.map.get(id);
      result.set(id, mergeEnrichment(financial, virreHit, publicHit));
      const meta = item.value[3];
      if (meta?.financial) {
        stats.financials.checked += 1;
        if (meta.financial.status === "ok") stats.financials.employeeCountsFound += 1;
        if (meta.financial.status === "no_digital_financials") stats.financials.noDigitalFinancials += 1;
        if (meta.financial.status === "no_employee_fact") stats.financials.noEmployeeFact += 1;
        if (meta.financial.status === "error") stats.financials.errors.push(meta.financial.message);
      }
      if (meta?.publicWeb) {
        if (meta.publicWeb.websiteFound) stats.publicWeb.websitesFound += 1;
        stats.publicWeb.contactsFound += meta.publicWeb.contactsFound || 0;
      }
      if (meta?.websiteDiscovery) {
        if (meta.websiteDiscovery.status !== "disabled" && meta.websiteDiscovery.status !== "skipped") stats.websiteDiscovery.checked += 1;
        stats.websiteDiscovery.verified += meta.websiteDiscovery.verified || 0;
        stats.websiteDiscovery.conflicts += meta.websiteDiscovery.conflicts || 0;
        stats.websiteDiscovery.notFound += meta.websiteDiscovery.notFound || 0;
        stats.websiteDiscovery.candidatesChecked += meta.websiteDiscovery.candidatesChecked || 0;
      }
    }
  }

  stats.currentEmployeeSearch = {
    status: "disabled",
    checked: 0,
    found: 0,
    urlsChecked: 0,
    noCompanyOwnedResults: 0,
    noEmployeeFact: 0,
    errors: []
  };

  if (currentEmployeeSearch) {
    const currentEmployees = await findCurrentEmployeeCountsForCompanies(
      companies,
      result,
      {
        enabled: true,
        limit: currentEmployeeSearchLimit,
        maxSearchResults: options.currentEmployeeSearchResults || 6,
        maxPages: options.currentEmployeeSearchPages || 6
      }
    );
    stats.currentEmployeeSearch = currentEmployees.stats;
    for (const [id, currentEmployeeHit] of currentEmployees.map) {
      result.set(id, mergeEnrichment(result.get(id), currentEmployeeHit));
    }
  }

  return {
    map: result,
    stats
  };
}
