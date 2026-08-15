import type { SupabaseClient } from "@supabase/supabase-js";

import { normalizeTime } from "@/lib/time";
import type { DateString, MyEvent, Profile } from "@/lib/types";

/**
 * 自分の予定の抽出ロジック (SPEC.md §6.4)
 *
 * **マイカレンダー画面と購読 ics の両方がこの1関数を使う**。
 * 片方だけ条件がズレると「サイトには出るが ics に出ない」といった事故になるため、
 * 抽出は必ずここに集約すること。
 *
 * SPEC §6.4 の抽出ロジック:
 *   0. OB (role='ob') は 3 のみ。公式練・空き申請は含めない
 *   1. 公式練: slots published=true / status='genre' /
 *              genre_id ∈ {1ジャン+2ジャン+3ジャン} /
 *              (target_generations is null or 自分の期 = any)
 *   2. 自分の空き申請: claims where user_id=自分 join slots(published)  … Phase 2
 *   3. ナンバー練: number_events where 自分がメンバー                    … Phase 4
 *
 * 引数の supabase は2通りの使われ方をする:
 *   - 画面から: ログインユーザーの RLS クライアント
 *   - ics から: service role クライアント (RLS バイパス)
 * どちらでも同じ結果になるよう、**絞り込み条件はすべてクエリに明示**している。
 * RLS に依存した暗黙の絞り込みを前提にしてはならない。
 */
export async function getMyEvents(
  supabase: SupabaseClient,
  profile: Profile,
  from: DateString,
  to: DateString,
): Promise<MyEvent[]> {
  const events: MyEvent[] = [];

  // ---- 1. 公式練 (現役のみ) ----
  if (profile.role !== "ob") {
    events.push(...(await getGenrePracticeEvents(supabase, profile, from, to)));
  }

  // ---- 2. 自分の空き申請 (現役のみ) ----
  if (profile.role !== "ob") {
    events.push(...(await getClaimEvents(supabase, profile, from, to)));
  }

  // ---- 3. ナンバー練 (OB も対象。縦イベに参加し続けられるようにするため) ----
  events.push(...(await getNumberEvents(supabase, profile, from, to)));

  return sortEvents(events);
}

/** SPEC §6.4-1: 自分のジャンル・期に該当する公開済みの公式練 */
async function getGenrePracticeEvents(
  supabase: SupabaseClient,
  profile: Profile,
  from: DateString,
  to: DateString,
): Promise<MyEvent[]> {
  const genreIds = await getMyGenreIds(supabase, profile);

  const { data, error } = await supabase
    .from("slots")
    .select(
      "id, date, start_time, end_time, target_generations, genres(code), rooms(name)",
    )
    .eq("published", true)
    .eq("status", "genre")
    .in("genre_id", genreIds)
    .gte("date", from)
    .lte("date", to);

  if (error) throw new Error(`slots の取得に失敗しました: ${error.message}`);

  const rows = (data ?? []) as unknown as {
    id: string;
    date: DateString;
    start_time: string;
    end_time: string;
    target_generations: number[] | null;
    genres: { code: string } | null;
    rooms: { name: string } | null;
  }[];

  return rows
    // 対象期の判定。配列の包含は JS 側で絞る (件数が少なく、条件が読みやすいため)
    .filter(
      (row) =>
        row.target_generations === null ||
        row.target_generations.includes(profile.generation),
    )
    .map((row) => ({
      kind: "genre" as const,
      sourceId: row.id,
      date: row.date,
      startTime: normalizeTime(row.start_time),
      endTime: normalizeTime(row.end_time),
      title: `${row.genres?.code ?? "?"} 公式練`,
      location: row.rooms?.name ?? "",
      numberId: null,
      genreCode: row.genres?.code ?? null,
    }));
}

/**
 * SPEC §6.4-2: 自分の空き申請。
 *
 * **時刻は slots ではなく claims 自身の start/end を使う**。
 * 空きコマ全体ではなく、自分が申請した時間帯だけが予定になるため。
 *
 * 公開が取り消されたコマの申請を出さないよう `slots.published` で絞る。
 * service role 経由 (購読ics) では RLS が効かないので、
 * user_id の条件をクエリに明示することが他人の申請混入を防ぐ唯一の砦になる。
 */
