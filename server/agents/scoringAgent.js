import { isWithinRange, daysSince } from "../lib/dates.js";
import { stableHash } from "../lib/hash.js";
import { prhCompanyUrl, prhNoticeUrl } from "./prhSourceAgent.js";

const OFFICE_FIT_CODES = [
  "62",
  "63",
  "70",
  "71",
  "72",
  "73",
  "74",
  "78",
  "82",
  "86",
  "58",
  "66",
  "64"
];

const HIGH_VALUE_NOTICE_CODES = new Set([
  "HAL",
  "JOH",
  "JOHT",
  "TOIM",
  "KOTI",
  "NIMA",
  "NIML",
  "NIMO",
  "FUUSI",
  "JAKAU",
  "SIIKUU",
  "ESR",
  "STA",
  "TASE"
]);

function currentName(company) {
  return company.names?.find((name) => name.type === "1" && name.version === 1)?.name ?? company.names?.[0]?.name ?? "Unknown company";
}

function businessId(company) {
  return company.businessId?.value ?? "";
}

function englishDescription(entries = []) {
  return entries.find((item) => item.languageCode === "3")?.description ?? entries[0]?.description ?? "";
}

function businessLine(company) {
  const code = company.mainBusinessLine?.type ?? "";
  const description = englishDescription(company.mainBusinessLine?.descriptions ?? []);
  return { code, description };
}

function address(company) {
  const selected = company.addresses?.find((item) => item.type === 1) ?? company.addresses?.[0];
  if (!selected) return "";
  const city = selected.postOffices?.find((office) => office.languageCode === "1")?.city ?? selected.postOffices?.[0]?.city ?? "";
  return [selected.street, selected.buildingNumber, selected.postCode, city].filter(Boolean).join(" ");
}

function makeSignal(company, partial) {
  return {
    id: stableHash([businessId(company), partial.type, partial.date, partial.title ?? partial.label, partial.sourceUrl, partial.idSeed ?? ""]),
    businessId: businessId(company),
    companyName: currentName(company),
    sourceName: "PRH Open Data",
    sourceUrl: prhCompanyUrl(businessId(company)),
    confidence: "official",
    ...partial
  };
}

export function officialSignals(company, range) {
  const signals = [];
  const id = businessId(company);

  if (isWithinRange(company.registrationDate, range.start, range.end)) {
    signals.push(makeSignal(company, {
      type: "new_company",
      label: "New company",
      date: company.registrationDate,
      title: `${currentName(company)} was registered`,
      detail: `Registered in the Finnish Trade Register on ${company.registrationDate}.`,
      weight: 32
    }));
  }

  if (isWithinRange(company.businessId?.registrationDate, range.start, range.end)) {
    signals.push(makeSignal(company, {
      type: "new_business_id",
      label: "New Business ID",
      date: company.businessId.registrationDate,
      title: `${currentName(company)} received a Business ID`,
      detail: `Business ID ${id} was granted on ${company.businessId.registrationDate}.`,
      weight: 18
    }));
  }

  if (isWithinRange(company.lastModified, range.start, range.end)) {
    signals.push(makeSignal(company, {
      type: "official_update",
      label: "Official update",
      date: String(company.lastModified).slice(0, 10),
      title: `${currentName(company)} has recent official changes`,
      detail: `PRH record last modified on ${company.lastModified}.`,
      weight: 10
    }));
  }

  for (const name of company.names ?? []) {
    if (name.type === "3" && isWithinRange(name.registrationDate, range.start, range.end)) {
      signals.push(makeSignal(company, {
        type: "new_auxiliary_name",
        label: "New brand/name",
        date: name.registrationDate,
        title: `${currentName(company)} registered auxiliary name ${name.name}`,
        detail: `Auxiliary name ${name.name} was registered on ${name.registrationDate}.`,
        weight: 16
      }));
    }
    if (name.endDate && isWithinRange(name.endDate, range.start, range.end)) {
      signals.push(makeSignal(company, {
        type: "name_change",
        label: "Name change",
        date: name.endDate,
        title: `${currentName(company)} changed name`,
        detail: `Previous name ${name.name} ended on ${name.endDate}.`,
        weight: 18
      }));
    }
  }

  if (company.website?.registrationDate && isWithinRange(company.website.registrationDate, range.start, range.end)) {
    signals.push(makeSignal(company, {
      type: "website_update",
      label: "Website added/updated",
      date: company.website.registrationDate,
      title: `${currentName(company)} added or updated website details`,
      detail: `Website field ${company.website.url} registered on ${company.website.registrationDate}.`,
      weight: 12
    }));
  }

  for (const situation of company.companySituations ?? []) {
    signals.push(makeSignal(company, {
      type: "risk_signal",
      label: "Company situation",
      date: situation.registrationDate,
      title: `${currentName(company)} has a company situation flag`,
      detail: `Situation code ${situation.type} in official register.`,
      weight: -20
    }));
  }

  return signals;
}

