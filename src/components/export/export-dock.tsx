"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { X, Download, CheckSquare, Layers, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { AnalyzedPan } from "@/lib/analyze";

function Chip({ a, onRemove }: { a: AnalyzedPan; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `chip:${a.pan.fileName}`,
  });
  const status = a.manualStatus ?? a.status;
  const dot =
    status === "ok" || status === "aprovado"
      ? "bg-status-ok"
      : status === "warn"
        ? "bg-status-warn"
        : status === "negado"
          ? "bg-destructive"
          : "bg-muted-foreground";
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
      className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-sm shrink-0"
    >
      <span
        {...attributes}
        {...listeners}
        className="cursor-grab text-muted-foreground select-none"
      >
        ⠿
      </span>
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      <span className="font-medium">PAN {a.pan.panNumber ?? "?"}</span>
      <button
        onClick={onRemove}
        className="ml-1 rounded p-0.5 hover:bg-destructive/10 hover:text-destructive"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function ExportDock({
  ordered,
  onRemove,
  onClear,
  onAddApproved,
  onAddAll,
  onPreview,
  exporting,
}: {
  ordered: AnalyzedPan[];
  onRemove: (fileName: string) => void;
  onClear: () => void;
  onAddApproved: () => void;
  onAddAll: () => void;
  onPreview: () => void;
  exporting: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: "export-dock" });

  return (
    <div
      ref={setNodeRef}
      className={`fixed inset-x-0 bottom-0 z-40 border-t backdrop-blur-xl px-6 py-3 transition-all duration-300 ease-out will-change-transform ${
        isOver
          ? "border-t-2 border-primary bg-primary/10 -translate-y-1.5 shadow-[0_-14px_44px_-10px] shadow-primary/40"
          : "border-border bg-surface/95 translate-y-0 shadow-none"
      }`}
    >
      <div className="max-w-6xl mx-auto flex items-center gap-3">
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant="secondary" className="font-normal">
            {ordered.length} p/ exportar
          </Badge>
          <Button variant="outline" size="sm" onClick={onAddApproved} className="gap-1.5">
            <CheckSquare className="h-4 w-4" /> Aprovados
          </Button>
          <Button variant="outline" size="sm" onClick={onAddAll} className="gap-1.5">
            <Layers className="h-4 w-4" /> Todas
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onClear}
            disabled={ordered.length === 0}
            className="gap-1.5 hover:text-destructive hover:border-destructive"
          >
            <Trash2 className="h-4 w-4" /> Limpar
          </Button>
        </div>

        <div className="flex-1 min-w-0 overflow-x-auto scrollbar-thin">
          {ordered.length === 0 ? (
            <p
              className={`text-sm py-1.5 origin-left transition-all duration-300 ease-out ${
                isOver
                  ? "text-primary font-medium scale-110 translate-x-1.5"
                  : "text-muted-foreground"
              }`}
            >
              {isOver ? "Solte para adicionar ✦" : "Arraste PANs aqui para exportar"}
            </p>
          ) : (
            <SortableContext
              items={ordered.map((a) => `chip:${a.pan.fileName}`)}
              strategy={horizontalListSortingStrategy}
            >
              <div className="flex items-center gap-2">
                {ordered.map((a) => (
                  <Chip key={a.pan.fileName} a={a} onRemove={() => onRemove(a.pan.fileName)} />
                ))}
              </div>
            </SortableContext>
          )}
        </div>

        <Button
          onClick={onPreview}
          disabled={ordered.length === 0 || exporting}
          className="gap-2 bg-gradient-brand hover:opacity-90 shrink-0"
        >
          <Download className="h-4 w-4" /> Pré-visualizar
        </Button>
      </div>
    </div>
  );
}
