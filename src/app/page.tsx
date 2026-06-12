"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Upload,
  FileText,
  CheckCircle2,
  AlertTriangle,
  TrendingUp,
  Loader2,
  X,
  ChevronDown,
  ChevronRight,
  Wrench,
  Download,
  CheckSquare,
  Square,
  FolderOpen,
  HelpCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { parsePanPdf, type PanData } from "@/lib/pan-parser";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  loadBudgetFromUrl,
  loadCnpjFromUrl,
  loadPeseFromUrl,
  lookupBudgetByYear,
  lookupPeseByYear,
  matchEmpresaCode,
  matchTpCode,
  matchPeseCode,
  type BudgetDb,
  type CnpjEntry,
  type PeseDb,
} from "@/lib/budget-parser";
import XLSX from "xlsx-js-style";

const fmtBRL = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

interface YearCell {
  year: string;
  requested: number;
  available: number;
  diff: number;
  ok: boolean;
}

interface PeseAnalysis {
  peseCodeResolved: string | null;
  peseByYear: YearCell[];
  peseTotal: { requested: number; available: number; diff: number; ok: boolean };
}

interface AnalyzedPan {
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
  }[];
  totalRequested: number;
  totalAvailable: number;
  yearTotals: YearCell[];
  status: "ok" | "warn" | "unknown";
  pese?: PeseAnalysis;
  manualStatus?: "aprovado" | "negado" | "warn";
}

