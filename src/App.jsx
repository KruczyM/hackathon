import { useEffect, useMemo, useState } from "react";

const marketAreas = [
  { value: "whole-finland", label: "Whole Finland", detail: "Major cities from every Finnish region" },
  { value: "kuopio-hub", label: "Kuopio hub", detail: "Kuopio, Siilinjarvi, Iisalmi, Varkaus, Leppavirta, Suonenjoki" },
  { value: "uusimaa", label: "Uusimaa", detail: "Helsinki, Espoo, Vantaa, Porvoo and nearby municipalities" },
  { value: "southwest-finland", label: "Southwest Finland", detail: "Turku, Salo, Kaarina, Naantali and nearby municipalities" },
  { value: "satakunta", label: "Satakunta", detail: "Pori, Rauma, Ulvila, Kankaanpaa and nearby municipalities" },
  { value: "kanta-hame", label: "Kanta-Hame", detail: "Hameenlinna, Riihimaki, Forssa and nearby municipalities" },
  { value: "pirkanmaa", label: "Pirkanmaa", detail: "Tampere, Nokia, Ylojarvi, Valkeakoski and nearby municipalities" },
  { value: "paijat-hame", label: "Paijat-Hame", detail: "Lahti, Hollola, Heinola, Orimattila and nearby municipalities" },
  { value: "kymenlaakso", label: "Kymenlaakso", detail: "Kotka, Kouvola, Hamina and nearby municipalities" },
  { value: "south-karelia", label: "South Karelia", detail: "Lappeenranta, Imatra and nearby municipalities" },
  { value: "south-savo", label: "South Savo", detail: "Mikkeli, Savonlinna, Pieksamaki and nearby municipalities" },
  { value: "north-savo", label: "North Savo", detail: "Kuopio, Iisalmi, Varkaus, Siilinjarvi and nearby municipalities" },
  { value: "north-karelia", label: "North Karelia", detail: "Joensuu, Lieksa, Nurmes, Kitee and nearby municipalities" },
  { value: "central-finland", label: "Central Finland", detail: "Jyvaskyla, Aanekoski, Jamsa and nearby municipalities" },
  { value: "south-ostrobothnia", label: "South Ostrobothnia", detail: "Seinajoki, Kauhajoki, Lapua and nearby municipalities" },
  { value: "ostrobothnia", label: "Ostrobothnia", detail: "Vaasa, Pietarsaari, Mustasaari and nearby municipalities" },
  { value: "central-ostrobothnia", label: "Central Ostrobothnia", detail: "Kokkola, Kannus, Kaustinen and nearby municipalities" },
  { value: "north-ostrobothnia", label: "North Ostrobothnia", detail: "Oulu, Raahe, Ylivieska, Kuusamo and nearby municipalities" },
  { value: "kainuu", label: "Kainuu", detail: "Kajaani, Kuhmo, Sotkamo, Suomussalmi and nearby municipalities" },
  { value: "lapland", label: "Lapland", detail: "Rovaniemi, Kemi, Tornio, Sodankyla and nearby municipalities" },
  { value: "aland", label: "Aland", detail: "Mariehamn and Aland municipalities" },
  { value: "custom", label: "Manual city list", detail: "Comma-separated PRH locations, for example Kuopio, Siilinjarvi" }
];

const searchModes = [
  {
    value: "new-changes",
    label: "New / changed",
    detail: "Recent PRH registrations, official updates and registered notices."
  },
  {
    value: "mid-market",
    label: "Mid-market",
    detail: "Existing companies with sourced 50-249 employee counts or official financial scale proxy. This is the core Novapolis target segment."
  },
  {
    value: "large-opportunities",
    label: "Large 250-999",
    detail: "Existing companies with sourced 250-999 employee counts or official financial scale proxy. Secondary Novapolis targets: project teams, satellite office needs, meetings and employee services."
  },
  {
    value: "enterprise-watch",
    label: "Enterprise watch",
    detail: "Existing companies with sourced 1000+ employee counts. Kept separate so molochs do not dominate hot leads."
  },
  {
    value: "listed-growth",
    label: "Listed growth",
    detail: "Region-registered Oyj companies matched to Nasdaq Helsinki and checked for sustained share-price growth or a large jump."
  }
];

const FORCED_ENRICHMENT_OPTIONS = {
  publicWeb: true,
  websiteDiscovery: true,
  virrePeople: true
};

const LEADS_PER_PAGE = 15;

