import { Placeholder } from "@/components/Placeholder";

/**
 * タブ② ナンバーカレンダー (SPEC.md §6.3)
 *
 * 所属ナンバーの予定のみを表示する完全メンバー制。
 * 非メンバーにはナンバーの存在自体が見えない (RLS で強制)。
 */
export default function NumberCalendarPage() {
  return (
    <Placeholder title="ナンバーカレンダー" spec="§6.3" phase="Phase 4">
      自分が所属するナンバーの予定だけが表示されます。
    </Placeholder>
  );
}
