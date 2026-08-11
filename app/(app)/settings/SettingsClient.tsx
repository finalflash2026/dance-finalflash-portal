"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  ErrorMessage,
  Field,
  buttonClass,
  inputClass,
  secondaryButtonClass,
} from "@/components/ui";
import { GENRES, GENRE_BY_ID } from "@/lib/constants";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/lib/types";

/**
 * 設定画面の操作部 (SPEC.md §6.4.1)
 *
 * サブジャンルは RLS の範囲内なのでブラウザから直接 upsert / delete する。
 * 購読トークンは RLS ポリシーが無く触れないため、再発行だけサーバー API を叩く。
 */
export function SettingsClient({
  profile,
  initialToken,
  initialSubgenre2,
  initialSubgenre3,
  baseUrl,
}: {
  profile: Profile;
  initialToken: string | null;
  initialSubgenre2: number | null;
  initialSubgenre3: number | null;
  baseUrl: string;
}) {
  const router = useRouter();
  const [token, setToken] = useState(initialToken);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const httpsUrl = token ? `${baseUrl}/api/cal/${token}` : null;
  const webcalUrl = httpsUrl?.replace(/^https?:\/\//, "webcal://") ?? null;

  async function regenerate() {
    if (
      !window.confirm(
        "購読URLを再発行しますか?\n古いURLは即座に使えなくなるため、カレンダーアプリへの再登録が必要です。",
      )
    ) {
      return;
    }
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/cal/regenerate", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "再発行に失敗しました");
        return;
      }
      setToken(body.token);
      setNotice("購読URLを再発行しました。カレンダーアプリに登録し直してください");
    } finally {
      setPending(false);
    }
  }

  async function logout() {
    setPending(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.refresh();
    router.push("/login");
  }

  return (
    <main className="mx-auto max-w-2xl space-y-8 px-4 py-6">
      <h1 className="text-xl font-bold">設定</h1>

      <ErrorMessage>{error}</ErrorMessage>
      {notice ? (
        <p className="rounded-lg bg-[var(--surface)] px-3 py-2 text-sm">
          {notice}
        </p>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-base font-bold">アカウント</h2>
        <dl className="space-y-1 text-sm">
          <div className="flex gap-3">
            <dt className="w-24 shrink-0 text-[var(--muted)]">ユーザーID</dt>
            <dd>{profile.username}</dd>
          </div>
          <div className="flex gap-3">
            <dt className="w-24 shrink-0 text-[var(--muted)]">期</dt>
            <dd>{profile.generation}期</dd>
          </div>
          <div className="flex gap-3">
            <dt className="w-24 shrink-0 text-[var(--muted)]">1ジャン</dt>
            <dd>{GENRE_BY_ID.get(profile.main_genre_id)?.code ?? "-"}</dd>
          </div>
        </dl>
        <p className="text-xs text-[var(--muted)]">
          期・1ジャンの修正は管理者のみ行えます (SPEC §6.5.1)
        </p>
      </section>

      {/* OB には表示しない: 公式練に紐づく設定のため (SPEC §6.4.1) */}
      {profile.role !== "ob" ? (
        <SubgenreSection
          userId={profile.user_id}
          mainGenreId={profile.main_genre_id}
          initial2={initialSubgenre2}
          initial3={initialSubgenre3}
          onError={setError}
          onNotice={setNotice}
        />
      ) : null}

      <section className="space-y-3">
        <h2 className="text-base font-bold">カレンダー購読URL</h2>
        <p className="text-sm text-[var(--muted)]">
          Google / Apple カレンダーに登録すると、自分の予定が自動で反映されます。
          <strong>URLは他人に教えないでください</strong>(知っている人は予定を見られます)。
        </p>

        {httpsUrl && webcalUrl ? (
          <div className="space-y-3">
            <UrlRow label="https" url={httpsUrl} />
            <UrlRow label="webcal" url={webcalUrl} />
          </div>
        ) : (
          <p className="text-sm text-[var(--muted)]">
            購読トークンがまだありません。再発行を押すと作成されます。
          </p>
        )}

        <details className="rounded-lg border border-[var(--border)] p-3 text-sm">
          <summary className="cursor-pointer font-medium">登録手順</summary>
          <div className="mt-2 space-y-2 text-[var(--muted)]">
            <p>
              <strong>Google カレンダー (PC)</strong>: 左側「他のカレンダー」→
              「+」→「URLで追加」→ https の URL を貼る
            </p>
            <p>
              <strong>iPhone / Mac</strong>: webcal の URL
              をタップ(またはカレンダーApp →「ファイル」→「新規照会カレンダー」)
            </p>
            <p>
              反映の間隔はカレンダーアプリ側の都合で数時間〜1日ほどかかります。
            </p>
          </div>
        </details>

        <button
          type="button"
          onClick={regenerate}
          disabled={pending}
          className={secondaryButtonClass}
        >
          購読URLを再発行する
        </button>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-bold">ログアウト</h2>
        <button
          type="button"
          onClick={logout}
          disabled={pending}
          className={buttonClass}
        >
          ログアウト
        </button>
      </section>
    </main>
  );
}

function UrlRow({ label, url }: { label: string; url: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // クリップボードが使えない環境では手動選択してもらう
    }
  }

  return (
    <div>
      <p className="text-xs font-medium text-[var(--muted)]">{label}</p>
      <div className="mt-1 flex gap-2">
        <input
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className={`${inputClass} mt-0 font-mono text-xs`}
        />
        <button
          type="button"
          onClick={copy}
          className="shrink-0 rounded-lg border border-[var(--border)] px-3 text-sm"
        >
          {copied ? "コピー済" : "コピー"}
        </button>
      </div>
    </div>
  );
}

/**
 * 2ジャン / 3ジャン の設定 (SPEC §6.4.1)
 * 1ジャンとの重複は不可、空も可。変更は即保存。
 */
function SubgenreSection({
  userId,
  mainGenreId,
  initial2,
  initial3,
  onError,
  onNotice,
}: {
  userId: string;
  mainGenreId: number;
  initial2: number | null;
  initial3: number | null;
  onError: (message: string | null) => void;
  onNotice: (message: string | null) => void;
}) {
  const [values, setValues] = useState<Record<2 | 3, number | null>>({
    2: initial2,
    3: initial3,
  });
  const [pending, setPending] = useState(false);

  async function save(slot: 2 | 3, raw: string) {
    const genreId = raw ? Number(raw) : null;
    const other = slot === 2 ? values[3] : values[2];

    if (genreId !== null && genreId === mainGenreId) {
      onError("1ジャンと同じジャンルは選べません");
      return;
    }
    if (genreId !== null && genreId === other) {
      onError("2ジャンと3ジャンに同じジャンルは選べません");
      return;
    }

    setPending(true);
    onError(null);
    onNotice(null);

    const supabase = createClient();
    const { error } =
      genreId === null
        ? await supabase
            .from("user_subgenres")
            .delete()
            .eq("user_id", userId)
            .eq("slot", slot)
        : await supabase
            .from("user_subgenres")
            .upsert(
              { user_id: userId, slot, genre_id: genreId },
              { onConflict: "user_id,slot" },
            );

    setPending(false);

    if (error) {
      onError(`保存に失敗しました: ${error.message}`);
      return;
    }

    setValues((prev) => ({ ...prev, [slot]: genreId }));
    onNotice("サブジャンルを保存しました");
  }

  return (
    <section className="space-y-3">
      <h2 className="text-base font-bold">サブジャンル</h2>
      <p className="text-sm text-[var(--muted)]">
        ここで選んだジャンルの公式練が、マイカレンダーと購読URLに含まれます。
      </p>
      {([2, 3] as const).map((slot) => (
        <Field key={slot} label={`${slot}ジャン`}>
          <select
            className={inputClass}
            value={values[slot] ?? ""}
            disabled={pending}
            onChange={(e) => save(slot, e.target.value)}
          >
            <option value="">設定しない</option>
            {GENRES.filter((g) => g.id !== mainGenreId).map((genre) => (
              <option key={genre.id} value={genre.id}>
                {genre.code}
              </option>
            ))}
          </select>
        </Field>
      ))}
    </section>
  );
}
