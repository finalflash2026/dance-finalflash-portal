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
 * 期 / 1ジャン / 名前 / 2ジャン・3ジャン / マイパスワード(2回) / サークル生合言葉。
 * username はサーバーで組み立てるが、**登録後に本人では変更できない**ため
 * 入力中にプレビューを出して確認してもらう。
 *
 * **パスワードは2回入力させる** (v1.19)。このサイトはメールを持たないので、
 * 打ち間違えたまま登録すると本人にも気づけず、管理者に再設定を頼むしかない。
 *
 * **2ジャン・3ジャンもここで選べる** (v1.19)。登録直後からマイカレンダーに
 * 出したいのに、設定画面まで行かないと選べなかった。後から変えられる点は
 * これまでどおり (§6.4.1)。
 */
export function SignupForm({
  google = false,
  generationChoices = [],
}: {
  /** 期の候補 (現役の期と、その次の期。新しい順。v1.36) */
  generationChoices?: number[];
  /**
   * Google でログインしたあとの登録 (§3.7 / v1.34)。パスワードの欄を出さず、
   * /api/auth/complete-profile に送ってそのままホームへ入る
   */
  google?: boolean;
}) {
  const router = useRouter();
  const [generation, setGeneration] = useState("");
  const [mainGenreId, setMainGenreId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [subgenre2Id, setSubgenre2Id] = useState("");
  const [subgenre3Id, setSubgenre3Id] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const genreCode = GENRES.find((g) => String(g.id) === mainGenreId)?.code;
  const preview =
    generation && genreCode && displayName.trim()
      ? buildUsername(Number(generation), genreCode, displayName)
      : null;

  /** 両方入力されていて食い違うときだけ知らせる (打っている途中で赤くしない) */
  const mismatch =
    !google &&
    password.length > 0 &&
    passwordConfirm.length > 0 &&
    password !== passwordConfirm;

  /**
   * 1ジャンを変えたとき、同じジャンルを選んでいたサブジャンルを外す。
   * 残したままだとサーバーに弾かれるが、**画面上は矛盾して見えない**ので
   * 「なぜ登録できないのか」が分からなくなる。
   */
  function selectMainGenre(value: string) {
    setMainGenreId(value);
    if (subgenre2Id === value) setSubgenre2Id("");
    if (subgenre3Id === value) setSubgenre3Id("");
  }

  /** 1ジャンと、もう片方のサブジャンルを候補から外す */
  function subgenreOptions(otherValue: string) {
    return GENRES.filter(
      (g) => String(g.id) !== mainGenreId && String(g.id) !== otherValue,
    );
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!google && password !== passwordConfirm) {
      setError("パスワードが一致しません。");
      return;
    }
    setPending(true);
    setError(null);

    try {
      const res = await fetch(google ? "/api/auth/complete-profile" : "/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          generation: Number(generation),
          mainGenreId: Number(mainGenreId),
          displayName,
          password,
          passwordConfirm,
          passphrase,
          subgenre2Id: subgenre2Id ? Number(subgenre2Id) : null,
          subgenre3Id: subgenre3Id ? Number(subgenre3Id) : null,
        }),
      });
      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(body.error ?? "登録に失敗しました。");
        return;
      }

      if (google) {
        // Google のログインでセッションはもうある。そのままホームへ
        router.refresh();
        router.replace("/");
        return;
      }
      // 登録できたら ID を引き継いでログイン画面へ
      router.push(`/login?username=${encodeURIComponent(body.username)}`);
    } catch {
      setError("通信に失敗しました。電波状況を確認してください。");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="期" hint="入会した年度の代。ユーザーIDの先頭の数字になります。">
        {/*
          今いる期を押せるように並べる (v1.36)。自分が何期か分からない1年生が
          迷うため。どれでもなければ下に数字で入れる
        */}
        {generationChoices.length > 0 ? (
          <div className="mb-2 mt-1 flex flex-wrap gap-1.5" role="group" aria-label="期の候補">
            {generationChoices.map((g) => (
              <button
                key={g}
                type="button"
                aria-pressed={generation === String(g)}
                onClick={() => setGeneration(String(g))}
                className={`h-10 rounded-full px-4 text-[15px] font-semibold ${
                  generation === String(g)
                    ? "bg-[var(--tint)] text-white"
                    : "bg-[var(--fill)]"
                }`}
              >
                {g}期
              </button>
            ))}
          </div>
        ) : null}
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

      <Field label="1ジャン(メインジャンル)" hint="登録した後は、自分では変えられません。">
        <select
          className={inputClass}
          value={mainGenreId}
          onChange={(e) => selectMainGenre(e.target.value)}
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

      <Field label="名前" hint="ひらがな・カタカナ・漢字が使えます。">
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

      {/*
        2ジャン・3ジャンは任意 (v1.19)。ここで選ぶと登録した時点から
        マイカレンダーと購読URLに含まれる。あとから設定画面で変えられる
      */}
      <Field label="2ジャン(任意)">
        <select
          className={inputClass}
          value={subgenre2Id}
          onChange={(e) => setSubgenre2Id(e.target.value)}
        >
          <option value="">設定しない</option>
          {subgenreOptions(subgenre3Id).map((genre) => (
            <option key={genre.id} value={genre.id}>
              {genre.code}
            </option>
          ))}
        </select>
      </Field>

      <Field label="3ジャン(任意)">
        <select
          className={inputClass}
          value={subgenre3Id}
          onChange={(e) => setSubgenre3Id(e.target.value)}
        >
          <option value="">設定しない</option>
          {subgenreOptions(subgenre2Id).map((genre) => (
            <option key={genre.id} value={genre.id}>
              {genre.code}
            </option>
          ))}
        </select>
      </Field>

      {/* Google で登録するときはパスワードを持たない (§3.7) */}
      {google ? null : (
        <>
          <Field
            label="マイパスワード"
            hint={`${MIN_PASSWORD_LENGTH}文字以上。メールを使わないので、忘れたときは管理者に再設定を頼みます。`}
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

          <Field label="マイパスワード(確認)">
            <input
              className={inputClass}
              type="password"
              value={passwordConfirm}
              onChange={(e) => setPasswordConfirm(e.target.value)}
              autoComplete="new-password"
              aria-invalid={mismatch}
              required
            />
            {mismatch ? (
              <p role="alert" className="mt-1 text-xs text-[var(--danger-fg)]">
                パスワードが一致しません
              </p>
            ) : null}
          </Field>
        </>
      )}

      <Field label="サークル生合言葉">
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

      {/* 食い違ったまま押せると、サーバーに往復してから断られることになる */}
      <button
        type="submit"
        className={buttonClass}
        disabled={pending || mismatch}
      >
        {pending ? "登録中…" : "登録する"}
      </button>

      {google ? null : (
        <p className="text-center text-sm">
          <Link href="/login" className="underline">
            登録済みの人はこちら(ログイン)
          </Link>
        </p>
      )}
    </form>
  );
}
