import assert from "node:assert/strict";
import test from "node:test";
import { buildNewsletter } from "../server/agents/newsletterAgent.js";

const context = {
  claude: false,
  region: "whole-finland",
  marketArea: { label: "Whole Finland" },
  range: { start: "2026-05-01", end: "2026-06-03" }
};

const listedLead = {
  priority: "hot",
  score: 88,
  company: { name: "Remedy Entertainment Oyj" },
  enrichment: {
    decisionMakers: [{ label: "Board member", sourceName: "PRH Virre Trade Register extract" }],
    emails: [],
    phones: []
  },
  selectedBecause: ["Listed market sustained growth: REMEDY.HE rose +12.0%."],
  pitch: "Remedy Entertainment Oyj has sourced listed-market momentum. Do not claim operational expansion from price action alone; use it as a timely reason to ask whether growth, investor attention, customer events or hiring creates a need for workspace, meeting rooms or employee services. Decision maker found from PRH Virre Trade Register extract, but no public business email or phone is verified. Manual verification needed before outreach.",
  signals: [{
    label: "Listed market sustained growth",
    detail: "REMEDY.HE rose +12.0% from 2026-05-01 to 2026-06-03.",
    sourceName: "Yahoo Finance chart API + nfin.dev Nasdaq Nordic API",
    date: "2026-06-03"
  }]
};

test("newsletter hot and warm lines avoid internal pitches when Claude is disabled", () => {
  const newsletter = buildNewsletter([listedLead], context, { newSignals: 1, knownSignals: 0 });
  const line = newsletter.hot[0];

  assert.match(line, /Remedy Entertainment Oyj \(88\)/);
  assert.match(line, /Listed market sustained growth/);
  assert.match(line, /Yahoo Finance chart API/);
  assert.doesNotMatch(line, /Do not claim operational expansion/i);
  assert.doesNotMatch(line, /Manual verification needed/i);
  assert.doesNotMatch(line, /workspace, meeting rooms/i);
});

test("newsletter uses Claude newsletter line when Claude review exists", () => {
  const reviewedLead = {
    ...listedLead,
    agentReview: { evidenceVerdict: "verified", outreachAngle: "Use sourced share-price momentum as a qualification reason." },
    newsletterLine: "Listed share rose +12.0%; verified investor contact available; qualify event or meeting needs."
  };
  const newsletter = buildNewsletter([reviewedLead], { ...context, claude: true }, { newSignals: 1, knownSignals: 0 });

  assert.match(newsletter.hot[0], /Listed share rose \+12\.0%/);
  assert.doesNotMatch(newsletter.hot[0], /Do not claim operational expansion/i);
});

test("newsletter uses available lead pitch when Claude review is missing for that lead", () => {
  const lead = {
    ...listedLead,
    pitch: "Use the verified public business contact and ask whether investor attention creates a need for local meeting rooms.",
    tailoredPitchAngle: "Use the verified public business contact and ask whether investor attention creates a need for local meeting rooms."
  };
  const newsletter = buildNewsletter([lead], { ...context, claude: true }, { newSignals: 1, knownSignals: 0 });

  assert.match(newsletter.hot[0], /verified public business contact/);
  assert.doesNotMatch(newsletter.hot[0], /Claude review was not available/);
  assert.doesNotMatch(newsletter.hot[0], /Do not claim operational expansion/i);
});
