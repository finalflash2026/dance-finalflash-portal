import { Placeholder } from "@/components/Placeholder";

/**
 * タブ③ マイカレンダー (SPEC.md §6.4)
 *
 * 今日の予定カード / お知らせカード / 絞り込みチップ / ミニカレンダー。
 * 抽出ロジックは lib/events.ts の getMyEvents() に集約し、購読 ics と共用する。
 * OB は 3(ナンバー練) のみが対象。
 */
export default function MyCalendarPage() {
  return (
    <Placeholder title="マイカレンダー" spec="§6.4" phase="Phase 2 以降">
      自分の公式練・空き申請・ナンバー練を統合表示します。
    </Placeholder>
  );
}
