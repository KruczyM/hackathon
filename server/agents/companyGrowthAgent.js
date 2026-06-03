import { getDatabase, runInTransaction } from "../lib/database.js";
import { stableHash } from "../lib/hash.js";
import { applyLeadScoringSafety } from "./scoringAgent.js";

function priority(score) {
  if (score >= 75) return "hot";
  if (score >= 45) return "warm";
  return "watch";
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function placeholders(values) {
  return values.map(() => "?").join(", ");
}

function loadHistoryForBusinessIds(businessIds) {
  const ids = unique(businessIds);
  if (!ids.length) return { companies: {} };

  const rows = getDatabase()
    .prepare(`
      SELECT
        business_id AS businessId,
        company_name AS companyName,
        snapshot_at AS snapshotAt,
        score,
        signal_count AS signalCount,
        important_notices AS importantNotices,
        official_signals AS officialSignals,
        external_signals AS externalSignals,
        contacts,
        employee_count AS employeeCount,
        consecutive_growth_runs AS consecutiveGrowthRuns
      FROM company_growth_snapshots
      WHERE business_id IN (${placeholders(ids)})
    `)
    .all(...ids);

  return {
    companies: Object.fromEntries(rows.map((row) => [row.businessId, { latest: row }]))
  };
}

function saveGrowthSnapshots(snapshots) {
  if (!snapshots.length) return;

  runInTransaction((db) => {
    const upsertSnapshot = db.prepare(`
      INSERT INTO company_growth_snapshots
        (
          business_id, company_name, snapshot_at, score, signal_count, important_notices,
          official_signals, external_signals, contacts, employee_count, consecutive_growth_runs
        )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(business_id) DO UPDATE SET
        company_name = excluded.company_name,
        snapshot_at = excluded.snapshot_at,
        score = excluded.score,
        signal_count = excluded.signal_count,
        important_notices = excluded.important_notices,
        official_signals = excluded.official_signals,
        external_signals = excluded.external_signals,
        contacts = excluded.contacts,
        employee_count = excluded.employee_count,
        consecutive_growth_runs = excluded.consecutive_growth_runs
    `);

    for (const snapshot of snapshots) {
      upsertSnapshot.run(
        snapshot.businessId,
        snapshot.companyName,
        snapshot.snapshotAt,
        snapshot.score,
        snapshot.signalCount,
        snapshot.importantNotices,
        snapshot.officialSignals,
        snapshot.externalSignals,
        snapshot.contacts,
        snapshot.employeeCount,
        snapshot.consecutiveGrowthRuns
      );
    }
  });
}

function employeeCount(lead) {
  const parsed = Number.parseInt(lead.enrichment?.employeeCount, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function metricsFor(lead) {
  const importantNotices = lead.signals.filter((signal) => signal.label?.includes("Important registered notice")).length;
  const officialSignals = lead.signals.filter((signal) => signal.confidence === "official").length;
  const externalSignals = lead.signals.filter((signal) => signal.confidence !== "official").length;
  const contacts = (lead.enrichment?.emails?.length || 0) + (lead.enrichment?.phones?.length || 0) + (lead.enrichment?.decisionMakers?.length || 0);

  return {
    score: lead.score,
    signalCount: lead.signals.length,
    importantNotices,
    officialSignals,
    externalSignals,
    contacts,
    employeeCount: employeeCount(lead)
  };
}

function growthReasons(current, previous) {
  const reasons = [];
  let weight = 0;
  let type = "";
  let label = "";

  if (previous) {
    const scoreDelta = current.score - previous.score;
    const signalDelta = current.signalCount - previous.signalCount;
    const noticeDelta = current.importantNotices - previous.importantNotices;

    if (scoreDelta >= 30 || signalDelta >= 3 || noticeDelta >= 2) {
      type = "growth_jump";
      label = "Jump growth signal";
      weight = Math.max(weight, 24);
      reasons.push(`jump vs previous snapshot: score ${formatDelta(scoreDelta)}, signals ${formatDelta(signalDelta)}, important notices ${formatDelta(noticeDelta)}`);
    }

    if (current.employeeCount !== null && previous.employeeCount !== null) {
      const employeeDelta = current.employeeCount - previous.employeeCount;
      if (employeeDelta >= 5 && current.employeeCount >= previous.employeeCount * 1.25) {
        type = "employee_growth";
        label = "Employee growth signal";
        weight = Math.max(weight, 28);
        reasons.push(`employee count grew from ${previous.employeeCount} to ${current.employeeCount}`);
      }
    }

    if (previous.consecutiveGrowthRuns >= 1 && (scoreDelta >= 8 || signalDelta >= 1 || noticeDelta >= 1)) {
      type = type || "sustained_growth";
      label = label || "Sustained growth signal";
      weight = Math.max(weight, 18);
      reasons.push(`continued growth for ${previous.consecutiveGrowthRuns + 1} consecutive runs`);
    }
  }

  if (current.importantNotices >= 2 && current.score >= 90) {
    type = type || "current_momentum";
    label = label || "Current momentum signal";
    weight = Math.max(weight, 14);
    reasons.push(`current run has ${current.importantNotices} important registered notices and high lead score`);
  }

  if (current.externalSignals >= 2) {
    type = type || "market_attention";
    label = label || "Market attention signal";
    weight = Math.max(weight, 12);
    reasons.push(`current run has ${current.externalSignals} public enrichment signals`);
  }

  return { reasons, weight, type, label };
}

function formatDelta(value) {
  if (value > 0) return `+${value}`;
  return String(value);
}

function makeGrowthSignal(lead, growth) {
  const sourceUrl = lead.signals.find((signal) => signal.sourceUrl)?.sourceUrl || "";
  return {
    id: stableHash([lead.company.businessId, growth.type, growth.reasons]),
    businessId: lead.company.businessId,
    companyName: lead.company.name,
    type: growth.type,
    label: growth.label,
    date: new Date().toISOString().slice(0, 10),
    title: `${lead.company.name} selected for growth momentum`,
    detail: `Selected because: ${growth.reasons.join("; ")}.`,
    sourceName: "Growth agent",
    sourceUrl,
    confidence: "derived-from-sourced-signals",
    weight: growth.weight
  };
}

function updateConsecutiveGrowth(current, previous) {
  if (!previous) return current.score >= 90 || current.importantNotices >= 2 ? 1 : 0;
  const grew = current.score > previous.score || current.signalCount > previous.signalCount || current.importantNotices > previous.importantNotices;
  return grew ? (previous.consecutiveGrowthRuns || 0) + 1 : 0;
}

export async function applyGrowthDetection(leads) {
  const history = loadHistoryForBusinessIds(leads.map((lead) => lead.company.businessId));
  const now = new Date().toISOString();
  const snapshots = [];
  let jumpSignals = 0;
  let sustainedSignals = 0;
  let currentMomentumSignals = 0;

  const output = leads.map((lead) => {
    const businessId = lead.company.businessId;
    const previous = history.companies[businessId]?.latest || null;
    const current = metricsFor(lead);
    const growth = growthReasons(current, previous);
    const consecutiveGrowthRuns = updateConsecutiveGrowth(current, previous);

    snapshots.push({
      businessId,
      companyName: lead.company.name,
      ...current,
      consecutiveGrowthRuns,
      snapshotAt: now
    });

    if (growth.reasons.length === 0) {
      return {
        ...lead,
        growth: {
          status: "none",
          reasons: [],
          previousSnapshotAt: previous?.snapshotAt || ""
        }
      };
    }

    if (growth.type === "growth_jump" || growth.type === "employee_growth") jumpSignals += 1;
    if (growth.type === "sustained_growth") sustainedSignals += 1;
    if (growth.type === "current_momentum" || growth.type === "market_attention") currentMomentumSignals += 1;

    const signal = makeGrowthSignal(lead, growth);
    const nextSignals = [signal, ...lead.signals].sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));
    const safety = applyLeadScoringSafety(lead.rawScore ? lead.rawScore + growth.weight : lead.score + growth.weight, nextSignals, lead.enrichment);
    return {
      ...lead,
      score: safety.score,
      scoreCeiling: safety.scoreCeiling,
      priority: safety.priority,
      dataConfidence: safety.dataConfidence,
      outreachReadiness: safety.outreachReadiness,
      growthHiringSignal: safety.growthHiringSignal,
      growthHiringEvidence: safety.growthHiringEvidence,
      signals: nextSignals,
      scoreBreakdown: [
        {
          component: growth.label,
          points: growth.weight,
          sourceName: "Growth agent",
          sourceUrl: signal.sourceUrl,
          evidence: signal.detail
        },
        ...(lead.scoreBreakdown || [])
      ],
      growth: {
        status: growth.type,
        reasons: growth.reasons,
        previousSnapshotAt: previous?.snapshotAt || "",
        consecutiveGrowthRuns
      },
      novapolisAngles: [
        `Growth reason: ${growth.reasons[0]}.`,
        ...lead.novapolisAngles
      ].slice(0, 5)
    };
  });

  saveGrowthSnapshots(snapshots);
  return {
    leads: output.sort((a, b) => b.score - a.score),
    stats: {
      jumpSignals,
      sustainedSignals,
      currentMomentumSignals
    }
  };
}

export async function resetGrowthHistory() {
  runInTransaction((db) => {
    db.prepare("DELETE FROM company_growth_snapshots").run();
  });
}
