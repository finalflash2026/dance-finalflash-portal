"use client";

import { useEffect, useMemo, useState } from "react";

import { demoRound } from "@/lib/scheduling/round";
import { scenario } from "@/lib/scheduling/scenarios";
import { addMonths, startOfMonth, todayInTokyo } from "@/lib/time";

import { SchedulePlanClient } from "../../../schedule/ScheduleClient";

/**
 * 日程調整の集計と割り振りのデモ (SPEC.md §6.8.4)。折衝・3役だけの画面。
 * デモの人は3役。`?as=member` でメンバーが開いたときの見え方になる
 */
export default function DemoSchedulePlan() {
  const input = useMemo(
    () => scenario(addMonths(startOfMonth(todayInTokyo()), 1), "term", 1101),
    [],
  );
  const round = useMemo(() => demoRound(), []);
  const [canPlan, setCanPlan] = useState(true);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("as") === "member") setCanPlan(false);
  }, []);
  return <SchedulePlanClient initialInput={input} round={round} canPlan={canPlan} />;
}
