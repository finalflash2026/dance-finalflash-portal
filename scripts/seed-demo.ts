/**
 * デモ用の DB に、マイグレーションと見本のデータを入れる (SPEC.md §14.2 / v1.34)。
 *
 *   実行: npm run seed:demo            (消す前に確かめる)
 *         npm run seed:demo -- --yes   (確かめずに進む)
 *
 * `.env.local` の DEMO_DATABASE_URL (デモ用 Supabase の接続文字列) につなぐ。
 * **本番の DB には向けないこと。** 見本は架空のもので、実在の部員の名前は使わない。
 *
 * 1. supabase/migrations を番号順に流す (流したものは seed_meta.applied_migrations に記録)
 * 2. 前回の見本 (予定・申請・出欠・ナンバーなど) と見本の部員を消す
 * 3. 部員・予約枠とコマ・申請・出欠・ナンバー・スタ練・イベント・締切・告知などを入れる
 * 4. 合言葉3種と管理者のログインを乱数で作り、demo-credentials.local.md に書く (git に入れない)
 *
 * DEMO_ADMIN_EMAIL を入れておくと、そのメールで登録済みの人 (Google でログインして
 * 登録を終えた人) を 3役(管理者) にする。
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";

import bcrypt from "bcryptjs";
import highsLoader from "highs";
import postgres from "postgres";

import { GENRES } from "../lib/constants";
import { DEFAULT_SETTINGS, defaultPerGenre, plan, type Solver } from "../lib/scheduling/plan";
import { DEFAULT_ROOM_SIZES, roomWeightsFor } from "../lib/scheduling/rooms";
import learned from "../lib/scheduling/learned.json";
import { random, scenarioAnswers, scenarioCandidates, type MonthKind } from "../lib/scheduling/scenarios";
import type { Member, PlanInput } from "../lib/scheduling/types";
import { addDays, addMonths, getWeekday, startOfMonth, todayInTokyo } from "../lib/time";

const MIGRATIONS_DIR = join(process.cwd(), "supabase/migrations");
const CREDENTIALS_FILE = join(process.cwd(), "demo-credentials.local.md");

// ---------- 見本の形 (過去のコマ割り表と部員の分かれ方に合わせる。§14.2) ----------

/** 現役の期ごとの人数 (1年生が一番多い) と OB/OG */
const ACTIVE_GENERATIONS: [number, number][] = [
  [25, 48],
  [24, 42],
  [23, 36],
  [22, 28],
];
const OB_GENERATION: [number, number] = [21, 16];

/** 1ジャンの人数の比 (HIPHOP が一番多く、KRUMP が一番少ない) */
const GENRE_WEIGHT: Record<string, number> = {
  HIPHOP: 28, BREAK: 22, POP: 20, JAZZ: 18, LOCK: 16, HOUSE: 14, GIRLS: 12, PUNKING: 12, KRUMP: 8,
};

/** 架空の名前 (ひらがな・カタカナ・漢字を混ぜる。実在の部員とは関係ない) */
const NAMES = [
  "あおい", "はると", "ゆい", "そうた", "ひなた", "れん", "めい", "ゆうと", "さくら", "かいと",
  "みお", "りく", "ことね", "そら", "あかり", "ゆうま", "ひより", "はるき", "つむぎ", "いつき",
  "ミナ", "ケンタ", "ユナ", "リョウ", "サラ", "ジン", "マユ", "タク", "ノア", "レイ",
  "陽菜", "蓮", "結衣", "颯", "凛", "湊", "葵", "樹", "楓", "悠真",
  "美月", "大翔", "紬", "陸斗", "心春", "朝陽", "花音", "奏", "琴葉", "優希",
];

const REASONS = ["授業", "バイト", "体調不良", "就活", "用事", null, null];
const CLAIM_PURPOSES = ["個人練", "ナンバー練", "振り入れ", "動画撮影", null];

// ---------- 準備 ----------

