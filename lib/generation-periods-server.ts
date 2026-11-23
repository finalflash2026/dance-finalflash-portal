import "server-only";

import { after } from "next/server";

import { sendPush } from "@/lib/push";
import { isMissingRelation } from "@/lib/schema-errors";

/**
 * 対象期の期間の保存・削除で、API の2本が共有するもの (SPEC.md §8.14 / v1.51)
 */

/** DB の save_generation_period / delete_generation_period の戻り値 */
export interface PeriodRpcResult {
  id: string;
  /** 公開済みで対象期が変わった公式練の数 */
  changed: number;
  /** 消した出欠の数 */
  removed: number;
  /** お知らせを入れた人 */
  notified: string[];
}

/** DB のエラーを、押した人が次に何をすればよいか分かる日本語にする */
export function periodErrorResponse(
  error: { code?: string | null; message: string },
  verb: "保存" | "削除",
): Response {
  if (isMissingRelation(error)) {
    return Response.json(
      { error: "DB に対象期の期間の表がありません(0030 が未適用)。" },
      { status: 503 },
    );
  }
  if (error.code === "42501") {
    return Response.json({ error: "権限がありません。" }, { status: 403 });
  }
  if (error.message.includes("published slots change")) {
    return Response.json(
      { error: `公開済みの公式練の対象期が変わるので、3役だけが${verb}できます。` },
      { status: 409 },
    );
  }
  if (error.message.includes("stale period")) {
    return Response.json(
      { error: "ほかの人が先にこの期間を変えました。開き直してください。" },
      { status: 409 },
    );
  }
  if (error.code === "23P01") {
    return Response.json(
      { error: "ほかの期間と重なっています。開き直してください。" },
      { status: 409 },
    );
  }
  if (error.code === "22023" || error.code === "23514") {
    return Response.json(
      { error: "期間の日付か名前が正しくありません。" },
      { status: 400 },
    );
  }
  return Response.json(
    { error: `${verb}できませんでした: ${error.message}` },
    { status: 500 },
  );
}

/**
 * 結果を返し、対象が変わった人へ端末の通知を送る。
 * お知らせ (notifications) は DB の関数の中で入れてある。通知は応答のあとに回す
 * — 数十人ぶんの送信を待つと、保存のボタンが固まったように見える (§6.6)。
 */
export function respondWithPush(result: PeriodRpcResult): Response {
  const notified = result.notified ?? [];
  if (notified.length > 0) {
    after(async () => {
      await sendPush({
        category: "schedule",
        userIds: notified,
        payload: {
          title: "公式練の対象期が変わりました",
          url: "/",
          tag: "generation-periods",
        },
      });
    });
  }
  return Response.json({
    id: result.id,
    changed: result.changed ?? 0,
    removed: result.removed ?? 0,
    notified: notified.length,
  });
}
