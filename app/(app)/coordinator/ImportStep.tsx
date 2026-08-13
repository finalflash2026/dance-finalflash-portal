"use client";

import { useRef, useState } from "react";

import { ErrorMessage, buttonClass, secondaryButtonClass } from "@/components/ui";
import { ROOMS, ROOM_BY_ID, ROOM_SECTIONS } from "@/lib/constants";
import {
  COORDINATOR_PROMPT,
  CSV_HEADER_LINE,
  validateRow,
} from "@/lib/import";

/**
 * Step1: CSV取込 (SPEC.md §6.2 Step1 / §9)
 *
 * 折衝係が自前のAIに作らせたCSVを受け取り、**目視で直してから**確定させる。
 * AI の出力は必ず間違うという前提の画面なので、
 *   - 不正行は捨てずに赤くして残す (直せるようにする)
 *   - 未知の部屋は赤くしてプルダウンを強制する
 *   - エラーが1行でも残っていれば確定させない
 * の3点を守る。
 *
 * 行の検証は lib/import.ts の validateRow を使い、
 * /api/reservations/bulk のサーバー側検証と**同じルール**で赤表示する。
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

interface Row {
  /** React の key。行を消しても番号が振り直されないよう独立に持つ */
  key: number;
  importFileId: string | null;
  date: string;
  start: string;
  end: string;
  roomRaw: string;
  roomId: number | null;
}

/**
 * 部屋名の生表記。空なら選んだ部屋の正式名で補う。
 * 手動で追加した行には元の表記が無いが、その場合の正式名は
 * 既に room_aliases 相当として解決できるのでエイリアス学習は起きない。
 */
function effectiveRoomRaw(row: Row): string {
  const raw = row.roomRaw.trim();
  if (raw) return raw;
  return row.roomId !== null ? (ROOM_BY_ID.get(row.roomId)?.name ?? "") : "";
}

/** サーバーの再検証と同じ判定。ここで赤く出た行はそのまま bulk でも弾かれる */
function rowError(row: Row): string | null {
  const checked = validateRow({
    date: row.date,
    start: row.start,
    end: row.end,
    room: effectiveRoomRaw(row),
  });
  if (checked.error) return checked.error;
  if (row.roomId === null) return "部屋を選んでください";
  return null;
}

export function ImportStep() {
  const nextKey = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);

  const [rows, setRows] = useState<Row[]>([]);
  const [fileNotes, setFileNotes] = useState<ParseResponse["files"]>([]);
  const [skipped, setSkipped] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const errorCount = rows.filter((row) => rowError(row) !== null).length;
  const unresolvedCount = rows.filter((row) => row.roomId === null).length;

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
            roomRaw: effectiveRoomRaw(row),
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
            className={`text-sm ${file.error ? "text-[#8B1A10]" : "text-[var(--muted)]"}`}
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
            {rows.length}行
            {errorCount > 0 ? ` / 要修正 ${errorCount}行` : ""}
            {unresolvedCount > 0 ? ` / 未対応の部屋 ${unresolvedCount}行` : ""}
          </p>

          <ul className="space-y-2">
            {rows.map((row, index) => (
              <RowCard
                key={row.key}
                row={row}
                index={index}
                error={rowError(row)}
                disabled={pending}
                onChange={(patch) => update(row.key, patch)}
                onRemove={() =>
                  setRows((prev) => prev.filter((r) => r.key !== row.key))
                }
              />
            ))}
          </ul>

          <button
            type="button"
            disabled={pending}
            onClick={() =>
              setRows((prev) => [
                ...prev,
                {
                  key: nextKey.current++,
                  // 手動追加の行はどのファイル由来でもないので紐付けない
                  importFileId: null,
                  date: "",
                  start: "",
                  end: "",
                  roomRaw: "",
                  roomId: null,
                },
              ])
            }
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
              disabled={pending || errorCount > 0}
              onClick={confirm}
              className={buttonClass}
            >
              {errorCount > 0
                ? `要修正の行が${errorCount}件あります`
                : `${rows.length}件を確定する`}
            </button>
          </div>
        </section>
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
      <p className="rounded-lg bg-[#FDECEA] px-3 py-2 text-sm text-[#8B1A10]">
        AIの出力は必ずこの画面で目視チェックしてから確定してください。
      </p>
    </section>
  );
}

function RowCard({
  row,
  index,
  error,
  disabled,
  onChange,
  onRemove,
}: {
  row: Row;
  index: number;
  error: string | null;
  disabled: boolean;
  onChange: (patch: Partial<Row>) => void;
  onRemove: () => void;
}) {
  // date / time の専用input は使わない。'2026-02-30' や '25:00' のような
  // 不正値を勝手に空にしてしまい、CSVが何と書いてあったのか分からなくなるため
  const cell =
    "w-full rounded-lg border px-2 py-1.5 text-sm bg-[var(--background)] outline-none";
  const border = error
    ? "border-[#E5B4AE] focus:border-[#8B1A10]"
    : "border-[var(--border)] focus:border-[var(--foreground)]";

  return (
    <li
      className={`space-y-2 rounded-xl border p-3 ${
        error ? "border-[#8B1A10] bg-[#FDECEA]" : "border-[var(--border)]"
      }`}
    >
      <div className="flex items-center justify-between text-xs text-[var(--muted)]">
        <span>{index + 1}行目</span>
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
          onChange={(e) => onChange({ date: e.target.value })}
          className={`${cell} ${border} flex-[2]`}
        />
        <input
          aria-label="開始時刻"
          value={row.start}
          placeholder="13:00"
          inputMode="numeric"
          disabled={disabled}
          onChange={(e) => onChange({ start: e.target.value })}
          className={`${cell} ${border} flex-1`}
        />
        <input
          aria-label="終了時刻"
          value={row.end}
          placeholder="21:30"
          inputMode="numeric"
          disabled={disabled}
          onChange={(e) => onChange({ end: e.target.value })}
          className={`${cell} ${border} flex-1`}
        />
      </div>

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
          onChange={(e) =>
            onChange({ roomId: e.target.value ? Number(e.target.value) : null })
          }
          className={`${cell} flex-1 ${
            row.roomId === null
              ? "border-[#8B1A10] font-bold text-[#8B1A10]"
              : border
          }`}
        >
          <option value="">部屋を選ぶ</option>
          {ROOM_SECTIONS.map((section) => (
            <optgroup key={section} label={section}>
              {ROOMS.filter((r) => r.section === section).map((room) => (
                <option key={room.id} value={room.id}>
                  {room.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      {error ? (
        <p role="alert" className="text-xs font-medium text-[#8B1A10]">
          {error}
        </p>
      ) : null}
    </li>
  );
}
