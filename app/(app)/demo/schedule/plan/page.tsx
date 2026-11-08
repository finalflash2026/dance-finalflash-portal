import { redirect } from "next/navigation";

/** 割り振りは折衝ワークフローの② (v1.42) */
export default function DemoSchedulePlan() {
  redirect("/coordinator?step=plan");
}
