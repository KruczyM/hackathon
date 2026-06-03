import assert from "node:assert/strict";
import test from "node:test";
import { extractVirreResponsiblePeople } from "../server/agents/virreAgent.js";

test("extractVirreResponsiblePeople reads board and CEO names without birth dates", () => {
  const text = `
KAUPPAREKISTERIOTE
OTE 03.06.2026

Hallitus
Hallitus (Rekisteröity 02.05.2026 09:06:38)
Tehtävä tai asema Nimi Syntymäaika
Puheenjohtaja Ihamuotila Timo Jaakko Pietari 21.04.1966
Jäsen Ahopelto Timo Mika Juhani 15.03.1975
Jäsen Erola Sari Kristiina 04.03.1966

Toimitusjohtaja
Toimitusjohtaja (Rekisteröity 30.09.2025 07:50:50)
Tehtävä tai asema Nimi Syntymäaika
Toimitusjohtaja Hotard Justin Matthew 28.03.1974

Tilintarkastajat
`;

  const people = extractVirreResponsiblePeople(text, {
    businessId: { value: "0112038-9" },
    names: [{ type: "1", version: 1, name: "Nokia Oyj" }]
  });

  assert.equal(people[0].name, "Justin Matthew Hotard");
  assert.equal(people[0].title, "Managing director / CEO");
  assert.equal(people[1].name, "Timo Jaakko Pietari Ihamuotila");
  assert.equal(people[1].title, "Chair of the board");
  assert.equal(people[0].metadata.extractDate, "03.06.2026");
  assert.equal(JSON.stringify(people).includes("28.03.1974"), false);
  assert.equal(JSON.stringify(people).includes("21.04.1966"), false);
});
