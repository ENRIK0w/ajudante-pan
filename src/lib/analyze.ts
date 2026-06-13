import type { PanData } from "./pan-parser";
import {
  lookupBudgetByYear,
  lookupPeseByYear,
  lookupTiByYear,
  getTiOptions,
  matchTiPrograma,
  matchTiDescricao,
  matchEmpresaCode,
  matchTpCode,
  matchPeseCode,
  type BudgetDb,
  type CnpjEntry,
  type PeseDb,
  type TiDb,
  type TiRow,
} from "./budget-parser";

export interface YearCell {
  year: string;
  requested: number;
  available: number;
  diff: number;
  ok: boolean;
}

export interface PeseAnalysis {
  peseCodeResolved: string | null;
  peseByYear: YearCell[];
  peseTotal: { requested: number; available: number; diff: number; ok: boolean };
}

export interface AnalyzedPan {
  pan: PanData;
  tpResolved: string | null;
  years: string[];
  rows: {
    empresaPan: string;
    empresaCode: string | null;
    requested: number;
    available: number;
    diff: number;
    ok: boolean;
    byYear: YearCell[];
    tiPrograma?: string | null;
    tiProgramaOptions?: TiRow[];
  }[];
  totalRequested: number;
  totalAvailable: number;
  yearTotals: YearCell[];
  status: "ok" | "warn" | "unknown";
  pese?: PeseAnalysis;
  manualStatus?: "aprovado" | "negado" | "warn";
}

export type StatusOverride = "aprovado" | "negado" | "warn";

export interface Overrides {
  tp?: string;
  empresas?: Record<string, string>;
  peseCode?: string;
  tiProgramas?: Record<string, string>;
}

export interface AnalyzeContext {
  db: BudgetDb;
  cnpj: CnpjEntry[];
  peseDb: PeseDb | null;
  tiDb: TiDb | null;
  overrides: Record<string, Overrides>;
  statusOverrides: Record<string, StatusOverride>;
}

