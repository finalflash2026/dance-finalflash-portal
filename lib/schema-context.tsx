"use client";

import { createContext, useContext } from "react";

/**
 * DB が大規模アップデートの SQL まで済んでいるかを画面の部品に配る (SPEC.md §13.4 / v1.49)
 *
 * 判定の本体はサーバーの lib/schema.ts。レイアウトで1回だけ入れる。
 * レイアウトの外 (見本など) では全部出す。
 */
const SchemaContext = createContext<boolean>(true);

export function SchemaProvider({ v2, children }: { v2: boolean; children: React.ReactNode }) {
  return <SchemaContext.Provider value={v2}>{children}</SchemaContext.Provider>;
}

/** 0020〜0029 の表・列・関数を使ってよいか */
export function useSchemaV2(): boolean {
  return useContext(SchemaContext);
}
