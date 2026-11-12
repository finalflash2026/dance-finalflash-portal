"use client";

import { useEffect, useMemo, useState } from "react";

import { useSchemaV2 } from "@/lib/schema-context";
import { buildAvailability } from "@/lib/scheduling/availability";
import type { ScheduleRound } from "@/lib/scheduling/round";
import type { PlanInput } from "@/lib/scheduling/types";
import { startOfMonth, todayInTokyo } from "@/lib/time";
import type { DateString } from "@/lib/types";

import { ImportStep } from "./ImportStep";
import { MonthNav } from "./MonthNav";
import { PublishStep } from "./PublishStep";
import { AutoAllocate, RoundStep, isAccepting, useMonthPlan } from "./RoundPanel";
import { SlotStep } from "./SlotStep";
import { useMonthReservations } from "./useMonthReservations";

/**
 * 折衝の画面 (SPEC.md §6.2 / v1.47)
 *
 * 仕事の順に ① 予約 → ② 日程調整 → ③ 割り振り → ④ 公開。
 * **月は一番上で1つだけ選び、4つの手順で共有する。** 手順のボタンにはその月の状態を数で出す。
 *
 * **この画面だけは PC を前提に組む** (v1.28)。③の表は画面幅をそのまま使い、
 * ほかの手順は縦に読む画面なので幅を抑える。
 */
type Step = "import" | "round" | "allocate" | "publish";

const STEPS: { id: Step; label: string }[] = [
  { id: "import", label: "予約" },
  { id: "round", label: "日程調整" },
  { id: "allocate", label: "割り振り" },
  { id: "publish", label: "公開" },
];

/** 前の URL (?step=slots・2・plan は割り振り) も読む */
function stepFromParam(value: string | null): Step | null {
  if (value === "slots" || value === "2" || value === "plan") return "allocate";
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
  /** 見本の割り振り (Supabase の無い環境だけ) */
  plan?: CoordinatorPlan;
  /** 受付中の日程調整の月 (?step=plan で来たときにその月を開く。v1.44) */
  openRoundMonth?: DateString | null;
}) {
  const [step, setStep] = useState<Step>("import");
  // 日程調整の表は DB の 0028 から (v1.49)。済んでいない DB では手順から外す
  const schemaV2 = useSchemaV2();
  const steps = schemaV2 ? STEPS : STEPS.filter((s) => s.id !== "round");
  const [month, setMonth] = useState<DateString>(() => startOfMonth(todayInTokyo()));
  const [autoOpen, setAutoOpen] = useState(false);
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
    if (fromUrl) setStep(fromUrl === "round" && !schemaV2 ? "allocate" : fromUrl);
    if (rawStep === "plan") setAutoOpen(true);
  }, [plan?.round.month, openRoundMonth, schemaV2]);

  // 見本の回答 (見ている人の回答は端末に保存している。v1.35)
  const [demoInput, setDemoInput] = useState(plan?.input);
  useEffect(() => {
    if (!plan?.storageKey || !plan.me) return;
    try {
      const raw = localStorage.getItem(plan.storageKey);
      if (!raw) return;
      const saved = JSON.parse(raw);
      setDemoInput((prev) => (prev ? { ...prev, answers: { ...prev.answers, [plan.me!]: saved } } : prev));
    } catch {}
  }, [plan?.storageKey, plan?.me]);
  const demo = useMemo(
    () => (plan && demoInput ? { round: plan.round, input: demoInput } : undefined),
    [plan, demoInput],
  );

  const monthPlan = useMonthPlan(month, demo);
  const reservations = useMonthReservations(month);
  const availability = useMemo(() => buildAvailability(monthPlan.input), [monthPlan.input]);

  // 手順を切り替えたら数を読み直す (③で置いたコマ・④で公開したものを手順のボタンに出す)
  const { reload: reloadReservations } = reservations;
  useEffect(() => {
    void reloadReservations();
  }, [step, slotRevision, reloadReservations]);

  const status = useMemo(() => {
    const slots = reservations.reservations.flatMap((r) => r.slots);
    const genreSlots = slots.filter((s) => s.status === "genre").length;
    const drafts = slots.filter((s) => !s.published).length;
    const round = monthPlan.round;
    return {
      import: reservations.reservations.length ? `${reservations.reservations.length}枠` : "なし",
      round: round
        ? isAccepting(round)
          ? `${round.answeredCount}/${round.memberCount}人`
          : "締切済み"
        : "なし",
      allocate: genreSlots ? `${genreSlots}コマ` : "—",
      publish: drafts ? `下書き ${drafts}` : slots.length ? "公開済み" : "—",
    } satisfies Record<Step, string>;
  }, [reservations.reservations, monthPlan.round]);

  const wide = step === "allocate";

  return (
    <main className="mx-auto w-full max-w-[1600px] space-y-4 px-4 py-4">
      <h1 className="sr-only">折衝</h1>
      <div className="mx-auto max-w-3xl space-y-3">
        <MonthNav month={month} onChange={setMonth} />
        <nav
          aria-label="折衝の手順"
          className={`grid gap-1.5 ${steps.length === 4 ? "grid-cols-4" : "grid-cols-3"}`}
          data-tour="coord-steps"
        >
          {steps.map((s, index) => {
            const on = step === s.id;
            return (
              <button
                key={s.id}
                type="button"
                aria-current={on ? "step" : undefined}
                onClick={() => setStep(s.id)}
                className={`rounded-2xl px-3 py-2.5 text-left transition-[background-color,box-shadow] ${
                  on ? "bg-[var(--background)] shadow-[0_0_0_2px_var(--tint)]" : "bg-[var(--cell)] active:opacity-70"
                }`}
              >
                <span className="flex items-center gap-1.5 text-[15px] font-semibold">
                  <span
                    aria-hidden
                    className={`grid h-5 w-5 place-items-center rounded-full text-[11px] font-bold ${
                      on ? "bg-[var(--tint)] text-white" : "bg-[var(--fill)] text-[var(--muted)]"
                    }`}
                  >
                    {index + 1}
                  </span>
                  {s.label}
                </span>
                <span className="mt-0.5 block truncate text-[13px] text-[var(--muted)] tabular-nums">
                  {status[s.id]}
                </span>
              </button>
            );
          })}
        </nav>
      </div>

      <div className={wide ? "" : "mx-auto max-w-3xl"} data-tour="coord-body">
        {step === "import" ? (
          <ImportStep
            onImported={(imported) => {
              setMonth(imported);
              void monthPlan.reload();
            }}
            onNext={() => setStep(schemaV2 ? "round" : "allocate")}
            nextLabel={schemaV2 ? "日程調整へ" : "割り振りへ"}
          />
        ) : step === "round" ? (
          <RoundStep
            month={month}
            plan={monthPlan}
            demo={Boolean(demo)}
            onNext={() => setStep("allocate")}
            onImport={() => setStep("import")}
          />
        ) : step === "allocate" ? (
          <SlotStep
            key={`${month}-${slotRevision}`}
            month={month}
            availability={availability}
            header={
              <AutoAllocate
                key={month}
                month={month}
                plan={monthPlan}
                initialOpen={autoOpen}
                onDrafted={() => {
                  setAutoOpen(false);
                  setSlotRevision((r) => r + 1);
                  window.scrollTo({ top: 0 });
                }}
              />
            }
          />
        ) : (
          <PublishStep month={month} onPublished={() => void reloadReservations()} />
        )}
      </div>
    </main>
  );
}
