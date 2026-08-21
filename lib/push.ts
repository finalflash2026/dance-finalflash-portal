import "server-only";

import webpush from "web-push";

import { vapidConfig } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Web Push の送信 (SPEC.md §6.6)
 *
 * 押さえどころが3つある。
 *
 * **1. 通知の失敗で本体を失敗させない。**
 * 鍵が未設定でも、送信が全滅しても、練習日程の公開や鍵の切り替えは成立する。
 * この関数は投げっぱなしで、例外を外に出さず件数だけ返す。
 *
 * **2. 死んだ購読はその場で消す。**
 * ブラウザを消した・通知を切った端末には 404 / 410 が返る。放っておくと
 * 溜まり続け、毎回そこへ投げてから失敗することになる。
 *
 * **3. 送るのは本文ではなく「見出しと行き先」だけ。**
 * 通知は端末のロック画面に出るので、誰が誰の予定を持っているかのような
 * 中身は載せない。開いた先で本人のセッションとして読ませる。
 */

/** 通知の種類。購読側 (push_subscriptions) の列と1対1で対応する */
export type PushCategory = "schedule" | "room" | "key";

const CATEGORY_COLUMN: Record<PushCategory, string> = {
  schedule: "notify_schedule",
  room: "notify_room",
  key: "notify_key",
};

interface SubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * 同時に投げる本数。150人ぶんを一度に開くと送信側のソケットが詰まるので
 * 小分けにする。1本あたりは数十msなので、6本ずつでも全体で数百ms に収まる。
 */
const CHUNK_SIZE = 25;

/** 鍵が揃っているか。設定画面で「未設定」と出すためにも使う */
export function isPushConfigured(): boolean {
  return vapidConfig() !== null;
}

export interface PushPayload {
  /**
   * 通知の本文。**1行で完結させる** (v1.15.1)。
   *
   * ロック画面では見出ししか読まれないことが多く、2行に分けると
   * 肝心の「誰が」「どこを」が畳まれて見えなくなる。
   * 「22BREAKせいあがスタジオ101を開けました」のように、
   * これだけ読めば用が足りる形にする。
   */
  title: string;
  /** 添える説明。基本は付けない (title で完結させるため) */
  body?: string;
  /** タップしたときに開くパス (例: `/overview`) */
  url: string;
  /**
   * 同じ話題の通知をまとめるための札。同じ tag の通知は端末上で置き換わる。
   * 鍵の開け閉めが往復しても通知が積み上がらないようにするために要る。
   */
  tag: string;
}

/**
 * 指定したユーザーたちへ送る。**このカテゴリを有効にしている端末だけ**が対象。
 *
 * @returns 送れた数と、死んでいたので消した数
 */
export async function sendPush({
  category,
  userIds,
  payload,
}: {
  category: PushCategory;
  userIds: string[];
  payload: PushPayload;
}): Promise<{ sent: number; removed: number; skipped: boolean }> {
  const config = vapidConfig();
  if (!config || userIds.length === 0) {
    return { sent: 0, removed: 0, skipped: true };
  }

  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .in("user_id", userIds)
    .eq(CATEGORY_COLUMN[category], true);

  if (error) {
    console.error("[push] 購読先を引けませんでした", error.message);
    return { sent: 0, removed: 0, skipped: false };
  }

  const rows = (data ?? []) as SubscriptionRow[];
  if (rows.length === 0) return { sent: 0, removed: 0, skipped: false };

  const body = JSON.stringify(payload);
  const dead: string[] = [];
  let sent = 0;

  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    const results = await Promise.allSettled(
      chunk.map((row) =>
        webpush.sendNotification(
          {
            endpoint: row.endpoint,
            keys: { p256dh: row.p256dh, auth: row.auth },
          },
          body,
          // 端末が圏外でも、次に繋がったときに届いてほしい。
          // ただし1日も前の「鍵が開きました」は害なので短く切る
          { TTL: 60 * 60 },
        ),
      ),
    );

    results.forEach((result, index) => {
      if (result.status === "fulfilled") {
        sent++;
        return;
      }
      const statusCode = (result.reason as { statusCode?: number })?.statusCode;
      // 404 = そんな購読は無い / 410 = もう無効。どちらも復活しない
      if (statusCode === 404 || statusCode === 410) {
        dead.push(chunk[index].endpoint);
        return;
      }
      console.error(
        "[push] 送信に失敗しました",
        statusCode ?? "",
        (result.reason as Error)?.message ?? result.reason,
      );
    });
  }

  if (dead.length > 0) {
    const { error: deleteError } = await admin
      .from("push_subscriptions")
      .delete()
      .in("endpoint", dead);
    if (deleteError) {
      console.error("[push] 無効な購読を消せませんでした", deleteError.message);
      return { sent, removed: 0, skipped: false };
    }
  }

  return { sent, removed: dead.length, skipped: false };
}

/**
 * 現役全員 (OB を除く) の user_id。鍵の開閉と部室の鍵の宛先。
 *
 * `exceptUserId` には**操作した本人**を渡す。自分が押した鍵の通知が
 * 自分の端末に返ってくるのは邪魔にしかならない。
 */
export async function activeMemberIds(exceptUserId?: string): Promise<string[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("profiles")
    .select("user_id")
    .neq("role", "ob");

  if (error) {
    console.error("[push] 宛先を引けませんでした", error.message);
    return [];
  }
  return (data ?? [])
    .map((row) => (row as { user_id: string }).user_id)
    .filter((id) => id !== exceptUserId);
}
