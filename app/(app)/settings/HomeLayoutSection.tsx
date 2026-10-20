"use client";

import { useEffect, useState } from "react";

import { SettingsGroup } from "@/components/SettingsGroup";
import { Switch } from "@/components/ui";
import {
  HOME_SECTION_LABELS,
  REQUIRED_SECTIONS,
  readHomeLayout,
  resetHomeLayout,
  storeHomeLayout,
  type HomeLayout,
} from "@/lib/home-layout";

/**
 * ホームの並び (SPEC §6.7.13 / v1.31.6)
 *
 * 欄を ↑↓ で並べ替え、スイッチで出す/出さないを選ぶ。ドラッグにしないのは、
 * 縦に滑らせて画面を動かす指と取り合いになり、思わぬ並びになりやすいため。
 *
 * 端末に保存する。初期値はマウント後に読む (サーバーは localStorage を見られない)。
 */
export function HomeLayoutSection() {
  const [layout, setLayout] = useState<HomeLayout | null>(null);

  useEffect(() => {
    setLayout(readHomeLayout());
  }, []);

  if (!layout) return null;

  function save(next: HomeLayout) {
    setLayout(next);
    storeHomeLayout(next);
  }

  function move(index: number, delta: -1 | 1) {
    const order = [...layout!.order];
    const [item] = order.splice(index, 1);
    order.splice(index + delta, 0, item);
    save({ ...layout!, order });
  }

  return (
    <SettingsGroup
      title="ホームの並び"
      icon="layout"
      summary={`${HOME_SECTION_LABELS[layout.order[0]].split("・")[0]}が一番上`}
      hint="よく見るものを上に。使わない欄はオフにすると隠れます。この端末だけの設定です。"
    >
      <ol className="divide-y divide-[var(--separator)] rounded-xl bg-[var(--cell)]">
        {layout.order.map((key, index) => {
          const required = REQUIRED_SECTIONS.includes(key);
          const shown = !layout.hidden.includes(key);
          return (
            <li key={key} className="flex items-center gap-2 px-3 py-2">
              <div className="flex shrink-0 flex-col">
                <ArrowButton
                  label={`${HOME_SECTION_LABELS[key]}を上へ`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                  up
                />
                <ArrowButton
                  label={`${HOME_SECTION_LABELS[key]}を下へ`}
                  disabled={index === layout.order.length - 1}
                  onClick={() => move(index, 1)}
                />
              </div>
              <span
                className={`min-w-0 flex-1 text-[15px] leading-snug ${shown ? "" : "text-[var(--muted)]"}`}
              >
                {HOME_SECTION_LABELS[key]}
              </span>
              {required ? (
                <span className="shrink-0 text-[13px] text-[var(--muted)]">常に表示</span>
              ) : (
                <Switch
                  checked={shown}
                  label={`${HOME_SECTION_LABELS[key]}を表示`}
                  onChange={(checked) =>
                    save({
                      ...layout,
                      hidden: checked
                        ? layout.hidden.filter((h) => h !== key)
                        : [...layout.hidden, key],
                    })
                  }
                />
              )}
            </li>
          );
        })}
      </ol>
      <button
        type="button"
        onClick={() => {
          resetHomeLayout();
          setLayout(readHomeLayout());
        }}
        className="text-sm text-[var(--tint)]"
      >
        最初の並びに戻す
      </button>
    </SettingsGroup>
  );
}

function ArrowButton({
  label,
  disabled,
  onClick,
  up = false,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  up?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-7 w-9 items-center justify-center text-[var(--tint)] disabled:text-[var(--muted)] disabled:opacity-30"
    >
      <svg viewBox="0 0 14 8" width="13" height="8" aria-hidden className={up ? "rotate-180" : ""}>
        <path
          d="M1 1l6 6 6-6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}
