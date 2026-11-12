"use client";

import { useMemo } from "react";

import { demoRound } from "@/lib/scheduling/round";
import { scenario } from "@/lib/scheduling/scenarios";
import { addMonths, startOfMonth, todayInTokyo } from "@/lib/time";

import { ScheduleAnswerClient } from "../../schedule/ScheduleClient";

/**
 * 日程調整の回答のデモ (SPEC.md §6.8.4)。見本の回答は端末で作る
 * (150人ぶんをサーバーから送るより軽く、種を決めた乱数なので毎回同じになる)。
 * 見本は過去のコマ割り表の形を元にした月 (lib/scheduling/scenarios.ts)。
 */
export default function DemoSchedule() {
  const input = useMemo(
    () => scenario(addMonths(startOfMonth(todayInTokyo()), 1), "term", 1101),
    [],
  );
  const round = useMemo(() => demoRound(), []);
  return <ScheduleAnswerClient initialInput={input} me="BREAK-0" round={round} />;
}
