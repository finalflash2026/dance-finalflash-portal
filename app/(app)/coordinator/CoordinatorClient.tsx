"use client";

import { useEffect, useState } from "react";

import { Segmented } from "@/components/ui";

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
  // 日程調整の案を下書きにしたあとは ?month=…&step=2 で来る (§6.8.4 / v1.36)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const target = params.get("month");
    if (target && /^\d{4}-\d{2}-01$/.test(target)) setMonth(target as DateString);
    if (params.get("step") === "2") setStep(2);
  }, []);

  return (
    <main className="mx-auto w-full max-w-[1600px] space-y-5 px-4 py-4">
      <h1 className="text-[28px] font-bold leading-tight">折衝ワークフロー</h1>
      {/* 割り振り (日程調整) へは上の運営の切り替えから (v1.39) */}
      <div className="max-w-2xl" data-tour="coord-steps">
        <Segmented
          label="折衝の手順"
          size="large"
          value={String(step) as "1" | "2" | "3"}
          options={STEPS.map((s) => ({ value: String(s.id) as "1" | "2" | "3", label: s.label }))}
          onChange={(value) => setStep(Number(value) as 1 | 2 | 3)}
        />
      </div>

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
