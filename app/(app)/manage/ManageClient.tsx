"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Sheet } from "@/components/Sheet";
import {
  ErrorMessage,
  GroupFooter,
  ImportantBadge,
  GroupHeader,
  Segmented,
  Switch,
  cellInputClass,
  destructiveButtonClass,
  groupClass,
  primaryButtonClass,
  tintTextClass,
} from "@/components/ui";
import { confirmAction } from "@/lib/confirm";
import { dbErrorMessage } from "@/lib/error-message";
import { createClient } from "@/lib/supabase/client";
import {
  formatAsTokyoDateTime,
  formatDateLabel,
  normalizeTime,
} from "@/lib/time";
import type { Announcement, CircleEvent, Deadline } from "@/lib/types";

/**
 * イベント・締切・告知の管理 (SPEC.md §6.7.11 / v1.30)
 *
 * イベントと締切は**RLS 経由でブラウザから直接書く**(通知を伴わないため。§8.13)。
 * 告知だけは全員に通知が飛ぶので `/api/announcements` を通す。
 *
 * 書いたあとは `router.refresh()` で一覧を取り直す。数十件しか無いので
 * 手元で差し替えるより、サーバーの並び (日付順) に任せるほうが間違いが無い。
 */

type Tab = "events" | "deadlines" | "announcements";

export function ManageClient({
  currentUserId,
  isAdmin,
  today,
  events,
  deadlines,
  announcements,
  loadError,
}: {
  currentUserId: string;
  isAdmin: boolean;
  today: string;
  events: CircleEvent[];
  deadlines: Deadline[];
  announcements: Announcement[];
  loadError: string | null;
}) {
  const [tab, setTab] = useState<Tab>("events");

  const tabs: { value: Tab; label: string }[] = [
    { value: "events", label: "イベント" },
    { value: "deadlines", label: "締切" },
    ...(isAdmin ? [{ value: "announcements" as const, label: "告知" }] : []),
  ];

  return (
    <main className="mx-auto max-w-2xl space-y-5 px-4 py-4">
      <h1 className="text-[28px] font-bold leading-tight">イベントと締切</h1>
      <div data-tour="manage-tabs">
        <Segmented label="表示する一覧" value={tab} options={tabs} onChange={setTab} />
      </div>
      <ErrorMessage>
        {loadError ? `一覧を取得できませんでした: ${loadError}` : null}
      </ErrorMessage>

      {tab === "events" ? (
        <EventsPanel events={events} today={today} currentUserId={currentUserId} />
      ) : null}
      {tab === "deadlines" ? (
        <DeadlinesPanel
          deadlines={deadlines}
          today={today}
          currentUserId={currentUserId}
        />
      ) : null}
      {tab === "announcements" && isAdmin ? (
        <AnnouncementsPanel announcements={announcements} />
      ) : null}
    </main>
  );
}

// ---------- イベント ----------

interface EventDraft {
  id: string | null;
  title: string;
  date: string;
  endDate: string;
  allDay: boolean;
  startTime: string;
  endTime: string;
  place: string;
  note: string;
  showToOb: boolean;
}

