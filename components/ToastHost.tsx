"use client";

import { useEffect, useState } from "react";

import { CheckMark } from "@/components/motion/CheckMark";
import { registerToastHost, type ToastOptions } from "@/lib/toast";

/** 出している時間 (ms)。そのあと縮んで消える */
const SHOW_MS = 2200;
const OUT_MS = 200;

interface ToastState extends ToastOptions {
  id: number;
  message: string;
  leaving: boolean;
}

/** 短い知らせを描く (lib/toast.ts / v1.36)。ルートのレイアウトに1つだけ置く */
export function ToastHost() {
  const [toast, setToast] = useState<ToastState | null>(null);

  useEffect(() => {
    registerToastHost((message, options) =>
      setToast({ id: Date.now(), message, leaving: false, ...options }),
    );
    return () => registerToastHost(null);
  }, []);

  useEffect(() => {
    if (!toast || toast.leaving) return;
    const leave = window.setTimeout(
      () => setToast((t) => (t ? { ...t, leaving: true } : t)),
      toast.durationMs ?? SHOW_MS,
    );
    return () => window.clearTimeout(leave);
  }, [toast]);

  useEffect(() => {
    if (!toast?.leaving) return;
    const gone = window.setTimeout(() => setToast(null), OUT_MS);
    return () => window.clearTimeout(gone);
  }, [toast]);

  if (!toast) return null;
  const action = toast.action;
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+88px)] z-[110] flex justify-center px-4"
    >
      <div
        key={toast.id}
        className={`glass flex items-center gap-2 rounded-full py-2.5 pl-4 text-[15px] font-semibold ${
          action ? "pointer-events-auto pr-1.5" : "pr-4"
        } ${toast.leaving ? "toast-out" : "toast-in"}`}
      >
        <CheckMark size={20} className="text-[#34c759]" />
        {toast.message}
        {action ? (
          <button
            type="button"
            onClick={() => {
              action.run();
              setToast((t) => (t ? { ...t, leaving: true } : t));
            }}
            className="-my-1 ml-1 h-9 rounded-full bg-[var(--fill)] px-3.5 text-[15px] font-semibold text-[var(--tint)] active:opacity-60"
          >
            {action.label}
          </button>
        ) : null}
      </div>
    </div>
  );
}
