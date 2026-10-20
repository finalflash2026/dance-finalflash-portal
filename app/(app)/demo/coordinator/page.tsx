import { CoordinatorClient } from "../../coordinator/CoordinatorClient";

/** 折衝ワークフローのデモ (SPEC §14.1 / v1.31.13)。予約枠・コマは lib/supabase/demo-data.ts の見本 */
export default function DemoCoordinator() {
  return <CoordinatorClient />;
}
