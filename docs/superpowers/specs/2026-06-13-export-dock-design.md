# Export Dock — Design Spec

**Date:** 2026-06-13
**Status:** Approved (pending spec review)
**Area:** `src/app/page.tsx`, new `src/lib/export-tray.ts`, new `ExportDock` component

## Summary

Replace the current checkbox-based export selection with a **bottom sticky dock** that
the user fills by dragging PAN result cards into it. The **order of chips in the dock**
determines the **row order** in the exported Excel. The exported file format is unchanged —
it remains the existing styled 22-column sheet produced by `exportToExcel`; only the row
ordering now follows the dock instead of `analyzed` order.

This is purely a selection/ordering UX change. The PDF parsing, budget matching, analysis,
and xlsx formatting are all out of scope and untouched.

## Background — current behavior

- Selection state lives in `page.tsx` as `selected: Set<string>`, keyed by `pan.fileName`.
- A top control `Card` holds: "Selecionar aprovados", "Limpar seleção", a count badge, and
  the "Exportar Excel" button (`page.tsx` ~lines 419–438).
- `PanCard` exposes `isSelected` / `onSelect` (a checkbox-style toggle).
- `exportToExcel()` does `analyzed.filter(a => selected.has(a.pan.fileName))`, so row order
  follows `analyzed` order, not selection order.

A `Set` cannot express order, which is why selection state must change shape.

## Goals

1. Drag a PAN card into a bottom dock to include it in the export.
2. Reorder chips within the dock; that order = Excel row order.
3. Remove a chip from the dock; clear the whole dock.
4. Keep a fast bulk path: one click to fill the dock ("Selecionar aprovados",
   "Adicionar todas"), then "Exportar Excel".
5. Same `.xlsx` output as today, rows in dock order.

## Non-goals

- Choosing which columns appear or their order (the column layout stays fixed).
- Grouping PANs into multiple sheets / buckets.
- Any change to parsing, matching, analysis, or xlsx styling.

## Decisions

- **Drag-and-drop:** `@dnd-kit/core` + `@dnd-kit/sortable`. Idiomatic React, smooth sortable
  reordering, keyboard + touch sensors. One new (tree-shakeable) dependency.
- **Checkboxes:** fully removed. The dock is the single selection mechanism. Bulk convenience
  is preserved via actions that **auto-populate the dock in order**, so "fill and export"
  stays a 1–2 click flow.
- **Key:** chips/tray keyed by `pan.fileName`, matching today's selection key (preserves
  existing duplicate-filename behavior; no scope creep).

## Architecture — 4 units

### 1. `src/lib/export-tray.ts` — ordered selection state (new, pure, tested)

Replaces `selected: Set<string>` with an ordered `tray: string[]` of `fileName`s.
Pure helper functions operating on `string[]`:

- `addToTray(tray, fileName): string[]` — append; no-op if already present (dedupe).
- `removeFromTray(tray, fileName): string[]`
- `reorderTray(tray, fromIndex, toIndex): string[]`
- `clearTray(): string[]` → `[]`
- `pruneTray(tray, validFileNames): string[]` — drop entries no longer in results.
- `orderedApproved(analyzed): string[]` — fileNames of approved PANs in `analyzed` order
  (rebuild of current `selectAllOk`).
- `allFileNames(analyzed): string[]` — for "Adicionar todas".

`page.tsx` holds `const [tray, setTray] = useState<string[]>([])` and calls these helpers.

### 2. `ExportDock` — bottom sticky dock (new component)

- Fixed to the bottom of the viewport; rendered only when `analyzed.length > 0`.
- Wrapped in `@dnd-kit` `SortableContext` (horizontal). Renders one chip per `tray` entry,
  in order: PAN number + status dot + remove (×) button.
- Acts as the **droppable** target for cards dragged from the list.
- Hosts the controls moved out of the old top bar: item count, "Limpar" (→ `clearTray`),
  "Selecionar aprovados" (→ `orderedApproved`), "Adicionar todas" (→ `allFileNames`), and
  the **"Exportar Excel"** button (disabled when `tray.length === 0` or `exporting`).
- Empty state: collapses to a slim hint strip — "Arraste PANs aqui para exportar".
- Styling follows the existing design system (`glass`, brand gradient button, status colors).

### 3. `PanCard` — drag source (modified)

- Becomes a `@dnd-kit` draggable with a visible grip handle (matches the `⠿` mockups).
- `isSelected` / `onSelect` (checkbox) props **removed**; instead receives `inTray: boolean`
  and renders an "in export" affordance when its fileName is in `tray`.
- Handle also supports click-to-add as a non-drag / keyboard fallback.

### 4. `exportToExcel` — minimal change (modified)

- Replace `analyzed.filter(...)` with: map over `tray` in order → resolve each fileName to its
  `analyzed` entry (build a `Map<fileName, AnalyzedPan>` once) → collect into `selectedPans`.
- Skip tray entries with no matching `analyzed` entry (defensive; pairs with `pruneTray`).
- Everything downstream (headers, styles, cell writing) is byte-for-byte unchanged.

## Data flow

```
analyzed PAN cards ──drag handle──▶ ExportDock (droppable)
                                          │
                                   tray: string[]  (ordered, deduped)
                                          │  reorder / remove / bulk-add
                                          ▼
                              exportToExcel(): map tray → analyzed
                                          ▼
                              existing xlsx-js-style builder ──▶ .xlsx
```

## Edge cases

- **Duplicate add** → ignored (`addToTray` dedupes).
- **PAN removed from results** while in tray → `pruneTray` on `analyzed` change; export also
  skips unmatched entries.
- **Empty tray** → "Exportar Excel" disabled; dock shows hint.
- **Bulk add when items already present** → dedupe keeps order stable, appends only new ones.

## Testing

`src/lib/export-tray.test.ts` (vitest), covering pure helpers:

- `addToTray` appends and dedupes.
- `removeFromTray` removes the right entry, leaves order intact.
- `reorderTray` moves an item from/to correct index (incl. boundaries).
- `pruneTray` drops stale fileNames, preserves order of survivors.
- `orderedApproved` returns approved fileNames in `analyzed` order.
- `clearTray` returns empty.

Extracting tray logic into `export-tray.ts` is what makes this testable and also trims
`page.tsx` (currently 894 lines). The dock's DnD wiring is verified manually in the browser.

## Out of scope / future

- Column selection, multi-sheet buckets, saved export presets — explicitly deferred.