export default function App() {
  const [form, setForm] = useState({
    marketMode: "new-changes",
    marketArea: "kuopio-hub",
    customRegion: "Kuopio, Siilinjarvi",
    days: 30,
    visibility: "new-signals",
    useCache: true,
    claude: false,
    claudeLimit: 5,
    employeeSearch: false,
    employeeSearchLimit: 5
  });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [prefetchLoading, setPrefetchLoading] = useState(false);
  const [error, setError] = useState("");

  const selectedArea = marketAreas.find((area) => area.value === form.marketArea);
  const selectedMode = searchModes.find((mode) => mode.value === form.marketMode);
  const region = form.marketArea === "custom" ? form.customRegion : form.marketArea;

  const query = useMemo(() => new URLSearchParams({
    marketMode: form.marketMode,
    region,
    days: String(form.days),
    focus: "all",
    companyForm: "ANY",
    visibility: form.visibility,
    includeSeen: String(form.visibility === "include-seen"),
    useCache: String(form.useCache),
    publicWeb: String(FORCED_ENRICHMENT_OPTIONS.publicWeb),
    websiteDiscovery: String(FORCED_ENRICHMENT_OPTIONS.websiteDiscovery),
    websiteDiscoveryLimit: "12",
    virrePeople: String(FORCED_ENRICHMENT_OPTIONS.virrePeople),
    virreLimit: "12",
    currentEmployeeSearch: String(form.employeeSearch),
    currentEmployeeSearchLimit: String(form.employeeSearchLimit),
    publicListed: String(form.marketMode === "listed-growth"),
    claude: String(form.claude),
    claudeLimit: String(form.claudeLimit)
  }), [form, region]);

  async function runRadar() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/radar?${query}`);
      if (!response.ok) throw new Error(`API error ${response.status}`);
      setData(await response.json());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function resetMemory() {
    await fetch("/api/memory/reset", { method: "POST" });
    setData(null);
  }

  async function runPrefetch() {
    setPrefetchLoading(true);
    try {
      await fetch("/api/prefetch/run?force=true", { method: "POST" });
    } finally {
      setPrefetchLoading(false);
    }
  }

  return (
    <main className="page">
      <section className="hero">
        <div>
          <p className="eyebrow">Novapolis Hackathon / Agentic warm lead generation</p>
          <h1>Finnish Market Lead Radar</h1>
          <p className="subtitle">
            Scan official company records, public web sources and Virre PDFs to find warm B2B leads by Finnish region.
          </p>
        </div>
      </section>

      <section className="toolbar" aria-label="Lead radar filters">
        <label className="field mode-field">
          Search mode
          <select value={form.marketMode} onChange={(event) => setForm({ ...form, marketMode: event.target.value })}>
            {searchModes.map((mode) => <option key={mode.value} value={mode.value}>{mode.label}</option>)}
          </select>
        </label>

        <label className="field area-field">
          Market area
          <select value={form.marketArea} onChange={(event) => setForm({ ...form, marketArea: event.target.value })}>
            {marketAreas.map((area) => <option key={area.value} value={area.value}>{area.label}</option>)}
          </select>
        </label>

        {form.marketArea === "custom" && (
          <label className="field custom-field">
            Manual cities
            <input
              value={form.customRegion}
              onChange={(event) => setForm({ ...form, customRegion: event.target.value })}
              placeholder="Kuopio, Siilinjarvi"
            />
          </label>
        )}

        <label className="field days-field">
          Days back
          <input
            type="number"
            min="1"
            max="365"
            value={form.days}
            onChange={(event) => setForm({ ...form, days: event.target.value })}
          />
        </label>

        <label className="check claude-field">
          <input
            type="checkbox"
            checked={form.claude}
            onChange={(event) => setForm({ ...form, claude: event.target.checked })}
          />
          Claude verify top leads
        </label>

        {form.claude && (
          <label className="field claude-limit-field">
            Claude lead limit
            <input
              type="number"
              min="1"
              max="25"
              value={form.claudeLimit}
              onChange={(event) => setForm({ ...form, claudeLimit: event.target.value })}
            />
          </label>
        )}

        <label className="check employee-search-field">
          <input
            type="checkbox"
            checked={form.employeeSearch}
            onChange={(event) => setForm({ ...form, employeeSearch: event.target.checked })}
          />
          Agent employee search
        </label>

        {form.employeeSearch && (
          <label className="field employee-limit-field">
            Employee search limit
            <input
              type="number"
              min="1"
              max="25"
              value={form.employeeSearchLimit}
              onChange={(event) => setForm({ ...form, employeeSearchLimit: event.target.value })}
            />
          </label>
        )}

        <label className="field visibility-field">
          Visibility
          <select value={form.visibility} onChange={(event) => setForm({ ...form, visibility: event.target.value })}>
            <option value="new-signals">New signals for known companies</option>
            <option value="never-displayed">Only never displayed companies</option>
            <option value="include-seen">Include already shown</option>
          </select>
        </label>

        <label className="check cache-field">
          <input
            type="checkbox"
            checked={form.useCache}
            onChange={(event) => setForm({ ...form, useCache: event.target.checked })}
          />
          Use cached enrichment
        </label>

        <div className="toolbar-actions">
          <button className="secondary" onClick={() => setForm({ ...form, marketArea: "whole-finland" })}>
            Whole Finland
          </button>
          <button className="primary" onClick={runRadar} disabled={loading}>
            {loading ? "Source scan running..." : "Run source pipeline"}
          </button>
          <button className="secondary" onClick={runPrefetch} disabled={prefetchLoading}>
            {prefetchLoading ? "Prefetch running..." : "Prefetch Finland now"}
          </button>
          <button className="secondary" onClick={resetMemory}>Reset memory</button>
        </div>
      </section>

      <p className="area-detail"><strong>{selectedMode?.label}:</strong> {selectedMode?.detail} <span>{selectedArea?.detail}</span></p>

      {error && <section className="error">Error: {error}</section>}
      {!data && !error && <EmptyState />}
      {data && <Results data={data} claudeEnabled={form.claude} />}
      <ScrollTopButton />
    </main>
  );
}

function EmptyState() {
  return (
    <section className="empty">
      <h2>Click Run source pipeline</h2>
      <p>Pick one search mode, then run the pipeline. Public web enrichment, Virre PDF scan and website discovery are always enabled. Background prefetch can warm the cache without marking companies as displayed.</p>
    </section>
  );
}

function Results({ data, claudeEnabled }) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil((data.leads?.length || 0) / LEADS_PER_PAGE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * LEADS_PER_PAGE;
  const pageLeads = (data.leads || []).slice(pageStart, pageStart + LEADS_PER_PAGE);

  useEffect(() => {
    setPage(1);
  }, [data.startedAt]);

  function changePage(nextPage) {
    setPage(Math.min(Math.max(1, nextPage), totalPages));
    requestAnimationFrame(() => {
      document.getElementById("lead-results")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  return (
    <>
      <section className="metrics">
        <Metric label="Mode" value={formatMode(data.context.marketMode)} />
        <Metric label="Leads shown" value={data.totals.leads} />
        <Metric label="New signals" value={data.totals.newSignals} />
        <Metric label="Known signals" value={data.totals.knownSignals} />
        <Metric label="Official records" value={data.totals.companiesReturned} />
        <Metric label="Official employees" value={data.totals.officialEmployeeCounts || 0} />
        <Metric label="Scale proxies" value={data.totals.financialScaleProxies || 0} />
        <Metric label="Current employees" value={data.totals.currentEmployeeCounts || 0} />
        <Metric label="Websites verified" value={data.totals.websitesDiscovered || 0} />
        <Metric label="Virre people" value={data.totals.virreDecisionMakers || 0} />
        <Metric label="Web contacts" value={data.totals.publicWebContacts || 0} />
        <Metric label="Cache hits" value={data.totals.cacheHits || 0} />
        <Metric label="Cache saved" value={data.totals.cacheSaved || 0} />
        <Metric label="Displayed companies" value={data.totals.totalDisplayedCompanies || 0} />
        <Metric label="Listed momentum" value={data.totals.listedGrowthSignals || 0} />
        <Metric label="Yahoo employees" value={data.totals.listedYahooEmployeeCounts || 0} />
        <Metric label="Growth signals" value={(data.totals.jumpSignals || 0) + (data.totals.sustainedSignals || 0) + (data.totals.currentMomentumSignals || 0)} />
      </section>

      <details className="pipeline">
        <summary>
          <span>Agent pipeline</span>
          <small>{data.pipeline?.length || 0} steps</small>
        </summary>
        <div className="pipeline-list">
          {data.pipeline?.map((step) => (
            <div className="pipeline-step" key={step.agent}>
              <span className={`status ${step.status}`}>{step.status}</span>
              <strong>{step.agent}</strong>
              <span>{step.detail}</span>
            </div>
          ))}
        </div>
      </details>

      <section className="newsletter">
        <div>
          <p className="eyebrow">Daily newsletter</p>
          <h2>{data.newsletter.title}</h2>
          <p>{data.newsletter.intro}</p>
        </div>
        <NewsletterList title="Hot" items={sanitizeNewsletterItems(data.newsletter.hot, claudeEnabled)} />
        <NewsletterList title="Warm" items={sanitizeNewsletterItems(data.newsletter.warm, claudeEnabled)} />
        <NewsletterList title="Changes" items={data.newsletter.changes} />
      </section>

      {data.leads.length > 0 && (
        <Pagination
          page={currentPage}
          totalPages={totalPages}
          totalItems={data.leads.length}
          pageStart={pageStart}
          pageSize={LEADS_PER_PAGE}
          onPageChange={changePage}
        />
      )}

      <section className="lead-list" id="lead-results">
        {data.leads.length === 0 ? (
          <NoLeadResults data={data} />
        ) : pageLeads.map((lead) => <LeadCard key={lead.company.businessId} lead={lead} claudeEnabled={claudeEnabled} />)}
      </section>

      {data.leads.length > LEADS_PER_PAGE && (
        <Pagination
          page={currentPage}
          totalPages={totalPages}
          totalItems={data.leads.length}
          pageStart={pageStart}
          pageSize={LEADS_PER_PAGE}
          onPageChange={changePage}
        />
      )}

      <section className="sources">
        <h2>Sources</h2>
        {data.sources.map((source) => (
          <a key={source.url} href={source.url} target="_blank" rel="noreferrer">
            <strong>{source.name}</strong>
            <span>{source.note}</span>
          </a>
        ))}
      </section>
    </>
  );
}

function NoLeadResults({ data }) {
  if (data.context?.marketMode === "listed-growth") {
    const matched = data.totals.listedCompaniesMatched || 0;
    const histories = data.totals.listedPriceHistories || 0;
    return (
      <div className="empty compact">
        <h2>No listed growth leads selected</h2>
        <p>
          {matched} listed companies matched to Finnish shares and {histories} price histories were checked.
          No matched share passed the sustained-growth or large-jump thresholds, so cache/history settings did not hide the result.
        </p>
      </div>
    );
  }

  if (data.totals?.cacheOnly) {
    const skipped = (data.totals.cacheSkippedMissing || 0) + (data.totals.cacheSkippedStale || 0);
    return (
      <div className="empty compact">
        <h2>No cached leads selected</h2>
        <p>
          Daily cache mode used {data.totals.cacheHits || 0} cached company records and skipped {skipped} missing/stale records for speed.
          Turn off Use cached enrichment to force a live refresh.
        </p>
      </div>
    );
  }

  return (
    <div className="empty compact">
      <h2>No new lead signals</h2>
      <p>Enable already-shown items or reset memory to inspect previously returned results.</p>
    </div>
  );
}

function Pagination({ page, totalPages, totalItems, pageStart, pageSize, onPageChange }) {
  const first = totalItems === 0 ? 0 : pageStart + 1;
  const last = Math.min(totalItems, pageStart + pageSize);
  return (
    <nav className="pagination" aria-label="Lead results pagination">
      <span>{first}-{last} of {totalItems}</span>
      <div>
        <button className="secondary" onClick={() => onPageChange(page - 1)} disabled={page <= 1}>Previous</button>
        <strong>Page {page} / {totalPages}</strong>
        <button className="secondary" onClick={() => onPageChange(page + 1)} disabled={page >= totalPages}>Next</button>
      </div>
    </nav>
  );
}

function ScrollTopButton() {
  return (
    <button
      type="button"
      className="scroll-top"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      aria-label="Scroll to top"
      title="Scroll to top"
    >
      Top
    </button>
  );
}

function Metric({ label, value }) {
  return (
    <div className="metric">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function formatMode(mode) {
  if (mode === "established") return "Size";
  if (mode === "mid-market") return "Mid";
  if (mode === "large-opportunities") return "Large";
  if (mode === "enterprise-watch") return "Enterprise";
  if (mode === "listed-growth") return "Listed";
  return "New";
}

function sanitizeNewsletterItems(items, claudeEnabled) {
  if (claudeEnabled) return items;

  return (items || [])
    .map((item) => {
      if (typeof item !== "string") return item;
      return item
        .replace(/\s*(Internal pitch angle|Customer-facing pitch|Tailored pitch|Pitch)\s*[:\u2013-].*$/i, "")
        .replace(/\s+-\s+.*?(Do not claim operational expansion from price action alone|Manual verification needed before outreach|Find a verified official website|Use the verified public business contact).*$/i, "")
        .trim();
    })
    .filter(Boolean);
}

function NewsletterList({ title, items }) {
  if (!items?.length) return null;
  return (
    <div className="newsletter-block">
      <h3>{title}</h3>
      <ul>
        {items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </div>
  );
}

function LeadCard({ lead, claudeEnabled }) {
  return (
    <article className={`lead ${lead.priority}`}>
      <div className="lead-head">
        <div>
          <p className="eyebrow">{lead.company.businessId}</p>
          <h2>{lead.company.name}</h2>
          <p className="muted">{lead.company.businessLine.code} {lead.company.businessLine.description}</p>
          <p className="muted">{lead.company.address || "No official address returned"}</p>
        </div>
        <div className="score">
          <strong>{lead.score}</strong>
          <span>{lead.priority} / {lead.outreachReadiness || "Needs verification"}</span>
        </div>
      </div>

      <div className="facts">
        <Fact label="Registered" value={lead.company.registrationDate || "n/a"} />
        <Fact label="Readiness" value={`${lead.dataConfidence || "Low"} confidence / ${lead.outreachReadiness || "Needs verification"}`} />
        <Fact label="Website" value={formatWebsite(lead)} source={websiteSource(lead)} />
        <Fact label="Employees" value={formatEmployees(lead)} source={employeeSource(lead)} />
        <Fact label="Scale proxy" value={formatScaleProxy(lead)} source={scaleProxySource(lead)} />
        <Fact label="Company size" value={formatCompanySize(lead)} source={sizeSource(lead)} />
        <Fact label="Segment" value={formatSegment(lead)} source={sizeSource(lead)} />
        <Fact label="Growth / hiring" value={formatGrowthHiring(lead)} source={growthHiringSource(lead)} />
        <Fact label="Decision maker" value={formatDecisionMaker(lead)} source={decisionSource(lead)} />
        <Fact label="Email / phone" value={formatContact(lead)} source={contactSource(lead)} />
        <Fact label="Source check" value={formatSourceCheck(lead)} source={sourceCheckSource(lead)} />
      </div>

      {lead.selectedBecause?.length > 0 && (
        <div className="angles">
          <h3>Selected because</h3>
          <ul>
            {lead.selectedBecause.map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
        </div>
      )}

      <div className="angles">
        <h3>Why this matters to Novapolis</h3>
        <ul>
          {lead.novapolisAngles.map((angle) => <li key={angle}>{angle}</li>)}
        </ul>
      </div>

      {lead.growth?.status && lead.growth.status !== "none" && (
        <div className="growth-box">
          <h3>Growth reason</h3>
          <p><strong>{lead.growth.status}</strong></p>
          <ul>
            {lead.growth.reasons.map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
          {lead.growth.previousSnapshotAt ? <small>Compared with snapshot: {lead.growth.previousSnapshotAt}</small> : <small>Current-run momentum; historical trend starts after repeated runs.</small>}
        </div>
      )}

      <div className="pitch">
        <h3>Recommended action</h3>
        {lead.recommendedActions?.length ? (
          <ul>
            {lead.recommendedActions.map((action) => <li key={action}>{action}</li>)}
          </ul>
        ) : <p>{lead.recommendedAction}</p>}

        {claudeEnabled && (
          <>
            <h3>Internal pitch angle</h3>
            <p>{lead.tailoredPitchAngle || lead.pitch}</p>
            <h3>Customer-facing pitch</h3>
            <p>{lead.customerFacingPitch || "Not generated until outreach readiness is Ready."}</p>
            {lead.agentReview && (
              <p className="agent-review">
                Claude: {lead.agentReview.evidenceVerdict}. Missing: {(lead.agentReview.missingFields || []).join(", ") || "none"}.
              </p>
            )}
          </>
        )}
      </div>

      <div className="signals">
        <h3>Signals</h3>
        {lead.signals.map((signal) => (
          <a className="signal" href={signal.sourceUrl} target="_blank" rel="noreferrer" key={signal.id}>
            <span className={signal.isNew ? "badge new" : "badge"}>{signal.isNew ? "new" : "seen"}</span>
            <strong>{signal.label}</strong>
            <span>{signal.detail}</span>
            <small>{signal.sourceName} / {signal.confidence} / {signal.date || "no date"}</small>
          </a>
        ))}
      </div>
    </article>
  );
}

function formatEmployees(lead) {
  if (lead.enrichment.currentEmployeeCount) return `current ${lead.enrichment.currentEmployeeCount}`;
  if (!lead.enrichment.employeeCount) return "missing source";
  return lead.enrichment.employeeCount;
}

function formatCompanySize(lead) {
  return lead.companySizeEstimate?.value || "unknown";
}

function formatScaleProxy(lead) {
  if (!lead.enrichment.organizationScaleProxy) return "missing source";
  return [
    lead.enrichment.organizationScaleProxyLabel,
    lead.enrichment.organizationScaleProxyAmountLabel
  ].filter(Boolean).join(" / ");
}

function formatSegment(lead) {
  const segment = lead.employeeSegment;
  if (!segment?.label) return "unknown";
  return `${segment.label} / ${segment.targetFit}`;
}

function formatDateTime(value) {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function formatGrowthHiring(lead) {
  return lead.growthHiringSignal || "none";
}

function growthHiringSource(lead) {
  return lead.growthHiringEvidence?.[0]?.sourceUrl || "";
}

function formatWebsite(lead) {
  const website = lead.enrichment.companyWebsite || lead.company.website;
  if (!website) return "missing source";
  try {
    return new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`).hostname.replace(/^www\./, "");
  } catch {
    return website;
  }
}

