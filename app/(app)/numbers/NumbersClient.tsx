"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ErrorMessage, buttonClass, inputClass } from "@/components/ui";
import { numberColor } from "@/lib/numbers";
import { createClient } from "@/lib/supabase/client";

/**
 * 所属ナンバーの一覧と新規作成 (SPEC.md §6.3)
 *
 * 作成は RLS 経由で直接 insert する (`ins_numbers` が owner_id = auth.uid() を
 * 許可)。作成者がメンバーに入るのは DB のトリガ (trg_numbers_owner_member) の
 * 仕事なので、ここでは number_members を触らない。
 */
export function NumbersClient({
  numbers,
  currentUserId,
  loadError,
}: {
  numbers: { id: string; name: string; isOwner: boolean; memberCount: number }[];
  currentUserId: string;
  loadError: string | null;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(loadError);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;

    setPending(true);
    setError(null);

    const supabase = createClient();
    // **.select() を付けてはいけない。**
    // PostgreSQL は INSERT ... RETURNING に SELECT ポリシーも適用する。
    // sel_numbers は「メンバーであること」を要求するが、作成者をメンバーに
    // 入れるのは AFTER INSERT トリガなので RETURNING の時点ではまだ見えず、
    // 42501 (new row violates row-level security policy) で落ちる。
    // 作成した行が要るときは insert 後に改めて select すること。
    const { error: insertError } = await supabase
      .from("numbers")
      .insert({ name: trimmed, owner_id: currentUserId });

    setPending(false);
    if (insertError) {
      setError(`作成できませんでした: ${insertError.message}`);
      return;
    }
    setName("");
    router.refresh();
  }

  return (
    <main className="mx-auto max-w-2xl space-y-4 px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold">ナンバー管理</h1>
        <Link
          href="/number-cal"
          className="rounded-lg border border-[var(--border)] px-3 py-1 text-sm"
        >
          カレンダーへ
        </Link>
      </div>

      <ErrorMessage>{error}</ErrorMessage>

      {numbers.length === 0 ? (
        <p className="rounded-xl border border-[var(--border)] px-4 py-6 text-center text-sm text-[var(--muted)]">
          所属しているナンバーはありません。
          <br />
          自分で作るか、主催者に追加してもらってください
        </p>
      ) : (
        <ul className="space-y-2">
          {numbers.map((number) => {
            const color = numberColor(number.id);
            return (
              <li key={number.id}>
                <Link
                  href={`/numbers/${number.id}`}
                  className="flex items-center gap-3 rounded-xl border border-[var(--border)] p-3"
                >
                  <span
                    aria-hidden
                    className="h-8 w-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: color.bg }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {number.name}
                    </span>
                    <span className="block text-xs text-[var(--muted)]">
                      メンバー{number.memberCount}人
                      {number.isOwner ? " / 主催" : ""}
                    </span>
                  </span>
                  <span aria-hidden className="text-[var(--muted)]">
                    ›
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <form
        onSubmit={create}
        className="space-y-2 rounded-xl border border-[var(--border)] p-3"
      >
        <h2 className="text-sm font-bold">ナンバーを作る</h2>
        <p className="text-xs text-[var(--muted)]">
          作った人が主催になります。メンバーの追加と日程の登録は主催のみ行えます
        </p>
        <input
          aria-label="ナンバー名"
          value={name}
          placeholder="例: 初心者BREAK"
          disabled={pending}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
        />
        <button
          type="submit"
          disabled={pending || name.trim().length === 0}
          className={buttonClass}
        >
          作成する
        </button>
      </form>
    </main>
  );
}
