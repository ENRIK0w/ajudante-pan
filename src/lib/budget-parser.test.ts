import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import {
  matchEmpresaCode,
  matchTpCode,
  matchPeseCode,
  lookupBudgetByYear,
  lookupPeseByYear,
  mergePeseDbsByYear,
  parsePeseBuffer,
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

describe("parsePeseBuffer", () => {
  it("finds PESE fields by header name when the future base has extra columns", () => {
    const ws = XLSX.utils.aoa_to_sheet([
      [
        "EMPRESA",
        "ENTIDADE",
        "TP",
        "CÓDIGO DA OBRA OU PROJETO",
        "DESCR. OBRA / PROJETO / EQUIPAMENTO",
        "2027 - CM",
        "2028 - CM",
      ],
      ["D001", "DPTR", "28", "PES_X", "Obra X", 100, 200],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Planilha1");
    const buffer = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;

    const db = parsePeseBuffer(buffer);

    expect(db.rows).toEqual([
      {
        empresa: "D001",
        tp: "28",
        peseCode: "PES_X",
        years: { "2027": 100, "2028": 200 },
        total: 300,
      },
    ]);
  });
});

describe("mergePeseDbsByYear", () => {
  it("uses the legacy base through 2026 and the future base from 2027 onward", () => {
    const legacy: PeseDb = {
      rows: [
        {
          empresa: "OLD",
          tp: "12",
          peseCode: "PMT_X",
          years: { "2026": 100, "2027": 999 },
          total: 1099,
        },
      ],
      empresas: ["OLD"],
      tps: ["12"],
      peseCodes: ["PMT_X"],
      years: ["2026", "2027"],
    };
    const future: PeseDb = {
      rows: [
        {
          empresa: "NEW",
          tp: "28",
          peseCode: "PMT_X",
          years: { "2026": 888, "2027": 200, "2031": 300 },
          total: 1388,
        },
      ],
      empresas: ["NEW"],
      tps: ["28"],
      peseCodes: ["PMT_X"],
      years: ["2026", "2027", "2031"],
    };

    const merged = mergePeseDbsByYear(legacy, future);

    expect(merged.rows[0]).toEqual({
      empresa: "NEW",
      tp: "28",
      peseCode: "PMT_X",
      years: { "2026": 100, "2027": 200, "2031": 300 },
      total: 600,
    });
    expect(merged.years).toEqual(["2026", "2027", "2031"]);
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
