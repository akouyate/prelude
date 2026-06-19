import { cn } from "../lib/cn";

export type StepProgressProps = {
  current: number;
  total: number;
};

export function StepProgress({ current, total }: StepProgressProps) {
  const progress = Math.max(0, Math.min(100, (current / total) * 100));

  return (
    <div aria-label={`Step ${current} of ${total}`} className="w-full">
      <div className="mb-3 flex items-center justify-between text-xs font-medium text-ink-500">
        <span>Step {current} of {total}</span>
        <span>{Math.round(progress)}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-ink-100">
        <div
          className={cn("h-full rounded-full bg-olive-600 transition-all duration-300")}
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}
