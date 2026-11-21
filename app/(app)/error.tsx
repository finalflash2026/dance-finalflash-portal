"use client";

import { LoadError } from "@/components/LoadError";

/** 画面 (ページ) の中で読み込めなかったとき。タブバーは残したまま出す */
export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return <LoadError reset={reset} />;
}