export function analyzePans(pans: PanData[], ctx: AnalyzeContext): AnalyzedPan[] {
  const { db, cnpj, peseDb, tiDb, overrides, statusOverrides } = ctx;
  return pans.map((pan) => {
    const key = pan.fileName;
    const ov = overrides[key] ?? {};
    const isTiPan = pan.isTi && !!tiDb;
    const autoTp = pan.tp
      ? (isTiPan ? matchTpCode(pan.tp, { tps: tiDb!.tps } as BudgetDb) : matchTpCode(pan.tp, db))
      : null;
    const tp = ov.tp ?? autoTp ?? "";
    const capex = (pan.percentualCapex ?? 100) / 100;
    const flow = pan.fluxoCaixa.filter((f) => f.valor > 0);
    const panYears = flow.map((f) => String(f.ano));
    const years = Array.from(new Set([...panYears, ...(isTiPan ? tiDb!.years : db.years)])).sort();
    const reqByYear: Record<string, number> = {};
    const totalPan = flow.reduce((a, b) => a + b.valor, 0);
    for (const f of flow) reqByYear[String(f.ano)] = f.valor * capex;
    const rows = pan.rateio.map((r) => {
      const codeOverride = ov.empresas?.[r.empresa];
      const code = codeOverride ?? matchEmpresaCode(r.empresa, cnpj, isTiPan ? { empresas: tiDb!.empresas } as BudgetDb : db);
      const share = totalPan > 0 ? r.valor / totalPan : 0;
      const requested = r.valor * capex;
      let avByYear: Record<string, number> = {};
      let tiPrograma: string | null = null;
      let tiProgramaOptions: TiRow[] = [];
      if (isTiPan && tiDb) {
        tiProgramaOptions = code ? getTiOptions(tiDb, code, tp) : [];
        const programaOverride = ov.tiProgramas?.[code ?? ""];
        tiPrograma = programaOverride
          ?? matchTiPrograma(pan.programaOrcamentario, tiProgramaOptions)
          ?? matchTiDescricao(pan.descricaoObra, tiProgramaOptions);
        avByYear = code && tp && tiPrograma ? lookupTiByYear(tiDb, code, tp, tiPrograma) : {};
      } else if (!pan.isTurnKey) {
        avByYear = code && tp ? lookupBudgetByYear(db, code, tp) : {};
      }
      const byYear: YearCell[] = years.map((y) => {
        const req = (reqByYear[y] ?? 0) * share;
        const av = avByYear[y] ?? 0;
        return { year: y, requested: req, available: av, diff: av - req, ok: req <= av };
      });
      const available = byYear.reduce((a, b) => a + b.available, 0);
      const ok = !!code && (isTiPan ? !!tiPrograma : true) && byYear.every((y) => y.ok);
      return {
        empresaPan: r.empresa,
        empresaCode: code,
        requested,
        available,
        diff: available - requested,
        ok,
        byYear,
        tiPrograma,
        tiProgramaOptions,
      };
    });
    const totalRequested = rows.reduce((a, b) => a + b.requested, 0);
    const totalAvailable = rows.reduce((a, b) => a + b.available, 0);
    const yearTotals: YearCell[] = years.map((y) => {
      const req = rows.reduce((a, r) => a + (r.byYear.find((c) => c.year === y)?.requested ?? 0), 0);
      const av = rows.reduce((a, r) => a + (r.byYear.find((c) => c.year === y)?.available ?? 0), 0);
      return { year: y, requested: req, available: av, diff: av - req, ok: req <= av };
    });
    let pese: PeseAnalysis | undefined;
    if (pan.isTurnKey && peseDb) {
      const autoPeseCode = pan.peseCode ? matchPeseCode(pan.peseCode, peseDb) : null;
      const peseCodeResolved = ov.peseCode ?? autoPeseCode;
      const peseAvByYear = peseCodeResolved ? lookupPeseByYear(peseDb, peseCodeResolved) : {};
      const peseAvailableYears = Object.keys(peseAvByYear).sort();
      const allPeseYears = Array.from(new Set([...years, ...peseAvailableYears])).sort();
      const peseByYear: YearCell[] = allPeseYears.map((y) => {
        const req = reqByYear[y] ?? 0;
        const av = peseAvByYear[y] ?? 0;
        return { year: y, requested: req, available: av, diff: av - req, ok: req <= av };
      });
      const peseTotalReq = peseByYear.reduce((a, b) => a + b.requested, 0);
      const peseTotalAv = peseByYear.reduce((a, b) => a + b.available, 0);
      pese = {
        peseCodeResolved,
        peseByYear,
        peseTotal: {
          requested: peseTotalReq,
          available: peseTotalAv,
          diff: peseTotalAv - peseTotalReq,
          ok: peseTotalReq <= peseTotalAv,
        },
      };
    }
    let status: AnalyzedPan["status"];
    if (pan.isTurnKey) {
      if (!pese?.peseCodeResolved) {
        status = "unknown";
      } else {
        const hasYearWithoutBudget = pese.peseByYear.some(
          (y) => y.requested > 0 && y.available === 0
        );
        if (hasYearWithoutBudget || !pese.peseTotal.ok) {
          status = "warn";
        } else {
          status = "ok";
        }
      }
    } else if (isTiPan) {
      const hasUnknown = rows.some((r) => !r.empresaCode || !r.tiPrograma) || !tp;
      status = hasUnknown
        ? "unknown"
        : rows.every((r) => r.ok)
          ? "ok"
          : "warn";
    } else {
      const hasUnknown = rows.some((r) => !r.empresaCode) || !tp;
      status = hasUnknown
        ? "unknown"
        : rows.every((r) => r.ok)
          ? "ok"
          : "warn";
    }
    const finalTotalRequested = pan.isTurnKey && pese ? pese.peseTotal.requested : totalRequested;
    const finalTotalAvailable = pan.isTurnKey && pese ? pese.peseTotal.available : totalAvailable;
    return {
      pan,
      tpResolved: tp || null,
      years,
      rows,
      totalRequested: finalTotalRequested,
      totalAvailable: finalTotalAvailable,
      yearTotals,
      status,
      pese,
      manualStatus: statusOverrides[pan.fileName] as "aprovado" | "negado" | "warn" | undefined,
    };
  });
}
