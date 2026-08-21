import { redirect } from "next/navigation";

/**
 * 旧「ナンバー管理」ページ (SPEC.md §6.3 / §7)
 *
 * v1.14.2 で中身をタブ② (`/number-cal`) に取り込んだため、ここは転送だけ残す。
 * 所属一覧と新規作成はタブを開いた時点で見えるようになり、
 * 別ページへ移る理由が無くなった。
 *
 * **`(calendar)` のような loading 境界の下に置かないこと。**
 * 先にシェルが流れると転送が 200 になり、ブラウザが新しいURLを覚えない
 * (`/me` → `/` で踏んだのと同じ。§7)。
 */
export default function NumbersPage() {
  redirect("/number-cal");
}
