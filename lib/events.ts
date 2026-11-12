import type { SupabaseClient } from "@supabase/supabase-js";

import { GENRE_BY_ID } from "@/lib/constants";
import { isMissingRelation } from "@/lib/schema-errors";
import { addDays, normalizeTime } from "@/lib/time";
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
 *   5. サークルイベント (v1.30。OB は show_to_ob のみ)
 *   6. 締切 (v1.30。現役のみ。終日の予定として)
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
  options: { includeDeadlines?: boolean } = {},
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

  // ---- 3. スタ練 (現役のみ。公式練と同じ扱い。§6.3.1 / v1.23) ----
  if (profile.role !== "ob") {
    events.push(...(await getStudioPracticeEvents(supabase, profile, from, to)));
  }

  // ---- 4. ナンバー練 (OB も対象。縦イベに参加し続けられるようにするため) ----
  events.push(...(await getNumberEvents(supabase, profile, from, to)));

  // ---- 5. サークルイベント (§6.7.1 / v1.30。OB は show_to_ob のものだけ) ----
  events.push(...(await getCircleEventEvents(supabase, profile, from, to)));

  // ---- 6. 締切 (§6.7.2 / v1.30。現役のみ) ----
  // 朝のリマインドの「今日の予定」は締切を含めない (締切は別の通知で届く)
  if (profile.role !== "ob" && options.includeDeadlines !== false) {
    events.push(...(await getDeadlineEvents(supabase, from, to)));
  }

  return sortEvents(events);
}

/**
 * サークルイベント (SPEC §6.7.1 / v1.30)
 *
 * 期間が [from, to] に**少しでも掛かる**ものを引く。合宿のように月をまたぐ
 * イベントは開始日が範囲の外にあっても、その月のマスに出す必要がある。
 *
 * **OB の絞り込みをクエリに明示する。** 購読 ics は service role で呼ぶので、
 * RLS (`sel_cevents`) に頼ると OB に現役向けのイベントが混ざる。
 */
async function getCircleEventEvents(
  supabase: SupabaseClient,
  profile: Profile,
  from: DateString,
  to: DateString,
): Promise<MyEvent[]> {
  let query = supabase
    .from("circle_events")
    .select("id, title, date, end_date, start_time, end_time, place, note")
    .lte("date", to)
    .gte("end_date", from);
  if (profile.role === "ob") {
    query = query.eq("show_to_ob", true);
  }

  const { data, error } = await query;
  // 0020 を流していない DB では表が無い (v1.49)。カレンダーごと止めない
  if (isMissingRelation(error)) return [];
  if (error) {
    throw new Error(`イベントの取得に失敗しました: ${error.message}`);
  }

  return ((data ?? []) as unknown as {
    id: string;
    title: string;
    date: DateString;
    end_date: DateString;
    start_time: string | null;
    end_time: string | null;
    place: string;
    note: string | null;
  }[]).map((row) => {
    const allDay = row.start_time === null || row.end_time === null;
    return {
      kind: "event" as const,
      sourceId: row.id,
      sourceIds: [row.id],
      date: row.date,
      startTime: allDay ? "00:00" : normalizeTime(row.start_time!),
      endTime: allDay ? "24:00" : normalizeTime(row.end_time!),
      title: row.title,
      location: row.place,
      numberId: null,
      genreCode: null,
      allDay,
      note: row.note,
      ...(row.end_date > row.date ? { lastDate: row.end_date } : {}),
    };
  });
}

/**
 * 締切 (SPEC §6.7.2 / v1.30)。カレンダーでは期限日の終日の予定として出す。
 * 時刻があっても終日として置き、時刻は「23:59まで」のように添えるだけにする
 * (締切は「その時間に何かをする予定」ではないため)。
 */
async function getDeadlineEvents(
  supabase: SupabaseClient,
  from: DateString,
  to: DateString,
): Promise<MyEvent[]> {
  const { data, error } = await supabase
    .from("deadlines")
    .select("id, title, due_date, due_time, url, important, note")
    .gte("due_date", from)
    .lte("due_date", to);

  if (isMissingRelation(error)) return [];
  if (error) {
    throw new Error(`締切の取得に失敗しました: ${error.message}`);
  }

  return ((data ?? []) as unknown as {
    id: string;
    title: string;
    due_date: DateString;
    due_time: string | null;
    url: string | null;
    important: boolean;
    note: string | null;
  }[]).map((row) => ({
    kind: "deadline" as const,
    sourceId: row.id,
    sourceIds: [row.id],
    date: row.due_date,
    startTime: "00:00",
    endTime: "24:00",
    title: `締切: ${row.title}`,
    location: "",
    numberId: null,
    genreCode: null,
    allDay: true,
    url: row.url,
    important: row.important,
    dueTime: row.due_time ? normalizeTime(row.due_time) : null,
    note: row.note,
  }));
}

