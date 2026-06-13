"use client";

import {
  Bold,
  Italic,
  AlignLeft,
  AlignCenter,
  AlignRight,
  PaintBucket,
  Baseline,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CellStyle } from "@/lib/cell-format";

const SWATCHES = [
  "0E2841",
  "00B0F0",
  "00B050",
  "FFC000",
  "92D050",
  "FFFF00",
  "FF6B6B",
  "FFFFFF",
  "000000",
];

export function FormatToolbar({
  disabled,
  onApply,
}: {
  disabled: boolean;
  onApply: (patch: CellStyle) => void;
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap border-b border-border pb-3 mb-3">
      <Button
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => onApply({ bold: true })}
      >
        <Bold className="h-4 w-4" />
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => onApply({ bold: false })}
        title="Remover negrito"
      >
        <Bold className="h-4 w-4 opacity-40" />
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => onApply({ italic: true })}
      >
        <Italic className="h-4 w-4" />
      </Button>

      <span className="mx-1 h-6 w-px bg-border" />

      <Button
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => onApply({ align: "left" })}
      >
        <AlignLeft className="h-4 w-4" />
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => onApply({ align: "center" })}
      >
        <AlignCenter className="h-4 w-4" />
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => onApply({ align: "right" })}
      >
        <AlignRight className="h-4 w-4" />
      </Button>

      <span className="mx-1 h-6 w-px bg-border" />

      <label className="flex items-center gap-1 text-xs text-muted-foreground">
        Tam.
        <input
          type="number"
          min={6}
          max={48}
          defaultValue={11}
          disabled={disabled}
          onBlur={(e) => onApply({ fontSize: Number(e.target.value) })}
          className="w-14 rounded border border-border bg-background px-1 py-0.5 text-sm"
        />
      </label>

      <span className="mx-1 h-6 w-px bg-border" />

      <label className="flex items-center gap-1 text-xs text-muted-foreground" title="Cor de fundo">
        <PaintBucket className="h-4 w-4" />
        <input
          type="color"
          disabled={disabled}
          onChange={(e) => onApply({ fill: e.target.value.replace("#", "").toUpperCase() })}
          className="h-6 w-8 rounded border border-border bg-background"
        />
      </label>
      <label className="flex items-center gap-1 text-xs text-muted-foreground" title="Cor do texto">
        <Baseline className="h-4 w-4" />
        <input
          type="color"
          disabled={disabled}
          onChange={(e) => onApply({ color: e.target.value.replace("#", "").toUpperCase() })}
          className="h-6 w-8 rounded border border-border bg-background"
        />
      </label>

      <span className="mx-1 h-6 w-px bg-border" />

      <div className="flex items-center gap-1">
        {SWATCHES.map((hex) => (
          <button
            key={hex}
            disabled={disabled}
            title={`Fundo #${hex}`}
            onClick={() => onApply({ fill: hex })}
            className="h-5 w-5 rounded border border-border disabled:opacity-40"
            style={{ background: `#${hex}` }}
          />
        ))}
      </div>
    </div>
  );
}
