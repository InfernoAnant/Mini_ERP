import { useCallback, useEffect, useRef, useState } from 'react';
import type { Progress } from '../api/types';
import EndConfetti from './EndConfetti';

const fillOf = (percent: number, i: number) => Math.max(0, Math.min(1, (percent - 25 * i) / 25));

/** Game-style level bar. `lg` on order pages (4 labelled segments), `sm` in lists and kanban. */
export default function LevelBar({
  progress,
  size,
  celebrate = false,
  onCelebrated,
}: {
  progress: Progress;
  size: 'lg' | 'sm';
  celebrate?: boolean;
  onCelebrated?: () => void;
}) {
  const tone = progress.cancelled ? 'bg-slate-300' : progress.complete ? 'bg-emerald-500' : 'bg-indigo-600';

  if (size === 'sm') {
    return (
      <div
        className="flex min-w-[7rem] items-center gap-2"
        title={progress.cancelled ? 'Cancelled' : `${progress.stage} · ${progress.percent}%`}
      >
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200">
          <div className={`h-full rounded-full ${tone}`} style={{ width: `${progress.cancelled ? 100 : progress.percent}%` }} />
        </div>
        <span className="w-9 text-right text-xs tabular-nums text-slate-500">
          {progress.cancelled ? '—' : `${progress.percent}%`}
        </span>
      </div>
    );
  }

  return (
    <div className="card mb-4 px-5 py-4" aria-label={`Progress: ${progress.stage}, ${progress.percent}%`}>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="text-sm font-semibold text-slate-800">
          {progress.cancelled
            ? 'Cancelled'
            : progress.complete
              ? 'Complete! 🎉'
              : `Level ${progress.level} of 4 · ${progress.stage}`}
        </span>
        <span className={`text-sm font-semibold tabular-nums ${progress.complete ? 'text-emerald-600' : 'text-indigo-700'}`}>
          {progress.cancelled ? '' : `${progress.percent}%`}
        </span>
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {progress.stages.map((stage, i) => {
          const fill = progress.cancelled ? 0 : fillOf(progress.percent, i);
          const last = i === progress.stages.length - 1;
          return (
            <div key={stage}>
              <div className="relative">
                <div
                  className={`h-3 overflow-hidden rounded-full ${progress.cancelled ? 'bg-slate-200' : 'bg-slate-100'} ring-1 ring-inset ring-slate-200`}
                >
                  <div
                    className={`h-full rounded-full transition-[width] duration-700 ease-out ${tone}`}
                    style={{ width: `${fill * 100}%` }}
                  />
                </div>
                {last && celebrate && <EndConfetti onDone={() => onCelebrated?.()} />}
              </div>
              <div className={`mt-1 truncate text-xs ${fill === 1 ? 'font-medium text-slate-700' : 'text-slate-400'}`}>
                {fill === 1 ? '✓ ' : ''}
                {stage}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * True right after `progress` reaches 100% *during this page visit* (e.g. a delivery was just confirmed).
 * Never true on first load, so reopening a finished order doesn't replay the celebration.
 */
export function useCelebration(progress: Progress | undefined, key: string): { celebrate: boolean; done: () => void } {
  const prev = useRef<{ key: string; percent: number } | null>(null);
  const [celebrate, setCelebrate] = useState(false);
  useEffect(() => {
    if (!progress) return;
    const last = prev.current;
    if (last && last.key !== key) setCelebrate(false); // switched to another order: never carry a burst over
    if (last && last.key === key && last.percent < 100 && progress.percent === 100 && !progress.cancelled) setCelebrate(true);
    prev.current = { key, percent: progress.percent };
  }, [progress, key]);
  const done = useCallback(() => setCelebrate(false), []);
  return { celebrate, done };
}
