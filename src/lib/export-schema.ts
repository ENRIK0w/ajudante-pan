import type { AnalyzedPan } from "./analyze";

export type ColumnKind = "text" | "currency" | "percent" | "separator" | "status";

export interface ExportColumn {
  index: number;
  header: string;   // may contain \r\n line breaks (preserved in xlsx)
  fill: string;     // 6-char rgb hex; "" for separators
  kind: ColumnKind;
  width: number;    // wch
}

// 22 columns A–V. Order, labels, fills and widths preserved from the original
// inline export in page.tsx — do not change without updating the model file.
export const EXPORT_COLUMNS: ExportColumn[] = [
  { index: 0,  header: "Categoria",                     fill: "0E2841", kind: "text",      width: 13.5  },
  { index: 1,  header: "PAN",                           fill: "0E2841", kind: "text",      width: 9.21  },
  { index: 2,  header: "Nome",                          fill: "0E2841", kind: "text",      width: 94.79 },
  { index: 3,  header: "Total PAN p/ 2026",             fill: "0E2841", kind: "currency",  width: 17.79 },
  { index: 4,  header: "Total PAN p/\r\n2027-2030",     fill: "0E2841", kind: "currency",  width: 17.21 },
  { index: 5,  header: "Total geral PAN",               fill: "0E2841", kind: "currency",  width: 19.79 },
  { index: 6,  header: "",                              fill: "",       kind: "separator", width: 1.21  },
  { index: 7,  header: "BAR/BRR",                       fill: "0E2841", kind: "text",      width: 13.79 },
  { index: 8,  header: "Linha Orçamento",               fill: "0E2841", kind: "text",      width: 34.21 },
  { index: 9,  header: "Orç p/2026",                    fill: "00B0F0", kind: "currency",  width: 16.64 },
  { index: 10, header: "Orç p/2027-2030",               fill: "00B0F0", kind: "currency",  width: 18.64 },
  { index: 11, header: "TOTAL Geral orç.\r\n2026-2030", fill: "00B0F0", kind: "currency",  width: 15.79 },
  { index: 12, header: "",                              fill: "",       kind: "separator", width: 1.21  },
  { index: 13, header: "∆ PAN vs Orçado\r\n2026",       fill: "00B050", kind: "currency",  width: 14.64 },
  { index: 14, header: "∆ PAN vs Orçado\r\n2027-2030",  fill: "00B050", kind: "currency",  width: 17.79 },
  { index: 15, header: "TOTAL Geral\r\n2026-2030",      fill: "00B050", kind: "currency",  width: 17.79 },
  { index: 16, header: "",                              fill: "",       kind: "separator", width: 1.21  },
  { index: 17, header: "% Variação PAN\r\n2026",        fill: "FFC000", kind: "percent",   width: 17.79 },
  { index: 18, header: "% Variação PAN\r\n2027-2030",   fill: "FFC000", kind: "percent",   width: 17.79 },
  { index: 19, header: "% Variação Geral PAN",          fill: "FFC000", kind: "percent",   width: 14.64 },
  { index: 20, header: "Status",                        fill: "0E2841", kind: "status",    width: 11.21 },
  { index: 21, header: "",                              fill: "0E2841", kind: "text",      width: 90.21 },
];

export const SEPARATOR_COLS = new Set(EXPORT_COLUMNS.filter((c) => c.kind === "separator").map((c) => c.index));
export const CURRENCY_COLS  = new Set(EXPORT_COLUMNS.filter((c) => c.kind === "currency").map((c) => c.index));
export const PERCENT_COLS   = new Set(EXPORT_COLUMNS.filter((c) => c.kind === "percent").map((c) => c.index));
export const STATUS_COL = 20;

// Sanity guard: STATUS_COL must point at the status column.
if (EXPORT_COLUMNS[STATUS_COL]?.kind !== "status") {
  throw new Error("export-schema: STATUS_COL index is out of sync with EXPORT_COLUMNS");
}

// Thin gridline on all four sides. Fresh objects per call so xlsx-js-style
// cannot mutate a shared reference across cells. Every header/data/status cell
// gets this by default, giving the exported sheet a full "all borders" grid.
export function allBorders(): object {
  const side = () => ({ style: "thin", color: { rgb: "808080" } });
  return { top: side(), bottom: side(), left: side(), right: side() };
}

