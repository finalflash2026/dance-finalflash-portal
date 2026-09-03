"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { ErrorMessage, buttonClass, secondaryButtonClass } from "@/components/ui";
import { useRoomById, useRoomSections } from "@/lib/rooms";
import { COORDINATOR_PROMPT, CSV_HEADER_LINE } from "@/lib/import";
import {
  finalizeTimeInput,
  normalizeDateInput,
  normalizeTimeInput,
} from "@/lib/time";

import { ImportTimeline } from "./ImportTimeline";
import { effectiveRoomRaw, findConflicts, rowError, type Row } from "./rows";

/**
 * Step1: CSV取込 (SPEC.md §6.2 Step1 / §9)
 *
 * 折衝係が自前のAIに作らせたCSVを受け取り、**目視で直してから**確定させる。
 * AI の出力は必ず間違うという前提の画面なので、
 *   - 不正行は捨てずに「要修正」カードとして残す (直せるようにする)
 *   - 未知の部屋は同じく要修正に出してプルダウンを強制する
 *   - 正しく読めた行は月まとめタイムラインに並べ、抜け・重複・時刻ミスを目視させる
 *   - 要修正が1行でも残っていれば確定させない
 * の4点を守る。
 */

interface ParseResponse {
  files: { id: string | null; filename: string; error: string | null }[];
  rows: {
    importFileId: string | null;
    date: string;
    start: string;
    end: string;
    room_raw: string;
    room_id: number | null;
    error: string | null;
  }[];
  skipped: number;
}