export function noticeSignals(company, range) {
  const notices = company.publicNotices ?? [];
  return notices
    .filter((notice) => isWithinRange(notice.registrationDate, range.start, range.end))
    .map((notice) => {
      const codes = notice.entryCodes ?? [];
      const important = codes.some((code) => HIGH_VALUE_NOTICE_CODES.has(code));
      return makeSignal(company, {
        type: "registered_notice",
        label: important ? "Important registered notice" : "Registered notice",
        date: notice.registrationDate,
        title: `${currentName(company)} registered notice ${notice.recordNumber}`,
        detail: `Notice type ${notice.typeOfRegistration}, entry codes: ${codes.join(", ") || "none"}.`,
        sourceUrl: prhNoticeUrl(businessId(company)),
        weight: important ? 18 : 8,
        metadata: {
          recordNumber: notice.recordNumber,
          entryCodes: codes,
          typeOfRegistration: notice.typeOfRegistration
        }
      });
    });
}

function sectorFit(company) {
  const { code, description } = businessLine(company);
  if (OFFICE_FIT_CODES.some((prefix) => code.startsWith(prefix))) return 14;
  if (/software|consult|advertising|publishing|engineering|research|holding|insurance|health/i.test(description)) return 10;
  return 0;
}

function focusFit(company, focus) {
  if (!focus || focus === "all") return 0;
  const haystack = `${currentName(company)} ${businessLine(company).description}`.toLowerCase();
  const focusWords = String(focus)
    .toLowerCase()
    .split(/[,\s/]+/)
    .filter((word) => word.length > 2);
  return focusWords.some((word) => haystack.includes(word)) ? 10 : 0;
}

function employeeScore(enrichment) {
  const count = Number.parseInt(enrichment?.employeeCount, 10);
  if (!Number.isFinite(count)) return scaleProxyScore(enrichment);
  if (count >= 50) return 18;
  if (count >= 10) return 12;
  if (count >= 3) return 6;
  return 0;
}

export function companySizeEstimate(enrichment) {
  const count = Number.parseInt(enrichment?.employeeCount, 10);
  if (!Number.isFinite(count)) {
    const proxy = scaleProxySegment(enrichment);
    if (proxy) {
      return {
        value: proxy.label,
        employeeCountSource: proxy.sourceName,
        sourceUrl: proxy.sourceUrl,
        scoreImpact: proxy.scoreImpact,
        note: proxy.evidence
      };
    }
    return {
      value: "unknown",
      employeeCountSource: "missing",
      scoreImpact: -5,
      note: "No employee count evidence found."
    };
  }
  if (count <= 10) return sizeEstimate("1-10", enrichment, 6);
  if (count <= 50) return sizeEstimate("11-50", enrichment, 12);
  if (count <= 200) return sizeEstimate("51-200", enrichment, 18);
  return sizeEstimate("200+", enrichment, 18);
}

