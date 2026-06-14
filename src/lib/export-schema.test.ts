import { describe, it, expect } from "vitest";
import {
  EXPORT_COLUMNS, CURRENCY_COLS, PERCENT_COLS, SEPARATOR_COLS, STATUS_COL,
  buildRow, statusFill, xlsxDataStyle, allBorders,
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
  it("buildRow uses the PESE/Turn-Key branch", () => {
    const tk = {
      pan: {
        fileName: "tk.pdf", panNumber: "2002", titulo: "Obra TK",
        isTurnKey: true, percentualCapex: 100,
        fluxoCaixa: [{ ano: 2026, valor: 2000 }],
      },
      tpResolved: "29C",
      years: ["2026"],
      rows: [],
      totalRequested: 0, totalAvailable: 0,
      yearTotals: [],
      status: "ok",
      pese: {
        peseCodeResolved: "PMT_123",
        peseByYear: [{ year: "2026", requested: 0, available: 1500, diff: 0, ok: true }],
      },
    } as unknown as import("./analyze").AnalyzedPan;
    const row = buildRow(tk);
    expect(row[0]).toBe("TK");        // categoria
    expect(row[7]).toBe("PESE");      // BAR/BRR column
    expect(row[8]).toBe("PMT_123");   // Linha Orçamento = resolved PESE code
    expect(row[9]).toBe(1500);        // orc2026 from pese.peseByYear
  });
  it("xlsxDataStyle centers every data cell by default and keeps numFmt", () => {
    const centered = { horizontal: "center", vertical: "center" };
    const side = { style: "thin", color: { rgb: "808080" } };
    const border = { top: side, bottom: side, left: side, right: side };
    const currency = EXPORT_COLUMNS.find((c) => c.kind === "currency")!;
    const percent = EXPORT_COLUMNS.find((c) => c.kind === "percent")!;
    const text = EXPORT_COLUMNS.find((c) => c.kind === "text")!;
    expect(xlsxDataStyle(currency)).toEqual({ numFmt: "#,##0", alignment: centered, border });
    expect(xlsxDataStyle(percent)).toEqual({ numFmt: "0%", alignment: centered, border });
    expect(xlsxDataStyle(text)).toEqual({ alignment: centered, border });
  });

  it("allBorders returns a thin gridline on all four sides", () => {
    const side = { style: "thin", color: { rgb: "808080" } };
    expect(allBorders()).toEqual({ top: side, bottom: side, left: side, right: side });
  });
});
