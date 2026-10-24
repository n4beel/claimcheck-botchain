"use client";

import { ButtonHTMLAttributes, forwardRef, ReactNode } from "react";

export type ButtonVariant = "stepper" | "secondary" | "outline" | "danger" | "text";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  arrow?: boolean;
  leftIcon?: ReactNode;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "stepper",
      size = "md",
      loading = false,
      arrow,
      leftIcon,
      disabled,
      children,
      className = "",
      ...props
    },
    ref
  ) => {
    const isStepper = variant === "stepper";
    const showArrow = arrow !== undefined ? arrow : isStepper;

    const sizeClasses: Record<ButtonSize, string> = {
      sm: "px-3.5 py-2 text-xs font-sans",
      md: "px-5 py-3 text-sm font-sans",
      lg: "px-6 py-4 text-base font-sans",
    };

    const variantClasses: Record<ButtonVariant, string> = {
      stepper:
        "w-full bg-[#0E4D64] hover:bg-[#083747] text-white border border-[#0E4D64] flex items-center justify-between font-medium tracking-wide transition-colors",
      secondary:
        "bg-[#EEF6EE] hover:bg-[#E4EFE4] text-[#10261B] border border-[#AFC8B4] inline-flex items-center justify-center gap-2 font-medium transition-colors",
      outline:
        "bg-transparent hover:bg-[#0E4D64]/10 text-[#0E4D64] border border-[#0E4D64] inline-flex items-center justify-center gap-2 font-medium transition-colors",
      danger:
        "bg-transparent hover:bg-amber-50 text-[#8A4B00] border border-[#8A4B00] inline-flex items-center justify-center gap-2 font-medium transition-colors",
      text:
        "bg-transparent hover:underline text-[#0E4D64] inline-flex items-center gap-1 font-medium p-0 border-0",
    };

    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={[
          sizeClasses[size],
          variantClasses[variant],
          "disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer",
          className,
        ].join(" ")}
        {...props}
      >
        <span className="inline-flex items-center gap-2">
          {loading ? (
            <span
              className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin inline-block"
              aria-hidden="true"
            />
          ) : (
            leftIcon
          )}
          <span>{children}</span>
        </span>
        {showArrow && !loading && (
          <span className="ml-4 font-mono text-base transition-transform group-hover:translate-x-1" aria-hidden="true">
            →
          </span>
        )}
      </button>
    );
  }
);

Button.displayName = "Button";
export default Button;
