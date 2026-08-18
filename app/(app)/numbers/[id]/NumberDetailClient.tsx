"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  ErrorMessage,
  buttonClass,
  inputClass,
  secondaryButtonClass,
} from "@/components/ui";
import { GENRES, GENRE_BY_ID } from "@/lib/constants";
import { numberColor } from "@/lib/numbers";
import { createClient } from "@/lib/supabase/client";
import {
  finalizeTimeInput,
  formatDateLabel,
  formatTimeRange,
  normalizeDateInput,
  normalizeTimeInput,
  todayInTokyo,
} from "@/lib/time";

/**
 * ナンバー詳細 (SPEC.md §6.3)
 *
 * - 日程: メンバーは閲覧のみ。owner は追加/編集/削除
 * - メンバー: owner は名簿から追加/削除。メンバーは自分の脱退のみ
 *
 * 書き込みはすべて RLS 経由。`mod_nevents` と `ins_nmembers` が owner を、
 * `del_nmembers` が「owner または本人」を許可しているので、
 * 画面のボタンを隠すのは補助でしかない (SPEC §13.2)。
 *
 * メンバー追加のお知らせは DB のトリガ (trg_notify_number_added) が出す。
 * ここで notifications を触ってはいけない (二重に届く)。
 */

interface NumberInfo {
  id: string;
  name: string;
  ownerId: string;
}

interface Member {
  userId: string;
  username: string;
  generation: number;
  mainGenreId: number;
  isOb: boolean;
}

interface NumberEvent {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  place: string;
  note: string | null;
}

export function NumberDetailClient({
  number,
  members,
  events,
  currentUserId,
}: {
  number: NumberInfo;
  members: Member[];
  events: NumberEvent[];
  currentUserId: string;
}) {
  const [tab, setTab] = useState<"events" | "members">("events");
  const [error, setError] = useState<string | null>(null);
  const isOwner = number.ownerId === currentUserId;
  const color = numberColor(number.id);

  return (
    <main className="mx-auto max-w-2xl space-y-4 px-4 py-3">
      <div className="flex items-center gap-2">
        <Link href="/numbers" className="text-sm text-[var(--muted)]">
          ‹ 一覧
        </Link>
      </div>

      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="h-8 w-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: color.bg }}
        />
        <div className="min-w-0">
          <h1 className="truncate text-lg font-bold">{number.name}</h1>
          <p className="text-xs text-[var(--muted)]">
            メンバー{members.length}人{isOwner ? " / あなたが主催" : ""}
          </p>
        </div>
      </div>

      <nav className="flex gap-1 rounded-xl border border-[var(--border)] p-1">
        {(
          [
            { id: "events", label: "日程" },
            { id: "members", label: "メンバー" },
          ] as const
        ).map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              setError(null);
              setTab(item.id);
            }}
            aria-current={tab === item.id ? "page" : undefined}
            className={`flex-1 rounded-lg px-2 py-2 text-sm font-medium ${
              tab === item.id
                ? "bg-[var(--foreground)] text-white"
                : "text-[var(--muted)]"
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <ErrorMessage>{error}</ErrorMessage>

      {tab === "events" ? (
        <EventsTab
          numberId={number.id}
          events={events}
          isOwner={isOwner}
          onError={setError}
        />
      ) : (
        <MembersTab
          number={number}
          members={members}
          isOwner={isOwner}
          currentUserId={currentUserId}
          onError={setError}
        />
      )}

      {isOwner ? (
        <DeleteSection
          number={number}
          memberCount={members.length}
          eventCount={events.length}
          onError={setError}
        />
      ) : null}
    </main>
  );
}

/**
 * ナンバーの削除 (SPEC §6.3 / v1.10)
 *
 * メンバーと日程も cascade で消え、**メンバー全員の予定と購読icsから消える**。
 * 取り返しがつかないうえ影響が自分だけで済まないので、
 * confirm ではなく**名前の一致**を求める。
 */
function DeleteSection({
  number,
  memberCount,
  eventCount,
  onError,
}: {
  number: NumberInfo;
  memberCount: number;
  eventCount: number;
  onError: (message: string | null) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [pending, setPending] = useState(false);

  async function remove() {
    setPending(true);
    onError(null);
    const supabase = createClient();
    const { error } = await supabase.from("numbers").delete().eq("id", number.id);
    setPending(false);
    if (error) {
      onError(`削除できませんでした: ${error.message}`);
      return;
    }
    router.push("/numbers");
    router.refresh();
  }

  return (
    <section className="space-y-2 rounded-xl border border-[#E5B4AE] p-3">
      <h2 className="text-sm font-bold text-[#8B1A10]">ナンバーを削除</h2>
      {open ? (
        <>
          <p className="text-xs text-[var(--muted)]">
            メンバー{memberCount}人と日程{eventCount}件も一緒に消えます。
            <strong>メンバー全員の予定と購読カレンダーからも消えます。</strong>
            元に戻せません。
          </p>
          <p className="text-xs text-[var(--muted)]">
            続けるにはナンバー名「{number.name}」を入力してください
          </p>
          <input
            aria-label="確認のためナンバー名を入力"
            value={typed}
            disabled={pending}
            onChange={(e) => setTyped(e.target.value)}
            className={inputClass}
          />
          <button
            type="button"
            disabled={pending || typed.trim() !== number.name}
            onClick={remove}
            className="w-full rounded-lg bg-[#8B1A10] px-4 py-3 text-base font-bold text-white disabled:opacity-40"
          >
            完全に削除する
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setTyped("");
            }}
            className={secondaryButtonClass}
          >
            やめる
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={`${secondaryButtonClass} text-[#8B1A10]`}
        >
          このナンバーを削除する
        </button>
      )}
    </section>
  );
}

