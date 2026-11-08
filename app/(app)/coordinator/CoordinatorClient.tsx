"use client";

import { useEffect, useState } from "react";

import { Segmented } from "@/components/ui";

import { startOfMonth, todayInTokyo } from "@/lib/time";
import type { DateString } from "@/lib/types";

import type { ScheduleRound } from "@/lib/scheduling/round";
import type { PlanInput } from "@/lib/scheduling/types";

import { DraftDoneContext, PlanPanel } from "../schedule/ScheduleClient";
import { ImportStep } from "./ImportStep";
import { PublishStep } from "./PublishStep";
import { SlotStep } from "./SlotStep";

/**
 * 折衝ワークフローの Step 切り替え (SPEC.md §6.2)
 *
 * ①取込 → ②割り振り (日程調整の回答から。v1.42) → ③コマ割り → ④公開 の順に進む前提だが、
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
type Step = "import" | "plan" | "slots" | "publish";

const STEPS: { id: Step; label: string }[] = [
  { id: "import", label: "① 取込" },
  { id: "plan", label: "② 割り振り" },
  { id: "slots", label: "③ コマ割り" },
  { id: "publish", label: "④ 公開" },
];

/** 前の URL (?step=2 はコマ割り) も読む */
function stepFromParam(value: string | null): Step | null {
  if (value === "2") return "slots";
  return STEPS.some((s) => s.id === value) ? (value as Step) : null;
}

export interface CoordinatorPlan {
  round: ScheduleRound;
  input: PlanInput;
  me?: string;
  storageKey?: string;
}

export function CoordinatorClient({ plan }: { plan?: CoordinatorPlan }) {
  const [step, setStep] = useState<Step>("import");
  const [month, setMonth] = useState<DateString>(() => startOfMonth(todayInTokyo()));
  // ?month=…&step=… で来たらその月・手順から (割り振りの案を下書きにしたあと等)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const target = params.get("month");
    if (target && /^\d{4}-\d{2}-01$/.test(target)) setMonth(target as DateString);
    const fromUrl = stepFromParam(params.get("step"));
    if (fromUrl) setStep(fromUrl);
  }, []);

  // 割り振りの回答 (デモでは見ている人の回答を端末に保存している。v1.35)
  const [planInput, setPlanInput] = useState(plan?.input);
  useEffect(() => {
    if (!plan?.storageKey || !plan.me) return;
    try {
      const raw = localStorage.getItem(plan.storageKey);
      if (!raw) return;
      const saved = JSON.parse(raw);
      setPlanInput((prev) =>
        prev ? { ...prev, answers: { ...prev.answers, [plan.me!]: saved } } : prev,
      );
    } catch {}
  }, [plan?.storageKey, plan?.me]);

  return (
    <main className="mx-auto w-full max-w-[1600px] space-y-5 px-4 py-4">
      <h1 className="text-[28px] font-bold leading-tight">折衝ワークフロー</h1>
      <div className="max-w-2xl" data-tour="coord-steps">
        <Segmented
          label="折衝の手順"
          size="large"
          value={step}
          options={STEPS.map((s) => ({ value: s.id, label: s.label }))}
          onChange={setStep}
        />
      </div>

      {step === "slots" ? (
        <SlotStep month={month} onMonthChange={setMonth} />
      ) : step === "plan" ? (
        <div className="max-w-3xl" data-tour="coord-body">
          {plan && planInput ? (
            <DraftDoneContext.Provider
              value={(drafted) => {
                // 下書きにした月を選んだまま③へ
                setMonth(drafted as DateString);
                setStep("slots");
                window.scrollTo({ top: 0 });
              }}
            >
              <PlanPanel input={planInput} round={plan.round} />
            </DraftDoneContext.Provider>
          ) : (
            <p className="rounded-2xl bg-[var(--cell)] px-4 py-8 text-center text-sm text-[var(--muted)]">
              受付中の日程調整がありません
            </p>
          )}
        </div>
      ) : (
        <div className="max-w-2xl" data-tour="coord-body">
          {step === "import" ? (
            <ImportStep onImported={setMonth} onNext={() => setStep(plan ? "plan" : "slots")} />
          ) : (
            <PublishStep month={month} onMonthChange={setMonth} />
          )}
        </div>
      )}
    </main>
  );
}
