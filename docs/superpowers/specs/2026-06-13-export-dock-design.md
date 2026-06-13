# Export Dock + Formattable Preview — Design Spec

**Date:** 2026-06-13
**Status:** Approved (pending spec review)
**Area:** `src/app/page.tsx`; new `src/lib/export-tray.ts`, `src/lib/export-schema.ts`,
`src/lib/cell-format.ts`; new `ExportDock`, `ExportPreview`, `FormatToolbar` components.

## Summary

Two linked capabilities replacing today's checkbox-based export:

1. **Export dock** — a bottom sticky dock the user fills by dragging PAN result cards into it.
   Chip order (drag-to-reorder) = row order in the Excel.
2. **Formattable preview** — a "Pré-visualizar" button opens a modal showing the real sheet
   (true WYSIWYG: same 22 columns, header labels, and default colors as the output). The user
   clicks cells and applies visual formatting (bold, italic, fill color, text color, font size,
   alignment), then exports. Overrides merge onto the default styles; the `.xlsx` is generated
   from the same definitions the preview renders.

The PDF parsing, budget matching, and analysis are out of scope and untouched. The export's
column layout and default color scheme are preserved; the user can now reorder rows and
override cell styling on top.

## Background — current behavior

- Selection state: `selected: Set<string>` in `page.tsx`, keyed by `pan.fileName`.
- Top control `Card`: "Selecionar aprovados", "Limpar seleção", count badge, "Exportar Excel"
  (`page.tsx` ~lines 419–438).
- `PanCard` exposes `isSelected` / `onSelect` (checkbox-style).
- `exportToExcel()` filters `analyzed` by `selected` (order = `analyzed` order) and builds a
  22-column styled sheet inline, with header labels, default fills/fonts, currency/percent
  number formats, separator columns, and an auto-colored Status cell.

A `Set` cannot express order; the inline layout in `exportToExcel` cannot be reused by a
preview. Both must be refactored.

## Decisions

- **Drag-and-drop:** `@dnd-kit/core` + `@dnd-kit/sortable` (dock reorder; drag card → dock).
- **Checkboxes:** removed. The dock is the single selection mechanism. Bulk convenience kept
  via actions that auto-populate the dock in order ("Selecionar aprovados", "Adicionar todas").
- **Preview shape:** a centered **modal** opened from the dock (not an expandable dock, not a
  separate route).
- **Cell selection:** click a cell; click a column header to select the whole column;
  click-drag for a rectangular range.
- **Formatting controls:** bold, italic, fill (background) color, text color, font size,
  horizontal alignment.
- **Color pickers:** native color input **plus** preset swatches matching the export palette
  (dark blue `0E2841`, blue `00B0F0`, green `00B050`, orange `FFC000`, status colors).
- **Persistence:** in-memory for the session only (cleared on reload). No storage.
- **Key:** tray entries and cell formatting keyed by `pan.fileName`, matching today's key.

## Architecture — units

### 1. `src/lib/export-tray.ts` — ordered selection (new, pure, tested)

Replaces `selected: Set<string>` with ordered `tray: string[]` of `fileName`s. Pure helpers:
`addToTray` (append, dedupe), `removeFromTray`, `reorderTray(from, to)`, `clearTray`,
`pruneTray(tray, validFileNames)`, `orderedApproved(analyzed)` (rebuild of `selectAllOk`),
`allFileNames(analyzed)`. `page.tsx` holds `tray` state and calls these.

### 2. `src/lib/export-schema.ts` — column definitions (new, single source of truth)

Extracted from the inline block in `exportToExcel`. Exports:

- `EXPORT_COLUMNS`: ordered array describing each of the 22 columns — `header` label,
  `defaultHeaderStyle`, `kind` (`text | currency | percent | separator | status`), and the
  default data-cell style/number format.
- Helper sets/maps derived from it: separator indices, currency indices, percent indices,
  status index — replacing the hardcoded `SEPARATORS` / `CURRENCY_COLS` / `PERCENT_COLS`.
- `buildRow(analyzedPan): (string|number|null)[]` — the per-PAN row computation currently
  inline in the `for (const a of selectedPans)` loop, moved here so preview and export share it.

Both `ExportPreview` (rendering) and `exportToExcel` (writing) consume this module. No layout
duplication.

### 3. `src/lib/cell-format.ts` — formatting model (new, pure, tested)

- `CellStyle`: `{ bold?, italic?, fontSize?, align?, color?(text rgb), fill?(bg rgb) }`.
- `FormatMap`: `Record<string, CellStyle>`. Cell keys: `data:{fileName}:{col}` and
  `header:{col}`.
