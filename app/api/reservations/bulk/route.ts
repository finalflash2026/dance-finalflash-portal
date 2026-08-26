import { z } from "zod";

import { requireRole } from "@/lib/auth/guard";
import {
  MAX_ROWS_PER_REQUEST,
  buildRoomResolver,
  resolveRoom,
  roomKey,
  validateRow,
} from "@/lib/import";
import { fetchRoomMap } from "@/lib/rooms-server";
import { createClient } from "@/lib/supabase/server";
import { normalizeTime } from "@/lib/time";

/**
 * POST /api/reservations/bulk  (SPEC.md §8.5 / §6.2 Step1-4 / §9.4)
 *
 * 確認画面で人が目視・修正した予約行を一括登録する。3つの仕事をする:
 *   1. エイリアス学習 — 未知だった部屋表記に当てた対応を room_aliases に残す
 *   2. 重複ガード — 同一 (date, room_id, start, end) の active な既存行はスキップ
 *   3. reservations に一括 insert し、import_files を confirmed にする
 *
 * 行の検証は lib/import.ts の validateRow を**画面と同じルールで再実行**する。
 * 画面の入力欄を素通りして API を直接叩かれても不正行が入らないようにするため。
 */
export const runtime = "nodejs";

const bodySchema = z.object({
  rows: z
    .array(
      z.object({
        importFileId: z.string().uuid().nullable().optional(),
        date: z.string(),
        start: z.string(),
        end: z.string(),
        roomRaw: z.string(),
        roomId: z.number().int(),
      }),
    )
    .min(1, "登録する行がありません")
    .max(MAX_ROWS_PER_REQUEST, `一度に登録できるのは${MAX_ROWS_PER_REQUEST}行までです`),
});

/** 重複判定のキー。DB の time は 'HH:MM:SS' で返るので必ず丸めてから作る */
function reservationKey(
  date: string,
  roomId: number,
  start: string,
  end: string,
): string {
  return `${date}|${roomId}|${normalizeTime(start)}|${normalizeTime(end)}`;
}

