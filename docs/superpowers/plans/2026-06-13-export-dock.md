# Export Dock + Formattable Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace checkbox export selection with a drag-and-drop bottom dock (ordered) and a WYSIWYG preview modal where the user clicks cells to apply visual formatting before exporting to Excel.

**Architecture:** Extract the export layout out of `page.tsx` into a shared `export-schema.ts` so the preview grid and the `.xlsx` writer share one source of truth. Selection becomes an ordered `tray: string[]`. A `FormatMap` (in-memory, keyed by fileName) holds per-cell style overrides that merge onto schema defaults at both render and export time. `@dnd-kit` powers dock reorder and card-to-dock dragging.

**Tech Stack:** Next.js 16, React 19, TypeScript, `xlsx-js-style`, `@dnd-kit/core` + `@dnd-kit/sortable`, Tailwind v4, shadcn/ui, Vitest.

**Reference spec:** `docs/superpowers/specs/2026-06-13-export-dock-design.md`

**Conventions in this repo:**
- Run tests with `npm test` (Vitest, `vitest run`). Single file: `npx vitest run src/lib/export-tray.test.ts`.
- Path alias `@/` → `src/`.
- Pure logic lives in `src/lib/*.ts` with co-located `*.test.ts`.
- `page.tsx` is a single large `"use client"` component; new UI components may live in `src/components/export/`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/export-schema.ts` (new) | Single source of truth for the 22 export columns: headers, fills, kinds, widths; `buildRow(a)`, `statusFill(a)`, xlsx style helpers. |
| `src/lib/export-schema.test.ts` (new) | Unit tests for schema + `buildRow`/`statusFill`. |
| `src/lib/export-tray.ts` (new) | Ordered selection helpers over `string[]` of fileNames. |
| `src/lib/export-tray.test.ts` (new) | Unit tests for tray helpers. |
| `src/lib/cell-format.ts` (new) | `CellStyle`, `FormatMap`, cell keys, `applyStyle`, `rangeKeys`, `columnKeys`, `mergeStyle`. |
| `src/lib/cell-format.test.ts` (new) | Unit tests for formatting model. |
| `src/components/export/export-dock.tsx` (new) | Bottom sticky dock: sortable chips, bulk actions, "Pré-visualizar". |
| `src/components/export/export-preview.tsx` (new) | Modal: WYSIWYG grid + cell selection + export. |
| `src/components/export/format-toolbar.tsx` (new) | Bold/italic/fill/text-color/size/align controls. |
| `src/components/export/use-cell-selection.ts` (new) | Selection state hook for the preview grid. |
| `src/app/page.tsx` (modify) | Replace `selected: Set` with `tray: string[]`; wire dock + preview; refactor `exportToExcel`; make `PanCard` a drag source. |

---

# PHASE 1 — Dock + ordering + schema extraction

Ship-able on its own: drag PANs into a bottom dock, reorder, export in that order with the existing default styling. Checkboxes removed.

## Task 1: Install @dnd-kit

**Files:** `package.json` (modify, via installer)

- [ ] **Step 1: Install the dependency**

Run: `npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities`
Expected: packages added to `package.json` dependencies, install completes without error. (`@dnd-kit/sortable` depends on `@dnd-kit/core`; installing all three is explicit and safe.)

- [ ] **Step 2: Verify the build still compiles**

Run: `npx tsc --noEmit`
Expected: no new errors (pre-existing state unchanged).

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add @dnd-kit for export dock drag-and-drop"
```

---

## Task 2: Export schema module

**Files:**
- Create: `src/lib/export-schema.ts`
- Test: `src/lib/export-schema.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/export-schema.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/export-schema.test.ts`
Expected: FAIL — cannot find module `./export-schema`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/export-schema.ts
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

// xlsx-js-style header style. A fresh object per call so xlsx's _addFill cannot
// mutate a shared reference and corrupt sibling cells.
export function xlsxHeaderStyle(fill: string): object {
  if (!fill) return {};
  return {
    fill: { patternType: "solid", fgColor: { rgb: fill } },
    font: { color: { rgb: "FFFFFF" }, bold: true, sz: 11, name: "Calibri" },
    alignment: { horizontal: "center", vertical: "center", wrapText: true },
  };
}

