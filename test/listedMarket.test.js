import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzePriceMomentum,
  extractYahooPoints,
  normalizeCompanyName,
  selectBestInstrument
} from "../server/agents/listedMarketAgent.js";

test("normalizes Finnish public company suffixes", () => {
  assert.equal(normalizeCompanyName("Nokia Oyj"), "nokia");
  assert.equal(normalizeCompanyName("Qt Group Oyj"), "qt");
});

test("selectBestInstrument avoids nearby but different company names", () => {
  const rows = [
    {
      fullName: "Nokia Oyj",
      symbol: "NOKIA",
      assetClass: "SHARES",
      currency: "EUR",
      isin: "FI0009000681"
    },
    {
      fullName: "Nokian Renkaat Oyj",
      symbol: "TYRES",
      assetClass: "SHARES",
      currency: "EUR",
      isin: "FI0009005318"
    }
  ];

  assert.equal(selectBestInstrument("Nokia Oyj", rows).symbol, "NOKIA");
  assert.equal(selectBestInstrument("Nokia Solutions and Networks Oy", rows), null);
});

test("analyzePriceMomentum detects sustained growth and large jumps", () => {
  const points = Array.from({ length: 30 }, (_, index) => ({
    date: `2026-05-${String(index + 1).padStart(2, "0")}`,
    close: index < 15 ? 10 + index * 0.08 : 11.2 + (index - 15) * 0.18
  }));
  points[20].close = 14;

  const result = analyzePriceMomentum(points);
  assert.equal(result.hasSignal, true);
  assert.equal(result.sustainedGrowth, true);
  assert.equal(result.bigJump, true);
});

test("analyzePriceMomentum ignores a jump that fully reverses into a negative window", () => {
  const points = Array.from({ length: 30 }, (_, index) => ({
    date: `2026-05-${String(index + 1).padStart(2, "0")}`,
    close: index < 8 ? 10 + index * 0.1 : 11 - (index - 8) * 0.12
  }));
  points[8].close = 12.5;

  const result = analyzePriceMomentum(points);
  assert.equal(result.hasSignal, false);
  assert.equal(result.bigJump, false);
});

test("extractYahooPoints keeps dated positive closes only", () => {
  const points = extractYahooPoints({
    chart: {
      result: [
        {
          timestamp: [1772438400, 1772524800, 1772611200],
          indicators: {
            quote: [
              {
                close: [6.8, null, 7.1]
              }
            ]
          }
        }
      ]
    }
  });

  assert.deepEqual(points, [
    { date: "2026-03-02", close: 6.8 },
    { date: "2026-03-04", close: 7.1 }
  ]);
});
