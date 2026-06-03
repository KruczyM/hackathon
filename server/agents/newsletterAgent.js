export function buildNewsletter(leads, context, stats) {
  const hot = leads.filter((lead) => lead.priority === "hot").slice(0, 5);
  const warm = leads.filter((lead) => lead.priority === "warm").slice(0, 5);
  const changes = leads.flatMap((lead) => lead.signals.map((signal) => ({ lead, signal }))).slice(0, 8);
  const claudeEnabled = context.claude === true || context.claude === "true";

  const area = context.marketArea?.label || context.region;
  return {
    title: `Daily lead radar: ${area}`,
    generatedAt: new Date().toISOString(),
    intro: `Scope: ${area}, ${context.range.start} to ${context.range.end}. ${stats.newSignals} new signals, ${stats.knownSignals} already known signals.`,
    hot: hot.map((lead) => itemLine(lead, { claudeEnabled })),
    warm: warm.map((lead) => itemLine(lead, { claudeEnabled })),
    changes: changes.map(({ lead, signal }) => `${lead.company.name}: ${signal.label} (${signal.date || "no date"})`),
    gaps: [
      "Employee counts prefer official PRH/XBRL financial statements when a digital statement exists.",
      "Decision makers, emails and phones are shown only when public company pages provide sourced evidence.",
      "Claude verifies and writes pitches only from collected evidence; it cannot invent missing contacts."
    ]
  };
}

function itemLine(lead, options = {}) {
  if (options.claudeEnabled) {
    if (lead.agentReview) {
      const reviewedLine = cleanPitch(lead.newsletterLine || lead.customerFacingPitch || lead.tailoredPitchAngle || lead.agentReview.outreachAngle || "");
      if (reviewedLine) return `${lead.company.name} (${lead.score}) - ${reviewedLine}`;
    }
    return `${lead.company.name} (${lead.score}) - ${factualReason(lead)} Claude review was not available for this lead.`;
  }

  const reason = factualReason(lead);
  const contact = contactStatus(lead);
  return `${lead.company.name} (${lead.score}) - ${reason}${contact ? ` ${contact}` : ""}`;
}

function factualReason(lead) {
  const signal = lead.signals?.[0];
  if (signal) {
    return `${signal.label || signal.type}: ${shorten(signal.detail || signal.title || "sourced signal")}. Source: ${signal.sourceName || "source attached"}.`;
  }
  const reason = lead.selectedBecause?.find((item) => !/pitch|workspace|outreach|manual verification/i.test(item));
  if (reason) return `${reason}`;
  return `${lead.outreachReadiness || "Needs verification"}.`;
}

function contactStatus(lead) {
  const hasContact = lead.enrichment?.emails?.length || lead.enrichment?.phones?.length || lead.enrichment?.contactFormUrl;
  if (hasContact) return "Verified contact available.";
  return "";
}

function shorten(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= 180) return text;
  return `${text.slice(0, 177).trim()}...`;
}

function cleanPitch(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (/Do not claim operational expansion from price action alone/i.test(text)) return "";
  if (/Manual verification needed before outreach/i.test(text) && text.length > 180) return "";
  return shorten(text);
}
