import assert from "node:assert/strict";
import test from "node:test";
import {
  extractEmployeeCountFromFinancialXml,
  extractFinancialScaleProxyFromXml
} from "../server/agents/financialStatementAgent.js";

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

test("extractFinancialScaleProxyFromXml finds official revenue scale when employees are missing", () => {
  const xml = `
    <xbrli:xbrl>
      <fi-sme:NetSales contextRef="duration">12500000</fi-sme:NetSales>
    </xbrli:xbrl>
  `;

  const proxy = extractFinancialScaleProxyFromXml(xml);
  assert.equal(proxy.segment, "large_opportunity_proxy");
  assert.equal(proxy.metric, "net_sales");
  assert.equal(proxy.amount, 12500000);
});