export async function POST(request: Request) {
  const guard = await requireRole("coordinator");
  if (guard instanceof Response) return guard;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "入力内容が不正です" },
      { status: 400 },
    );
  }
  const { rows } = parsed.data;

  const supabase = await createClient();

  // 部屋の一覧はDBが正 (v1.20)。折衝係が画面から足せるようになったため、
  // 定数と突き合わせると新しい部屋が「存在しない」と弾かれてしまう
  const roomIds = new Set((await fetchRoomMap(supabase)).keys());

  // ---- 行の再検証 (SPEC §9.4) ----
  for (const [index, row] of rows.entries()) {
    const checked = validateRow({
      date: row.date,
      start: row.start,
      end: row.end,
      room: row.roomRaw,
    });
    if (checked.error) {
      return Response.json(
        { error: `${index + 1}行目: ${checked.error}` },
        { status: 400 },
      );
    }
    if (!roomIds.has(row.roomId)) {
      return Response.json(
        { error: `${index + 1}行目: 部屋を選んでください` },
        { status: 400 },
      );
    }
  }

  // ---- import_files の存在確認 ----
  // 存在しない id を渡すと外部キー違反で insert 全体が落ちる。
  // ここで弾いて、どの行が悪いか分かる形で返す。
  const fileIds = [
    ...new Set(rows.map((r) => r.importFileId).filter((id) => !!id)),
  ] as string[];

  if (fileIds.length > 0) {
    const { data, error } = await supabase
      .from("import_files")
      .select("id")
      .in("id", fileIds);
    if (error) {
      return Response.json(
        { error: `取込履歴を確認できませんでした: ${error.message}` },
        { status: 503 },
      );
    }
    const found = new Set((data ?? []).map((f) => (f as { id: string }).id));
    if (found.size !== fileIds.length) {
      return Response.json(
        { error: "取込履歴が見つかりません。CSVを解析し直してください" },
        { status: 400 },
      );
    }
  }

  // ---- 1. エイリアス学習 (SPEC §4.3 / §9.4) ----
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

  // 未知だった表記だけを学習する。
  // 既知の表記に別の部屋を当て直した場合は**上書きしない** —
  // room_aliases には update ポリシーが無く、誤った対応の訂正は
  // 管理者が SQL で行う運用にしてある (SPEC §4.3)。
  const learned = new Map<string, { alias: string; room_id: number }>();
  for (const row of rows) {
    const alias = row.roomRaw.trim();
    const key = roomKey(alias);
    if (!alias || learned.has(key)) continue;
    if (resolveRoom(resolver, alias) !== null) continue;
    learned.set(key, { alias, room_id: row.roomId });
  }

  if (learned.size > 0) {
    // 他の折衝係が同時に同じ表記を登録した場合に備えて衝突は無視する
    const { error } = await supabase
      .from("room_aliases")
      .upsert([...learned.values()], {
        onConflict: "alias",
        ignoreDuplicates: true,
      });
    if (error) {
      return Response.json(
        { error: `部屋の対応付けを保存できませんでした: ${error.message}` },
        { status: 500 },
      );
    }
  }

  // ---- 2. 重複ガード (SPEC §9.4) ----
  const dates = [...new Set(rows.map((r) => r.date))];
  const { data: existing, error: existingError } = await supabase
    .from("reservations")
    .select("date, room_id, start_time, end_time")
    .eq("status", "active")
    .in("date", dates);

  if (existingError) {
    return Response.json(
      { error: `既存の予約枠を確認できませんでした: ${existingError.message}` },
      { status: 503 },
    );
  }

  const seen = new Set(
    ((existing ?? []) as {
      date: string;
      room_id: number;
      start_time: string;
      end_time: string;
    }[]).map((r) => reservationKey(r.date, r.room_id, r.start_time, r.end_time)),
  );

  const toInsert: {
    import_file_id: string | null;
    date: string;
    start_time: string;
    end_time: string;
    room_id: number;
    created_by: string;
  }[] = [];
  let skipped = 0;

  for (const row of rows) {
    const key = reservationKey(row.date, row.roomId, row.start, row.end);
    // seen には DB の既存行と、この payload 内で既に採用した行の両方が入る
    // (同じ内容が2行あるCSVも1件だけ登録される)
    if (seen.has(key)) {
      skipped += 1;
      continue;
    }
    seen.add(key);
    toInsert.push({
      import_file_id: row.importFileId ?? null,
      date: row.date,
      start_time: row.start,
      end_time: row.end,
      room_id: row.roomId,
      created_by: guard.user_id,
    });
  }

  // ---- 3. 一括 insert ----
  if (toInsert.length > 0) {
    const { error } = await supabase.from("reservations").insert(toInsert);
    if (error) {
      if (error.code === "23505") {
        return Response.json(
          {
            error:
              "同じ予約枠が同時に登録されました。CSVを解析し直してから再度確定してください",
          },
          { status: 409 },
        );
      }
      return Response.json(
        { error: `予約枠を登録できませんでした: ${error.message}` },
        { status: 500 },
      );
    }
  }

  // ---- import_files を confirmed にする ----
  if (fileIds.length > 0) {
    const countByFile = new Map<string, number>();
    for (const row of toInsert) {
      if (!row.import_file_id) continue;
      countByFile.set(
        row.import_file_id,
        (countByFile.get(row.import_file_id) ?? 0) + 1,
      );
    }
    // 件数がファイルごとに違うので1件ずつ。ファイル数は高々10件
    await Promise.all(
      fileIds.map((id) =>
        supabase
          .from("import_files")
          .update({ status: "confirmed", row_count: countByFile.get(id) ?? 0 })
          .eq("id", id),
      ),
    );
  }

  return Response.json({
    inserted: toInsert.length,
    skipped,
    learnedAliases: learned.size,
  });
}
