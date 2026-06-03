import { runRadar } from "../agents/orchestrator.js";
import { ENDPOINT_SKIP_CACHE_MS, getCompanyCacheStatus } from "../agents/companyCacheAgent.js";

const PREFETCH_FRESH_MS = ENDPOINT_SKIP_CACHE_MS;
const PREFETCH_MODES = (process.env.PREFETCH_MODES || "new-changes,mid-market,large-opportunities,listed-growth")
  .split(",")
  .map((mode) => mode.trim())
  .filter(Boolean);

const state = {
  status: "idle",
  startedAt: "",
  finishedAt: "",
  nextRunAt: "",
  activeMode: "",
  lastError: "",
  lastRun: null,
  runs: []
};

let runningPromise = null;

function prefetchQuery(mode, options = {}) {
  const forceRefresh = options.force === true || options.force === "true";
  return {
    marketMode: mode,
    region: "whole-finland",
    days: 30,
    focus: "all",
    companyForm: "ANY",
    visibility: "include-seen",
    includeSeen: "true",
    recordDisplay: "false",
    useCache: "true",
    refreshCache: forceRefresh ? "true" : "false",
    publicWeb: "true",
    websiteDiscovery: "true",
    websiteDiscoveryLimit: "10",
    virrePeople: "true",
    virreLimit: "10",
    currentEmployeeSearch: "false",
    claude: "false",
    enrichmentLimit: mode === "listed-growth" ? "30" : "45",
    listedLimit: mode === "listed-growth" ? "400" : "0",
    maxPages: mode === "listed-growth" ? "2" : "1"
  };
}

async function shouldRunPrefetch(force) {
  if (force) return true;
  const cache = await getCompanyCacheStatus();
  const updatedAt = Date.parse(cache.updatedAt || "");
  if (!Number.isFinite(updatedAt)) return true;
  return Date.now() - updatedAt > PREFETCH_FRESH_MS;
}

export async function runPrefetchNow(options = {}) {
  if (runningPromise) return runningPromise;

  runningPromise = (async () => {
    const force = options.force === true || options.force === "true";
    if (!(await shouldRunPrefetch(force))) {
      const cache = await getCompanyCacheStatus();
      state.status = "idle";
      state.lastError = "";
      state.nextRunAt = new Date(Date.now() + PREFETCH_FRESH_MS).toISOString();
      state.lastRun = {
        skipped: true,
        reason: `Company cache is still fresh for ${cache.cacheMaxEndpointSkipHours || 12}h endpoint skip.`,
        cacheUpdatedAt: cache.updatedAt,
        totalCompaniesCached: cache.totalCompaniesCached
      };
      const snapshot = statusSnapshot();
      runningPromise = null;
      return snapshot;
    }

    state.status = "running";
    state.startedAt = new Date().toISOString();
    state.finishedAt = "";
    state.lastError = "";
    const run = {
      startedAt: state.startedAt,
      forcedRefresh: force,
      modes: [],
      totalLeadsPrepared: 0,
      totalCacheHits: 0,
      totalCacheSaved: 0
    };

    try {
      for (const mode of PREFETCH_MODES) {
        state.activeMode = mode;
        const result = await runRadar(prefetchQuery(mode, { force }));
        const modeResult = {
          mode,
          forcedRefresh: force,
          finishedAt: new Date().toISOString(),
          leadsPrepared: result.totals.rawLeads || result.totals.leads || 0,
          cacheHits: result.totals.cacheHits || 0,
          cacheSaved: result.totals.cacheSaved || 0,
          companiesReturned: result.totals.companiesReturned || 0,
          listedYahooEmployeeCounts: result.totals.listedYahooEmployeeCounts || 0,
          listedCompaniesMatched: result.totals.listedCompaniesMatched || 0,
          errors: (result.errors || []).slice(0, 6)
        };
        run.modes.push(modeResult);
        run.totalLeadsPrepared += modeResult.leadsPrepared;
        run.totalCacheHits += modeResult.cacheHits;
        run.totalCacheSaved += modeResult.cacheSaved;
      }
      state.status = "idle";
      state.activeMode = "";
      state.finishedAt = new Date().toISOString();
      state.nextRunAt = new Date(Date.now() + PREFETCH_FRESH_MS).toISOString();
      run.finishedAt = state.finishedAt;
      state.lastRun = run;
      state.runs.push(run);
      state.runs = state.runs.slice(-10);
      return statusSnapshot();
    } catch (error) {
      state.status = "error";
      state.activeMode = "";
      state.finishedAt = new Date().toISOString();
      state.lastError = error.message;
      run.finishedAt = state.finishedAt;
      run.error = error.message;
      state.lastRun = run;
      state.runs.push(run);
      state.runs = state.runs.slice(-10);
      return statusSnapshot();
    } finally {
      runningPromise = null;
    }
  })();

  return runningPromise;
}

export async function getPrefetchStatus() {
  return {
    ...statusSnapshot(),
    cache: await getCompanyCacheStatus()
  };
}

export function startPrefetchScheduler() {
  if (process.env.PREFETCH_ON_START === "false") return;
  setTimeout(() => {
    runPrefetchNow().catch((error) => {
      state.status = "error";
      state.lastError = error.message;
    });
  }, 2000);
  setInterval(() => {
    runPrefetchNow().catch((error) => {
      state.status = "error";
      state.lastError = error.message;
    });
  }, PREFETCH_FRESH_MS);
}

function statusSnapshot() {
  return {
    status: state.status,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
    nextRunAt: state.nextRunAt,
    activeMode: state.activeMode,
    lastError: state.lastError,
    lastRun: state.lastRun,
    runs: state.runs,
    modes: PREFETCH_MODES
  };
}
