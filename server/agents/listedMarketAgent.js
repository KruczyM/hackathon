import { stableHash } from "../lib/hash.js";

const NFIN_BASE = "https://api.nfin.dev/v1";
const YAHOO_CHART_BASE = "https://query1.finance.yahoo.com/v8/finance/chart";
const SOURCE_NAME = "Yahoo Finance chart API + nfin.dev Nasdaq Nordic API";
const USER_AGENT = "NovapolisLeadRadar/1.0";
const MIN_MATCH_SCORE = 0.82;

const COMPANY_STOPWORDS = new Set([
  "ab",
  "abp",
  "and",
  "corporation",
  "corp",
  "company",
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

export const LISTED_MARKET_SOURCES = [
  {
    name: "nfin.dev Nasdaq Nordic API",
    url: "https://api.nfin.dev/v1/openapi.json",
    note: "Free public API used to match PRH companies to Nasdaq Nordic/Helsinki listed share instruments."
  },
  {
    name: "Yahoo Finance chart API",
    url: "https://query1.finance.yahoo.com/v8/finance/chart/NOKIA.HE?range=3mo&interval=1d",
    note: "Free public chart endpoint used for daily Helsinki share-price history when a .HE ticker can be derived automatically."
  }
];

function withTimeout(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { controller, clear: () => clearTimeout(timer) };
}

async function fetchJson(url, timeoutMs = 15000) {
  const timeout = withTimeout(timeoutMs);
  try {
    const response = await fetch(url, {
      signal: timeout.controller.signal,
      headers: {
        accept: "application/json",
        "user-agent": USER_AGENT
      }
    });
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    return await response.json();
  } finally {
    timeout.clear();
  }
}

function currentName(company) {
  return company.names?.find((name) => name.type === "1" && name.version === 1)?.name ?? company.names?.[0]?.name ?? "Unknown company";
}

function businessId(company) {
  return company.businessId?.value ?? "";
}

export function normalizeCompanyName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => token && !COMPANY_STOPWORDS.has(token))
    .join(" ");
}

function tokenizeCompanyName(value) {
  const normalized = normalizeCompanyName(value);
  return normalized ? normalized.split(" ") : [];
}

function tokenOverlap(left, right) {
  const rightSet = new Set(right);
  return left.filter((token) => rightSet.has(token)).length;
}

function matchScore(companyName, instrumentName) {
  const companyTokens = tokenizeCompanyName(companyName);
  const instrumentTokens = tokenizeCompanyName(instrumentName);
  if (!companyTokens.length || !instrumentTokens.length) return 0;

  const companyNormalized = companyTokens.join(" ");
  const instrumentNormalized = instrumentTokens.join(" ");
  if (companyNormalized === instrumentNormalized) return 1;

  const overlap = tokenOverlap(companyTokens, instrumentTokens);
  const companyCoverage = overlap / companyTokens.length;
  const instrumentCoverage = overlap / instrumentTokens.length;
  const firstTokenMatches = companyTokens[0] === instrumentTokens[0];

  if (firstTokenMatches && companyCoverage === 1 && instrumentCoverage >= 0.5) return 0.94;
  if (firstTokenMatches && companyCoverage >= 0.75 && instrumentCoverage >= 0.75) return 0.9;
  if (
    firstTokenMatches &&
    companyCoverage >= 0.75 &&
    instrumentCoverage >= 0.5 &&
    (companyNormalized.includes(instrumentNormalized) || instrumentNormalized.includes(companyNormalized))
  ) {
    return 0.86;
  }

  return 0;
}

function isFinnishShare(row) {
  return row?.assetClass === "SHARES" && row?.currency === "EUR" && String(row?.isin || "").startsWith("FI");
}

