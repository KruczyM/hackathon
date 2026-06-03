# Novapolis Lead Radar

No-login prototype for Novapolis Hackathon challenge 1: warm lead generation.

The app runs an automated agent pipeline:

1. Source agent: gets official Finnish company data and change notices from PRH/YTJ.
2. Financials agent: reads PRH/XBRL digital financial statements and extracts official employee-count facts when available.
3. Virre agent: downloads free official Trade Register extract PDFs and parses board/CEO names.
4. Website discovery agent: guesses likely company domains and verifies fetched pages by Business ID/name/address evidence.
5. Enrichment agent: scans verified company websites for public contacts and people.
6. Current employee search agent: when enabled, uses zero-key web search as a URL hint and extracts current employee counts only from fetched company-owned pages or PDFs.
7. Listed-market agent: automatically matches region-registered `OYJ` companies to Finnish listed shares and checks recent public price momentum.
8. Growth agent: detects companies with current momentum, jump signals or repeated growth across runs.
9. Claude verifier: optional, checks the top leads and writes a grounded pitch from collected evidence only.
10. Cache agent: stores sourced enrichment per Business ID so repeated searches can reuse employee/contact/Virre/website data.
11. Memory agent: stores seen signal IDs and displayed companies separately so background prefetch does not hide leads from users.

The UI exposes one search mode at a time:

- `New / changed`: recent company registrations, official PRH updates and registered notices.
- `Mid-market`: existing `Oy`/`Oyj` companies with sourced `50-249` employee counts.
- `Large opportunities`: existing companies with sourced `250-999` employee counts.
- `Enterprise watch`: existing companies with sourced `1000+` employee counts, kept separate from core hot leads.
- `Listed growth`: region-registered `Oyj` companies matched to Nasdaq Helsinki, then Yahoo Finance daily prices are checked for sustained growth or a large jump.

## Run

```bash
npm install
npm run dev
```

Requires Node.js `22.5.0` or newer because the backend uses the built-in `node:sqlite` module.

Open `http://127.0.0.1:5173`.

The backend listens on `http://127.0.0.1:8787`.

In development there are two local URLs because Vite serves the React frontend on `5173`, while the Express API runs separately on `8787`. In production/start mode the backend serves the built frontend from `http://127.0.0.1:8787`.

Technical architecture, database schema and API notes are documented in [`docs/TECHNICAL.md`](docs/TECHNICAL.md).

## Defaults

- Market area: Kuopio hub.
- Search mode: New / changed.
- Company form: all.
- Sector focus: all sectors.
- Public website enrichment: on.
- Website discovery: on for the top 12 scanned leads, no search API key required.
- PRH/XBRL financial statement employee count: on for scanned leads.
- Current employee web search: off by default; enable `Agent employee search` when you want deeper employee-count discovery from company-owned pages/PDFs.
- Virre Trade Register extract scan: on for the top 12 scanned leads.
- Listed-market scan: on only when `Listed growth` mode is selected, no ticker entry required.
- Claude verification: off until `ANTHROPIC_API_KEY` is set and the UI toggle is enabled.
- Company enrichment cache: on by default.
- Background Finland prefetch: starts after backend startup unless `PREFETCH_ON_START=false`.
- Local database: `data/novapolis.sqlite` unless `NOVAPOLIS_DB_PATH` is set.

Virre PDF scanning and website discovery do not require Claude. They run as deterministic source collection steps in the pipeline. Claude is only an optional reviewer/summarizer after evidence has already been collected.

## Official Employee Counts

PRH/YTJ does not return a raw employee count in the normal company response. The app calls PRH XBRL Open Data:

- `/financials?businessId=...` to find available digital financial statement periods.
- `/financial?businessId=...&financialDate=...` to retrieve the XML financial statement.

The financials agent then searches the XML facts for employee/personnel count facts. When found, this is shown as `PRH XBRL financial statement` and takes priority over website employee estimates.

## Current Employee Web Search

When `Agent employee search` is enabled, the app runs an extra current-employee search:

- It searches phrases like `"Company Oy" työntekijät`, `"Company Oy" henkilöstö`, and `"Company Oy" employees`.
- It uses search results only to discover candidate URLs.
- It rejects directories, social networks and register mirrors as final employee-count sources.
- It accepts a number only after fetching a company-owned page or PDF and matching employee/personnel wording near the number.

