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
