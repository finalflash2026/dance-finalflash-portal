"use client";

import { useEffect, useState } from "react";

import { Sheet } from "@/components/Sheet";
import { destructiveButtonClass, fillButtonClass, primaryButtonClass } from "@/components/ui";
import { registerConfirmHost, type ConfirmRequest } from "@/lib/confirm";

/**
 * 確認の窓を描く (lib/confirm.ts / v1.32.7)。ルートのレイアウトに1つだけ置く。
 * 設定のカード (z-70) や出欠の窓の上から呼ばれても隠れないよう、一番上に重ねる。
 */
export function ConfirmHost() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);

  useEffect(() => {
    registerConfirmHost((next) =>
      setRequest((prev) => {
        // 前の確認に答えないまま次が来たら、前のは「やめる」にする
        prev?.resolve(false);
        return next;
      }),
    );
    return () => registerConfirmHost(null);
  }, []);

  if (!request) return null;

  const answer = (ok: boolean) => {
    request.resolve(ok);
    setRequest(null);
  };

  return (
    <Sheet
      title="確認"
      onClose={() => answer(false)}
      layerClassName="z-[100]"
      footer={
        <div className="space-y-2">
          <button
            type="button"
            autoFocus
            onClick={() => answer(true)}
            className={request.destructive ? destructiveButtonClass : primaryButtonClass}
          >
            {request.confirmLabel}
          </button>
          <button type="button" onClick={() => answer(false)} className={fillButtonClass}>
            やめる
          </button>
        </div>
      }
    >
      <p className="whitespace-pre-wrap break-words text-[16px] leading-relaxed">
        {request.message}
      </p>
    </Sheet>
  );
}
