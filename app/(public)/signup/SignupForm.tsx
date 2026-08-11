"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ErrorMessage, Field, buttonClass, inputClass } from "@/components/ui";
import { GENRES, MIN_PASSWORD_LENGTH } from "@/lib/constants";
import { buildUsername } from "@/lib/auth/username";

/**
 * 新規登録フォーム (SPEC.md §3.2)
 *
 * 期 / 1ジャン / 名前 / マイパスワード / サークル生合言葉。
 * username はサーバーで組み立てるが、**登録後に本人では変更できない**ため
 * 入力中にプレビューを出して確認してもらう。
 */
export function SignupForm() {
  const router = useRouter();
  const [generation, setGeneration] = useState("");
  const [mainGenreId, setMainGenreId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const genreCode = GENRES.find((g) => String(g.id) === mainGenreId)?.code;
  const preview =
    generation && genreCode && displayName.trim()
      ? buildUsername(Number(generation), genreCode, displayName)
      : null;

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          generation: Number(generation),
          mainGenreId: Number(mainGenreId),
          displayName,
          password,
          passphrase,
        }),
      });
      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(body.error ?? "登録に失敗しました");
        return;
      }

      // 登録できたら ID を引き継いでログイン画面へ
      router.push(`/login?username=${encodeURIComponent(body.username)}`);
    } catch {
      setError("通信に失敗しました。電波状況を確認してください");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="期" hint="入会年度の代。例: 22">
        <input
          className={inputClass}
          type="number"
          inputMode="numeric"
          min={1}
          max={99}
          value={generation}
          onChange={(e) => setGeneration(e.target.value)}
          required
        />
      </Field>

      <Field label="1ジャン (メインジャンル)" hint="登録後は本人では変更できません">
        <select
          className={inputClass}
          value={mainGenreId}
          onChange={(e) => setMainGenreId(e.target.value)}
          required
        >
          <option value="">選択してください</option>
          {GENRES.map((genre) => (
            <option key={genre.id} value={genre.id}>
              {genre.code}
            </option>
          ))}
        </select>
      </Field>

      <Field label="名前" hint="ひらがな / カタカナ / 漢字が使えます">
        <input
          className={inputClass}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          maxLength={20}
          required
        />
      </Field>

      {preview ? (
        <p className="rounded-lg bg-[var(--surface)] px-3 py-2 text-sm">
          あなたのユーザーID: <strong>{preview}</strong>
          <span className="mt-1 block text-xs text-[var(--muted)]">
            ログインに使います。同じIDの人がいる場合は名前の表記を変えてください
          </span>
        </p>
      ) : null}

      <Field
        label="マイパスワード"
        hint={`${MIN_PASSWORD_LENGTH}文字以上。メールが無いため、忘れた場合は管理者に再設定を依頼します`}
      >
        <input
          className={inputClass}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={MIN_PASSWORD_LENGTH}
          autoComplete="new-password"
          required
        />
      </Field>

      <Field label="サークル生合言葉" hint="サークル内で共有されている合言葉">
        <input
          className={inputClass}
          type="password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          autoComplete="off"
          required
        />
      </Field>

      <ErrorMessage>{error}</ErrorMessage>

      <button type="submit" className={buttonClass} disabled={pending}>
        {pending ? "登録中…" : "登録する"}
      </button>

      <p className="text-center text-sm">
        <Link href="/login" className="underline">
          登録済みの人はこちら (ログイン)
        </Link>
      </p>
    </form>
  );
}
