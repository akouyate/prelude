import type { ReactNode } from "react";
import { ArrowLeft, ArrowRight, Check, Sparks as Sparkles } from "iconoir-react";
import { Button, cn } from "@prelude/ui";

export type InterviewBuilderStep<TStep extends string> = {
  id: TStep;
  label: string;
  title: string;
};

export function InterviewBuilderBreadcrumb({
  isSaved = false,
  roleTitle,
}: {
  isSaved?: boolean;
  roleTitle: string;
}) {
  return (
    <div className="col-span-full flex items-center justify-between gap-4">
      <a
        className="inline-flex min-w-0 cursor-pointer items-center gap-2 text-[13px] font-semibold text-ink-500 transition hover:text-ink-950"
        href="/"
      >
        <ArrowLeft aria-hidden={true} className="h-4 w-4 shrink-0" />
        <span className="truncate">{roleTitle}</span>
        <span className="shrink-0 text-ink-200">/</span>
        <span className="shrink-0 text-ink-950">Edit role screen</span>
      </a>
      {isSaved ? (
        <span className="hidden shrink-0 items-center gap-1.5 text-[12.5px] text-ink-500 sm:inline-flex">
          <Check aria-hidden={true} className="h-3.5 w-3.5 text-olive-700" />
          Draft saved
        </span>
      ) : null}
    </div>
  );
}

