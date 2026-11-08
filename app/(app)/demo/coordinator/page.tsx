"use client";

import { useMemo } from "react";

import { demoRound } from "@/lib/scheduling/round";
import { scenario } from "@/lib/scheduling/scenarios";
import { addMonths, startOfMonth, todayInTokyo } from "@/lib/time";

import { CoordinatorClient } from "../../coordinator/CoordinatorClient";

/** 見本の折衝ワークフロー。割り振り (②コマ割りの中) は見本の回答で (v1.43) */
export default function DemoCoordinator() {
  const input = useMemo(
    () => scenario(addMonths(startOfMonth(todayInTokyo()), 1), "term", 1101),
    [],
  );
  const round = useMemo(() => demoRound(), []);
  return <CoordinatorClient plan={{ round, input }} />;
}