// xlsx-js-style header style. A fresh object per call so xlsx's _addFill cannot
// mutate a shared reference and corrupt sibling cells.
export function xlsxHeaderStyle(fill: string): object {
  if (!fill) return {};
  return {
    fill: { patternType: "solid", fgColor: { rgb: fill } },
    font: { color: { rgb: "FFFFFF" }, bold: true, sz: 11, name: "Calibri" },
    alignment: { horizontal: "center", vertical: "center", wrapText: true },
    border: allBorders(),
  };
}

// Default data-cell xlsx style (number format only). Fresh object per call.
export function xlsxDataStyle(col: ExportColumn): object {
  // Fresh alignment object per call — default all data cells to centered.
  const alignment = { horizontal: "center", vertical: "center" };
  const border = allBorders();
  if (col.kind === "currency") return { numFmt: "#,##0", alignment, border };
  if (col.kind === "percent")  return { numFmt: "0%", alignment, border };
  return { alignment, border };
}

export function statusFill(a: AnalyzedPan): string {
  const finalStatus = a.manualStatus ?? a.status;
  return (finalStatus === "ok" || finalStatus === "aprovado") ? "92D050"
    : finalStatus === "warn"   ? "FFFF00"
    : finalStatus === "negado" ? "FF6B6B"
    : "D3D3D3";
}

// One data row of 22 cells. Index 20 is null (status drawn via fill); index 21
// is observation text. Logic moved verbatim from the original exportToExcel loop.
export function buildRow(a: AnalyzedPan): (string | number | null)[] {
  const categoria = a.pan.isTurnKey ? "BRR" : (a.rows[0]?.empresaCode?.startsWith("D") ? "BRR" : "Outros");
  const panNumber = a.pan.panNumber ?? "—";
  const nome = a.pan.titulo ?? a.pan.fileName;
  const pan2026 = a.pan.fluxoCaixa.find((f) => f.ano === 2026)?.valor ?? 0;
  const pan2027_2030 = a.pan.fluxoCaixa.filter((f) => f.ano >= 2027 && f.ano <= 2030).reduce((s, f) => s + f.valor, 0);
  const panTotal = pan2026 + pan2027_2030;
  const capex = (a.pan.percentualCapex ?? 100) / 100;
  const panCapex2026 = pan2026 * capex;
  const panCapex2027_2030 = pan2027_2030 * capex;
  const panCapexTotal = panTotal * capex;
  const barBrr = a.pan.isTurnKey ? "PESE" : (a.rows[0]?.empresaCode ?? "—");
  const linhaOrc = a.pan.isTurnKey && a.pese?.peseCodeResolved ? a.pese.peseCodeResolved : (a.tpResolved ?? "—");
  let orc2026 = 0, orc2027_2030 = 0;
  if (a.pan.isTurnKey && a.pese) {
    orc2026 = a.pese.peseByYear.find((y) => y.year === "2026")?.available ?? 0;
    orc2027_2030 = a.pese.peseByYear.filter((y) => +y.year >= 2027 && +y.year <= 2030).reduce((s, y) => s + y.available, 0);
  } else {
    orc2026 = a.yearTotals.find((y) => y.year === "2026")?.available ?? 0;
    orc2027_2030 = a.yearTotals.filter((y) => +y.year >= 2027 && +y.year <= 2030).reduce((s, y) => s + y.available, 0);
  }
  const orcTotal = orc2026 + orc2027_2030;
  const delta2026      = panCapex2026      - orc2026;
  const delta2027_2030 = panCapex2027_2030 - orc2027_2030;
  const deltaTotal     = panCapexTotal     - orcTotal;
  const pct2026      = orc2026      > 0 ? delta2026      / orc2026      : 0;
  const pct2027_2030 = orc2027_2030 > 0 ? delta2027_2030 / orc2027_2030 : 0;
  const pctTotal     = orcTotal     > 0 ? deltaTotal     / orcTotal     : 0;
  const obsText = a.status === "ok" ? "Ok" : a.status === "warn" ? "Atenção" : "Revisar";

  return [
    categoria, panNumber, nome,
    panCapex2026, panCapex2027_2030, panCapexTotal, null,
    barBrr, linhaOrc, orc2026, orc2027_2030, orcTotal, null,
    delta2026, delta2027_2030, deltaTotal, null,
    pct2026, pct2027_2030, pctTotal,
    null, obsText,
  ];
}
