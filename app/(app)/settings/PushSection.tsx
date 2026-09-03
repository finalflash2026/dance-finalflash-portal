"use client";

import { useCallback, useEffect, useState } from "react";

import { settingsSectionClass } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

/**
 * プッシュ通知の設定 (SPEC.md §6.6)
 *
 * **オン/オフは端末ごと**。同じ人が iPhone と PC で使えば購読は2つになり、
 * それぞれ別に切れる。DB の行も端末 (endpoint) 単位。
 *
 * iOS では**ホーム画面に追加したアプリから開いたときしか**購読できない。
 * Safari のタブで開いている間は `PushManager` 自体が存在しないので、
 * 「非対応」で終わらせず**やり方を書いて出す**。ここで黙って消えると、
 * 使えない理由が誰にも分からない。
 */

export interface PushPrefs {
  schedule: boolean;
  room: boolean;
  key: boolean;
  /** 掲示板の連絡 (§6.1.3 / v1.27) */
  message: boolean;
}

const CATEGORIES: {
  key: keyof PushPrefs;
  label: string;
  hint: string;
}[] = [
  {
    key: "schedule",
    label: "練習日程の公開",
    hint: "折衝係がその月の予定を公開・更新したとき",
  },
  {
    key: "room",
    label: "練習場所の鍵",
    hint: "今日の練習場所が開錠・施錠されたとき",
  },
  {
    key: "key",
    label: "部室の鍵",
    hint: "部室の鍵の所持者が変わったとき",
  },
  {
    key: "message",
    label: "掲示板の連絡",
    hint: "練習場所・部室の鍵の欄に書き込みがあったとき",
  },
];

const DEFAULT_PREFS: PushPrefs = {
  schedule: true,
  room: true,
  key: true,
  message: true,
};

/**
 * VAPID の公開鍵は base64url の文字列で渡されるが、
 * `pushManager.subscribe` はバイト列しか受け取らない。
 */
function toApplicationServerKey(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  // ArrayBuffer から作る。長さだけ渡すと SharedArrayBuffer も含む型になり、
  // subscribe() が受け取る BufferSource に合わない
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

/** ホーム画面に追加したアプリとして開いているか */
function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  return /iP(hone|ad|od)/.test(navigator.userAgent);
}

type Status = "checking" | "unsupported" | "ready";

