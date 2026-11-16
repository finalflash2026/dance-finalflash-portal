"use client";

import { useEffect, useRef } from "react";

/**
 * その日の予定を左右に滑らせて、前後の日へ移る (SPEC.md §12「動き」/ v1.39)
 *
 * iPhone のカレンダーの日表示と同じく、**指に付いて動き**、離したときに
 * 幅の4分の1を越えているか速く弾いていれば送り出して日を変える。
 * 足りなければ元へ戻る。入ってくる側の動きは CSS の `.day-in-*`
 * (CalendarHome が日を変えたあとに付ける)。
 *
 * - 縦のスクロールが先に始まったら、横には動かさない (touch-action: pan-y)
 * - 横にスクロールする表 (`.h-scroll`) や `[data-no-swipe]` の中では効かせない
 * - この中ではタブの横スワイプ (SwipeTabs) も効かせない (`data-no-swipe`)
 * - 「視差効果を減らす」なら指には付けず、離したときに日だけ変える
 */
export function DaySwipe({
  onSwipe,
  children,
}: {
  /** next = 翌日 (左へ滑らせた), prev = 前日 */
  onSwipe: (direction: "next" | "prev") => void;
  children: React.ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const onSwipeRef = useRef(onSwipe);
  onSwipeRef.current = onSwipe;

  useEffect(() => {
    const node = box.current;
    if (!node) return;
    const el: HTMLDivElement = node;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

    /** 横に動いたと決めるまでの距離。小さいと縦スクロールの揺れで動く */
    const DECIDE_PX = 8;

    let start: { x: number; y: number; t: number; id: number } | null = null;
    let dragging = false;
    let dx = 0;
    let last = { x: 0, t: 0 };
    let velocity = 0;
    let frame = 0;

    const setX = (x: number, transition?: string) => {
      el.style.transition = transition ?? "none";
      el.style.transform = x === 0 ? "" : `translate3d(${x}px, 0, 0)`;
    };

    function onDown(event: PointerEvent) {
      if (event.pointerType === "mouse" || !event.isPrimary) return;
      const target = event.target as Element | null;
      if (target?.closest(".h-scroll, [data-no-swipe]:not([data-day-swipe])")) return;
      start = { x: event.clientX, y: event.clientY, t: event.timeStamp, id: event.pointerId };
      last = { x: event.clientX, t: event.timeStamp };
      dragging = false;
      dx = 0;
      velocity = 0;
    }

    function onMove(event: PointerEvent) {
      if (!start || event.pointerId !== start.id) return;
      const mx = event.clientX - start.x;
      const my = event.clientY - start.y;
      if (!dragging) {
        if (Math.abs(mx) < DECIDE_PX && Math.abs(my) < DECIDE_PX) return;
        // 縦が先に勝ったら、このタッチでは横に動かさない
        if (Math.abs(my) >= Math.abs(mx)) {
          start = null;
          return;
        }
        dragging = true;
        el.setPointerCapture?.(event.pointerId);
      }
      const dt = event.timeStamp - last.t;
      if (dt > 0) velocity = (event.clientX - last.x) / dt;
      last = { x: event.clientX, t: event.timeStamp };
      dx = mx;
      if (reduced.matches) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setX(dx));
    }

    function finish(cancelled: boolean) {
      if (!start) return;
      start = null;
      cancelAnimationFrame(frame);
      if (!dragging) return;
      dragging = false;

      const width = el.clientWidth || 1;
      const flung = Math.abs(velocity) > 0.45;
      const far = Math.abs(dx) > width / 4;
      const sameWay = flung ? Math.sign(velocity) === Math.sign(dx) || dx === 0 : true;
      if (cancelled || !(far || flung) || !sameWay) {
        setX(0, "transform 0.3s var(--ease-smooth)");
        return;
      }
      const direction = (flung ? velocity : dx) < 0 ? "next" : "prev";
      if (reduced.matches) {
        setX(0);
        onSwipeRef.current(direction);
        return;
      }
      // 指の勢いのまま送り出し、出きったところで日を変える
      const out = direction === "next" ? -width * 0.42 : width * 0.42;
      el.style.opacity = "0";
      setX(out, "transform 0.12s ease-out, opacity 0.12s ease-out");
      window.setTimeout(() => {
        el.style.transition = "none";
        el.style.opacity = "";
        el.style.transform = "";
        onSwipeRef.current(direction);
      }, 120);
    }

    const onUp = () => finish(false);
    const onCancel = () => finish(true);

    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onCancel);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onCancel);
    };
  }, []);

  return (
    <div
      ref={box}
      // 横は自前で受け、縦のスクロールはブラウザに任せる。
      // will-change は付けない (中の固定表示の窓の基準がこの箱にずれる)
      style={{ touchAction: "pan-y" }}
      data-no-swipe
      data-day-swipe
    >
      {children}
    </div>
  );
}