function loadEnvLocal() {
  try {
    for (const line of readFileSync(join(process.cwd(), ".env.local"), "utf8").split("\n")) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    // 無ければ環境変数だけを見る
  }
}

/** lib/auth/email.ts と同じ形 (ユーザーIDからログイン用のメールを作る) */
function dummyEmail(username: string): string {
  const hash = createHash("sha256").update(username, "utf8").digest("hex");
  return `u_${hash.slice(0, 16)}@noemail.example.com`;
}

function secret(length = 10): string {
  // 読み間違えやすい文字 (0/O, 1/l/I) を除く
  const chars = "abcdefghijkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(length);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

function pick<T>(rand: () => number, list: readonly T[]): T {
  return list[Math.floor(rand() * list.length)];
}

function weighted(rand: () => number, weights: Record<string, number>): string {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  let r = rand() * total;
  for (const [key, w] of Object.entries(weights)) {
    r -= w;
    if (r < 0) return key;
  }
  return Object.keys(weights)[0];
}

function minutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function clock(total: number): string {
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

// ---------- 本体 ----------

async function main() {
  loadEnvLocal();
  const url = process.env.DEMO_DATABASE_URL;
  if (!url) {
    console.error("DEMO_DATABASE_URL がありません。.env.local にデモ用 DB の接続文字列を書いてください。");
    process.exit(1);
  }
  const host = new URL(url).host;
  if (!process.argv.includes("--yes")) {
    const rl = createInterface({ input: stdin, output: stdout });
    const answer = await rl.question(
      `${host} に見本のデータを入れ直します (前回の見本と、予定・申請・出欠などは消えます)。続けますか? [y/N] `,
    );
    rl.close();
    if (answer.trim().toLowerCase() !== "y") process.exit(0);
  }

  const sql = postgres(url, { max: 1, onnotice: () => {}, prepare: false });
  try {
    await migrate(sql);
    const credentials = await seed(sql);
    writeFileSync(CREDENTIALS_FILE, credentials);
    console.log(`\n終わりました。ログインと合言葉は ${CREDENTIALS_FILE} にあります (git には入りません)。`);
  } finally {
    await sql.end();
  }
}

/** マイグレーションを番号順に流す。流したものは二度は流さない */
async function migrate(sql: postgres.Sql) {
  await sql`create schema if not exists seed_meta`;
  await sql`create table if not exists seed_meta.applied_migrations (name text primary key, applied_at timestamptz not null default now())`;
  const done = new Set((await sql`select name from seed_meta.applied_migrations`).map((r) => r.name as string));
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    if (done.has(file)) continue;
    process.stdout.write(`マイグレーション ${file} … `);
    await sql.begin(async (tx) => {
      await tx.unsafe(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
      await tx`insert into seed_meta.applied_migrations (name) values (${file})`;
    });
    console.log("済み");
  }
}

interface SeedMember {
  id: string;
  username: string;
  generation: number;
  mainGenreId: number;
  displayName: string;
  role: "ob" | "member" | "coordinator" | "admin";
  subgenres: number[];
}

async function seed(sql: postgres.Sql): Promise<string> {
  const rand = random(20261023);
  const today = todayInTokyo();
  const thisMonth = startOfMonth(today);
  const genreIdByCode = new Map(GENRES.map((g) => [g.code as string, g.id]));

  // ---- 前回の見本を消す ----
  console.log("前回の見本を消しています…");
  await sql.unsafe(`
    delete from public.attendances;
    delete from public.claims;
    delete from public.slots;
    delete from public.reservations;
    delete from public.import_files;
    delete from public.number_events;
    delete from public.number_members;
    delete from public.numbers;
    delete from public.genre_practices;
    delete from public.circle_events;
    delete from public.deadlines;
    delete from public.announcements;
    delete from public.notifications;
    delete from public.board_messages;
    delete from public.room_status;
    delete from public.club_key_holders;
    delete from public.admin_audit_logs;
    delete from auth.users where raw_app_meta_data->>'seed' = 'true';
  `);

  // ---- 部員 ----
  console.log("部員を作っています…");
  const members: SeedMember[] = [];
  const usernames = new Set<string>();
  const addMember = (generation: number, role: SeedMember["role"], code?: string, name?: string) => {
    const genreCode = code ?? weighted(rand, GENRE_WEIGHT);
    let displayName = name ?? pick(rand, NAMES);
    let username = `${generation}${genreCode}${displayName}`;
    // 同じ期・ジャンル・名前は、名前を変えて分ける (実際も名前側で区別してもらう)
    for (let i = 2; usernames.has(username); i++) {
      displayName = `${name ?? pick(rand, NAMES)}${i > 3 ? i : ""}`;
      username = `${generation}${genreCode}${displayName}`;
    }
    usernames.add(username);
    const mainGenreId = genreIdByCode.get(genreCode)!;
    const subgenres: number[] = [];
    if (role !== "ob" && rand() < 0.4) {
      const sub2 = GENRES[Math.floor(rand() * GENRES.length)].id;
      if (sub2 !== mainGenreId) subgenres.push(sub2);
      if (subgenres.length && rand() < 0.3) {
        const sub3 = GENRES[Math.floor(rand() * GENRES.length)].id;
        if (sub3 !== mainGenreId && sub3 !== sub2) subgenres.push(sub3);
      }
    }
    const member = { id: randomUUID(), username, generation, mainGenreId, displayName, role, subgenres };
    members.push(member);
    return member;
  };

  // 管理者のログイン (ユーザーIDとパスワード)。合言葉と一緒にファイルへ書く
  const adminLogin = addMember(22, "admin", "BREAK", "かんり");
  const adminPassword = secret(12);
  for (const [generation, count] of ACTIVE_GENERATIONS) {
    for (let i = 0; i < count; i++) addMember(generation, "member");
  }
  for (let i = 0; i < OB_GENERATION[1]; i++) addMember(OB_GENERATION[0], "ob");
  // 役職: 折衝 3人 (24期)・3役 3人 (23期)
  members.filter((m) => m.generation === 24 && m.role === "member").slice(0, 3).forEach((m) => (m.role = "coordinator"));
  members.filter((m) => m.generation === 23 && m.role === "member").slice(0, 3).forEach((m) => (m.role = "admin"));

  const active = members.filter((m) => m.role !== "ob");
  const coordinators = members.filter((m) => m.role === "coordinator");
  const admins = members.filter((m) => m.role === "admin");

  const adminHash = bcrypt.hashSync(adminPassword, 10);
  await sql`insert into auth.users ${sql(
    members.map((m) => ({
      instance_id: "00000000-0000-0000-0000-000000000000",
      id: m.id,
      aud: "authenticated",
      role: "authenticated",
      email: m === adminLogin ? dummyEmail(m.username) : `seed_${m.id.slice(0, 8)}@noemail.example.com`,
      encrypted_password: m === adminLogin ? adminHash : "",
      email_confirmed_at: new Date(),
      raw_app_meta_data: sql.json({ provider: "email", providers: ["email"], seed: "true" }),
      raw_user_meta_data: sql.json({}),
      created_at: new Date(),
      updated_at: new Date(),
      confirmation_token: "",
      email_change: "",
      email_change_token_new: "",
      recovery_token: "",
    })),
  )}`;
  await sql`insert into auth.identities ${sql([
    {
      id: randomUUID(),
      user_id: adminLogin.id,
      provider_id: adminLogin.id,
      identity_data: sql.json({ sub: adminLogin.id, email: dummyEmail(adminLogin.username), email_verified: true }),
      provider: "email",
      created_at: new Date(),
      updated_at: new Date(),
    },
  ])}`;
  await sql`insert into public.profiles ${sql(
    members.map((m) => ({
      user_id: m.id,
      username: m.username,
      generation: m.generation,
      main_genre_id: m.mainGenreId,
      display_name: m.displayName,
      role: m.role,
    })),
  )}`;
  const subRows = members.flatMap((m) => m.subgenres.map((genreId, i) => ({ user_id: m.id, slot: i + 2, genre_id: genreId })));
  if (subRows.length) await sql`insert into public.user_subgenres ${sql(subRows)}`;
  // トリガは「今日から」で期間を作る。見本では春から同じサブジャンルだったことにする
  await sql`update public.user_subgenre_periods set from_date = ${addMonths(thisMonth, -6)} where user_id = any(${members.map((m) => m.id)})`;
  await sql`insert into public.calendar_tokens ${sql(
    members.map((m) => ({ user_id: m.id, token: randomBytes(32).toString("base64url") })),
  )}`;

  // ---- 予約枠とコマ (日程調整の計算で割り振る) ----
  const solver: Solver = await highsLoader();
  // 再来月 (日程調整の月。§6.8.4) とその次の月は**予約枠だけ** (コマ割り前。v1.35)。
  // 日程調整 → コマ割り を試せるように
  const months: { month: string; kind: MonthKind; published: boolean; slots: boolean }[] = [
    { month: addMonths(thisMonth, -1), kind: "holiday", published: true, slots: true },
    { month: thisMonth, kind: "term", published: true, slots: true },
    { month: addMonths(thisMonth, 1), kind: "term", published: true, slots: true },
    { month: addMonths(thisMonth, 2), kind: "term", published: false, slots: false },
    { month: addMonths(thisMonth, 3), kind: "term", published: false, slots: false },
  ];
  const planMembers: Member[] = active.map((m) => ({ id: m.id, name: m.username, genres: [m.mainGenreId, ...m.subgenres] }));
  const slotRows: { id: string; reservation_id: string; date: string; start_time: string; end_time: string; room_id: number; status: string; genre_id: number | null; published: boolean }[] = [];
  const reservationRows: { id: string; date: string; start_time: string; end_time: string; room_id: number; created_by: string }[] = [];
  for (const [index, { month, kind, published, slots }] of months.entries()) {
    const candidates = scenarioCandidates(month, kind, 9000 + index);
    if (!slots) {
      // 予約枠だけ入れる (同じ日・同じ部屋をまとめる)
      const spans = new Map<string, { date: string; roomId: number; start: string; end: string }>();
      for (const c of candidates) {
        const key = `${c.date}|${c.roomId}`;
        const span = spans.get(key);
        spans.set(key, {
          date: c.date,
          roomId: c.roomId,
          start: span && span.start < c.startTime ? span.start : c.startTime,
          end: span && span.end > c.endTime ? span.end : c.endTime,
        });
      }
      for (const span of spans.values()) {
        reservationRows.push({
          id: randomUUID(),
          date: span.date,
          start_time: span.start,
          end_time: span.end,
          room_id: span.roomId,
          created_by: pick(rand, coordinators).id,
        });
      }
      console.log(`${month.slice(0, 7)} は予約枠だけ (${spans.size}枠)`);
      continue;
    }
    const input: PlanInput = {
      genres: GENRES.map((g) => ({ id: g.id, code: g.code })),
      candidates,
      members: planMembers,
      answers: scenarioAnswers(planMembers, candidates, 9100 + index),
    };
    const settings = {
      ...DEFAULT_SETTINGS,
      roomWeights: roomWeightsFor(DEFAULT_ROOM_SIZES, learned.roomStrength),
      // 実際の表と同じく、空きのコマ (個人練に開放) も残す
      perGenre: Math.max(1, defaultPerGenre(input) - 2),
    };
    process.stdout.write(`${month.slice(0, 7)} のコマを割り振っています… `);
    const result = plan(input, settings, solver);
    console.log(`${result.status} (${result.assignments.length}コマ)`);
    const genreOf = new Map(result.assignments.map((a) => [a.candidateId, a.genreId]));

    // 同じ日・同じ部屋のコマを1つの予約枠にまとめる
    const byRoomDay = new Map<string, typeof candidates>();
    for (const c of candidates) {
      const key = `${c.date}|${c.roomId}`;
      byRoomDay.set(key, [...(byRoomDay.get(key) ?? []), c]);
    }
    for (const list of byRoomDay.values()) {
      const reservationId = randomUUID();
      reservationRows.push({
        id: reservationId,
        date: list[0].date,
        start_time: list.map((c) => c.startTime).sort()[0],
        end_time: list.map((c) => c.endTime).sort().at(-1)!,
        room_id: list[0].roomId,
        created_by: pick(rand, coordinators).id,
      });
      for (const c of list) {
        const genreId = genreOf.get(c.id) ?? null;
        slotRows.push({
          id: randomUUID(),
          reservation_id: reservationId,
          date: c.date,
          start_time: c.startTime,
          end_time: c.endTime,
          room_id: c.roomId,
          // 割り振られなかったコマは空き (個人練に開放)
          status: genreId ? "genre" : "open",
          genre_id: genreId,
          published,
        });
      }
    }
  }
  await insertChunks(sql, "reservations", reservationRows);
  await insertChunks(sql, "slots", slotRows);

  // ---- 空き申請 ----
  // 申請は10分刻み (DB の CHECK)。70分コマの 19:15 始まりなどは、内側の10分刻みに丸める
  const claimRows = slotRows
    .filter((s) => s.status === "open" && s.published && rand() < 0.7)
    .map((s) => {
      const start = Math.ceil(minutes(s.start_time) / 10) * 10;
      const end = Math.floor(minutes(s.end_time) / 10) * 10;
      // 半分だけ使う申請も混ぜる
      const half = start + Math.floor((end - start) / 20) * 10;
      return {
        slot_id: s.id,
        user_id: pick(rand, active).id,
        start_time: clock(start),
        end_time: clock(rand() < 0.5 ? end : half),
        purpose: pick(rand, CLAIM_PURPOSES),
      };
    })
    .filter((c) => c.start_time < c.end_time);
  await insertChunks(sql, "claims", claimRows);

  // ---- 公式練の出欠 (理由つき) ----
  const attendanceRows: Record<string, unknown>[] = [];
  const seenSlotTime = new Set<string>();
  for (const s of slotRows) {
    if (s.status !== "genre" || !s.published) continue;
    if (s.date < addDays(today, -21) || s.date > addDays(today, 21)) continue;
    // 同じ時間に部屋を2つ取った練習は、1つのコマにだけ付ける
    const key = `${s.date}|${s.start_time}|${s.genre_id}`;
    if (seenSlotTime.has(key)) continue;
    seenSlotTime.add(key);
    for (const m of active) {
      if (m.mainGenreId !== s.genre_id && !m.subgenres.includes(s.genre_id!)) continue;
      const r = rand();
      if (r > 0.12) continue;
      const status = r < 0.07 ? "absent" : r < 0.1 ? "late" : "leave_early";
      attendanceRows.push({
        user_id: m.id,
        slot_id: s.id,
        status,
        time_value:
          status === "late" ? clock(minutes(s.start_time) + 20) : status === "leave_early" ? clock(minutes(s.end_time) - 30) : null,
        reason: pick(rand, REASONS),
      });
    }
  }
  await insertChunks(sql, "attendances", attendanceRows);

  // ---- ナンバー ----
  const numberDefs = [
    { name: "学祭 オールジャンル", size: 24, ob: false },
    { name: "縦イベ HIPHOP", size: 16, ob: true },
    { name: "縦イベ BREAK×POP", size: 12, ob: true },
    { name: "秋ナンバー JAZZ", size: 10, ob: false },
    { name: "新歓準備 LOCK", size: 8, ob: false },
    { name: "冬ショーケース GIRLS", size: 9, ob: false },
    { name: "HOUSE セッション", size: 7, ob: false },
    { name: "1年生ナンバー", size: 20, ob: false },
  ];
  const places = ["スタジオ ノア 渋谷", "スタジオ アクト 町田", "練習室2(フレスコ)", "南大沢市民センター", "スタジオ ペンタ 八王子"];
  for (const def of numberDefs) {
    const pool = (def.ob ? members : active).filter((m) => def.name !== "1年生ナンバー" || m.generation === 25);
    const chosen = [...pool].sort(() => rand() - 0.5).slice(0, def.size);
    const owner = chosen[0];
    const numberId = randomUUID();
    await sql`insert into public.numbers (id, name, owner_id) values (${numberId}, ${def.name}, ${owner.id})`;
    // 主催は numbers のトリガが自動でメンバーに入れる
    await sql`insert into public.number_members ${sql(chosen.map((m) => ({ number_id: numberId, user_id: m.id })))} on conflict do nothing`;
    const events = Array.from({ length: 4 + Math.floor(rand() * 4) }, () => {
      const date = addDays(today, Math.floor(rand() * 60) - 14);
      const start = 18 * 60 + Math.floor(rand() * 4) * 30;
      return {
        number_id: numberId,
        date,
        start_time: clock(start),
        end_time: clock(start + 120),
        place: pick(rand, places),
        note: rand() < 0.4 ? pick(rand, ["振り入れ", "通し", "動画撮影", "立ち位置の確認"]) : null,
      };
    });
    await sql`insert into public.number_events ${sql(events)}`;
  }

  // ---- スタ練 (2ジャンのショーケース練を含む) ----
  const practiceRows: Record<string, unknown>[] = [];
  for (const genre of GENRES) {
    const holders = active.filter((m) => m.mainGenreId === genre.id);
    const subHolders = active.filter((m) => m.subgenres.includes(genre.id));
    for (let i = 0; i < 3; i++) {
      const sub = i === 2 && subHolders.length > 0;
      const creator = pick(rand, sub ? subHolders : holders);
      if (!creator) continue;
      const date = addDays(today, Math.floor(rand() * 40) - 7);
      // 火・金の夜か土日の昼 (公式練と重ならない時間)
      const weekend = [0, 6].includes(getWeekday(date));
      const start = weekend ? 10 * 60 : 19 * 60 + 30;
      practiceRows.push({
        genre_id: genre.id,
        date,
        start_time: clock(start),
        end_time: clock(start + 150),
        place: pick(rand, places),
        note: sub ? "ジャンルショーケースの通し" : rand() < 0.3 ? "基礎練" : null,
        created_by: creator.id,
      });
    }
  }
  await sql`insert into public.genre_practices ${sql(practiceRows)}`;

  // ---- イベント・締切・告知 ----
  const by = admins[0].id;
  await sql`insert into public.circle_events ${sql([
    { title: "学祭", date: "2026-11-01", end_date: "2026-11-03", start_time: null, end_time: null, place: "南大沢キャンパス", note: "出演順は告知を見てください。", show_to_ob: false, created_by: by },
    { title: "縦イベ", date: "2026-12-13", end_date: "2026-12-13", start_time: "13:00", end_time: "19:00", place: "講堂", note: "OB/OGも出演します。", show_to_ob: true, created_by: by },
    { title: "秋合宿", date: "2026-09-14", end_date: "2026-09-16", start_time: null, end_time: null, place: "長野", note: null, show_to_ob: false, created_by: by },
    { title: "総会", date: addDays(today, 10), end_date: addDays(today, 10), start_time: "19:00", end_time: "20:30", place: "リハーサル室", note: "代替わりの説明があります。", show_to_ob: false, created_by: by },
    { title: "忘年会", date: "2026-12-26", end_date: "2026-12-26", start_time: "18:30", end_time: "21:00", place: "未定", note: null, show_to_ob: true, created_by: by },
  ])}`;
  await sql`insert into public.deadlines ${sql([
    { title: "学祭の出演フォーム", due_date: addDays(today, 3), due_time: "23:59", url: "https://forms.gle/example", note: null, important: false, created_by: by },
    { title: "冬合宿費の集金", due_date: addDays(today, 12), due_time: null, url: null, note: "1万2千円。会計に直接。", important: true, created_by: by },
    { title: "2ジャン登録フォーム", due_date: addDays(today, 20), due_time: "23:59", url: "https://forms.gle/example2", note: null, important: false, created_by: by },
  ])}`;
  await sql`insert into public.announcements ${sql([
    { title: "学祭の出演順が決まりました", body: "1日目はHIPHOP→BREAK→JAZZの順です。リハは前日18時からです。", include_ob: false, created_by: by },
    { title: "縦イベの出演者募集", body: "OB/OGの方も出演できます。ナンバーの主催に声をかけてください。", include_ob: true, created_by: by },
    { title: "鍵の返却について", body: "練習のあと、部室の鍵は必ず守衛室に返してください。", include_ob: false, created_by: by },
  ])}`;
  await insertChunks(
    sql,
    "notifications",
    active.map((m) => ({
      user_id: m.id,
      type: "schedule_updated",
      title: `${Number(thisMonth.slice(5, 7))}月の練習日程が公開されました`,
      body: null,
      read_at: rand() < 0.6 ? new Date() : null,
    })),
  );

  // ---- 鍵と連絡 (今日) ----
  const todaysRooms = [...new Set(slotRows.filter((s) => s.date === today).map((s) => s.room_id))];
  if (todaysRooms.length) {
    await sql`insert into public.room_status ${sql(
      todaysRooms.map((roomId, i) => ({ date: today, room_id: roomId, is_unlocked: i === 0, updated_by: pick(rand, active).id })),
    )}`;
    await sql`insert into public.board_messages ${sql([
      { scope: "room", date: today, user_id: pick(rand, active).id, body: "鍵はリハ室にいる人が持っています" },
    ])}`;
  }
  await sql`insert into public.club_key_holders (user_id) values (${pick(rand, active).id})`;

  // ---- 合言葉 ----
  const passphrases = { signup_pass: secret(), coordinator_pass: secret(), admin_pass: secret() };
  for (const [key, value] of Object.entries(passphrases)) {
    await sql`insert into public.app_settings (key, value_hash) values (${key}, ${bcrypt.hashSync(value, 10)})
      on conflict (key) do update set value_hash = excluded.value_hash, updated_at = now()`;
  }

  // ---- Google で登録済みの人を 3役 に (任意) ----
  const promoteEmail = process.env.DEMO_ADMIN_EMAIL;
  let promoted = "";
  if (promoteEmail) {
    const rows = await sql`update public.profiles set role = 'admin'
      where user_id in (select id from auth.users where lower(email) = lower(${promoteEmail}))
      returning username`;
    promoted = rows.length
      ? `\n${promoteEmail} の人 (${rows[0].username}) を 3役(管理者) にしました。`
      : `\n${promoteEmail} の人はまだ登録していません。Google でログインして登録を終えてから、もう一度流すか、設定の「権限」で管理者の合言葉を入れてください。`;
  }

  console.log(
    `部員 ${members.length}人・予約枠 ${reservationRows.length}・コマ ${slotRows.length}・申請 ${claimRows.length}・出欠 ${attendanceRows.length}`,
  );

  return `# デモ用のログインと合言葉

npm run seed:demo を流すたびに作り直します。**git に入れないこと。** (${new Date().toISOString()})

## 管理者 (ユーザーIDとパスワード)

- ユーザーID: ${adminLogin.username}
- パスワード: ${adminPassword}

## 合言葉

- サークル生 (新規登録・Google で登録するとき): ${passphrases.signup_pass}
- 折衝: ${passphrases.coordinator_pass}
- 管理者 (3役): ${passphrases.admin_pass}
${promoted}
`;
}

/** 大量の行は分けて入れる (1回の文が大きくなりすぎないように) */
async function insertChunks(sql: postgres.Sql, table: string, rows: Record<string, unknown>[]) {
  for (let i = 0; i < rows.length; i += 500) {
    await sql`insert into ${sql(table)} ${sql(rows.slice(i, i + 500) as Record<string, postgres.SerializableParameter>[])}`;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
