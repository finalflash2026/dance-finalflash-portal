"use client";

import { LoadError } from "@/components/LoadError";

/**
 * レイアウトの中で読み込めなかったとき (v1.50.3)
 *
 * `app/(app)/error.tsx` は、同じ階層の `app/(app)/layout.tsx` で起きた例外を受け止めない
 * (Next.js の error.tsx は、その階層の layout の内側だけを包む)。プロフィールはその layout で
 * 読むので、DB が応答しないときの例外はここで受ける。`/welcome` で読めなかったときも同じ。
 */
export default function RootError({ reset }: { error: Error; reset: () => void }) {
  return <LoadError reset={reset} />;
}
