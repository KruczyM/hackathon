import assert from "node:assert/strict";
import test from "node:test";
import { extractEmployeeCountFromFinancialXml } from "../server/agents/financialStatementAgent.js";

test("extractEmployeeCountFromFinancialXml finds average employee count facts", () => {
  const xml = `
    <xbrli:xbrl>
      <fi-sme:AverageNumberOfEmployeesDuringPeriod contextRef="duration">12</fi-sme:AverageNumberOfEmployeesDuringPeriod>
      <fi-sme:Revenue contextRef="duration">1000000</fi-sme:Revenue>
    </xbrli:xbrl>
  `;

  const fact = extractEmployeeCountFromFinancialXml(xml);
  assert.equal(fact.value, 12);
  assert.equal(fact.factName, "AverageNumberOfEmployeesDuringPeriod");
});

