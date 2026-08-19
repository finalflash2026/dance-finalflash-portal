"use client";

import { useState } from "react";

import { ImportStep } from "./ImportStep";
import { PublishStep } from "./PublishStep";
import { SlotStep } from "./SlotStep";

/**
 * 折衝ワークフローの Step 切り替え (SPEC.md §6.2)
 *
 * ①CSV取込 → ②コマ割り → ③公開 の順に進む前提だが、
 * 後から個別に直すことも多いので行き来は自由にしている。
 */
const STEPS = [
  { id: 1, label: "① CSV取込" },
  { id: 2, label: "② コマ割り" },
  { id: 3, label: "③ 公開" },
] as const;

export function CoordinatorClient() {
  const [step, setStep] = useState<1 | 2 | 3>(1);

  return (
    <main className="mx-auto max-w-2xl space-y-4 px-4 py-4">
      <h1 className="text-xl font-bold">折衝ワークフロー</h1>

      <nav className="flex gap-1 rounded-xl border border-[var(--border)] p-1">
        {STEPS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setStep(s.id)}
            aria-current={step === s.id ? "step" : undefined}
            className={`flex-1 rounded-lg px-2 py-2 text-sm font-medium ${
              step === s.id
                ? "bg-[var(--primary)] text-[var(--primary-fg)]"
                : "text-[var(--muted)]"
            }`}
          >
            {s.label}
          </button>
        ))}
      </nav>

      {step === 1 ? <ImportStep /> : step === 2 ? <SlotStep /> : <PublishStep />}
    </main>
  );
}