export function employeeSegment(enrichment) {
  const count = Number.parseInt(enrichment?.employeeCount, 10);
  if (!Number.isFinite(count)) {
    const proxy = scaleProxySegment(enrichment);
    if (proxy) return proxy;
    return {
      value: "unknown",
      label: "Unknown size",
      targetFit: "watch",
      enterprisePenalty: false,
      minEmployees: null,
      maxEmployees: null
    };
  }
  if (count >= 50 && count <= 249) return segment("mid_market", "50-249 mid-market target", "core", false, 50, 249);
  if (count >= 250 && count <= 999) return segment("large_opportunity", "250-999 large opportunity", "secondary", false, 250, 999);
  if (count >= 1000 && count <= 4999) return segment("enterprise_watch", "1000-4999 enterprise watch", "watch", true, 1000, 4999);
  if (count >= 5000) return segment("enterprise", "5000+ enterprise / moloch", "watch", true, 5000, null);
  if (count >= 11) return segment("small_scaling", "11-49 small scaling company", "watch", false, 11, 49);
  return segment("micro", "1-10 micro company", "watch", false, 1, 10);
}

function scaleProxyScore(enrichment) {
  const proxy = scaleProxySegment(enrichment);
  if (!proxy) return -5;
  if (proxy.value === "large_opportunity_proxy") return 14;
  if (proxy.value === "mid_market_proxy") return 10;
  return 6;
}

function scaleProxySegment(enrichment) {
  const value = enrichment?.organizationScaleProxy || "";
  if (!value) return null;
  if (value === "mid_market_proxy") {
    return proxySegment(enrichment, value, "Financial scale proxy: mid-market candidate", "proxy", false, 10);
  }
  if (value === "large_opportunity_proxy") {
    return proxySegment(enrichment, value, "Financial scale proxy: large candidate", "proxy-secondary", false, 14);
  }
  if (value === "enterprise_watch_proxy") {
    return proxySegment(enrichment, value, "Financial scale proxy: enterprise watch", "proxy-watch", true, 6);
  }
  return null;
}

function proxySegment(enrichment, value, fallbackLabel, targetFit, enterprisePenalty, scoreImpact) {
  return {
    value,
    label: enrichment.organizationScaleProxyLabel || fallbackLabel,
    targetFit,
    enterprisePenalty,
    minEmployees: null,
    maxEmployees: null,
    isProxy: true,
    sourceName: enrichment.organizationScaleProxySourceName || "PRH XBRL financial statement",
    sourceUrl: enrichment.organizationScaleProxySourceUrl || "",
    evidence: enrichment.organizationScaleProxyEvidence || "Official financial statement scale proxy; not an employee count.",
    scoreImpact
  };
}

function segment(value, label, targetFit, enterprisePenalty, minEmployees, maxEmployees) {
  return {
    value,
    label,
    targetFit,
    enterprisePenalty,
    minEmployees,
    maxEmployees
  };
}

function sizeEstimate(value, enrichment, scoreImpact) {
  return {
    value,
    employeeCount: enrichment.employeeCount,
    employeeCountSource: enrichment.employeeCountSourceName || "source attached",
    sourceUrl: enrichment.employeeCountSourceUrl || "",
    scoreImpact,
    note: enrichment.employeeCountEvidence || `Employee count ${enrichment.employeeCount} found.`
  };
}

function noveltyScore(company) {
  const age = daysSince(company.registrationDate);
  if (age === null) return 0;
  if (age <= 30) return 18;
  if (age <= 180) return 10;
  if (age <= 730) return 4;
  return 0;
}

function priority(score) {
  if (score >= 75) return "hot";
  if (score >= 45) return "warm";
  return "watch";
}

const FORMATION_SIGNAL_TYPES = new Set([
  "new_company",
  "new_business_id",
  "new_auxiliary_name"
]);

const GROWTH_SIGNAL_TYPES = new Set([
  "employee_growth",
  "growth_jump",
  "sustained_growth",
  "current_momentum",
  "market_attention",
  "listed_market_sustained_growth",
  "listed_market_jump",
  "investment_enrichment"
]);

function verifiedWebsite(enrichment) {
  return Boolean(enrichment?.companyWebsite && (enrichment.companyWebsiteSourceUrl || enrichment.verifiedSources?.length));
}

