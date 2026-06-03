import { PDFParse } from "pdf-parse";

const VIRRE_BASE = "https://virre.prh.fi";
const VIRRE_SEARCH_URL = `${VIRRE_BASE}/novus/companySearch?userLang=en`;
const VIRRE_SOURCE_NAME = "PRH Virre Trade Register extract";
const USER_AGENT = "NovapolisLeadRadar/1.0";

const ROLE_LABELS = {
  "Puheenjohtaja": "Chair of the board",
  "Varapuheenjohtaja": "Vice chair of the board",
  "Jäsen": "Board member",
  "Varajäsen": "Deputy board member",
  "Toimitusjohtaja": "Managing director / CEO"
};

const ROLE_PRIORITY = {
  "Toimitusjohtaja": 1,
  "Puheenjohtaja": 2,
  "Varapuheenjohtaja": 3,
  "Jäsen": 4,
  "Varajäsen": 5
};

export const VIRRE_SOURCE = {
  name: VIRRE_SOURCE_NAME,
  url: VIRRE_SEARCH_URL,
  note: "Free public Virre company search is used to download Finnish Trade Register extracts and extract board/CEO data from the generated PDF."
};

export const VIRRE_SOURCES = [VIRRE_SOURCE];

function currentName(company) {
  return company.names?.find((name) => name.type === "1" && name.version === 1)?.name ?? company.names?.[0]?.name ?? "Unknown company";
}

function businessId(company) {
  return company.businessId?.value ?? "";
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h1|h2|h3|tr|td)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&auml;/g, "ä")
    .replace(/&ouml;/g, "ö")
    .replace(/&aring;/g, "å")
    .replace(/&Auml;/g, "Ä")
    .replace(/&Ouml;/g, "Ö")
    .replace(/&Aring;/g, "Å")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

class CookieJar {
  #cookies = new Map();

  header() {
    return [...this.#cookies].map(([key, value]) => `${key}=${value}`).join("; ");
  }

  store(response) {
    const setCookie = typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : splitSetCookieHeader(response.headers.get("set-cookie"));
    for (const item of setCookie) {
      const [pair] = item.split(";");
      const separator = pair.indexOf("=");
      if (separator > 0) this.#cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
  }
}

function splitSetCookieHeader(header) {
  if (!header) return [];
  return header.split(/,(?=\s*[^;,=\s]+=)/g).map((item) => item.trim()).filter(Boolean);
}

async function fetchWithSession(path, options = {}, jar = new CookieJar()) {
  let url = path.startsWith("http") ? new URL(path) : new URL(path, VIRRE_BASE);
  let requestOptions = options;

  for (let redirect = 0; redirect < 10; redirect += 1) {
    const cookie = jar.header();
    const response = await fetch(url, {
      ...requestOptions,
      redirect: "manual",
      headers: {
        accept: "text/html,application/pdf",
        "user-agent": USER_AGENT,
        ...(cookie ? { cookie } : {}),
        ...(requestOptions.headers ?? {})
      }
    });
    jar.store(response);

    if (![301, 302, 303, 307, 308].includes(response.status)) return response;

    const location = response.headers.get("location");
    if (!location) return response;
    url = new URL(location, url);

    const method = requestOptions.method?.toUpperCase();
    if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === "POST")) {
      requestOptions = { method: "GET" };
    }
  }

  throw new Error("Virre redirect limit reached");
}

function getHiddenValue(html, name) {
  const pattern = new RegExp(`name="${escapeRegExp(name)}" value="([^"]+)"`, "i");
  return pattern.exec(html)?.[1] ?? "";
}

function findBrowseLink(searchHtml, expectedBusinessId) {
  const table = /<table[\s\S]*?id="foundCompanies"[\s\S]*?<\/table>/i.exec(searchHtml)?.[0] ?? searchHtml;
  if (expectedBusinessId && !table.includes(expectedBusinessId)) return "";
  return (/href="([^"]*companySearch\?execution=[^"]*_eventId=browse[^"]*)"/i.exec(table)?.[1] ?? "").replaceAll("&amp;", "&");
}

function rowValue(html, label) {
  const pattern = new RegExp(`<td[^>]*>\\s*<strong>${escapeRegExp(label)}</strong>\\s*</td>\\s*<td[^>]*>([\\s\\S]*?)</td>`, "i");
  const match = pattern.exec(html);
  return match ? stripHtml(match[1]) : "";
}

function websiteFromDetails(html) {
  const rowPattern = /<td[^>]*>\s*<strong>Website<\/strong>\s*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/i;
  const row = rowPattern.exec(html)?.[1] ?? "";
  const href = /href="([^"]+)"/i.exec(row)?.[1] ?? "";
  return href || stripHtml(row);
}

function extractDateFromText(text) {
  return /OTE\s+(\d{2}\.\d{2}\.\d{4})/i.exec(text)?.[1] ?? "";
}

