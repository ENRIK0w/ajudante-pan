"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { BudgetDb } from "@/lib/budget-parser";

type AnalyzedRow = { empresaCode: string | null; requested: number };
type AnalyzedEntry = { rows: AnalyzedRow[] };

interface BudgetDashboardProps {
  db: BudgetDb;
  analyzed: AnalyzedEntry[];
}

const fmtBRL = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

export function BudgetDashboard({ db, analyzed }: BudgetDashboardProps) {
  const [openPivot, setOpenPivot] = useState(true);
  const [openCompare, setOpenCompare] = useState(true);

  // ---- Section A: Pivot table (empresa rows × TP columns) ----
  const pivot = new Map<string, Map<string, number>>();
  const tpSet = new Set<string>();

  for (const row of db.rows) {
    tpSet.add(row.tp);
    let inner = pivot.get(row.empresa);
    if (!inner) {
      inner = new Map<string, number>();
      pivot.set(row.empresa, inner);
    }
    inner.set(row.tp, (inner.get(row.tp) ?? 0) + row.total);
  }

  const tps = Array.from(tpSet).sort();

  const colTotals = new Map<string, number>();
  for (const tp of tps) colTotals.set(tp, 0);
  let grandTotal = 0;

  const pivotRows = db.empresas.map((empresa) => {
    const inner = pivot.get(empresa) ?? new Map<string, number>();
    let rowTotal = 0;
    const cells = tps.map((tp) => {
      const v = inner.get(tp);
      if (v !== undefined) {
        rowTotal += v;
        colTotals.set(tp, (colTotals.get(tp) ?? 0) + v);
        grandTotal += v;
      }
      return v;
    });
    return { empresa, cells, rowTotal };
  });

  // ---- Section B: Empresa vs PANs ----
  const budgetByEmpresa = new Map<string, number>();
  for (const row of db.rows) {
    budgetByEmpresa.set(row.empresa, (budgetByEmpresa.get(row.empresa) ?? 0) + row.total);
  }

  const requestedByEmpresa = new Map<string, number>();
  for (const entry of analyzed) {
    for (const r of entry.rows) {
      if (r.empresaCode == null) continue;
      requestedByEmpresa.set(
        r.empresaCode,
        (requestedByEmpresa.get(r.empresaCode) ?? 0) + r.requested,
      );
    }
  }

  let totalBudgetAll = 0;
  let totalRequestedAll = 0;

  const compareRows = db.empresas.map((empresa) => {
    const totalBudget = budgetByEmpresa.get(empresa) ?? 0;
    const totalRequested = requestedByEmpresa.get(empresa) ?? 0;
    const delta = totalBudget - totalRequested;
    const ok = delta >= 0;
    totalBudgetAll += totalBudget;
    totalRequestedAll += totalRequested;
    return { empresa, totalBudget, totalRequested, delta, ok };
  });

  const deltaAll = totalBudgetAll - totalRequestedAll;
  const okAll = deltaAll >= 0;

  return (
    <div className="flex flex-col gap-6">
      {/* Section A - Pivot table */}
      <Card className="overflow-hidden">
        <div
          className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-muted/30 select-none border-b border-border"
          onClick={() => setOpenPivot((o) => !o)}
        >
          <span className="font-semibold">Orçamento por Empresa × TP</span>
          {openPivot ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </div>

        {openPivot && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-primary/10 text-xs uppercase tracking-wider text-primary/80">
                  <th className="px-4 py-2.5 text-left">Empresa</th>
                  {tps.map((tp) => (
                    <th key={tp} className="px-4 py-2.5 text-right">
                      {tp}
                    </th>
                  ))}
                  <th className="px-4 py-2.5 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {pivotRows.map((pr, idx) => (
                  <tr key={pr.empresa} className={idx % 2 === 1 ? "bg-muted/20" : ""}>
                    <td className="px-4 py-2.5 font-medium">{pr.empresa}</td>
                    {pr.cells.map((v, i) => (
                      <td key={tps[i]} className="px-4 py-2.5 text-right tabular-nums">
                        {v !== undefined ? (
                          fmtBRL(v)
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    ))}
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold">
                      {fmtBRL(pr.rowTotal)}
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-border bg-primary/5 font-semibold">
                  <td className="px-4 py-2.5">Total</td>
                  {tps.map((tp) => (
                    <td key={tp} className="px-4 py-2.5 text-right tabular-nums">
                      {fmtBRL(colTotals.get(tp) ?? 0)}
                    </td>
                  ))}
                  <td className="px-4 py-2.5 text-right tabular-nums">{fmtBRL(grandTotal)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Section B - Empresa vs PANs */}
      <Card className="overflow-hidden">
        <div
          className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-muted/30 select-none border-b border-border"
          onClick={() => setOpenCompare((o) => !o)}
        >
          <span className="font-semibold">Empresa × PANs</span>
          {openCompare ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </div>

        {openCompare && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-primary/10 text-xs uppercase tracking-wider text-primary/80">
                  <th className="px-4 py-2.5 text-left">Empresa</th>
                  <th className="px-4 py-2.5 text-right">Orçamento Total</th>
                  <th className="px-4 py-2.5 text-right">Solicitado</th>
                  <th className="px-4 py-2.5 text-right">Delta</th>
                  <th className="px-4 py-2.5 text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {compareRows.map((cr, idx) => (
                  <tr key={cr.empresa} className={idx % 2 === 1 ? "bg-muted/20" : ""}>
                    <td className="px-4 py-2.5 font-medium">{cr.empresa}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {fmtBRL(cr.totalBudget)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {fmtBRL(cr.totalRequested)}
                    </td>
                    <td
                      className={`px-4 py-2.5 text-right tabular-nums ${
                        cr.ok ? "text-status-ok" : "text-destructive"
                      }`}
                    >
                      {fmtBRL(cr.delta)}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <span
                        className={`inline-block h-2.5 w-2.5 rounded-full ${
                          cr.ok ? "bg-status-ok" : "bg-destructive"
                        }`}
                      />
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-border bg-primary/5 font-semibold">
                  <td className="px-4 py-2.5">Total</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {fmtBRL(totalBudgetAll)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {fmtBRL(totalRequestedAll)}
                  </td>
                  <td
                    className={`px-4 py-2.5 text-right tabular-nums ${
                      okAll ? "text-status-ok" : "text-destructive"
                    }`}
                  >
                    {fmtBRL(deltaAll)}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <span
                      className={`inline-block h-2.5 w-2.5 rounded-full ${
                        okAll ? "bg-status-ok" : "bg-destructive"
                      }`}
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