export function ImportStep() {
  const roomById = useRoomById();
  const nextKey = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);

  const [rows, setRows] = useState<Row[]>([]);
  const [fileNotes, setFileNotes] = useState<ParseResponse["files"]>([]);
  const [skipped, setSkipped] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [editingKey, setEditingKey] = useState<number | null>(null);

  const invalidRows = rows.filter((row) => rowError(row, roomById) !== null);
  const validRows = rows.filter((row) => rowError(row, roomById) === null);
  const conflicts = findConflicts(validRows);
  // 完全一致は確定時に自動スキップされるので、要注意の「重なり」とは分けて数える
  const conflictValues = [...conflicts.values()];
  const overlapCount = conflictValues.filter((v) => v === "overlap").length;
  const duplicateCount = conflictValues.filter((v) => v === "duplicate").length;
  // 「N行目」の表示は解析順のまま数える (CSVと突き合わせられるように)
  const numberOf = new Map(rows.map((row, index) => [row.key, index + 1]));

  async function parse(files: FileList) {
    setPending(true);
    setError(null);
    setResult(null);
    try {
      const form = new FormData();
      for (const file of files) form.append("files", file);

      const res = await fetch("/api/import/parse", {
        method: "POST",
        body: form,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "解析に失敗しました");
        return;
      }

      const parsed = body as ParseResponse;
      setFileNotes(parsed.files);
      setSkipped(parsed.skipped);
      // 解析のたびに置き換える (前回の残りと混ざると何を確定するのか分からなくなる)
      setRows(
        parsed.rows.map((row) => ({
          key: nextKey.current++,
          importFileId: row.importFileId,
          date: row.date,
          start: row.start,
          end: row.end,
          roomRaw: row.room_raw,
          roomId: row.room_id,
        })),
      );
    } finally {
      setPending(false);
      // 同じファイルを選び直しても change が発火するようにクリアする
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function confirm() {
    setPending(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/reservations/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: rows.map((row) => ({
            importFileId: row.importFileId,
            date: row.date.trim(),
            start: row.start.trim(),
            end: row.end.trim(),
            roomRaw: effectiveRoomRaw(row, roomById),
            roomId: row.roomId,
          })),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "登録に失敗しました");
        return;
      }

      const learned = body.learnedAliases
        ? ` / 部屋の対応付けを${body.learnedAliases}件おぼえました`
        : "";
      setResult(
        `登録 ${body.inserted}件 / 重複スキップ ${body.skipped}件${learned}`,
      );
      setRows([]);
      setFileNotes([]);
      setSkipped(0);
    } finally {
      setPending(false);
    }
  }

  function update(key: number, patch: Partial<Row>) {
    setRows((prev) =>
      prev.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
  }

  function remove(key: number) {
    setRows((prev) => prev.filter((row) => row.key !== key));
    setEditingKey((prev) => (prev === key ? null : prev));
  }

  function addRow() {
    const key = nextKey.current++;
    setRows((prev) => [
      ...prev,
      {
        key,
        // 手動追加の行はどのファイル由来でもないので紐付けない
        importFileId: null,
        date: "",
        start: "",
        end: "",
        roomRaw: "",
        roomId: null,
      },
    ]);
    // 空の行はタイムラインに置けず要修正カードとして下から生えるだけなので、
    // 追加した本人が見失わないよう編集パネルを開いておく
    setEditingKey(key);
  }

  const editing = rows.find((row) => row.key === editingKey) ?? null;

  return (
    <div className="space-y-6">
      <PromptCard />

      <section className="space-y-3">
        <h2 className="text-base font-bold">1. CSVをアップロード</h2>
        <p className="text-sm text-[var(--muted)]">
          1行目が「{CSV_HEADER_LINE}」のCSVを選んでください(複数可)。
          ファイル自体はサーバーに保存されません。
        </p>
        <input
          ref={fileInput}
          type="file"
          accept=".csv,text/csv"
          multiple
          disabled={pending}
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              parse(e.target.files);
            }
          }}
          className="block w-full text-sm file:mr-3 file:rounded-lg file:border file:border-[var(--border)] file:bg-[var(--surface)] file:px-3 file:py-2 file:text-sm"
        />

        {fileNotes.map((file) => (
          <p
            key={file.filename + (file.id ?? "")}
            className={`text-sm ${file.error ? "text-[var(--danger-fg)]" : "text-[var(--muted)]"}`}
          >
            {file.filename}: {file.error ?? "読み込みました"}
          </p>
        ))}
        {skipped > 0 ? (
          <p className="text-sm text-[var(--muted)]">
            中身の無い行を{skipped}行読み飛ばしました
          </p>
        ) : null}
      </section>

      <ErrorMessage>{error}</ErrorMessage>
      {result ? (
        <p className="rounded-lg bg-[var(--surface)] px-3 py-2 text-sm">
          {result}
        </p>
      ) : null}

      {rows.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-base font-bold">2. 内容を確認する</h2>
          <p className="text-sm text-[var(--muted)]">
            {rows.length}件
            {invalidRows.length > 0 ? ` / 要修正 ${invalidRows.length}件` : ""}
            {overlapCount > 0 ? ` / 時間の重なり ${overlapCount}件` : ""}
            {duplicateCount > 0 ? ` / 重複 ${duplicateCount}件` : ""}
          </p>

          {/* 時刻や部屋が確定しない行はタイムラインに置けないので先に直させる */}
          {invalidRows.length > 0 ? (
            <div className="space-y-2">
              <h3 className="text-sm font-bold text-[var(--danger-fg)]">
                要修正 ({invalidRows.length}件)
              </h3>
              <ul className="space-y-2">
                {invalidRows.map((row) => (
                  <li key={row.key}>
                    <RowCard
                      row={row}
                      no={numberOf.get(row.key) ?? 0}
                      error={rowError(row, roomById)}
                      disabled={pending}
                      onChange={(patch) => update(row.key, patch)}
                      onRemove={() => remove(row.key)}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <ImportTimeline
            rows={validRows}
            conflicts={conflicts}
            onSelect={setEditingKey}
          />
          {validRows.length > 0 ? (
            <p className="text-xs text-[var(--muted)]">
              ブロックをタップすると日付・時刻・部屋を編集できます。
              {overlapCount > 0
                ? " ⚠ の枠は同じ部屋で時間が重なっています。読み取りミスの可能性があるので確認してください。"
                : ""}
              {duplicateCount > 0
                ? " ⚠ の枠のうち完全に同じものは、確定時に自動でスキップされます。"
                : ""}
            </p>
          ) : null}

          <button
            type="button"
            disabled={pending}
            onClick={addRow}
            className={secondaryButtonClass}
          >
            行を追加する
          </button>

          <div className="space-y-2 border-t border-[var(--border)] pt-4">
            <p className="text-sm text-[var(--muted)]">
              確定すると予約枠として登録されます。同じ日・部屋・時間の予約枠が既にあれば自動でスキップされます。
            </p>
            <button
              type="button"
              disabled={pending || invalidRows.length > 0}
              onClick={confirm}
              className={buttonClass}
            >
              {invalidRows.length > 0
                ? `要修正の行が${invalidRows.length}件あります`
                : `${rows.length}件を確定する`}
            </button>
          </div>
        </section>
      ) : null}

      {editing ? (
        <EditModal
          row={editing}
          no={numberOf.get(editing.key) ?? 0}
          disabled={pending}
          onChange={(patch) => update(editing.key, patch)}
          onRemove={() => remove(editing.key)}
          onClose={() => setEditingKey(null)}
        />
      ) : null}
    </div>
  );
}

/** SPEC §9.3: 折衝係向けプロンプトを常時表示し、コピーできるようにする */
function PromptCard() {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(COORDINATOR_PROMPT);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // クリップボードが使えない環境では手動で選択してもらう
    }
  }

  return (
    <section className="space-y-3 rounded-xl border border-[var(--border)] p-3">
      <h2 className="text-base font-bold">0. スクショからCSVを作る</h2>
      <p className="text-sm text-[var(--muted)]">
        予約完了ページのスクリーンショットと下のプロンプトを、自分のAI
        (ChatGPT / Claude など) に渡してCSVを作らせてください。
        このサイトからAIを呼ぶことはありません。
      </p>
      <pre className="max-h-56 overflow-auto rounded-lg bg-[var(--surface)] p-3 text-xs whitespace-pre-wrap">
        {COORDINATOR_PROMPT}
      </pre>
      <button type="button" onClick={copy} className={secondaryButtonClass}>
        {copied ? "コピーしました" : "プロンプトをコピー"}
      </button>
      <p className="rounded-lg bg-[var(--danger-bg)] px-3 py-2 text-sm text-[var(--danger-fg)]">
        AIの出力は必ずこの画面で目視チェックしてから確定してください。
      </p>
    </section>
  );
}