- Helpers: `cellKey(...)`, `applyStyle(map, keys, patch)` (merge patch into each key),
  `rangeKeys(rowIds, fromCol, toCol, fromRow, toRow)`, `columnKeys(rowIds, col)`,
  `mergeStyle(defaultStyle, override): xlsxStyle` (override wins; never touches `numFmt`).

### 4. `ExportDock` — bottom sticky dock (new component)

Bottom-pinned, visible when `analyzed.length > 0`. `@dnd-kit` `SortableContext` of chips in
`tray` order (PAN nº + status dot + ×). Droppable target for dragged cards. Hosts: count,
"Limpar", "Selecionar aprovados", "Adicionar todas", and **"Pré-visualizar"** (opens the modal;
disabled when `tray.length === 0`). Empty state: slim hint "Arraste PANs aqui para exportar".

### 5. `ExportPreview` — modal (new component)

`Dialog` containing a scrollable grid built from `EXPORT_COLUMNS` + `buildRow` for each
tray-ordered PAN, rendered with default styles merged with the `FormatMap` (WYSIWYG). Manages
cell selection via `useCellSelection`. Hosts `FormatToolbar` and the **"Exportar Excel"**
button (calls the refactored `exportToExcel(tray, formatMap)`). Separator columns are not
selectable; currency/percent cells keep their number format regardless of overrides.

### 6. `FormatToolbar` — formatting controls (new, sub of preview)

Bold/italic toggles (`toggle-group`), fill + text color controls (native input + brand-swatch
presets), font-size stepper, alignment group. Applies a `CellStyle` patch to the current
selection via `applyStyle`.

### 7. `useCellSelection` — selection state (new hook)

Selected cell-key `Set`, plus interaction handlers: single click, column-header click
(`columnKeys`), click-drag rectangle (`rangeKeys`). Range math is pure and unit-testable.

### 8. `PanCard` — drag source (modified)

`@dnd-kit` draggable with a grip handle (click-to-add fallback). `isSelected`/`onSelect`
removed; receives `inTray: boolean` and shows an "in export" affordance.

### 9. `exportToExcel` — refactor (modified)

Maps over `tray` (ordered) → `buildRow` from schema → writes cells, taking each cell's style
from `mergeStyle(schemaDefault, formatMap[key])`. Skips tray entries with no matching
`analyzed`. xlsx-js-style output otherwise identical to today for un-formatted cells.

## Data flow

```
analyzed cards ──drag──▶ ExportDock (tray: string[], ordered)
                              │  "Pré-visualizar"
                              ▼
                        ExportPreview modal
        EXPORT_COLUMNS + buildRow ──▶ grid (default styles)
        click cells ──▶ useCellSelection ──▶ FormatToolbar ──▶ FormatMap (in memory)
                              │  "Exportar Excel"
                              ▼
        exportToExcel(tray, formatMap): buildRow + mergeStyle(default, override) ──▶ .xlsx
```

## Edge cases

- **Reorder after formatting:** formatting keyed by `fileName`/header stays attached correctly.
- **PAN removed from results:** `pruneTray` drops it; its `FormatMap` entries become inert.
- **Duplicate add:** ignored. **Empty tray:** "Pré-visualizar"/"Exportar" disabled.
- **Number cells:** `mergeStyle` never overrides `numFmt`; currency/percent stays intact.
- **Separator columns:** not selectable or formattable.
- **Status cell:** keeps auto color by default; user override allowed.

## Phasing (one plan, two ship-able phases)

- **Phase 1 — Dock + ordering + schema extraction.** `export-tray.ts`, `export-schema.ts`,
  `ExportDock`, `PanCard` drag source, `exportToExcel` reads schema + tray order. Removes
  checkboxes. Exports in dock order with default styling. Fully usable on its own.
- **Phase 2 — Formattable preview.** `cell-format.ts`, `useCellSelection`, `ExportPreview`,
  `FormatToolbar`; `exportToExcel` merges `FormatMap`. Dock button becomes "Pré-visualizar".

## Testing

Vitest unit tests for the pure modules:

- `export-tray.test.ts` — add/dedupe, remove, reorder (incl. boundaries), prune, orderedApproved,
  allFileNames, clear.
- `cell-format.test.ts` — `cellKey`, `applyStyle` merge/overwrite, `rangeKeys` rectangle,
  `columnKeys`, `mergeStyle` precedence + `numFmt` preserved.
- `export-schema.test.ts` — column count = 22; currency/percent/separator/status index sets
  match expectations; `buildRow` output shape/values for a sample `AnalyzedPan`.

Modal DnD, cell-selection interactions, and visual fidelity are verified manually in the browser.

## Out of scope / future

- Choosing which columns appear or multi-sheet buckets.
- Saved/named formatting presets; cross-session persistence.
- Editing cell values/text (formatting only, not data entry).
