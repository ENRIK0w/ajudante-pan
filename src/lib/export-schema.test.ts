import { describe, it, expect } from "vitest";
import {
  EXPORT_COLUMNS, CURRENCY_COLS, PERCENT_COLS, SEPARATOR_COLS, STATUS_COL,
  buildRow, statusFill,
} from "./export-schema";
import type { AnalyzedPan } from "./analyze";

function sample(over: Partial<AnalyzedPan> = {}): AnalyzedPan {
  return {
    pan: {
      fileName: "a.pdf", panNumber: "1001", titulo: "Obra X",
      isTurnKey: false, percentualCapex: 100,
      fluxoCaixa: [{ ano: 2026, valor: 1000 }, { ano: 2027, valor: 500 }],
    },
    tpResolved: "29C",
    years: ["2026", "2027"],
    rows: [{ empresaCode: "D123" }],
    totalRequested: 0, totalAvailable: 0,
    yearTotals: [
      { year: "2026", requested: 0, available: 800, diff: 0, ok: true },
      { year: "2027", requested: 0, available: 400, diff: 0, ok: true },
    ],
    status: "ok",
    ...over,
  } as unknown as AnalyzedPan;
}

describe("export-schema", () => {
  it("defines exactly 22 columns", () => {
    expect(EXPORT_COLUMNS).toHaveLength(22);
  });
  it("classifies column kinds", () => {
    expect(CURRENCY_COLS.has(3)).toBe(true);
    expect(PERCENT_COLS.has(17)).toBe(true);
    expect(SEPARATOR_COLS.has(6)).toBe(true);
    expect(STATUS_COL).toBe(20);
  });
  it("buildRow returns 22 values with computed fields", () => {
    const row = buildRow(sample());
    expect(row).toHaveLength(22);
    expect(row[0]).toBe("BRR");       // empresaCode starts with "D"
    expect(row[1]).toBe("1001");      // panNumber
    expect(row[3]).toBe(1000);        // panCapex2026 = 1000 * 100%
    expect(row[9]).toBe(800);         // orc2026 from yearTotals
    expect(row[20]).toBeNull();       // status drawn via fill
    expect(row[21]).toBe("Ok");       // observation text
  });
  it("statusFill maps status to rgb", () => {
    expect(statusFill(sample({ status: "ok" }))).toBe("92D050");
    expect(statusFill(sample({ status: "warn" }))).toBe("FFFF00");
    expect(statusFill(sample({ manualStatus: "negado" }))).toBe("FF6B6B");
    expect(statusFill(sample({ status: "unknown" }))).toBe("D3D3D3");
  });
});