function sectionText(text, heading, nextHeadings) {
  const startPattern = new RegExp(`(^|\\n)${escapeRegExp(heading)}\\s*(\\n|\\()`, "i");
  const startMatch = startPattern.exec(text);
  if (!startMatch) return "";

  const start = startMatch.index + startMatch[1].length;
  const rest = text.slice(start);
  const endPattern = new RegExp(`\\n(?:${nextHeadings.map(escapeRegExp).join("|")})\\s*(?:\\n|\\()`, "i");
  const endMatch = endPattern.exec(rest);
  return endMatch ? rest.slice(0, endMatch.index) : rest;
}

function sectionRegisteredAt(section) {
  return /Rekisteröity\s+([^)]+)/i.exec(section)?.[1]?.trim() ?? "";
}

function displayNameFromVirreName(officialName) {
  if (!officialName || /Y-tunnus|Kaupparekisteri|\bOy\b|\bOyj\b/i.test(officialName)) return "";
  const parts = officialName.trim().split(/\s+/);
  if (parts.length < 2) return "";
  return [...parts.slice(1), parts[0]].join(" ");
}

function makePerson({ roleFi, officialName, section, extractDate, businessId, companyName, sectionRegisteredAt }) {
  const name = displayNameFromVirreName(officialName);
  if (!name) return null;
  const title = ROLE_LABELS[roleFi] ?? roleFi;
  return {
    label: `${name} - ${title}`,
    name,
    title,
    role: roleFi,
    email: "",
    phone: "",
    sourceName: VIRRE_SOURCE_NAME,
    sourceUrl: VIRRE_SEARCH_URL,
    evidence: [
      `Virre Trade Register extract for ${businessId} (${companyName}).`,
      extractDate ? `Extract date: ${extractDate}.` : "",
      `Section: ${section}.`,
      sectionRegisteredAt ? `Section registered: ${sectionRegisteredAt}.` : ""
    ].filter(Boolean).join(" "),
    metadata: {
      officialName,
      extractDate,
      section,
      sectionRegisteredAt
    }
  };
}

function parsePeopleFromSection(section, heading, extractDate, id, name) {
  const registeredAt = sectionRegisteredAt(section);
  const people = [];
  for (const rawLine of section.split(/\n+/)) {
    const line = rawLine.replace(/\s+/g, " ").trim();
    const match = /^(Puheenjohtaja|Varapuheenjohtaja|Jäsen|Varajäsen|Toimitusjohtaja)\s+(.+?)\s+\d{2}\.\d{2}\.\d{4}$/i.exec(line);
    if (!match) continue;
    const roleFi = Object.keys(ROLE_LABELS).find((role) => role.toLowerCase() === match[1].toLowerCase()) ?? match[1];
    const person = makePerson({
      roleFi,
      officialName: match[2],
      section: heading,
      extractDate,
      businessId: id,
      companyName: name,
      sectionRegisteredAt: registeredAt
    });
    if (person) people.push(person);
  }
  return people;
}

