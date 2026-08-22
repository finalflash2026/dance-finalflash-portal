"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  ErrorMessage,
  Field,
  buttonClass,
  inputClass,
  secondaryButtonClass,
  settingsSectionClass,
} from "@/components/ui";
import {
  GENRES,
  GENRE_BY_ID,
  ROLE_LABELS,
  isCoordinatorOrAbove,
} from "@/lib/constants";
import { createClient } from "@/lib/supabase/client";
import {
  THEME_HINTS,
  THEME_LABELS,
  applyTheme,
  readStoredTheme,
  storeTheme,
  type Theme,
} from "@/lib/theme";
import type { Profile } from "@/lib/types";

import { PushSection } from "./PushSection";

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
  vapidPublicKey,
}: {
  profile: Profile;
  initialToken: string | null;
  initialSubgenre2: number | null;
  initialSubgenre3: number | null;
  baseUrl: string;
  /** 空文字なら通知が未設定の環境。PushSection が「非対応」として扱う */
  vapidPublicKey: string;
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

      <section className={settingsSectionClass}>
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

      <section className={settingsSectionClass}>
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

      {/*
        通知は現役だけに配る (練習日程・鍵はどちらも OB に関係が無い。SPEC §6.6)。
        受け取れないのに設定欄だけあると、オンにしても何も来ない状態になる
      */}
      {profile.role !== "ob" ? (
        <PushSection vapidPublicKey={vapidPublicKey} />
      ) : null}

      <ThemeSection />

      {/*
        **設定の中では一番下** (v1.18.1)。日常的に使うのは通知やテーマで、
        ここは折衝・3役になるときの一度きりの操作。上のほうにあると、
        大半の人にとって用の無い欄が目立つ場所を占める。

        OB は合言葉が正しくてもなれないため、欄自体を出さない (SPEC §3.6)。
      */}
      {profile.role !== "ob" ? (
        <RoleSection
          role={profile.role}
          onError={setError}
          onNotice={setNotice}
        />
      ) : null}

      {/* ログアウトは設定ではなく操作なので、すべての後ろに置く */}
      <section className={settingsSectionClass}>
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

/**
 * 表示テーマの切り替え (SPEC §6.4.1 / §12 / v1.13)
 *
 * 選択は端末ごとの好みなので localStorage に持ち、DBには入れない。
 * 保存と同時に `<html data-theme>` を書き換えるので、押した瞬間に切り替わる。
 *
 * 初期値は**マウント後に読む**。サーバーは localStorage を見られないため、
 * 描画時に選択状態を決めるとハイドレーションがずれる。
 */
function ThemeSection() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    setTheme(readStoredTheme());
  }, []);

  function select(next: Theme) {
    applyTheme(next);
    storeTheme(next);
    setTheme(next);
  }

  return (
    <section className={settingsSectionClass}>
      <h2 className="text-base font-bold">表示テーマ</h2>
      <p className="text-sm text-[var(--muted)]">
        この端末だけの設定です。別の端末では別に選べます。
      </p>

      <div className="flex gap-2">
        {(["light", "dark"] as const).map((value) => {
          const selected = theme === value;
          return (
            <button
              key={value}
              type="button"
              onClick={() => select(value)}
              aria-pressed={selected}
              className={`flex-1 rounded-lg border px-3 py-3 text-left ${
                selected
                  ? "border-[var(--primary)] bg-[var(--surface)]"
                  : "border-[var(--border)]"
              }`}
            >
              <span className="block text-sm font-bold">
                {THEME_LABELS[value]}
                {selected ? (
                  <span className="ml-1 text-xs font-normal text-[var(--muted)]">
                    選択中
                  </span>
                ) : null}
              </span>
              <span className="mt-0.5 block text-xs text-[var(--muted)]">
                {THEME_HINTS[value]}
              </span>
            </button>
          );
        })}
      </div>
    </section>
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
 * 権限の追加と、折衝・管理画面への入口 (SPEC §6.4.1 / §3.4 / §7)
 *
 * 下部タブバーは ①全体 / ②ナンバー / ③マイ の3タブ固定なので、
 * **`/coordinator` と `/admin` への導線はここにしか無い** (SPEC §7)。
 *
 * 合言葉の照合は /api/role/elevate (service role) が行う。
 * ここは合言葉を送って結果を表示するだけで、権限の判断は一切しない。
 */
function RoleSection({
  role,
  onError,
  onNotice,
}: {
  role: Profile["role"];
  onError: (message: string | null) => void;
  onNotice: (message: string | null) => void;
}) {
  const router = useRouter();
  const [rolePassword, setRolePassword] = useState("");
  const [pending, setPending] = useState(false);

  async function elevate(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    onError(null);
    onNotice(null);
    try {
      const res = await fetch("/api/role/elevate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rolePassword }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        onError(body.error ?? "権限を追加できませんでした");
        return;
      }
      setRolePassword("");
      onNotice(body.message ?? "権限を追加しました");
      // ヘッダのロール表示と、下の折衝・管理リンクを反映させる
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <section className={settingsSectionClass}>
      <h2 className="text-base font-bold">権限</h2>
      <p className="text-sm text-[var(--muted)]">
        現在: <strong>{ROLE_LABELS[role]}</strong>
      </p>

      {isCoordinatorOrAbove(role) ? (
        <div className="space-y-2">
          <Link
            href="/coordinator"
            className={`${secondaryButtonClass} block text-center`}
          >
            折衝ワークフローを開く
          </Link>
          {role === "admin" ? (
            <Link
              href="/admin"
              className={`${secondaryButtonClass} block text-center`}
            >
              管理者画面を開く
            </Link>
          ) : null}
        </div>
      ) : null}

      <form onSubmit={elevate} className="space-y-3">
        <Field
          label="合言葉を入れて権限を追加する"
          hint="折衝または3役の合言葉を入れると、その担当の画面が使えるようになります。いま持っている権限が減ることはありません。"
        >
          <input
            type="password"
            className={inputClass}
            value={rolePassword}
            autoComplete="off"
            onChange={(e) => setRolePassword(e.target.value)}
          />
        </Field>
        <button
          type="submit"
          disabled={pending || rolePassword.length === 0}
          className={secondaryButtonClass}
        >
          権限を追加する
        </button>
      </form>
    </section>
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
    <section className={settingsSectionClass}>
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