function verifiedEmail(enrichment) {
  return Boolean(enrichment?.emails?.length);
}

function verifiedPhone(enrichment) {
  return Boolean(enrichment?.phones?.length);
}

function hasPublicBusinessContact(enrichment) {
  return verifiedEmail(enrichment) || verifiedPhone(enrichment) || Boolean(enrichment?.contactFormUrl);
}

function hasSourceConflict(enrichment) {
  return /conflict|blocked/i.test(`${enrichment?.verificationStatus || ""} ${enrichment?.confidence || ""}`);
}

export function growthHiringSignal(signals = []) {
  const hiring = signals.filter((signal) => /hiring|job_posting|recruit/i.test(signal.type || signal.label || signal.detail || ""));
  const employeeGrowth = signals.filter((signal) => signal.type === "employee_growth");
  const investment = signals.filter((signal) => signal.type === "investment_enrichment");
  const publicGrowth = signals.filter((signal) => GROWTH_SIGNAL_TYPES.has(signal.type));
  const change = signals.filter((signal) => signal.type === "registered_notice" || signal.type === "website_update" || signal.type === "name_change");

  if (hiring.length || employeeGrowth.length || investment.length) {
    return {
      level: "strong",
      evidence: [...hiring, ...employeeGrowth, ...investment].map(signalEvidence).slice(0, 4)
    };
  }
  if (publicGrowth.length) {
    return {
      level: "medium",
      evidence: publicGrowth.map(signalEvidence).slice(0, 4)
    };
  }
  if (change.length) {
    return {
      level: "weak",
      evidence: change.map(signalEvidence).slice(0, 4)
    };
  }
  return {
    level: "none",
    evidence: []
  };
}

function signalEvidence(signal) {
  return {
    type: signal.type,
    label: signal.label,
    sourceName: signal.sourceName,
    sourceUrl: signal.sourceUrl,
    date: signal.date || "",
    confidence: signal.confidence || "",
    evidence: signal.detail || signal.title || signal.label || ""
  };
}

function onlyFormationOrEnrichment(signals) {
  const positive = signals.filter((signal) => (signal.weight ?? 0) > 0);
  if (!positive.length) return false;
  return positive.every((signal) => FORMATION_SIGNAL_TYPES.has(signal.type) || signal.type === "enrichment");
}

export function applyLeadScoringSafety(score, signals = [], enrichment = {}) {
  const conflict = hasSourceConflict(enrichment);
  const contactReady = hasPublicBusinessContact(enrichment);
  const websiteReady = verifiedWebsite(enrichment);
  const growthSignal = growthHiringSignal(signals);
  const segment = employeeSegment(enrichment);
  let maxScore = 100;
  let outreachReadiness = contactReady ? "Ready" : "Needs verification";

  if (conflict) {
    maxScore = 30;
    outreachReadiness = "Blocked";
  }
  if (!websiteReady && !contactReady) {
    maxScore = Math.min(maxScore, 65);
  }
  if (!contactReady) {
    maxScore = Math.min(maxScore, 70);
  }
  if (growthSignal.level === "none") {
    maxScore = Math.min(maxScore, 70);
  }
  if (onlyFormationOrEnrichment(signals)) {
    maxScore = Math.min(maxScore, 70);
  }
  if (segment.enterprisePenalty && growthSignal.level === "none") {
    maxScore = Math.min(maxScore, 55);
  }
  if (segment.value === "enterprise" && growthSignal.level !== "strong" && !contactReady) {
    maxScore = Math.min(maxScore, 50);
  }

  const finalScore = Math.max(0, Math.min(100, maxScore, Math.round(score)));
  return {
    score: finalScore,
    priority: conflict ? "watch" : priority(finalScore),
    outreachReadiness,
    scoreCeiling: maxScore,
    dataConfidence: dataConfidence(enrichment, signals, outreachReadiness),
    growthHiringSignal: growthSignal.level,
    growthHiringEvidence: growthSignal.evidence,
    employeeSegment: segment
  };
}

