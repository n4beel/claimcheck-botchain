import { HTMLAttributes } from "react";

export type PanelVariant = "default" | "register" | "band" | "inset" | "alert";

interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  variant?: PanelVariant;
  noPadding?: boolean;
}

/**
 * Claimcheck Stepper Panel / Register Sheet
 * Archetype I Stepper styling with hairline rules and cheque register surface (#EEF6EE).
 */
export default function Panel({
  variant = "default",
  noPadding,
  children,
  className = "",
  style,
  ...props
}: PanelProps) {
  const variantStyles: Record<PanelVariant, string> = {
    default: "bg-[var(--bg-surface)] border border-[var(--border-subtle)]",
    register:
      "bg-[var(--bg-surface)] border border-[var(--border-default)] shadow-[0_1px_2px_rgba(16,38,27,0.04)]",
    band: "bg-transparent border-t border-b border-[var(--border-subtle)]",
    inset: "bg-[var(--bg-elevated)] border border-[var(--border-subtle)]",
    alert: "bg-[#FBF6ED] border border-[#E0C59E] text-[var(--warn)]",
  };

  return (
    <div
      className={[
        variantStyles[variant],
        noPadding ? "" : "p-5 md:p-6",
        className,
      ].join(" ")}
      style={style}
      {...props}
    >
      {children}
    </div>
  );
}
