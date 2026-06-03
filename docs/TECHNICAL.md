# Novapolis Lead Radar Technical Documentation

## Purpose

Novapolis Lead Radar is a no-login local web app for Finnish market lead discovery. It combines official PRH/YTJ data, PRH XBRL financial statements, public Virre extracts, verified company websites and optional Claude review. Claude is only a verifier and summarizer; sourced agents collect the evidence first.

## Runtime

- Frontend: React + Vite, served on `http://127.0.0.1:5173` in development.
- Backend: Express, served on `http://127.0.0.1:8787`.
- Database: local SQLite through Node's built-in `node:sqlite` module.
- Required Node version: `>=22.5.0`.
- Default database path: `data/novapolis.sqlite`.
- Override database path with `NOVAPOLIS_DB_PATH`.

## Commands

```bash
npm install
npm run dev
npm test
npm run build
```

## Main Modules

- `server/index.js`: Express routes, static frontend serving and prefetch scheduler startup.
- `server/agents/orchestrator.js`: central radar pipeline and response assembly.
- `server/agents/prhSourceAgent.js`: official PRH/YTJ company and notice collection.
- `server/agents/financialStatementAgent.js`: PRH/XBRL employee-count extraction and official financial scale proxy extraction.
- `server/agents/virreAgent.js`: free Virre extract PDF download and board/CEO parsing.
- `server/agents/websiteDiscoveryAgent.js`: official website candidate generation and verification.
- `server/agents/currentEmployeeSearchAgent.js`: company-owned employee-count source discovery.
- `server/agents/enrichmentAgent.js`: public website enrichment integration.
- `server/agents/listedMarketAgent.js`: Nasdaq Helsinki match, share-price momentum checks and Yahoo Finance listed-company employee fallback.
- `server/agents/companyGrowthAgent.js`: growth and jump detection.
- `server/agents/companyCacheAgent.js`: enrichment cache persistence.
- `server/agents/memoryAgent.js`: seen signal and displayed company persistence.
- `server/lib/database.js`: SQLite connection, pragmas, schema creation and transaction helper.

## API

```text
GET  /api/health
GET  /api/radar
GET  /api/prefetch/status
POST /api/prefetch/run?force=true
POST /api/cache/reset
POST /api/memory/reset
```

`GET /api/radar` accepts query parameters from the UI, including `marketMode`, `region`, `days`, `visibility`, `useCache`, enrichment toggles, listed-market toggles and Claude toggles.

## Search Modes

Search modes are mutually exclusive per run:

- `new-changes`: recent registrations, official changes and registered notices.
- `mid-market`: existing `Oy`/`Oyj` companies with sourced `50-249` employee counts or mid-market financial scale proxy.
- `large-opportunities`: existing companies with sourced `250-999` employee counts or large financial scale proxy.
- `enterprise-watch`: existing companies with sourced `1000+` employee counts or enterprise-watch financial scale proxy.
- `listed-growth`: region-registered `Oyj` companies matched to Nasdaq Helsinki and checked for public price momentum.

## Pipeline

1. Normalize query options.
2. Fetch official PRH/YTJ market data, or serve an exact fresh source snapshot from SQLite.
3. Build base leads and official signals.
4. Filter known signals before enrichment unless the mode needs employee counts first.
5. Read enrichment cache rows for candidate Business IDs.
6. Run live enrichment only for cache misses or stale rows.
7. Save fresh enrichment to SQLite.
8. Build scored leads with source-backed evidence. Employee-count evidence takes precedence over financial scale proxy.
9. Apply growth detection using the latest SQLite snapshot.
10. Apply display memory, then optionally verify only the final visible top leads with Claude.
11. Apply memory and visibility rules.
12. Return totals, pipeline diagnostics, sources, newsletter text and lead cards.

## Database Schema

The app creates tables automatically on backend startup. Existing JSON files are not migrated; runtime data is collected from scratch.

### `app_metadata`

Stores small key-value metadata, currently cache update timestamps.

### `seen_signals`

Tracks displayed signal IDs.

Important columns:

- `id`: stable signal ID, primary key.
- `first_seen_at`: first display time.
- `business_id`, `company_name`, `type`, `title`, `source_url`: audit metadata.

### `displayed_companies`

Tracks company-level display history.

Important columns:

- `business_id`: primary key.
- `company_name`.
- `first_displayed_at`.
- `last_displayed_at`.

### `company_growth_snapshots`

Stores the latest growth metrics per company.

Important columns:

- `business_id`: primary key.
- `snapshot_at`.
- `score`, `signal_count`, `important_notices`.
- `official_signals`, `external_signals`, `contacts`.
- `employee_count`.
- financial scale proxy fields are stored inside `company_enrichment_cache.enrichment_json` when available.
- `consecutive_growth_runs`.

### `company_enrichment_cache`

Stores fetched enrichment per Business ID.

Important columns:

- `business_id`: primary key.
- `company_name`.
- `fetched_at`.
- `last_modified`.
- `website`.
- `employee_count`.
- `employee_count_source_url`.
- `contact_source_url`.
- `enrichment_json`: full enrichment payload used by the pipeline.

### `official_market_cache`

Stores exact 12-hour source snapshots for PRH/YTJ market queries.

Important columns:

