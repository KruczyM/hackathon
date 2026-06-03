import fs from "node:fs/promises";
import path from "node:path";

const MEMORY_PATH = path.resolve("data/seen.json");

async function readMemory() {
  try {
    const text = await fs.readFile(MEMORY_PATH, "utf8");
    return normalizeMemory(JSON.parse(text));
  } catch {
    return normalizeMemory({});
  }
}

async function writeMemory(memory) {
  await fs.mkdir(path.dirname(MEMORY_PATH), { recursive: true });
  await fs.writeFile(MEMORY_PATH, `${JSON.stringify(normalizeMemory(memory), null, 2)}\n`, "utf8");
}

function normalizeMemory(memory = {}) {
  return {
    signals: memory.signals && typeof memory.signals === "object" ? memory.signals : {},
    displayedCompanies: memory.displayedCompanies && typeof memory.displayedCompanies === "object" ? memory.displayedCompanies : {}
  };
}

function companyId(lead) {
  return lead.company?.businessId || lead.signals?.[0]?.businessId || "";
}

function visibleByMode(lead, visibility, memory) {
  if (visibility === "include-seen") return true;
  if (visibility === "never-displayed") return !memory.displayedCompanies[companyId(lead)];
  return lead.signals.some((signal) => signal.isNew);
}

export async function applyMemory(leads, options = {}) {
  const recordDisplay = options.recordDisplay !== false;
  const visibility = options.visibility || (options.includeSeen ? "include-seen" : "new-signals");
  const memory = await readMemory();
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

    for (const lead of visibleLeads) {
      for (const signal of lead.signals) {
        if (memory.signals[signal.id]) continue;
        memory.signals[signal.id] = {
          firstSeenAt: now,
          businessId: signal.businessId,
          companyName: signal.companyName,
          type: signal.type,
          title: signal.title,
          sourceUrl: signal.sourceUrl
        };
      }
    }

    await writeMemory(memory);
  }

  return {
    leads: decorated,
    visibleLeads,
    stats: {
      newSignals,
      knownSignals,
      totalSeenSignals: Object.keys(memory.signals).length,
      totalDisplayedCompanies: Object.keys(memory.displayedCompanies).length,
      newCompaniesDisplayed,
      knownCompaniesDisplayed,
      visibility,
      recordDisplay
    }
  };
}

export async function filterLeadsWithUnseenSignals(leads) {
  const memory = await readMemory();
  let newCandidateSignals = 0;
  let knownCandidateSignals = 0;

  const filtered = leads.filter((lead) => {
    const hasNewSignal = lead.signals.some((signal) => !memory.signals[signal.id]);
    for (const signal of lead.signals) {
      if (memory.signals[signal.id]) knownCandidateSignals += 1;
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
  await writeMemory({ signals: {}, displayedCompanies: {} });
}
