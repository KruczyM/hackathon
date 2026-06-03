import { fetchFinancialPeriods, fetchFinancialStatementXml } from "./prhSourceAgent.js";

const EMPLOYEE_FACT_PATTERNS = [
  /average.*employees/i,
  /employees.*average/i,
  /number.*employees/i,
  /employees.*number/i,
  /personnel/i,
  /staff/i,
  /henkil/i
];

function businessId(company) {
  return company?.businessId?.value ?? company?.businessId ?? "";
}

function latestFinancialPeriod(periods = []) {
  return [...periods]
    .filter((period) => period.financialDate)
    .sort((a, b) => String(b.financialDate).localeCompare(String(a.financialDate)))[0] || null;
}

function normalizeNumber(value) {
  const normalized = String(value || "")
    .replace(/\s+/g, "")
    .replace(",", ".")
    .trim();
  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < 0 || parsed > 500000) return null;
  return Math.round(parsed);
}

function factScore(localName, attributes) {
  const text = `${localName} ${attributes}`.toLowerCase();
  let score = 0;
  if (/average/.test(text) && /employee/.test(text)) score += 70;
  if (/number/.test(text) && /employee/.test(text)) score += 55;
  if (/personnel|staff|henkil/.test(text)) score += 35;
  if (/employees/.test(text)) score += 25;
  if (/duration|period|average/.test(text)) score += 10;
  return score;
}

export function extractEmployeeCountFromFinancialXml(xml) {
  const candidates = [];
  const factRegex = /<([A-Za-z0-9_.-]+:)?([A-Za-z0-9_.-]+)\b([^>]*)>([^<]{1,80})<\/(?:[A-Za-z0-9_.-]+:)?\2>/g;
  let match;
  while ((match = factRegex.exec(xml))) {
    const [, , localName, attributes, rawValue] = match;
    const haystack = `${localName} ${attributes}`;
    if (!EMPLOYEE_FACT_PATTERNS.some((pattern) => pattern.test(haystack))) continue;
    const value = normalizeNumber(rawValue);
    if (value === null) continue;
    const score = factScore(localName, attributes);
    if (score < 35) continue;
    candidates.push({
      value,
      factName: localName,
      attributes: attributes.trim(),
      score
    });
  }

  return candidates.sort((a, b) => b.score - a.score)[0] || null;
}

export async function fetchOfficialEmployeeCount(company) {
  const id = businessId(company);
  if (!id) return { enrichment: null, stats: { status: "missing_business_id" } };

  try {
    const periods = await fetchFinancialPeriods(id);
    const latest = latestFinancialPeriod(periods.financials);
    if (!latest) {
      return { enrichment: null, stats: { status: "no_digital_financials" } };
    }

    const statement = await fetchFinancialStatementXml(id, latest.financialDate);
    const employeeFact = extractEmployeeCountFromFinancialXml(statement.xml);
    if (!employeeFact) {
      return {
        enrichment: null,
        stats: {
          status: "no_employee_fact",
          financialDate: latest.financialDate,
          sourceUrl: statement.url
        }
      };
    }

    return {
      enrichment: {
        employeeCount: String(employeeFact.value),
        employeeCountSourceName: "PRH XBRL financial statement",
        employeeCountSourceUrl: statement.url,
        employeeCountEvidence: `${employeeFact.factName}=${employeeFact.value} for financial period ${latest.financialDate}`,
        sourceName: "PRH XBRL financial statement",
        sourceUrl: statement.url,
        updatedAt: latest.registrationDate || latest.financialDate || new Date().toISOString(),
        confidence: "official-xbrl"
      },
      stats: {
        status: "ok",
        financialDate: latest.financialDate,
        sourceUrl: statement.url
      }
    };
  } catch (error) {
    return { enrichment: null, stats: { status: "error", message: error.message } };
  }
}

