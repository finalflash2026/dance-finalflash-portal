import { z } from "zod";

import { requireRole } from "@/lib/auth/guard";
import { hasSupabaseEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/rooms  (SPEC.md §4.2 / §6.2 Step1 / v1.20)
 *
 * 練習場所を1つ足す。取込CSVに知らない場所が出てきたとき、
 * 折衝係がその場で登録して先へ進めるようにするための入口。
 *
 * **service role で書く。** `rooms` はクライアントに insert を許していない
 * (予約枠・コマ・施錠ボードが参照する土台のデータで、誰でも増やせると
 * 取り違えが起きる)。代わりにここで coordinator 以上を検証する。
 *
 * `id` と `sort_order` は指定させない。**DB の連番に決めさせる**
 * (0009 で default を付けた)。画面から番号を選ばせると、既存と衝突したり
 * 飛び番になったりするだけで、折衝係が判断する意味が無い。
 *
 * 同時に**別名**も1件登録する。CSVに書かれていた生の表記を渡してもらい、
 * 次回から自動で解決できるようにする ("以降はその練習場所を認識する")。
 */
export const runtime = "nodejs";

const schema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "練習場所の名前を入力してください")
    .max(40, "名前は40文字以内にしてください"),
  section: z
    .string()
    .trim()
    .min(1, "所在を入力してください")
    .max(20, "所在は20文字以内にしてください"),
  /** CSVに書かれていた表記。次回から自動で解決するために覚える */
  alias: z.string().trim().max(60).optional(),
});

export async function POST(request: Request) {
  const guard = await requireRole("coordinator");
  if (guard instanceof Response) return guard;

  if (!hasSupabaseEnv()) {
    return Response.json(
      { error: "サーバーの設定が未完了です (Supabase 未接続)" },
      { status: 503 },
    );
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "入力内容が不正です" },
      { status: 400 },
    );
  }
  const { name, section, alias } = parsed.data;

  const admin = createAdminClient();

  // 同じ名前が既にあれば、それを返して使ってもらう。
  // 「登録できません」で止めると、押した人は次に何をすればいいのか分からない
  const { data: existing, error: existingError } = await admin
    .from("rooms")
    .select("id, name, section, sort_order")
    .eq("name", name)
    .maybeSingle();

  if (existingError) {
    return Response.json(
      { error: `確認できませんでした: ${existingError.message}` },
      { status: 503 },
    );
  }

  interface RoomRow {
    id: number;
    name: string;
    section: string;
    sort_order: number;
  }

  let room = (existing as RoomRow | null) ?? null;

  if (!room) {
    // **並び順は insert のときに決める。** `sort_order` は NOT NULL なので、
    // 後から update する形にすると insert そのものが通らない。
    //
    // 値は「今の最後の次」。並びは登録した順で足りていて、折衝係に番号を
    // 考えさせる価値が無い。id は 0009 で入れた連番が決める。
    const { data: last, error: lastError } = await admin
      .from("rooms")
      .select("sort_order")
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastError) {
      return Response.json(
        { error: `並び順を決められませんでした: ${lastError.message}` },
        { status: 503 },
      );
    }

    // 同時に2人が足すと同じ番号になりうるが、`sort_order` は一意ではないので
    // 並びが隣り合うだけで実害が無い。ここを厳密にする価値は薄い
    const sortOrder = ((last as { sort_order: number } | null)?.sort_order ?? 0) + 1;

    const { data: created, error: createError } = await admin
      .from("rooms")
      .insert({ name, section, sort_order: sortOrder })
      .select("id, name, section, sort_order")
      .single();

    if (createError || !created) {
      return Response.json(
        { error: `登録できませんでした: ${createError?.message ?? "unknown"}` },
        { status: 500 },
      );
    }
    room = created as unknown as RoomRow;
  }

  // 別名の登録。**失敗しても本体は成功として返す。**
  // 部屋さえできていれば取込は進められ、別名は次回また覚えさせられる
  let learnedAlias: string | null = null;
  const trimmedAlias = alias?.trim();
  if (trimmedAlias && trimmedAlias !== room.name) {
    const { error: aliasError } = await admin
      .from("room_aliases")
      .upsert(
        { alias: trimmedAlias, room_id: room.id },
        { onConflict: "alias" },
      );
    if (aliasError) {
      console.error("[rooms] 別名を覚えられませんでした", aliasError.message);
    } else {
      learnedAlias = trimmedAlias;
    }
  }

  return Response.json({
    room: {
      id: room.id,
      name: room.name,
      section: room.section,
      sortOrder: room.sort_order ?? room.id,
    },
    alias: learnedAlias,
    created: existing == null,
  });
}
