"use client";

import { useEffect, useState } from "react";

import { CheckMark } from "@/components/motion/CheckMark";
import { registerToastHost } from "@/lib/toast";

/** 出している時間 (ms)。そのあと縮んで消える */
const SHOW_MS = 2200;
const OUT_MS = 200;

/** 短い知らせを描く (lib/toast.ts / v1.36)。ルートのレイアウトに1つだけ置く */
export function ToastHost() {
  const [toast, setToast] = useState<{ id: number; message: string; leaving: boolean } | null>(null);

  useEffect(() => {
    registerToastHost((message) => setToast({ id: Date.now(), message, leaving: false }));
    return () => registerToastHost(null);
  }, []);

  useEffect(() => {
    if (!toast || toast.leaving) return;
    const leave = window.setTimeout(() => setToast((t) => (t ? { ...t, leaving: true } : t)), SHOW_MS);
    return () => window.clearTimeout(leave);
  }, [toast]);

  useEffect(() => {
    if (!toast?.leaving) return;
    const gone = window.setTimeout(() => setToast(null), OUT_MS);
    return () => window.clearTimeout(gone);
  }, [toast]);

  if (!toast) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+88px)] z-[110] flex justify-center px-4"
    >
      <div
        key={toast.id}
        className={`glass flex items-center gap-2 rounded-full px-4 py-2.5 text-[15px] font-semibold ${
          toast.leaving ? "toast-out" : "toast-in"
        }`}
      >
        <CheckMark size={20} className="text-[#34c759]" />
        {toast.message}
      </div>
    </div>
  );
}
