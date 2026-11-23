"use client";

import { followsMonth } from "@/lib/slots";

/** 「24・23期」「全期」 */
export function generationsLabel(value: number[] | null): string {
  return value && value.length > 0 ? `${value.join("・")}期` : "全期";
}

/**
 * コマごとの対象期 (SPEC §6.2 Step2-3 / v1.50.4)。
 *
 * 既定は「この月と同じ」。期を押すとこのコマだけの対象期になる。
 * クリパの練習のように、同じ月の中に「24期だけ」の回を作るため。
 */
export function SlotGenerationPicker({
  value,
  monthGenerations,
  candidates,
  disabled,
  onChange,
}: {
  value: number[] | "month";
  monthGenerations: number[] | null;
  candidates: number[];
  disabled: boolean;
  onChange: (value: number[] | "month") => void;
}) {
  const selected = value === "month" ? (monthGenerations ?? []) : value;
  const chip = (on: boolean) =>
    `rounded-full px-3 py-1.5 text-sm transition-colors disabled:opacity-40 ${
      on
        ? "bg-[var(--primary)] font-semibold text-[var(--primary-fg)]"
        : "bg-[var(--fill)]"
    }`;

  function toggle(generation: number) {
    const next = selected.includes(generation)
      ? selected.filter((g) => g !== generation)
      : [...selected, generation].sort((a, b) => b - a);
    onChange(followsMonth(next, monthGenerations) ? "month" : next);
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium">対象期</p>
        <span className="text-xs text-[var(--muted)]">
          {generationsLabel(selected.length > 0 ? selected : null)}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange("month")}
          aria-pressed={value === "month"}
          className={chip(value === "month")}
        >
          この月と同じ({generationsLabel(monthGenerations)})
        </button>
        {candidates.map((generation) => (
          <button
            key={generation}
            type="button"
            disabled={disabled}
            onClick={() => toggle(generation)}
            aria-pressed={value !== "month" && selected.includes(generation)}
            className={chip(value !== "month" && selected.includes(generation))}
          >
            {generation}期
          </button>
        ))}
      </div>
    </div>
  );
}
