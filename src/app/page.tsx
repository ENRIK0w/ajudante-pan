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
  CheckSquare,
  GripVertical,
  HelpCircle,
  Monitor,
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
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import {
  loadBudgetFromUrl,
  loadCnpjFromUrl,
  loadPeseFromUrl,
  loadTiFromUrl,
  type BudgetDb,
  type CnpjEntry,
  type PeseDb,
  type TiDb,
} from "@/lib/budget-parser";
import { analyzePans, type AnalyzedPan, type Overrides, type StatusOverride } from "@/lib/analyze";
import {
  EXPORT_COLUMNS,
  SEPARATOR_COLS,
  CURRENCY_COLS,
  PERCENT_COLS,
  STATUS_COL,
  xlsxHeaderStyle,
  xlsxDataStyle,
  statusFill,
  buildRow,
} from "@/lib/export-schema";
import { mergeStyle, cellKey, HEADER_ROW, type FormatMap } from "@/lib/cell-format";
import { orderedApproved, allFileNames, reorderTray } from "@/lib/export-tray";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  type DragEndEvent,
} from "@dnd-kit/core";
import { ExportDock } from "@/components/export/export-dock";
import XLSX from "xlsx-js-style";

const fmtBRL = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

function Num({ v, tip, className }: { v: string; tip: React.ReactNode; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={`cursor-help underline decoration-dotted decoration-muted-foreground/30 underline-offset-2 ${className ?? ""}`}
        >
          {v}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-64 leading-relaxed whitespace-pre-line">
        {tip}
      </TooltipContent>
    </Tooltip>
  );
}

