"use client";

import type { AppDigest, DigestCategory } from "@/lib/app-digest";
import { FFNative } from "@/lib/native-plugin";

/**
 * iOS アプリの通知とウィジェットを、サーバーの予定に合わせ直す (SPEC.md §2.3.1 / v1.38)。
 *
 * 開くたび (と前に戻ってきたとき) に `GET /api/app/digest` を取り、
 *   1. ウィジェットへ渡す (FFNative.setDigest)
 *   2. 端末の通知を予約し直す (@capacitor/local-notifications)
 * **アプリの中でだけ呼ぶこと。**
 */

const PREFS_KEY = "native-notify";

export type NativeNotifyPrefs = Record<DigestCategory, boolean>;

const DEFAULT_PREFS: NativeNotifyPrefs = { reminder: true, deadline: true };

export function readNativeNotifyPrefs(): NativeNotifyPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<NativeNotifyPrefs>) } : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

export function writeNativeNotifyPrefs(prefs: NativeNotifyPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // 保存できない環境では、この起動の間だけ効く
  }
}

/** 同じ起動で何度も取りにいかない (タブの行き来や前に戻るたびに走るため) */
const MIN_INTERVAL_MS = 60_000;
let lastSync = 0;
let running: Promise<void> | null = null;

export function syncNativeDigest(options: { force?: boolean } = {}): Promise<void> {
  if (running) return running;
  if (!options.force && Date.now() - lastSync < MIN_INTERVAL_MS) return Promise.resolve();
  running = run()
    .catch((cause) => {
      console.error("[native] 予定を端末に入れられませんでした", cause);
    })
    .finally(() => {
      running = null;
    });
  return running;
}

async function run(): Promise<void> {
  const res = await fetch("/api/app/digest", { cache: "no-store" });
  if (res.status === 401) {
    await clearNativeDigest();
    return;
  }
  if (!res.ok) return;
  const digest = (await res.json()) as AppDigest;
  lastSync = Date.now();

  await FFNative.setDigest({ digest: { today: digest.today, days: digest.days } });
  await scheduleNotifications(digest);
}

async function scheduleNotifications(digest: AppDigest): Promise<void> {
  const { LocalNotifications } = await import("@capacitor/local-notifications");

  let { display } = await LocalNotifications.checkPermissions();
  // 初めてログインしたときに一度だけ聞く (断られたら設定画面から許可してもらう)
  if (display === "prompt" || display === "prompt-with-rationale") {
    ({ display } = await LocalNotifications.requestPermissions());
  }
  if (display !== "granted") return;

  await cancelDigestNotifications();

  const prefs = readNativeNotifyPrefs();
  const notifications = digest.notifications
    .filter((n) => prefs[n.category])
    .map((n) => ({
      id: n.id,
      title: n.title,
      body: n.body,
      schedule: { at: new Date(n.at), allowWhileIdle: true },
      threadIdentifier: n.category,
      extra: { path: n.path, source: "digest" },
    }));
  if (notifications.length > 0) {
    await LocalNotifications.schedule({ notifications });
  }
}

async function cancelDigestNotifications(): Promise<void> {
  const { LocalNotifications } = await import("@capacitor/local-notifications");
  const { notifications } = await LocalNotifications.getPending();
  const ours = notifications.filter(
    (n) => (n.extra as { source?: string } | undefined)?.source === "digest",
  );
  if (ours.length > 0) {
    await LocalNotifications.cancel({ notifications: ours.map((n) => ({ id: n.id })) });
  }
}

/** ログアウトしたとき: 前の人の予定をウィジェットと通知に残さない */
export async function clearNativeDigest(): Promise<void> {
  lastSync = 0;
  await FFNative.clearDigest().catch(() => {});
  await cancelDigestNotifications().catch(() => {});
}
