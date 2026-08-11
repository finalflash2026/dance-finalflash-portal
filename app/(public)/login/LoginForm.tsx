"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  ErrorMessage,
  Field,
  buttonClass,
  inputClass,
} from "@/components/ui";

/**
 * ログインフォーム (SPEC.md §3.3)
 * username + マイパスワードを POST /api/auth/login に送る。
 */
export function LoginForm({ initialUsername }: { initialUsername: string }) {
  const router = useRouter();
  const [username, setUsername] = useState(initialUsername);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(body.error ?? "ログインに失敗しました");
        return;
      }

      // Server Component 側のキャッシュを捨ててから遷移する
      router.refresh();
      router.push("/");
    } catch {
      setError("通信に失敗しました。電波状況を確認してください");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="ユーザーID" hint="例: 22BREAKせいあ">
        <input
          className={inputClass}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          required
        />
      </Field>

      <Field label="マイパスワード">
        <input
          className={inputClass}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
      </Field>

      <ErrorMessage>{error}</ErrorMessage>

      <button type="submit" className={buttonClass} disabled={pending}>
        {pending ? "ログイン中…" : "ログイン"}
      </button>

      <p className="text-center text-sm">
        <Link href="/signup" className="underline">
          はじめての人はこちら (新規登録)
        </Link>
      </p>
    </form>
  );
}