export function extractVirreResponsiblePeople(text, company = {}) {
  const id = businessId(company) || company.businessId || "";
  const name = currentName(company) || company.name || "";
  const normalized = String(text || "").replace(/\r/g, "").replace(/\t/g, " ");
  const extractDate = extractDateFromText(normalized);
  const board = sectionText(normalized, "Hallitus", ["Toimitusjohtaja", "Tilintarkastajat", "Edustaminen", "Edustamisoikeudet", "Prokuristit"]);
  const managing = sectionText(normalized, "Toimitusjohtaja", ["Tilintarkastajat", "Edustaminen", "Edustamisoikeudet", "Prokuristit"]);
  const people = [
    ...parsePeopleFromSection(managing, "Toimitusjohtaja", extractDate, id, name),
    ...parsePeopleFromSection(board, "Hallitus", extractDate, id, name)
  ];

  const deduped = [];
  const seen = new Set();
  for (const person of people.sort((a, b) => (ROLE_PRIORITY[a.role] ?? 99) - (ROLE_PRIORITY[b.role] ?? 99))) {
    const key = `${person.label}:${person.role}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(person);
  }
  return deduped.slice(0, 10);
}

async function pdfText(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.text || "";
  } finally {
    await parser.destroy();
  }
}

async function downloadVirreExtract(company) {
  const id = businessId(company);
  if (!id) throw new Error("missing business id");

  const jar = new CookieJar();
  let response = await fetchWithSession("/novus/companySearch?userLang=en", {}, jar);
  let html = await response.text();
  let csrf = getHiddenValue(html, "_csrf");
  let execution = getHiddenValue(html, "execution");
  if (!csrf || !execution) throw new Error("Virre search form tokens not found");

  response = await fetchWithSession("/novus/companySearch", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      execution,
      _csrf: csrf,
      name: "",
      businessId: id,
      registrationNumber: "",
      companyStateCode: "",
      nameStateCode: "",
      _eventId_search: "Search"
    })
  }, jar);
  html = await response.text();

  const browseLink = findBrowseLink(html, id);
  if (!browseLink) throw new Error("Virre company search did not return a matching company");

  response = await fetchWithSession(browseLink, {}, jar);
  const detailsHtml = await response.text();
  csrf = getHiddenValue(detailsHtml, "_csrf");
  execution = getHiddenValue(detailsHtml, "execution");
  if (!csrf || !execution) throw new Error("Virre company detail tokens not found");

  response = await fetchWithSession("/novus/companySearch", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      execution,
      _csrf: csrf,
      _eventId_createElectronicTRExtract: "Open a Trade Register extract free of charge"
    })
  }, jar);
  await response.text();

  response = await fetchWithSession("/novus/reportdisplay", {}, jar);
  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok || !contentType.includes("application/pdf")) {
    throw new Error(`Virre reportdisplay did not return PDF (${response.status} ${contentType})`);
  }

  return {
    detailsHtml,
    pdfBuffer: Buffer.from(await response.arrayBuffer())
  };
}

function virreEnrichment(company, people, detailsHtml, text) {
  const id = businessId(company);
  const name = currentName(company);
  const phone = rowValue(detailsHtml, "Telephone");
  const website = websiteFromDetails(detailsHtml);
  const extractDate = extractDateFromText(text);
  const downloadedAt = new Date().toISOString();
  const evidence = [
    `Virre Trade Register extract PDF downloaded for Business ID ${id}.`,
    extractDate ? `Extract date: ${extractDate}.` : "",
    people.length ? `${people.length} responsible people extracted from Hallitus/Toimitusjohtaja sections.` : "No board/CEO section people extracted."
  ].filter(Boolean).join(" ");

  return {
    employeeCount: "",
    employeeCountSourceName: "",
    employeeCountSourceUrl: "",
    employeeCountEvidence: "",
    decisionMakers: people,
    emails: [],
    phones: phone ? [phone] : [],
    contactSourceName: phone ? "PRH Virre company details" : "",
    contactSourceUrl: phone ? VIRRE_SEARCH_URL : "",
    contactEvidence: phone ? `Telephone field found in Virre company details for Business ID ${id}.` : "",
    investments: "",
    notes: people.length ? `Official Virre responsible people found for ${name}.` : "",
    companyWebsite: website,
    companyWebsiteSourceName: website ? VIRRE_SOURCE_NAME : "",
    companyWebsiteSourceUrl: website ? VIRRE_SEARCH_URL : "",
    sourceName: VIRRE_SOURCE_NAME,
    sourceUrl: VIRRE_SEARCH_URL,
    updatedAt: downloadedAt,
    confidence: "official-virre-extract",
    verificationStatus: "official-public-register-extract",
    verificationEvidence: [evidence],
    verifiedSources: [{
      url: VIRRE_SEARCH_URL,
      provider: "PRH Virre",
      sourceKind: "trade-register-extract-pdf",
      verificationScore: 100,
      verificationEvidence: [evidence]
    }]
  };
}

export async function fetchVirreResponsiblePeople(company) {
  try {
    const { detailsHtml, pdfBuffer } = await downloadVirreExtract(company);
    const text = await pdfText(pdfBuffer);
    const people = extractVirreResponsiblePeople(text, company);
    return {
      enrichment: virreEnrichment(company, people, detailsHtml, text),
      stats: {
        status: people.length ? "ok" : "no_people_found",
        peopleFound: people.length,
        phoneFound: rowValue(detailsHtml, "Telephone") ? 1 : 0,
        websiteFound: websiteFromDetails(detailsHtml) ? 1 : 0,
        pdfBytes: pdfBuffer.length
      }
    };
  } catch (error) {
    return {
      enrichment: null,
      stats: {
        status: "error",
        message: error.message,
        peopleFound: 0,
        phoneFound: 0,
        websiteFound: 0,
        pdfBytes: 0
      }
    };
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchVirreResponsiblePeopleForCompanies(companies, options = {}) {
  const limit = Math.min(Number.parseInt(options.limit, 10) || 12, companies.length);
  const delayMs = Number.parseInt(options.delayMs, 10) || 250;
  const map = new Map();
  const stats = {
    status: "ok",
    checked: 0,
    extractsDownloaded: 0,
    peopleFound: 0,
    phonesFound: 0,
    websitesFound: 0,
    noPeopleFound: 0,
    errors: []
  };

  for (const company of companies.slice(0, limit)) {
    const id = businessId(company);
    if (!id) continue;
    stats.checked += 1;
    const result = await fetchVirreResponsiblePeople(company);
    if (result.enrichment) map.set(id, result.enrichment);
    if (result.stats.status === "ok" || result.stats.status === "no_people_found") stats.extractsDownloaded += 1;
    if (result.stats.status === "no_people_found") stats.noPeopleFound += 1;
    if (result.stats.status === "error") stats.errors.push(`${id}: ${result.stats.message}`);
    stats.peopleFound += result.stats.peopleFound || 0;
    stats.phonesFound += result.stats.phoneFound || 0;
    stats.websitesFound += result.stats.websiteFound || 0;
    if (delayMs > 0) await delay(delayMs);
  }

  stats.status = stats.errors.length && stats.extractsDownloaded === 0
    ? "error"
    : stats.errors.length
      ? "partial"
      : "ok";

  return {
    map,
    stats,
    status: stats.status
  };
}