- `cache_key`: hash of mode, region, range, company forms and page limit.
- `fetched_at`.
- `market_mode`, `region`.
- `payload_json`: full source-agent response.

### `company_cache_runs`

Append-only cache refresh audit log.

Important columns:

- `at`.
- `saved`.
- `checked`.
- `market_mode`.
- `region`.
- `source`: `radar`, `prefetch` or test/source label.

### `company_cache_daily_journal`

Daily cache summary used to decide whether fast cache-only mode can run.

Important columns:

- `date`.
- `first_updated_at`.
- `updated_at`.
- `saved`.
- `checked`.

### `company_cache_daily_values`

Normalized daily journal dimensions.

Important columns:

- `date`.
- `kind`: `mode`, `region` or `source`.
- `value`.

## Cache Behavior

Default enrichment TTL is seven days. A stricter 12-hour freshness window is used to skip live endpoints. If `Use cached enrichment` is enabled, the source agent first checks `official_market_cache` for an exact fresh query snapshot. If it exists, PRH/YTJ source endpoints are skipped for that query. If the enrichment cache was also updated within the last 12 hours, the radar enters fast cache-only mode:

- cached companies are enriched from SQLite only when their own `fetched_at` is also younger than 12 hours,
- missing or stale companies are skipped for speed,
- Virre, website discovery, current-employee search, Yahoo employee fallback and listed-market momentum endpoints are not called for skipped entries,
- listed-growth mode rebuilds signals from cached `listedMarketSignals`,
- turning off `Use cached enrichment` forces live enrichment.

Background prefetch runs with `recordDisplay=false`, so it can warm cache without marking companies as shown in the UI. It uses the same 12-hour freshness window. Listed-company Yahoo employee fallbacks and listed-market signals are stored in `company_enrichment_cache.enrichment_json` for later cache-only reuse.

Forced prefetch (`POST /api/prefetch/run?force=true`) sets `refreshCache=true` on each radar run. That bypasses source snapshot reads and enrichment cache reads, calls live endpoints again, and writes the refreshed data back to SQLite.

## Financial Scale Proxy

When a PRH/XBRL digital financial statement has no employee/personnel fact, the financials agent checks official statement facts for:

- net sales / revenue,
- balance sheet total / total assets,
- personnel expenses.

The proxy segments are intentionally conservative:

- `mid_market_proxy`: financial scale suggests a mid-market candidate.
- `large_opportunity_proxy`: financial scale suggests a large candidate.
- `enterprise_watch_proxy`: financial scale suggests enterprise-watch treatment.

This proxy is used only for search and prioritization. It is not an employee count, not proof of hiring, and not a team-size claim. If both employee count and financial proxy exist, employee count controls the employee segment.

## Listed Employee Fallback

For matched listed companies, the listed-market agent also calls Yahoo Finance quoteSummary:

```text
https://query1.finance.yahoo.com/v10/finance/quoteSummary/{SYMBOL}.HE?modules=assetProfile
```

When `assetProfile.fullTimeEmployees` is present, it is added as fallback enrichment:

- source name: `Yahoo Finance quoteSummary assetProfile`,
- confidence: `public-market-profile`,
- evidence: `assetProfile.fullTimeEmployees=...`,
- only used when PRH/XBRL or company-owned employee evidence is missing.

This source is not official PRH data. It is useful for listed-company completeness but must remain labeled as public market profile data.

In live listed-growth and prefetch runs, listed-market signals are attached to the enrichment cache as `listedMarketSignals`. Cache-only listed-growth reads those stored signals instead of calling nfin/Yahoo again.

## Claude Verification Scope

Claude is called after memory filtering, not on the full candidate pool. The verifier receives:

- final visible leads only,
- at most `claudeLimit`,
- a hard maximum of 12 leads,
- Business IDs in the payload and response metadata for auditability.

If no visible lead remains after memory filtering, Claude is not called.

## Website Candidate Generation

Website discovery removes Finnish legal suffixes such as `Oy` and `Oyj` before generating domain candidates. It keeps brand words such as `Group`, then also tries shorter variants. Primary candidates are generated for `.fi` and `.com` before secondary `.net` and `.eu` variants. Example:

```text
Eagle Filters Group Oyj
eaglefiltersgroup.fi
eaglefiltersgroup.com
eaglefilters.fi
eaglefilters.com
```

## Reset Behavior

- `POST /api/cache/reset`: clears official source snapshots, enrichment cache tables, cache run history, daily journal and cache timestamp metadata.
- `POST /api/memory/reset`: clears seen signals, displayed companies and growth snapshots.

## Evidence Rules

- Do not invent employee counts, contacts, hiring, investment, phone numbers, emails or decision makers.
- Every lead signal must carry source name, source URL, date when available and confidence.
- PRH/YTJ is official but incomplete for outreach fields.
- PRH/XBRL is preferred for official employee counts when a digital statement contains the fact.
- PRH/XBRL financial scale proxy can support medium/large search when employee count is missing, but it must remain labeled as proxy evidence.
- Virre decision makers are official only when parsed from the generated Trade Register extract PDF.
- Listed-market momentum is a market-attention signal, not proof of hiring or operational expansion.
- Missing facts stay visibly missing.

## Testing Notes

`test/persistenceDatabase.test.js` sets `NOVAPOLIS_DB_PATH` to an isolated temporary SQLite file. This keeps tests from touching the demo database.
