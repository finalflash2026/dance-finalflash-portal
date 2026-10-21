"use client";

import { useMemo } from "react";

import { demoInput } from "@/lib/scheduling/demo";
import { demoRound } from "@/lib/scheduling/round";

import { ScheduleClient } from "../../schedule/ScheduleClient";

/**
 * 日程調整のデモ (SPEC.md §6.8.4)。見本の回答は端末で作る
 * (150人ぶんをサーバーから送るより軽く、種を決めた乱数なので毎回同じになる)
 */
export default function DemoSchedule() {
  const input = useMemo(() => demoInput(), []);
  const round = useMemo(() => demoRound(), []);
  return <ScheduleClient initialInput={input} me="m0" round={round} />;
}