function dataConfidence(enrichment, signals, outreachReadiness) {
  if (outreachReadiness === "Blocked") return "Low";
  const sourcedPieces = [
    verifiedWebsite(enrichment),
    hasPublicBusinessContact(enrichment),
    Boolean(enrichment?.decisionMakers?.length),
    Boolean(enrichment?.employeeCount || enrichment?.organizationScaleProxy),
    growthHiringSignal(signals).level !== "none"
  ].filter(Boolean).length;

  if (sourcedPieces >= 4) return "High";
  if (sourcedPieces >= 1) return "Medium";
  return "Low";
}

function novapolisAngles(company, signals, enrichment) {
  const angles = [];
  const line = businessLine(company);
  if (signals.some((signal) => signal.type === "listed_market_sustained_growth" || signal.type === "listed_market_jump")) {
    angles.push("Listed-market signal: public share-price momentum can indicate market attention; qualify whether it creates local office, meeting, event or employee-service needs.");
  }
  if (sectorFit(company) > 0) angles.push(`Office/service fit: ${line.description || "professional company profile"}.`);
  if (signals.some((signal) => signal.type === "new_company")) angles.push("New entity may still be setting up operating routines, supplier relationships and local business services.");
  if (signals.some((signal) => signal.type === "registered_notice")) angles.push("Recent official registry activity gives a timely reason to contact.");
  if (enrichment?.employeeCount) angles.push(`Employee count signal: ${enrichment.employeeCount} from ${enrichment.employeeCountSourceName || "enrichment source"}.`);
  if (!enrichment?.employeeCount && enrichment?.organizationScaleProxy) angles.push(`Financial scale proxy: ${enrichment.organizationScaleProxyEvidence}`);
  if (enrichment?.decisionMakers?.length) angles.push(`Possible decision maker found: ${formatPerson(enrichment.decisionMakers[0])}.`);
  if (angles.length === 0) angles.push("Keep on watchlist until a stronger growth or change signal appears.");
  return angles.slice(0, 4);
}

function formatPerson(person) {
  if (!person) return "";
  if (typeof person === "string") return person;
  return [person.label, person.email, person.phone].filter(Boolean).join(" / ");
}

function contactInstruction(enrichment) {
  const person = enrichment?.decisionMakers?.[0];
  if (enrichment?.emails?.length || enrichment?.phones?.length) {
    return `Use the verified public business contact ${[enrichment.emails?.[0], enrichment.phones?.[0]].filter(Boolean).join(" / ")} and reference the source before outreach.`;
  }
  if (person) return `Decision maker found from ${person.sourceName || "public source"}, but no public business email or phone is verified. Manual verification needed before outreach.`;
  return "Find a verified official website or public business contact before outreach.";
}

function recommendedActions(enrichment, outreachReadiness) {
  if (outreachReadiness === "Blocked") {
    return [
      "Resolve source conflict before scoring or outreach",
      "Do not generate customer-facing outreach yet"
    ];
  }
  if (outreachReadiness === "Ready") {
    return [
      "Review the sourced evidence",
      "Use the verified public business contact",
      "Keep claims limited to visible facts and cautious fit language"
    ];
  }
  const actions = [
    "Find verified official website or public business contact",
    "Do not run automated outreach yet"
  ];
  if (enrichment?.decisionMakers?.length) actions.unshift("Use the Virre decision maker only for manual B2B review until a contact channel is verified");
  return actions;
}

function missingEvidence(signals, enrichment) {
  const missing = [];
  if (!verifiedWebsite(enrichment)) missing.push("official website");
  if (!verifiedEmail(enrichment)) missing.push("company email");
  if (!verifiedPhone(enrichment)) missing.push("company phone");
  if (!enrichment?.employeeCount) missing.push("employee count");
  if (!signals.some((signal) => /hiring|job_posting|recruit/i.test(signal.type || signal.label || signal.detail || ""))) missing.push("hiring signal");
  if (!signals.some((signal) => GROWTH_SIGNAL_TYPES.has(signal.type) || signal.type === "investment_enrichment")) missing.push("growth, investment or expansion signal");
  return missing;
}

