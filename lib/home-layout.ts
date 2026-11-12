/**
 * ホームの欄の並びと表示/非表示 (SPEC.md §6.7.13 / v1.31.6)
 *
 * 端末ごとの好みなので localStorage に持ち、DB には入れない (画面の明るさと同じ)。
 * 設定画面で変えたら、同じタブのホームにも `HOME_LAYOUT_EVENT` で知らせる。
 */

export type HomeSection = "deadlines" | "freeRooms" | "keys" | "calendar" | "staff";

export interface HomeLayout {
  order: HomeSection[];
  hidden: HomeSection[];
}

export const HOME_SECTION_LABELS: Record<HomeSection, string> = {
  deadlines: "近い締切",
  freeRooms: "今日自主練できる部屋",
  keys: "練習場所の鍵・部室の鍵・連絡",
  calendar: "カレンダー・選んだ日の予定",
  staff: "運営の画面",
};

/** 既定はカレンダーが一番上 (v1.31.8)、運営の画面が一番下 (v1.43) */
export const DEFAULT_HOME_LAYOUT: HomeLayout = {
  order: ["calendar", "deadlines", "freeRooms", "keys", "staff"],
  hidden: [],
};

/** 消せない欄。カレンダーが無いと日を選ぶ入口がなくなる */
export const REQUIRED_SECTIONS: readonly HomeSection[] = ["calendar"];

const STORAGE_KEY = "home-layout-v1";
export const HOME_LAYOUT_EVENT = "home-layout-change";

/**
 * 保存された値を整える。知らない欄は捨て、足りない欄は既定の位置に足す
 * (後から欄が増えても、古い保存のまま新しい欄が消えないように)
 */
export function normalizeHomeLayout(raw: unknown): HomeLayout {
  const known = new Set<string>(DEFAULT_HOME_LAYOUT.order);
  const value = (raw ?? {}) as { order?: unknown; hidden?: unknown };
  const order = (Array.isArray(value.order) ? value.order : []).filter(
    (key): key is HomeSection => typeof key === "string" && known.has(key),
  );
  const unique = [...new Set(order)];
  DEFAULT_HOME_LAYOUT.order.forEach((key, index) => {
    if (!unique.includes(key)) unique.splice(Math.min(index, unique.length), 0, key);
  });
  const hidden = (Array.isArray(value.hidden) ? value.hidden : []).filter(
    (key): key is HomeSection =>
      typeof key === "string" && known.has(key) && !REQUIRED_SECTIONS.includes(key as HomeSection),
  );
  return { order: unique, hidden: [...new Set(hidden)] };
}

export function readHomeLayout(): HomeLayout {
  try {
    return normalizeHomeLayout(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null"));
  } catch {
    return DEFAULT_HOME_LAYOUT;
  }
}

export function storeHomeLayout(layout: HomeLayout): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeHomeLayout(layout)));
  } catch {}
  window.dispatchEvent(new Event(HOME_LAYOUT_EVENT));
}

export function resetHomeLayout(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
  window.dispatchEvent(new Event(HOME_LAYOUT_EVENT));
}
