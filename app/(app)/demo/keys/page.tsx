import { redirect } from "next/navigation";

/** 旧「鍵と連絡」のデモ。v1.50.4 で練習場所と部室の鍵に分けた */
export default function DemoKeys() {
  redirect("/demo/keys/room");
}
