import { describe, it, expect } from "vitest";
import { analyzePans, type AnalyzeContext } from "./analyze";
import type { PanData } from "./pan-parser";
import type { BudgetDb, CnpjEntry, PeseDb } from "./budget-parser";

const db: BudgetDb = {
  rows: [{ ciclo: "2026", empresa: "COELBA", tp: "29", years: { "2026": 1000 }, total: 1000 }],
  empresas: ["COELBA"],
  tps: ["29"],
  years: ["2026"],
};
const cnpj: CnpjEntry[] = [];

const ctx: AnalyzeContext = {
  db,
  cnpj,
  peseDb: null,
  tiDb: null,
  overrides: {},
  statusOverrides: {},
};

const basePan = (over: Partial<PanData>): PanData => ({
  fileName: "x.pdf",
  rateio: [],
  fluxoCaixa: [],
  rawText: "",
  ...over,
});

describe("analyzePans", () => {
  it("ok when request fits budget", () => {
    const pan = basePan({
      tp: "29",
      percentualCapex: 100,
      rateio: [{ empresa: "COELBA", valor: 500 }],
      fluxoCaixa: [{ ano: 2026, valor: 500 }],
    });
    const [r] = analyzePans([pan], ctx);
    expect(r.status).toBe("ok");
    expect(r.rows[0].empresaCode).toBe("COELBA");
  });

  it("unknown when empresa cannot be matched", () => {
    const pan = basePan({
      tp: "29",
      percentualCapex: 100,
      rateio: [{ empresa: "Empresa Inexistente XYZ", valor: 500 }],
      fluxoCaixa: [{ ano: 2026, valor: 500 }],
    });
    const [r] = analyzePans([pan], ctx);
    expect(r.status).toBe("unknown");
    expect(r.rows[0].empresaCode).toBeNull();
  });

  it("warn when request exceeds available in a year", () => {
    const pan = basePan({
      tp: "29",
      percentualCapex: 100,
      rateio: [{ empresa: "COELBA", valor: 5000 }],
      fluxoCaixa: [{ ano: 2026, valor: 5000 }],
    });
    const [r] = analyzePans([pan], ctx);
    expect(r.status).toBe("warn");
  });

  it("turn-key PAN resolves PESE and applies the tax multiplier", () => {
    const peseDb: PeseDb = {
      rows: [{ empresa: "COELBA", tp: "TK", peseCode: "PMT_X", years: { "2026": 1000 }, total: 1000 }],
      empresas: ["COELBA"],
      tps: ["TK"],
      peseCodes: ["PMT_X"],
      years: ["2026"],
    };
    const pan = basePan({
      isTurnKey: true,
      peseCode: "PMT_X",
      percentualCapex: 100,
      fluxoCaixa: [{ ano: 2026, valor: 500 }],
    });
    const [r] = analyzePans([pan], { ...ctx, peseDb });
    expect(r.pese?.peseCodeResolved).toBe("PMT_X");
    // 1000 * 1.219512 ≈ 1219.512
    expect(r.totalAvailable).toBeCloseTo(1219.512, 2);
    expect(r.status).toBe("ok");
  });

  it("respects an empresa override", () => {
    const pan = basePan({
      tp: "29",
      percentualCapex: 100,
      rateio: [{ empresa: "Empresa Inexistente XYZ", valor: 500 }],
      fluxoCaixa: [{ ano: 2026, valor: 500 }],
    });
    const [r] = analyzePans([pan], {
      ...ctx,
      overrides: { "x.pdf": { empresas: { "Empresa Inexistente XYZ": "COELBA" } } },
    });
    expect(r.rows[0].empresaCode).toBe("COELBA");
    expect(r.status).toBe("ok");
  });
});
