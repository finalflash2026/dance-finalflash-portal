"use client";

import { useEffect, useState } from "react";

import { SettingsGroup } from "@/components/SettingsGroup";
import { Switch, primaryButtonClass } from "@/components/ui";
import {
  type NativeNotifyPrefs,
  readNativeNotifyPrefs,
  syncNativeDigest,
  writeNativeNotifyPrefs,
} from "@/lib/native-sync";

/**
 * iOS アプリの通知の設定 (SPEC.md §2.3.1 / v1.38)
 *
 * アプリの通知は**端末の中で予約する**ので、設定も端末に置く (サーバーには送らない)。
 * 選べるのは端末で予約できる「今日の予定」「締切」だけ。
 */
const CATEGORIES: { key: keyof NativeNotifyPrefs; label: string; hint: string }[] = [
  { key: "reminder", label: "今日の予定", hint: "練習やイベントがある日の朝7時" },
  { key: "deadline", label: "締切", hint: "締切の日の朝。大事な締切は1週間前にも" },
];

type Permission = "checking" | "granted" | "denied" | "prompt";

export function NativeNotifySection() {
  const [prefs, setPrefs] = useState<NativeNotifyPrefs>({ reminder: true, deadline: true });
  const [permission, setPermission] = useState<Permission>("checking");

  useEffect(() => {
    setPrefs(readNativeNotifyPrefs());
    void (async () => {
      const { LocalNotifications } = await import("@capacitor/local-notifications");
      const { display } = await LocalNotifications.checkPermissions();
      setPermission(display === "granted" ? "granted" : display === "denied" ? "denied" : "prompt");
    })();
  }, []);

  async function allow() {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    const { display } = await LocalNotifications.requestPermissions();
    setPermission(display === "granted" ? "granted" : "denied");
    if (display === "granted") await syncNativeDigest({ force: true });
  }

  function toggle(key: keyof NativeNotifyPrefs) {
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    writeNativeNotifyPrefs(next);
    void syncNativeDigest({ force: true });
  }

  const on = permission === "granted" && (prefs.reminder || prefs.deadline);

  return (
    <SettingsGroup
      title="通知"
      icon="bell"
      summary={permission === "checking" ? undefined : on ? "オン" : "オフ"}
      hint="この端末だけの設定です。アプリを開いたときに、2週間先までの予定で通知を予約し直します。"
    >
      {permission === "denied" ? (
        <p className="text-[15px] text-[var(--danger-fg)]">
          通知がオフになっています。iPhone の設定 → 通知 → ff Calendar で許可してください。
        </p>
      ) : null}
      {permission === "prompt" ? (
        <button type="button" onClick={allow} className={primaryButtonClass}>
          通知を許可する
        </button>
      ) : null}

      <div className="space-y-2">
        <p className="text-[15px] font-semibold">届く通知</p>
        <ul className="divide-y divide-[var(--separator)] rounded-xl bg-[var(--fill)]">
          {CATEGORIES.map((category) => (
            <li key={category.key} className="flex items-center gap-3 px-3 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block text-[16px]">{category.label}</span>
                <span className="block text-[13px] text-[var(--muted)]">{category.hint}</span>
              </span>
              <Switch
                checked={permission === "granted" && prefs[category.key]}
                disabled={permission !== "granted"}
                label={category.label}
                onChange={() => toggle(category.key)}
              />
            </li>
          ))}
        </ul>
      </div>
    </SettingsGroup>
  );
}
