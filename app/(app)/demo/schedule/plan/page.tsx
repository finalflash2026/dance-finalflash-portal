import { redirect } from "next/navigation";

/** 割り振りは折衝ワークフローの②コマ割りの中 (v1.43) */
export default function DemoSchedulePlan() {
  redirect("/coordinator?step=plan");
}
