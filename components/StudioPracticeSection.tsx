"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { AttendanceSheet } from "@/components/AttendanceSheet";
import { ErrorMessage, buttonClass, inputClass } from "@/components/ui";
import { formatSpanRange, spansMidnight } from "@/lib/day-span";
import { createClient } from "@/lib/supabase/client";
import {
  finalizeTimeInput,
  formatDateLabel,
  normalizeDateInput,
  normalizeTimeInput,
} from "@/lib/time";

/**
 * スタ練の設定 (SPEC.md §6.3.1 / v1.23)
 *
 * 公式練とは別に、ジャンルの有志がスタジオを取って行う練習。
 *
 * **ナンバーと違ってメンバーを選ばない。** 登録すると、そのジャンルを
 * 取っている人全員のマイカレンダーに自動で出る。誰が来るかを事前に
 * 決める性質のものではなく、名簿を作らせると「入れ忘れた人に伝わらない」
 * が起きる。
 *
 * **設定できるのは自分の1ジャンだけ。** 他ジャンルの予定を勝手に立てられると、
 * そのジャンルの人には出所の分からない予定が届く。RLS (`ins_gpractice`) が
 * 同じ条件を持っているので、画面の制限は補助でしかない。
 *
 * 直せるのは登録した本人だけ。同じジャンルの他の人にも触らせない
 * (空き申請の取消と同じ考え方。§6.1)。
 */

export interface StudioPractice {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  place: string;
  note: string | null;
  createdBy: string;
  createdByName: string;
}

