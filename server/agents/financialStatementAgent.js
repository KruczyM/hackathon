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

const SCALE_FACTS = [
  {
    metric: "net_sales",
    label: "net sales / revenue",
    patterns: [/net.*sales/i, /turnover/i, /revenue/i, /liikevaihto/i],
    exclude: [/tax/i, /deferred/i, /interest/i, /receivable/i, /payable/i, /expense/i, /cost/i],
    thresholds: { mid_market_proxy: 2_000_000, large_opportunity_proxy: 10_000_000, enterprise_watch_proxy: 50_000_000 }
  },
  {
    metric: "balance_sheet_total",
    label: "balance sheet total / total assets",
    patterns: [/balance.*sheet.*total/i, /total.*assets/i, /assets.*total/i, /taseen.*loppusumma/i],
    exclude: [/liabilities/i, /equity/i],
    thresholds: { mid_market_proxy: 2_000_000, large_opportunity_proxy: 10_000_000, enterprise_watch_proxy: 50_000_000 }
  },
  {
    metric: "personnel_expenses",
    label: "personnel expenses",
    patterns: [/personnel.*expense/i, /staff.*cost/i, /wages/i, /salaries/i, /palkat/i, /henkil.*kulut/i],
    exclude: [/receivable/i, /payable/i],
    thresholds: { mid_market_proxy: 1_000_000, large_opportunity_proxy: 5_000_000, enterprise_watch_proxy: 20_000_000 }
  }
];

const SCALE_SEGMENTS = {
  mid_market_proxy: {
    label: "Financial scale proxy: mid-market candidate",
    targetFit: "proxy",
    enterprisePenalty: false,
    weight: 10
  },
  large_opportunity_proxy: {
    label: "Financial scale proxy: large candidate",
    targetFit: "proxy-secondary",
    enterprisePenalty: false,
    weight: 14
  },
  enterprise_watch_proxy: {
    label: "Financial scale proxy: enterprise watch",
    targetFit: "proxy-watch",
    enterprisePenalty: true,
    weight: 8
  }
};

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

function normalizeMoney(value) {
  const normalized = String(value || "")
    .replace(/\s+/g, "")
    .replace(",", ".")
    .trim();
  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed)) return null;
  const amount = Math.abs(Math.round(parsed));
  if (amount < 1000 || amount > 1_000_000_000_000) return null;
  return amount;
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

export function extractFinancialScaleProxyFromXml(xml) {
  const candidates = [];
  const factRegex = /<([A-Za-z0-9_.-]+:)?([A-Za-z0-9_.-]+)\b([^>]*)>([^<]{1,80})<\/(?:[A-Za-z0-9_.-]+:)?\2>/g;
  let match;
  while ((match = factRegex.exec(xml))) {
    const [, , factName, attributes, rawValue] = match;
    const haystack = `${factName} ${attributes}`;
    const factType = SCALE_FACTS.find((item) => {
      if (!item.patterns.some((pattern) => pattern.test(haystack))) return false;
      return !item.exclude.some((pattern) => pattern.test(haystack));
    });
    if (!factType) continue;
    const amount = normalizeMoney(rawValue);
    if (amount === null) continue;
    const segment = scaleSegment(factType.thresholds, amount);
    if (!segment) continue;
    candidates.push({
      metric: factType.metric,
      metricLabel: factType.label,
      factName,
      attributes: attributes.trim(),
      amount,
      amountLabel: formatEuro(amount),
      segment,
      label: SCALE_SEGMENTS[segment].label,
      targetFit: SCALE_SEGMENTS[segment].targetFit,
      enterprisePenalty: SCALE_SEGMENTS[segment].enterprisePenalty,
      weight: SCALE_SEGMENTS[segment].weight
    });
  }

  return candidates.sort((a, b) => b.weight - a.weight || b.amount - a.amount)[0] || null;
}

function scaleSegment(thresholds, amount) {
  if (amount >= thresholds.enterprise_watch_proxy) return "enterprise_watch_proxy";
  if (amount >= thresholds.large_opportunity_proxy) return "large_opportunity_proxy";
  if (amount >= thresholds.mid_market_proxy) return "mid_market_proxy";
  return "";
}

function formatEuro(amount) {
  if (amount >= 1_000_000_000) return `EUR ${(amount / 1_000_000_000).toFixed(1)}B`;
  if (amount >= 1_000_000) return `EUR ${(amount / 1_000_000).toFixed(1)}M`;
  return `EUR ${amount.toLocaleString("en-US")}`;
}

function scaleProxyEnrichment(scaleProxy, statement, latest) {
  if (!scaleProxy) return null;
  return {
    organizationScaleProxy: scaleProxy.segment,
    organizationScaleProxyLabel: scaleProxy.label,
    organizationScaleProxyMetric: scaleProxy.metric,
    organizationScaleProxyMetricLabel: scaleProxy.metricLabel,
    organizationScaleProxyAmount: String(scaleProxy.amount),
    organizationScaleProxyAmountLabel: scaleProxy.amountLabel,
    organizationScaleProxySourceName: "PRH XBRL financial statement",
    organizationScaleProxySourceUrl: statement.url,
    organizationScaleProxyEvidence: `${scaleProxy.metricLabel} ${scaleProxy.amountLabel} (${scaleProxy.factName}) for financial period ${latest.financialDate}; used only as a scale proxy, not as employee count.`,
    organizationScaleProxyConfidence: "official-xbrl-financial-scale",
    sourceName: "PRH XBRL financial statement",
    sourceUrl: statement.url,
    updatedAt: latest.registrationDate || latest.financialDate || new Date().toISOString(),
    confidence: "official-xbrl-financial-scale"
  };
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
    const scaleProxy = extractFinancialScaleProxyFromXml(statement.xml);
    const scaleEnrichment = scaleProxyEnrichment(scaleProxy, statement, latest);
    if (!employeeFact) {
      if (scaleEnrichment) {
        return {
          enrichment: scaleEnrichment,
          stats: {
            status: "scale_proxy",
            financialDate: latest.financialDate,
            sourceUrl: statement.url,
            scaleProxyFound: true
          }
        };
      }
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
        ...(scaleEnrichment || {}),
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
        sourceUrl: statement.url,
        scaleProxyFound: Boolean(scaleEnrichment)
      }
    };
  } catch (error) {
    return { enrichment: null, stats: { status: "error", message: error.message } };
  }
}
