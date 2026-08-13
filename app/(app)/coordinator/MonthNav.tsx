"use client";

import { addMonths, parseDate } from "@/lib/time";
import type { DateString } from "@/lib/types";

/** Step2 / Step3 共通の月送り。両方とも「月単位でまとめて扱う」画面のため */
export function MonthNav({
  month,
  onChange,
  disabled,
}: {
  /** 'YYYY-MM-01' */
  month: DateString;
  onChange: (month: DateString) => void;
  disabled?: boolean;
}) {
  const { year, month: monthNumber } = parseDate(month);

  return (
    <nav className="flex items-center justify-between rounded-xl border border-[var(--border)] px-2 py-1">
      <button
        type="button"
        aria-label="前の月"
        disabled={disabled}
        onClick={() => onChange(addMonths(month, -1))}
        className="px-3 py-1 text-lg disabled:opacity-40"
      >
        ‹
      </button>
      <h2 className="text-base font-bold">
        {year}年{monthNumber}月
      </h2>
      <button
        type="button"
        aria-label="次の月"
        disabled={disabled}
        onClick={() => onChange(addMonths(month, 1))}
        className="px-3 py-1 text-lg disabled:opacity-40"
      >
        ›
      </button>
    </nav>
  );
}
