"use client";

import { mediumButtonClass } from "@/components/ui";

/**
 * 画面を読み込めなかったとき (SPEC.md §12 / v1.50.2)
 *
 * DB が一時的に応答しないときなど。登録の画面へ送ったり白い画面のままにしたりせず、
 * 読み込み直すボタンを出す。
 */
export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto max-w-md space-y-3 px-4 py-16 text-center">
      <h1 className="text-[22px] font-bold">読み込めませんでした</h1>
      <p className="text-[15px] text-[var(--muted)]">通信が落ち着いてから、もう一度読み込んでください。</p>
      <button type="button" onClick={reset} className={mediumButtonClass}>
        読み込み直す
      </button>
    </main>
  );
}
