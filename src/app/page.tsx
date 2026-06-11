"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Upload,
  FileText,
  CheckCircle2,
  AlertTriangle,
  TrendingUp,
  Database,
  Loader2,
  X,
  Sparkles,
  ChevronDown,
  ChevronRight,
  Wrench,
  Download,
  CheckSquare,
  Square,
  LayoutDashboard,
  FolderOpen,
  Settings,
  HelpCircle,
  Bell,
  Search,
  Menu,
  BarChart3,
  Shield,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
        const peseByYear: YearCell[] = years.map((y) => {
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
      };
    });
  }, [pans, db, cnpj, peseDb, overrides]);

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
      const headerStyleDarkBlue = {
        fill: { fgColor: { rgb: "0E2841" } },
        font: { color: { rgb: "FFFFFF" }, bold: true, sz: 11 },
        alignment: { horizontal: "center", vertical: "center", wrapText: true },
        border: {
          top: { style: "thin", color: { rgb: "000000" } },
          bottom: { style: "thin", color: { rgb: "000000" } },
          left: { style: "thin", color: { rgb: "000000" } },
          right: { style: "thin", color: { rgb: "000000" } },
        },
      };
      const headerStyleLightBlue = { ...headerStyleDarkBlue, fill: { fgColor: { rgb: "00B0F0" } } };
      const headerStyleGreen = { ...headerStyleDarkBlue, fill: { fgColor: { rgb: "00B050" } } };
      const headerStyleOrange = { ...headerStyleDarkBlue, fill: { fgColor: { rgb: "FFC000" } } };
      const dataStyleBase = {
        font: { sz: 11 },
        alignment: { vertical: "center" },
        border: {
          top: { style: "thin", color: { rgb: "D0D0D0" } },
          bottom: { style: "thin", color: { rgb: "D0D0D0" } },
          left: { style: "thin", color: { rgb: "D0D0D0" } },
          right: { style: "thin", color: { rgb: "D0D0D0" } },
        },
      };
      const dataStyleCurrency = { ...dataStyleBase, numFmt: "#,##0", alignment: { ...dataStyleBase.alignment, horizontal: "right" } };
      const dataStylePercent = { ...dataStyleBase, numFmt: "0%", alignment: { ...dataStyleBase.alignment, horizontal: "right" } };
      const dataStyleStatus = { ...dataStyleBase, fill: { fgColor: { rgb: "FFFF00" } }, font: { sz: 11, bold: true } };
      const header = [
        "Categoria", "PAN", "Nome", "Total PAN p/ 2026", "Total PAN p/ 2027-2030", "Total geral PAN", "",
        "BAR/BRR", "Linha Orçamento", "Orç p/2026", "Orç p/2027-2030", "TOTAL Geral orç. 2026-2030", "",
        "∆ PAN vs Orçado 2026", "∆ PAN vs Orçado 2027-2030", "TOTAL Geral ∆", "",
        "% Variação 2026", "% Variação 2027-2030", "% Variação Geral", "Status",
      ];
      const dataRows: (string | number | null)[][] = [];
      for (const a of selectedPans) {
        const categoria = a.pan.isTurnKey ? "TK" : (a.rows[0]?.empresaCode?.startsWith("D") ? "BRR" : "Outros");
        const panNumber = a.pan.panNumber ?? "—";
        const nome = a.pan.titulo ?? a.pan.fileName;
        const pan2026 = a.pan.fluxoCaixa.find((f) => f.ano === 2026)?.valor ?? 0;
        const pan2027_2030 = a.pan.fluxoCaixa.filter((f) => f.ano >= 2027 && f.ano <= 2030).reduce((sum, f) => sum + f.valor, 0);
        const panTotal = pan2026 + pan2027_2030;
        const capex = (a.pan.percentualCapex ?? 100) / 100;
        const panCapex2026 = pan2026 * capex;
        const panCapex2027_2030 = pan2027_2030 * capex;
        const panCapexTotal = panTotal * capex;
        const barBrr = a.pan.isTurnKey ? "PESE" : (a.rows[0]?.empresaCode ?? "—");
        const linhaOrc = a.pan.isTurnKey && a.pese?.peseCodeResolved ? a.pese.peseCodeResolved : (a.tpResolved ?? "—");
        let orc2026 = 0;
        let orc2027_2030 = 0;
        if (a.pan.isTurnKey && a.pese) {
          orc2026 = a.pese.peseByYear.find((y) => y.year === "2026")?.available ?? 0;
          orc2027_2030 = a.pese.peseByYear.filter((y) => parseInt(y.year) >= 2027 && parseInt(y.year) <= 2030).reduce((sum, y) => sum + y.available, 0);
        } else {
          orc2026 = a.yearTotals.find((y) => y.year === "2026")?.available ?? 0;
          orc2027_2030 = a.yearTotals.filter((y) => parseInt(y.year) >= 2027 && parseInt(y.year) <= 2030).reduce((sum, y) => sum + y.available, 0);
        }
        const orcTotal = orc2026 + orc2027_2030;
        const delta2026 = orc2026 - panCapex2026;
        const delta2027_2030 = orc2027_2030 - panCapex2027_2030;
        const deltaTotal = orcTotal - panCapexTotal;
        const pct2026 = orc2026 > 0 ? delta2026 / orc2026 : 0;
        const pct2027_2030 = orc2027_2030 > 0 ? delta2027_2030 / orc2027_2030 : 0;
        const pctTotal = orcTotal > 0 ? deltaTotal / orcTotal : 0;
        dataRows.push([categoria, panNumber, nome, panCapex2026, panCapex2027_2030, panCapexTotal, null, barBrr, linhaOrc, orc2026, orc2027_2030, orcTotal, null, delta2026, delta2027_2030, deltaTotal, null, pct2026, pct2027_2030, pctTotal, null]);
      }
      const wb = XLSX.utils.book_new();
      const ws: XLSX.WorkSheet = {};
      const headerStyles = [
        headerStyleDarkBlue, headerStyleDarkBlue, headerStyleDarkBlue, headerStyleDarkBlue, headerStyleDarkBlue, headerStyleDarkBlue, {},
        headerStyleDarkBlue, headerStyleDarkBlue, headerStyleLightBlue, headerStyleLightBlue, headerStyleLightBlue, {},
        headerStyleGreen, headerStyleGreen, headerStyleGreen, {},
        headerStyleOrange, headerStyleOrange, headerStyleOrange, headerStyleDarkBlue,
      ];
      header.forEach((val, col) => {
        const cellRef = XLSX.utils.encode_cell({ r: 0, c: col });
        ws[cellRef] = { v: val, t: "s", s: headerStyles[col] };
      });
      const getDataStyle = (col: number) => {
        if ([3, 4, 5, 9, 10, 11, 13, 14, 15].includes(col)) return dataStyleCurrency;
        if ([17, 18, 19].includes(col)) return dataStylePercent;
        if (col === 20) return dataStyleStatus;
        if ([6, 12, 16].includes(col)) return {};
        return dataStyleBase;
      };
      dataRows.forEach((row, rowIdx) => {
        row.forEach((val, col) => {
          const cellRef = XLSX.utils.encode_cell({ r: rowIdx + 1, c: col });
          const style = getDataStyle(col);
          if (col === 20) {
            const a = selectedPans[rowIdx];
            const statusMsg = a.status === "ok" ? "Aprovado" : a.status === "warn" ? "Atenção" : "Revisar";
            ws[cellRef] = { v: statusMsg, t: "s", s: style };
          } else if (val === null || val === "") {
            ws[cellRef] = { v: "", t: "s", s: style };
          } else if (typeof val === "number") {
            ws[cellRef] = { v: val, t: "n", s: style };
          } else {
            ws[cellRef] = { v: val, t: "s", s: style };
          }
        });
      });
      ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: dataRows.length, c: header.length - 1 } });
      ws["!cols"] = [
        { wch: 12 }, { wch: 12 }, { wch: 70 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 2 },
        { wch: 12 }, { wch: 35 }, { wch: 16 }, { wch: 18 }, { wch: 18 }, { wch: 2 },
        { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 2 },
        { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 12 },
      ];
      ws["!rows"] = [{ hpx: 35 }];
      for (let i = 0; i < dataRows.length; i++) ws["!rows"].push({ hpx: 28 });
      const today = new Date();
      const sheetName = `${today.getDate().toString().padStart(2, "0")}.${(today.getMonth() + 1).toString().padStart(2, "0")}`;
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
      const fileName = `Resumo_PAN_${today.getFullYear()}_${sheetName.replace(".", "-")}.xlsx`;
      XLSX.writeFile(wb, fileName);
    } catch (e) {
      setError("Erro ao exportar: " + (e as Error).message);
    } finally {
      setExporting(false);
    }
  };

  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <div className="min-h-screen bg-canvas flex">
      <aside className={`${sidebarOpen ? "w-64" : "w-20"} bg-surface border-r border-border/60 flex flex-col transition-all duration-300 fixed h-full z-40`}>
        <div className="p-4 border-b border-border/60">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-brand grid place-items-center shadow-glow shrink-0">
              <Shield className="h-5 w-5 text-primary-foreground" />
            </div>
            {sidebarOpen && (
              <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="overflow-hidden">
                <div className="font-bold text-lg tracking-tight">Ajudante das PAN</div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider">beta</div>
              </motion.div>
            )}
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          <SidebarItem icon={<LayoutDashboard />} label="Dashboard" active sidebarOpen={sidebarOpen} />
          <SidebarItem icon={<FolderOpen />} label="PANs" badge={analyzed.length > 0 ? String(analyzed.length) : undefined} sidebarOpen={sidebarOpen} />
          <SidebarItem icon={<BarChart3 />} label="Relatórios" sidebarOpen={sidebarOpen} />
          <SidebarItem icon={<Database />} label="Base de Dados" sidebarOpen={sidebarOpen} />
        </nav>
        <div className="p-3 border-t border-border/60 space-y-1">
          <SidebarItem icon={<Settings />} label="Configurações" sidebarOpen={sidebarOpen} />
          <SidebarItem icon={<HelpCircle />} label="Ajuda" sidebarOpen={sidebarOpen} />
        </div>
        {sidebarOpen && (
          <div className="p-4 border-t border-border/60">
            <div className="rounded-lg bg-muted/50 p-3">
              <div className="flex items-center gap-2 text-xs">
                <div className={`h-2 w-2 rounded-full ${db && cnpj && peseDb ? "bg-status-ok animate-pulse" : "bg-muted-foreground"}`} />
                <span className="text-muted-foreground">
                  {loadingBase ? "Carregando..." : db && cnpj && peseDb ? "Sistema operacional" : "Erro na base"}
                </span>
              </div>
              {db && cnpj && peseDb && (
                <div className="mt-2 text-[10px] text-muted-foreground space-y-0.5">
                  <div>{db.rows.length.toLocaleString()} linhas orçamento</div>
                  <div>{cnpj.length} empresas CNPJ</div>
                  <div>{peseDb.peseCodes.length} códigos PESE</div>
                </div>
              )}
            </div>
          </div>
        )}
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="absolute -right-3 top-20 h-6 w-6 rounded-full bg-surface border border-border shadow-sm grid place-items-center hover:bg-muted transition-colors"
        >
          <ChevronRight className={`h-3 w-3 text-muted-foreground transition-transform ${sidebarOpen ? "rotate-180" : ""}`} />
        </button>
      </aside>

      <div className={`flex-1 ${sidebarOpen ? "ml-64" : "ml-20"} transition-all duration-300`}>
        <header className="h-16 border-b border-border/60 bg-surface/80 backdrop-blur-xl sticky top-0 z-30 px-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={() => setSidebarOpen(!sidebarOpen)} className="p-2 rounded-lg hover:bg-muted transition-colors lg:hidden">
              <Menu className="h-5 w-5" />
            </button>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Buscar PANs..."
                className="h-9 w-64 rounded-lg border border-border bg-muted/30 pl-9 pr-4 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50 transition-all"
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <button className="relative p-2 rounded-lg hover:bg-muted transition-colors">
              <Bell className="h-5 w-5 text-muted-foreground" />
              {analyzed.filter((a) => a.status === "warn").length > 0 && (
                <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-status-warn" />
              )}
            </button>
            <div className="h-8 w-px bg-border" />
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-full bg-gradient-brand grid place-items-center text-xs font-bold text-white">U</div>
              <div className="hidden sm:block">
                <div className="text-sm font-medium">Usuário</div>
                <div className="text-xs text-muted-foreground">Analista</div>
              </div>
            </div>
          </div>
        </header>

        <main className="p-6 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
              <p className="text-sm text-muted-foreground mt-1">Análise e verificação de PANs contra orçamento aprovado</p>
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
            <StatCard label="PANs analisadas" value={String(summary.count)} icon={<FileText className="h-5 w-5" />} />
            <StatCard label="Aprovadas" value={String(summary.ok)} accent="ok" icon={<CheckCircle2 className="h-5 w-5" />} />
            <StatCard label="Atenção" value={String(summary.warn + summary.unknown)} accent="warn" icon={<AlertTriangle className="h-5 w-5" />} />
            <StatCard label="Total solicitado" value={fmtBRL(summary.totalReq)} icon={<TrendingUp className="h-5 w-5" />} />
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

          {analyzed.length > 0 && (
            <section className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">PANs em análise</h3>
                <span className="text-sm text-muted-foreground">{analyzed.length} documento{analyzed.length > 1 ? "s" : ""}</span>
              </div>
              <div className="space-y-3">
                <AnimatePresence initial={false}>
                  {analyzed.map((a, i) => (
                    <motion.div key={a.pan.fileName + i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ delay: i * 0.03 }}>
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
                      />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </section>
          )}

          {analyzed.length === 0 && !processing && (
            <Card className="p-12 text-center border-dashed">
              <div className="mx-auto h-16 w-16 rounded-2xl bg-muted grid place-items-center mb-4">
                <FolderOpen className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-semibold">Nenhuma PAN analisada</h3>
              <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
                Faça upload de arquivos PDF de PANs para começar a análise contra o orçamento aprovado.
              </p>
              <Button variant="outline" className="gap-2 mt-4" onClick={() => document.getElementById("upload-pan")?.click()}>
                <Upload className="h-4 w-4" />
                Selecionar arquivos
              </Button>
            </Card>
          )}
        </main>
      </div>
    </div>
  );
}

