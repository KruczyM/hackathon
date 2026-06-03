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
- `server/agents/financialStatementAgent.js`: PRH/XBRL employee-count extraction.
- `server/agents/virreAgent.js`: free Virre extract PDF download and board/CEO parsing.
- `server/agents/websiteDiscoveryAgent.js`: official website candidate generation and verification.
- `server/agents/currentEmployeeSearchAgent.js`: company-owned employee-count source discovery.
- `server/agents/enrichmentAgent.js`: public website enrichment integration.
- `server/agents/listedMarketAgent.js`: Nasdaq Helsinki match and share-price momentum checks.
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
- `mid-market`: existing `Oy`/`Oyj` companies with sourced `50-249` employee counts.
- `large-opportunities`: existing companies with sourced `250-999` employee counts.
- `enterprise-watch`: existing companies with sourced `1000+` employee counts.
- `listed-growth`: region-registered `Oyj` companies matched to Nasdaq Helsinki and checked for public price momentum.

## Pipeline

1. Normalize query options.
2. Fetch official PRH/YTJ market data.
3. Build base leads and official signals.
4. Filter known signals before enrichment unless the mode needs employee counts first.
5. Read enrichment cache rows for candidate Business IDs.
6. Run live enrichment only for cache misses or stale rows.
7. Save fresh enrichment to SQLite.
8. Build scored leads with source-backed evidence.
9. Apply growth detection using the latest SQLite snapshot.
10. Optionally verify top leads with Claude.
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

Default enrichment TTL is seven days. If the daily cache journal has an entry for today, `Use cached enrichment` enables fast cache-only mode:

- cached companies are enriched from SQLite,
- missing or stale companies are skipped for speed,
- turning off `Use cached enrichment` forces live enrichment.

Background prefetch runs with `recordDisplay=false`, so it can warm cache without marking companies as shown in the UI.

## Reset Behavior

- `POST /api/cache/reset`: clears enrichment cache tables, cache run history, daily journal and cache timestamp metadata.
- `POST /api/memory/reset`: clears seen signals, displayed companies and growth snapshots.

## Evidence Rules

- Do not invent employee counts, contacts, hiring, investment, phone numbers, emails or decision makers.
- Every lead signal must carry source name, source URL, date when available and confidence.
- PRH/YTJ is official but incomplete for outreach fields.
- PRH/XBRL is preferred for official employee counts when a digital statement contains the fact.
- Virre decision makers are official only when parsed from the generated Trade Register extract PDF.
- Listed-market momentum is a market-attention signal, not proof of hiring or operational expansion.
- Missing facts stay visibly missing.

## Testing Notes

`test/persistenceDatabase.test.js` sets `NOVAPOLIS_DB_PATH` to an isolated temporary SQLite file. This keeps tests from touching the demo database.