/** タイムラインのブロックをタップしたときの編集パネル */
function EditModal({
  row,
  no,
  disabled,
  onChange,
  onRemove,
  onClose,
}: {
  row: Row;
  no: number;
  disabled: boolean;
  onChange: (patch: Partial<Row>) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const roomById = useRoomById();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      data-no-swipe
      className="backdrop-in fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
    >
      <button
        type="button"
        aria-label="閉じる"
        className="absolute inset-0 h-full w-full cursor-default"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        className="sheet-in safe-bottom relative z-10 w-full max-w-md rounded-t-2xl bg-[var(--background)] p-4 sm:rounded-2xl"
      >
        <RowCard
          row={row}
          no={no}
          error={rowError(row, roomById)}
          disabled={disabled}
          onChange={onChange}
          onRemove={() => {
            onRemove();
            onClose();
          }}
        />
        <button
          type="button"
          onClick={onClose}
          className={`${secondaryButtonClass} mt-3`}
        >
          閉じる
        </button>
      </div>
    </div>
  );
}

function RowCard({
  row,
  no,
  error,
  disabled,
  onChange,
  onRemove,
}: {
  row: Row;
  no: number;
  error: string | null;
  disabled: boolean;
  onChange: (patch: Partial<Row>) => void;
  onRemove: () => void;
}) {
  const sections = useRoomSections();
  const [addingRoom, setAddingRoom] = useState(false);
  // date / time の専用input は使わない。'2026-02-30' や '25:00' のような
  // 不正値を勝手に空にしてしまい、CSVが何と書いてあったのか分からなくなるため
  const cell =
    "w-full rounded-lg border px-2 py-1.5 text-sm bg-[var(--background)] outline-none";
  const border = error
    ? "border-[var(--danger-border)] focus:border-[var(--danger-fg)]"
    : "border-[var(--border)] focus:border-[var(--foreground)]";

  return (
    <div
      className={`space-y-2 rounded-xl border p-3 ${
        error ? "border-[var(--danger-fg)] bg-[var(--danger-bg)]" : "border-[var(--border)]"
      }`}
    >
      <div className="flex items-center justify-between text-xs text-[var(--muted)]">
        <span>{no}行目</span>
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          className="rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1"
        >
          削除
        </button>
      </div>

      <div className="flex gap-2">
        <input
          aria-label="日付"
          value={row.date}
          placeholder="2026-08-06"
          inputMode="numeric"
          disabled={disabled}
          onChange={(e) => onChange({ date: normalizeDateInput(e.target.value) })}
          onBlur={(e) => onChange({ date: normalizeDateInput(e.target.value) })}
          className={`${cell} ${border} flex-[2]`}
        />
        <input
          aria-label="開始時刻"
          value={row.start}
          placeholder="13:00"
          inputMode="numeric"
          disabled={disabled}
          onChange={(e) => onChange({ start: normalizeTimeInput(e.target.value) })}
          onBlur={(e) => onChange({ start: finalizeTimeInput(e.target.value) })}
          className={`${cell} ${border} flex-1`}
        />
        <input
          aria-label="終了時刻"
          value={row.end}
          placeholder="21:30"
          inputMode="numeric"
          disabled={disabled}
          onChange={(e) => onChange({ end: normalizeTimeInput(e.target.value) })}
          onBlur={(e) => onChange({ end: finalizeTimeInput(e.target.value) })}
          className={`${cell} ${border} flex-1`}
        />
      </div>

      {/* iOS の数字キーボードには : も - も無いので、数字だけでも通ることを明示する */}
      <p className="text-[11px] text-[var(--muted)]">
        数字だけでも入力できます (1700 → 17:00 / 20260806 → 2026-08-06)
      </p>

      <div className="flex gap-2">
        <input
          aria-label="CSVの部屋表記"
          value={row.roomRaw}
          placeholder="CSVの部屋表記"
          disabled={disabled}
          onChange={(e) => onChange({ roomRaw: e.target.value })}
          className={`${cell} ${border} flex-1`}
        />
        <select
          aria-label="部屋"
          value={row.roomId ?? ""}
          disabled={disabled}
          onChange={(e) => {
            if (e.target.value === NEW_ROOM) {
              setAddingRoom(true);
              return;
            }
            onChange({ roomId: e.target.value ? Number(e.target.value) : null });
          }}
          className={`${cell} flex-1 ${
            row.roomId === null
              ? "border-[var(--danger-fg)] font-bold text-[var(--danger-fg)]"
              : border
          }`}
        >
          <option value="">部屋を選ぶ</option>
          {sections.map((group) => (
            <optgroup key={group.section} label={group.section}>
              {group.rooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.name}
                </option>
              ))}
            </optgroup>
          ))}
          {/*
            一覧に無い場所はここから足せる (v1.20)。**取込を中断させない**のが
            狙いで、以前は使える場所が増えるたびにコードを直す必要があった
          */}
          <option value={NEW_ROOM}>＋ 新しい練習場所を登録…</option>
        </select>
      </div>

      {addingRoom ? (
        <NewRoomForm
          defaultName={row.roomRaw.trim()}
          sections={sections.map((g) => g.section)}
          onCancel={() => setAddingRoom(false)}
          onCreated={(roomId) => {
            setAddingRoom(false);
            onChange({ roomId });
          }}
        />
      ) : null}

      {error ? (
        <p role="alert" className="text-xs font-medium text-[var(--danger-fg)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** select の中で「新しく足す」を表す値。部屋の id と混ざらない文字列にする */
const NEW_ROOM = "__new_room__";

/**
 * 練習場所の新規登録 (SPEC.md §4.2 / §6.2 Step1 / v1.20)
 *
 * CSVに知らない場所が出てきたときに、**取込を中断せずその場で足す**ための欄。
 * 以前は使える場所が増えるたびにコードを直してデプロイする必要があった。
 *
 * 名前はCSVの表記を初期値にする。だいたいそのまま使えるし、直すにしても
 * 打ち直しより楽なため。所在は既存のものを候補に出しつつ、
 * 新しい所在 (南大沢市民センターのような) も打てるようにする。
 *
 * 登録できたら `router.refresh()` でレイアウトを描き直す。部屋の一覧は
 * そこで読み込んでいるので、これをしないと足した場所が選択肢に出てこない
 * (取込中の行はクライアント state なので消えない)。
 */
function NewRoomForm({
  defaultName,
  sections,
  onCancel,
  onCreated,
}: {
  defaultName: string;
  sections: string[];
  onCancel: () => void;
  onCreated: (roomId: number) => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(defaultName);
  const [section, setSection] = useState(sections[0] ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          section,
          // CSVの表記を覚えさせる。次回から自動で解決される
          alias: defaultName || undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "登録に失敗しました");
        return;
      }
      onCreated(body.room.id as number);
      router.refresh();
    } catch {
      setError("通信に失敗しました");
    } finally {
      setPending(false);
    }
  }

  const cell =
    "w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm outline-none";

  return (
    <div className="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2">
      <p className="text-xs font-bold">新しい練習場所を登録</p>
      <input
        aria-label="練習場所の名前"
        value={name}
        placeholder="例: 柔道場(体育館)"
        disabled={pending}
        onChange={(e) => setName(e.target.value)}
        className={cell}
      />
      <input
        aria-label="所在"
        value={section}
        placeholder="例: 南大沢市民センター"
        list="room-sections"
        disabled={pending}
        onChange={(e) => setSection(e.target.value)}
        className={cell}
      />
      <datalist id="room-sections">
        {sections.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <p className="text-[11px] text-[var(--muted)]">
        所在はカレンダーの列の見出しになります。新しい所在も入力できます
      </p>
      {error ? (
        <p role="alert" className="text-xs text-[var(--danger-fg)]">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={pending || !name.trim() || !section.trim()}
          className="flex-1 rounded-lg border border-[var(--foreground)] px-3 py-1.5 text-xs font-bold disabled:opacity-50"
        >
          {pending ? "登録中…" : "登録して選ぶ"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs"
        >
          やめる
        </button>
      </div>
    </div>
  );
}
