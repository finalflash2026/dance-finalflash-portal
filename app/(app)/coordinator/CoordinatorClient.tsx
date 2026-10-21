"use client";

import Link from "next/link";
import { useState } from "react";

import { hasSupabaseEnv } from "@/lib/env";
import { startOfMonth, todayInTokyo } from "@/lib/time";
import type { DateString } from "@/lib/types";

import { ImportStep } from "./ImportStep";
import { PublishStep } from "./PublishStep";
import { SlotStep } from "./SlotStep";

/**
 * 折衝ワークフローの Step 切り替え (SPEC.md §6.2)
 *
 * ①CSV取込 → ②コマ割り → ③公開 の順に進む前提だが、
 * 後から個別に直すことも多いので行き来は自由にしている。
 *
 * **この画面だけは PC を前提に組む** (v1.28)。他の画面はスマホ最優先だが、
 * 折衝の作業は1か月ぶんの表を見渡しながら進めるもので、実際に折衝係も
 * PC で作業している。②のコマ割り表は画面幅をそのまま使う。
 * ①③は縦に読む画面なので、これまでどおり中央に寄せて幅を抑える。
 *
 * **対象の月は3つの Step で共有する** (v1.32.6)。①で来月の CSV を確定してから
 * ②③を開くたびに今月へ戻っていた。①の確定で取り込んだ月に合わせる。
 */
const STEPS = [
  { id: 1, label: "① CSV取込" },
  { id: 2, label: "② コマ割り" },
  { id: 3, label: "③ 公開" },
] as const;

export function CoordinatorClient() {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [month, setMonth] = useState<DateString>(() => startOfMonth(todayInTokyo()));

  return (
    <main className="mx-auto w-full max-w-[1600px] space-y-4 px-4 py-4">
      <h1 className="text-xl font-bold">折衝ワークフロー</h1>
      {/* 日程調整 (§6.8 / v1.32)。いまは手元の環境の見本だけ */}
      {!hasSupabaseEnv() ? (
        <Link
          href="/schedule"
          className="flex max-w-2xl items-center justify-between rounded-xl bg-[var(--cell)] px-4 py-3 text-[15px]"
        >
          <span>
            <span className="block font-semibold">日程調整から割り振る</span>
            <span className="block text-[13px] text-[var(--muted)]">メンバーの出られる日から、ジャンルの割り振り案を作る</span>
          </span>
          <span aria-hidden className="text-[var(--muted)]">›</span>
        </Link>
      ) : null}

      <nav
        className="flex max-w-2xl gap-1 rounded-xl border border-[var(--border)] p-1"
        data-tour="coord-steps"
      >
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

      {step === 2 ? (
        <SlotStep month={month} onMonthChange={setMonth} />
      ) : (
        <div className="max-w-2xl" data-tour="coord-body">
          {step === 1 ? (
            <ImportStep
              onImported={setMonth}
              onNext={() => setStep(2)}
            />
          ) : (
            <PublishStep month={month} onMonthChange={setMonth} />
          )}
        </div>
      )}
    </main>
  );
}
