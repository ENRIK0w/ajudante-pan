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
