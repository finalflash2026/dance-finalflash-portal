"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

import { clearHomeSnapshot } from "@/lib/home-cache";

/** ログインしていない画面 (ここに来たら前回の内容を消す) */
const SIGNED_OUT_PATHS = ["/login", "/signup", "/welcome"];
/** これより長く離れていたら、戻ったときに取り直す */
const STALE_AFTER_MS = 60_000;

/**
 * 戻ってきたら裏で取り直して差し替える (SPEC.md §13.1 / v1.42)
 *
 * タブ・アプリを1分以上離れて戻ったら `router.refresh()`。今見ている画面は
 * 消さず、新しい内容が届いたところで差し替わる。ログイン画面に来たら、
 * 端末に残した前回のホームの内容を消す (別の人に見せない)。
 */
export function ResumeRefresh() {
  const router = useRouter();
  const pathname = usePathname();
  const signedOut = SIGNED_OUT_PATHS.includes(pathname);

  useEffect(() => {
    if (signedOut) clearHomeSnapshot();
  }, [signedOut]);

  useEffect(() => {
    if (signedOut) return;
    let hiddenAt = 0;
    const onChange = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
      } else if (hiddenAt && Date.now() - hiddenAt > STALE_AFTER_MS) {
        hiddenAt = 0;
        router.refresh();
      }
    };
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, [router, signedOut]);

  return null;
}
