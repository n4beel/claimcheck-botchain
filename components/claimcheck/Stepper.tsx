"use client";

import { ReactNode } from "react";

export interface StepDefinition {
  number: number;
  title: string;
  summary?: ReactNode;
  content: ReactNode;
}

interface StepperProps {
  steps: StepDefinition[];
  currentStep: number;
  onEditStep?: (step: number) => void;
  allowEdit?: boolean;
}

/**
 * Archetype I · Vertical Stepper
 * Full-width bands with large italic numeral (~96px) in the left gutter,
 * thin connecting vertical line, active step expanded, completed collapsed with Edit link,
 * future steps dimmed.
 */
export default function Stepper({
  steps,
  currentStep,
  onEditStep,
  allowEdit = true,
}: StepperProps) {
  return (
    <div className="w-full flex flex-col space-y-0 relative">
      {steps.map((step, idx) => {
        const isCurrent = step.number === currentStep;
        const isPast = step.number < currentStep;
        const isFuture = step.number > currentStep;
        const isLast = idx === steps.length - 1;

        return (
          <div key={step.number} className="relative flex group">
            {/* Left Gutter: Numeral and vertical connecting rule */}
            <div className="w-20 md:w-28 flex-shrink-0 flex flex-col items-center relative select-none">
              {/* Connecting vertical line */}
              {!isLast && (
                <div
                  className={[
                    "absolute top-20 bottom-0 w-[1.5px] transition-colors",
                    isPast ? "bg-[#0E4D64]" : "bg-[#AFC8B4]",
                  ].join(" ")}
                  aria-hidden="true"
                />
              )}

              {/* Very large italic numeral */}
              <div
                className={[
                  "font-serif italic text-6xl md:text-8xl leading-none transition-colors",
                  isCurrent
                    ? "text-[#0E4D64] font-normal scale-105"
                    : isPast
                    ? "text-[#10261B]/60"
                    : "text-[#10261B]/20",
                ].join(" ")}
              >
                {step.number}
              </div>
            </div>

            {/* Right Body: Step Content */}
            <div className="flex-1 pb-10 md:pb-14 pl-4 md:pl-8">
              {/* Completed / Past Step: Collapsed to one line with check and Edit */}
              {isPast && (
                <div className="py-2.5 px-4 bg-[#EEF6EE] border border-[#AFC8B4] flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="w-5 h-5 rounded-full bg-[#0E4D64] text-white flex items-center justify-center text-xs font-mono">
                      ✓
                    </span>
                    <span className="font-serif text-lg font-medium text-[#10261B]">
                      {step.title}
                    </span>
                    {step.summary && (
                      <span className="text-xs font-sans text-[#46604F] pl-2 border-l border-[#AFC8B4]">
                        {step.summary}
                      </span>
                    )}
                  </div>
                  {allowEdit && onEditStep && (
                    <button
                      type="button"
                      onClick={() => onEditStep(step.number)}
                      className="text-xs font-sans uppercase tracking-wider text-[#0E4D64] hover:underline cursor-pointer"
                    >
                      Edit
                    </button>
                  )}
                </div>
              )}

              {/* Active Step: Fully expanded */}
              {isCurrent && (
                <div className="bg-[#EEF6EE] border-2 border-[#0E4D64] p-5 md:p-8 shadow-sm">
                  <div className="mb-6 pb-3 border-b border-[#AFC8B4] flex items-center justify-between">
                    <h2 className="font-serif text-2xl md:text-3xl text-[#10261B]">
                      {step.title}
                    </h2>
                    <span className="text-xs font-sans uppercase tracking-wider px-2 py-0.5 bg-[#0E4D64] text-white">
                      Active Step
                    </span>
                  </div>
                  {step.content}
                </div>
              )}

              {/* Future Step: Dimmed one-liner */}
              {isFuture && (
                <div className="py-3 px-4 border border-[#AFC8B4]/50 bg-[#DCEBDC]/50 opacity-60">
                  <span className="font-serif text-lg text-[#46604F]">
                    {step.title}
                  </span>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
