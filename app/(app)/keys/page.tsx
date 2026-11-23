import { redirect } from "next/navigation";

/**
 * 旧「鍵と連絡」(v1.31〜v1.50.3)。v1.50.4 で練習場所と部室の鍵を別の画面に分けた
 * (SPEC §6.1.1)。古いリンク・ブックマークは練習場所へ送る
 */
export default function KeysPage() {
  redirect("/keys/room");
}