export function InterviewBuilderStepRail<TStep extends string>({
  currentStep,
  onStepChange,
  steps,
}: {
  currentStep: TStep;
  onStepChange: (step: TStep) => void;
  steps: Array<InterviewBuilderStep<TStep>>;
}) {
  const currentIndex = steps.findIndex((step) => step.id === currentStep);

  return (
    <nav
      aria-label="Role screen draft progress"
      className="sticky top-7 hidden self-start lg:block"
    >
      <p className="mb-[18px] text-[11px] font-bold uppercase tracking-[0.13em] text-ink-400">
        Role screen setup
      </p>
      <ol className="flex flex-col">
        {steps.map((step, index) => {
          const current = step.id === currentStep;
          const complete = index < currentIndex;

          return (
            <li className="flex gap-[13px]" key={step.id}>
              <span className="flex shrink-0 flex-col items-center">
                <button
                  className={cn(
                    "grid h-7 w-7 cursor-pointer place-items-center rounded-full border text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300",
                    complete
                      ? "border-ink-900 bg-ink-900 text-white"
                      : current
                        ? "border-[#cdd6b4] bg-[#eef0e3] text-olive-900"
                        : "border-[#ddd8cc] bg-white text-ink-400",
                  )}
                  onClick={() => onStepChange(step.id)}
                  type="button"
                >
                  {complete ? (
                    <Check aria-hidden={true} className="h-3.5 w-3.5" />
                  ) : (
                    index + 1
                  )}
                </button>
                {index < steps.length - 1 ? (
                  <span
                    className={cn(
                      "h-[26px] w-0.5",
                      complete ? "bg-ink-900" : "bg-[#e2ddd2]",
                    )}
                  />
                ) : null}
              </span>
              <button
                className={cn(
                  "h-7 cursor-pointer bg-transparent pt-0.5 text-left text-[13.5px] transition",
                  current
                    ? "font-bold text-ink-950"
                    : complete
                      ? "font-medium text-ink-600"
                      : "font-medium text-ink-400",
                )}
                onClick={() => onStepChange(step.id)}
                type="button"
              >
                {step.label}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function InterviewBuilderMobileProgress<TStep extends string>({
  currentStep,
  steps,
}: {
  currentStep: TStep;
  steps: Array<InterviewBuilderStep<TStep>>;
}) {
  const currentIndex = steps.findIndex((step) => step.id === currentStep);
  const safeIndex = Math.max(currentIndex, 0);

  return (
    <nav aria-label="Role screen draft progress" className="mb-8 lg:hidden">
      <div className="flex items-center justify-between text-xs font-semibold text-ink-500">
        <span>{steps[safeIndex]?.label}</span>
        <span>
          {safeIndex + 1}/{steps.length}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-100">
        <div
          className="h-full rounded-full bg-olive-800 transition-all"
          style={{ width: `${((safeIndex + 1) / steps.length) * 100}%` }}
        />
      </div>
    </nav>
  );
}

export function InterviewBuilderAgentCard({
  isThinking = false,
  message,
}: {
  isThinking?: boolean;
  message: string;
}) {
  return (
    <div className="relative flex gap-3.5 rounded-[18px] border border-[#e7e2d8] bg-[#fbfaf7] px-[17px] py-[15px]">
      <span className="relative grid h-9 w-9 shrink-0 place-items-center">
        <span
          className={cn(
            "absolute -inset-0.5 rounded-full bg-[conic-gradient(from_0deg,#5d8f64,#b6c39a,#5d8f64)] opacity-40",
            isThinking ? "animate-spin" : "",
          )}
        />
        <span className="relative grid h-9 w-9 place-items-center rounded-full bg-ink-900 text-white">
          <Sparkles aria-hidden={true} className="h-[18px] w-[18px]" />
        </span>
      </span>
      <div className="min-w-0 pt-px">
        <p className="flex items-center gap-2 text-[11.5px] font-bold uppercase tracking-[0.06em] text-ink-400">
          Prelude agent
          {isThinking ? (
            <span className="inline-flex gap-1">
              <span className="h-1 w-1 animate-pulse rounded-full bg-olive-700" />
              <span className="h-1 w-1 animate-pulse rounded-full bg-olive-700 [animation-delay:150ms]" />
              <span className="h-1 w-1 animate-pulse rounded-full bg-olive-700 [animation-delay:300ms]" />
            </span>
          ) : null}
        </p>
        <p className="mt-1 max-w-[62ch] text-sm leading-[1.55] text-ink-700">
          {message}
        </p>
      </div>
    </div>
  );
}

export function InterviewBuilderStepHeader({
  badges,
  stepIndex,
  stepTitle,
  totalSteps,
}: {
  badges?: ReactNode;
  stepIndex: number;
  stepTitle: string;
  totalSteps: number;
}) {
  return (
    <div className="mt-[26px] flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="text-[12.5px] font-semibold text-ink-400">
          Step {stepIndex + 1} of {totalSteps}
        </p>
        <h1 className="mt-2 text-[clamp(24px,3vw,30px)] font-semibold leading-[1.1] tracking-[-0.02em] text-ink-950">
          {stepTitle}
        </h1>
      </div>
      {badges ? <div className="flex flex-wrap gap-1.5">{badges}</div> : null}
    </div>
  );
}

export function InterviewBuilderFooter<TStep extends string>({
  canGoBack,
  currentStep,
  isWorking,
  onBack,
  onNext,
}: {
  canGoBack: boolean;
  currentStep: TStep;
  isWorking: boolean;
  onBack: () => void;
  onNext: () => void;
}) {
  const nextLabels: Partial<Record<TStep, string>> = {
    brief: "Calibrate",
    calibrate: "Draft questions",
    evaluation: "Save and publish",
    questions: "Review evaluation",
  } as Partial<Record<TStep, string>>;

  if (currentStep === "share") {
    return null;
  }

  const workingLabel =
    currentStep === "calibrate" || currentStep === "questions"
      ? "Drafting..."
      : "Saving...";

  return (
    <div className="mt-[34px] flex items-center justify-between gap-3 border-t border-[#e7e2d8] pt-[22px]">
      <Button disabled={!canGoBack || isWorking} variant="secondary" onClick={onBack}>
        <ArrowLeft aria-hidden={true} className="h-4 w-4" />
        Back
      </Button>
      <Button disabled={isWorking} onClick={onNext}>
        {isWorking ? workingLabel : (nextLabels[currentStep] ?? "Continue")}
        {currentStep === "calibrate" ? (
          <Sparkles aria-hidden={true} className="h-4 w-4" />
        ) : (
          <ArrowRight aria-hidden={true} className="h-4 w-4" />
        )}
      </Button>
    </div>
  );
}