function SidebarItem({ icon, label, active, badge, sidebarOpen }: { icon: React.ReactNode; label: string; active?: boolean; badge?: string; sidebarOpen: boolean }) {
  return (
    <button className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all ${active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>
      <span className="shrink-0 [&>svg]:h-5 [&>svg]:w-5">{icon}</span>
      {sidebarOpen && (
        <>
          <span className="flex-1 text-left text-sm font-medium">{label}</span>
          {badge && <Badge variant="secondary" className="h-5 px-1.5 text-xs">{badge}</Badge>}
        </>
      )}
    </button>
  );
}

function StatCard({ label, value, icon, accent }: { label: string; value: string; icon: React.ReactNode; accent?: "ok" | "warn" }) {
  const tone = accent === "ok" ? "text-status-ok bg-status-ok/10" : accent === "warn" ? "text-status-warn bg-status-warn/10" : "text-primary bg-primary/10";
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
          <div className="mt-1 text-2xl font-semibold tracking-tight">{value}</div>
        </div>
        <div className={`h-10 w-10 rounded-lg grid place-items-center ${tone}`}>{icon}</div>
      </div>
    </Card>
  );
}

function PanCard({ a, db, peseDb, expanded, isSelected, onToggle, onSelect, onRemove, onTpChange, onEmpresaChange, onPeseCodeChange }: {
  a: AnalyzedPan; db: BudgetDb; peseDb: PeseDb | null;
  expanded: boolean; isSelected: boolean;
  onToggle: () => void; onSelect: () => void; onRemove: () => void;
  onTpChange: (tp: string) => void; onEmpresaChange: (panName: string, code: string) => void; onPeseCodeChange: (peseCode: string) => void;
}) {
  const statusConfig = {
    ok: { label: "Dentro do orçamento", cls: "bg-status-ok/15 text-status-ok border-status-ok/30", dot: "bg-status-ok" },
    warn: { label: "Ação necessária", cls: "bg-status-warn/15 text-status-warn border-status-warn/30", dot: "bg-status-warn" },
    unknown: { label: "Revisar mapeamento", cls: "bg-muted text-muted-foreground border-border", dot: "bg-muted-foreground" },
  }[a.status];
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
              {a.pan.isTurnKey && <Badge variant="outline" className="text-xs border border-blue-500/30 bg-blue-500/15 text-blue-600"><Wrench className="h-3 w-3 mr-1" />Turn Key</Badge>}
              <Badge variant="outline" className={`text-xs border ${statusConfig.cls}`}>{statusConfig.label}</Badge>
            </div>
            <div className="text-sm text-muted-foreground truncate mt-0.5">{a.pan.titulo}</div>
          </div>
          <div className="hidden md:flex items-center gap-6 text-sm">
            <div className="text-right"><div className="text-xs text-muted-foreground">Solicitado</div><div className="font-medium">{fmtBRL(a.totalRequested)}</div></div>
            <div className="text-right"><div className="text-xs text-muted-foreground">Disponível</div><div className="font-medium">{fmtBRL(a.totalAvailable)}</div></div>
          </div>
        </button>
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
                <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-4 space-y-4">
                  <div className="flex items-center gap-2"><Wrench className="h-4 w-4 text-blue-600" /><span className="text-sm font-medium text-blue-600">Verificação PESE (Turn Key)</span></div>
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
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                            <tr><th className="text-left px-4 py-2 font-medium">Ano</th><th className="text-right px-4 py-2 font-medium">PAN</th><th className="text-right px-4 py-2 font-medium">PESE</th><th className="text-right px-4 py-2 font-medium">Diferença</th><th className="text-center px-4 py-2 font-medium">Status</th></tr>
                          </thead>
                          <tbody>
                            {a.pese.peseByYear.map((y) => (
                              <tr key={y.year} className="border-t border-border/40">
                                <td className="px-4 py-2 font-medium">{y.year}</td>
                                <td className="px-4 py-2 text-right">{fmtBRL(y.requested)}</td>
                                <td className="px-4 py-2 text-right">{fmtBRL(y.available)}</td>
                                <td className={`px-4 py-2 text-right font-medium ${y.ok ? "text-status-ok" : "text-status-warn"}`}>{y.diff >= 0 ? "+" : ""}{fmtBRL(y.diff)}</td>
                                <td className="px-4 py-2 text-center"><span className={`inline-block h-2 w-2 rounded-full ${y.ok ? "bg-status-ok" : "bg-status-warn"}`} /></td>
                              </tr>
                            ))}
                            <tr className="border-t border-border bg-muted/20 font-semibold">
                              <td className="px-4 py-2">Total</td>
                              <td className="px-4 py-2 text-right">{fmtBRL(a.pese.peseTotal.requested)}</td>
                              <td className="px-4 py-2 text-right">{fmtBRL(a.pese.peseTotal.available)}</td>
                              <td className={`px-4 py-2 text-right ${a.pese.peseTotal.ok ? "text-status-ok" : "text-status-warn"}`}>{a.pese.peseTotal.diff >= 0 ? "+" : ""}{fmtBRL(a.pese.peseTotal.diff)}</td>
                              <td />
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                  {a.pese?.peseCodeResolved && (
                    <div className={`rounded-lg border p-3 text-sm ${a.pese.peseTotal.ok ? "border-status-ok/30 bg-status-ok/10" : "border-status-warn/30 bg-status-warn/10"}`}>
                      <div className="flex items-start gap-2">
                        {a.pese.peseTotal.ok ? <CheckCircle2 className="h-4 w-4 text-status-ok mt-0.5 shrink-0" /> : <AlertTriangle className="h-4 w-4 text-status-warn mt-0.5 shrink-0" />}
                        <div>
                          {a.pese.peseTotal.ok ? <span className="text-status-ok font-medium">PESE aprovado - orçamento suficiente</span> : <span className="text-status-warn font-medium">PESE com déficit de {fmtBRL(-a.pese.peseTotal.diff)}</span>}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {!a.pan.isTurnKey && a.years.length > 0 && (
                <div className="rounded-lg border border-border bg-surface overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-border/60 flex items-center justify-between">
                    <div className="text-sm font-medium">Detalhamento por ano</div>
                    <div className="text-xs text-muted-foreground">TP {tp || "—"}</div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                        <tr><th className="text-left px-4 py-2 font-medium">Ano</th><th className="text-right px-4 py-2 font-medium">PAN</th><th className="text-right px-4 py-2 font-medium">Orçamento</th><th className="text-right px-4 py-2 font-medium">Diferença</th><th className="text-center px-4 py-2 font-medium">Status</th></tr>
                      </thead>
                      <tbody>
                        {a.yearTotals.map((y) => (
                          <tr key={y.year} className="border-t border-border/40">
                            <td className="px-4 py-2 font-medium">{y.year}</td>
                            <td className="px-4 py-2 text-right">{fmtBRL(y.requested)}</td>
                            <td className="px-4 py-2 text-right">{fmtBRL(y.available)}</td>
                            <td className={`px-4 py-2 text-right font-medium ${y.ok ? "text-status-ok" : "text-status-warn"}`}>{y.diff >= 0 ? "+" : ""}{fmtBRL(y.diff)}</td>
                            <td className="px-4 py-2 text-center"><span className={`inline-block h-2 w-2 rounded-full ${y.ok ? "bg-status-ok" : "bg-status-warn"}`} /></td>
                          </tr>
                        ))}
                        <tr className="border-t border-border bg-muted/20 font-semibold">
                          <td className="px-4 py-2">Total</td>
                          <td className="px-4 py-2 text-right">{fmtBRL(a.totalRequested)}</td>
                          <td className="px-4 py-2 text-right">{fmtBRL(a.totalAvailable)}</td>
                          <td className={`px-4 py-2 text-right ${a.totalAvailable - a.totalRequested >= 0 ? "text-status-ok" : "text-status-warn"}`}>{a.totalAvailable - a.totalRequested >= 0 ? "+" : ""}{fmtBRL(a.totalAvailable - a.totalRequested)}</td>
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
                            <div className="text-right text-sm"><div className="text-xs text-muted-foreground">Pedido</div><div>{fmtBRL(r.requested)}</div></div>
                            <div className="text-right text-sm"><div className="text-xs text-muted-foreground">Disponível</div><div>{fmtBRL(r.available)}</div></div>
                            <div className="text-right text-sm"><div className="text-xs text-muted-foreground">Diferença</div><div className={r.ok ? "text-status-ok font-medium" : "text-status-warn font-medium"}>{r.diff >= 0 ? "+" : ""}{fmtBRL(r.diff)}</div></div>
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
                        {r.empresaCode && r.byYear.length > 0 && (
                          <div className="mt-4 grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.min(r.byYear.length, 5)}, minmax(0, 1fr))` }}>
                            {r.byYear.map((y) => <YearDetailCard key={y.year} year={y} empresaPan={r.empresaPan} empresaCode={r.empresaCode!} empresaValor={r.requested} tp={tp} />)}
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
        <div className="flex justify-between items-center"><span className="text-sm text-muted-foreground">Orçamento</span><span className="text-sm font-semibold">{fmtBRL(year.available)}</span></div>
        <div className="flex justify-between items-center"><span className="text-sm text-muted-foreground">Diferença</span><span className={`text-sm font-bold ${year.ok ? "text-status-ok" : "text-status-warn"}`}>{year.diff >= 0 ? "+" : ""}{fmtBRL(year.diff)}</span></div>
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