async function getClaimEvents(
  supabase: SupabaseClient,
  profile: Profile,
  from: DateString,
  to: DateString,
): Promise<MyEvent[]> {
  const { data, error } = await supabase
    .from("claims")
    .select(
      "id, start_time, end_time, purpose, slots!inner(date, published, rooms(name))",
    )
    .eq("user_id", profile.user_id)
    .eq("slots.published", true)
    .gte("slots.date", from)
    .lte("slots.date", to);

  if (error) throw new Error(`claims の取得に失敗しました: ${error.message}`);

  const rows = (data ?? []) as unknown as {
    id: string;
    start_time: string;
    end_time: string;
    purpose: string | null;
    slots: { date: DateString; rooms: { name: string } | null } | null;
  }[];

  return rows
    .filter((row) => row.slots !== null)
    .map((row) => ({
      kind: "claim" as const,
      sourceId: row.id,
      date: row.slots!.date,
      startTime: normalizeTime(row.start_time),
      endTime: normalizeTime(row.end_time),
      // SPEC §10 の SUMMARY 形式
      title: `空き使用(${row.purpose?.trim() || "個人練"})`,
      location: row.slots!.rooms?.name ?? "",
      numberId: null,
      genreCode: null,
    }));
}

/**
 * SPEC §6.4-3: 自分が所属するナンバーの予定。
 *
 * **OB も対象**。卒業しても縦イベのナンバーには参加し続けられる (SPEC §3.6)。
 *
 * 所属の絞り込みを2段階に分けてクエリへ明示している。RLS (`sel_nevents` /
 * `sel_nmembers`) が同じ絞り込みをしてくれるが、この関数は購読 ics から
 * **service role でも呼ばれる**ので、RLS に頼ると他人のナンバーが
 * 混ざる。埋め込みの絞り込みは書き方を誤ると黙って効かないことがあるため、
 * 「自分の number_id を取る」→「その id で引く」の順にして明示的にしている。
 */
async function getNumberEvents(
  supabase: SupabaseClient,
  profile: Profile,
  from: DateString,
  to: DateString,
): Promise<MyEvent[]> {
  const { data: memberships, error: memberError } = await supabase
    .from("number_members")
    .select("number_id")
    .eq("user_id", profile.user_id);

  if (memberError) {
    throw new Error(`number_members の取得に失敗しました: ${memberError.message}`);
  }

  const numberIds = (memberships ?? []).map(
    (row) => (row as { number_id: string }).number_id,
  );
  if (numberIds.length === 0) return [];

  const { data, error } = await supabase
    .from("number_events")
    .select("id, number_id, date, start_time, end_time, place, numbers(name)")
    .in("number_id", numberIds)
    .gte("date", from)
    .lte("date", to);

  if (error) {
    throw new Error(`number_events の取得に失敗しました: ${error.message}`);
  }

  const rows = (data ?? []) as unknown as {
    id: string;
    number_id: string;
    date: DateString;
    start_time: string;
    end_time: string;
    place: string;
    numbers: { name: string } | null;
  }[];

  return rows.map((row) => ({
    kind: "number" as const,
    sourceId: row.id,
    date: row.date,
    startTime: normalizeTime(row.start_time),
    endTime: normalizeTime(row.end_time),
    // SPEC §10 の SUMMARY 形式はナンバー名そのもの
    title: row.numbers?.name ?? "ナンバー練",
    location: row.place,
    numberId: row.number_id,
    genreCode: null,
  }));
}

/**
 * 自分の 1ジャン + 2ジャン + 3ジャン のジャンルIDを返す。
 * 1ジャンは profiles、2/3ジャンは user_subgenres から取る (SPEC §1 / §6.4.1)。
 */
async function getMyGenreIds(
  supabase: SupabaseClient,
  profile: Profile,
): Promise<number[]> {
  const { data, error } = await supabase
    .from("user_subgenres")
    .select("genre_id")
    .eq("user_id", profile.user_id);

  if (error) {
    throw new Error(`user_subgenres の取得に失敗しました: ${error.message}`);
  }

  const ids = new Set<number>([profile.main_genre_id]);
  for (const row of (data ?? []) as { genre_id: number }[]) {
    ids.add(row.genre_id);
  }
  return [...ids];
}

/** 日付 → 開始時刻の順に並べる */
function sortEvents(events: MyEvent[]): MyEvent[] {
  return events.sort((a, b) =>
    a.date === b.date
      ? a.startTime.localeCompare(b.startTime)
      : a.date.localeCompare(b.date),
  );
}
