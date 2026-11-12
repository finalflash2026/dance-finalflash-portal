"use client";

import type { ComponentProps } from "react";

import type { CalendarHome } from "@/app/(app)/(calendar)/CalendarHome";
import { todayInTokyo } from "@/lib/time";

/**
 * ホームの前回の内容 (SPEC.md §13.1 / v1.42)
 *
 * 読み込み中に骨組みの代わりに出す。**端末に1つだけ**、ログインしている人の
 * ユーザーID と一緒に持つ。ログアウト・ログイン画面で消す。日付が変わっていたら使わない。
 */
export type HomeSnapshot = Omit<ComponentProps<typeof CalendarHome>, "keysHref">;

const KEY = "home-cache:v1";

export function saveHomeSnapshot(props: HomeSnapshot): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(props));
  } catch {
    // 容量オーバーなど。前回の内容が出ないだけ
  }
}

export function readHomeSnapshot(): HomeSnapshot | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const snapshot = JSON.parse(raw) as HomeSnapshot;
    if (snapshot.today !== todayInTokyo()) return null;
    return { ...snapshot, initialDate: snapshot.today };
  } catch {
    return null;
  }
}

export function clearHomeSnapshot(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {}
}
