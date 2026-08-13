"use client";

import { useState } from "react";

import { ImportStep } from "./ImportStep";

/**
 * 折衝ワークフローの Step 切り替え (SPEC.md §6.2)
 *
 * Step2 (コマ割りエディタ) と Step3 (公開) は次の PR で実装する。
 * Step1 だけでも「予約枠を DB に入れる」までは通せるので、先に出しておく。
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
                ? "bg-[var(--foreground)] text-white"
                : "text-[var(--muted)]"
            }`}
          >
            {s.label}
          </button>
        ))}
      </nav>

      {step === 1 ? <ImportStep /> : <ComingSoon step={step} />}
    </main>
  );
}

function ComingSoon({ step }: { step: 2 | 3 }) {
  return (
    <section className="rounded-xl border border-[var(--border)] px-4 py-8 text-center">
      <p className="text-sm font-medium">
        {step === 2 ? "コマ割りエディタ" : "月一括公開"}
      </p>
      <p className="mt-2 text-sm text-[var(--muted)]">
        SPEC.md §6.2 Step{step} — 次のPRで実装します
      </p>
    </section>
  );
}
