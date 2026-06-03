import assert from "node:assert/strict";
import test from "node:test";

process.env.ANTHROPIC_API_KEY = "test-key";

const { verifyLeadsWithClaude } = await import("../server/agents/claudeVerifierAgent.js");

test("verifyLeadsWithClaude uses outreachAngle when tailoredPitchAngle is missing", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        content: [{
          text: JSON.stringify([{
            businessId: "1234567-8",
            evidenceVerdict: "partial",
            missingFields: ["official website", "public contact"],
            outreachAngle: "Eagle Filters Group Oyj has a sourced +43.5% listed-market signal; use it only for manual qualification and verify contact route first.",
            customerFacingPitch: "I noticed Eagle Filters Group Oyj has a sourced listed-market signal and wanted to ask whether workspace, meetings or employee services are relevant to current priorities.",
            newsletterLine: "Eagle Filters Group Oyj: +43.5% listed-market signal; manual verification required.",
            warnings: ["manual verification required"]
          }])
        }]
      };
    }
  });

  try {
    const result = await verifyLeadsWithClaude([lead()], {
      claude: true,
      claudeLimit: 5,
      marketArea: { label: "Uusimaa" },
      range: { start: "2026-05-04", end: "2026-06-03" }
    });

    assert.equal(result.meta.status, "ok");
    assert.equal(result.leads[0].tailoredPitchAngle, "Eagle Filters Group Oyj has a sourced +43.5% listed-market signal; use it only for manual qualification and verify contact route first.");
    assert.equal(result.leads[0].pitch, result.leads[0].tailoredPitchAngle);
    assert.match(result.leads[0].customerFacingPitch, /workspace, meetings or employee services/i);
    assert.doesNotMatch(result.leads[0].tailoredPitchAngle, /Do not claim operational expansion/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("verifyLeadsWithClaude sends only the requested visible lead limit", async () => {
  const originalFetch = globalThis.fetch;
  let payload = null;
  globalThis.fetch = async (_url, options) => {
    payload = JSON.parse(options.body);
    const userMessage = JSON.parse(payload.messages[0].content);
    return {
      ok: true,
      async json() {
        return {
          content: [{
            text: JSON.stringify(userMessage.leads.map((item) => ({
              businessId: item.businessId,
              evidenceVerdict: "partial",
              missingFields: [],
              outreachAngle: `${item.name}: verified limited payload.`,
              tailoredPitchAngle: `${item.name}: verified limited payload.`,
              customerFacingPitch: null,
              newsletterLine: `${item.name}: checked.`,
              warnings: []
            })))
          }]
        };
      }
    };
  };

  try {
    const leads = Array.from({ length: 20 }, (_, index) => lead({
      businessId: `1234567-${index}`,
      name: `Lead ${index}`
    }));
    const result = await verifyLeadsWithClaude(leads, {
      claude: true,
      claudeLimit: 7,
      marketArea: { label: "Uusimaa" },
      range: { start: "2026-05-04", end: "2026-06-03" }
    });
    const userMessage = JSON.parse(payload.messages[0].content);

    assert.equal(userMessage.leads.length, 7);
    assert.deepEqual(userMessage.leads.map((item) => item.businessId), leads.slice(0, 7).map((item) => item.company.businessId));
    assert.equal(result.meta.candidateLeads, 20);
    assert.equal(result.meta.submittedLeads, 7);
    assert.deepEqual(result.meta.submittedBusinessIds, leads.slice(0, 7).map((item) => item.company.businessId));
    assert.equal(result.leads[7].agentReview, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function lead(overrides = {}) {
  const id = overrides.businessId || "1234567-8";
  const name = overrides.name || "Eagle Filters Group Oyj";
  return {
    company: {
      businessId: id,
      name,
      businessLine: { code: "28250", description: "Manufacture of air filtering equipment" },
      registrationDate: "1995-01-01",
      address: "Helsinki"
    },
    enrichment: {
      employeeCount: "",
      employeeCountSourceUrl: "",
      decisionMakers: [],
      emails: [],
      phones: []
    },
    companySizeEstimate: { value: "unknown" },
    growthHiringSignal: "medium",
    dataConfidence: "Medium",
    outreachReadiness: "Needs verification",
    missingEvidence: ["official website", "public contact"],
    complianceWarnings: ["No verified public business contact channel; automated outreach is not allowed."],
    tailoredPitchAngle: "Eagle Filters Group Oyj has sourced listed-market momentum. Do not claim operational expansion from price action alone; use it as a timely reason to ask whether growth, investor attention, customer events or hiring creates a need for workspace, meeting rooms or employee services.",
    pitch: "Eagle Filters Group Oyj has sourced listed-market momentum. Do not claim operational expansion from price action alone; use it as a timely reason to ask whether growth, investor attention, customer events or hiring creates a need for workspace, meeting rooms or employee services.",
    recommendedAction: "Find a verified official website or public business contact before outreach.",
    signals: [{
      type: "listed_market_sustained_growth",
      label: "Listed market sustained growth",
      detail: "+43.5% listed-market growth signal.",
      date: "2026-06-03",
      sourceName: "Yahoo Finance chart API + nfin.dev Nasdaq Nordic API",
      sourceUrl: "https://query1.finance.yahoo.com/v8/finance/chart/EAGLE.HE",
      confidence: "public-market-data"
    }]
  };
}