This is useful for more current headcount evidence than annual PRH/XBRL statements, but it is treated as sourced public-web evidence, not official register data.

## Virre Decision Makers

The app uses the free public Virre company search flow to download the generated Trade Register extract PDF for each top lead. It then parses the Finnish sections:

- `Hallitus` for board chair, vice chair, board members and deputy members.
- `Toimitusjohtaja` for managing director / CEO.

The PDF contains birth dates, but the app uses them only as parsing delimiters and does not store or display them. Returned people are shown as `PRH Virre Trade Register extract` with the Virre source URL, extract date when available and evidence text. The same Virre detail page is also used for official website and telephone fields when present.

No paid API key or manual company input is required. If Virre changes its HTML/PDF layout or rate-limits the public flow, the agent records an error and the rest of the radar still runs.

## Contact Data

The app no longer uses paid enrichment providers. Contacts are extracted only from official Virre details and public company websites listed in official PRH records. That means many firms will still show `missing source` if Virre/PRH has no website or telephone and the website does not publish a person/email/phone.

## Website Discovery

The website discovery agent uses only free, no-key checks:

- If PRH or Virre already returns a website, the app fetches it and keeps source metadata visible.
- Virre PDF/details are collected before website discovery for the top scanned leads, so discovered website checks can use Virre decision makers and Virre website fields as supporting context.
- If no website is returned, the app generates likely domains from the legal company name and auxiliary names, for example `Borealis Acute Operations Oy` can produce `borealisacuteoperations.fi`, `borealisacute.fi`, `.com`, `.net`, and `.eu` variants.
- Candidate pages are fetched from homepage/contact/about/company paths.
- A site is accepted as verified only when fetched page evidence matches the company, preferably exact `Y-tunnus` / Business ID. Company name, auxiliary name, address, city, decision maker name and matching email domain add supporting confidence.
- Commercial directories, social networks and register mirrors are not treated as official websites.

Search-engine snippets are not used as final facts. If no candidate page contains strong evidence, website remains `missing source`.

## Safer Lead Scoring

The score is capped at `0-100` and separates company size from growth/hiring evidence:

- `companySizeEstimate`: `1-10`, `11-50`, `51-200`, `200+`, or `unknown`.
- `employeeSegment`: `mid_market`, `large_opportunity`, `enterprise_watch`, `enterprise`, or smaller/unknown segments.
- `growthHiringSignal`: `none`, `weak`, `medium`, or `strong`.
- `outreachReadiness`: `Ready`, `Needs verification`, or `Blocked`.
- `dataConfidence`: `High`, `Medium`, or `Low`.

A decision maker from Virre is useful evidence, but it is not a public business contact channel by itself. If there is no verified public email/phone/contact channel, the lead stays `Needs verification` and cannot become `Hot` purely from new-company or Virre-person evidence. Missing employee count adds an explicit `unknown` size estimate and prevents pitch claims like `small team`, `growing team`, or `hiring`.

Enterprise companies (`1000+`, especially `5000+`) are treated differently from normal warm leads. They can still be useful for satellite offices, meeting rooms, local projects, events or employee services, but they are capped unless there is sourced growth/contact evidence.

## Visibility, Cache And Prefetch

The UI has three visibility modes:

- `New signals for known companies`: default daily radar view.
- `Only never displayed companies`: hides every company that has already been shown to the user.
- `Include already shown`: inspection/debug mode.

The app stores runtime state in a local SQLite database at `data/novapolis.sqlite`:

- `seen_signals`: signal IDs already shown to the user.
- `displayed_companies`: companies already displayed in the UI.
- `company_growth_snapshots`: latest growth metrics by Business ID.
- `company_enrichment_cache`: cached enrichment facts by Business ID.
- `company_cache_runs` and `company_cache_daily_journal`: cache refresh audit data.

The previous `data/*.json` files are no longer read by the application. New data is collected from scratch into SQLite.

When `Use cached enrichment` is enabled and the cache journal shows that enrichment was refreshed today, the radar runs in fast cache-only mode for enrichment: it compares candidate Business IDs against SQLite cache rows, returns stored enrichment for cached companies, and skips live Virre/website/web enrichment for missing or stale entries. Turn off `Use cached enrichment` to force a live refresh.