/** 日程一覧。owner だけが追加/編集/削除できる (SPEC §6.3「日程管理(ownerのみ)」) */
function EventsTab({
  numberId,
  events,
  isOwner,
  onError,
}: {
  numberId: string;
  events: NumberEvent[];
  isOwner: boolean;
  onError: (message: string | null) => void;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<NumberEvent | null>(null);
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState(false);
  const today = todayInTokyo();

  async function remove(event: NumberEvent) {
    if (
      !window.confirm(
        `${formatDateLabel(event.date)} ${formatTimeRange(event.startTime, event.endTime)} の予定を削除しますか?`,
      )
    ) {
      return;
    }
    setPending(true);
    onError(null);
    const supabase = createClient();
    const { error } = await supabase
      .from("number_events")
      .delete()
      .eq("id", event.id);
    setPending(false);
    if (error) {
      onError(`削除できませんでした: ${error.message}`);
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-3">
      {isOwner ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            onError(null);
            setCreating(true);
          }}
          className={secondaryButtonClass}
        >
          日程を追加する
        </button>
      ) : (
        <p className="text-xs text-[var(--muted)]">
          日程の追加・変更は主催のみ行えます
        </p>
      )}

      {events.length === 0 ? (
        <p className="rounded-xl border border-[var(--border)] px-4 py-6 text-center text-sm text-[var(--muted)]">
          登録されている日程はありません
        </p>
      ) : (
        <ul className="divide-y divide-[var(--border)] rounded-xl border border-[var(--border)]">
          {events.map((event) => (
            <li
              key={event.id}
              className={`flex items-center gap-2 px-3 py-2 ${
                event.date < today ? "opacity-50" : ""
              }`}
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm">
                  <span className="font-medium">
                    {formatDateLabel(event.date)}
                  </span>{" "}
                  <span className="tabular-nums text-[var(--muted)]">
                    {formatTimeRange(event.startTime, event.endTime)}
                  </span>
                </p>
                <p className="truncate text-xs text-[var(--muted)]">
                  @{event.place}
                  {event.note ? ` / ${event.note}` : ""}
                </p>
              </div>
              {isOwner ? (
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      onError(null);
                      setEditing(event);
                    }}
                    className="rounded border border-[var(--border)] px-2 py-1 text-xs"
                  >
                    編集
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => remove(event)}
                    className="rounded border border-[var(--border)] px-2 py-1 text-xs text-[#8B1A10]"
                  >
                    削除
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {creating || editing ? (
        <EventEditor
          numberId={numberId}
          initial={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onError={onError}
        />
      ) : null}
    </div>
  );
}

function EventEditor({
  numberId,
  initial,
  onClose,
  onError,
}: {
  numberId: string;
  initial: NumberEvent | null;
  onClose: () => void;
  onError: (message: string | null) => void;
}) {
  const router = useRouter();
  // **新規は空で開く。** 今日の日付が入っていると、iOS の数字キーボードでは
  // ハイフンを打てないので「20260910」と入れるために10回以上消す必要があった。
  // 編集のときは今の値を見せる (何を直しているのか分からなくなるため)
  const [date, setDate] = useState(initial?.date ?? "");
  const [startTime, setStartTime] = useState(initial?.startTime ?? "");
  const [endTime, setEndTime] = useState(initial?.endTime ?? "");
  const [place, setPlace] = useState(initial?.place ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const valid =
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(endTime) &&
    startTime < endTime &&
    place.trim().length > 0;

  async function save() {
    setPending(true);
    onError(null);
    const supabase = createClient();
    const payload = {
      date,
      start_time: startTime,
      end_time: endTime,
      place: place.trim(),
      note: note.trim() || null,
    };
    const { error } = initial
      ? await supabase.from("number_events").update(payload).eq("id", initial.id)
      : await supabase
          .from("number_events")
          .insert({ ...payload, number_id: numberId });

    setPending(false);
    if (error) {
      onError(`保存できませんでした: ${error.message}`);
      return;
    }
    onClose();
    router.refresh();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
      <button
        type="button"
        aria-label="閉じる"
        className="absolute inset-0 h-full w-full cursor-default"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        className="relative z-10 max-h-[90dvh] w-full max-w-md space-y-3 overflow-y-auto rounded-t-2xl bg-[var(--background)] p-4 sm:rounded-2xl"
      >
        <h3 className="text-base font-bold">
          {initial ? "日程を編集" : "日程を追加"}
        </h3>

        <label className="block">
          <span className="text-sm font-medium">日付</span>
          <input
            value={date}
            placeholder="20260910"
            inputMode="numeric"
            disabled={pending}
            autoFocus={!initial}
            onChange={(e) => setDate(normalizeDateInput(e.target.value))}
            onBlur={(e) => setDate(normalizeDateInput(e.target.value))}
            className={inputClass}
          />
          <span className="mt-1 block text-xs text-[var(--muted)]">
            数字だけで入力できます (20260910 → 2026-09-10)
          </span>
        </label>

        <div className="flex items-end gap-2">
          <label className="block flex-1">
            <span className="text-sm font-medium">開始</span>
            <input
              value={startTime}
              placeholder="19:00"
              inputMode="numeric"
              disabled={pending}
              onChange={(e) => setStartTime(normalizeTimeInput(e.target.value))}
              onBlur={(e) => setStartTime(finalizeTimeInput(e.target.value))}
              className={inputClass}
            />
          </label>
          <span className="pb-2 text-sm">〜</span>
          <label className="block flex-1">
            <span className="text-sm font-medium">終了</span>
            <input
              value={endTime}
              placeholder="21:00"
              inputMode="numeric"
              disabled={pending}
              onChange={(e) => setEndTime(normalizeTimeInput(e.target.value))}
              onBlur={(e) => setEndTime(finalizeTimeInput(e.target.value))}
              className={inputClass}
            />
          </label>
        </div>
        <p className="text-xs text-[var(--muted)]">
          数字だけでも入力できます (1900 → 19:00)
        </p>

        <label className="block">
          <span className="text-sm font-medium">場所</span>
          <input
            value={place}
            placeholder="例: スタジオ○○ / 剣道場"
            disabled={pending}
            onChange={(e) => setPlace(e.target.value)}
            className={inputClass}
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium">
            メモ <span className="font-normal text-[var(--muted)]">(任意)</span>
          </span>
          <input
            value={note}
            disabled={pending}
            onChange={(e) => setNote(e.target.value)}
            className={inputClass}
          />
        </label>

        <button
          type="button"
          disabled={pending || !valid}
          onClick={save}
          className={buttonClass}
        >
          保存する
        </button>
        <button type="button" onClick={onClose} className={secondaryButtonClass}>
          閉じる
        </button>
      </div>
    </div>
  );
}

/**
 * メンバー管理 (SPEC §6.3)
 *
 * 名簿は profiles 全件から探す (`sel_profiles` が全員に select を許可)。
 * **既定フィルタは「現役のみ」**で、OB にはバッジを出す。
 * 縦イベで OB を誘う場合だけ切り替える運用。
 */
function MembersTab({
  number,
  members,
  isOwner,
  currentUserId,
  onError,
}: {
  number: NumberInfo;
  members: Member[];
  isOwner: boolean;
  currentUserId: string;
  onError: (message: string | null) => void;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [candidates, setCandidates] = useState<Member[] | null>(null);
  const [query, setQuery] = useState("");
  const [genreId, setGenreId] = useState<number | null>(null);
  const [generation, setGeneration] = useState<number | null>(null);
  const [includeOb, setIncludeOb] = useState(false);

  // 名簿は owner が「追加」を開いたときだけ取りに行く。
  // 閲覧しかしないメンバーには不要なクエリなので既定では引かない
  useEffect(() => {
    if (!isOwner || candidates !== null) return;
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("profiles")
        .select("user_id, username, generation, main_genre_id, role")
        .order("generation", { ascending: false });
      if (cancelled) return;
      if (error) {
        onError(`名簿を取得できませんでした: ${error.message}`);
        setCandidates([]);
        return;
      }
      setCandidates(
        (
          (data ?? []) as {
            user_id: string;
            username: string;
            generation: number;
            main_genre_id: number;
            role: string;
          }[]
        ).map((row) => ({
          userId: row.user_id,
          username: row.username,
          generation: row.generation,
          mainGenreId: row.main_genre_id,
          isOb: row.role === "ob",
        })),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [isOwner, candidates, onError]);

  const memberIds = new Set(members.map((m) => m.userId));
  const generations = [
    ...new Set((candidates ?? []).map((c) => c.generation)),
  ].sort((a, b) => b - a);

  const filtered = (candidates ?? [])
    .filter((c) => !memberIds.has(c.userId))
    .filter((c) => includeOb || !c.isOb)
    .filter((c) => genreId === null || c.mainGenreId === genreId)
    .filter((c) => generation === null || c.generation === generation)
    .filter((c) => query.trim() === "" || c.username.includes(query.trim()));

  async function add(userId: string) {
    setPending(true);
    onError(null);
    const supabase = createClient();
    const { error } = await supabase
      .from("number_members")
      .insert({ number_id: number.id, user_id: userId });
    setPending(false);
    if (error) {
      onError(`追加できませんでした: ${error.message}`);
      return;
    }
    router.refresh();
  }

  async function remove(member: Member) {
    const self = member.userId === currentUserId;
    if (
      !window.confirm(
        self
          ? `「${number.name}」から脱退しますか?\n自分の予定からも消えます`
          : `${member.username} をメンバーから外しますか?`,
      )
    ) {
      return;
    }
    setPending(true);
    onError(null);
    const supabase = createClient();
    const { error } = await supabase
      .from("number_members")
      .delete()
      .eq("number_id", number.id)
      .eq("user_id", member.userId);
    setPending(false);
    if (error) {
      onError(`外せませんでした: ${error.message}`);
      return;
    }
    if (self) {
      // 自分が抜けたらもうこのページは見られない (RLS で 404 になる)
      router.push("/numbers");
      return;
    }
    router.refresh();
  }

  const chipClass = (on: boolean) =>
    `rounded-full border px-2.5 py-1 text-xs ${
      on
        ? "border-[var(--foreground)] bg-[var(--foreground)] font-bold text-white"
        : "border-[var(--border)]"
    }`;

  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <h2 className="text-sm font-bold">メンバー ({members.length}人)</h2>
        <ul className="divide-y divide-[var(--border)] rounded-xl border border-[var(--border)]">
          {members.map((member) => (
            <li key={member.userId} className="flex items-center gap-2 px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-sm">
                {member.username}
                {member.userId === number.ownerId ? (
                  <span className="ml-1 text-xs text-[var(--muted)]">(主催)</span>
                ) : null}
                {member.isOb ? (
                  <span className="ml-1 rounded bg-[var(--surface)] px-1 text-[10px] text-[var(--muted)]">
                    OB/OG
                  </span>
                ) : null}
              </span>
              {/* 主催は外せない。外すと誰も日程を編集できなくなるため */}
              {(isOwner || member.userId === currentUserId) &&
              member.userId !== number.ownerId ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => remove(member)}
                  className="shrink-0 rounded border border-[var(--border)] px-2 py-1 text-xs"
                >
                  {member.userId === currentUserId ? "脱退" : "外す"}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      {isOwner ? (
        <section className="space-y-2">
          <h2 className="text-sm font-bold">メンバーを追加</h2>

          <input
            aria-label="名前で検索"
            value={query}
            placeholder="ユーザーIDで検索"
            onChange={(e) => setQuery(e.target.value)}
            className={inputClass}
          />

          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              onClick={() => setGenreId(null)}
              className={chipClass(genreId === null)}
            >
              全ジャンル
            </button>
            {GENRES.map((genre) => (
              <button
                key={genre.id}
                type="button"
                onClick={() => setGenreId(genre.id)}
                className={chipClass(genreId === genre.id)}
              >
                {genre.code}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              onClick={() => setGeneration(null)}
              className={chipClass(generation === null)}
            >
              全期
            </button>
            {generations.map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setGeneration(g)}
                className={chipClass(generation === g)}
              >
                {g}期
              </button>
            ))}
            <button
              type="button"
              onClick={() => setIncludeOb((prev) => !prev)}
              className={chipClass(includeOb)}
            >
              OB/OGも含める
            </button>
          </div>

          {candidates === null ? (
            <p className="text-sm text-[var(--muted)]">名簿を読み込み中…</p>
          ) : filtered.length === 0 ? (
            <p className="rounded-xl border border-[var(--border)] px-4 py-4 text-center text-sm text-[var(--muted)]">
              該当する人がいません
            </p>
          ) : (
            <ul className="max-h-72 divide-y divide-[var(--border)] overflow-y-auto rounded-xl border border-[var(--border)]">
              {filtered.map((candidate) => (
                <li
                  key={candidate.userId}
                  className="flex items-center gap-2 px-3 py-2"
                >
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {candidate.username}
                    {candidate.isOb ? (
                      <span className="ml-1 rounded bg-[var(--surface)] px-1 text-[10px] text-[var(--muted)]">
                        OB/OG
                      </span>
                    ) : null}
                    <span className="ml-1 text-xs text-[var(--muted)]">
                      {GENRE_BY_ID.get(candidate.mainGenreId)?.code ?? ""}
                    </span>
                  </span>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => add(candidate.userId)}
                    className="shrink-0 rounded border border-[var(--border)] px-2 py-1 text-xs"
                  >
                    追加
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
