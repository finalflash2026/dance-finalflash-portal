import { permanentRedirect } from "next/navigation";

/**
 * 旧マイカレンダーの URL (SPEC.md §7 / v1.14)
 *
 * マイカレンダーを `/` に移したあとも、**古いリンクを死なせないために残す**。
 * 購読URLの案内やブックマーク、ホーム画面に追加済みのショートカットが
 * `/me` を指していることがある。
 *
 * `permanentRedirect` (308) なので、ブラウザ側も次からは新しい URL を覚える。
 *
 * **`(calendar)` グループの外に置いてある。** 中に置くと `loading.tsx` が
 * 先にシェルを流し始め、転送が決まる頃には HTTP 200 が返ってしまう
 * (`/coordinator` の 404 で踏んだのと同じ話。§7)。308 で返せないと
 * ブラウザが新しい URL を覚えず、毎回この画面を経由し続ける。
 */
export default function LegacyMyCalendarPage() {
  permanentRedirect("/");
}