Background prefetch runs `whole-finland` scans for the configured modes and writes cache, but it calls the radar with `recordDisplay=false`. That means prefetched companies are not marked as displayed, so the next user search can still show them as fresh results.

Useful endpoints:

```text
GET  /api/prefetch/status
POST /api/prefetch/run?force=true
POST /api/cache/reset
POST /api/memory/reset
```

`POST /api/cache/reset` clears enrichment cache tables. `POST /api/memory/reset` clears displayed-company memory and growth snapshots.

## Listed-Market Growth

The app uses only free, no-key public sources for listed-company momentum:

- PRH/YTJ searches `OYJ` companies in the selected region without a date filter so older public companies can still be checked when `Listed growth` mode is selected.
- nfin.dev Nasdaq Nordic API loads Finnish listed shares and validates the PRH company-to-instrument match.
- Yahoo Finance chart API is used for daily `.HE` price history after the ticker is derived automatically from the Nasdaq Helsinki symbol.

The listed-market agent adds a signal only when daily history supports either:

- sustained growth: at least `+8%` over the recent trading window, at least `55%` positive sessions, and the latest close still near the short average,
- a jump: at least `+8%` in one day or `+15%` across five trading sessions.

Price momentum is treated as a market-attention signal, not proof of hiring, revenue growth, funding or office expansion. Claude may explain the sourced price movement, but it must not infer unsourced operational claims.

## Size Segment Modes

Size segment modes do not use the recent-registration date filter. They pull existing `Oy`/`Oyj` companies from the selected area, run enrichment/cache on the pre-ranked candidate pool, and keep companies only when sourced employee evidence matches the selected segment:

- `Mid-market`: `50-249`.
- `Large opportunities`: `250-999`.
- `Enterprise watch`: `1000+`.

The employee-count source URL remains visible in the final lead card.

## Windows Autostart

Install Windows login autostart:

```powershell
npm run autostart:install
```

Remove it:

```powershell
npm run autostart:uninstall
```

The task starts the backend through `npm start`, opens `http://127.0.0.1:8787`, and the backend warms the Finland cache in the background.

## Claude Test With A Small Budget

1. Create an Anthropic account and API key.
2. Copy `.env.example` to `.env`.
3. Put the key in `ANTHROPIC_API_KEY`.
4. Save `.env` in the project root, next to `package.json`.
5. Restart `npm run dev`.
6. In the UI, enable `Claude verify top leads`.
7. Keep `claudeLimit` at 5 for testing.

Claude does not fetch private contact databases by itself. It verifies and improves lead reasoning from evidence collected by the source and enrichment agents.

## Growth Detection

The growth agent stores the latest snapshot per company in `company_growth_snapshots`.

It marks a company when:

- the company has multiple important fresh PRH notices in the current run,
- its lead score or signal count jumps compared with the previous snapshot,
- employee count grows compared with the previous sourced employee count,
- it grows across repeated runs.

Each growth signal is displayed as `Selected because: ...` so the reason for choosing the company is visible.

## Truth Rules

- PRH/YTJ is official but does not provide open company emails or phone numbers.
- PRH/XBRL employee count is official only when a digital financial statement contains the relevant employee/personnel fact.
- Virre responsible people are official only when extracted from the generated Trade Register extract PDF; birth dates from the PDF are not displayed.
- Listed-market signals must include the matched instrument, price-history source URL, date and confidence.
- The app never invents employee count, contacts, people, investments or hiring.
- Missing data remains `missing source`.
- Every displayed contact or employee count should include a source URL.

## Remaining Backlog From The TXT Notes

The remaining useful additions are:

- Tyomarkkinatori / Job Market Finland hiring signals by region and role type. This should stay out of the zero-config pipeline until the official retrieval interface can be used without manual KEHA credentials or the company accepts that one extra free API credential is needed.
- Business Finland, city pages, ELY centres, universities/UAS and incubator pages for expansion/funding/partnership news.

Those sources should be added as evidence collectors before Claude, so Claude classifies and summarizes collected evidence instead of browsing freely or inventing facts.
