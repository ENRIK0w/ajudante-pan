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
