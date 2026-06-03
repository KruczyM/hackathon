import assert from "node:assert/strict";
import test from "node:test";
import {
  extractCurrentEmployeeCountFromText,
  extractSearchResultUrls
} from "../server/agents/currentEmployeeSearchAgent.js";

test("extractCurrentEmployeeCountFromText finds Finnish employee wording", () => {
  const fact = extractCurrentEmployeeCountFromText(
    "Yritys ty\u00f6llist\u00e4\u00e4 noin 1 250 ty\u00f6ntekij\u00e4\u00e4 Suomessa.",
    "https://example.fi/yritys"
  );

  assert.equal(fact.employeeCount, "1250");
  assert.equal(fact.sourceUrl, "https://example.fi/yritys");
  assert.match(fact.evidence, /ty\u00f6llist\u00e4\u00e4/);
});

test("extractCurrentEmployeeCountFromText finds English employee wording", () => {
  const fact = extractCurrentEmployeeCountFromText(
    "The company employs more than 420 professionals across Finland.",
    "https://example.com/about"
  );

  assert.equal(fact.employeeCount, "420");
  assert.equal(fact.confidence, "company-owned-current-employee-count");
});

test("extractCurrentEmployeeCountFromText finds official personnel end-of-period table values", () => {
  const fact = extractCurrentEmployeeCountFromText(
    "Personnel, end of period 14,764 17,024 Personnel on average, FTE 12,777 13,657",
    "https://www.posti.com/en/news-and-releases/financial_statements_bulletin_2024"
  );

  assert.equal(fact.employeeCount, "14764");
  assert.equal(fact.sourceUrl, "https://www.posti.com/en/news-and-releases/financial_statements_bulletin_2024");
  assert.match(fact.evidence, /Personnel, end of period/);
});

test("extractCurrentEmployeeCountFromText reads company KPI tiles without treating the year as employees", () => {
  const fact = extractCurrentEmployeeCountFromText(
    "Founded in 1649 Net sales (eur million) 1,140.2 in 2025 Employees globally 6,594 Dec 31, 2025 Presence in 29 countries",
    "https://fiskarsgroup.com/"
  );

  assert.equal(fact.employeeCount, "6594");
  assert.match(fact.evidence, /Employees globally 6,594/);
});

test("extractCurrentEmployeeCountFromText reads current Alma employee KPI formats", () => {
  const english = extractCurrentEmployeeCountFromText(
    "In 2025 Revenue MEUR 327.1 The share of digital business was 85.9 % of revenue. Employees: c. 1650",
    "https://www.almamedia.fi/en/about-us/alma-in-brief/"
  );
  const finnish = extractCurrentEmployeeCountFromText(
    "Alma lukuina 7,7 henkil\u00f6st\u00f6n sitoutuneisuus (asteikko 1-10) 1650 ty\u00f6ntekij\u00e4\u00e4 10 toimintamaata 327,1 MEUR liikevaihto vuonna 2025",
    "https://www.almamedia.fi/tyopaikat/"
  );

  assert.equal(english.employeeCount, "1650");
  assert.equal(finnish.employeeCount, "1650");
});

test("extractCurrentEmployeeCountFromText reads Finland-specific Finnish employee wording", () => {
  const fact = extractCurrentEmployeeCountFromText(
    "Almalaisia on Suomessa yli 800 ja vastaavanlainen m\u00e4\u00e4r\u00e4 meit\u00e4 ty\u00f6skentelee my\u00f6s rekrytointipalveluidemme parissa ulkomailla.",
    "https://www.almamedia.fi/tyopaikat/"
  );

  assert.equal(fact.employeeCount, "800");
});

test("extractCurrentEmployeeCountFromText ignores stale blog employee counts", () => {
  const fact = extractCurrentEmployeeCountFromText(
    "Alma Media employs approximately 2,250 professionals excluding delivery employees, of which approximately 30% work outside Finland. Alma Media's revenue in 2017 was EUR 367.3 million.",
    "https://www.almamedia.fi/en/blog/2018/05/21/management-team-appointed-for-the-alma-consumer-business-unit/"
  );

  assert.equal(fact, null);
});

test("extractCurrentEmployeeCountFromText rejects technical page metadata", () => {
  const fact = extractCurrentEmployeeCountFromText(
    '{"pagePath":"/sijoittajat/henkilostopolitiikka","contentfulMetadata":{"id":"7AAW123"},"__typename":"Page"}',
    "https://www.posti.com/"
  );

  assert.equal(fact, null);
});

test("extractCurrentEmployeeCountFromText rejects seasonal hiring counts", () => {
  const fact = extractCurrentEmployeeCountFromText(
    "Posti hired 1,700 seasonal employees for the Christmas period.",
    "https://www.posti.com/en/news-and-releases/seasonal-hiring"
  );

  assert.equal(fact, null);
});

test("extractCurrentEmployeeCountFromText rejects personnel fund amounts", () => {
  const fact = extractCurrentEmployeeCountFromText(
    "Posti paid EUR 1.5 million to the personnel fund in 2024.",
    "https://www.posti.com/en/news-and-releases/financial_statements_bulletin_2024"
  );

  assert.equal(fact, null);
});

test("extractSearchResultUrls decodes DuckDuckGo redirect links", () => {
  const urls = extractSearchResultUrls(`
    <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.fi%2Fabout%3Fref%3Dddg&amp;rut=abc">Example</a>
    <a class="result__a" href="https://example.com/people">People</a>
  `);

  assert.deepEqual(urls, [
    "https://example.fi/about?ref=ddg",
    "https://example.com/people"
  ]);
});