/** SPEC §6.4-1: 自分のジャンル・期に該当する公開済みの公式練 */
async function getGenrePracticeEvents(
  supabase: SupabaseClient,
  profile: Profile,
  from: DateString,
  to: DateString,
): Promise<MyEvent[]> {
  const genres = await getMyGenreHistory(supabase, profile);

  const { data, error } = await supabase
    .from("slots")
    .select(
      "id, genre_id, date, start_time, end_time, target_generations, genres(code), rooms(name, sort_order)",
    )
    .eq("published", true)
    .eq("status", "genre")
    .in("genre_id", genres.ids)
    .gte("date", from)
    .lte("date", to);

  if (error) throw new Error(`slots の取得に失敗しました: ${error.message}`);

  const rows = (data ?? []) as unknown as {
    id: string;
    genre_id: number;
    date: DateString;
    start_time: string;
    end_time: string;
    target_generations: number[] | null;
    genres: { code: string } | null;
    rooms: { name: string; sort_order: number } | null;
  }[];

  const events: GenreEvent[] = rows
    // その日に自分のジャンルだったか (サブジャンルの変更は今日から先だけ。v1.31.9)
    .filter((row) => genres.activeOn(row.genre_id, row.date))
    // 対象期の判定。配列の包含は JS 側で絞る (件数が少なく、条件が読みやすいため)
    .filter(
      (row) =>
        row.target_generations === null ||
        row.target_generations.includes(profile.generation),
    )
    .map((row) => ({
      roomSortOrder: row.rooms?.sort_order ?? 0,
      event: {
        kind: "genre" as const,
        sourceId: row.id,
        sourceIds: [row.id],
        date: row.date,
        startTime: normalizeTime(row.start_time),
        endTime: normalizeTime(row.end_time),
        title: `${row.genres?.code ?? "?"} 公式練`,
        location: row.rooms?.name ?? "",
        numberId: null,
        genreCode: row.genres?.code ?? null,
      },
    }));

  return mergeSameTimeGenreEvents(events);
}

/** まとめのために部屋の並び順を添えたもの。MyEvent 自体は汚さない */
interface GenreEvent {
  roomSortOrder: number;
  event: MyEvent;
}

/**
 * 同じジャンル・同じ時間帯の公式練を1件にまとめる (SPEC §6.4-1 / v1.12)。
 *
 * 1回の練習に部屋を2つ押さえることがあり、コマは**部屋ごとに1行**できる。
 * そのまま出すと自分の予定に同じ練習が2件並び、購読カレンダーにも2件入る。
 * 実際には1つの練習なので、場所を併記して1件にする。
 *
 * **まとめるのは開始・終了が完全に一致するときだけ。** 部分的な重なりでも
 * まとめると、まとめ後の時間帯が実際より長くなり
 * 「19:30に終わるはずが20:00と表示される」ことになる。
 *
 * 代表の id は**並べ替えて先頭のもの**に固定する。ics の UID に使うため、
 * 取得順で変わると購読側で予定が消えて再登場してしまう (SPEC §10)。
 */
function mergeSameTimeGenreEvents(entries: GenreEvent[]): MyEvent[] {
  const groups = new Map<string, GenreEvent[]>();
  for (const entry of entries) {
    const { date, startTime, endTime, genreCode } = entry.event;
    const key = `${date}|${startTime}|${endTime}|${genreCode ?? "?"}`;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }

  return [...groups.values()].map((group) => {
    const byId = [...group].sort((a, b) =>
      a.event.sourceId.localeCompare(b.event.sourceId),
    );
    const representative = byId[0].event;
    if (byId.length === 1) return representative;

    // 場所の並びは部屋の既定順にする (取得順や id 順だと日によって入れ替わる)
    const rooms = [...group]
      .sort((a, b) => a.roomSortOrder - b.roomSortOrder)
      .map((entry) => entry.event.location)
      .filter((name, index, all) => name !== "" && all.indexOf(name) === index);

    return {
      ...representative,
      sourceIds: byId.map((entry) => entry.event.sourceId),
      location: rooms.join("・"),
    };
  });
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
      sourceIds: [row.id],
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
    .select("id, number_id, date, start_time, end_time, place, note, numbers(name)")
    .in("number_id", numberIds)
    // **前日ぶんも取る** (v1.21)。23:00〜翌06:00 のように前日から跨いできた
    // 予定は date が範囲の外にあり、そのままでは初日に何も出ない
    .gte("date", addDays(from, -1))
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
    note: string | null;
    numbers: { name: string } | null;
  }[];

  return rows.map((row) => ({
    kind: "number" as const,
    sourceId: row.id,
    sourceIds: [row.id],
    date: row.date,
    startTime: normalizeTime(row.start_time),
    endTime: normalizeTime(row.end_time),
    // SPEC §10 の SUMMARY 形式はナンバー名そのもの
    title: row.numbers?.name ?? "ナンバー練",
    location: row.place,
    numberId: row.number_id,
    genreCode: null,
    note: row.note,
  }));
}