export function selectBestInstrument(companyName, rows = []) {
  const candidates = rows
    .filter(isFinnishShare)
    .map((row) => ({
      row,
      score: matchScore(companyName, row.fullName)
    }))
    .filter((candidate) => candidate.score >= MIN_MATCH_SCORE)
    .sort((a, b) => b.score - a.score || String(a.row.fullName).localeCompare(String(b.row.fullName)));

  if (!candidates.length) return null;
  return {
    ...candidates[0].row,
    matchScore: candidates[0].score
  };
}

function flattenSearchResults(json) {
  return (json?.data?.data ?? [])
    .flatMap((group) => group.instruments ?? [])
    .filter(isFinnishShare);
}

async function fetchNordicShareRows() {
  const url = `${NFIN_BASE}/nordic/screener/shares`;
  const json = await fetchJson(url);
  return {
    rows: json?.data?.data?.instrumentListing?.rows ?? [],
    sourceUrl: url,
    asOf: json?.meta?.freshness?.as_of || json?.meta?.generated_at || ""
  };
}

async function searchNordicShares(companyName) {
  const query = encodeURIComponent(normalizeCompanyName(companyName).split(" ").slice(0, 3).join(" ") || companyName);
  const url = `${NFIN_BASE}/nordic/search?q=${query}`;
  const json = await fetchJson(url);
  return {
    rows: flattenSearchResults(json),
    sourceUrl: url,
    asOf: json?.meta?.freshness?.as_of || json?.meta?.generated_at || ""
  };
}

function nfinSummaryUrl(orderbookId) {
  return `${NFIN_BASE}/nordic/instruments/${encodeURIComponent(orderbookId)}/summary`;
}

async function fetchNfinSummary(instrument) {
  const url = nfinSummaryUrl(instrument.orderbookId);
  const json = await fetchJson(url);
  const summary = json?.data?.data?.summaryData ?? {};
  return {
    url,
    asOf: json?.meta?.freshness?.as_of || json?.meta?.generated_at || "",
    marketName: summary.marketName?.value || "",
    marketCap: summary.marketCap?.value || "",
    sectorName: summary.sectorName?.value || "",
    segment: summary.insSegment?.value || "",
    weekChange: parsePercent(summary.sharePriceChangeWeek?.value),
    monthChange: parsePercent(summary.sharePriceChangeMonth?.value),
    threeMonthChange: parsePercent(summary.sharePriceChange3Month?.value),
    sixMonthChange: parsePercent(summary.sharePriceChange6Month?.value),
    yearChange: parsePercent(summary.sharePriceChangeYear?.value)
  };
}

