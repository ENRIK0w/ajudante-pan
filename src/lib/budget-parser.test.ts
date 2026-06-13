import { describe, it, expect } from "vitest";
import {
  matchEmpresaCode,
  matchTpCode,
  matchPeseCode,
  lookupBudgetByYear,
  lookupPeseByYear,
  type BudgetDb,
  type CnpjEntry,
  type PeseDb,
} from "./budget-parser";

const cnpj: CnpjEntry[] = [
  {
    code: "COELBA",
    name: "Companhia de Eletricidade do Estado da Bahia",
    normalized: "companhia de eletricidade do estado da bahia",
  },
  { code: "CPFL", name: "CPFL Energia S/A", normalized: "cpfl energia s/a" },
];

const db: BudgetDb = {
  rows: [
    { ciclo: "2026", empresa: "COELBA", tp: "29", years: { "2026": 1000, "2027": 500 }, total: 1500 },
    { ciclo: "2026", empresa: "COELBA", tp: "0R", years: { "2026": 200 }, total: 200 },
  ],
  empresas: ["COELBA"],
  tps: ["29", "0R"],
  years: ["2026", "2027"],
};

describe("matchEmpresaCode", () => {
  it("direct DB empresa hit", () => {
    expect(matchEmpresaCode("COELBA", cnpj, db)).toBe("COELBA");
  });
  it("returns null when nothing matches", () => {
    expect(matchEmpresaCode("Zzz Unknown Co", cnpj, db)).toBeNull();
  });
});

describe("matchTpCode", () => {
  it("matches '29C - Reforma' to digit-prefix code 29", () => {
    expect(matchTpCode("29C - Reforma de Rede", db)).toBe("29");
  });
  it("matches exact code", () => {
    expect(matchTpCode("0R", db)).toBe("0R");
  });
});

describe("lookupBudgetByYear", () => {
  it("sums per-year for empresa+tp", () => {
    expect(lookupBudgetByYear(db, "COELBA", "29")).toEqual({ "2026": 1000, "2027": 500 });
  });
});

describe("lookupPeseByYear", () => {
  it("applies the 1.219512 tax multiplier", () => {
    const peseDb: PeseDb = {
      rows: [{ empresa: "COELBA", tp: "TK", peseCode: "PMT_X", years: { "2026": 100 }, total: 100 }],
      empresas: ["COELBA"],
      tps: ["TK"],
      peseCodes: ["PMT_X"],
      years: ["2026"],
    };
    expect(lookupPeseByYear(peseDb, "PMT_X")["2026"]).toBeCloseTo(121.9512, 4);
  });
});

describe("matchPeseCode", () => {
  const peseDb: PeseDb = {
    rows: [],
    empresas: [],
    tps: [],
    peseCodes: ["PMT_SE0931_EQU"],
    years: [],
  };
  it("exact match case-insensitive", () => {
    expect(matchPeseCode("pmt_se0931_equ", peseDb)).toBe("PMT_SE0931_EQU");
  });
  it("partial contains match", () => {
    expect(matchPeseCode("PMT_SE0931", peseDb)).toBe("PMT_SE0931_EQU");
  });
});