function selectedBecause(company, signals, enrichment) {
  const reasons = [];
  const newCompany = signals.find((signal) => signal.type === "new_company");
  const listedSignal = signals.find((signal) => signal.type === "listed_market_sustained_growth" || signal.type === "listed_market_jump");
  if (newCompany) reasons.push(`New company registered on ${newCompany.date}.`);
  if (listedSignal) reasons.push(`${listedSignal.label}: ${listedSignal.detail.split(". ")[0]}.`);
  if (address(company)) reasons.push(`Located at ${address(company)}.`);
  if (sectorFit(company) > 0) reasons.push(`Office-compatible industry: ${businessLine(company).description || businessLine(company).code}.`);
  if (enrichment?.employeeCount) reasons.push(`Official employee count ${enrichment.employeeCount} from ${enrichment.employeeCountSourceName || "source attached"}.`);
  if (!enrichment?.employeeCount && enrichment?.organizationScaleProxy) reasons.push(`${enrichment.organizationScaleProxyLabel || "Financial scale proxy"} from ${enrichment.organizationScaleProxySourceName || "PRH XBRL financial statement"}: ${enrichment.organizationScaleProxyAmountLabel || enrichment.organizationScaleProxyEvidence}.`);
  if (enrichment?.decisionMakers?.length) reasons.push(`Decision maker found from ${enrichment.decisionMakers[0].sourceName || "public source"}.`);
  if (growthHiringSignal(signals).level !== "none") reasons.push(`Growth/hiring signal: ${growthHiringSignal(signals).level}.`);
  return reasons;
}

function complianceWarnings(enrichment, outreachReadiness) {
  const warnings = [];
  if (enrichment?.decisionMakers?.length) warnings.push("Decision maker is personal data; B2B legitimate-interest review is required before outreach.");
  if (outreachReadiness !== "Ready") warnings.push("No verified public business contact channel; automated outreach is not allowed.");
  if (!enrichment?.employeeCount && enrichment?.organizationScaleProxy) warnings.push("Employee count missing; financial scale proxy is not a team-size claim.");
  if (!enrichment?.employeeCount && !enrichment?.organizationScaleProxy) warnings.push("Employee count missing; do not claim team size or hiring.");
  return warnings;
}

function scoreBreakdown(company, signals, enrichment, options, safety) {
  const breakdown = signals.slice(0, 8).map((signal) => ({
    component: signal.label || signal.type,
    points: signal.weight || 0,
    sourceName: signal.sourceName || "Source attached",
    sourceUrl: signal.sourceUrl || "",
    evidence: signal.detail || signal.title || ""
  }));

  if (sectorFit(company) > 0) {
    breakdown.push({
      component: "Office-compatible industry",
      points: sectorFit(company),
      sourceName: "PRH Open Data",
      sourceUrl: prhCompanyUrl(businessId(company)),
      evidence: businessLine(company).description || businessLine(company).code
    });
  }
  if (focusFit(company, options.focus) > 0) {
    breakdown.push({
      component: "Focus match",
      points: focusFit(company, options.focus),
      sourceName: "PRH Open Data",
      sourceUrl: prhCompanyUrl(businessId(company)),
      evidence: `Company name or business line matched focus ${options.focus}.`
    });
  }
  const size = companySizeEstimate(enrichment);
  breakdown.push({
    component: size.value === "unknown" ? "Employee count missing" : "Company size estimate",
    points: size.scoreImpact,
    sourceName: size.employeeCountSource,
    sourceUrl: size.sourceUrl || "",
    evidence: size.note
  });
  if (safety.scoreCeiling < 100) {
    breakdown.push({
      component: "Evidence gate",
      points: safety.score - Math.round(signals.reduce((sum, signal) => sum + (signal.weight ?? 0), 0) + sectorFit(company) + focusFit(company, options.focus) + employeeScore(enrichment) + noveltyScore(company)),
      sourceName: "Scoring rules",
      sourceUrl: "",
      evidence: `Score capped at ${safety.scoreCeiling} because outreach readiness is ${safety.outreachReadiness} and growth/hiring signal is ${safety.growthHiringSignal}.`
    });
  }
  return breakdown;
}

