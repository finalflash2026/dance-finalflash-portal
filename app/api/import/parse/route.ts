import { requireRole } from "@/lib/auth/guard";
import { type ParsedFile, parseCsv } from "@/lib/csv";
import {
  CSV_HEADER_LINE,
  MAX_FILES_PER_REQUEST,
  MAX_FILE_BYTES,
  MAX_ROWS_PER_REQUEST,
  buildRoomResolver,
  resolveRoom,
} from "@/lib/import";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/import/parse  (SPEC.md §8.4 / §6.2 Step1 / §9)
 *
 * multipart で受け取った CSV を解析し、部屋名をエイリアス解決して返す。
 * **ファイル自体は保存しない**。監査用に `import_files` の pending 行だけ作る。
 *
 * service role は使わない。`all_imports` / `sel_alias` が coordinator 以上を
 * 許可しているためセッションクライアントで足り、RLS を最終防衛線として
 * 残しておけるほうが安全 (SPEC §13.2)。
 *
 * res: {
 *   files: [{ id, filename, error }],
 *   rows:  [{ importFileId, date, start, end, room_raw, room_id, error }],
 *   skipped: number
 * }
 */
export const runtime = "nodejs";

export async function POST(request: Request) {
  const guard = await requireRole("coordinator");
  if (guard instanceof Response) return guard;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json(
      { error: "ファイルを受け取れませんでした (multipart/form-data で送ってください)" },
      { status: 400 },
    );
  }

  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return Response.json(
      { error: "CSVファイルを選択してください" },
      { status: 400 },
    );
  }
  if (files.length > MAX_FILES_PER_REQUEST) {
    return Response.json(
      { error: `一度に選べるファイルは${MAX_FILES_PER_REQUEST}件までです` },
      { status: 400 },
    );
  }

  // ---- 解析 (DB に触る前に済ませる。落ちる入力で import_files を作らない) ----
  const parsedFiles: ParsedFile[] = [];
  for (const file of files) {
    const filename = file.name || "(名前なし)";

    if (file.size > MAX_FILE_BYTES) {
      parsedFiles.push({
        filename,
        rows: [],
        skipped: 0,
        error: `ファイルが大きすぎます (上限 ${MAX_FILE_BYTES / 1024 / 1024}MB)`,
      });
      continue;
    }
    // Safari などは .csv に application/vnd.ms-excel を付けることがあるので
    // MIME だけでは判定せず、拡張子も見る
    if (!/\.csv$/i.test(filename) && !file.type.startsWith("text/")) {
      parsedFiles.push({
        filename,
        rows: [],
        skipped: 0,
        error: `CSVファイル (.csv) を選んでください。1行目は「${CSV_HEADER_LINE}」です`,
      });
      continue;
    }

    parsedFiles.push(parseCsv(filename, await file.text()));
  }

  const totalRows = parsedFiles.reduce((sum, f) => sum + f.rows.length, 0);
  if (totalRows > MAX_ROWS_PER_REQUEST) {
    return Response.json(
      {
        error: `行数が多すぎます (${totalRows}行 / 上限 ${MAX_ROWS_PER_REQUEST}行)。ファイルを分けてください`,
      },
      { status: 400 },
    );
  }

  // ---- 部屋名の解決 (SPEC §4.3) ----
  const supabase = await createClient();
  const [roomsResult, aliasesResult] = await Promise.all([
    supabase.from("rooms").select("id, name"),
    supabase.from("room_aliases").select("alias, room_id"),
  ]);

  if (roomsResult.error || aliasesResult.error) {
    const message = roomsResult.error?.message ?? aliasesResult.error?.message;
    return Response.json(
      { error: `部屋マスタを取得できませんでした: ${message}` },
      { status: 503 },
    );
  }

  const resolver = buildRoomResolver(
    roomsResult.data ?? [],
    aliasesResult.data ?? [],
  );

  // ---- import_files の pending 行を作る (解析できたファイルのみ) ----
  //
  // id はここで採番して insert に明示的に渡す。DB 側の default に任せると
  // 返ってきた行とファイルの対応を「insert した順に返る」という
  // 保証のない前提で突き合わせることになるため。
  const idByIndex = new Map<number, string>();
  const newFiles = parsedFiles.flatMap((f, index) => {
    if (f.error !== null) return [];
    const id = crypto.randomUUID();
    idByIndex.set(index, id);
    return [{ id, filename: f.filename, uploaded_by: guard.user_id }];
  });

  if (newFiles.length > 0) {
    const { error } = await supabase.from("import_files").insert(newFiles);
    if (error) {
      return Response.json(
        { error: `取込履歴を作成できませんでした: ${error.message}` },
        { status: 500 },
      );
    }
  }

  const responseFiles = parsedFiles.map((f, i) => ({
    id: idByIndex.get(i) ?? null,
    filename: f.filename,
    error: f.error,
  }));

  const rows = parsedFiles.flatMap((f, i) =>
    f.rows.map((row) => ({
      importFileId: idByIndex.get(i) ?? null,
      date: row.date,
      start: row.start,
      end: row.end,
      room_raw: row.roomRaw,
      room_id: resolveRoom(resolver, row.roomRaw),
      error: row.error,
    })),
  );

  return Response.json({
    files: responseFiles,
    rows,
    skipped: parsedFiles.reduce((sum, f) => sum + f.skipped, 0),
  });
}
