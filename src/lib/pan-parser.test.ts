import { describe, it, expect } from "vitest";
import { parseBR } from "./pan-parser";

describe("parseBR", () => {
  it("parses BRL with thousands separators", () => {
    expect(parseBR("1.500.000")).toBe(1500000);
  });
  it("parses decimals with comma", () => {
    expect(parseBR("1.234,56")).toBe(1234.56);
  });
  it("strips R$ and spaces", () => {
    expect(parseBR("R$ 2.000,00")).toBe(2000);
  });
  it("returns 0 for non-numeric", () => {
    expect(parseBR("abc")).toBe(0);
  });
});
