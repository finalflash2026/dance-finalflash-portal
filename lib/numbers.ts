/**
 * ナンバー (縦イベのチーム) まわりの純粋関数 (SPEC.md §6.3)
 *
 * DB には触らない。認可は RLS が完全メンバー制で担保しているので
 * (`is_number_member()`)、ここには権限判定を置かないこと。
 */

import { NUMBER_COLORS } from "@/lib/constants";

/**
 * ナンバーの表示色。**id から決定的に決める**。
 *
 * 一覧の並び順で色を振ると、ナンバーが増減したときに既存のナンバーの色が
 * ずれてしまう。「あの青いやつ」で覚えている人が混乱するので、
 * id のハッシュから引く。端末や画面をまたいでも同じ色になる。
 */
export function numberColor(numberId: string): { bg: string; fg: string } {
  let hash = 0;
  for (let i = 0; i < numberId.length; i += 1) {
    // 32bit に収まるよう都度切り詰める (文字列長に依存せず安定させるため)
    hash = (hash * 31 + numberId.charCodeAt(i)) | 0;
  }
  const index = Math.abs(hash) % NUMBER_COLORS.length;
  return { bg: NUMBER_COLORS[index], fg: "#FFFFFF" };
}

/**
 * 一覧やカレンダーのラベル用に名前を詰める。
 * ミニカレンダーのマスは幅が 55px 程度しかないため、原寸では入らない。
 */
export function shortNumberName(name: string, max = 4): string {
  const trimmed = name.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}…`;
}
