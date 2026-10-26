"use client";

import { useMemo } from "react";
import qrcode from "qrcode-generator";

interface QrCodeProps {
  value: string;
  size?: number;
  className?: string;
}

/**
 * Real QR code component using qrcode-generator.
 *
 * Encodes value with Error Correction Level M and a 4-module quiet zone.
 * Renders high-contrast black modules (#000000) on white background (#FFFFFF)
 * at a minimum dimension of 200px for optical scanner reliability.
 */
export default function QrCode({ value, size = 200, className = "" }: QrCodeProps) {
  const { moduleCount, isDark } = useMemo(() => {
    if (!value) {
      return { moduleCount: 0, isDark: () => false };
    }
    // Type 0 = auto-detect version that fits data
    const qr = qrcode(0, "M");
    qr.addData(value);
    qr.make();
    return {
      moduleCount: qr.getModuleCount(),
      isDark: (r: number, c: number) => qr.isDark(r, c),
    };
  }, [value]);

  if (!value || moduleCount === 0) {
    return null;
  }

  // 4-module quiet zone per specification
  const quietZone = 4;
  const totalModules = moduleCount + quietZone * 2;
  const renderedSize = Math.max(200, size);

  // Build rects for dark modules
  const rects: { x: number; y: number }[] = [];
  for (let r = 0; r < moduleCount; r++) {
    for (let c = 0; c < moduleCount; c++) {
      if (isDark(r, c)) {
        rects.push({ x: c + quietZone, y: r + quietZone });
      }
    }
  }

  return (
    <svg
      viewBox={`0 0 ${totalModules} ${totalModules}`}
      width={renderedSize}
      height={renderedSize}
      className={["bg-white border border-[#AFC8B4] inline-block", className].join(" ")}
      role="img"
      aria-label={`QR code for ${value}`}
    >
      <rect width={totalModules} height={totalModules} fill="#FFFFFF" />
      {rects.map((pt) => (
        <rect
          key={`${pt.y}-${pt.x}`}
          x={pt.x}
          y={pt.y}
          width={1}
          height={1}
          fill="#000000"
        />
      ))}
    </svg>
  );
}
