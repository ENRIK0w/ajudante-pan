"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, Loader2 } from "lucide-react";
import type { AnalyzedPan } from "@/lib/analyze";
import {
  EXPORT_COLUMNS,
  SEPARATOR_COLS,
  STATUS_COL,
  statusFill,
  buildRow,
} from "@/lib/export-schema";
import { applyStyle, cellKey, HEADER_ROW, type CellStyle, type FormatMap } from "@/lib/cell-format";
import { FormatToolbar } from "./format-toolbar";
import { useCellSelection } from "./use-cell-selection";

const SELECTABLE_COLS = EXPORT_COLUMNS.filter((c) => !SEPARATOR_COLS.has(c.index)).map(
  (c) => c.index,
);

// Translate schema + override into inline CSS for the WYSIWYG cell.
function cellCss(defaultFill: string, ov?: CellStyle): React.CSSProperties {
  const css: React.CSSProperties = { textAlign: "center" };
  if (defaultFill) {
    css.background = `#${defaultFill}`;
    css.color = "#fff";
    css.fontWeight = 600;
  }
  if (ov?.fill) css.background = `#${ov.fill}`;
  if (ov?.color) css.color = `#${ov.color}`;
  if (ov?.bold !== undefined) css.fontWeight = ov.bold ? 700 : 400;
  if (ov?.italic) css.fontStyle = "italic";
  if (ov?.fontSize) css.fontSize = ov.fontSize * (4 / 3);
  if (ov?.align) css.textAlign = ov.align;
  return css;
}

export function ExportPreview({
  open,
  onOpenChange,
  ordered,
  exporting,
  onExport,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  ordered: AnalyzedPan[];
  exporting: boolean;
  onExport: (formatMap: FormatMap) => void;
}) {
  const [formatMap, setFormatMap] = useState<FormatMap>({});
  const dragging = useRef(false);

  const rowIds = useMemo(() => [HEADER_ROW, ...ordered.map((a) => a.pan.fileName)], [ordered]);
  const sel = useCellSelection(rowIds, SELECTABLE_COLS);

  useEffect(() => {
    sel.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, rowIds]);

  useEffect(() => {
    const onUp = () => {
      dragging.current = false;
    };
    window.addEventListener("mouseup", onUp);
    return () => window.removeEventListener("mouseup", onUp);
  }, []);

  const applyPatch = (patch: CellStyle) => {
    if (sel.selected.size === 0) return;
    setFormatMap((prev) => applyStyle(prev, [...sel.selected], patch));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-[95vw] max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Pré-visualização do Excel</DialogTitle>
        </DialogHeader>

        <FormatToolbar disabled={sel.selected.size === 0} onApply={applyPatch} />

        <div
          className="flex-1 overflow-auto scrollbar-thin border border-border rounded"
          onMouseLeave={() => (dragging.current = false)}
        >
          <table className="border-collapse text-xs select-none" style={{ tableLayout: "fixed" }}>
            <thead>
              <tr>
                {EXPORT_COLUMNS.map((col) => {
                  if (SEPARATOR_COLS.has(col.index))
                    return (
                      <th
                        key={col.index}
                        style={{ width: 8 }}
                        className="border border-border/40 bg-transparent"
                      />
                    );
                  const ov = formatMap[cellKey(HEADER_ROW, col.index)];
                  const isSel = sel.isSelected(HEADER_ROW, col.index);
                  return (
                    <th
                      key={col.index}
                      onClick={() => sel.selectColumn(col.index)}
                      style={{
                        ...cellCss(col.fill, ov),
                        width: col.width * 7,
                        whiteSpace: "pre-line",
                      }}
                      className={`border border-border/40 px-2 py-1 cursor-pointer ${isSel ? "outline outline-2 outline-primary" : ""}`}
                      title="Clique para selecionar a coluna inteira"
                    >
                      {col.header}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {ordered.map((a, ri) => {
                const values = buildRow(a);
                const rowIndex = ri + 1; // 0 is header
                return (
                  <tr key={a.pan.fileName}>
                    {EXPORT_COLUMNS.map((col) => {
                      const c = col.index;
                      if (SEPARATOR_COLS.has(c))
                        return <td key={c} className="border border-border/40 bg-transparent" />;
                      const ov = formatMap[cellKey(a.pan.fileName, c)];
                      const isSel = sel.isSelected(a.pan.fileName, c);
                      const defaultFill = c === STATUS_COL ? statusFill(a) : "";
                      const display = c === STATUS_COL ? "" : values[c];
                      return (
                        <td
                          key={c}
                          onMouseDown={(e) => {
                            dragging.current = true;
                            sel.selectCell(rowIndex, c, e.shiftKey || e.ctrlKey || e.metaKey);
                          }}
                          onMouseEnter={() => {
                            if (dragging.current) sel.extendTo(rowIndex, c);
                          }}
                          onMouseUp={() => {
                            dragging.current = false;
                          }}
                          style={{ ...cellCss(defaultFill, ov) }}
                          className={`border border-border/40 px-2 py-1 cursor-cell ${isSel ? "outline outline-2 outline-primary" : ""}`}
                        >
                          {typeof display === "number"
                            ? col.kind === "percent"
                              ? `${Math.round(display * 100)}%`
                              : display.toLocaleString("pt-BR", { maximumFractionDigits: 0 })
                            : (display ?? "")}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between pt-3">
          <p className="text-xs text-muted-foreground">
            {sel.selected.size > 0
              ? `${sel.selected.size} célula(s) selecionada(s)`
              : "Clique numa célula, cabeçalho ou arraste para selecionar"}
            {sel.selected.size > 0 && (
              <button onClick={sel.clear} className="ml-2 underline">
                limpar seleção
              </button>
            )}
          </p>
          <Button
            onClick={() => onExport(formatMap)}
            disabled={exporting}
            className="gap-2 bg-gradient-brand hover:opacity-90"
          >
            {exporting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            Exportar Excel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