export function StudioPracticeSection({
  genreCode,
  genreId,
  practices,
  currentUserId,
}: {
  genreCode: string;
  genreId: number;
  /** 自分の1ジャンのスタ練 (今日以降) */
  practices: StudioPractice[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [place, setPlace] = useState("");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 出欠管理窓を開いているスタ練 (v1.24)。行をタップして開く */
  const [attending, setAttending] = useState<StudioPractice | null>(null);

  const valid =
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(endTime) &&
    // 終了が開始以前なら翌日まで (§6.3 / v1.21)。同じ時刻だけ通さない
    startTime !== endTime &&
    place.trim().length > 0;

  function reset() {
    setDate("");
    setStartTime("");
    setEndTime("");
    setPlace("");
    setNote("");
    setOpen(false);
  }

  async function create() {
    setPending(true);
    setError(null);
    const supabase = createClient();
    // RLS が genre_id = 自分の1ジャン と created_by = auth.uid() を要求する。
    // ここで genreId を渡しても、他ジャンルには書けない
    const { error: insertError } = await supabase.from("genre_practices").insert({
      genre_id: genreId,
      date,
      start_time: startTime,
      end_time: endTime,
      place: place.trim(),
      note: note.trim() || null,
      created_by: currentUserId,
    });
    setPending(false);
    if (insertError) {
      setError(`登録できませんでした: ${insertError.message}`);
      return;
    }
    reset();
    router.refresh();
  }

  async function remove(practice: StudioPractice) {
    if (
      !window.confirm(
        `${formatDateLabel(practice.date)} ${formatSpanRange(
          practice.startTime,
          practice.endTime,
        )} のスタ練を削除しますか?\n${genreCode}の全員のカレンダーから消えます。`,
      )
    ) {
      return;
    }
    setPending(true);
    setError(null);
    const supabase = createClient();
    const { error: deleteError } = await supabase
      .from("genre_practices")
      .delete()
      .eq("id", practice.id);
    setPending(false);
    if (deleteError) {
      setError(`削除できませんでした: ${deleteError.message}`);
      return;
    }
    router.refresh();
  }

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-bold">{genreCode}スタ練を設定する</h2>
      <p className="text-xs text-[var(--muted)]">
        登録すると、{genreCode}を取っている人全員のカレンダーに出ます。
        メンバーを選ぶ必要はありません
      </p>

      <ErrorMessage>{error}</ErrorMessage>

      {practices.length > 0 ? (
        <ul className="divide-y divide-[var(--border)] rounded-xl border border-[var(--border)]">
          {practices.map((practice) => (
            <li key={practice.id} className="flex items-center gap-2 px-3 py-2">
              {/*
                行を押すと出欠管理窓が開く (v1.24)。公式練・ナンバー練と同じ窓。
                **登録した本人でなくても押せる** — 出欠は参加する側が答えるもので、
                日程を立てた人かどうかとは別の話 (§6.4.2)
              */}
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setAttending(practice);
                }}
                className="min-w-0 flex-1 text-left"
              >
                <p className="text-sm">
                  <span className="font-medium">
                    {formatDateLabel(practice.date)}
                  </span>{" "}
                  <span className="tabular-nums text-[var(--muted)]">
                    {formatSpanRange(practice.startTime, practice.endTime)}
                  </span>
                </p>
                <p className="truncate text-xs text-[var(--muted)]">
                  @{practice.place}
                  {practice.note ? ` / ${practice.note}` : ""}
                  <span className="ml-1">({practice.createdByName})</span>
                </p>
              </button>
              {/* 消せるのは登録した本人だけ。RLS も同じ条件 */}
              {practice.createdBy === currentUserId ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => remove(practice)}
                  className="shrink-0 rounded border border-[var(--border)] px-2 py-1 text-xs text-[var(--danger-fg)]"
                >
                  削除
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {open ? (
        <div className="space-y-2 rounded-xl border border-[var(--border)] p-3">
          <label className="block">
            <span className="text-sm font-medium">日付</span>
            <input
              value={date}
              placeholder="20260910"
              inputMode="numeric"
              disabled={pending}
              onChange={(e) => setDate(normalizeDateInput(e.target.value))}
              onBlur={(e) => setDate(normalizeDateInput(e.target.value))}
              className={inputClass}
            />
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
            数字だけでも入力できます (20260910 → 2026-09-10 / 1900 → 19:00)
          </p>
          {spansMidnight(startTime, endTime) &&
          /^\d{2}:\d{2}$/.test(startTime) &&
          /^\d{2}:\d{2}$/.test(endTime) ? (
            <p className="rounded-lg bg-[var(--surface)] px-3 py-2 text-xs">
              日をまたぐ予定として登録します (
              {formatSpanRange(startTime, endTime)})
            </p>
          ) : null}

          <label className="block">
            <span className="text-sm font-medium">場所</span>
            <input
              value={place}
              placeholder="例: スタジオ○○"
              disabled={pending}
              onChange={(e) => setPlace(e.target.value)}
              className={inputClass}
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium">メモ (任意)</span>
            <input
              value={note}
              placeholder="例: 振り入れ"
              disabled={pending}
              onChange={(e) => setNote(e.target.value)}
              className={inputClass}
            />
          </label>

          <button
            type="button"
            disabled={pending || !valid}
            onClick={create}
            className={buttonClass}
          >
            {pending ? "登録中…" : `${genreCode}のスタ練として登録する`}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={reset}
            className="w-full rounded-lg border border-[var(--border)] px-4 py-2 text-sm"
          >
            やめる
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full rounded-lg border border-[var(--border)] px-4 py-3 text-sm font-medium"
        >
          スタ練の日程を追加する
        </button>
      )}

      {attending ? (
        <AttendanceSheet
          target={{
            kind: "studioPractice",
            id: attending.id,
            genreId,
          }}
          title={`${genreCode}スタ練`}
          date={attending.date}
          startTime={attending.startTime}
          endTime={attending.endTime}
          location={attending.place}
          currentUserId={currentUserId}
          onClose={() => setAttending(null)}
        />
      ) : null}

      {practices.length === 0 && !open ? (
        <p className="text-xs text-[var(--muted)]">
          予定されているスタ練はありません
        </p>
      ) : null}
    </section>
  );
}
