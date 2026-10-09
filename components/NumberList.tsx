"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ErrorMessage, buttonClass, inputClass } from "@/components/ui";
import { formatSpanRange } from "@/lib/day-span";
import { numberColor } from "@/lib/numbers";
import { createClient } from "@/lib/supabase/client";
import { formatDateLabel } from "@/lib/time";

/**
 * 所属ナンバーの一覧と新規作成 (SPEC.md §6.3)
 *
 * **タブ②を開いた時点でここが見える** (v1.14.2)。以前は「ナンバー管理」を
 * 押して別ページへ移らないと出てこなかったが、所属しているナンバーの確認と
 * 日程の登録はタブ②で一番よくやることで、毎回1タップ挟んでいた。
 *
 * 作成は RLS 経由で直接 insert する (`ins_numbers` が owner_id = auth.uid() を
 * 許可)。作成者がメンバーに入るのは DB のトリガ (trg_numbers_owner_member) の
 * 仕事なので、ここでは number_members を触らない。
 */
export interface NumberSummary {
  id: string;
  name: string;
  isOwner: boolean;
  memberCount: number;
  /** 今日以降で一番近い日程 (§6.7.12 / v1.30)。無ければ null */
  nextEvent: {
    date: string;
    startTime: string;
    endTime: string;
    place: string;
  } | null;
}

export function NumberList({
  numbers,
  currentUserId,
  loadError,
}: {
  numbers: NumberSummary[];
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
    <>
      <ErrorMessage>{error}</ErrorMessage>

      {/*
        **主催しているものと参加しているものを分ける** (§6.7.12 / v1.30)。
        1つのリストに「/ 主催」と小さく付くだけだと、自分が動かす側なのか
        待つ側なのかが読み取りにくかった。
      */}
      {numbers.length === 0 ? (
        <section className="space-y-2">
          <h2 className="text-sm font-bold">所属しているナンバー</h2>
          <p className="rounded-xl bg-[var(--cell)] px-4 py-5 text-center text-sm text-[var(--muted)]">
            所属しているナンバーはありません。
            <br />
            自分で作るか、主催者に追加してもらってください
          </p>
        </section>
      ) : (
        <>
          <NumberGroup
            title="主催しているナンバー"
            numbers={numbers.filter((number) => number.isOwner)}
          />
          <NumberGroup
            title="参加しているナンバー"
            numbers={numbers.filter((number) => !number.isOwner)}
          />
        </>
      )}

      <form
        onSubmit={create}
        className="space-y-2 rounded-xl bg-[var(--cell)] p-3"
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
    </>
  );
}

function NumberGroup({
  title,
  numbers,
}: {
  title: string;
  numbers: NumberSummary[];
}) {
  if (numbers.length === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-bold">{title}</h2>
      <ul className="space-y-2">
        {numbers.map((number) => {
          const color = numberColor(number.id);
          const next = number.nextEvent;
          return (
            <li key={number.id}>
              <Link
                href={`/numbers/${number.id}`}
                className="flex items-center gap-3 rounded-xl bg-[var(--cell)] p-3"
              >
                <span
                  aria-hidden
                  className="h-10 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: color.bg }}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate font-medium">{number.name}</span>
                    <span
                      className={`shrink-0 rounded-[5px] px-1.5 py-px text-[11px] font-bold ${
                        number.isOwner
                          ? "bg-[var(--tint)] text-white"
                          : "bg-[var(--fill)] text-[var(--muted)]"
                      }`}
                    >
                      {number.isOwner ? "主催" : "メンバー"}
                    </span>
                  </span>
                  {/*
                    次の日程 (§6.7.12)。メンバーは開かなくても次の練習が分かり、
                    主催者は日程を入れ忘れているナンバーに気付ける
                  */}
                  <span className="block truncate text-xs text-[var(--muted)]">
                    {next
                      ? `次 ${formatDateLabel(next.date)} ${formatSpanRange(
                          next.startTime,
                          next.endTime,
                        )}${next.place ? ` ${next.place}` : ""}`
                      : number.isOwner
                        ? "日程はまだありません。開いて追加できます"
                        : "日程はまだありません"}
                  </span>
                  <span className="block text-xs text-[var(--muted)]">
                    メンバー{number.memberCount}人
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
    </section>
  );
}