function EventsPanel({
  events,
  today,
  currentUserId,
}: {
  events: CircleEvent[];
  today: string;
  currentUserId: string;
}) {
  const [draft, setDraft] = useState<EventDraft | null>(null);

  function create() {
    setDraft({
      id: null,
      title: "",
      date: today,
      endDate: today,
      allDay: true,
      startTime: "13:00",
      endTime: "17:00",
      place: "",
      note: "",
      showToOb: false,
    });
  }

  function edit(event: CircleEvent) {
    setDraft({
      id: event.id,
      title: event.title,
      date: event.date,
      endDate: event.end_date,
      allDay: event.start_time === null,
      startTime: event.start_time ? normalizeTime(event.start_time) : "13:00",
      endTime: event.end_time ? normalizeTime(event.end_time) : "17:00",
      place: event.place,
      note: event.note ?? "",
      showToOb: event.show_to_ob,
    });
  }

  return (
    <section data-tour="manage-list">
      <div className="flex items-end justify-between px-4 pb-1.5">
        <GroupHeader>これからのイベント</GroupHeader>
        <button type="button" onClick={create} className={tintTextClass}>
          追加
        </button>
      </div>
      {events.length === 0 ? (
        <p className={`${groupClass} px-4 py-3 text-[15px] text-[var(--muted)]`}>
          まだありません
        </p>
      ) : (
        <ul className={groupClass}>
          {events.map((event) => (
            <li key={event.id}>
              <button
                type="button"
                onClick={() => edit(event)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[17px]">{event.title}</span>
                  <span className="block truncate text-[13px] text-[var(--muted)]">
                    {eventWhen(event)}
                    {event.place ? ` · ${event.place}` : ""}
                    {event.show_to_ob ? " · OB/OGにも表示" : ""}
                  </span>
                </span>
                <Chevron />
              </button>
            </li>
          ))}
        </ul>
      )}
      <GroupFooter>
        カレンダーと購読カレンダーに、現役全員の予定として出ます。
      </GroupFooter>

      {draft ? (
        <EventSheet
          draft={draft}
          currentUserId={currentUserId}
          onChange={setDraft}
          onClose={() => setDraft(null)}
        />
      ) : null}
    </section>
  );
}

function eventWhen(event: CircleEvent): string {
  const days =
    event.end_date > event.date
      ? `${formatDateLabel(event.date)}〜${formatDateLabel(event.end_date)}`
      : formatDateLabel(event.date);
  if (!event.start_time || !event.end_time) return `${days} 終日`;
  return `${days} ${normalizeTime(event.start_time)}〜${normalizeTime(event.end_time)}`;
}

function EventSheet({
  draft,
  currentUserId,
  onChange,
  onClose,
}: {
  draft: EventDraft;
  currentUserId: string;
  onChange: (draft: EventDraft) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof EventDraft>(key: K, value: EventDraft[K]) =>
    onChange({ ...draft, [key]: value });

  function validate(): string | null {
    if (!draft.title.trim()) return "タイトルを入れてください";
    if (draft.endDate < draft.date) return "終了日が開始日より前になっています";
    if (
      !draft.allDay &&
      draft.endDate === draft.date &&
      draft.endTime <= draft.startTime
    ) {
      return "終了時刻が開始時刻より前になっています";
    }
    return null;
  }

  async function save() {
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setPending(true);
    setError(null);
    const row = {
      title: draft.title.trim(),
      date: draft.date,
      end_date: draft.endDate,
      start_time: draft.allDay ? null : draft.startTime,
      end_time: draft.allDay ? null : draft.endTime,
      place: draft.place.trim(),
      note: draft.note.trim() || null,
      show_to_ob: draft.showToOb,
    };
    const supabase = createClient();
    const { error: saveError } = draft.id
      ? await supabase
          .from("circle_events")
          .update({ ...row, updated_at: new Date().toISOString() })
          .eq("id", draft.id)
      : await supabase
          .from("circle_events")
          .insert({ ...row, created_by: currentUserId });
    setPending(false);
    if (saveError) {
      setError(dbErrorMessage("保存できませんでした", saveError));
      return;
    }
    onClose();
    router.refresh();
  }

  async function remove() {
    if (!draft.id) return;
    if (!await confirmAction(`「${draft.title}」を削除しますか?\n全員のカレンダーから消えます。`)) {
      return;
    }
    setPending(true);
    const { error: deleteError } = await createClient()
      .from("circle_events")
      .delete()
      .eq("id", draft.id);
    setPending(false);
    if (deleteError) {
      setError(dbErrorMessage("削除できませんでした", deleteError));
      return;
    }
    onClose();
    router.refresh();
  }

  return (
    <Sheet
      title={draft.id ? "イベントを編集" : "イベントを追加"}
      onClose={onClose}
      footer={
        <div className="space-y-2">
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className={primaryButtonClass}
          >
            {draft.id ? "保存" : "追加"}
          </button>
          {draft.id ? (
            <button
              type="button"
              onClick={remove}
              disabled={pending}
              className={destructiveButtonClass}
            >
              削除
            </button>
          ) : null}
        </div>
      }
    >
      <div className="space-y-5">
        <ErrorMessage>{error}</ErrorMessage>
        <div className={groupClass}>
          <input
            aria-label="タイトル"
            placeholder="タイトル (例: 夏合宿)"
            value={draft.title}
            maxLength={60}
            onChange={(e) => set("title", e.target.value)}
            className={cellInputClass}
          />
          <input
            aria-label="場所"
            placeholder="場所 (任意)"
            value={draft.place}
            onChange={(e) => set("place", e.target.value)}
            className={cellInputClass}
          />
        </div>

        <div className={groupClass}>
          <Row label="終日">
            <Switch
              label="終日"
              checked={draft.allDay}
              onChange={(value) => set("allDay", value)}
            />
          </Row>
          <Row label="開始">
            <DateTimeInputs
              date={draft.date}
              time={draft.startTime}
              showTime={!draft.allDay}
              onDate={(value) =>
                onChange({
                  ...draft,
                  date: value,
                  // 開始日を後ろへずらしたら終了日も付いてくる (1日のイベントが大半のため)
                  endDate: draft.endDate < value ? value : draft.endDate,
                })
              }
              onTime={(value) => set("startTime", value)}
              label="開始"
            />
          </Row>
          <Row label="終了">
            <DateTimeInputs
              date={draft.endDate}
              time={draft.endTime}
              showTime={!draft.allDay}
              onDate={(value) => set("endDate", value)}
              onTime={(value) => set("endTime", value)}
              label="終了"
            />
          </Row>
        </div>

        <div>
          <div className={groupClass}>
            <Row label="OB/OGにも表示">
              <Switch
                label="OB/OGにも表示"
                checked={draft.showToOb}
                onChange={(value) => set("showToOb", value)}
              />
            </Row>
          </div>
        </div>

        <div className={groupClass}>
          <textarea
            aria-label="メモ"
            placeholder="メモ (任意)"
            rows={3}
            value={draft.note}
            onChange={(e) => set("note", e.target.value)}
            className={`${cellInputClass} resize-none`}
          />
        </div>
      </div>
    </Sheet>
  );
}

// ---------- 締切 ----------

interface DeadlineDraft {
  id: string | null;
  title: string;
  dueDate: string;
  hasTime: boolean;
  dueTime: string;
  url: string;
  note: string;
  important: boolean;
}

function DeadlinesPanel({
  deadlines,
  today,
  currentUserId,
}: {
  deadlines: Deadline[];
  today: string;
  currentUserId: string;
}) {
  const [draft, setDraft] = useState<DeadlineDraft | null>(null);

  return (
    <section>
      <div className="flex items-end justify-between px-4 pb-1.5">
        <GroupHeader>締切</GroupHeader>
        <button
          type="button"
          onClick={() =>
            setDraft({
              id: null,
              title: "",
              dueDate: today,
              hasTime: false,
              dueTime: "23:59",
              url: "",
              note: "",
              important: false,
            })
          }
          className={tintTextClass}
        >
          追加
        </button>
      </div>
      {deadlines.length === 0 ? (
        <p className={`${groupClass} px-4 py-3 text-[15px] text-[var(--muted)]`}>
          まだありません
        </p>
      ) : (
        <ul className={groupClass}>
          {deadlines.map((deadline) => (
            <li key={deadline.id}>
              <button
                type="button"
                onClick={() =>
                  setDraft({
                    id: deadline.id,
                    title: deadline.title,
                    dueDate: deadline.due_date,
                    hasTime: deadline.due_time !== null,
                    dueTime: deadline.due_time
                      ? normalizeTime(deadline.due_time)
                      : "23:59",
                    url: deadline.url ?? "",
                    note: deadline.note ?? "",
                    important: deadline.important,
                  })
                }
                className="flex w-full items-center gap-3 px-4 py-3 text-left"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-[17px]">
                    {deadline.important ? <ImportantBadge /> : null}
                    <span className="truncate">{deadline.title}</span>
                  </span>
                  <span className="block truncate text-[13px] text-[var(--muted)]">
                    {formatDateLabel(deadline.due_date)}
                    {deadline.due_time
                      ? ` ${normalizeTime(deadline.due_time)}まで`
                      : " 中"}
                    {deadline.due_date < today ? " · 終了" : ""}
                  </span>
                </span>
                <Chevron />
              </button>
            </li>
          ))}
        </ul>
      )}
      <GroupFooter>現役全員のカレンダーに出て、締切の日の朝に通知が届きます。</GroupFooter>

      {draft ? (
        <DeadlineSheet
          draft={draft}
          currentUserId={currentUserId}
          onChange={setDraft}
          onClose={() => setDraft(null)}
        />
      ) : null}
    </section>
  );
}

function DeadlineSheet({
  draft,
  currentUserId,
  onChange,
  onClose,
}: {
  draft: DeadlineDraft;
  currentUserId: string;
  onChange: (draft: DeadlineDraft) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof DeadlineDraft>(key: K, value: DeadlineDraft[K]) =>
    onChange({ ...draft, [key]: value });

  async function save() {
    if (!draft.title.trim()) {
      setError("タイトルを入れてください");
      return;
    }
    const url = draft.url.trim();
    if (url && !/^https?:\/\//i.test(url)) {
      setError("リンクは https:// から始まる形で入れてください");
      return;
    }
    setPending(true);
    setError(null);
    const row = {
      title: draft.title.trim(),
      due_date: draft.dueDate,
      due_time: draft.hasTime ? draft.dueTime : null,
      url: url || null,
      note: draft.note.trim() || null,
      important: draft.important,
    };
    const supabase = createClient();
    const { error: saveError } = draft.id
      ? await supabase
          .from("deadlines")
          .update({ ...row, updated_at: new Date().toISOString() })
          .eq("id", draft.id)
      : await supabase.from("deadlines").insert({ ...row, created_by: currentUserId });
    setPending(false);
    if (saveError) {
      setError(dbErrorMessage("保存できませんでした", saveError));
      return;
    }
    onClose();
    router.refresh();
  }

  async function remove() {
    if (!draft.id) return;
    if (!await confirmAction(`「${draft.title}」を削除しますか?`)) return;
    setPending(true);
    const { error: deleteError } = await createClient()
      .from("deadlines")
      .delete()
      .eq("id", draft.id);
    setPending(false);
    if (deleteError) {
      setError(dbErrorMessage("削除できませんでした", deleteError));
      return;
    }
    onClose();
    router.refresh();
  }

  return (
    <Sheet
      title={draft.id ? "締切を編集" : "締切を追加"}
      onClose={onClose}
      footer={
        <div className="space-y-2">
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className={primaryButtonClass}
          >
            {draft.id ? "保存" : "追加"}
          </button>
          {draft.id ? (
            <button
              type="button"
              onClick={remove}
              disabled={pending}
              className={destructiveButtonClass}
            >
              削除
            </button>
          ) : null}
        </div>
      }
    >
      <div className="space-y-5">
        <ErrorMessage>{error}</ErrorMessage>
        <div className={groupClass}>
          <input
            aria-label="タイトル"
            placeholder="タイトル (例: 合宿費の集金)"
            value={draft.title}
            maxLength={60}
            onChange={(e) => set("title", e.target.value)}
            className={cellInputClass}
          />
          <input
            aria-label="リンク"
            placeholder="リンク (Google フォームなど・任意)"
            inputMode="url"
            value={draft.url}
            onChange={(e) => set("url", e.target.value)}
            className={cellInputClass}
          />
        </div>

        <div className={groupClass}>
          <Row label="期限">
            <DateTimeInputs
              date={draft.dueDate}
              time={draft.dueTime}
              showTime={draft.hasTime}
              onDate={(value) => set("dueDate", value)}
              onTime={(value) => set("dueTime", value)}
              label="期限"
            />
          </Row>
          <Row label="時刻を指定">
            <Switch
              label="時刻を指定"
              checked={draft.hasTime}
              onChange={(value) => set("hasTime", value)}
            />
          </Row>
        </div>

        <div>
          <div className={groupClass}>
            <Row label="大事な締切">
              <Switch
                label="大事な締切"
                checked={draft.important}
                onChange={(value) => set("important", value)}
              />
            </Row>
          </div>
          <GroupFooter>1週間前の朝にも通知が届きます。</GroupFooter>
        </div>

        <div className={groupClass}>
          <textarea
            aria-label="メモ"
            placeholder="メモ (任意)"
            rows={3}
            value={draft.note}
            onChange={(e) => set("note", e.target.value)}
            className={`${cellInputClass} resize-none`}
          />
        </div>
      </div>
    </Sheet>
  );
}

// ---------- 告知 ----------

function AnnouncementsPanel({ announcements }: { announcements: Announcement[] }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [includeOb, setIncludeOb] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** 取り消し中の告知。連打で削除が何度も飛ばないように押せなくする (v1.32.6) */
  const [removingId, setRemovingId] = useState<string | null>(null);

  async function send() {
    if (!title.trim() || !body.trim()) {
      setError("タイトルと本文を入れてください");
      return;
    }
    const who = includeOb ? "現役と OB/OG の全員" : "現役全員";
    if (!await confirmAction(`${who}に告知を送り、通知も届けます。よろしいですか?`)) {
      return;
    }
    setPending(true);
    setError(null);
    setNotice(null);
    const res = await fetch("/api/announcements", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: title.trim(), body: body.trim(), includeOb }),
    });
    const data = (await res.json().catch(() => null)) as {
      error?: string;
      recipients?: number;
    } | null;
    setPending(false);
    if (!res.ok) {
      setError(data?.error ?? "送れませんでした");
      return;
    }
    setTitle("");
    setBody("");
    setIncludeOb(false);
    setNotice(`${data?.recipients ?? 0}人に送りました`);
    router.refresh();
  }

  async function remove(announcement: Announcement) {
    if (
      !await confirmAction(
        `「${announcement.title}」を取り消しますか?\nまだ読んでいない人のお知らせからも消えます (届いた通知は消せません)。`,
      )
    ) {
      return;
    }
    setRemovingId(announcement.id);
    const { error: deleteError } = await createClient()
      .from("announcements")
      .delete()
      .eq("id", announcement.id);
    setRemovingId(null);
    if (deleteError) {
      setError(dbErrorMessage("取り消せませんでした", deleteError));
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <section>
        <GroupHeader>新しい告知</GroupHeader>
        <div className={groupClass}>
          <input
            aria-label="タイトル"
            placeholder="タイトル"
            value={title}
            maxLength={60}
            onChange={(e) => setTitle(e.target.value)}
            className={cellInputClass}
          />
          <textarea
            aria-label="本文"
            placeholder="本文"
            rows={5}
            maxLength={1000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className={`${cellInputClass} resize-none`}
          />
          <Row label="OB/OGにも送る">
            <Switch label="OB/OGにも送る" checked={includeOb} onChange={setIncludeOb} />
          </Row>
        </div>
        <GroupFooter>全員に通知が届きます。</GroupFooter>
        <div className="mt-3 space-y-2">
          <ErrorMessage>{error}</ErrorMessage>
          {notice ? (
            <p className="px-4 text-[15px] text-[var(--success-fg)]">{notice}</p>
          ) : null}
          <button
            type="button"
            onClick={send}
            disabled={pending}
            className={primaryButtonClass}
          >
            送る
          </button>
        </div>
      </section>

      <section>
        <GroupHeader>送った告知</GroupHeader>
        {announcements.length === 0 ? (
          <p className={`${groupClass} px-4 py-3 text-[15px] text-[var(--muted)]`}>
            まだありません
          </p>
        ) : (
          <ul className={groupClass}>
            {announcements.map((announcement) => (
              <li key={announcement.id} className="flex items-start gap-3 px-4 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block text-[17px]">{announcement.title}</span>
                  <span className="line-clamp-2 block whitespace-pre-wrap text-[13px] text-[var(--muted)]">
                    {announcement.body}
                  </span>
                  <span className="block text-[12px] text-[var(--muted)]">
                    {formatAsTokyoDateTime(announcement.created_at)}
                    {announcement.include_ob ? " · OB/OGにも送信" : ""}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => remove(announcement)}
                  disabled={removingId !== null}
                  className="shrink-0 text-[15px] text-[var(--danger-solid)] disabled:opacity-40"
                >
                  {removingId === announcement.id ? "取り消し中…" : "取り消す"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ---------- 小物 ----------

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-[44px] items-center justify-between gap-3 px-4 py-1.5">
      <span className="text-[17px]">{label}</span>
      {children}
    </div>
  );
}

function DateTimeInputs({
  date,
  time,
  showTime,
  onDate,
  onTime,
  label,
}: {
  date: string;
  time: string;
  showTime: boolean;
  onDate: (value: string) => void;
  onTime: (value: string) => void;
  label: string;
}) {
  const pill =
    "rounded-[8px] bg-[var(--fill)] px-2.5 py-1.5 text-[16px] tabular-nums outline-none";
  return (
    <span className="flex items-center gap-1.5">
      <input
        type="date"
        aria-label={`${label}日`}
        value={date}
        required
        onChange={(e) => e.target.value && onDate(e.target.value)}
        className={pill}
      />
      {showTime ? (
        <input
          type="time"
          aria-label={`${label}時刻`}
          value={time}
          onChange={(e) => e.target.value && onTime(e.target.value)}
          className={pill}
        />
      ) : null}
    </span>
  );
}

function Chevron() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 8 14"
      width="8"
      height="14"
      className="shrink-0 text-[var(--muted)] opacity-60"
    >
      <path
        d="M1 1l6 6-6 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