export default function Page() {
  const [db, setDb] = useState<BudgetDb | null>(null);
  const [cnpj, setCnpj] = useState<CnpjEntry[] | null>(null);
  const [peseDb, setPeseDb] = useState<PeseDb | null>(null);
  const [loadingBase, setLoadingBase] = useState(true);
  const [pans, setPans] = useState<PanData[]>([]);
  const [tiDb, setTiDb] = useState<TiDb | null>(null);
  const [overrides, setOverrides] = useState<Record<string, Overrides>>({});
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [tray, setTray] = useState<string[]>([]);
  const [exporting, setExporting] = useState(false);
  const [statusOverrides, setStatusOverrides] = useState<Record<string, StatusOverride>>({});
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [b, c, p, t] = await Promise.all([
          loadBudgetFromUrl("/orcamento.xlsx"),
          loadCnpjFromUrl("/cnpj.xlsx"),
          loadPeseFromUrl("/base pese.xlsx"),
          loadTiFromUrl("/TI.xlsx"),
        ]);
        setDb(b);
        setCnpj(c);
        setPeseDb(p);
        setTiDb(t);
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
    return analyzePans(pans, { db, cnpj, peseDb, tiDb, overrides, statusOverrides });
  }, [pans, db, cnpj, peseDb, tiDb, overrides, statusOverrides]);

  useEffect(() => {
    const valid = new Set(analyzed.map((a) => a.pan.fileName));
    setTray((prev) => {
      const next = prev.filter((f) => valid.has(f));
      return next.length === prev.length ? prev : next;
    });
  }, [analyzed]);

  const summary = useMemo(() => {
    const effective = (a: AnalyzedPan) => a.manualStatus ?? a.status;
    const ok = analyzed.filter((a) => effective(a) === "ok" || effective(a) === "aprovado").length;
    const warn = analyzed.filter((a) => effective(a) === "warn").length;
    const unknown = analyzed.filter(
      (a) => effective(a) === "unknown" || effective(a) === "negado",
    ).length;
    const totalReq = analyzed.reduce((a, b) => a + b.totalRequested, 0);
    const totalAv = analyzed.reduce((a, b) => a + b.totalAvailable, 0);
    return { ok, warn, unknown, totalReq, totalAv, count: analyzed.length };
  }, [analyzed]);

  const toggleExpand = (k: string) => {
    const s = new Set(expanded);
    if (s.has(k)) s.delete(k);
    else s.add(k);
    setExpanded(s);
  };

  const toggleTray = (k: string) =>
    setTray((prev) => (prev.includes(k) ? prev.filter((f) => f !== k) : [...prev, k]));

  const addAllApproved = () =>
    setTray((prev) => {
      const approved = orderedApproved(analyzed);
      const merged = [...prev];
      for (const f of approved) if (!merged.includes(f)) merged.push(f);
      return merged;
    });

  const addAll = () =>
    setTray((prev) => {
      const merged = [...prev];
      for (const f of allFileNames(analyzed)) if (!merged.includes(f)) merged.push(f);
      return merged;
    });

  const clearTrayState = () => setTray([]);

  const orderedSelection = analyzed
    .filter((a) => tray.includes(a.pan.fileName))
    .sort((x, y) => tray.indexOf(x.pan.fileName) - tray.indexOf(y.pan.fileName));

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const handleDragEnd = (e: DragEndEvent) => {
    const activeId = String(e.active.id);
    const overId = e.over ? String(e.over.id) : null;
    if (!overId) return;
    if (!tray.includes(activeId)) {
      // A PAN card dragged into the dock — dropped on the container or on any chip.
      if (overId === "export-dock" || tray.includes(overId)) {
        setTray((prev) => (prev.includes(activeId) ? prev : [...prev, activeId]));
      }
      return;
    }
    // Reorder within the tray.
    if (overId !== activeId && tray.includes(overId)) {
      setTray((prev) => reorderTray(prev, prev.indexOf(activeId), prev.indexOf(overId)));
    }
  };

  const exportToExcel = async (ordered: AnalyzedPan[], formatMap: FormatMap = {}) => {
    if (ordered.length === 0) return;
    setExporting(true);
    try {
      const wb = XLSX.utils.book_new();
      const ws: XLSX.WorkSheet = {};

      // Header row
      EXPORT_COLUMNS.forEach((col) => {
        const ref = XLSX.utils.encode_cell({ r: 0, c: col.index });
        const base = xlsxHeaderStyle(col.fill);
        const s = mergeStyle(base, formatMap[cellKey(HEADER_ROW, col.index)]);
        ws[ref] = { v: col.header, t: col.header === "" ? "z" : "s", s };
      });

      // Data rows
      ordered.forEach((a, rowIdx) => {
        const values = buildRow(a);
        EXPORT_COLUMNS.forEach((col) => {
          const c = col.index;
          const val = values[c];
          const ref = XLSX.utils.encode_cell({ r: rowIdx + 1, c });
          const ov = formatMap[cellKey(a.pan.fileName, c)];

          if (SEPARATOR_COLS.has(c)) {
            ws[ref] = { v: "", t: "z", s: {} };
          } else if (c === STATUS_COL) {
            const base = { fill: { patternType: "solid", fgColor: { rgb: statusFill(a) } } };
            ws[ref] = { v: "", t: "s", s: mergeStyle(base, ov) };
          } else if (CURRENCY_COLS.has(c) || PERCENT_COLS.has(c)) {
            ws[ref] = { v: (val ?? 0) as number, t: "n", s: mergeStyle(xlsxDataStyle(col), ov) };
          } else if (typeof val === "number") {
            ws[ref] = { v: val, t: "n", s: mergeStyle({}, ov) };
          } else {
            ws[ref] = { v: (val ?? "") as string, t: "s", s: mergeStyle({}, ov) };
          }
        });
      });

      ws["!ref"] = XLSX.utils.encode_range({
        s: { r: 0, c: 0 },
        e: { r: ordered.length, c: EXPORT_COLUMNS.length - 1 },
      });
      ws["!cols"] = EXPORT_COLUMNS.map((col) => ({ wch: col.width }));
      ws["!rows"] = [{ hpt: 29.1 }, ...ordered.map(() => ({ hpt: 29.25 }))];

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
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="min-h-screen bg-canvas">
        <header className="h-16 border-b border-border/60 bg-surface/80 backdrop-blur-xl sticky top-0 z-30 px-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-gradient-brand grid place-items-center shadow-glow shrink-0">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                className="h-5 w-5 text-white"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
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
              <div
                className={`h-2 w-2 rounded-full shrink-0 ${loadingBase ? "bg-muted-foreground animate-pulse" : db && cnpj && peseDb && tiDb ? "bg-status-ok animate-pulse" : db && cnpj && peseDb ? "bg-status-warn animate-pulse" : "bg-destructive"}`}
              />
              <span className="hidden sm:inline">
                {loadingBase
                  ? "Carregando base..."
                  : db && cnpj && peseDb && tiDb
                    ? "Base carregada"
                    : db && cnpj && peseDb
                      ? "Base parcial (sem TI)"
                      : "Erro na base"}
              </span>
            </div>
            <ThemeToggle />
          </div>
        </header>

        <main className="max-w-6xl mx-auto px-6 py-8 space-y-6 pb-28">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold tracking-tight">Análise de PANs</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Verificação contra orçamento aprovado
              </p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="file"
                id="upload-pan"
                accept="application/pdf"
                multiple
                className="hidden"
                onChange={(e) => {
                  handleFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <Button
                onClick={() => document.getElementById("upload-pan")?.click()}
                className="gap-2 bg-gradient-brand hover:opacity-90 shadow-glow"
                disabled={processing}
              >
                {processing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                {processing ? "Processando..." : "Upload PAN"}
              </Button>
            </div>
          </div>

          {error && (
            <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 shrink-0" />
              <div>{error}</div>
              <button
                onClick={() => setError("")}
                className="ml-auto p-1 hover:bg-destructive/20 rounded"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {loadingBase
              ? [0, 1, 2, 3].map((i) => (
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
              : [
                  <StatCard
                    key="count"
                    label="PANs analisadas"
                    value={String(summary.count)}
                    icon={<FileText className="h-5 w-5" />}
                    tip="Total de PDFs carregados nesta sessão"
                  />,
                  <StatCard
                    key="ok"
                    label="Aprovadas"
                    value={String(summary.ok)}
                    accent="ok"
                    icon={<CheckCircle2 className="h-5 w-5" />}
                    tip="PANs com orçamento suficiente em todas as empresas e anos"
                  />,
                  <StatCard
                    key="warn"
                    label="Atenção"
                    value={String(summary.warn + summary.unknown)}
                    accent="warn"
                    icon={<AlertTriangle className="h-5 w-5" />}
                    tip={`${summary.warn} com déficit orçamentário · ${summary.unknown} com mapeamento incompleto`}
                  />,
                  <StatCard
                    key="total"
                    label="Total solicitado"
                    value={fmtBRL(summary.totalReq)}
                    icon={<TrendingUp className="h-5 w-5" />}
                    tip="Σ fluxo de caixa × CAPEX% de todas as PANs carregadas"
                  />,
                ].map((card, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.07, duration: 0.3 }}
                  >
                    {card}
                  </motion.div>
                ))}
          </section>

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
                <span className="text-sm text-muted-foreground">
                  {analyzed.length} documento{analyzed.length > 1 ? "s" : ""}
                </span>
              </div>
              <div className="space-y-3">
                <AnimatePresence initial={false}>
                  {analyzed.map((a, i) => (
                    <motion.div
                      key={a.pan.fileName + i}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.98 }}
                      transition={{ delay: i * 0.04, duration: 0.25 }}
                      whileHover={{ y: -1 }}
                    >
                      <PanCard
                        a={a}
                        db={db!}
                        peseDb={peseDb}
                        tiDb={tiDb}
                        expanded={expanded.has(a.pan.fileName)}
                        inTray={tray.includes(a.pan.fileName)}
                        onToggle={() => toggleExpand(a.pan.fileName)}
                        onToggleTray={() => toggleTray(a.pan.fileName)}
                        onRemove={() => setPans(pans.filter((_, idx) => idx !== i))}
                        onTpChange={(tp) =>
                          setOverrides({
                            ...overrides,
                            [a.pan.fileName]: { ...overrides[a.pan.fileName], tp },
                          })
                        }
                        onEmpresaChange={(panName, code) => {
                          const cur = overrides[a.pan.fileName] ?? {};
                          setOverrides({
                            ...overrides,
                            [a.pan.fileName]: {
                              ...cur,
                              empresas: { ...(cur.empresas ?? {}), [panName]: code },
                            },
                          });
                        }}
                        onPeseCodeChange={(peseCode) =>
                          setOverrides({
                            ...overrides,
                            [a.pan.fileName]: { ...overrides[a.pan.fileName], peseCode },
                          })
                        }
                        onTiProgramaChange={(empresaCode, programa) => {
                          const cur = overrides[a.pan.fileName] ?? {};
                          setOverrides({
                            ...overrides,
                            [a.pan.fileName]: {
                              ...cur,
                              tiProgramas: { ...(cur.tiProgramas ?? {}), [empresaCode]: programa },
                            },
                          });
                        }}
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
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                handleFiles(e.dataTransfer.files);
              }}
              onClick={() => document.getElementById("upload-pan")?.click()}
            >
              <motion.div
                animate={{ scale: dragOver ? 1.18 : 1 }}
                transition={{ type: "spring", stiffness: 280, damping: 18 }}
                className={`mx-auto h-20 w-20 rounded-2xl grid place-items-center mb-5 transition-colors ${dragOver ? "bg-primary/15" : "bg-muted"}`}
              >
                <Upload
                  className={`h-9 w-9 transition-colors ${dragOver ? "text-primary" : "text-muted-foreground"}`}
                />
              </motion.div>
              <h3 className="text-xl font-semibold">
                {dragOver ? "Solte os arquivos aqui" : "Nenhuma PAN carregada"}
              </h3>
              <p className="text-sm text-muted-foreground mt-2 max-w-sm mx-auto">
                {dragOver
                  ? "Arquivos PDF serão processados automaticamente"
                  : "Arraste PDFs para cá ou clique para selecionar arquivos"}
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
      {analyzed.length > 0 && (
        <ExportDock
          ordered={orderedSelection}
          onRemove={(f) => setTray((prev) => prev.filter((x) => x !== f))}
          onClear={clearTrayState}
          onAddApproved={addAllApproved}
          onAddAll={addAll}
          onPreview={() => exportToExcel(orderedSelection)}
          exporting={exporting}
        />
      )}
    </DndContext>
  );
}

function StatCard({
  label,
  value,
  icon,
  accent,
  tip,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  accent?: "ok" | "warn";
  tip?: string;
}) {
  const tone =
    accent === "ok"
      ? "text-status-ok bg-status-ok/10"
      : accent === "warn"
        ? "text-status-warn bg-status-warn/10"
        : "text-primary bg-primary/10";
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
          <div className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">
            {tip ? <Num v={value} tip={tip} /> : value}
          </div>
        </div>
        <div className={`h-10 w-10 rounded-lg grid place-items-center ${tone}`}>{icon}</div>
      </div>
    </Card>
  );
}

function PanCard({
  a,
  db,
  peseDb,
  tiDb,
  expanded,
  inTray,
  onToggle,
  onToggleTray,
  onRemove,
  onTpChange,
  onEmpresaChange,
  onPeseCodeChange,
  onStatusChange,
  onTiProgramaChange,
}: {
  a: AnalyzedPan;
  db: BudgetDb;
  peseDb: PeseDb | null;
  tiDb: TiDb | null;
  expanded: boolean;
  inTray: boolean;
  onToggle: () => void;
  onToggleTray: () => void;
  onRemove: () => void;
  onTpChange: (tp: string) => void;
  onEmpresaChange: (panName: string, code: string) => void;
  onPeseCodeChange: (peseCode: string) => void;
  onStatusChange: (status: "aprovado" | "negado" | "warn" | null) => void;
  onTiProgramaChange: (empresaCode: string, programa: string) => void;
}) {
  const drag = useDraggable({ id: a.pan.fileName });
  const effectiveStatus = a.manualStatus ?? a.status;
  const statusConfig = {
    ok: {
      label: "Dentro do orçamento",
      cls: "bg-status-ok/15 text-status-ok border-status-ok/30",
      dot: "bg-status-ok",
    },
    warn: {
      label: "Ação necessária",
      cls: "bg-status-warn/15 text-status-warn border-status-warn/30",
      dot: "bg-status-warn animate-pulse",
    },
    unknown: {
      label: "Revisar mapeamento",
      cls: "bg-muted text-muted-foreground border-border",
      dot: "bg-muted-foreground",
    },
    aprovado: {
      label: "Aprovado",
      cls: "bg-status-ok/15 text-status-ok border-status-ok/30",
      dot: "bg-status-ok",
    },
    negado: {
      label: "Negado",
      cls: "bg-destructive/15 text-destructive border-destructive/30",
      dot: "bg-destructive",
    },
  }[effectiveStatus] ?? {
    label: effectiveStatus,
    cls: "bg-muted text-muted-foreground border-border",
    dot: "bg-muted-foreground",
  };
  const tp = a.tpResolved ?? "";
  const worst = [...a.rows].sort((x, y) => x.diff - y.diff)[0];
  const tpBadgeLabel = a.pan.tp
    ? a.tpResolved && a.tpResolved !== a.pan.tp
      ? `${a.pan.tp} → ${a.tpResolved}`
      : a.pan.tp
    : "sem TP";

  return (
    <Card className={`overflow-hidden transition-all ${inTray ? "ring-2 ring-primary/50" : ""}`}>
      <div className="flex items-center gap-2 p-5 hover:bg-muted/30 transition-colors">
        <button
          ref={drag.setNodeRef}
          {...drag.listeners}
          {...drag.attributes}
          onClick={(e) => {
            e.stopPropagation();
            onToggleTray();
          }}
          className="p-1 rounded hover:bg-muted transition-colors shrink-0 cursor-grab"
          title={inTray ? "Remover do export" : "Adicionar ao export (ou arraste)"}
        >
          {inTray ? (
            <CheckSquare className="h-5 w-5 text-primary" />
          ) : (
            <GripVertical className="h-5 w-5 text-muted-foreground" />
          )}
        </button>
        <button onClick={onToggle} className="flex-1 flex items-center gap-4 text-left">
          <div className={`h-2.5 w-2.5 rounded-full ${statusConfig.dot} shadow-glow-sm`} />
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold">PAN {a.pan.panNumber ?? "?"}</span>
              <Badge variant="outline" className="text-xs">
                TP {tpBadgeLabel}
              </Badge>
              <Badge variant="outline" className="text-xs">
                CAPEX {a.pan.percentualCapex ?? 100}%
              </Badge>
              {a.pan.isTurnKey && (
                <Badge
                  variant="outline"
                  className="text-xs border border-primary/30 bg-primary/15 text-primary inline-flex items-center gap-1"
                >
                  <Wrench className="h-3 w-3" />
                  Turn Key
                </Badge>
              )}
              {a.pan.isTi && (
                <Badge
                  variant="outline"
                  className="text-xs border border-blue-500/30 bg-blue-500/15 text-blue-600 dark:text-blue-400 inline-flex items-center gap-1"
                >
                  <Monitor className="h-3 w-3" />
                  TI{a.pan.tiCategory ? ` · ${a.pan.tiCategory}` : ""}
                </Badge>
              )}
              <Badge
                variant="outline"
                className={`text-xs border ${statusConfig.cls} inline-flex items-center gap-1`}
              >
                {effectiveStatus === "ok" || effectiveStatus === "aprovado" ? (
                  <CheckCircle2 className="h-3 w-3" />
                ) : effectiveStatus === "warn" ? (
                  <AlertTriangle className="h-3 w-3" />
                ) : effectiveStatus === "negado" ? (
                  <X className="h-3 w-3" />
                ) : (
                  <HelpCircle className="h-3 w-3" />
                )}
                {statusConfig.label}
              </Badge>
            </div>
            <div className="text-sm text-muted-foreground truncate mt-0.5">{a.pan.titulo}</div>
          </div>
          <div className="hidden md:flex items-center gap-6 text-sm">
            <div className="text-right">
              <div className="text-xs text-muted-foreground">Solicitado</div>
              <div className="font-medium tabular-nums">
                <Num
                  v={fmtBRL(a.totalRequested)}
                  tip={
                    a.pan.isTurnKey
                      ? `Σ fluxo de caixa × CAPEX ${a.pan.percentualCapex ?? 100}%\nbase: base pese.xlsx`
                      : `Σ rateio das empresas × CAPEX ${a.pan.percentualCapex ?? 100}%`
                  }
                />
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-muted-foreground">Disponível</div>
              <div className="font-medium tabular-nums">
                <Num
                  v={fmtBRL(a.totalAvailable)}
                  tip={
                    a.pan.isTurnKey
                      ? `Σ orçamento PESE × 1,2195 (fator fiscal)\ncódigo: ${a.pese?.peseCodeResolved ?? "—"}\nbase: base pese.xlsx`
                      : `Σ orçamento TP ${a.tpResolved ?? "?"} por empresa\nbase: orcamento.xlsx`
                  }
                />
              </div>
            </div>
          </div>
        </button>
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => onStatusChange(a.manualStatus === "aprovado" ? null : "aprovado")}
            className={`px-2 py-1 text-xs rounded border transition-colors ${a.manualStatus === "aprovado" ? "bg-status-ok text-white border-status-ok" : "border-border text-muted-foreground hover:border-status-ok hover:text-status-ok"}`}
          >
            Aprov.
          </button>
          <button
            onClick={() => onStatusChange(a.manualStatus === "warn" ? null : "warn")}
            className={`px-2 py-1 text-xs rounded border transition-colors ${a.manualStatus === "warn" ? "bg-status-warn text-white border-status-warn" : "border-border text-muted-foreground hover:border-status-warn hover:text-status-warn"}`}
          >
            Warn
          </button>
          <button
            onClick={() => onStatusChange(a.manualStatus === "negado" ? null : "negado")}
            className={`px-2 py-1 text-xs rounded border transition-colors ${a.manualStatus === "negado" ? "bg-destructive text-white border-destructive" : "border-border text-muted-foreground hover:border-destructive hover:text-destructive"}`}
          >
            Neg.
          </button>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-t border-border/60"
          >
            <div className="p-5 space-y-5 bg-muted/20">
              {!a.pan.isTurnKey && !a.pan.isTi && (
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-sm text-muted-foreground">Programa orçamentário (TP):</span>
                  <Select value={tp} onValueChange={onTpChange}>
                    <SelectTrigger className="w-48 h-8">
                      <SelectValue placeholder="TP" />
                    </SelectTrigger>
                    <SelectContent>
                      {db.tps.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="text-xs text-muted-foreground">
                    Detectado: {a.pan.programaOrcamentario ?? "—"}
                  </span>
                </div>
              )}

              {a.pan.isTi && tiDb && (
                <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Monitor className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                    <span className="text-sm font-medium text-blue-600 dark:text-blue-400">
                      Verificação TI{a.pan.tiCategory ? ` — ${a.pan.tiCategory}` : ""}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-sm text-muted-foreground">TP:</span>
                    <Select value={tp} onValueChange={onTpChange}>
                      <SelectTrigger className="w-48 h-8">
                        <SelectValue placeholder="TP" />
                      </SelectTrigger>
                      <SelectContent>
                        {tiDb.tps.map((t) => (
                          <SelectItem key={t} value={t}>
                            {t}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <span className="text-xs text-muted-foreground">
                      Detectado: {a.pan.tp ?? "—"}
                    </span>
                  </div>
                  {a.pan.descricaoObra && (
                    <div className="text-xs text-muted-foreground">
                      DESCR. OBRA detectada:{" "}
                      <span className="text-foreground/70">{a.pan.descricaoObra}</span>
                    </div>
                  )}
                </div>
              )}

              {a.pan.isTurnKey && peseDb && (
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-4">
                  <div className="flex items-center gap-2">
                    <Wrench className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium text-primary">
                      Verificação PESE (Turn Key)
                    </span>
                  </div>
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-sm text-muted-foreground">Código PESE:</span>
                    <Select value={a.pese?.peseCodeResolved ?? ""} onValueChange={onPeseCodeChange}>
                      <SelectTrigger className="w-64 h-8">
                        <SelectValue placeholder="Selecione o código PESE" />
                      </SelectTrigger>
                      <SelectContent>
                        {peseDb.peseCodes.map((c) => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <span className="text-xs text-muted-foreground">
                      Detectado: {a.pan.peseCode ?? "—"}
                    </span>
                  </div>
                  {a.pese?.peseCodeResolved && a.pese.peseByYear.length > 0 && (
                    <div className="rounded-lg border border-border bg-surface overflow-hidden">
                      <div className="px-4 py-2.5 border-b border-border/60 flex items-center justify-between">
                        <div className="text-sm font-medium">Orçamento PESE por ano</div>
                        <div className="text-xs text-muted-foreground">
                          {a.pese.peseCodeResolved}
                        </div>
                      </div>
                      <div className="overflow-x-auto scrollbar-thin">
                        <table className="w-full text-sm">
                          <thead className="bg-primary/10 text-xs uppercase tracking-wider text-primary/80 sticky top-0">
                            <tr>
                              <th className="text-left px-4 py-2.5 font-semibold">Ano</th>
                              <th className="text-right px-4 py-2.5 font-semibold">PAN</th>
                              <th className="text-right px-4 py-2.5 font-semibold">PESE</th>
                              <th className="text-right px-4 py-2.5 font-semibold">Diferença</th>
                              <th className="text-center px-4 py-2.5 font-semibold">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {a.pese.peseByYear.map((y, idx) => {
                              const noBudget = y.requested > 0 && y.available === 0;
                              return (
                                <tr
                                  key={y.year}
                                  className={`border-t border-border/40 transition-colors ${noBudget ? "bg-status-warn/5" : idx % 2 === 1 ? "bg-muted/20" : ""}`}
                                >
                                  <td className="px-4 py-2.5 font-medium">{y.year}</td>
                                  <td className="px-4 py-2.5 text-right tabular-nums">
                                    <Num
                                      v={fmtBRL(y.requested)}
                                      tip={
                                        y.requested > 0
                                          ? `Fluxo de caixa ${y.year} × CAPEX ${a.pan.percentualCapex ?? 100}%`
                                          : "Sem solicitação neste ano"
                                      }
                                    />
                                  </td>
                                  <td
                                    className={`px-4 py-2.5 text-right tabular-nums ${noBudget ? "text-status-warn font-medium" : ""}`}
                                  >
                                    {noBudget ? (
                                      "Sem orçamento"
                                    ) : (
                                      <Num
                                        v={fmtBRL(y.available)}
                                        tip={`Orçamento PESE × 1,2195 (fator fiscal)\ncódigo: ${a.pese!.peseCodeResolved}\nbase: base pese.xlsx`}
                                      />
                                    )}
                                  </td>
                                  <td
                                    className={`px-4 py-2.5 text-right font-medium tabular-nums ${y.ok ? "text-status-ok" : "text-status-warn"}`}
                                  >
                                    <Num
                                      v={`${y.diff >= 0 ? "+" : ""}${fmtBRL(y.diff)}`}
                                      tip={`PESE (${fmtBRL(y.available)}) − PAN (${fmtBRL(y.requested)})`}
                                    />
                                  </td>
                                  <td className="px-4 py-2.5 text-center">
                                    <span
                                      className={`inline-block h-2 w-2 rounded-full ${y.ok ? "bg-status-ok" : "bg-status-warn"}`}
                                    />
                                  </td>
                                </tr>
                              );
                            })}
                            <tr className="border-t-2 border-border bg-primary/5 font-semibold">
                              <td className="px-4 py-2.5">Total</td>
                              <td className="px-4 py-2.5 text-right tabular-nums">
                                <Num
                                  v={fmtBRL(a.pese.peseTotal.requested)}
                                  tip={`Σ fluxo de caixa × CAPEX ${a.pan.percentualCapex ?? 100}%`}
                                />
                              </td>
                              <td className="px-4 py-2.5 text-right tabular-nums">
                                <Num
                                  v={fmtBRL(a.pese.peseTotal.available)}
                                  tip={`Σ orçamento PESE × 1,2195 (fator fiscal)\ncódigo: ${a.pese.peseCodeResolved}\nbase: base pese.xlsx`}
                                />
                              </td>
                              <td
                                className={`px-4 py-2.5 text-right tabular-nums ${a.pese.peseTotal.ok ? "text-status-ok" : "text-status-warn"}`}
                              >
                                <Num
                                  v={`${a.pese.peseTotal.diff >= 0 ? "+" : ""}${fmtBRL(a.pese.peseTotal.diff)}`}
                                  tip={`PESE (${fmtBRL(a.pese.peseTotal.available)}) − PAN (${fmtBRL(a.pese.peseTotal.requested)})`}
                                />
                              </td>
                              <td />
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                  {a.pese?.peseCodeResolved &&
                    (() => {
                      const missingYears = a
                        .pese!.peseByYear.filter((y) => y.requested > 0 && y.available === 0)
                        .map((y) => y.year);
                      return (
                        <div
                          className={`rounded-lg border p-3 text-sm ${a.pese!.peseTotal.ok ? "border-status-ok/30 bg-status-ok/10" : "border-status-warn/30 bg-status-warn/10"}`}
                        >
                          <div className="flex items-start gap-2">
                            {a.pese!.peseTotal.ok ? (
                              <CheckCircle2 className="h-4 w-4 text-status-ok mt-0.5 shrink-0" />
                            ) : (
                              <AlertTriangle className="h-4 w-4 text-status-warn mt-0.5 shrink-0" />
                            )}
                            <div>
                              {a.pese!.peseTotal.ok ? (
                                <span className="text-status-ok font-medium">
                                  PESE aprovado - orçamento suficiente
                                </span>
                              ) : missingYears.length > 0 ? (
                                <span className="text-status-warn font-medium">
                                  Sem orçamento PESE para {missingYears.join(", ")}
                                </span>
                              ) : (
                                <span className="text-status-warn font-medium">
                                  PESE com déficit de {fmtBRL(-a.pese!.peseTotal.diff)}
                                </span>
                              )}
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
                        <tr>
                          <th className="text-left px-4 py-2.5 font-semibold">Ano</th>
                          <th className="text-right px-4 py-2.5 font-semibold">PAN</th>
                          <th className="text-right px-4 py-2.5 font-semibold">Orçamento</th>
                          <th className="text-right px-4 py-2.5 font-semibold">Diferença</th>
                          <th className="text-center px-4 py-2.5 font-semibold">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {a.yearTotals.map((y, idx) => (
                          <tr
                            key={y.year}
                            className={`border-t border-border/40 transition-colors ${idx % 2 === 1 ? "bg-muted/20" : ""}`}
                          >
                            <td className="px-4 py-2.5 font-medium">{y.year}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums">
                              <Num
                                v={fmtBRL(y.requested)}
                                tip={`Fluxo de caixa ${y.year} × CAPEX ${a.pan.percentualCapex ?? 100}%`}
                              />
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums">
                              <Num
                                v={fmtBRL(y.available)}
                                tip={`Σ orçamento TP ${tp} · ${a.rows.length} empresa(s)\nbase: ${a.pan.isTi ? "TI.xlsx" : "orcamento.xlsx"}`}
                              />
                            </td>
                            <td
                              className={`px-4 py-2.5 text-right font-medium tabular-nums ${y.ok ? "text-status-ok" : "text-status-warn"}`}
                            >
                              <Num
                                v={`${y.diff >= 0 ? "+" : ""}${fmtBRL(y.diff)}`}
                                tip={`Orçamento (${fmtBRL(y.available)}) − Pedido (${fmtBRL(y.requested)})`}
                              />
                            </td>
                            <td className="px-4 py-2.5 text-center">
                              <span
                                className={`inline-block h-2 w-2 rounded-full ${y.ok ? "bg-status-ok" : "bg-status-warn"}`}
                              />
                            </td>
                          </tr>
                        ))}
                        <tr className="border-t-2 border-border bg-primary/5 font-semibold">
                          <td className="px-4 py-2.5">Total</td>
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            <Num
                              v={fmtBRL(a.totalRequested)}
                              tip={`Σ fluxo de caixa × CAPEX ${a.pan.percentualCapex ?? 100}%`}
                            />
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            <Num
                              v={fmtBRL(a.totalAvailable)}
                              tip={`Σ orçamento TP ${tp} em todos os anos\nbase: ${a.pan.isTi ? "TI.xlsx" : "orcamento.xlsx"}`}
                            />
                          </td>
                          <td
                            className={`px-4 py-2.5 text-right tabular-nums ${a.totalAvailable - a.totalRequested >= 0 ? "text-status-ok" : "text-status-warn"}`}
                          >
                            <Num
                              v={`${a.totalAvailable - a.totalRequested >= 0 ? "+" : ""}${fmtBRL(a.totalAvailable - a.totalRequested)}`}
                              tip={`Orçamento (${fmtBRL(a.totalAvailable)}) − Pedido (${fmtBRL(a.totalRequested)})`}
                            />
                          </td>
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
                    const needsPrograma = a.pan.isTi && r.empresaCode && !r.tiPrograma;
                    const tone = !r.empresaCode
                      ? "border-border bg-surface"
                      : needsPrograma
                        ? "border-blue-500/30 bg-blue-500/5"
                        : r.ok
                          ? "border-status-ok/30 bg-status-ok/5"
                          : "border-status-warn/30 bg-status-warn/5";
                    const action = !r.empresaCode
                      ? "Selecione a empresa correspondente na base"
                      : needsPrograma
                        ? "Selecione a linha orçamentária para esta empresa"
                        : r.ok
                          ? `Liberar PAN. Sobra ${fmtBRL(r.diff)} no orçamento.`
                          : `Falta ${fmtBRL(-r.diff)}. Recomenda-se remanejar saldo de outra empresa ou revisar fluxo de caixa.`;
                    const empresaList = a.pan.isTi && tiDb ? tiDb.empresas : db.empresas;
                    return (
                      <div key={r.empresaPan} className={`rounded-lg border p-4 ${tone}`}>
                        <div className="flex items-start justify-between gap-4 flex-wrap">
                          <div className="flex-1 min-w-0">
                            <div className="font-medium">{r.empresaPan}</div>
                            <div className="text-xs text-muted-foreground mt-0.5">{action}</div>
                            {a.pan.isTi && r.empresaCode && (
                              <div className="mt-2 flex items-center gap-2 flex-wrap">
                                <span className="text-xs text-muted-foreground">
                                  Linha orçamentária:
                                </span>
                                <Select
                                  value={r.tiPrograma ?? ""}
                                  onValueChange={(v) => onTiProgramaChange(r.empresaCode!, v)}
                                >
                                  <SelectTrigger className="h-7 text-xs w-64">
                                    <SelectValue placeholder="Selecione o programa" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {(r.tiProgramaOptions ?? []).map((opt) => (
                                      <SelectItem
                                        key={opt.programaOrcamentario}
                                        value={opt.programaOrcamentario}
                                      >
                                        <div className="flex flex-col gap-0.5">
                                          <span>{opt.programaOrcamentario}</span>
                                          {opt.descricaoProjeto && (
                                            <span className="text-[10px] text-muted-foreground leading-tight">
                                              {opt.descricaoProjeto}
                                            </span>
                                          )}
                                        </div>
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-4">
                            <div className="text-right text-sm">
                              <div className="text-xs text-muted-foreground">Pedido</div>
                              <div className="tabular-nums">
                                <Num
                                  v={fmtBRL(r.requested)}
                                  tip={`Valor do rateio × CAPEX ${a.pan.percentualCapex ?? 100}%`}
                                />
                              </div>
                            </div>
                            <div className="text-right text-sm">
                              <div className="text-xs text-muted-foreground">Disponível</div>
                              <div className="tabular-nums">
                                <Num
                                  v={fmtBRL(r.available)}
                                  tip={
                                    r.empresaCode
                                      ? a.pan.isTi
                                        ? `TP ${tp} — ${r.empresaCode}\nlinha: ${r.tiPrograma ?? "—"}\nbase: TI.xlsx`
                                        : `TP ${tp} — ${r.empresaCode}\nbase: orcamento.xlsx`
                                      : "Empresa não mapeada na base"
                                  }
                                />
                              </div>
                            </div>
                            <div className="text-right text-sm">
                              <div className="text-xs text-muted-foreground">Diferença</div>
                              <div
                                className={`tabular-nums ${r.ok ? "text-status-ok font-medium" : "text-status-warn font-medium"}`}
                              >
                                <Num
                                  v={`${r.diff >= 0 ? "+" : ""}${fmtBRL(r.diff)}`}
                                  tip={`Disponível (${fmtBRL(r.available)}) − Pedido (${fmtBRL(r.requested)})`}
                                />
                              </div>
                            </div>
                            <Select
                              value={r.empresaCode ?? ""}
                              onValueChange={(v) => onEmpresaChange(r.empresaPan, v)}
                            >
                              <SelectTrigger className="w-32 h-8">
                                <SelectValue placeholder="Código" />
                              </SelectTrigger>
                              <SelectContent>
                                {empresaList.map((e) => (
                                  <SelectItem key={e} value={e}>
                                    {e}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        {r.empresaCode && r.available > 0 && (
                          <div className="mt-3 h-1.5 w-full rounded-full bg-muted overflow-hidden">
                            <div
                              className={`h-full ${r.ok ? "bg-status-ok" : "bg-status-warn"}`}
                              style={{
                                width: `${Math.min(100, (r.requested / r.available) * 100)}%`,
                              }}
                            />
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
                      <div className="text-foreground/80 mt-1">
                        {a.pan.isTi ? (
                          <>
                            Maior gap em <b>{worst.empresaPan}</b>: faltam{" "}
                            <b>{fmtBRL(-worst.diff)}</b>. Verifique a linha orçamentária selecionada
                            ou solicite suplementação no TP <b>{tp}</b> (base TI.xlsx).
                          </>
                        ) : (
                          <>
                            Maior gap em <b>{worst.empresaPan}</b>: faltam{" "}
                            <b>{fmtBRL(-worst.diff)}</b>. Avalie remanejamento entre empresas
                            (contrato permite), ajustar o fluxo de caixa anual ou solicitar
                            suplementação no TP <b>{tp}</b>.
                          </>
                        )}
                      </div>
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
                      <div className="text-foreground/80 mt-1">
                        {a.pan.isTi ? (
                          <>
                            Todas as empresas têm saldo suficiente nas linhas orçamentárias do TP{" "}
                            <b>{tp}</b> para os anos do fluxo de caixa (base TI.xlsx).
                          </>
                        ) : (
                          <>
                            Todas as empresas têm saldo suficiente no TP <b>{tp}</b> para os anos do
                            fluxo de caixa.
                          </>
                        )}
                      </div>
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
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-muted/30 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Escopo e histórico de contratação</span>
          <Badge variant="outline" className="text-[10px]">
            Resumo PAN
          </Badge>
        </div>
        {open ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-t border-border/60"
          >
            <div className="px-4 py-3 text-sm text-foreground/80 leading-relaxed whitespace-pre-line">
              {text}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