// Default data-cell xlsx style (number format only). Fresh object per call.
export function xlsxDataStyle(col: ExportColumn): object {
  if (col.kind === "currency") return { numFmt: "#,##0" };
  if (col.kind === "percent")  return { numFmt: "0%" };
  return {};
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
  const categoria = a.pan.isTurnKey ? "TK" : (a.rows[0]?.empresaCode?.startsWith("D") ? "BRR" : "Outros");
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/export-schema.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/export-schema.ts src/lib/export-schema.test.ts
git commit -m "feat: extract export column schema and row builder"
```

---

## Task 3: Export tray helpers

**Files:**
- Create: `src/lib/export-tray.ts`
- Test: `src/lib/export-tray.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/export-tray.test.ts
import { describe, it, expect } from "vitest";
import {
  addToTray, removeFromTray, reorderTray, pruneTray,
  orderedApproved, allFileNames,
} from "./export-tray";
import type { AnalyzedPan } from "./analyze";

const pan = (fileName: string, status: AnalyzedPan["status"], manual?: AnalyzedPan["manualStatus"]) =>
  ({ pan: { fileName }, status, manualStatus: manual } as unknown as AnalyzedPan);

describe("export-tray", () => {
  it("addToTray appends and dedupes", () => {
    expect(addToTray(["a"], "b")).toEqual(["a", "b"]);
    expect(addToTray(["a", "b"], "a")).toEqual(["a", "b"]);
  });
  it("removeFromTray drops one, keeps order", () => {
    expect(removeFromTray(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });
  it("reorderTray moves an item", () => {
    expect(reorderTray(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(reorderTray(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
  });
  it("pruneTray keeps only valid fileNames in order", () => {
    expect(pruneTray(["a", "b", "c"], new Set(["a", "c"]))).toEqual(["a", "c"]);
  });
  it("orderedApproved returns approved fileNames in analyzed order", () => {
    const analyzed = [pan("a", "ok"), pan("b", "warn"), pan("c", "warn", "aprovado")];
    expect(orderedApproved(analyzed)).toEqual(["a", "c"]);
  });
  it("allFileNames returns every fileName in order", () => {
    expect(allFileNames([pan("a", "ok"), pan("b", "warn")])).toEqual(["a", "b"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/export-tray.test.ts`
Expected: FAIL — cannot find module `./export-tray`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/export-tray.ts
import type { AnalyzedPan } from "./analyze";

export function addToTray(tray: string[], fileName: string): string[] {
  return tray.includes(fileName) ? tray : [...tray, fileName];
}

export function removeFromTray(tray: string[], fileName: string): string[] {
  return tray.filter((f) => f !== fileName);
}

export function reorderTray(tray: string[], from: number, to: number): string[] {
  const next = [...tray];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export function pruneTray(tray: string[], valid: Set<string>): string[] {
  return tray.filter((f) => valid.has(f));
}

function isApproved(a: AnalyzedPan): boolean {
  const s = a.manualStatus ?? a.status;
  return s === "ok" || s === "aprovado";
}

export function orderedApproved(analyzed: AnalyzedPan[]): string[] {
  return analyzed.filter(isApproved).map((a) => a.pan.fileName);
}

export function allFileNames(analyzed: AnalyzedPan[]): string[] {
  return analyzed.map((a) => a.pan.fileName);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/export-tray.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/export-tray.ts src/lib/export-tray.test.ts
git commit -m "feat: add ordered export-tray helpers"
```

---

## Task 4: Refactor exportToExcel to use schema + ordered list

This rewrites the body of `exportToExcel` (currently `page.tsx:160-336`) to consume `export-schema` and accept an explicit ordered list of `AnalyzedPan`. Phase 1 keeps default styling only (no FormatMap yet).

**Files:**
- Modify: `src/app/page.tsx:160-336`

- [ ] **Step 1: Add imports near the other lib imports (after the `analyze` import block, ~line 52)**

```ts
import {
  EXPORT_COLUMNS, SEPARATOR_COLS, CURRENCY_COLS, PERCENT_COLS, STATUS_COL,
  xlsxHeaderStyle, xlsxDataStyle, statusFill, buildRow,
} from "@/lib/export-schema";
```

- [ ] **Step 2: Replace the entire `exportToExcel` function (from `const exportToExcel = async () => {` through its closing `};`) with this schema-driven version**

```ts
  const exportToExcel = async (ordered: AnalyzedPan[]) => {
    if (ordered.length === 0) return;
    setExporting(true);
    try {
      const wb = XLSX.utils.book_new();
      const ws: XLSX.WorkSheet = {};

      // Header row
      EXPORT_COLUMNS.forEach((col) => {
        const ref = XLSX.utils.encode_cell({ r: 0, c: col.index });
        ws[ref] = { v: col.header, t: col.header === "" ? "z" : "s", s: xlsxHeaderStyle(col.fill) };
      });

      // Data rows
      ordered.forEach((a, rowIdx) => {
        const values = buildRow(a);
        EXPORT_COLUMNS.forEach((col) => {
          const c = col.index;
          const val = values[c];
          const ref = XLSX.utils.encode_cell({ r: rowIdx + 1, c });

          if (SEPARATOR_COLS.has(c)) {
            ws[ref] = { v: "", t: "z", s: {} };
          } else if (c === STATUS_COL) {
            ws[ref] = { v: "", t: "s", s: { fill: { patternType: "solid", fgColor: { rgb: statusFill(a) } } } };
          } else if (CURRENCY_COLS.has(c) || PERCENT_COLS.has(c)) {
            ws[ref] = { v: (val ?? 0) as number, t: "n", s: xlsxDataStyle(col) };
          } else if (typeof val === "number") {
            ws[ref] = { v: val, t: "n", s: {} };
          } else {
            ws[ref] = { v: (val ?? "") as string, t: "s", s: {} };
          }
        });
      });

      ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: ordered.length, c: EXPORT_COLUMNS.length - 1 } });
      ws["!cols"] = EXPORT_COLUMNS.map((col) => ({ wch: col.width }));
      ws["!rows"] = [{ hpt: 29.1 }, ...ordered.map(() => ({ hpt: 29.25 }))];

      const today = new Date();
      const sheetName = `${today.getDate().toString().padStart(2, "0")}.${(today.getMonth() + 1).toString().padStart(2, "0")}`;
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
      XLSX.writeFile(wb, `Resumo_PAN_${today.getFullYear()}_${sheetName.replace(".", "-")}.xlsx`);
    } catch (e) {
      setError("Erro ao exportar: " + (e as Error).message);
    } finally {
      setExporting(false);
    }
  };
```

> Note: `exportToExcel` now takes the ordered list as an argument instead of reading `selected`. Task 5 supplies it from the tray. This deletes the old inline `headers`/`hBase`/`dataRows`/widths block.

- [ ] **Step 3: Verify type-check passes (the old `selected`-based call site is updated in Task 5; expect a temporary error there only)**

Run: `npx tsc --noEmit`
Expected: the ONLY errors are at the old `onClick={exportToExcel}` call site referencing the new signature and the removed `selected` usages — those are fixed in Task 5. No errors inside the new `exportToExcel` body.

- [ ] **Step 4: Commit**

```bash
git add src/app/page.tsx
git commit -m "refactor: drive exportToExcel from shared export-schema"
```

---

## Task 5: Replace `selected` state with ordered `tray`

**Files:**
- Modify: `src/app/page.tsx` (state at ~80, handlers at ~145-158, render call sites)

- [ ] **Step 1: Replace the selection state declaration (`page.tsx:80`)**

```ts
  const [tray, setTray] = useState<string[]>([]);
```

(Remove the `const [selected, setSelected] = useState<Set<string>>(new Set());` line.)

- [ ] **Step 2: Add a tray-prune effect right after the `analyzed` useMemo (~line 127)**

```ts
  useEffect(() => {
    const valid = new Set(analyzed.map((a) => a.pan.fileName));
    setTray((prev) => {
      const next = prev.filter((f) => valid.has(f));
      return next.length === prev.length ? prev : next;
    });
  }, [analyzed]);
```

- [ ] **Step 3: Replace the selection handlers (`page.tsx:145-158`, the `toggleSelect`/`selectAllOk`/`clearSelection` block)**

```ts
  const toggleTray = (k: string) =>
    setTray((prev) => (prev.includes(k) ? prev.filter((f) => f !== k) : [...prev, k]));

  const addAllApproved = () =>
    setTray((prev) => {
      const approved = orderedApproved(analyzed);
      const merged = [...prev];
      for (const f of approved) if (!merged.includes(f)) merged.push(f);
      return merged;
    });

  const addAll = () =>
    setTray((prev) => {
      const merged = [...prev];
      for (const f of allFileNames(analyzed)) if (!merged.includes(f)) merged.push(f);
      return merged;
    });

  const clearTrayState = () => setTray([]);

  const orderedSelection = analyzed
    .filter((a) => tray.includes(a.pan.fileName))
    .sort((x, y) => tray.indexOf(x.pan.fileName) - tray.indexOf(y.pan.fileName));
```

- [ ] **Step 4: Add the tray helper imports (after the `export-schema` import added in Task 4)**

```ts
import { orderedApproved, allFileNames, reorderTray } from "@/lib/export-tray";
```

- [ ] **Step 5: Update the `PanCard` call site (`page.tsx:464-470`)**

Replace `isSelected={selected.has(a.pan.fileName)}` with `inTray={tray.includes(a.pan.fileName)}` and replace `onSelect={() => toggleSelect(a.pan.fileName)}` with `onToggleTray={() => toggleTray(a.pan.fileName)}`.

- [ ] **Step 6: Remove the old top control Card (`page.tsx:419-438`, the whole `{analyzed.length > 0 && ( <Card className="p-4"> … </Card> )}` block)**

Delete it entirely — its actions move into the dock (Task 6).

- [ ] **Step 7: Run type-check**

Run: `npx tsc --noEmit`
Expected: errors now only about `PanCard` not yet accepting `inTray`/`onToggleTray` (fixed in Task 6) and the dock not yet existing. No errors about `selected`.

- [ ] **Step 8: Commit**

```bash
git add src/app/page.tsx
git commit -m "refactor: replace selected Set with ordered tray state"
```

---

## Task 6: ExportDock component + PanCard drag source

**Files:**
- Create: `src/components/export/export-dock.tsx`
- Modify: `src/app/page.tsx` (PanCard signature/markup; DndContext wrapper; render dock)

- [ ] **Step 1: Create the dock component**

```tsx
// src/components/export/export-dock.tsx
"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { X, Download, CheckSquare, Layers, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { AnalyzedPan } from "@/lib/analyze";

function Chip({ a, onRemove }: { a: AnalyzedPan; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: a.pan.fileName });
  const status = a.manualStatus ?? a.status;
  const dot = status === "ok" || status === "aprovado" ? "bg-status-ok"
    : status === "warn" ? "bg-status-warn"
    : status === "negado" ? "bg-destructive" : "bg-muted-foreground";
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
      className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-sm shrink-0"
    >
      <span {...attributes} {...listeners} className="cursor-grab text-muted-foreground select-none">⠿</span>
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      <span className="font-medium">PAN {a.pan.panNumber ?? "?"}</span>
      <button onClick={onRemove} className="ml-1 rounded p-0.5 hover:bg-destructive/10 hover:text-destructive">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function ExportDock({
  ordered, onRemove, onClear, onAddApproved, onAddAll, onPreview, exporting,
}: {
  ordered: AnalyzedPan[];
  onRemove: (fileName: string) => void;
  onClear: () => void;
  onAddApproved: () => void;
  onAddAll: () => void;
  onPreview: () => void;
  exporting: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: "export-dock" });

  return (
    <div
      ref={setNodeRef}
      className={`fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 backdrop-blur-xl px-6 py-3 transition-colors ${isOver ? "bg-primary/10" : ""}`}
    >
      <div className="max-w-6xl mx-auto flex items-center gap-3">
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant="secondary" className="font-normal">{ordered.length} p/ exportar</Badge>
          <Button variant="outline" size="sm" onClick={onAddApproved} className="gap-1.5">
            <CheckSquare className="h-4 w-4" /> Aprovados
          </Button>
          <Button variant="outline" size="sm" onClick={onAddAll} className="gap-1.5">
            <Layers className="h-4 w-4" /> Todas
          </Button>
          <Button variant="outline" size="sm" onClick={onClear} disabled={ordered.length === 0} className="gap-1.5 hover:text-destructive hover:border-destructive">
            <Trash2 className="h-4 w-4" /> Limpar
          </Button>
        </div>

        <div className="flex-1 min-w-0 overflow-x-auto scrollbar-thin">
          {ordered.length === 0 ? (
            <p className="text-sm text-muted-foreground py-1.5">Arraste PANs aqui para exportar</p>
          ) : (
            <SortableContext items={ordered.map((a) => a.pan.fileName)} strategy={horizontalListSortingStrategy}>
              <div className="flex items-center gap-2">
                {ordered.map((a) => (
                  <Chip key={a.pan.fileName} a={a} onRemove={() => onRemove(a.pan.fileName)} />
                ))}
              </div>
            </SortableContext>
          )}
        </div>

        <Button onClick={onPreview} disabled={ordered.length === 0 || exporting} className="gap-2 bg-gradient-brand hover:opacity-90 shrink-0">
          <Download className="h-4 w-4" /> Pré-visualizar
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Make `PanCard` a drag source — update its signature (`page.tsx:549-556`)**

Replace `isSelected` / `onSelect` in the destructure and types with `inTray` / `onToggleTray`:

```tsx
function PanCard({ a, db, peseDb, tiDb, expanded, inTray, onToggle, onToggleTray, onRemove, onTpChange, onEmpresaChange, onPeseCodeChange, onStatusChange, onTiProgramaChange }: {
  a: AnalyzedPan; db: BudgetDb; peseDb: PeseDb | null; tiDb: TiDb | null;
  expanded: boolean; inTray: boolean;
  onToggle: () => void; onToggleTray: () => void; onRemove: () => void;
  onTpChange: (tp: string) => void; onEmpresaChange: (panName: string, code: string) => void; onPeseCodeChange: (peseCode: string) => void;
  onStatusChange: (status: "aprovado" | "negado" | "warn" | null) => void;
  onTiProgramaChange: (empresaCode: string, programa: string) => void;
}) {
```

- [ ] **Step 3: Add the draggable handle inside `PanCard` — replace the checkbox button (`page.tsx:570-574`)**

Add this hook call at the top of `PanCard` (just after the destructure, before `const effectiveStatus`):

```tsx
  const drag = useDraggable({ id: a.pan.fileName });
```

Then replace the outer `<Card>` opening tag and the checkbox `<button>` (lines 570-574) with:

```tsx
    <Card className={`overflow-hidden transition-all ${inTray ? "ring-2 ring-primary/50" : ""}`}>
      <div className="flex items-center gap-2 p-5 hover:bg-muted/30 transition-colors">
        <button
          ref={drag.setNodeRef}
          {...drag.listeners}
          {...drag.attributes}
          onClick={(e) => { e.stopPropagation(); onToggleTray(); }}
          className="p-1 rounded hover:bg-muted transition-colors shrink-0 cursor-grab"
          title={inTray ? "Remover do export" : "Adicionar ao export (ou arraste)"}
        >
          {inTray ? <CheckSquare className="h-5 w-5 text-primary" /> : <GripVertical className="h-5 w-5 text-muted-foreground" />}
        </button>
```

- [ ] **Step 4: Update imports in `page.tsx`**

Add to the `lucide-react` import: `GripVertical`. Add a new import line:

```ts
import { DndContext, PointerSensor, useSensor, useSensors, useDraggable, type DragEndEvent } from "@dnd-kit/core";
import { ExportDock } from "@/components/export/export-dock";
```

- [ ] **Step 5: Wrap the page in `DndContext` and render the dock**

In the `Page` component body, add sensors + drag-end handler near the other handlers:

```tsx
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const handleDragEnd = (e: DragEndEvent) => {
    const activeId = String(e.active.id);
    if (e.over?.id === "export-dock") {
      setTray((prev) => (prev.includes(activeId) ? prev : [...prev, activeId]));
      return;
    }
    // reorder within the dock
    const overId = e.over ? String(e.over.id) : null;
    if (overId && overId !== activeId && tray.includes(activeId) && tray.includes(overId)) {
      setTray((prev) => reorderTray(prev, prev.indexOf(activeId), prev.indexOf(overId)));
    }
  };
```

Wrap the returned JSX: change the outermost `<div className="min-h-screen bg-canvas">` so it is the child of `<DndContext sensors={sensors} onDragEnd={handleDragEnd}>…</DndContext>`. Add bottom padding so the fixed dock never covers content — add `pb-28` to the `<main>` className. Render the dock just before `</DndContext>` (after `</main>`/closing wrapper), only when there are results:

```tsx
      {analyzed.length > 0 && (
        <ExportDock
          ordered={orderedSelection}
          onRemove={(f) => setTray((prev) => prev.filter((x) => x !== f))}
          onClear={clearTrayState}
          onAddApproved={addAllApproved}
          onAddAll={addAll}
          onPreview={() => exportToExcel(orderedSelection)}
          exporting={exporting}
        />
      )}
```

> Phase 1: "Pré-visualizar" calls `exportToExcel` directly. Task 11 repoints it to open the modal.

- [ ] **Step 6: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS, no errors.

- [ ] **Step 7: Manual verification in the browser**

Run: `npm run dev`, open the app, upload a sample PAN PDF (or use existing flow). Verify:
- Dragging a PAN card's grip into the bottom dock adds a chip.
- Clicking the grip toggles it in/out of the dock.
- Chips reorder by dragging within the dock.
- "Aprovados" / "Todas" fill the dock; "Limpar" empties it.
- "Pré-visualizar" downloads an `.xlsx`; rows appear in the dock's left-to-right order; styling matches the previous export.

- [ ] **Step 8: Commit**

```bash
git add src/app/page.tsx src/components/export/export-dock.tsx
git commit -m "feat: drag-and-drop export dock with ordered selection"
```

---

# PHASE 2 — Formattable preview

Adds the WYSIWYG modal and per-cell formatting. The dock's "Pré-visualizar" opens the modal instead of exporting directly.

## Task 7: Cell formatting model

**Files:**
- Create: `src/lib/cell-format.ts`
- Test: `src/lib/cell-format.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/cell-format.test.ts
import { describe, it, expect } from "vitest";
import {
  cellKey, HEADER_ROW, applyStyle, rangeKeys, columnKeys, mergeStyle,
  type FormatMap,
} from "./cell-format";

describe("cell-format", () => {
  it("cellKey distinguishes header and data cells", () => {
    expect(cellKey(HEADER_ROW, 3)).toBe("header:3");
    expect(cellKey("a.pdf", 3)).toBe("data:a.pdf:3");
  });
  it("applyStyle merges patches without dropping prior keys", () => {
    let m: FormatMap = {};
    m = applyStyle(m, ["data:a.pdf:3"], { bold: true });
    m = applyStyle(m, ["data:a.pdf:3"], { fill: "FF0000" });
    expect(m["data:a.pdf:3"]).toEqual({ bold: true, fill: "FF0000" });
  });
  it("rangeKeys builds the rectangle of keys", () => {
    expect(rangeKeys(["a.pdf", "b.pdf"], [1, 2])).toEqual([
      "data:a.pdf:1", "data:a.pdf:2", "data:b.pdf:1", "data:b.pdf:2",
    ]);
  });
  it("columnKeys covers header + all data rows", () => {
    expect(columnKeys([HEADER_ROW, "a.pdf", "b.pdf"], 5)).toEqual([
      "header:5", "data:a.pdf:5", "data:b.pdf:5",
    ]);
  });
  it("mergeStyle layers overrides onto base and preserves numFmt", () => {
    const base = { numFmt: "#,##0" };
    const out = mergeStyle(base, { bold: true, fill: "00B050", align: "right", fontSize: 14, color: "FFFFFF", italic: true });
    expect(out).toEqual({
      numFmt: "#,##0",
      font: { bold: true, italic: true, sz: 14, color: { rgb: "FFFFFF" } },
      fill: { patternType: "solid", fgColor: { rgb: "00B050" } },
      alignment: { horizontal: "right" },
    });
  });
  it("mergeStyle returns base unchanged when no override", () => {
    const base = { numFmt: "0%" };
    expect(mergeStyle(base, undefined)).toEqual({ numFmt: "0%" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/cell-format.test.ts`
Expected: FAIL — cannot find module `./cell-format`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/cell-format.ts
export interface CellStyle {
  bold?: boolean;
  italic?: boolean;
  fontSize?: number;
  align?: "left" | "center" | "right";
  color?: string; // text rgb hex, no '#'
  fill?: string;  // background rgb hex, no '#'
}

export type FormatMap = Record<string, CellStyle>;

export const HEADER_ROW = "__header__";

export function cellKey(rowId: string, col: number): string {
  return rowId === HEADER_ROW ? `header:${col}` : `data:${rowId}:${col}`;
}

export function rangeKeys(rowIds: string[], cols: number[]): string[] {
  const keys: string[] = [];
  for (const r of rowIds) for (const c of cols) keys.push(cellKey(r, c));
  return keys;
}

export function columnKeys(allRowIds: string[], col: number): string[] {
  return allRowIds.map((r) => cellKey(r, col));
}

export function applyStyle(map: FormatMap, keys: string[], patch: CellStyle): FormatMap {
  const next: FormatMap = { ...map };
  for (const k of keys) next[k] = { ...(next[k] ?? {}), ...patch };
  return next;
}

// Merge a CellStyle override onto a base xlsx-js-style object. Never touches numFmt.
export function mergeStyle(base: object, ov?: CellStyle): object {
  if (!ov) return base;
  const s: Record<string, unknown> = { ...base };
  if (ov.bold !== undefined || ov.italic !== undefined || ov.fontSize !== undefined || ov.color) {
    const font: Record<string, unknown> = { ...((s.font as object) ?? {}) };
    if (ov.bold !== undefined) font.bold = ov.bold;
    if (ov.italic !== undefined) font.italic = ov.italic;
    if (ov.fontSize !== undefined) font.sz = ov.fontSize;
    if (ov.color) font.color = { rgb: ov.color };
    s.font = font;
  }
  if (ov.fill) s.fill = { patternType: "solid", fgColor: { rgb: ov.fill } };
  if (ov.align) s.alignment = { ...((s.alignment as object) ?? {}), horizontal: ov.align };
  return s;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/cell-format.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/cell-format.ts src/lib/cell-format.test.ts
git commit -m "feat: add cell formatting model for export preview"
```

---

## Task 8: Merge FormatMap into exportToExcel

**Files:**
- Modify: `src/app/page.tsx` (`exportToExcel` from Task 4)

- [ ] **Step 1: Import the formatting helpers (add near the export-schema import)**

```ts
import { mergeStyle, cellKey, HEADER_ROW, type FormatMap } from "@/lib/cell-format";
```

- [ ] **Step 2: Change `exportToExcel` to accept a `FormatMap` and apply it**

Update the signature:

```ts
  const exportToExcel = async (ordered: AnalyzedPan[], formatMap: FormatMap = {}) => {
```

In the header loop, wrap the style with the override:

```ts
      EXPORT_COLUMNS.forEach((col) => {
        const ref = XLSX.utils.encode_cell({ r: 0, c: col.index });
        const base = xlsxHeaderStyle(col.fill);
        const s = mergeStyle(base, formatMap[cellKey(HEADER_ROW, col.index)]);
        ws[ref] = { v: col.header, t: col.header === "" ? "z" : "s", s };
      });
```

In the data loop, compute the override once per cell and feed it into each branch:

```ts
      ordered.forEach((a, rowIdx) => {
        const values = buildRow(a);
        EXPORT_COLUMNS.forEach((col) => {
          const c = col.index;
          const val = values[c];
          const ref = XLSX.utils.encode_cell({ r: rowIdx + 1, c });
          const ov = formatMap[cellKey(a.pan.fileName, c)];

          if (SEPARATOR_COLS.has(c)) {
            ws[ref] = { v: "", t: "z", s: {} };
          } else if (c === STATUS_COL) {
            const base = { fill: { patternType: "solid", fgColor: { rgb: statusFill(a) } } };
            ws[ref] = { v: "", t: "s", s: mergeStyle(base, ov) };
          } else if (CURRENCY_COLS.has(c) || PERCENT_COLS.has(c)) {
            ws[ref] = { v: (val ?? 0) as number, t: "n", s: mergeStyle(xlsxDataStyle(col), ov) };
          } else if (typeof val === "number") {
            ws[ref] = { v: val, t: "n", s: mergeStyle({}, ov) };
          } else {
            ws[ref] = { v: (val ?? "") as string, t: "s", s: mergeStyle({}, ov) };
          }
        });
      });
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: errors only at the dock `onPreview` call site (still passing one arg) — acceptable until Task 11. No errors inside `exportToExcel`.

- [ ] **Step 4: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: apply per-cell format overrides in exportToExcel"
```

---

## Task 9: Cell selection hook

**Files:**
- Create: `src/components/export/use-cell-selection.ts`

- [ ] **Step 1: Create the hook**

```ts
// src/components/export/use-cell-selection.ts
"use client";

import { useState, useCallback } from "react";
import { cellKey, rangeKeys, columnKeys, HEADER_ROW } from "@/lib/cell-format";

// rowIds: ordered grid rows — index 0 is HEADER_ROW, then one fileName per data row.
export function useCellSelection(rowIds: string[], selectableCols: number[]) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<{ r: number; c: number } | null>(null);

  const isSelected = useCallback((rowId: string, col: number) => selected.has(cellKey(rowId, col)), [selected]);

  const selectCell = useCallback((r: number, c: number, additive: boolean) => {
    const key = cellKey(rowIds[r], c);
    setAnchor({ r, c });
    setSelected((prev) => {
      const next = additive ? new Set(prev) : new Set<string>();
      next.add(key);
      return next;
    });
  }, [rowIds]);

  const extendTo = useCallback((r: number, c: number) => {
    if (!anchor) return;
    const r0 = Math.min(anchor.r, r), r1 = Math.max(anchor.r, r);
    const c0 = Math.min(anchor.c, c), c1 = Math.max(anchor.c, c);
    const rows = rowIds.slice(r0, r1 + 1);
    const cols = selectableCols.filter((col) => col >= c0 && col <= c1);
    setSelected(new Set(rangeKeys(rows, cols)));
  }, [anchor, rowIds, selectableCols]);

  const selectColumn = useCallback((col: number) => {
    setAnchor({ r: 0, c: col });
    setSelected(new Set(columnKeys(rowIds, col)));
  }, [rowIds]);

  const clear = useCallback(() => { setSelected(new Set()); setAnchor(null); }, []);

  return { selected, isSelected, selectCell, extendTo, selectColumn, clear, HEADER_ROW };
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors from this file.

- [ ] **Step 3: Commit**

```bash
git add src/components/export/use-cell-selection.ts
git commit -m "feat: add cell-selection hook for export preview grid"
```

---

## Task 10: Format toolbar

**Files:**
- Create: `src/components/export/format-toolbar.tsx`

- [ ] **Step 1: Create the toolbar**

```tsx
// src/components/export/format-toolbar.tsx
"use client";

import { Bold, Italic, AlignLeft, AlignCenter, AlignRight, Paintbucket, Baseline } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CellStyle } from "@/lib/cell-format";

const SWATCHES = ["0E2841", "00B0F0", "00B050", "FFC000", "92D050", "FFFF00", "FF6B6B", "FFFFFF", "000000"];

export function FormatToolbar({
  disabled, onApply,
}: {
  disabled: boolean;
  onApply: (patch: CellStyle) => void;
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap border-b border-border pb-3 mb-3">
      <Button variant="outline" size="sm" disabled={disabled} onClick={() => onApply({ bold: true })}><Bold className="h-4 w-4" /></Button>
      <Button variant="outline" size="sm" disabled={disabled} onClick={() => onApply({ bold: false })} title="Remover negrito"><Bold className="h-4 w-4 opacity-40" /></Button>
      <Button variant="outline" size="sm" disabled={disabled} onClick={() => onApply({ italic: true })}><Italic className="h-4 w-4" /></Button>

      <span className="mx-1 h-6 w-px bg-border" />

      <Button variant="outline" size="sm" disabled={disabled} onClick={() => onApply({ align: "left" })}><AlignLeft className="h-4 w-4" /></Button>
      <Button variant="outline" size="sm" disabled={disabled} onClick={() => onApply({ align: "center" })}><AlignCenter className="h-4 w-4" /></Button>
      <Button variant="outline" size="sm" disabled={disabled} onClick={() => onApply({ align: "right" })}><AlignRight className="h-4 w-4" /></Button>

      <span className="mx-1 h-6 w-px bg-border" />

      <label className="flex items-center gap-1 text-xs text-muted-foreground">
        Tam.
        <input type="number" min={6} max={48} defaultValue={11} disabled={disabled}
          onChange={(e) => onApply({ fontSize: Number(e.target.value) })}
          className="w-14 rounded border border-border bg-background px-1 py-0.5 text-sm" />
      </label>

      <span className="mx-1 h-6 w-px bg-border" />

      <label className="flex items-center gap-1 text-xs text-muted-foreground" title="Cor de fundo">
        <Paintbucket className="h-4 w-4" />
        <input type="color" disabled={disabled}
          onChange={(e) => onApply({ fill: e.target.value.replace("#", "").toUpperCase() })}
          className="h-6 w-8 rounded border border-border bg-background" />
      </label>
      <label className="flex items-center gap-1 text-xs text-muted-foreground" title="Cor do texto">
        <Baseline className="h-4 w-4" />
        <input type="color" disabled={disabled}
          onChange={(e) => onApply({ color: e.target.value.replace("#", "").toUpperCase() })}
          className="h-6 w-8 rounded border border-border bg-background" />
      </label>

      <span className="mx-1 h-6 w-px bg-border" />

      <div className="flex items-center gap-1">
        {SWATCHES.map((hex) => (
          <button key={hex} disabled={disabled} title={`Fundo #${hex}`}
            onClick={() => onApply({ fill: hex })}
            className="h-5 w-5 rounded border border-border disabled:opacity-40"
            style={{ background: `#${hex}` }} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors from this file.

- [ ] **Step 3: Commit**

```bash
git add src/components/export/format-toolbar.tsx
git commit -m "feat: add format toolbar for export preview"
```

---

## Task 11: ExportPreview modal + wire dock button

**Files:**
- Create: `src/components/export/export-preview.tsx`
- Modify: `src/app/page.tsx` (state for preview open; dock `onPreview`; render modal)

- [ ] **Step 1: Create the preview modal**

```tsx
// src/components/export/export-preview.tsx
"use client";

import { useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, Loader2 } from "lucide-react";
import type { AnalyzedPan } from "@/lib/analyze";
import {
  EXPORT_COLUMNS, SEPARATOR_COLS, STATUS_COL, statusFill, buildRow,
} from "@/lib/export-schema";
import {
  applyStyle, cellKey, HEADER_ROW, type CellStyle, type FormatMap,
} from "@/lib/cell-format";
import { FormatToolbar } from "./format-toolbar";
import { useCellSelection } from "./use-cell-selection";

const SELECTABLE_COLS = EXPORT_COLUMNS.filter((c) => !SEPARATOR_COLS.has(c.index)).map((c) => c.index);

// Translate schema + override into inline CSS for the WYSIWYG cell.
function cellCss(colIndex: number, defaultFill: string, ov?: CellStyle): React.CSSProperties {
  const css: React.CSSProperties = {};
  if (defaultFill) { css.background = `#${defaultFill}`; css.color = "#fff"; css.fontWeight = 600; }
  if (ov?.fill) css.background = `#${ov.fill}`;
  if (ov?.color) css.color = `#${ov.color}`;
  if (ov?.bold !== undefined) css.fontWeight = ov.bold ? 700 : 400;
  if (ov?.italic) css.fontStyle = "italic";
  if (ov?.fontSize) css.fontSize = ov.fontSize;
  if (ov?.align) css.textAlign = ov.align;
  return css;
}

export function ExportPreview({
  open, onOpenChange, ordered, exporting, onExport,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  ordered: AnalyzedPan[];
  exporting: boolean;
  onExport: (formatMap: FormatMap) => void;
}) {
  const [formatMap, setFormatMap] = useState<FormatMap>({});
  const dragging = useRef(false);

  const rowIds = useMemo(() => [HEADER_ROW, ...ordered.map((a) => a.pan.fileName)], [ordered]);
  const sel = useCellSelection(rowIds, SELECTABLE_COLS);

  const applyPatch = (patch: CellStyle) => {
    if (sel.selected.size === 0) return;
    setFormatMap((prev) => applyStyle(prev, [...sel.selected], patch));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-[95vw] max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Pré-visualização do Excel</DialogTitle>
        </DialogHeader>

        <FormatToolbar disabled={sel.selected.size === 0} onApply={applyPatch} />

        <div className="flex-1 overflow-auto scrollbar-thin border border-border rounded" onMouseLeave={() => (dragging.current = false)}>
          <table className="border-collapse text-xs select-none" style={{ tableLayout: "fixed" }}>
            <thead>
              <tr>
                {EXPORT_COLUMNS.map((col) => {
                  if (SEPARATOR_COLS.has(col.index)) return <th key={col.index} style={{ width: 8 }} className="border border-border/40 bg-transparent" />;
                  const ov = formatMap[cellKey(HEADER_ROW, col.index)];
                  const isSel = sel.isSelected(HEADER_ROW, col.index);
                  return (
                    <th key={col.index}
                      onClick={() => sel.selectColumn(col.index)}
                      style={{ ...cellCss(col.index, col.fill, ov), width: col.width * 7, whiteSpace: "pre-line" }}
                      className={`border border-border/40 px-2 py-1 cursor-pointer ${isSel ? "outline outline-2 outline-primary" : ""}`}
                      title="Clique para selecionar a coluna inteira">
                      {col.header}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {ordered.map((a, ri) => {
                const values = buildRow(a);
                const rowIndex = ri + 1; // 0 is header
                return (
                  <tr key={a.pan.fileName}>
                    {EXPORT_COLUMNS.map((col) => {
                      const c = col.index;
                      if (SEPARATOR_COLS.has(c)) return <td key={c} className="border border-border/40 bg-transparent" />;
                      const ov = formatMap[cellKey(a.pan.fileName, c)];
                      const isSel = sel.isSelected(a.pan.fileName, c);
                      const defaultFill = c === STATUS_COL ? statusFill(a) : "";
                      const display = c === STATUS_COL ? "" : values[c];
                      return (
                        <td key={c}
                          onMouseDown={(e) => { dragging.current = true; sel.selectCell(rowIndex, c, e.shiftKey || e.ctrlKey || e.metaKey); }}
                          onMouseEnter={() => { if (dragging.current) sel.extendTo(rowIndex, c); }}
                          onMouseUp={() => { dragging.current = false; }}
                          style={{ ...cellCss(c, defaultFill, ov) }}
                          className={`border border-border/40 px-2 py-1 cursor-cell ${isSel ? "outline outline-2 outline-primary" : ""}`}>
                          {typeof display === "number"
                            ? (col.kind === "percent" ? `${Math.round(display * 100)}%` : display.toLocaleString("pt-BR", { maximumFractionDigits: 0 }))
                            : (display ?? "")}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between pt-3">
          <p className="text-xs text-muted-foreground">
            {sel.selected.size > 0 ? `${sel.selected.size} célula(s) selecionada(s)` : "Clique numa célula, cabeçalho ou arraste para selecionar"}
            {sel.selected.size > 0 && <button onClick={sel.clear} className="ml-2 underline">limpar seleção</button>}
          </p>
          <Button onClick={() => onExport(formatMap)} disabled={exporting} className="gap-2 bg-gradient-brand hover:opacity-90">
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Exportar Excel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Wire the modal into `page.tsx` — add open state near other state**

```ts
  const [previewOpen, setPreviewOpen] = useState(false);
```

- [ ] **Step 3: Point the dock button at the modal**

In the `<ExportDock … />` props, change `onPreview` to:

```tsx
          onPreview={() => setPreviewOpen(true)}
```

- [ ] **Step 4: Import and render the modal (inside `DndContext`, alongside the dock)**

Add the import:

```ts
import { ExportPreview } from "@/components/export/export-preview";
```

Render after the dock:

```tsx
      <ExportPreview
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        ordered={orderedSelection}
        exporting={exporting}
        onExport={async (formatMap) => { await exportToExcel(orderedSelection, formatMap); }}
      />
```

- [ ] **Step 5: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS, no errors.

- [ ] **Step 6: Manual verification**

Run: `npm run dev`. With PANs in the dock, click "Pré-visualizar":
- Modal shows the full grid with real headers and default colors (dark blue / blue / green / orange, status fills).
- Click a cell → it highlights; toolbar enables. Apply bold, fill swatch, text color, size, alignment → the cell updates live.
- Click a column header → whole column selected; formatting applies to all rows.
- Click-drag across cells → rectangular selection; formatting applies to the block.
- "Exportar Excel" downloads a file; open it and confirm the formatting overrides appear on top of the default styling and number formats are intact.

- [ ] **Step 7: Run the full test suite**

Run: `npm test`
Expected: all suites PASS (existing + `export-schema`, `export-tray`, `cell-format`).

- [ ] **Step 8: Commit**

```bash
git add src/app/page.tsx src/components/export/export-preview.tsx
git commit -m "feat: WYSIWYG export preview with cell formatting"
```

---

## Final verification

- [ ] `npm test` — all green.
- [ ] `npx tsc --noEmit` — clean.
- [ ] `npm run lint` — clean.
- [ ] Manual end-to-end: upload PANs → drag into dock → reorder → preview → format cells → export → open `.xlsx` and confirm order + formatting + number formats.

## Notes for the implementer

- **Duplicate fileNames:** tray and formatting key by `pan.fileName`, matching the app's prior `selected` behavior. If two uploads share a name they collide — this is pre-existing and out of scope.
- **DnD ids:** dock chips and PAN cards both use `pan.fileName` as the `@dnd-kit` id. That's intentional so a card dragged onto the dock and a chip reordered inside it share identity. Don't introduce a second id scheme.
- **Don't reformat the existing `.xlsx` model:** the column labels, fills, widths, and row heights in `export-schema.ts` are copied verbatim from the original export and matched against a model file. Changing them changes the output.