function pitch(company, signals, enrichment) {
  const hasNewCompany = signals.some((signal) => signal.type === "new_company");
  const hasWebsite = signals.some((signal) => signal.type === "website_update");
  const hasNotice = signals.some((signal) => signal.type === "registered_notice");
  const hasRisk = signals.some((signal) => signal.type === "risk_signal");
  const hasNameChange = signals.some((signal) => signal.type === "name_change" || signal.type === "new_auxiliary_name");
  const hasListedMarketGrowth = signals.some((signal) => signal.type === "listed_market_sustained_growth" || signal.type === "listed_market_jump");
  const line = businessLine(company).description;
  const lowerLine = line.toLowerCase();
  const contact = contactInstruction(enrichment);

  if (hasRisk) {
    return `Do not treat this as a simple expansion lead. First verify the company situation flag, then decide whether the relevant offer is risk-aware workspace support, short-term meeting space, or no outreach. ${contact}`;
  }
  if (hasNewCompany) {
    if (/holding|financial|investment|fund/i.test(line)) {
      return `${currentName(company)} looks like a newly formed finance/holding entity. Offer a low-commitment meeting and registered-office/workspace discussion for founders, portfolio coordination or local board meetings. ${contact}`;
    }
    if (/software|programming|consult|advertising|research|engineering/i.test(line)) {
      return `${currentName(company)} is a new knowledge-work company. Lead internally with flexible office, meeting rooms, community access and employer services that can support early-stage operations without heavy fixed commitments. ${contact}`;
    }
    return `${currentName(company)} is newly registered in the area. Lead with a practical setup conversation: workspace need, meeting rooms, employee services and whether Novapolis can remove admin friction during the first operating months. ${contact}`;
  }
  if (hasNameChange || hasWebsite) {
    return `${currentName(company)} has a recent brand/name/web change. Use that as the opening: ask whether the public-facing change is connected to growth, reorganisation or a need for better premises and customer meeting space. ${contact}`;
  }
  if (hasListedMarketGrowth) {
    return `${currentName(company)} has sourced listed-market momentum. Do not claim operational expansion from price action alone; use it as a timely reason to ask whether growth, investor attention, customer events or hiring creates a need for workspace, meeting rooms or employee services. ${contact}`;
  }
  if (hasNotice && /rental|real estate|construction|manufacture|transport|retail/i.test(lowerLine)) {
    return `${currentName(company)} has recent official registry activity but is not an obvious office-growth lead. Offer a short qualification call focused on management/admin workspace, meeting rooms, events or employee services rather than a generic lease pitch. ${contact}`;
  }
  return `${currentName(company)} has a recent official change. Ask what changed operationally, then qualify need for flexible space, events, employee services or Novapolis community access${line ? ` in relation to ${lowerLine}` : ""}. ${contact}`;
}

