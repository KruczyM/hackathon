import assert from "node:assert/strict";
import test from "node:test";
import {
  generateWebsiteCandidates,
  generateSearchQueries,
  verifyWebsiteCandidate
} from "../server/agents/websiteDiscoveryAgent.js";

const input = {
  businessId: "3626814-8",
  companyName: "Borealis Acute Operations Oy",
  auxiliaryNames: ["Ensiapumestari"],
  address: "Satamakatu 27 40100 JYVASKYLA",
  city: "JYVASKYLA",
  decisionMakers: [{ name: "Aapo Matias Liukko", role: "Managing Director / CEO" }]
};

test("generateWebsiteCandidates includes shortened company-name domains", () => {
  const candidates = generateWebsiteCandidates(input);
  assert.ok(candidates.includes("https://www.borealisacute.com"));
});

test("generateWebsiteCandidates searches company domain without Oy suffix", () => {
  const candidates = generateWebsiteCandidates({
    businessId: "1234567-8",
    companyName: "House of Bonkers Oy",
    auxiliaryNames: []
  });
  assert.ok(candidates.includes("https://www.houseofbonkers.com"));
});

test("generateWebsiteCandidates searches public-company domain without Oyj suffix", () => {
  const candidates = generateWebsiteCandidates({
    businessId: "1944757-4",
    companyName: "Alma Media Oyj",
    auxiliaryNames: []
  });
  assert.ok(candidates.includes("https://www.almamedia.fi"));
});

test("generateSearchQueries includes business ID and Virre decision maker context", () => {
  const queries = generateSearchQueries(input);
  assert.ok(queries.includes("\"Borealis Acute Operations Oy\" \"3626814-8\""));
  assert.ok(queries.includes("\"Aapo Matias Liukko\" \"Borealis Acute Operations Oy\""));
});

test("verifyWebsiteCandidate marks exact Business ID match as verified high confidence", async () => {
  await withMockFetch("Borealis Acute Operations Oy Y-tunnus 3626814-8 Satamakatu 27 40100 JYVASKYLA", async () => {
    const result = await verifyWebsiteCandidate(input, "https://www.borealisacute.com", { maxPages: 2 });
    assert.equal(result.status, "verified");
    assert.equal(result.confidence, "high");
    assert.ok(result.matchedEvidence.some((item) => item.type === "business_id"));
  });
});

test("verifyWebsiteCandidate does not verify a similar-name-only website", async () => {
  await withMockFetch("Borealis Acute Operations Oy management consultancy", async () => {
    const result = await verifyWebsiteCandidate(input, "https://www.borealisacute.com", { maxPages: 2 });
    assert.equal(result.status, "candidate");
    assert.notEqual(result.confidence, "high");
  });
});

test("verifyWebsiteCandidate verifies exact legal name plus exact domain after Oyj suffix removal", async () => {
  await withMockFetch("Alma Media Oyj investors contact", async () => {
    const result = await verifyWebsiteCandidate({
      businessId: "1944757-4",
      companyName: "Alma Media Oyj",
      auxiliaryNames: [],
      address: "",
      city: "",
      decisionMakers: []
    }, "https://www.almamedia.fi", { maxPages: 2 });

    assert.equal(result.status, "verified");
    assert.equal(result.confidence, "medium");
    assert.ok(result.matchedEvidence.some((item) => item.type === "exact_domain_stem"));
  });
});

test("verifyWebsiteCandidate marks different Business ID as conflict", async () => {
  await withMockFetch("Borealis Acute Operations Oy Y-tunnus 1234567-8", async () => {
    const result = await verifyWebsiteCandidate(input, "https://www.borealisacute.com", { maxPages: 1 });
    assert.equal(result.status, "conflict");
    assert.ok(result.matchedEvidence.some((item) => item.type === "conflict_business_id"));
  });
});

async function withMockFetch(body, callback) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => ({
    ok: true,
    url: String(url),
    headers: {
      get(name) {
        return name.toLowerCase() === "content-type" ? "text/html" : "";
      }
    },
    async text() {
      return `<html><body>${body}</body></html>`;
    }
  });
  try {
    await callback();
  } finally {
    globalThis.fetch = originalFetch;
  }
}
