# Repository Guidance

This repository is a no-login Finnish market lead radar for Novapolis warm lead generation.

## Truth Rules

- Do not invent employee counts, decision makers, emails, phone numbers, investment rounds, or hiring claims.
- Every lead signal must have a source name, source URL, date when available, and confidence level.
- PRH/YTJ data is official but incomplete for sales outreach.
- PRH/XBRL financial statements are the preferred source for official employee counts when a digital statement exists.
- Search modes are mutually exclusive per run: new/changed companies, medium/large companies, or listed-market growth.
- Claude may verify and summarize evidence, but it must not create unsourced facts.

## Agent Roles

- Source verifier: owns PRH/YTJ/registered-notice integrations in `server/agents/prhSourceAgent.js`.
- Financials agent: owns PRH/XBRL employee-count extraction in `server/agents/financialStatementAgent.js`.
- Virre extract agent: owns free Virre Trade Register PDF download and board/CEO parsing in `server/agents/virreAgent.js`.
- Website discovery agent: owns zero-key official website candidate generation and fetched-page verification in `server/agents/websiteDiscoveryAgent.js`.
- Current employee search agent: owns zero-key employee-count URL discovery and company-owned source extraction in `server/agents/currentEmployeeSearchAgent.js`.
- Enrichment integrator: owns public website enrichment in `server/agents/enrichmentAgent.js`.
- Listed-market agent: owns free public Nasdaq Helsinki matching and price-momentum checks in `server/agents/listedMarketAgent.js`.
- Scoring analyst: owns Novapolis lead scoring in `server/agents/scoringAgent.js`.
- Claude verifier: owns optional API evidence checking in `server/agents/claudeVerifierAgent.js`.
- Growth analyst: owns growth and jump detection in `server/agents/companyGrowthAgent.js`.
- Newsletter/memory maintainer: owns dedupe and daily summary in `server/agents/memoryAgent.js` and `server/agents/newsletterAgent.js`.

## Commands

```bash
npm run dev
npm test
npm run build
```

## Demo Defaults

- Frontend: `http://127.0.0.1:5173`
- API: `http://127.0.0.1:8787`
- Default market area: `kuopio-hub`
- Default search mode: `new-changes`
- Default company form: `ANY`
- Default focus: `all`
- Reset demo memory with `POST /api/memory/reset`.
