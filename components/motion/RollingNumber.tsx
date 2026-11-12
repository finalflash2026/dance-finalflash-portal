"use client";

import { useRef } from "react";

/**
 * 数字が縦に転がって変わる (SPEC §12「動き」/ v1.36)。
 *
 * 値が変わるたびに、増えたら下から・減ったら上から入れ替える。どちらへ
 * 変わったかが目で追える。最初の描画では動かさない。`value` は数で比べ、
 * 表示は `children` (無ければ value) を出す。
 */
export function RollingNumber({
  value,
  children,
  className = "",
}: {
  value: number;
  children?: React.ReactNode;
  className?: string;
}) {
  const previous = useRef<number | null>(null);
  const direction =
    previous.current === null || previous.current === value
      ? null
      : value > previous.current
        ? "roll-up"
        : "roll-down";
  previous.current = value;
  return (
    <span className={`inline-block overflow-hidden align-bottom ${className}`}>
      {/* key を変えて作り直すと、そのたびに入場の動きが走る */}
      <span key={value} className={`inline-block ${direction ?? ""}`}>
        {children ?? value}
      </span>
    </span>
  );
}
