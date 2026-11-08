"use client";

import { useEffect, useState } from "react";

import { Segmented } from "@/components/ui";

import { startOfMonth, todayInTokyo } from "@/lib/time";
import type { DateString } from "@/lib/types";

import type { ScheduleRound } from "@/lib/scheduling/round";
import type { PlanInput } from "@/lib/scheduling/types";

import { DraftDoneContext, PlanPanel } from "../schedule/ScheduleClient";
import { ImportStep } from "./ImportStep";
import { RoundPanel } from "./RoundPanel";
import { PublishStep } from "./PublishStep";
import { SlotStep } from "./SlotStep";

/**
 * 折衝ワークフローの Step 切り替え (SPEC.md §6.2)
 *
 * ①取込 → ②コマ割り → ③公開 の順に進む前提だが、
 * 後から個別に直すことも多いので行き来は自由にしている。
 * 日程調整の回があるときは、②の表の上に「{n}月の回答から案を作る」を出し、
 * 同じ画面の中で割り振りの案を作って下書きに入れられる (v1.43)。
 *
 * **この画面だけは PC を前提に組む** (v1.28)。他の画面はスマホ最優先だが、
 * 折衝の作業は1か月ぶんの表を見渡しながら進めるもので、実際に折衝係も
 * PC で作業している。②のコマ割り表は画面幅をそのまま使う。
 * ①③は縦に読む画面なので、これまでどおり中央に寄せて幅を抑える。
 *
 * **対象の月は3つの Step で共有する** (v1.32.6)。①で来月の CSV を確定してから
 * ②③を開くたびに今月へ戻っていた。①の確定で取り込んだ月に合わせる。
 */
type Step = "import" | "slots" | "publish";

const STEPS: { id: Step; label: string }[] = [
  { id: "import", label: "① 取込" },
  { id: "slots", label: "② コマ割り" },
  { id: "publish", label: "③ 公開" },
];

/** 前の URL (?step=2・?step=plan はコマ割り) も読む */
function stepFromParam(value: string | null): Step | null {
  if (value === "2" || value === "plan") return "slots";
  return STEPS.some((s) => s.id === value) ? (value as Step) : null;
}

export interface CoordinatorPlan {
  round: ScheduleRound;
  input: PlanInput;
  me?: string;
  storageKey?: string;
}

export function CoordinatorClient({
  plan,
  openRoundMonth,
}: {
  /** 見本の割り振り (Supabase の無い環境だけ)。DB のある環境は RoundPanel が読む */
  plan?: CoordinatorPlan;
  /** 受付中の日程調整の月 (?step=plan で来たときにその月を開く。v1.44) */
  openRoundMonth?: DateString | null;
}) {
  const [step, setStep] = useState<Step>("import");
  const [month, setMonth] = useState<DateString>(() => startOfMonth(todayInTokyo()));
  const [planOpen, setPlanOpen] = useState(false);
  const [slotRevision, setSlotRevision] = useState(0);
  // ?month=…&step=… で来たらその月・手順から (割り振りの案を下書きにしたあと等)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const target = params.get("month");
    const rawStep = params.get("step");
    if (target && /^\d{4}-\d{2}-01$/.test(target)) {
      setMonth(target as DateString);
    } else if (rawStep === "plan" && (openRoundMonth ?? plan?.round.month)) {
      setMonth((openRoundMonth ?? plan?.round.month) as DateString);
    }
    const fromUrl = stepFromParam(rawStep);
    if (fromUrl) setStep(fromUrl);
    if (rawStep === "plan") setPlanOpen(true);
  }, [plan?.round.month, openRoundMonth]);

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

  const planMonthLabel = plan ? `${Number(plan.round.month.slice(5, 7))}月` : "";

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
        <div className="space-y-4">
          {plan && planInput ? (
            // 見本 (Supabase の無い環境)。回は決まった見本の月
            <div className="max-w-3xl space-y-3">
              <button
                type="button"
                aria-expanded={planOpen}
                onClick={() => {
                  const next = !planOpen;
                  setPlanOpen(next);
                  if (next) setMonth(plan.round.month as DateString);
                }}
                className="flex h-11 items-center gap-2 rounded-xl bg-[var(--cell)] px-4 text-[15px] font-semibold text-[var(--tint)] active:opacity-70"
              >
                <span>{planMonthLabel}の回答から案を作る</span>
                <span aria-hidden className={`text-[16px] transition-transform ${planOpen ? "rotate-90" : ""}`}>
                  ›
                </span>
              </button>
              {planOpen ? (
                <DraftDoneContext.Provider
                  value={(drafted) => {
                    setMonth(drafted as DateString);
                    setPlanOpen(false);
                    setSlotRevision((r) => r + 1);
                    window.scrollTo({ top: 0 });
                  }}
                >
                  <PlanPanel input={planInput} round={plan.round} />
                </DraftDoneContext.Provider>
              ) : null}
            </div>
          ) : (
            // 表で選んでいる月の日程調整 (始める・締め切る・案を作る。v1.44)
            <RoundPanel
              key={month}
              month={month}
              initialPlanOpen={planOpen}
              onDrafted={() => {
                setSlotRevision((r) => r + 1);
                window.scrollTo({ top: 0 });
              }}
            />
          )}
          <SlotStep key={slotRevision} month={month} onMonthChange={setMonth} />
        </div>
      ) : (
        <div className="max-w-2xl" data-tour="coord-body">
          {step === "import" ? (
            <ImportStep onImported={setMonth} onNext={() => setStep("slots")} />
          ) : (
            <PublishStep month={month} onMonthChange={setMonth} />
          )}
        </div>
      )}
    </main>
  );
}