export default function Page() {
  const [db, setDb] = useState<BudgetDb | null>(null);
  const [cnpj, setCnpj] = useState<CnpjEntry[] | null>(null);
  const [peseDb, setPeseDb] = useState<PeseDb | null>(null);
  const [loadingBase, setLoadingBase] = useState(true);
  const [pans, setPans] = useState<PanData[]>([]);
  const [overrides, setOverrides] = useState<Record<string, { tp?: string; empresas?: Record<string, string>; peseCode?: string }>>({});
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [statusOverrides, setStatusOverrides] = useState<Record<string, "aprovado" | "negado" | "warn">>({});
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [b, c, p] = await Promise.all([
          loadBudgetFromUrl("/orcamento.xlsx"),
          loadCnpjFromUrl("/cnpj.xlsx"),
          loadPeseFromUrl("/base pese.xlsx"),
        ]);
        setDb(b);
        setCnpj(c);
        setPeseDb(p);
      } catch (e) {
        setError("Falha ao carregar base: " + (e as Error).message);
      } finally {
        setLoadingBase(false);
      }
    })();
  }, []);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError("");
    setProcessing(true);
    try {
      const parsed: PanData[] = [];
      for (const f of Array.from(files)) {
        if (!f.name.toLowerCase().endsWith(".pdf")) continue;
        parsed.push(await parsePanPdf(f));
      }
      setPans((prev) => [...prev, ...parsed]);
    } catch (e) {
      setError("Erro ao processar PDF: " + (e as Error).message);
    } finally {
      setProcessing(false);
    }
  };

  const analyzed = useMemo<AnalyzedPan[]>(() => {
    if (!db || !cnpj) return [];
    return pans.map((pan) => {
      const key = pan.fileName;
      const ov = overrides[key] ?? {};
      const autoTp = pan.tp ? matchTpCode(pan.tp, db) : null;
      const tp = ov.tp ?? autoTp ?? "";
      const capex = (pan.percentualCapex ?? 100) / 100;
      const flow = pan.fluxoCaixa.filter((f) => f.valor > 0);
      const years = flow.map((f) => String(f.ano));
      const reqByYear: Record<string, number> = {};
      const totalPan = flow.reduce((a, b) => a + b.valor, 0);
      for (const f of flow) reqByYear[String(f.ano)] = f.valor * capex;
      const rows = pan.rateio.map((r) => {
        const codeOverride = ov.empresas?.[r.empresa];
        const code = codeOverride ?? matchEmpresaCode(r.empresa, cnpj, db);
        const share = totalPan > 0 ? r.valor / totalPan : 0;
        const requested = r.valor * capex;
        const avByYear = code && tp ? lookupBudgetByYear(db, code, tp) : {};
        const byYear: YearCell[] = years.map((y) => {
          const req = (reqByYear[y] ?? 0) * share;
          const av = avByYear[y] ?? 0;
          return { year: y, requested: req, available: av, diff: av - req, ok: req <= av };
        });
        const available = byYear.reduce((a, b) => a + b.available, 0);
        const ok = !!code && byYear.every((y) => y.ok);
        return {
          empresaPan: r.empresa,
          empresaCode: code,
          requested,
          available,
          diff: available - requested,
          ok,
          byYear,
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
  }, [pans, db, cnpj, peseDb, overrides, statusOverrides]);

  const summary = useMemo(() => {
    const ok = analyzed.filter((a) => a.status === "ok").length;
    const warn = analyzed.filter((a) => a.status === "warn").length;
    const unknown = analyzed.filter((a) => a.status === "unknown").length;
    const totalReq = analyzed.reduce((a, b) => a + b.totalRequested, 0);
    const totalAv = analyzed.reduce((a, b) => a + b.totalAvailable, 0);
    return { ok, warn, unknown, totalReq, totalAv, count: analyzed.length };
  }, [analyzed]);

  const toggleExpand = (k: string) => {
    const s = new Set(expanded);
    s.has(k) ? s.delete(k) : s.add(k);
    setExpanded(s);
  };

  const toggleSelect = (k: string) => {
    const s = new Set(selected);
    s.has(k) ? s.delete(k) : s.add(k);
    setSelected(s);
  };

  const selectAllOk = () => {
    const okPans = analyzed.filter((a) => a.status === "ok").map((a) => a.pan.fileName);
    setSelected(new Set(okPans));
  };

  const clearSelection = () => {
    setSelected(new Set());
  };

  const exportToExcel = async () => {
    if (selected.size === 0) return;
    setExporting(true);
    try {
      const selectedPans = analyzed.filter((a) => selected.has(a.pan.fileName));

      // Header fill styles — no borders (matches model).
      // Each call to hBase() produces a fresh object so xlsx-js-style's _addFill
      // cannot mutate a shared reference and corrupt sibling cells.
      const hBase = (rgb: string) => ({
        fill: { patternType: "solid", fgColor: { rgb } },
        font: { color: { rgb: "FFFFFF" }, bold: true, sz: 11, name: "Calibri" },
        alignment: { horizontal: "center", vertical: "center", wrapText: true },
      });

      // Data styles — no borders, no fill
      const dCurrency = { numFmt: "#,##0" };
      const dPercent  = { numFmt: "0%" };

      // 22 header columns A–V (matches model structure exactly).
      // hBase() is called per-cell so each gets its own object — prevents _addFill mutation
      // of a shared reference from corrupting sibling cells.
      const headers: { v: string; s: object }[] = [
        { v: "Categoria",                          s: hBase("0E2841") }, // A  0
        { v: "PAN",                                s: hBase("0E2841") }, // B  1
        { v: "Nome",                               s: hBase("0E2841") }, // C  2
        { v: "Total PAN p/ 2026",                  s: hBase("0E2841") }, // D  3
        { v: "Total PAN p/\r\n2027-2030",          s: hBase("0E2841") }, // E  4
        { v: "Total geral PAN",                    s: hBase("0E2841") }, // F  5
        { v: "",                                   s: {}              }, // G  6  separator
        { v: "BAR/BRR",                            s: hBase("0E2841") }, // H  7
        { v: "Linha Orçamento",                    s: hBase("0E2841") }, // I  8
        { v: "Orç p/2026",                         s: hBase("00B0F0") }, // J  9
        { v: "Orç p/2027-2030",                    s: hBase("00B0F0") }, // K 10
        { v: "TOTAL Geral orç.\r\n2026-2030",      s: hBase("00B0F0") }, // L 11
        { v: "",                                   s: {}              }, // M 12  separator
        { v: "∆ PAN vs Orçado\r\n2026",            s: hBase("00B050") }, // N 13
        { v: "∆ PAN vs Orçado\r\n2027-2030",       s: hBase("00B050") }, // O 14
        { v: "TOTAL Geral\r\n2026-2030",           s: hBase("00B050") }, // P 15
        { v: "",                                   s: {}              }, // Q 16  separator
        { v: "% Variação PAN\r\n2026",             s: hBase("FFC000") }, // R 17
        { v: "% Variação PAN\r\n2027-2030",        s: hBase("FFC000") }, // S 18
        { v: "% Variação Geral PAN",               s: hBase("FFC000") }, // T 19
        { v: "Status",                             s: hBase("0E2841") }, // U 20  fill-only in data rows
        { v: "",                                   s: hBase("0E2841") }, // V 21  observation text in data rows
      ];

      const dataRows: (string | number | null)[][] = [];
      for (const a of selectedPans) {
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
        // Delta = requested − available (negative = within budget, positive = over budget — matches model sign)
        const delta2026       = panCapex2026       - orc2026;
        const delta2027_2030  = panCapex2027_2030  - orc2027_2030;
        const deltaTotal      = panCapexTotal      - orcTotal;
        const pct2026       = orc2026       > 0 ? delta2026      / orc2026       : 0;
        const pct2027_2030  = orc2027_2030  > 0 ? delta2027_2030 / orc2027_2030  : 0;
        const pctTotal      = orcTotal      > 0 ? deltaTotal     / orcTotal      : 0;
        const obsText = a.status === "ok" ? "Ok" : a.status === "warn" ? "Atenção" : "Revisar";

        dataRows.push([
          categoria, panNumber, nome,
          panCapex2026, panCapex2027_2030, panCapexTotal, null,       // A-G
          barBrr, linhaOrc, orc2026, orc2027_2030, orcTotal, null,   // H-M
          delta2026, delta2027_2030, deltaTotal, null,                 // N-Q
          pct2026, pct2027_2030, pctTotal,                             // R-T
          null,     // U  20 — status fill cell (value unused, written below)
          obsText,  // V  21 — observation text
        ]);
      }

      const wb = XLSX.utils.book_new();
      const ws: XLSX.WorkSheet = {};

      // Write header row
      headers.forEach(({ v, s }, col) => {
        const ref = XLSX.utils.encode_cell({ r: 0, c: col });
        ws[ref] = { v, t: v === "" ? "z" : "s", s };
      });

      // Write data rows
      const SEPARATORS = new Set([6, 12, 16]);
      const CURRENCY_COLS = new Set([3, 4, 5, 9, 10, 11, 13, 14, 15]);
      const PERCENT_COLS  = new Set([17, 18, 19]);

      dataRows.forEach((row, rowIdx) => {
        row.forEach((val, col) => {
          const ref = XLSX.utils.encode_cell({ r: rowIdx + 1, c: col });

          if (SEPARATORS.has(col)) {
            ws[ref] = { v: "", t: "z", s: {} };
          } else if (col === 20) {
            // Status: colored fill, no text
            const finalStatus = selectedPans[rowIdx].manualStatus ?? selectedPans[rowIdx].status;
            const fillRgb = (finalStatus === "ok" || finalStatus === "aprovado") ? "92D050"
                          : finalStatus === "warn"   ? "FFFF00"
                          : finalStatus === "negado" ? "FF6B6B"
                          : "D3D3D3";
            ws[ref] = { v: "", t: "s", s: { fill: { patternType: "solid", fgColor: { rgb: fillRgb } } } };
          } else if (col === 21) {
            // Observation text (V column)
            ws[ref] = { v: val ?? "", t: "s", s: {} };
          } else if (CURRENCY_COLS.has(col)) {
            ws[ref] = { v: val ?? 0, t: "n", s: dCurrency };
          } else if (PERCENT_COLS.has(col)) {
            ws[ref] = { v: val ?? 0, t: "n", s: dPercent };
          } else if (typeof val === "number") {
            ws[ref] = { v: val, t: "n", s: {} };
          } else {
            ws[ref] = { v: val ?? "", t: "s", s: {} };
          }
        });
      });

      ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: dataRows.length, c: headers.length - 1 } });

      // Column widths — exact values from model file
      ws["!cols"] = [
        { wch: 13.5  }, // A  Categoria
        { wch: 9.21  }, // B  PAN
        { wch: 94.79 }, // C  Nome
        { wch: 17.79 }, // D  PAN 2026
        { wch: 17.21 }, // E  PAN 2027-2030
        { wch: 19.79 }, // F  PAN Total
        { wch: 1.21  }, // G  separator
        { wch: 13.79 }, // H  BAR/BRR
        { wch: 34.21 }, // I  Linha Orçamento
        { wch: 16.64 }, // J  Orç 2026
        { wch: 18.64 }, // K  Orç 2027-2030
        { wch: 15.79 }, // L  Orç Total
        { wch: 1.21  }, // M  separator
        { wch: 14.64 }, // N  ∆ 2026
        { wch: 17.79 }, // O  ∆ 2027-2030
        { wch: 17.79 }, // P  ∆ Total
        { wch: 1.21  }, // Q  separator
        { wch: 17.79 }, // R  % 2026
        { wch: 17.79 }, // S  % 2027-2030
        { wch: 14.64 }, // T  % Total
        { wch: 11.21 }, // U  Status fill
        { wch: 90.21 }, // V  Observation
      ];

      // Row heights — exact values from model file
      ws["!rows"] = [
        { hpt: 29.1 },
        ...dataRows.map(() => ({ hpt: 29.25 })),
      ];

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

  return (
    <div className="min-h-screen bg-canvas">
      <header className="h-16 border-b border-border/60 bg-surface/80 backdrop-blur-xl sticky top-0 z-30 px-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-gradient-brand grid place-items-center shadow-glow shrink-0">
            <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5 text-white" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="8" width="18" height="12" rx="3" />
              <circle cx="9" cy="13" r="1.5" fill="currentColor" stroke="none" />
              <circle cx="15" cy="13" r="1.5" fill="currentColor" stroke="none" />
              <path d="M9 17h6" />
              <path d="M12 8V5" />
              <circle cx="12" cy="4" r="1" fill="currentColor" stroke="none" />
              <path d="M3 13H1M23 13h-2" />
            </svg>
          </div>
          <div>
            <div className="font-bold text-sm leading-tight">Ajudante das PAN</div>
            <div className="text-[10px] text-muted-foreground leading-tight">v 0.0.1</div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <div className={`h-2 w-2 rounded-full shrink-0 ${loadingBase ? "bg-muted-foreground animate-pulse" : db && cnpj && peseDb ? "bg-status-ok animate-pulse" : "bg-destructive"}`} />
            <span className="hidden sm:inline">
              {loadingBase ? "Carregando base..." : db && cnpj && peseDb ? "Base carregada" : "Erro na base"}
            </span>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold tracking-tight">Análise de PANs</h1>
              <p className="text-sm text-muted-foreground mt-0.5">Verificação contra orçamento aprovado</p>
            </div>
            <div className="flex items-center gap-2">
              <input type="file" id="upload-pan" accept="application/pdf" multiple className="hidden" onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }} />
              <Button onClick={() => document.getElementById("upload-pan")?.click()} className="gap-2 bg-gradient-brand hover:opacity-90 shadow-glow" disabled={processing}>
                {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {processing ? "Processando..." : "Upload PAN"}
              </Button>
            </div>
          </div>

          {error && (
            <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 shrink-0" />
              <div>{error}</div>
              <button onClick={() => setError("")} className="ml-auto p-1 hover:bg-destructive/20 rounded"><X className="h-4 w-4" /></button>
            </div>
          )}

          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {loadingBase ? (
              [0,1,2,3].map((i) => (
                <Card key={i} className="p-5">
                  <div className="flex items-center justify-between">
                    <div className="space-y-2">
                      <Skeleton className="h-3 w-28" />
                      <Skeleton className="h-7 w-14" />
                    </div>
                    <Skeleton className="h-10 w-10 rounded-lg" />
                  </div>
                </Card>
              ))
            ) : (
              [
                <StatCard key="count" label="PANs analisadas" value={String(summary.count)} icon={<FileText className="h-5 w-5" />} />,
                <StatCard key="ok" label="Aprovadas" value={String(summary.ok)} accent="ok" icon={<CheckCircle2 className="h-5 w-5" />} />,
                <StatCard key="warn" label="Atenção" value={String(summary.warn + summary.unknown)} accent="warn" icon={<AlertTriangle className="h-5 w-5" />} />,
                <StatCard key="total" label="Total solicitado" value={fmtBRL(summary.totalReq)} icon={<TrendingUp className="h-5 w-5" />} />,
              ].map((card, i) => (
                <motion.div key={i} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07, duration: 0.3 }}>
                  {card}
                </motion.div>
              ))
            )}
          </section>

          {analyzed.length > 0 && (
            <Card className="p-4">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center gap-3">
                  <Button variant="outline" size="sm" onClick={selectAllOk} className="gap-2 hover:border-status-ok hover:bg-status-ok/10 hover:text-status-ok">
                    <CheckSquare className="h-4 w-4" />
                    Selecionar aprovados ({summary.ok})
                  </Button>
                  <Button variant="outline" size="sm" onClick={clearSelection} disabled={selected.size === 0} className="hover:border-destructive hover:bg-destructive/10 hover:text-destructive">
                    Limpar seleção
                  </Button>
                  {selected.size > 0 && <Badge variant="secondary" className="font-normal">{selected.size} selecionada{selected.size > 1 ? "s" : ""}</Badge>}
                </div>
                <Button onClick={exportToExcel} disabled={selected.size === 0 || exporting} className="gap-2 bg-gradient-brand hover:opacity-90">
                  {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  Exportar Excel
                </Button>
              </div>
            </Card>
          )}

          {processing && (
            <Card className="p-5 overflow-hidden relative">
              <div className="flex items-center gap-4">
                <Loader2 className="h-5 w-5 text-primary animate-spin shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-52" />
                  <Skeleton className="h-3 w-80 max-w-full" />
                </div>
                <Skeleton className="h-8 w-24 rounded-md hidden sm:block" />
              </div>
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-primary/5 to-transparent animate-shimmer pointer-events-none" />
            </Card>
          )}

          {analyzed.length > 0 && (
            <section className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">PANs em análise</h3>
                <span className="text-sm text-muted-foreground">{analyzed.length} documento{analyzed.length > 1 ? "s" : ""}</span>
              </div>
              <div className="space-y-3">
                <AnimatePresence initial={false}>
                  {analyzed.map((a, i) => (
                    <motion.div key={a.pan.fileName + i} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98 }} transition={{ delay: i * 0.04, duration: 0.25 }} whileHover={{ y: -1 }}>
                      <PanCard
                        a={a} db={db!} peseDb={peseDb}
                        expanded={expanded.has(a.pan.fileName)}
                        isSelected={selected.has(a.pan.fileName)}
                        onToggle={() => toggleExpand(a.pan.fileName)}
                        onSelect={() => toggleSelect(a.pan.fileName)}
                        onRemove={() => setPans(pans.filter((_, idx) => idx !== i))}
                        onTpChange={(tp) => setOverrides({ ...overrides, [a.pan.fileName]: { ...overrides[a.pan.fileName], tp } })}
                        onEmpresaChange={(panName, code) => {
                          const cur = overrides[a.pan.fileName] ?? {};
                          setOverrides({ ...overrides, [a.pan.fileName]: { ...cur, empresas: { ...(cur.empresas ?? {}), [panName]: code } } });
                        }}
                        onPeseCodeChange={(peseCode) => setOverrides({ ...overrides, [a.pan.fileName]: { ...overrides[a.pan.fileName], peseCode } })}
                        onStatusChange={(status) => {
                          if (status === null) {
                            const next = { ...statusOverrides };
                            delete next[a.pan.fileName];
                            setStatusOverrides(next);
                          } else {
                            setStatusOverrides({ ...statusOverrides, [a.pan.fileName]: status });
                          }
                        }}
                      />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </section>
          )}

          {analyzed.length === 0 && !processing && (
            <Card
              className={`p-14 text-center border-2 border-dashed transition-all duration-200 cursor-pointer select-none ${dragOver ? "border-primary bg-primary/5 scale-[1.008]" : "border-border/60 hover:border-primary/40 hover:bg-muted/20"}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
              onClick={() => document.getElementById("upload-pan")?.click()}
            >
              <motion.div
                animate={{ scale: dragOver ? 1.18 : 1 }}
                transition={{ type: "spring", stiffness: 280, damping: 18 }}
                className={`mx-auto h-20 w-20 rounded-2xl grid place-items-center mb-5 transition-colors ${dragOver ? "bg-primary/15" : "bg-muted"}`}
              >
                <Upload className={`h-9 w-9 transition-colors ${dragOver ? "text-primary" : "text-muted-foreground"}`} />
              </motion.div>
              <h3 className="text-xl font-semibold">{dragOver ? "Solte os arquivos aqui" : "Nenhuma PAN carregada"}</h3>
              <p className="text-sm text-muted-foreground mt-2 max-w-sm mx-auto">
                {dragOver ? "Arquivos PDF serão processados automaticamente" : "Arraste PDFs para cá ou clique para selecionar arquivos"}
              </p>
              {!dragOver && (
                <div className="flex items-center justify-center gap-2 mt-6">
                  <Button variant="outline" className="gap-2 pointer-events-none">
                    <Upload className="h-4 w-4" />
                    Selecionar arquivos
                  </Button>
                </div>
              )}
            </Card>
          )}
      </main>
    </div>
  );
}

function StatCard({ label, value, icon, accent }: { label: string; value: string; icon: React.ReactNode; accent?: "ok" | "warn" }) {
  const tone = accent === "ok" ? "text-status-ok bg-status-ok/10" : accent === "warn" ? "text-status-warn bg-status-warn/10" : "text-primary bg-primary/10";
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
          <div className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
        </div>
        <div className={`h-10 w-10 rounded-lg grid place-items-center ${tone}`}>{icon}</div>
      </div>
    </Card>
  );
}

function PanCard({ a, db, peseDb, expanded, isSelected, onToggle, onSelect, onRemove, onTpChange, onEmpresaChange, onPeseCodeChange, onStatusChange }: {
  a: AnalyzedPan; db: BudgetDb; peseDb: PeseDb | null;
  expanded: boolean; isSelected: boolean;
  onToggle: () => void; onSelect: () => void; onRemove: () => void;
  onTpChange: (tp: string) => void; onEmpresaChange: (panName: string, code: string) => void; onPeseCodeChange: (peseCode: string) => void;
  onStatusChange: (status: "aprovado" | "negado" | "warn" | null) => void;
}) {
  const effectiveStatus = a.manualStatus ?? a.status;
  const statusConfig = {
    ok: { label: "Dentro do orçamento", cls: "bg-status-ok/15 text-status-ok border-status-ok/30", dot: "bg-status-ok" },
    warn: { label: "Ação necessária", cls: "bg-status-warn/15 text-status-warn border-status-warn/30", dot: "bg-status-warn animate-pulse" },
    unknown: { label: "Revisar mapeamento", cls: "bg-muted text-muted-foreground border-border", dot: "bg-muted-foreground" },
    aprovado: { label: "Aprovado", cls: "bg-status-ok/15 text-status-ok border-status-ok/30", dot: "bg-status-ok" },
    negado: { label: "Negado", cls: "bg-destructive/15 text-destructive border-destructive/30", dot: "bg-destructive" },
  }[effectiveStatus] ?? { label: effectiveStatus, cls: "bg-muted text-muted-foreground border-border", dot: "bg-muted-foreground" };
  const tp = a.tpResolved ?? "";
  const worst = [...a.rows].sort((x, y) => x.diff - y.diff)[0];
  const tpBadgeLabel = a.pan.tp ? (a.tpResolved && a.tpResolved !== a.pan.tp ? `${a.pan.tp} → ${a.tpResolved}` : a.pan.tp) : "sem TP";

  return (
    <Card className={`overflow-hidden transition-all ${isSelected ? "ring-2 ring-primary/50" : ""}`}>
      <div className="flex items-center gap-2 p-5 hover:bg-muted/30 transition-colors">
        <button onClick={(e) => { e.stopPropagation(); onSelect(); }} className="p-1 rounded hover:bg-muted transition-colors shrink-0">
          {isSelected ? <CheckSquare className="h-5 w-5 text-primary" /> : <Square className="h-5 w-5 text-muted-foreground" />}
        </button>
        <button onClick={onToggle} className="flex-1 flex items-center gap-4 text-left">
          <div className={`h-2.5 w-2.5 rounded-full ${statusConfig.dot} shadow-glow-sm`} />
          {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold">PAN {a.pan.panNumber ?? "?"}</span>
              <Badge variant="outline" className="text-xs">TP {tpBadgeLabel}</Badge>
              <Badge variant="outline" className="text-xs">CAPEX {a.pan.percentualCapex ?? 100}%</Badge>
              {a.pan.isTurnKey && <Badge variant="outline" className="text-xs border border-primary/30 bg-primary/15 text-primary inline-flex items-center gap-1"><Wrench className="h-3 w-3" />Turn Key</Badge>}
              <Badge variant="outline" className={`text-xs border ${statusConfig.cls} inline-flex items-center gap-1`}>
                {(effectiveStatus === "ok" || effectiveStatus === "aprovado") ? <CheckCircle2 className="h-3 w-3" /> : effectiveStatus === "warn" ? <AlertTriangle className="h-3 w-3" /> : effectiveStatus === "negado" ? <X className="h-3 w-3" /> : <HelpCircle className="h-3 w-3" />}
                {statusConfig.label}
              </Badge>
              {a.manualStatus && (
                <Badge variant="outline" className="text-xs border border-border text-muted-foreground">calculado: {a.status}</Badge>
              )}
            </div>
            <div className="text-sm text-muted-foreground truncate mt-0.5">{a.pan.titulo}</div>
          </div>
          <div className="hidden md:flex items-center gap-6 text-sm">
            <div className="text-right"><div className="text-xs text-muted-foreground">Solicitado</div><div className="font-medium tabular-nums">{fmtBRL(a.totalRequested)}</div></div>
            <div className="text-right"><div className="text-xs text-muted-foreground">Disponível</div><div className="font-medium tabular-nums">{fmtBRL(a.totalAvailable)}</div></div>
          </div>
        </button>
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => onStatusChange(a.manualStatus === "aprovado" ? null : "aprovado")}
            className={`px-2 py-1 text-xs rounded border transition-colors ${a.manualStatus === "aprovado" ? "bg-status-ok text-white border-status-ok" : "border-border text-muted-foreground hover:border-status-ok hover:text-status-ok"}`}
          >Aprov.</button>
          <button
            onClick={() => onStatusChange(a.manualStatus === "warn" ? null : "warn")}
            className={`px-2 py-1 text-xs rounded border transition-colors ${a.manualStatus === "warn" ? "bg-status-warn text-white border-status-warn" : "border-border text-muted-foreground hover:border-status-warn hover:text-status-warn"}`}
          >Warn</button>
          <button
            onClick={() => onStatusChange(a.manualStatus === "negado" ? null : "negado")}
            className={`px-2 py-1 text-xs rounded border transition-colors ${a.manualStatus === "negado" ? "bg-destructive text-white border-destructive" : "border-border text-muted-foreground hover:border-destructive hover:text-destructive"}`}
          >Neg.</button>
        </div>
        <button onClick={(e) => { e.stopPropagation(); onRemove(); }} className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden border-t border-border/60">
            <div className="p-5 space-y-5 bg-muted/20">
              {!a.pan.isTurnKey && (
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-sm text-muted-foreground">Programa orçamentário (TP):</span>
                  <Select value={tp} onValueChange={onTpChange}>
                    <SelectTrigger className="w-48 h-8"><SelectValue placeholder="TP" /></SelectTrigger>
                    <SelectContent>{db.tps.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                  </Select>
                  <span className="text-xs text-muted-foreground">Detectado: {a.pan.programaOrcamentario ?? "—"}</span>
                </div>
              )}

              {a.pan.isTurnKey && peseDb && (
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-4">
                  <div className="flex items-center gap-2"><Wrench className="h-4 w-4 text-primary" /><span className="text-sm font-medium text-primary">Verificação PESE (Turn Key)</span></div>
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-sm text-muted-foreground">Código PESE:</span>
                    <Select value={a.pese?.peseCodeResolved ?? ""} onValueChange={onPeseCodeChange}>
                      <SelectTrigger className="w-64 h-8"><SelectValue placeholder="Selecione o código PESE" /></SelectTrigger>
                      <SelectContent>{peseDb.peseCodes.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                    </Select>
                    <span className="text-xs text-muted-foreground">Detectado: {a.pan.peseCode ?? "—"}</span>
                  </div>
                  {a.pese?.peseCodeResolved && a.pese.peseByYear.length > 0 && (
                    <div className="rounded-lg border border-border bg-surface overflow-hidden">
                      <div className="px-4 py-2.5 border-b border-border/60 flex items-center justify-between">
                        <div className="text-sm font-medium">Orçamento PESE por ano</div>
                        <div className="text-xs text-muted-foreground">{a.pese.peseCodeResolved}</div>
                      </div>
                      <div className="overflow-x-auto scrollbar-thin">
                        <table className="w-full text-sm">
                          <thead className="bg-primary/10 text-xs uppercase tracking-wider text-primary/80 sticky top-0">
                            <tr><th className="text-left px-4 py-2.5 font-semibold">Ano</th><th className="text-right px-4 py-2.5 font-semibold">PAN</th><th className="text-right px-4 py-2.5 font-semibold">PESE</th><th className="text-right px-4 py-2.5 font-semibold">Diferença</th><th className="text-center px-4 py-2.5 font-semibold">Status</th></tr>
                          </thead>
                          <tbody>
                            {a.pese.peseByYear.map((y, idx) => {
                              const noBudget = y.requested > 0 && y.available === 0;
                              return (
                                <tr key={y.year} className={`border-t border-border/40 transition-colors ${noBudget ? "bg-status-warn/5" : idx % 2 === 1 ? "bg-muted/20" : ""}`}>
                                  <td className="px-4 py-2.5 font-medium">{y.year}</td>
                                  <td className="px-4 py-2.5 text-right tabular-nums">{fmtBRL(y.requested)}</td>
                                  <td className={`px-4 py-2.5 text-right tabular-nums ${noBudget ? "text-status-warn font-medium" : ""}`}>{noBudget ? "Sem orçamento" : fmtBRL(y.available)}</td>
                                  <td className={`px-4 py-2.5 text-right font-medium tabular-nums ${y.ok ? "text-status-ok" : "text-status-warn"}`}>{y.diff >= 0 ? "+" : ""}{fmtBRL(y.diff)}</td>
                                  <td className="px-4 py-2.5 text-center"><span className={`inline-block h-2 w-2 rounded-full ${y.ok ? "bg-status-ok" : "bg-status-warn"}`} /></td>
                                </tr>
                              );
                            })}
                            <tr className="border-t-2 border-border bg-primary/5 font-semibold">
                              <td className="px-4 py-2.5">Total</td>
                              <td className="px-4 py-2.5 text-right tabular-nums">{fmtBRL(a.pese.peseTotal.requested)}</td>
                              <td className="px-4 py-2.5 text-right tabular-nums">{fmtBRL(a.pese.peseTotal.available)}</td>
                              <td className={`px-4 py-2.5 text-right tabular-nums ${a.pese.peseTotal.ok ? "text-status-ok" : "text-status-warn"}`}>{a.pese.peseTotal.diff >= 0 ? "+" : ""}{fmtBRL(a.pese.peseTotal.diff)}</td>
                              <td />
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                  {a.pese?.peseCodeResolved && (() => {
                    const missingYears = a.pese!.peseByYear.filter((y) => y.requested > 0 && y.available === 0).map((y) => y.year);
                    return (
                      <div className={`rounded-lg border p-3 text-sm ${a.pese!.peseTotal.ok ? "border-status-ok/30 bg-status-ok/10" : "border-status-warn/30 bg-status-warn/10"}`}>
                        <div className="flex items-start gap-2">
                          {a.pese!.peseTotal.ok ? <CheckCircle2 className="h-4 w-4 text-status-ok mt-0.5 shrink-0" /> : <AlertTriangle className="h-4 w-4 text-status-warn mt-0.5 shrink-0" />}
                          <div>
                            {a.pese!.peseTotal.ok
                              ? <span className="text-status-ok font-medium">PESE aprovado - orçamento suficiente</span>
                              : missingYears.length > 0
                                ? <span className="text-status-warn font-medium">Sem orçamento PESE para {missingYears.join(", ")}</span>
                                : <span className="text-status-warn font-medium">PESE com déficit de {fmtBRL(-a.pese!.peseTotal.diff)}</span>
                            }
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              {!a.pan.isTurnKey && a.years.length > 0 && (
                <div className="rounded-lg border border-border bg-surface overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-border/60 flex items-center justify-between">
                    <div className="text-sm font-medium">Detalhamento por ano</div>
                    <div className="text-xs text-muted-foreground">TP {tp || "—"}</div>
                  </div>
                  <div className="overflow-x-auto scrollbar-thin">
                    <table className="w-full text-sm">
                      <thead className="bg-primary/10 text-xs uppercase tracking-wider text-primary/80 sticky top-0">
                        <tr><th className="text-left px-4 py-2.5 font-semibold">Ano</th><th className="text-right px-4 py-2.5 font-semibold">PAN</th><th className="text-right px-4 py-2.5 font-semibold">Orçamento</th><th className="text-right px-4 py-2.5 font-semibold">Diferença</th><th className="text-center px-4 py-2.5 font-semibold">Status</th></tr>
                      </thead>
                      <tbody>
                        {a.yearTotals.map((y, idx) => (
                          <tr key={y.year} className={`border-t border-border/40 transition-colors ${idx % 2 === 1 ? "bg-muted/20" : ""}`}>
                            <td className="px-4 py-2.5 font-medium">{y.year}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums">{fmtBRL(y.requested)}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums">{fmtBRL(y.available)}</td>
                            <td className={`px-4 py-2.5 text-right font-medium tabular-nums ${y.ok ? "text-status-ok" : "text-status-warn"}`}>{y.diff >= 0 ? "+" : ""}{fmtBRL(y.diff)}</td>
                            <td className="px-4 py-2.5 text-center"><span className={`inline-block h-2 w-2 rounded-full ${y.ok ? "bg-status-ok" : "bg-status-warn"}`} /></td>
                          </tr>
                        ))}
                        <tr className="border-t-2 border-border bg-primary/5 font-semibold">
                          <td className="px-4 py-2.5">Total</td>
                          <td className="px-4 py-2.5 text-right tabular-nums">{fmtBRL(a.totalRequested)}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums">{fmtBRL(a.totalAvailable)}</td>
                          <td className={`px-4 py-2.5 text-right tabular-nums ${a.totalAvailable - a.totalRequested >= 0 ? "text-status-ok" : "text-status-warn"}`}>{a.totalAvailable - a.totalRequested >= 0 ? "+" : ""}{fmtBRL(a.totalAvailable - a.totalRequested)}</td>
                          <td />
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {a.pan.historico && <HistoricoPanel text={a.pan.historico} />}

              {!a.pan.isTurnKey && (
                <div className="space-y-2">
                  {a.rows.map((r) => {
                    const tone = !r.empresaCode ? "border-border bg-surface" : r.ok ? "border-status-ok/30 bg-status-ok/5" : "border-status-warn/30 bg-status-warn/5";
                    const action = !r.empresaCode ? "Selecione a empresa correspondente na base" : r.ok ? `Liberar PAN. Sobra ${fmtBRL(r.diff)} no orçamento.` : `Falta ${fmtBRL(-r.diff)}. Recomenda-se remanejar saldo de outra empresa ou revisar fluxo de caixa.`;
                    return (
                      <div key={r.empresaPan} className={`rounded-lg border p-4 ${tone}`}>
                        <div className="flex items-start justify-between gap-4 flex-wrap">
                          <div className="flex-1 min-w-0">
                            <div className="font-medium">{r.empresaPan}</div>
                            <div className="text-xs text-muted-foreground mt-0.5">{action}</div>
                          </div>
                          <div className="flex items-center gap-4">
                            <div className="text-right text-sm"><div className="text-xs text-muted-foreground">Pedido</div><div className="tabular-nums">{fmtBRL(r.requested)}</div></div>
                            <div className="text-right text-sm"><div className="text-xs text-muted-foreground">Disponível</div><div className="tabular-nums">{fmtBRL(r.available)}</div></div>
                            <div className="text-right text-sm"><div className="text-xs text-muted-foreground">Diferença</div><div className={`tabular-nums ${r.ok ? "text-status-ok font-medium" : "text-status-warn font-medium"}`}>{r.diff >= 0 ? "+" : ""}{fmtBRL(r.diff)}</div></div>
                            <Select value={r.empresaCode ?? ""} onValueChange={(v) => onEmpresaChange(r.empresaPan, v)}>
                              <SelectTrigger className="w-32 h-8"><SelectValue placeholder="Código" /></SelectTrigger>
                              <SelectContent>{db.empresas.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}</SelectContent>
                            </Select>
                          </div>
                        </div>
                        {r.empresaCode && r.available > 0 && (
                          <div className="mt-3 h-1.5 w-full rounded-full bg-muted overflow-hidden">
                            <div className={`h-full ${r.ok ? "bg-status-ok" : "bg-status-warn"}`} style={{ width: `${Math.min(100, (r.requested / r.available) * 100)}%` }} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {!a.pan.isTurnKey && a.status === "warn" && worst && (
                <div className="rounded-lg border border-status-warn/30 bg-status-warn/10 p-4 text-sm">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="h-4 w-4 text-status-warn mt-0.5 shrink-0" />
                    <div>
                      <div className="font-medium text-status-warn">Recomendação</div>
                      <div className="text-foreground/80 mt-1">Maior gap em <b>{worst.empresaPan}</b>: faltam <b>{fmtBRL(-worst.diff)}</b>. Avalie remanejamento entre empresas (contrato permite), ajustar o fluxo de caixa anual ou solicitar suplementação no TP <b>{tp}</b>.</div>
                    </div>
                  </div>
                </div>
              )}
              {!a.pan.isTurnKey && a.status === "ok" && (
                <div className="rounded-lg border border-status-ok/30 bg-status-ok/10 p-4 text-sm">
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="h-4 w-4 text-status-ok mt-0.5 shrink-0" />
                    <div>
                      <div className="font-medium text-status-ok">PAN aprovada pelo orçamento</div>
                      <div className="text-foreground/80 mt-1">Todas as empresas têm saldo suficiente no TP <b>{tp}</b> para os anos do fluxo de caixa.</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}

function HistoricoPanel({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-border bg-surface overflow-hidden">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-muted/30 transition-colors text-left">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Escopo e histórico de contratação</span>
          <Badge variant="outline" className="text-[10px]">Resumo PAN</Badge>
        </div>
        {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden border-t border-border/60">
            <div className="px-4 py-3 text-sm text-foreground/80 leading-relaxed whitespace-pre-line">{text}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function YearDetailCard({ year, empresaPan, empresaCode, empresaValor, tp }: { year: YearCell; empresaPan: string; empresaCode: string; empresaValor: number; tp: string }) {
  const [showCalc, setShowCalc] = useState(false);
  const toneClass = year.requested === 0 ? "border-border bg-surface/60" : year.ok ? "border-status-ok/40 bg-status-ok/10" : "border-status-warn/40 bg-status-warn/10";
  const dotClass = year.requested === 0 ? "bg-muted-foreground/40" : year.ok ? "bg-status-ok" : "bg-status-warn";

  return (
    <div className={`rounded-lg border-2 p-4 cursor-pointer transition-all hover:shadow-md ${toneClass}`} onClick={() => setShowCalc(!showCalc)}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-lg font-bold">{year.year}</span>
        <span className={`h-3 w-3 rounded-full ${dotClass}`} />
      </div>
      <div className="space-y-2">
        <div className="flex justify-between items-center"><span className="text-sm text-muted-foreground">Orçamento</span><span className="text-sm font-semibold tabular-nums">{fmtBRL(year.available)}</span></div>
        <div className="flex justify-between items-center"><span className="text-sm text-muted-foreground">Diferença</span><span className={`text-sm font-bold tabular-nums ${year.ok ? "text-status-ok" : "text-status-warn"}`}>{year.diff >= 0 ? "+" : ""}{fmtBRL(year.diff)}</span></div>
      </div>
      <AnimatePresence>
        {showCalc && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="mt-4 pt-3 border-t border-border/60 text-xs space-y-2">
              <div className="font-semibold text-muted-foreground uppercase tracking-wide">Cálculo</div>
              <div className="space-y-1 text-muted-foreground">
                <div><span className="font-medium">Empresa:</span> {empresaPan}</div>
                <div><span className="font-medium">Código:</span> {empresaCode}</div>
                <div><span className="font-medium">TP:</span> {tp || "—"}</div>
                <div className="pt-2 border-t border-border/40"><span className="font-medium">Orçamento {year.year}:</span><div className="pl-2 mt-1">Base orçamento = {fmtBRL(year.available)}</div></div>
                <div className="pt-2 border-t border-border/40"><span className="font-medium">Resultado:</span><div className="pl-2 mt-1">{fmtBRL(year.available)} - {fmtBRL(year.requested)} = <span className={year.ok ? "text-status-ok font-semibold" : "text-status-warn font-semibold"}>{fmtBRL(year.diff)}</span></div></div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="mt-3 text-[10px] text-center text-muted-foreground">{showCalc ? "Clique para fechar" : "Clique para ver cálculo"}</div>
    </div>
  );
}
