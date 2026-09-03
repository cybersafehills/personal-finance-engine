"use client";

import { useMemo } from "react";
import { qrMatrix } from "../lib/qr";

/**
 * Renders `value` as a QR code: a real inline `<svg>` (no
 * dangerouslySetInnerHTML), dark modules in `currentColor`, light modules
 * transparent, with a quiet-zone margin. `role="img"` + `aria-label` so it is
 * announced, not just decorative.
 */
export function QrCode({
  value,
  label,
  className,
  moduleSize = 6,
  margin = 4,
}: {
  value: string;
  label: string;
  className?: string;
  moduleSize?: number;
  margin?: number;
}) {
  const matrix = useMemo(() => {
    try {
      return qrMatrix(value);
    } catch {
      return null;
    }
  }, [value]);

  if (!matrix) return null;

  const n = matrix.length;
  const dim = (n + margin * 2) * moduleSize;
  let d = "";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (matrix[r][c]) {
        const x = (c + margin) * moduleSize;
        const y = (r + margin) * moduleSize;
        d += `M${x} ${y}h${moduleSize}v${moduleSize}h-${moduleSize}z`;
      }
    }
  }

  return (
    <svg
      className={className}
      viewBox={`0 0 ${dim} ${dim}`}
      width={dim}
      height={dim}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <path d={d} fill="currentColor" />
    </svg>
  );
}
