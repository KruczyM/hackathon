const DEFAULT_MODEL = process.env.CLAUDE_MODEL || "claude-haiku-4-5-20251001";
const API_URL = "https://api.anthropic.com/v1/messages";

function compactLead(lead) {
  return {
    businessId: lead.company.businessId,
    name: lead.company.name,
    lineOfBusiness: lead.company.businessLine,
    registered: lead.company.registrationDate,
    address: lead.company.address,
    website: lead.company.website || lead.enrichment?.companyWebsite || null,
    employeeCount: lead.enrichment?.employeeCount || null,
    employeeSource: lead.enrichment?.employeeCountSourceUrl || null,
    companySizeEstimate: lead.companySizeEstimate || null,
    growthHiringSignal: lead.growthHiringSignal || "none",
    dataConfidence: lead.dataConfidence || "Low",
    outreachReadiness: lead.outreachReadiness || "Needs verification",
    missingEvidence: lead.missingEvidence || [],
    complianceWarnings: lead.complianceWarnings || [],
    decisionMakers: lead.enrichment?.decisionMakers || [],
    emails: lead.enrichment?.emails || [],
    phones: lead.enrichment?.phones || [],
    signals: lead.signals.slice(0, 8).map((signal) => ({
      type: signal.type,
      label: signal.label,
      detail: signal.detail,
      date: signal.date,
      sourceName: signal.sourceName,
      sourceUrl: signal.sourceUrl,
      confidence: signal.confidence
    }))
  };
}

function parseJson(text) {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return [];
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
}

async function callClaude(leads, context, apiKey) {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: context.claudeModel || DEFAULT_MODEL,
      max_tokens: 1800,
      temperature: 0,
      system: [
        "You are a B2B lead verification agent for Novapolis, a workspace and services provider in the Kuopio region.",
        "Use only the provided evidence. Do not invent employee counts, people, emails, phones, investments, hiring, or market claims.",
        "Forbidden unsupported claims: small team, growing team, expanding, hiring, recently funded, needs office, looking for premises, requires more space, stable premises not yet available.",
        "For listed-market signals, describe only the sourced price movement and do not infer revenue, hiring, funding or office expansion unless that evidence is provided.",
        "Avoid generic warnings as the main output. If the only growth evidence is listed-market price movement, say this is a watch/qualification lead and name the exact sourced price signal, contact route, and missing operational evidence.",
        "Write concise, lead-specific text. Do not repeat policy phrases such as 'Do not claim operational expansion from price action alone' in the pitch.",
        "If outreachReadiness is not Ready, customerFacingPitch must be null and the recommendation must be manual verification only.",
        "If evidence is missing, say exactly what is missing.",
        "Return strict JSON array only."
      ].join(" "),
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            task: "Verify evidence and write a specific, grounded outreach proposal for each lead.",
            outputSchema: {
              businessId: "string",
              evidenceVerdict: "verified | partial | weak",
              missingFields: ["string"],
              outreachAngle: "string",
              tailoredPitchAngle: "internal cautious sales angle",
              customerFacingPitch: "string or null",
              newsletterLine: "one concise line for the daily lead radar",
              warnings: ["string"]
            },
            context: {
              marketArea: context.marketArea?.label || context.region,
              range: context.range
            },
            leads: leads.map(compactLead)
          })
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`Claude API ${response.status}: ${await response.text()}`);
  }

  const json = await response.json();
  const text = json.content?.map((part) => part.text || "").join("\n") || "";
  return parseJson(text);
}

export async function verifyLeadsWithClaude(leads, context) {
  const enabled = context.claude === true;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!enabled) {
    return { leads, meta: { enabled: false, status: "disabled" } };
  }
  if (!apiKey) {
    return { leads, meta: { enabled: true, status: "missing_api_key" } };
  }

  const limit = Math.min(Number.parseInt(context.claudeLimit, 10) || 5, 12);
  const target = leads.slice(0, limit);
  if (target.length === 0) {
    return { leads, meta: { enabled: true, status: "no_leads" } };
  }

  try {
    const reviews = await callClaude(target, context, apiKey);
    if (reviews.length === 0) {
      return {
        leads,
        meta: {
          enabled: true,
          status: "parse_error",
          model: context.claudeModel || DEFAULT_MODEL,
          reviewedLeads: 0,
          message: "Claude response could not be parsed as the expected JSON array."
        }
      };
    }
    const reviewMap = new Map(reviews.map((review) => [review.businessId, review]));
    const enriched = leads.map((lead) => {
      const review = reviewMap.get(lead.company.businessId);
      if (!review) return lead;
      const customerFacingPitch = lead.outreachReadiness === "Ready" ? (review.customerFacingPitch || null) : null;
      return {
        ...lead,
        tailoredPitchAngle: review.tailoredPitchAngle || review.tailoredPitch || lead.tailoredPitchAngle,
        customerFacingPitch,
        pitch: review.tailoredPitchAngle || review.tailoredPitch || lead.pitch,
        newsletterLine: review.newsletterLine || review.outreachAngle || "",
        agentReview: review,
        recommendedAction: review.outreachAngle || lead.recommendedAction
      };
    });
    return {
      leads: enriched,
      meta: {
        enabled: true,
        status: "ok",
        model: context.claudeModel || DEFAULT_MODEL,
        reviewedLeads: reviews.length
      }
    };
  } catch (error) {
    return {
      leads,
      meta: {
        enabled: true,
        status: "error",
        message: error.message
      }
    };
  }
}
