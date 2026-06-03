import { getDatabase, runInTransaction } from "../lib/database.js";

function normalizeMemory(memory = {}) {
  return {
    signals: memory.signals && typeof memory.signals === "object" ? memory.signals : {},
    displayedCompanies: memory.displayedCompanies && typeof memory.displayedCompanies === "object" ? memory.displayedCompanies : {}
  };
}

function companyId(lead) {
  return lead.company?.businessId || lead.signals?.[0]?.businessId || "";
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function placeholders(values) {
  return values.map(() => "?").join(", ");
}

function loadSignalsByIds(ids) {
  if (!ids.length) return {};
  const rows = getDatabase()
    .prepare(`
      SELECT
        id,
        first_seen_at AS firstSeenAt,
        business_id AS businessId,
        company_name AS companyName,
        type,
        title,
        source_url AS sourceUrl
      FROM seen_signals
      WHERE id IN (${placeholders(ids)})
    `)
    .all(...ids);
  return Object.fromEntries(rows.map((row) => [row.id, row]));
}

function loadDisplayedCompaniesByIds(ids) {
  if (!ids.length) return {};
  const rows = getDatabase()
    .prepare(`
      SELECT
        business_id AS businessId,
        company_name AS companyName,
        first_displayed_at AS firstDisplayedAt,
        last_displayed_at AS lastDisplayedAt
      FROM displayed_companies
      WHERE business_id IN (${placeholders(ids)})
    `)
    .all(...ids);
  return Object.fromEntries(rows.map((row) => [row.businessId, row]));
}

function loadMemoryForLeads(leads) {
  return normalizeMemory({
    signals: loadSignalsByIds(unique(leads.flatMap((lead) => lead.signals.map((signal) => signal.id)))),
    displayedCompanies: loadDisplayedCompaniesByIds(unique(leads.map(companyId)))
  });
}

function memoryCounts() {
  const db = getDatabase();
  return {
    totalSeenSignals: db.prepare("SELECT COUNT(*) AS count FROM seen_signals").get().count,
    totalDisplayedCompanies: db.prepare("SELECT COUNT(*) AS count FROM displayed_companies").get().count
  };
}

function visibleByMode(lead, visibility, memory) {
  if (visibility === "include-seen") return true;
  if (visibility === "never-displayed") return !memory.displayedCompanies[companyId(lead)];
  return lead.signals.some((signal) => signal.isNew);
}

export async function applyMemory(leads, options = {}) {
  const recordDisplay = options.recordDisplay !== false;
  const visibility = options.visibility || (options.includeSeen ? "include-seen" : "new-signals");
  const memory = loadMemoryForLeads(leads);
  const now = new Date().toISOString();
  let newSignals = 0;
  let knownSignals = 0;
  let newCompaniesDisplayed = 0;
  let knownCompaniesDisplayed = 0;

  const decorated = leads.map((lead) => ({
    ...lead,
    isFirstDisplay: !memory.displayedCompanies[companyId(lead)],
    firstDisplayedAt: memory.displayedCompanies[companyId(lead)]?.firstDisplayedAt || "",
    signals: lead.signals.map((signal) => {
      const seen = memory.signals[signal.id];
      const isNew = !seen;
      if (isNew) {
        newSignals += 1;
      } else {
        knownSignals += 1;
      }
      return {
        ...signal,
        isNew,
        firstSeenAt: seen?.firstSeenAt ?? now
      };
    })
  }));

  const visibleLeads = decorated.filter((lead) => visibleByMode(lead, visibility, memory));

  if (recordDisplay) {
    for (const lead of visibleLeads) {
      const id = companyId(lead);
      if (!id) continue;
      if (memory.displayedCompanies[id]) {
        knownCompaniesDisplayed += 1;
      } else {
        newCompaniesDisplayed += 1;
        memory.displayedCompanies[id] = {
          firstDisplayedAt: now,
          companyName: lead.company?.name || "",
          lastDisplayedAt: now
        };
      }
      memory.displayedCompanies[id].lastDisplayedAt = now;
    }

    runInTransaction((db) => {
      const upsertCompany = db.prepare(`
        INSERT INTO displayed_companies
          (business_id, company_name, first_displayed_at, last_displayed_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(business_id) DO UPDATE SET
          company_name = excluded.company_name,
          last_displayed_at = excluded.last_displayed_at
      `);
      const insertSignal = db.prepare(`
        INSERT OR IGNORE INTO seen_signals
          (id, first_seen_at, business_id, company_name, type, title, source_url)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      for (const lead of visibleLeads) {
        const id = companyId(lead);
        if (!id) continue;
        upsertCompany.run(id, lead.company?.name || "", now, now);
      }

      for (const lead of visibleLeads) {
        for (const signal of lead.signals) {
          insertSignal.run(
            signal.id,
            now,
            signal.businessId || "",
            signal.companyName || "",
            signal.type || "",
            signal.title || "",
            signal.sourceUrl || ""
          );
        }
      }
    });
  }

  const totals = memoryCounts();
  return {
    leads: decorated,
    visibleLeads,
    stats: {
      newSignals,
      knownSignals,
      totalSeenSignals: totals.totalSeenSignals,
      totalDisplayedCompanies: totals.totalDisplayedCompanies,
      newCompaniesDisplayed,
      knownCompaniesDisplayed,
      visibility,
      recordDisplay
    }
  };
}

export async function filterLeadsWithUnseenSignals(leads) {
  const seenSignals = loadSignalsByIds(unique(leads.flatMap((lead) => lead.signals.map((signal) => signal.id))));
  let newCandidateSignals = 0;
  let knownCandidateSignals = 0;

  const filtered = leads.filter((lead) => {
    const hasNewSignal = lead.signals.some((signal) => !seenSignals[signal.id]);
    for (const signal of lead.signals) {
      if (seenSignals[signal.id]) knownCandidateSignals += 1;
      else newCandidateSignals += 1;
    }
    return hasNewSignal;
  });

  return {
    leads: filtered,
    stats: {
      candidateLeadsChecked: leads.length,
      candidateLeadsWithNewSignals: filtered.length,
      skippedKnownLeadsBeforeEnrichment: leads.length - filtered.length,
      newCandidateSignals,
      knownCandidateSignals
    }
  };
}

export async function resetMemory() {
  runInTransaction((db) => {
    db.prepare("DELETE FROM seen_signals").run();
    db.prepare("DELETE FROM displayed_companies").run();
  });
}