function parsePercent(value) {
  const parsed = Number.parseFloat(String(value || "").replace("%", "").replace("+", "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function toYahooSymbol(symbol) {
  const normalized = String(symbol || "")
    .toUpperCase()
    .replace(/\s+/g, "-")
    .replace(/[^A-Z0-9.-]/g, "");
  return normalized ? `${normalized}.HE` : "";
}

function yahooChartUrl(yahooSymbol) {
  return `${YAHOO_CHART_BASE}/${encodeURIComponent(yahooSymbol)}?range=3mo&interval=1d`;
}

export function extractYahooPoints(json) {
  const result = json?.chart?.result?.[0];
  const timestamps = result?.timestamp ?? [];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  return timestamps
    .map((timestamp, index) => ({
      date: new Date(timestamp * 1000).toISOString().slice(0, 10),
      close: Number(closes[index])
    }))
    .filter((point) => point.date && Number.isFinite(point.close) && point.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchYahooHistory(instrument) {
  const yahooSymbol = toYahooSymbol(instrument.symbol);
  if (!yahooSymbol) return null;
  const url = yahooChartUrl(yahooSymbol);
  const json = await fetchJson(url);
  const points = extractYahooPoints(json);
  if (points.length < 8) return null;
  return {
    yahooSymbol,
    url,
    asOf: json?.chart?.result?.[0]?.meta?.regularMarketTime
      ? new Date(json.chart.result[0].meta.regularMarketTime * 1000).toISOString()
      : "",
    points
  };
}

function pctChange(start, end) {
  if (!start || !end || start === 0) return null;
  return ((end - start) / start) * 100;
}

function average(points) {
  if (!points.length) return 0;
  return points.reduce((sum, point) => sum + point.close, 0) / points.length;
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return "n/a";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

export function analyzePriceMomentum(points) {
  const clean = [...points]
    .filter((point) => point?.date && Number.isFinite(point.close) && point.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (clean.length < 8) {
    return { hasSignal: false, reason: "not enough daily prices" };
  }

  const trendWindowSize = Math.min(30, clean.length);
  const trendWindow = clean.slice(-trendWindowSize);
  const jumpWindow = clean.slice(-Math.min(45, clean.length));
  const first = trendWindow[0];
  const last = trendWindow[trendWindow.length - 1];
  const windowChangePct = pctChange(first.close, last.close);

  let positiveDays = 0;
  let maxOneDayJumpPct = Number.NEGATIVE_INFINITY;
  let maxOneDayJumpDate = "";
  for (let index = 1; index < trendWindow.length; index += 1) {
    const dailyChange = pctChange(trendWindow[index - 1].close, trendWindow[index].close);
    if (dailyChange >= 0) positiveDays += 1;
    if (dailyChange > maxOneDayJumpPct) {
      maxOneDayJumpPct = dailyChange;
      maxOneDayJumpDate = trendWindow[index].date;
    }
  }

  let maxFiveDayJumpPct = Number.NEGATIVE_INFINITY;
  let maxFiveDayJumpStart = "";
  let maxFiveDayJumpEnd = "";
  for (let index = 5; index < jumpWindow.length; index += 1) {
    const rollingChange = pctChange(jumpWindow[index - 5].close, jumpWindow[index].close);
    if (rollingChange > maxFiveDayJumpPct) {
      maxFiveDayJumpPct = rollingChange;
      maxFiveDayJumpStart = jumpWindow[index - 5].date;
      maxFiveDayJumpEnd = jumpWindow[index].date;
    }
  }

  const positiveRatio = trendWindow.length > 1 ? positiveDays / (trendWindow.length - 1) : 0;
  const lastTenAverage = average(trendWindow.slice(-Math.min(10, trendWindow.length)));
  const sustainedGrowth = windowChangePct >= 8 && positiveRatio >= 0.55 && last.close >= lastTenAverage * 0.97;
  const bigJump = windowChangePct >= 0 && (maxOneDayJumpPct >= 8 || maxFiveDayJumpPct >= 15);

  return {
    hasSignal: sustainedGrowth || bigJump,
    sustainedGrowth,
    bigJump,
    trendDays: trendWindow.length,
    startDate: first.date,
    endDate: last.date,
    startClose: first.close,
    endClose: last.close,
    windowChangePct,
    positiveRatio,
    maxOneDayJumpPct,
    maxOneDayJumpDate,
    maxFiveDayJumpPct,
    maxFiveDayJumpStart,
    maxFiveDayJumpEnd
  };
}

function marketSignal(company, instrument, summary, history, momentum) {
  const signalType = momentum.sustainedGrowth
    ? "listed_market_sustained_growth"
    : "listed_market_jump";
  const marketBits = [
    summary?.marketName || "Nasdaq Helsinki",
    summary?.segment,
    summary?.sectorName,
    summary?.marketCap ? `market cap ${summary.marketCap}` : ""
  ].filter(Boolean).join(", ");
  const jumpDetail = momentum.maxOneDayJumpPct >= 8
    ? `largest one-day jump ${formatPercent(momentum.maxOneDayJumpPct)} on ${momentum.maxOneDayJumpDate}.`
    : `largest five-session move ${formatPercent(momentum.maxFiveDayJumpPct)} from ${momentum.maxFiveDayJumpStart} to ${momentum.maxFiveDayJumpEnd}.`;

  return {
    id: stableHash([businessId(company), signalType, instrument.symbol, momentum.endDate, momentum.windowChangePct]),
    businessId: businessId(company),
    companyName: currentName(company),
    type: signalType,
    label: momentum.sustainedGrowth ? "Listed market sustained growth" : "Listed market jump",
    date: momentum.endDate,
    title: `${currentName(company)} has listed-share momentum`,
    detail: [
      `${history.yahooSymbol} rose ${formatPercent(momentum.windowChangePct)} from ${momentum.startDate} to ${momentum.endDate}.`,
      `Positive sessions: ${Math.round(momentum.positiveRatio * 100)}% over ${momentum.trendDays} trading days.`,
      jumpDetail,
      `Selected because this is a public market growth/attention signal for a region-registered listed company.`,
      marketBits ? `nfin match: ${instrument.fullName} (${marketBits}).` : `nfin match: ${instrument.fullName}.`
    ].join(" "),
    sourceName: SOURCE_NAME,
    sourceUrl: history.url,
    confidence: "public-market-data",
    weight: momentum.sustainedGrowth && momentum.bigJump ? 42 : momentum.sustainedGrowth ? 38 : 34,
    metadata: {
      instrumentName: instrument.fullName,
      nfinSymbol: instrument.symbol,
      yahooSymbol: history.yahooSymbol,
      orderbookId: instrument.orderbookId,
      isin: instrument.isin,
      currency: instrument.currency,
      matchScore: instrument.matchScore,
      nfinSummaryUrl: summary?.url || "",
      nfinSummaryAsOf: summary?.asOf || "",
      yahooAsOf: history.asOf,
      weekChange: summary?.weekChange,
      monthChange: summary?.monthChange,
      threeMonthChange: summary?.threeMonthChange,
      sixMonthChange: summary?.sixMonthChange
    }
  };
}

function looksLikePublicLimitedCompany(companyName) {
  return /\boyj\b|\babp\b/i.test(companyName);
}

export async function analyzeListedCompanyMomentum(companies, options = {}) {
  const limit = Number.parseInt(options.limit, 10) || 250;
  const targets = companies.slice(0, limit);
  const signalsMap = new Map();
  const errors = [];
  const stats = {
    checked: targets.length,
    instrumentsLoaded: 0,
    matched: 0,
    searchFallbacks: 0,
    historyFetched: 0,
    signals: 0,
    sustainedSignals: 0,
    jumpSignals: 0
  };

  let shareRows = [];
  try {
    const screener = await fetchNordicShareRows();
    shareRows = screener.rows;
    stats.instrumentsLoaded = shareRows.length;
  } catch (error) {
    return {
      map: signalsMap,
      stats,
      errors: [{ source: "nfin.dev Nordic screener", city: "market", message: error.message }],
      status: "error"
    };
  }

  for (const company of targets) {
    const name = currentName(company);
    let instrument = selectBestInstrument(name, shareRows);

    if (!instrument && looksLikePublicLimitedCompany(name) && stats.searchFallbacks < 20) {
      try {
        const search = await searchNordicShares(name);
        stats.searchFallbacks += 1;
        instrument = selectBestInstrument(name, search.rows);
      } catch (error) {
        errors.push({ source: "nfin.dev Nordic search", city: name, message: error.message });
      }
    }

    if (!instrument) continue;
    stats.matched += 1;

    try {
      const [summary, history] = await Promise.all([
        fetchNfinSummary(instrument),
        fetchYahooHistory(instrument)
      ]);
      if (!history) continue;

      stats.historyFetched += 1;
      const momentum = analyzePriceMomentum(history.points);
      if (!momentum.hasSignal) continue;

      const signal = marketSignal(company, instrument, summary, history, momentum);
      signalsMap.set(businessId(company), [signal]);
      stats.signals += 1;
      if (momentum.sustainedGrowth) stats.sustainedSignals += 1;
      if (momentum.bigJump) stats.jumpSignals += 1;
    } catch (error) {
      errors.push({ source: "listed market data", city: name, message: error.message });
    }
  }

  return {
    map: signalsMap,
    stats,
    errors,
    status: errors.length && stats.signals === 0 ? "partial" : "ok"
  };
}