/**
 * スタ練 (SPEC §6.3.1 / v1.23)
 *
 * 自分のジャンル (1/2/3ジャン) のものを引く。**ナンバーと違って所属の概念が無く**、
 * そのジャンルを取っていれば自動的に自分の予定になる。
 *
 * **対象期も公式練と同じように持つ** (v1.25)。スタ練は「折衝が公式練として
 * コマを割り振っていないだけで、中身は公式練」なので、
 * 「1年生だけの基礎練」のような回を立てられる必要がある。null は期を問わない。
 */
async function getStudioPracticeEvents(
  supabase: SupabaseClient,
  profile: Profile,
  from: DateString,
  to: DateString,
): Promise<MyEvent[]> {
  const genres = await getMyGenreHistory(supabase, profile);

  const { data, error } = await supabase
    .from("genre_practices")
    .select("id, genre_id, date, start_time, end_time, place, note, target_generations")
    .in("genre_id", genres.ids)
    // 前日から跨いできた予定を拾う (v1.21 と同じ理由)
    .gte("date", addDays(from, -1))
    .lte("date", to);

  if (error) {
    throw new Error(`スタ練の取得に失敗しました: ${error.message}`);
  }

  return ((data ?? []) as unknown as {
    id: string;
    genre_id: number;
    date: DateString;
    start_time: string;
    end_time: string;
    place: string;
    note: string | null;
    target_generations: number[] | null;
  }[])
    // その日に自分のジャンルだったか (v1.31.9。公式練と同じ)
    .filter((row) => genres.activeOn(row.genre_id, row.date))
    // 対象期の判定 (v1.25)。公式練と同じ約束で null は期を問わない。
    // 配列の包含は JS 側で絞る (件数が少なく、条件が読みやすいため)
    .filter(
      (row) =>
        row.target_generations === null ||
        row.target_generations.includes(profile.generation),
    )
    .map((row) => {
    const code = GENRE_BY_ID.get(row.genre_id)?.code ?? null;
    return {
      kind: "studio" as const,
      sourceId: row.id,
      sourceIds: [row.id],
      date: row.date,
      startTime: normalizeTime(row.start_time),
      endTime: normalizeTime(row.end_time),
      // 見出しは「{ジャンル}スタ練」。公式練と並んだとき、
      // 同じ色でも何の予定か読んで分かるようにする
      title: `${code ?? "?"}スタ練`,
      location: row.place,
      numberId: null,
      genreCode: code,
      note: row.note,
    };
  });
}

/**
 * 自分のジャンルの履歴 (SPEC §6.4.1 / v1.31.9)。
 *
 * **サブジャンルの変更は今日から先にだけ効く。** サブジャンルはイベントごとに
 * 変わるので、今の値だけで引くと、変えたときに過去の公式練まで消えたり
 * 増えたりした。`user_subgenre_periods` の期間で、予定の日付ごとに判定する。
 * 1ジャンは期間を持たず、いつでも自分のジャンル。
 *
 * - `ids`: 期間のどこかで自分のジャンルだったもの全部 (DB から引く範囲)
 * - `activeOn`: その日に自分のジャンルだったか
 */
export async function getMyGenreHistory(
  supabase: SupabaseClient,
  profile: Profile,
): Promise<{ ids: number[]; activeOn: (genreId: number, date: DateString) => boolean }> {
  const { data, error } = await supabase
    .from("user_subgenre_periods")
    .select("genre_id, from_date, to_date")
    .eq("user_id", profile.user_id);

  // 0022 を流していない DB では期間の表が無い (v1.49)。今の2/3ジャンで判定する (前のやり方)
  if (isMissingRelation(error)) {
    const current = await getMyGenreIds(supabase, profile);
    return { ids: current, activeOn: (genreId) => current.includes(genreId) };
  }
  if (error) {
    throw new Error(`user_subgenre_periods の取得に失敗しました: ${error.message}`);
  }

  const periods = (data ?? []) as {
    genre_id: number;
    from_date: DateString;
    to_date: DateString | null;
  }[];
  const ids = new Set<number>([profile.main_genre_id]);
  for (const period of periods) ids.add(period.genre_id);

  return {
    ids: [...ids],
    activeOn: (genreId, date) =>
      genreId === profile.main_genre_id ||
      periods.some(
        (period) =>
          period.genre_id === genreId &&
          period.from_date <= date &&
          (period.to_date === null || date <= period.to_date),
      ),
  };
}

/**
 * 自分の 1ジャン + 2ジャン + 3ジャン のジャンルIDを返す (今の値)。
 * 1ジャンは profiles、2/3ジャンは user_subgenres から取る (SPEC §1 / §6.4.1)。
 *
 * タブ③の絞り込みチップ (SPEC §6.4-3) も同じ集合を使うので公開している。
 * **その月に予定が無いジャンルもチップに出す**必要があり、
 * 取得済みの予定から逆算するわけにはいかないため。
 */
export async function getMyGenreIds(
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

/** 日付 → 終日の予定 → 開始時刻の順に並べる */
function sortEvents(events: MyEvent[]): MyEvent[] {
  return events.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    if (Boolean(a.allDay) !== Boolean(b.allDay)) return a.allDay ? -1 : 1;
    return a.startTime.localeCompare(b.startTime);
  });
}
