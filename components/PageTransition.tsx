"use client";

import { usePathname } from "next/navigation";
import { useRef } from "react";

import { takeNavDirection } from "@/lib/nav-direction";

/**
 * 画面が切り替わるときの動き (SPEC.md §12 / v1.14)
 *
 * **`key` にパスを渡して作り直させる**ことで CSS アニメーションを再生する。
 * `template.tsx` を使う手もあるが、あちらは `?date=` が変わるだけでも
 * 作り直されるため、**同じ画面で日付を選ぶたびに画面全体が動いてしまう**。
 * ここではパスが変わったときだけ動かす。
 *
 * 向きはタブ側が置いていったものを使い切る。直打ちやブラウザの戻るでは
 * 何も入っていないので、その場合は右から入れる (どちらでもないため既定側)。
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const lastPath = useRef(pathname);
  const lastClass = useRef("page-in-right");

  if (lastPath.current !== pathname) {
    lastPath.current = pathname;
    lastClass.current =
      takeNavDirection() === "left" ? "page-in-left" : "page-in-right";
  }

  return (
    <div key={pathname} className={lastClass.current}>
      {children}
    </div>
  );
}
