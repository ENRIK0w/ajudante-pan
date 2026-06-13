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
