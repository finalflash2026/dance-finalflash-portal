import { redirect } from "next/navigation";

/** 割り振りは折衝の ③ 割り振り (v1.47) */
export default function DemoSchedulePlan() {
  redirect("/coordinator?step=plan");
}
