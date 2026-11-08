"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { appUrlToPath, isNativeApp, safeAppPath } from "@/lib/native";
import { clearNativeDigest, syncNativeDigest } from "@/lib/native-sync";

/** ログインしていない画面 (ここでは予定を取りにいかず、端末に残った予定を消す) */
const SIGNED_OUT_PATHS = ["/login", "/signup", "/welcome"];

/**
 * iOS アプリの中でだけ動く橋渡し (SPEC.md §2.3 / §2.3.1)。Web のブラウザでは何もしない。
 *
 * - Google でログインしたあと、アプリ内の Safari から `ffcalendar://auth/callback`
 *   で戻ってくる。その Safari を閉じ、WebView で `/auth/callback` を開く
 * - ウィジェットを押すと `ffcalendar://open?path=…` で来る。その画面へ移る
 * - 通知を押したら、その通知の画面へ移る
 * - 開いたとき・前に戻ってきたときに、通知とウィジェットを予定に合わせ直す
 */
export function NativeBridge() {
  const router = useRouter();
  const pathname = usePathname();
  const signedOut = SIGNED_OUT_PATHS.includes(pathname);
  const signedOutRef = useRef(signedOut);
  signedOutRef.current = signedOut;

  useEffect(() => {
    if (!isNativeApp()) return;
    if (signedOut) void clearNativeDigest();
    else void syncNativeDigest();
  }, [signedOut]);

  useEffect(() => {
    if (!isNativeApp()) return;
    let cancelled = false;
    const handles: { remove: () => Promise<void> }[] = [];

    void (async () => {
      const [{ App }, { Browser }, { LocalNotifications }] = await Promise.all([
        import("@capacitor/app"),
        import("@capacitor/browser"),
        import("@capacitor/local-notifications"),
      ]);
      const added = await Promise.all([
        App.addListener("appUrlOpen", ({ url }) => {
          const path = appUrlToPath(url);
          if (!path) return;
          if (path.startsWith("/auth/callback")) {
            // セッションは cookie を返すサーバーで作る。画面ごと読み直す
            void Browser.close().catch(() => {});
            window.location.assign(path);
            return;
          }
          router.push(path);
        }),
        App.addListener("resume", () => {
          if (!signedOutRef.current) void syncNativeDigest();
        }),
        LocalNotifications.addListener("localNotificationActionPerformed", (action) => {
          const extra = action.notification.extra as { path?: string } | undefined;
          const path = safeAppPath(extra?.path);
          if (path) router.push(path);
        }),
      ]);
      if (cancelled) added.forEach((handle) => void handle.remove());
      else handles.push(...added);
    })();

    return () => {
      cancelled = true;
      handles.forEach((handle) => void handle.remove());
    };
  }, [router]);

  return null;
}
