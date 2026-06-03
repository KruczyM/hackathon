import assert from "node:assert/strict";
import test from "node:test";
import { buildLead, employeeSegment } from "../server/agents/scoringAgent.js";

test("buildLead gives a new software company a warm or hot score", () => {
  const lead = buildLead({
    businessId: { value: "1234567-8", registrationDate: "2026-06-01" },
    names: [{ name: "Example Software Oy", type: "1", version: 1, registrationDate: "2026-06-01" }],
    mainBusinessLine: {
      type: "62100",
      descriptions: [{ languageCode: "3", description: "Computer programming activities" }]
    },
    companyForms: [],
    companySituations: [],
    registeredEntries: [],
    addresses: [],
    tradeRegisterStatus: "1",
    registrationDate: "2026-06-01",
    lastModified: "2026-06-01T10:00:00"
  }, {
    range: { start: "2026-05-01", end: "2026-06-02" },
    focus: "software"
  });

  assert.ok(lead.score >= 45);
  assert.equal(lead.company.name, "Example Software Oy");
  assert.ok(lead.signals.some((signal) => signal.type === "new_company"));
});

test("new company with Virre decision maker but no contact needs verification and is not hot", () => {
  const lead = buildLead(exampleCompany(), {
    range: { start: "2026-05-01", end: "2026-06-03" },
    focus: "all",
    enrichment: {
      decisionMakers: [{
        label: "Aapo Matias Liukko - Managing director / CEO",
        sourceName: "PRH Virre Trade Register extract",
        sourceUrl: "https://virre.prh.fi/novus/companySearch?userLang=en"
      }],
      sourceName: "PRH Virre Trade Register extract",
      sourceUrl: "https://virre.prh.fi/novus/companySearch?userLang=en",
      confidence: "official-virre-extract",
      verificationStatus: "official-public-register-extract",
      verificationEvidence: ["Virre Trade Register extract PDF downloaded."],
      verifiedSources: [{ url: "https://virre.prh.fi/novus/companySearch?userLang=en" }]
    }
  });

  assert.equal(lead.priority, "warm");
  assert.equal(lead.outreachReadiness, "Needs verification");
  assert.ok(lead.score <= 70);
  assert.equal(lead.companySizeEstimate.value, "unknown");
  assert.equal(lead.growthHiringSignal, "none");
  assert.equal(lead.customerFacingPitch, null);
  assert.equal(/small team|growing team|hiring/i.test(lead.pitch), false);
});

test("verified contact plus listed growth can become hot", () => {
  const lead = buildLead(exampleCompany(), {
    range: { start: "2026-05-01", end: "2026-06-03" },
    focus: "consultancy",
    enrichment: {
      employeeCount: "22",
      employeeCountSourceName: "PRH XBRL financial statement",
      employeeCountSourceUrl: "https://avoindata.prh.fi/fi/financial-statements",
      employeeCountEvidence: "AverageNumberOfEmployeesDuringPeriod=22",
      decisionMakers: [],
      emails: ["info@example.fi"],
      phones: ["010 1234567"],
      companyWebsite: "https://example.fi",
      companyWebsiteSourceUrl: "https://example.fi",
      contactSourceUrl: "https://example.fi/contact",
      sourceName: "Verified company website",
      sourceUrl: "https://example.fi/contact",
      confidence: "company-owned-public-web",
      verificationStatus: "official-prh-website-field",
      verificationEvidence: ["Website URL is present in the official PRH company record."],
      verifiedSources: [{ url: "https://example.fi" }]
    },
    marketSignals: [{
      type: "listed_market_sustained_growth",
      label: "Listed market sustained growth",
      date: "2026-06-03",
      detail: "Share rose +12.0% with positive sessions.",
      sourceName: "Yahoo Finance chart API + nfin.dev Nasdaq Nordic API",
      sourceUrl: "https://query1.finance.yahoo.com/v8/finance/chart/EXAMPLE.HE?range=3mo&interval=1d",
      confidence: "public-market-data",
      weight: 32
    }]
  });

  assert.equal(lead.priority, "hot");
  assert.equal(lead.outreachReadiness, "Ready");
  assert.equal(lead.companySizeEstimate.value, "11-50");
  assert.equal(lead.growthHiringSignal, "medium");
  assert.ok(lead.selectedBecause.some((reason) => reason.includes("Listed market sustained growth")));
  assert.ok(lead.score <= 100);
});

test("employeeSegment separates mid-market from enterprise companies", () => {
  assert.equal(employeeSegment({ employeeCount: "120" }).value, "mid_market");
  assert.equal(employeeSegment({ employeeCount: "700" }).value, "large_opportunity");
  assert.equal(employeeSegment({ employeeCount: "1500" }).value, "enterprise_watch");
  assert.equal(employeeSegment({ employeeCount: "6594" }).value, "enterprise");
});

test("enterprise companies need stronger evidence before becoming hot", () => {
  const lead = buildLead(exampleCompany(), {
    range: { start: "2026-05-01", end: "2026-06-03" },
    focus: "all",
    enrichment: {
      employeeCount: "6594",
      employeeCountSourceName: "Verified company website",
      employeeCountSourceUrl: "https://example.fi",
      employeeCountEvidence: "Employees globally 6,594",
      companyWebsite: "https://example.fi",
      companyWebsiteSourceUrl: "https://example.fi",
      sourceName: "Verified company website",
      sourceUrl: "https://example.fi",
      confidence: "company-owned-public-web",
      verificationStatus: "official-company-website-verified",
      verificationEvidence: ["Website verified by fetched company-owned source evidence."],
      verifiedSources: [{ url: "https://example.fi" }]
    }
  });

  assert.equal(lead.employeeSegment.value, "enterprise");
  assert.equal(lead.enterprisePenalty, true);
  assert.ok(lead.score <= 55);
});

function exampleCompany() {
  return {
    businessId: { value: "3626814-8", registrationDate: "2026-05-26" },
    names: [{ name: "Borealis Acute Operations Oy", type: "1", version: 1, registrationDate: "2026-05-26" }],
    mainBusinessLine: {
      type: "70200",
      descriptions: [{ languageCode: "3", description: "Business and other management consultancy activities" }]
    },
    companyForms: [],
    companySituations: [],
    registeredEntries: [],
    addresses: [{
      type: 1,
      street: "Satamakatu",
      buildingNumber: "27",
      postCode: "40100",
      postOffices: [{ languageCode: "1", city: "JYVASKYLA" }]
    }],
    tradeRegisterStatus: "1",
    registrationDate: "2026-05-26",
    lastModified: "2026-05-26T10:00:00"
  };
}
