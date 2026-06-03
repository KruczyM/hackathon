export const MARKET_AREAS = {
  "whole-finland": {
    label: "Whole Finland",
    cities: []
  },
  "kuopio-hub": {
    label: "Kuopio hub",
    cities: ["Kuopio", "Siilinj\u00e4rvi", "Iisalmi", "Varkaus", "Lepp\u00e4virta", "Suonenjoki"]
  },
  "uusimaa": {
    label: "Uusimaa",
    cities: ["Helsinki", "Espoo", "Vantaa", "Porvoo", "Hyvink\u00e4\u00e4", "J\u00e4rvenp\u00e4\u00e4", "Lohja", "Kirkkonummi", "Tuusula", "Kerava"]
  },
  "southwest-finland": {
    label: "Southwest Finland",
    cities: ["Turku", "Salo", "Kaarina", "Raisio", "Naantali", "Lieto", "Uusikaupunki", "Loimaa", "Paimio"]
  },
  "satakunta": {
    label: "Satakunta",
    cities: ["Pori", "Rauma", "Ulvila", "Kankaanp\u00e4\u00e4", "Huittinen", "Kokem\u00e4ki", "Harjavalta"]
  },
  "kanta-hame": {
    label: "Kanta-Hame",
    cities: ["H\u00e4meenlinna", "Riihim\u00e4ki", "Forssa", "Janakkala", "Hattula"]
  },
  "pirkanmaa": {
    label: "Pirkanmaa",
    cities: ["Tampere", "Nokia", "Yl\u00f6j\u00e4rvi", "Kangasala", "Lemp\u00e4\u00e4l\u00e4", "Valkeakoski", "Pirkkala", "Sastamala", "M\u00e4ntt\u00e4-Vilppula"]
  },
  "paijat-hame": {
    label: "Paijat-Hame",
    cities: ["Lahti", "Hollola", "Heinola", "Orimattila", "Asikkala", "Sysm\u00e4"]
  },
  "kymenlaakso": {
    label: "Kymenlaakso",
    cities: ["Kouvola", "Kotka", "Hamina", "Pyht\u00e4\u00e4", "Miehikk\u00e4l\u00e4", "Virolahti"]
  },
  "south-karelia": {
    label: "South Karelia",
    cities: ["Lappeenranta", "Imatra", "Parikkala", "Ruokolahti", "Luum\u00e4ki"]
  },
  "south-savo": {
    label: "South Savo",
    cities: ["Mikkeli", "Savonlinna", "Pieks\u00e4m\u00e4ki", "Juva", "Kangasniemi", "M\u00e4ntyharju"]
  },
  "north-savo": {
    label: "North Savo",
    cities: ["Kuopio", "Siilinj\u00e4rvi", "Iisalmi", "Varkaus", "Lepp\u00e4virta", "Suonenjoki", "Lapinlahti", "Kiuruvesi", "Nilsi\u00e4", "Pielavesi"]
  },
  "north-karelia": {
    label: "North Karelia",
    cities: ["Joensuu", "Lieksa", "Nurmes", "Kitee", "Outokumpu", "Kontiolahti", "Liperi"]
  },
  "central-finland": {
    label: "Central Finland",
    cities: ["Jyv\u00e4skyl\u00e4", "\u00c4\u00e4nekoski", "J\u00e4ms\u00e4", "Saarij\u00e4rvi", "Keuruu", "Laukaa"]
  },
  "south-ostrobothnia": {
    label: "South Ostrobothnia",
    cities: ["Sein\u00e4joki", "Kauhajoki", "Lapua", "Kurikka", "Ilmajoki", "Alavus", "Kauhava"]
  },
  "ostrobothnia": {
    label: "Ostrobothnia",
    cities: ["Vaasa", "Mustasaari", "Pietarsaari", "N\u00e4rpi\u00f6", "Uusikaarlepyy", "Laihia"]
  },
  "central-ostrobothnia": {
    label: "Central Ostrobothnia",
    cities: ["Kokkola", "Kannus", "Kaustinen", "Toholampi", "Veteli"]
  },
  "north-ostrobothnia": {
    label: "North Ostrobothnia",
    cities: ["Oulu", "Raahe", "Ylivieska", "Kuusamo", "Kalajoki", "Kempele", "Liminka"]
  },
  "kainuu": {
    label: "Kainuu",
    cities: ["Kajaani", "Kuhmo", "Sotkamo", "Suomussalmi", "Paltamo"]
  },
  "lapland": {
    label: "Lapland",
    cities: ["Rovaniemi", "Kemi", "Tornio", "Sodankyl\u00e4", "Kemij\u00e4rvi", "Kittil\u00e4", "Inari"]
  },
  "aland": {
    label: "Aland",
    cities: ["Maarianhamina", "Jomala", "Finstr\u00f6m", "Lemland", "Saltvik"]
  }
};

function wholeFinlandCities() {
  return [...new Set(Object.entries(MARKET_AREAS)
    .filter(([key]) => key !== "whole-finland")
    .flatMap(([, area]) => area.cities))];
}

export function expandMarketArea(value) {
  const raw = String(value || "kuopio-hub").trim();
  if (raw === "whole-finland") return wholeFinlandCities();
  const preset = MARKET_AREAS[raw];
  if (preset) return preset.cities;
  return raw.split(",").map((city) => city.trim()).filter(Boolean);
}

export function marketAreaLabel(value) {
  const raw = String(value || "kuopio-hub").trim();
  return MARKET_AREAS[raw]?.label ?? raw;
}
