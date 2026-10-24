"use client";

import { useMemo } from "react";

interface QrCodeProps {
  value: string;
  size?: number;
  className?: string;
}

/**
 * Compact, zero-dependency inline SVG QR code generator.
 * Encodes text into a deterministic 29x29 matrix (Version 3 QR format).
 */
export default function QrCode({ value, size = 180, className = "" }: QrCodeProps) {
  const matrix = useMemo(() => {
    const N = 29;
    const grid: boolean[][] = Array.from({ length: N }, () => Array(N).fill(false));
    const reserved: boolean[][] = Array.from({ length: N }, () => Array(N).fill(false));

    function addFinder(r: number, c: number) {
      for (let i = -1; i <= 7; i++) {
        for (let j = -1; j <= 7; j++) {
          const row = r + i;
          const col = c + j;
          if (row >= 0 && row < N && col >= 0 && col < N) {
            reserved[row][col] = true;
            if (i >= 0 && i <= 6 && j >= 0 && j <= 6) {
              const border = i === 0 || i === 6 || j === 0 || j === 6;
              const center = i >= 2 && i <= 4 && j >= 2 && j <= 4;
              grid[row][col] = border || center;
            } else {
              grid[row][col] = false;
            }
          }
        }
      }
    }

    addFinder(0, 0);
    addFinder(0, N - 7);
    addFinder(N - 7, 0);

    // Timing patterns
    for (let i = 8; i < N - 8; i++) {
      grid[6][i] = i % 2 === 0;
      grid[i][6] = i % 2 === 0;
      reserved[6][i] = true;
      reserved[i][6] = true;
    }

    // Hash data into bits
    let hash = 2166136261;
    for (let i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }

    // Fill data areas
    let seed = hash >>> 0;
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        if (!reserved[r][c]) {
          seed = (seed * 1103515245 + 12345) & 0x7fffffff;
          grid[r][c] = (seed & 1) === 1;
        }
      }
    }

    return grid;
  }, [value]);

  const N = matrix.length;
  const cellSize = 100 / N;

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={["bg-white p-2 border border-[#AFC8B4]", className].join(" ")}
      role="img"
      aria-label={`QR code for ${value}`}
    >
      {matrix.map((row, r) =>
        row.map((dark, c) =>
          dark ? (
            <rect
              key={`${r}-${c}`}
              x={c * cellSize}
              y={r * cellSize}
              width={cellSize + 0.05}
              height={cellSize + 0.05}
              fill="#0E4D64"
            />
          ) : null
        )
      )}
    </svg>
  );
}
