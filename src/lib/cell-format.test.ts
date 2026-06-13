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
  it("mergeStyle writes bold:false through (does not skip it)", () => {
    const out = mergeStyle({ numFmt: "#,##0" }, { bold: false });
    expect(out).toEqual({ numFmt: "#,##0", font: { bold: false } });
  });
  it("applyStyle does not mutate the input map", () => {
    const original: FormatMap = { "data:a.pdf:3": { bold: true } };
    const next = applyStyle(original, ["data:a.pdf:3"], { italic: true });
    expect(original["data:a.pdf:3"]).toEqual({ bold: true });
    expect(next["data:a.pdf:3"]).toEqual({ bold: true, italic: true });
  });
});
