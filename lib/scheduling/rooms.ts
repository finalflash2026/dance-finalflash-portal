/**
 * 練習場所の広さの既定 (SPEC §6.8.3 / v1.32.4)。
 *
 * 過去のコマ割り表 (2026年5〜11月) で、全体練や人の多いジャンルに使われていた
 * 部屋を「広い」、1ジャンルが入りきらない控室を「狭い」にしてある。
 * 画面の詳細設定で部屋ごとに変えられる。値は見込み人数に掛ける重みで、
 * 広い = 1 + 強さ、狭い = 1 - 強さ。強さは学習で選ぶ (learned.json の roomStrength)。
 */
export type RoomSize = "small" | "normal" | "large";

export const DEFAULT_ROOM_SIZES: Record<number, RoomSize> = {
  5: "large", // リハーサル室
  9: "large", // アリーナA
  10: "large", // アリーナB
  11: "large", // アリーナC
  12: "large", // 剣道場(体育館)
  6: "small", // 控室136
  7: "small", // 控室132
  8: "small", // 控室131
};

export function sizeWeight(size: RoomSize, strength: number): number {
  return size === "large" ? 1 + strength : size === "small" ? 1 - strength : 1;
}

export function roomWeightsFor(sizes: Record<number, RoomSize>, strength: number): Record<number, number> {
  return Object.fromEntries(
    Object.entries(sizes).map(([id, size]) => [Number(id), sizeWeight(size, strength)]),
  );
}