function websiteSource(lead) {
  return lead.enrichment.companyWebsiteSourceUrl || lead.enrichment.companyWebsite || lead.company.website || "";
}

function employeeSource(lead) {
  return lead.enrichment.currentEmployeeCountSourceUrl || lead.enrichment.employeeCountSourceUrl || "";
}

function scaleProxySource(lead) {
  return lead.enrichment.organizationScaleProxySourceUrl || "";
}

function sizeSource(lead) {
  return employeeSource(lead) || scaleProxySource(lead);
}

function formatDecisionMaker(lead) {
  const person = lead.enrichment.decisionMakers?.[0];
  if (!person) return "missing source";
  if (typeof person === "string") return person;
  return [person.label, person.email, person.phone].filter(Boolean).join(" / ");
}

function decisionSource(lead) {
  const person = lead.enrichment.decisionMakers?.[0];
  return typeof person === "object" ? person.sourceUrl : "";
}

function formatContact(lead) {
  const contact = bestContact(lead);
  if (!contact) return "missing source";
  return contact.label ? `${contact.label}: ${contact.values.join(" / ")}` : contact.values.join(" / ");
}

function contactSource(lead) {
  const contact = bestContact(lead);
  return contact?.sourceUrl || "";
}

function bestContact(lead) {
  const people = [...(lead.enrichment.decisionMakers || [])]
    .filter((person) => typeof person === "object" && (person.email || person.phone))
    .sort((a, b) => decisionRank(a) - decisionRank(b));
  const person = people[0];
  if (person) {
    return {
      label: person.label || person.name || person.title || "",
      values: [person.email, person.phone].filter(Boolean),
      sourceUrl: person.sourceUrl || lead.enrichment.contactSourceUrl || lead.enrichment.sourceUrl || ""
    };
  }
  const email = lead.enrichment.emails?.[0] || "";
  const phone = lead.enrichment.phones?.[0] || "";
  const values = [email, phone].filter(Boolean);
  if (!values.length) return null;
  return {
    label: "",
    values,
    sourceUrl: lead.enrichment.contactSourceUrl || lead.enrichment.sourceUrl || ""
  };
}

function decisionRank(person) {
  const text = `${person.title || ""} ${person.role || ""} ${person.label || ""}`.toLowerCase();
  if (/ceo|managing director|toimitusjohtaja/.test(text)) return 1;
  if (/chair|puheenjohtaja/.test(text)) return 2;
  if (/board|j\u00e4sen|jasen/.test(text)) return 3;
  if (/founder|owner|partner/.test(text)) return 4;
  return 9;
}

function formatSourceCheck(lead) {
  if (!lead.enrichment.verificationStatus) return "missing verified source";
  const evidence = lead.enrichment.verificationEvidence?.[0];
  return evidence || lead.enrichment.verificationStatus;
}

function sourceCheckSource(lead) {
  return lead.enrichment.verifiedSources?.[0]?.url || lead.enrichment.sourceUrl || "";
}

function Fact({ label, value, source }) {
  return (
    <div className="fact">
      <span>{label}</span>
      <strong>{value}</strong>
      {source ? <a href={source} target="_blank" rel="noreferrer">source</a> : null}
    </div>
  );
}