function enrichmentSignals(company, enrichment) {
  if (!enrichment) return [];
  const signals = [];
  if (enrichment.employeeCount || enrichment.organizationScaleProxy || enrichment.decisionMakers?.length || enrichment.emails?.length || enrichment.phones?.length) {
    signals.push(makeSignal(company, {
      type: "enrichment",
      label: "Sourced enrichment available",
      date: "current-enrichment",
      title: `${currentName(company)} has enrichment data`,
      detail: [
        enrichment.employeeCount ? `Employees: ${enrichment.employeeCount} (${enrichment.employeeCountSourceName || "source attached"})` : "",
        !enrichment.employeeCount && enrichment.organizationScaleProxy ? `Scale proxy: ${enrichment.organizationScaleProxyLabel || enrichment.organizationScaleProxy} (${enrichment.organizationScaleProxyAmountLabel || enrichment.organizationScaleProxyMetricLabel || "source attached"})` : "",
        enrichment.decisionMakers?.length ? `Decision makers: ${enrichment.decisionMakers.map(formatPerson).join("; ")}` : "",
        enrichment.emails?.length ? `Emails: ${enrichment.emails.join("; ")}` : "",
        enrichment.verificationEvidence?.length ? `Source verification: ${enrichment.verificationEvidence[0]}` : ""
      ].filter(Boolean).join(" | "),
      sourceName: enrichment.sourceName || "Enrichment",
      sourceUrl: enrichment.sourceUrl || prhCompanyUrl(businessId(company)),
      confidence: enrichment.confidence || "enriched",
      weight: 14,
      idSeed: stableHash([
        enrichment.employeeCount || "",
        enrichment.employeeCountSourceUrl || "",
        enrichment.organizationScaleProxy || "",
        enrichment.organizationScaleProxySourceUrl || "",
        ...(enrichment.decisionMakers || []).map(formatPerson),
        ...(enrichment.emails || []),
        ...(enrichment.phones || [])
      ])
    }));
  }
  if (enrichment.investments) {
    signals.push(makeSignal(company, {
      type: "investment_enrichment",
      label: "Investment note",
      date: "current-enrichment",
      title: `${currentName(company)} has investment information`,
      detail: enrichment.investments,
      sourceName: enrichment.sourceName || "Enrichment",
      sourceUrl: enrichment.sourceUrl || prhCompanyUrl(businessId(company)),
      confidence: "enriched",
      weight: 24,
      idSeed: stableHash([enrichment.investments])
    }));
  }
  return signals;
}

export function buildLead(company, options = {}) {
  const enrichment = options.enrichment ?? {};
  const signals = [
    ...officialSignals(company, options.range),
    ...noticeSignals(company, options.range),
    ...enrichmentSignals(company, enrichment),
    ...(options.marketSignals ?? [])
  ];
  const signalScore = signals.reduce((sum, signal) => sum + (signal.weight ?? 0), 0);
  const rawScore = Math.max(0, Math.round(signalScore + sectorFit(company) + focusFit(company, options.focus) + employeeScore(enrichment) + noveltyScore(company)));
  const sortedSignals = signals.sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));
  const safety = applyLeadScoringSafety(rawScore, sortedSignals, enrichment);
  const internalPitch = pitch(company, sortedSignals, enrichment);
  const actions = recommendedActions(enrichment, safety.outreachReadiness);

  return {
    company: {
      businessId: businessId(company),
      name: currentName(company),
      registrationDate: company.registrationDate,
      lastModified: company.lastModified,
      website: enrichment.companyWebsite || company.website?.url || "",
      address: address(company),
      businessLine: businessLine(company)
    },
    enrichment,
    facts: [],
    signals: sortedSignals,
    inferences: selectedBecause(company, sortedSignals, enrichment).map((reason) => ({
      label: reason,
      basedOn: "Sourced company record, Virre extract, enrichment or market signal."
    })),
    assumptions: [],
    missingEvidence: missingEvidence(sortedSignals, enrichment),
    scoreBreakdown: scoreBreakdown(company, sortedSignals, enrichment, options, safety),
    score: safety.score,
    rawScore,
    scoreCeiling: safety.scoreCeiling,
    priority: safety.priority,
    dataConfidence: safety.dataConfidence,
    outreachReadiness: safety.outreachReadiness,
    companySizeEstimate: companySizeEstimate(enrichment),
    employeeSegment: safety.employeeSegment,
    targetFit: safety.employeeSegment.targetFit,
    enterprisePenalty: safety.employeeSegment.enterprisePenalty,
    growthHiringSignal: safety.growthHiringSignal,
    growthHiringEvidence: safety.growthHiringEvidence,
    selectedBecause: selectedBecause(company, sortedSignals, enrichment),
    complianceWarnings: complianceWarnings(enrichment, safety.outreachReadiness),
    novapolisAngles: novapolisAngles(company, sortedSignals, enrichment),
    tailoredPitchAngle: internalPitch,
    customerFacingPitch: safety.outreachReadiness === "Ready" ? internalPitch : null,
    pitch: internalPitch,
    recommendedActions: actions,
    recommendedAction: actions.join(" ")
  };
}