export function PushSection({ vapidPublicKey }: { vapidPublicKey: string }) {
  const [status, setStatus] = useState<Status>("checking");
  const [subscribed, setSubscribed] = useState(false);
  const [prefs, setPrefs] = useState<PushPrefs>(DEFAULT_PREFS);
  const [denied, setDenied] = useState(false);
  const [standalone, setStandalone] = useState(true);
  const [ios, setIos] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /** 今この端末が登録済みかを、ブラウザとDBの両方から見て揃える */
  const load = useCallback(async () => {
    const registration = await navigator.serviceWorker.register("/sw.js");
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      setSubscribed(false);
      return;
    }
    setSubscribed(true);

    // カテゴリの状態は DB 側が正。RLS で自分の行しか読めない
    const supabase = createClient();
    const { data } = await supabase
      .from("push_subscriptions")
      .select("notify_schedule, notify_room, notify_key, notify_message")
      .eq("endpoint", subscription.endpoint)
      .maybeSingle();

    if (data) {
      const row = data as {
        notify_schedule: boolean;
        notify_room: boolean;
        notify_key: boolean;
        notify_message: boolean | null;
      };
      setPrefs({
        schedule: row.notify_schedule,
        room: row.notify_room,
        key: row.notify_key,
        // 列を足す前に登録した端末は null で返る。既定はオン
        message: row.notify_message ?? true,
      });
    }
  }, []);

  useEffect(() => {
    setStandalone(isStandalone());
    setIos(isIos());
    setDenied(
      typeof Notification !== "undefined" && Notification.permission === "denied",
    );

    if (
      !("serviceWorker" in navigator) ||
      !("PushManager" in window) ||
      !vapidPublicKey
    ) {
      setStatus("unsupported");
      return;
    }

    load()
      .catch((cause) => {
        console.error("[push] 状態を読めませんでした", cause);
      })
      .finally(() => setStatus("ready"));
  }, [load, vapidPublicKey]);

  /** 購読を作る。**許可を求めるのはボタンを押した直後だけ** (ブラウザの要件) */
  async function enable() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setDenied(permission === "denied");
        setError(
          "通知が許可されませんでした。端末の設定から許可し直してください",
        );
        return;
      }

      const registration = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        // false は許されない (バックグラウンドで黙って動く用途を塞ぐため)
        userVisibleOnly: true,
        applicationServerKey: toApplicationServerKey(vapidPublicKey),
      });

      await save(subscription, DEFAULT_PREFS);
      setPrefs(DEFAULT_PREFS);
      setSubscribed(true);
      setNotice("この端末で通知を受け取ります");
    } catch (cause) {
      setError(
        `通知を登録できませんでした: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      );
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        // **サーバー側を先に消す。** ブラウザ側だけ先に解除して通信が失敗すると、
        // 届かない endpoint が残り続ける
        const res = await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          setError(body?.error ?? "通知を解除できませんでした");
          return;
        }
        await subscription.unsubscribe();
      }
      setSubscribed(false);
      setNotice("この端末への通知を止めました");
    } catch (cause) {
      setError(
        `通知を解除できませんでした: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      );
    } finally {
      setBusy(false);
    }
  }

  async function save(subscription: PushSubscription, next: PushPrefs) {
    const json = subscription.toJSON() as {
      keys?: { p256dh?: string; auth?: string };
    };
    const res = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        endpoint: subscription.endpoint,
        keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
        prefs: next,
      }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      throw new Error(body?.error ?? "保存できませんでした");
    }
  }

  async function toggle(category: keyof PushPrefs) {
    const next = { ...prefs, [category]: !prefs[category] };
    // 押した瞬間に反映する。失敗したら元に戻す
    setPrefs(next);
    setError(null);
    setNotice(null);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        setPrefs(prefs);
        setSubscribed(false);
        setError("この端末の登録が切れています。もう一度オンにしてください");
        return;
      }
      await save(subscription, next);
    } catch (cause) {
      setPrefs(prefs);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <section className={settingsSectionClass}>
      <h2 className="text-base font-bold">通知</h2>
      <p className="text-sm text-[var(--muted)]">
        この端末だけの設定です。別の端末では別に登録が要ります。
      </p>

      {error ? (
        <p role="alert" className="text-sm text-[var(--danger-fg)]">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-lg bg-[var(--surface)] px-3 py-2 text-sm">
          {notice}
        </p>
      ) : null}

      {status === "checking" ? (
        <p className="text-sm text-[var(--muted)]">確認しています…</p>
      ) : null}

      {status === "unsupported" ? (
        <div className="rounded-lg border border-[var(--border)] px-3 py-3 text-sm">
          {ios && !standalone ? (
            <>
              <p className="font-bold">ホーム画面に追加すると使えます</p>
              <p className="mt-1 text-[var(--muted)]">
                iPhone では、Safari のタブで開いている間は通知を受け取れません。
                共有ボタン → 「ホーム画面に追加」でアプリとして追加し、
                そのアイコンから開いてこの画面をもう一度開いてください。
              </p>
            </>
          ) : (
            <p className="text-[var(--muted)]">
              この端末・ブラウザは通知に対応していません。
            </p>
          )}
        </div>
      ) : null}

      {status === "ready" && !subscribed ? (
        <div className="space-y-2">
          {denied ? (
            <p className="text-sm text-[var(--danger-fg)]">
              通知がブロックされています。端末の設定でこのサイトの通知を許可してから、もう一度押してください。
            </p>
          ) : null}
          <button
            type="button"
            onClick={enable}
            disabled={busy}
            className="rounded-lg border border-[var(--foreground)] px-4 py-2 text-sm font-bold disabled:opacity-50"
          >
            この端末で通知を受け取る
          </button>
          {ios && !standalone ? (
            <p className="text-xs text-[var(--muted)]">
              iPhone では、ホーム画面に追加したアイコンから開いた場合のみ届きます。
            </p>
          ) : null}
        </div>
      ) : null}

      {status === "ready" && subscribed ? (
        <div className="space-y-2">
          <ul className="space-y-1">
            {CATEGORIES.map((category) => (
              <li key={category.key}>
                <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-[var(--border)] px-3 py-2">
                  <input
                    type="checkbox"
                    checked={prefs[category.key]}
                    onChange={() => toggle(category.key)}
                    className="mt-0.5 h-4 w-4 shrink-0"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-bold">
                      {category.label}
                    </span>
                    <span className="block text-xs text-[var(--muted)]">
                      {category.hint}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={disable}
            disabled={busy}
            className="text-sm text-[var(--muted)] underline disabled:opacity-50"
          >
            この端末への通知を止める
          </button>
        </div>
      ) : null}
    </section>
  );
}
