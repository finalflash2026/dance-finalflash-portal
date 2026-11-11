"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";

import { CheckMark } from "@/components/motion/CheckMark";
import { RollingNumber } from "@/components/motion/RollingNumber";
import { ErrorMessage, GroupHeader, Segmented, groupClass, primaryButtonClass } from "@/components/ui";
import { GENRE_COLORS, ROOM_BY_ID, type GenreCode } from "@/lib/constants";
import learned from "@/lib/scheduling/learned.json";
import { measure, type PlanMetrics } from "@/lib/scheduling/metrics";
import { DEFAULT_SETTINGS, answerKey, defaultPerGenre, isBigRoom } from "@/lib/scheduling/plan";
import { sizeWeight } from "@/lib/scheduling/rooms";
import type {
  Answer,
  AnswerKey,
  Candidate,
  PlanInput,
  PlanResult,
  PlanSettings,
} from "@/lib/scheduling/types";
import { roundTitle, type ScheduleRound } from "@/lib/scheduling/round";
import { confirmAction } from "@/lib/confirm";
import { showToast } from "@/lib/toast";
import { daysBetween, formatDateLabel, getWeekday, parseDate, todayInTokyo } from "@/lib/time";

/**
 * 日程調整 (SPEC.md §6.8.4 / v1.33.1)。
 *
 * **回答と割り振りは別の画面にする。** 回答 (`/schedule`) は全員、集計と割り振り
 * (`/schedule/plan`) は折衝・3役だけ。いまは見本のデータ (150人・来月の予約枠) で
 * 動き、保存はされない。
 */

// ---------- 回答 (§6.8.2) ----------

export function ScheduleAnswerClient({
  initialInput,
  me,
  round,
  storageKey,
  persist = false,
}: {
  initialInput: PlanInput;
  me: string;
  round: ScheduleRound;
  /** 自分の回答を端末に保存するときの鍵 (Supabase の無い見本だけ。v1.35) */
  storageKey?: string;
  /** 回答を DB に保存する (v1.44)。押すたびに少しまとめて送る */
  persist?: boolean;
}) {
  const [input, setInput] = useState(initialInput);
  const [saveError, setSaveError] = useState<string | null>(null);
  // 端末に保存した回答を読む (見本だけ。描いたあとで。サーバーの描画とそろえるため)
  useEffect(() => {
    if (persist) return;
    const saved = readSavedAnswers(storageKey);
    if (saved) setInput((prev) => ({ ...prev, answers: { ...prev.answers, [me]: saved } }));
  }, [storageKey, me, persist]);
  const mine = input.answers[me] ?? {};
  const slots = useMemo(() => answerSlots(input.candidates), [input.candidates]);
  const allKeys = useMemo(() => keysOf(slots), [slots]);
  const answeredCount = allKeys.filter((key) => mine[key]).length;
  // 受付中で締切の日まで (DB の RLS と同じ条件。§6.8.5)
  const accepting = round.status === "open" && todayInTokyo() <= round.deadline;

  /** まだ送っていない変更。押すたびに送ると連打で通信が重なるので、少し待ってまとめる */
  const pending = useRef(new Map<AnswerKey, Answer | null>());
  const timer = useRef(0);
  const lastSaved = useRef(mine);
  const latest = useRef(mine);
  latest.current = mine;

  function flush() {
    const changes = [...pending.current.entries()];
    pending.current.clear();
    if (changes.length === 0) return;
    const snapshot = lastSaved.current;
    void fetch("/api/schedule/answers", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roundId: round.id,
        changes: changes.map(([key, answer]) => {
          const [date, range] = key.split("|");
          const [startTime, endTime] = range.split("-");
          return { date, startTime, endTime, answer };
        }),
      }),
    })
      .then(async (res) => {
        if (res.ok) {
          setSaveError(null);
          lastSaved.current = latest.current;
          return;
        }
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "保存できませんでした。");
      })
      .catch((cause: unknown) => {
        // 保存できなかったら、最後に保存できた回答に戻す
        setSaveError(cause instanceof Error ? cause.message : "保存できませんでした。");
        setInput((prev) => ({ ...prev, answers: { ...prev.answers, [me]: snapshot } }));
      });
  }

  function setMany(keys: AnswerKey[], value: Answer | undefined) {
    if (!accepting) return;
    const next = { ...mine };
    for (const key of keys) {
      if (value) next[key] = value;
      else delete next[key];
    }
    setInput((prev) => ({ ...prev, answers: { ...prev.answers, [me]: next } }));
    if (persist) {
      for (const key of keys) pending.current.set(key, value ?? null);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, 500);
      return;
    }
    if (storageKey) {
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {}
    }
  }

  // 画面を離れる前に残りを送る
  useEffect(() => {
    if (!persist) return;
    const onHide = () => {
      if (document.visibilityState === "hidden") {
        window.clearTimeout(timer.current);
        flush();
      }
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.clearTimeout(timer.current);
      flush();
    };
    // flush は ref だけを使う
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persist]);

  return (
    <main className="mx-auto max-w-3xl space-y-4 px-4 py-3">
      <h1 className="text-[28px] font-bold leading-tight">{roundTitle(round)}</h1>
      <DeadlineCard round={round} answered={answeredCount} total={allKeys.length} />
      <ErrorMessage>{saveError}</ErrorMessage>
      {accepting ? null : (
        <p className="rounded-2xl bg-[var(--cell)] px-4 py-3 text-center text-[15px] text-[var(--muted)]">
          受付は終わりました
        </p>
      )}

      <BulkCard
        onApply={(weekdays, mark) =>
          setMany(
            keysOf(weekdays.length ? slots.filter((s) => weekdays.includes(getWeekday(s.date))) : slots),
            mark,
          )
        }
      />

      <ul className="space-y-2">
        {slots.map(({ date, ranges }) => {
          const wd = getWeekday(date);
          return (
            <li key={date} className="rounded-2xl bg-[var(--cell)] px-3 py-2.5">
              <p
                className={`mb-2 text-[15px] font-semibold tabular-nums ${
                  wd === 0 ? "text-[var(--accent)]" : wd === 6 ? "text-[var(--info)]" : ""
                }`}
              >
                {formatDateLabel(date)}
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {ranges.map(({ start, end }) => {
                  const key = answerKey(date, start, end);
                  const value = mine[key] ?? "none";
                  const style = ANSWER_STYLE[value];
                  return (
                    <button
                      key={key}
                      type="button"
                      // 押すたびに ○ → △ → × → 未回答 (v1.40)
                      onClick={() => setMany([key], NEXT_ANSWER[value])}
                      aria-label={`${formatDateLabel(date)} ${start}〜${end} ${ANSWER_WORD[value]}`}
                      className="flex h-12 items-center justify-between gap-2 rounded-xl bg-[var(--fill)] pl-3 pr-1.5 transition-transform active:scale-[0.97]"
                    >
                      <span className="text-[14px] tabular-nums">
                        {start}〜{end}
                      </span>
                      <span
                        // 印が変わるたびに作り直して、ふくらませる
                        key={value}
                        className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-[18px] font-bold ${
                          value === "none" ? "" : "select-pop"
                        } ${style.className}`}
                      >
                        {style.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </li>
          );
        })}
      </ul>
    </main>
  );
}

/**
 * 締切と回答の進み具合 (v1.33.1)。状態のチップを並べる代わりに、
 * 一番気にすること (あと何日・どこまで答えたか) を大きく1枚で見せる
 */
function DeadlineCard({
  round,
  answered,
  total,
}: {
  round: ScheduleRound;
  answered: number;
  total: number;
}) {
  const days = daysBetween(todayInTokyo(), round.deadline);
  const done = total > 0 && answered === total;
  return (
    <section className="rounded-2xl bg-[var(--cell)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[34px] font-bold leading-none tabular-nums">
            {days <= 0 ? "今日まで" : `あと${days}日`}
          </p>
          <p className="mt-1.5 text-[15px] text-[var(--muted)] tabular-nums">
            {formatDateLabel(round.deadline)} 23:59 締切
          </p>
        </div>
        <span
          className={`flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[13px] font-semibold ${
            done ? "bg-[#34c759] text-white" : "bg-[var(--fill)]"
          }`}
        >
          {/* 全部答えた瞬間にチェックが描かれる (§12「動き」/ v1.36) */}
          {done ? <CheckMark size={16} className="text-white/30" /> : null}
          {done ? "回答済み" : "受付中"}
        </span>
      </div>
      <div
        className="mt-4 h-2 overflow-hidden rounded-full bg-[var(--fill)]"
        role="progressbar"
        aria-label="回答したコマ"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={answered}
      >
        <div
          className="h-full rounded-full bg-[#34c759] transition-[width] duration-300"
          style={{ width: `${total ? (answered / total) * 100 : 0}%` }}
        />
      </div>
      <p className="mt-1.5 text-[13px] text-[var(--muted)] tabular-nums">
        <RollingNumber value={answered} />/{total}コマ
      </p>
    </section>
  );
}

const ANSWER_STYLE: Record<Answer | "none", { label: string; className: string }> = {
  ok: { label: "○", className: "bg-[#34c759] text-white" },
  maybe: { label: "△", className: "bg-[#ff9f0a] text-white" },
  no: { label: "×", className: "bg-[var(--muted)] text-white opacity-70" },
  none: { label: "−", className: "bg-[var(--fill)] text-[var(--muted)]" },
};
/** コマを押したときの次の印 (v1.40) */
const NEXT_ANSWER: Record<Answer | "none", Answer | undefined> = {
  none: "ok",
  ok: "maybe",
  maybe: "no",
  no: undefined,
};
/** 印の見た目 (まとめて付けるときの印の選択)。選んでいる印は印の色で塗る */
const PEN_STYLE: Record<Answer | "none", { label: string; on: string; mark: string }> = {
  ok: { label: "出られる", on: "bg-[#34c759] text-white", mark: "text-[#34c759]" },
  maybe: { label: "できれば避けたい", on: "bg-[#ff9f0a] text-white", mark: "text-[#ff9f0a]" },
  no: { label: "出られない", on: "bg-[var(--muted)] text-white", mark: "text-[var(--muted)]" },
  none: { label: "未回答", on: "bg-[var(--muted)] text-white", mark: "text-[var(--muted)]" },
};
/** 読み上げ用 */
const ANSWER_WORD: Record<Answer | "none", string> = {
  ok: "出られる",
  maybe: "できれば避けたい",
  no: "出られない",
  none: "未回答",
};
const WEEKDAY = ["日", "月", "火", "水", "木", "金", "土"];

/** 端末に保存した自分の回答 (デモ環境。v1.35)。無い・読めないときは null */
function readSavedAnswers(storageKey?: string): Partial<Record<AnswerKey, Answer>> | null {
  if (!storageKey) return null;
  try {
    const raw = localStorage.getItem(storageKey);
    return raw ? (JSON.parse(raw) as Partial<Record<AnswerKey, Answer>>) : null;
  } catch {
    return null;
  }
}

/** 回答する日とコマの時間 (その日に予約枠のあるコマの時間だけ。§6.8.2 / v1.32.1) */
function answerSlots(candidates: Candidate[]): { date: string; ranges: { start: string; end: string }[] }[] {
  const map = new Map<string, Map<string, { start: string; end: string }>>();
  for (const c of candidates) {
    const ranges = map.get(c.date) ?? new Map();
    ranges.set(`${c.startTime}-${c.endTime}`, { start: c.startTime, end: c.endTime });
    map.set(c.date, ranges);
  }
  return [...map]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, ranges]) => ({
      date,
      ranges: [...ranges.values()].sort((x, y) => x.start.localeCompare(y.start)),
    }));
}

function keysOf(list: ReturnType<typeof answerSlots>): AnswerKey[] {
  return list.flatMap((s) => s.ranges.map((r) => answerKey(s.date, r.start, r.end)));
}

/**
 * まとめて付ける (§6.8.2 / v1.33.1 / v1.40 / v1.43)。曜日 (選ばなければ全部の日) と
 * 印を選んで一度に付ける (または − で未回答に戻す)。1つずつ押すのが基本なので、ボタンは控えめにする
 */
function BulkCard({ onApply }: { onApply: (weekdays: number[], mark: Answer | undefined) => void }) {
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [mark, setMark] = useState<Answer | "none">("ok");
  const target = weekdays.length
    ? `${[1, 2, 3, 4, 5, 6, 0].filter((d) => weekdays.includes(d)).map((d) => WEEKDAY[d]).join("・")}曜日`
    : "全部の日";

  async function apply() {
    if (mark === "none") {
      if (
        !(await confirmAction({
          message: `${target}の回答を消します。`,
          confirmLabel: "未回答に戻す",
          destructive: true,
        }))
      ) {
        return;
      }
      onApply(weekdays, undefined);
      showToast(`${target}を未回答に戻しました`);
      return;
    }
    onApply(weekdays, mark);
    showToast(`${target}を${ANSWER_STYLE[mark].label}にしました`);
  }

  return (
    <section className="space-y-3 rounded-2xl bg-[var(--cell)] p-4">
      <h2 className="text-[17px] font-semibold">まとめて付ける</h2>
      <div className="flex justify-between gap-1" role="group" aria-label="曜日">
        {[1, 2, 3, 4, 5, 6, 0].map((d) => {
          const on = weekdays.includes(d);
          return (
            <button
              key={d}
              type="button"
              aria-pressed={on}
              onClick={() => setWeekdays((prev) => (on ? prev.filter((x) => x !== d) : [...prev, d]))}
              className={`grid h-10 w-10 place-items-center rounded-full text-[15px] font-semibold transition-colors active:scale-95 ${
                on
                  ? "bg-[var(--tint)] text-white"
                  : `bg-[var(--fill)] ${d === 0 ? "text-[var(--accent)]" : d === 6 ? "text-[var(--info)]" : ""}`
              }`}
            >
              {WEEKDAY[d]}
            </button>
          );
        })}
      </div>
      {/* 付ける印。意味はここに書く (コマには印だけが出る) */}
      <div role="radiogroup" aria-label="付ける印" className="grid grid-cols-4 gap-2">
        {(["ok", "maybe", "no", "none"] as const).map((value) => {
          const on = mark === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setMark(value)}
              className={`flex h-12 flex-col items-center justify-center rounded-xl leading-tight transition-colors active:scale-[0.97] ${
                on ? PEN_STYLE[value].on : "bg-[var(--fill)]"
              }`}
            >
              <span className={`text-[17px] font-bold ${on ? "" : PEN_STYLE[value].mark}`}>
                {ANSWER_STYLE[value].label}
              </span>
              <span className="text-[11px]">{PEN_STYLE[value].label}</span>
            </button>
          );
        })}
      </div>
      {/* 押すと何が起きるかをボタンの文字で示す。主ボタンほど目立たせない (v1.40) */}
      <button
        type="button"
        onClick={apply}
        className="flex h-11 w-full items-center justify-center gap-1 rounded-xl bg-[var(--fill)] text-[15px] font-semibold text-[var(--tint)] active:opacity-70"
      >
        {target}を<span className="text-[17px]">{ANSWER_STYLE[mark].label}</span>にする
      </button>
    </section>
  );
}

// ---------- 集計と割り振り (§6.8.3。折衝・3役だけ) ----------

export function SchedulePlanClient({
  initialInput,
  round,
  canPlan,
  me,
  storageKey,
}: {
  initialInput: PlanInput;
  round: ScheduleRound;
  /** 折衝・3役か。違えば中身を出さない (計算の API 側でも同じ権限を確かめる) */
  canPlan: boolean;
  /** 見ている人と、その人が回答の画面で端末に保存した回答の鍵 (デモ環境。v1.35) */
  me?: string;
  storageKey?: string;
}) {
  const [input, setInput] = useState(initialInput);
  useEffect(() => {
    const saved = readSavedAnswers(storageKey);
    if (saved && me) setInput((prev) => ({ ...prev, answers: { ...prev.answers, [me]: saved } }));
  }, [storageKey, me]);
  if (!canPlan) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10 text-center text-[15px] text-[var(--muted)]">
        折衝と3役だけが使える画面です
      </main>
    );
  }
  return (
    <main className="mx-auto max-w-3xl space-y-4 px-4 py-3">
      <h1 className="text-[28px] font-bold leading-tight">
        {parseDate(round.month).month}月の割り振り
      </h1>
      <PlanPanel input={input} round={round} />
    </main>
  );
}

/**
 * 下書きを作ったあとに呼ぶ (折衝ワークフローの中で使うとき。v1.43)。
 * 無ければ折衝の ③ 割り振りへ移る
 */
export const DraftDoneContext = createContext<((month: string) => void) | null>(null);

export function PlanPanel({
  input,
  round,
  showStats = true,
}: {
  input: PlanInput;
  round: ScheduleRound;
  /** 回答した人・締切・予約したコマ。折衝の画面は手順のボタンに出すので出さない (v1.47) */
  showStats?: boolean;
}) {
  const [settings, setSettings] = useState<PlanSettings>(() => ({
    ...DEFAULT_SETTINGS,
    perGenre: defaultPerGenre(input),
  }));
  const [result, setResult] = useState<PlanResult | null>(null);
  const [pending, setPending] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);

  const answered = input.members.filter((m) => Object.keys(input.answers[m.id] ?? {}).length > 0).length;
  const total = input.candidates.length;
  const genres = input.genres.length;
  const maxPerGenre = Math.floor(total / genres);
  const used = Math.min(total, settings.perGenre * genres);

  async function run() {
    setPending(true);
    setError(null);
    setElapsed(0);
    const started = Date.now();
    const timer = window.setInterval(() => setElapsed((Date.now() - started) / 1000), 200);
    try {
      const res = await fetch("/api/schedule/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // DB のある環境では、サーバーが月から回答を読み直す (v1.44)
        body: JSON.stringify({ input, settings, month: round.month }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? "計算できませんでした。");
        return;
      }
      setResult(body as PlanResult);
    } catch {
      setError("通信できませんでした。電波の良いところでもう一度押してください。");
    } finally {
      window.clearInterval(timer);
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      {showStats ? (
      <div className="grid grid-cols-3 gap-2">
        <Stat label="回答した人" value={`${answered}/${input.members.length}`} />
        {round.id ? (
          <Stat
            label="締切"
            sub={formatDateLabel(round.deadline)}
            value={(() => {
              const days = daysBetween(todayInTokyo(), round.deadline);
              return days < 0 ? "締切済み" : days === 0 ? "今日" : `あと${days}日`;
            })()}
          />
        ) : (
          // 日程調整をしていない月 (v1.45)。全員 ○ として割り振る
          <Stat label="日程調整" value="なし" sub="全員 ○ で計算" />
        )}
        <Stat label="予約したコマ" value={`${total}`} />
      </div>
      ) : null}

      <section className={`${groupClass} space-y-4 p-4`}>
        <h2 className="text-[17px] font-bold">各ジャンルのコマ数</h2>
        <div className="flex items-center justify-center gap-4">
          <StepButton label="減らす" onClick={() => setSettings({ ...settings, perGenre: Math.max(0, settings.perGenre - 1) })}>−</StepButton>
          <p className="min-w-[96px] text-center">
            <RollingNumber value={settings.perGenre} className="text-[34px] font-bold tabular-nums" />
            <span className="text-[16px]"> コマ</span>
          </p>
          <StepButton label="増やす" onClick={() => setSettings({ ...settings, perGenre: Math.min(maxPerGenre, settings.perGenre + 1) })}>＋</StepButton>
        </div>
        {/* 使うコマ / 予約したコマ を棒で見せる */}
        <div>
          <div className="h-2.5 overflow-hidden rounded-full bg-[var(--fill)]">
            <div
              className="h-full rounded-full bg-[var(--tint)] transition-[width] duration-300"
              style={{ width: `${(used / total) * 100}%` }}
            />
          </div>
          <p className="mt-1 text-[13px] text-[var(--muted)] tabular-nums">
            {genres}ジャンル × {settings.perGenre} = {used}コマを使う・空き {total - used}コマ
          </p>
        </div>

        <button
          type="button"
          onClick={() => setAdvanced((v) => !v)}
          aria-expanded={advanced}
          className="flex h-11 w-full items-center justify-between gap-3 rounded-xl bg-[var(--fill)] px-3 text-[15px]"
        >
          <span className="shrink-0">詳細設定</span>
          <span className="flex min-w-0 items-center gap-2 text-[13px] text-[var(--muted)]">
            <span className="truncate">{advanced ? null : summaryOf(settings)}</span>
            <svg viewBox="0 0 14 8" width="12" height="8" aria-hidden className={`shrink-0 transition-transform ${advanced ? "rotate-180" : ""}`}>
              <path d="M1 1l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          </span>
        </button>
        {advanced ? (
          <div className="space-y-4">
            <Choice
              label="同じジャンルの1日の上限"
              hint="2コマ以上入れる日は、必ず時間を続けます。"
              value={settings.maxPerDay}
              options={[
                { value: 1, label: "1コマ" },
                { value: 2, label: "2コマ" },
                { value: 3, label: "3コマ" },
              ]}
              onChange={(maxPerDay) => setSettings({ ...settings, maxPerDay })}
            />
            <Choice
              label="続けて入れるときの部屋"
              value={settings.sameRoomBonus}
              options={[
                { value: 0, label: "気にしない" },
                { value: 2, label: "できれば同じ" },
                { value: 5, label: "なるべく同じ" },
              ]}
              onChange={(sameRoomBonus) => setSettings({ ...settings, sameRoomBonus })}
            />
            <Choice
              label="欠席の偏り"
              hint="特定の曜日しか空いていない人が、毎回欠席になる案を避けます。"
              value={settings.fairnessWeight}
              options={[
                { value: 0, label: "気にしない" },
                { value: learned.fairnessWeight || 1, label: "ふつう" },
                { value: Math.max(4, (learned.fairnessWeight || 1) * 3), label: "強く" },
              ]}
              onChange={(fairnessWeight) => setSettings({ ...settings, fairnessWeight })}
            />
            <Choice
              label="広い部屋での通し練習"
              value={settings.minBigPerGenre}
              options={[
                { value: 0, label: "決めない" },
                { value: 1, label: "月1回" },
                { value: 2, label: "月2回" },
              ]}
              onChange={(minBigPerGenre) => setSettings({ ...settings, minBigPerGenre })}
            />
            <RoomSizes
              roomIds={[...new Set(input.candidates.map((c) => c.roomId))].sort((a, b) => a - b)}
              value={settings.roomWeights}
              onChange={(roomWeights) => setSettings({ ...settings, roomWeights })}
            />
            <Choice
              label="△ (できれば避けたい) の数え方"
              value={settings.maybeWeight}
              options={[
                { value: 0, label: "数えない" },
                { value: 0.5, label: "半分" },
                { value: 1, label: "○と同じ" },
              ]}
              onChange={(maybeWeight) => setSettings({ ...settings, maybeWeight })}
            />
            <Choice
              label="2・3ジャンの人の数え方"
              value={settings.genreWeights[1]}
              options={[
                { value: 1, label: "同じ" },
                { value: 0.7, label: "少し軽く" },
                { value: 0.5, label: "かなり軽く" },
              ]}
              onChange={(w) =>
                setSettings({ ...settings, genreWeights: [1, w, w === 1 ? 1 : w === 0.7 ? 0.5 : 0.3] })
              }
            />
            <Choice
              label="人が少ないコマに印を付ける"
              hint="見込みがこの人数に届かないコマを、赤い枠で示します。"
              value={settings.minPeople}
              options={[
                { value: 0, label: "付けない" },
                { value: 5, label: "5人未満" },
                { value: 8, label: "8人未満" },
                { value: 10, label: "10人未満" },
              ]}
              onChange={(minPeople) => setSettings({ ...settings, minPeople })}
            />
          </div>
        ) : null}

        <button type="button" onClick={run} disabled={pending} className={primaryButtonClass}>
          {pending ? "計算しています…" : result ? "条件を変えて作り直す" : "案を作る"}
        </button>
        {pending ? <Progress elapsed={elapsed} limit={settings.timeLimitSeconds} /> : null}
        <ErrorMessage>{error}</ErrorMessage>
      </section>

      {result && !pending ? (
        <ResultView input={input} result={result} settings={settings} month={round.month} />
      ) : null}
    </div>
  );
}

function summaryOf(settings: PlanSettings): string {
  const maybe = settings.maybeWeight === 0 ? "△数えない" : settings.maybeWeight === 1 ? "△=○" : "△半分";
  const sub = settings.genreWeights[1] === 1 ? "2ジャン同じ" : settings.genreWeights[1] === 0.7 ? "2ジャン少し軽く" : "2ジャンかなり軽く";
  const room = settings.sameRoomBonus === 0 ? "部屋気にしない" : "部屋そろえる";
  const fair = settings.fairnessWeight === 0 ? "" : "・偏りを抑える";
  const big = settings.minBigPerGenre ? `・広い部屋 月${settings.minBigPerGenre}回` : "";
  return `1日${settings.maxPerDay}コマまで・${room}${fair}${big}・${maybe}・${sub}`;
}

/**
 * 練習場所の広さ (v1.32.3)。広い部屋ほど、人が多く集まるジャンルに回りやすくなる。
 * 部屋ごとに 狭い / 普通 / 広い を選ぶ
 */
function RoomSizes({
  roomIds,
  value,
  onChange,
}: {
  roomIds: number[];
  value: Record<number, number>;
  onChange: (value: Record<number, number>) => void;
}) {
  const options = (["small", "normal", "large"] as const).map((size) => ({
    value: sizeWeight(size, learned.roomStrength),
    label: size === "small" ? "狭い" : size === "large" ? "広い" : "普通",
  }));
  return (
    <div className="space-y-1.5">
      <p className="text-[15px] font-semibold">練習場所の広さ</p>
      <ul className="divide-y divide-[var(--separator)] rounded-xl bg-[var(--fill)]">
        {roomIds.map((roomId) => {
          const current = value[roomId] ?? 1;
          return (
            <li key={roomId} className="flex items-center gap-2 py-1.5 pl-3 pr-1.5">
              <span className="min-w-0 flex-1 truncate text-[15px]">
                {(ROOM_BY_ID.get(roomId)?.name ?? "?").replace(/[(（][^)）]*[)）]$/, "")}
              </span>
              <span className="flex shrink-0 gap-1">
                {options.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    aria-pressed={current === o.value}
                    onClick={() => onChange({ ...value, [roomId]: o.value })}
                    className={`h-9 rounded-full px-3 text-[14px] transition-colors ${
                      current === o.value
                        ? "bg-[var(--tint)] font-semibold text-white"
                        : "text-[var(--foreground)]"
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="text-[13px] text-[var(--muted)]">広い部屋ほど、人の多いジャンルに回りやすくなります。</p>
    </div>
  );
}

/** 選択肢のボタン (Segmented) に見出しと説明を付けたもの */
function Choice<T extends number>({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string;
  hint?: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-[15px] font-semibold">{label}</p>
      <Segmented
        label={label}
        value={String(value)}
        size="large"
        options={options.map((o) => ({ value: String(o.value), label: o.label }))}
        onChange={(v) => onChange(Number(v) as T)}
      />
      {hint ? <p className="text-[13px] text-[var(--muted)]">{hint}</p> : null}
    </div>
  );
}

/**
 * 計算中の表示 (v1.32.2)。1回の問い合わせなので本当の進み具合は分からないが、
 * 経過秒数と、時間に応じた段階を出して「動いている」ことを見せる
 */
function Progress({ elapsed, limit }: { elapsed: number; limit: number }) {
  const ref = useRef<HTMLDivElement>(null);
  // 下のタブバーに隠れないよう、出たときに画面の中ほどへ送る
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, []);
  const steps = ["回答を集計しています", "割り振りを計算しています", "結果をまとめています"];
  const step = elapsed < 0.8 ? 0 : elapsed < limit * 0.8 ? 1 : 2;
  return (
    <div ref={ref} className="space-y-2 rounded-xl bg-[var(--fill)] p-3" role="status" aria-live="polite">
      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--cell)]">
        <div className="progress-indeterminate h-full w-1/3 rounded-full bg-[var(--tint)]" />
      </div>
      <ol className="space-y-1 text-[14px]">
        {steps.map((text, i) => (
          <li key={text} className={`flex items-center gap-2 ${i > step ? "text-[var(--muted)]" : ""}`}>
            <span aria-hidden className="w-4 text-center">
              {i < step ? "✓" : i === step ? "●" : "○"}
            </span>
            {text}
          </li>
        ))}
      </ol>
      <p className="text-[13px] text-[var(--muted)] tabular-nums">
        {elapsed.toFixed(0)}秒経過・ふつう5〜20秒(最大{limit}秒)
      </p>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl bg-[var(--cell)] px-3 py-2.5">
      <p className="text-[13px] text-[var(--muted)]">{label}</p>
      <p className="text-[17px] font-bold tabular-nums">{value}</p>
      {sub ? <p className="text-[12px] text-[var(--muted)] tabular-nums">{sub}</p> : null}
    </div>
  );
}

function StepButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="grid h-12 w-12 place-items-center rounded-full bg-[var(--fill)] text-[22px] text-[var(--tint)] active:opacity-60"
    >
      {children}
    </button>
  );
}

function ResultView({
  input,
  result,
  settings,
  month,
}: {
  input: PlanInput;
  result: PlanResult;
  settings: PlanSettings;
  /** 案を下書きにする月 */
  month: string;
}) {
  const genreCode = new Map(input.genres.map((g) => [g.id, g.code]));
  const byCandidate = new Map(result.assignments.map((a) => [a.candidateId, a]));
  const dates = [...new Set(input.candidates.map((c) => c.date))].sort();
  const below = result.assignments.filter((a) => a.belowMin).length;
  const overlaps = result.assignments.filter((a) => a.lostToOverlap > 0).length;

  const byIdAll = new Map(input.candidates.map((c) => [c.id, c]));
  const bigCount = (genreId: number) =>
    result.assignments.filter(
      (a) => a.genreId === genreId && isBigRoom(settings, byIdAll.get(a.candidateId)!.roomId),
    ).length;

  if (result.status === "infeasible" || result.status === "error") {
    return <ErrorMessage>{result.message ?? "計算できませんでした"}</ErrorMessage>;
  }

  return (
    <div className="space-y-4">
      <section className={`${groupClass} space-y-3 p-4`}>
        <div className="flex items-baseline justify-between gap-2">
          {/* 計算中の印から、できあがりのチェックへ (§12「動き」/ v1.36) */}
          <h2 className="flex items-center gap-1.5 text-[17px] font-bold">
            <CheckMark size={20} className="text-[#34c759]" />案
          </h2>
          <span className="text-[13px] text-[var(--muted)] tabular-nums">
            {result.status === "optimal" ? "最適(差 0.5% 以内)" : "制限時間内で一番良い案"} ・ {(result.elapsedMs / 1000).toFixed(1)}秒
          </span>
        </div>
        <ul className="grid grid-cols-3 gap-2">
          {result.perGenre.map((g, i) => {
            const code = genreCode.get(g.genreId) ?? "?";
            const color = GENRE_COLORS[code as GenreCode];
            return (
              // ジャンルごとのカードを少しずつずらして順に出す (§12「動き」/ v1.36)
              <li
                key={g.genreId}
                className="rise-in rounded-lg px-2 py-1.5"
                style={{ backgroundColor: color?.bg, color: color?.fg, ["--i" as string]: i }}
              >
                <span className="block text-[13px] font-bold">{code}</span>
                <span className="block text-[12px] opacity-90 tabular-nums">
                  {g.slots}コマ・平均{g.slots ? (g.expected / g.slots).toFixed(1) : "0"}人
                </span>
                <span className="block text-[11px] opacity-90 tabular-nums">
                  広い部屋 {bigCount(g.genreId)}回
                </span>
              </li>
            );
          })}
        </ul>
        {result.message ? (
          <p className="rounded-lg bg-[var(--fill)] px-3 py-2 text-[14px]">{result.message}</p>
        ) : null}
        <Scorecard metrics={measure(input, settings, result)} />
        <p className="text-[14px] text-[var(--muted)]">
          {below > 0 ? `人数の基準に届かないコマ ${below}件(赤い枠)。` : ""}
          {overlaps > 0 ? `1ジャンと2・3ジャンが重なったコマ ${overlaps}件(「重なり」)。` : "1ジャンと2・3ジャンの重なりはありません。"}
        </p>
        <DraftButton input={input} result={result} month={month} />
      </section>

      {dates.map((date) => (
        <DateGrid
          key={date}
          date={date}
          candidates={input.candidates.filter((c) => c.date === date)}
          byCandidate={byCandidate}
          genreCode={genreCode}
          maybeWeight={settings.maybeWeight}
        />
      ))}
    </div>
  );
}

/**
 * 案をコマ割りの下書きにする (§6.8.4 / v1.36)。その月の公開していないコマを
 * 消してから作るので、押す前に確かめる。作ったら折衝ワークフローの②へ移る
 */
function DraftButton({ input, result, month }: { input: PlanInput; result: PlanResult; month: string }) {
  const router = useRouter();
  const onDone = useContext(DraftDoneContext);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const byId = new Map(input.candidates.map((c) => [c.id, c]));
  const slots = result.assignments.map((a) => {
    const c = byId.get(a.candidateId)!;
    return { date: c.date, roomId: c.roomId, startTime: c.startTime, endTime: c.endTime, genreId: a.genreId };
  });
  const monthLabel = `${Number(month.slice(5, 7))}月`;

  async function makeDraft() {
    if (
      !(await confirmAction({
        message: `${monthLabel}の公開していないコマを消して、この案のコマ ${slots.length}件を下書きで作ります。`,
        confirmLabel: "下書きを作る",
        destructive: true,
      }))
    ) {
      return;
    }
    setPending(true);
    setError(null);
    const res = await fetch("/api/schedule/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ month, slots }),
    }).catch(() => null);
    const body = await res?.json().catch(() => null);
    setPending(false);
    if (!res?.ok) {
      setError(body?.error ?? "下書きを作れませんでした。");
      return;
    }
    showToast(`${monthLabel}の下書きを ${body.created}コマ作りました`);
    if (onDone) onDone(month);
    else router.push(`/coordinator?month=${month}&step=allocate`);
  }

  return (
    <div className="space-y-2">
      <button type="button" onClick={makeDraft} disabled={pending} className={primaryButtonClass}>
        {pending ? "作っています…" : "この案でコマ割りの下書きを作る"}
      </button>
      <ErrorMessage>{error}</ErrorMessage>
    </div>
  );
}

/** 案の採点 (§6.8.6)。条件の学習と同じ物差しで、この案がどうだったかを出す */
function Scorecard({ metrics }: { metrics: PlanMetrics }) {
  const items = [
    { label: "参加率", value: `${(metrics.participation * 100).toFixed(0)}%`, hint: "1ジャンの練習に出られる割合の平均" },
    { label: "出にくい人", value: `${(metrics.bottom10 * 100).toFixed(0)}%`, hint: "下位1割の人の参加率" },
    { label: "広い部屋", value: `最少${metrics.minBigRooms}回`, hint: "一番少ないジャンルの回数" },
  ];
  return (
    <ul className="grid grid-cols-3 gap-2">
      {items.map((item) => (
        <li key={item.label} title={item.hint} className="rounded-lg bg-[var(--fill)] px-2.5 py-2">
          <span className="block text-[12px] text-[var(--muted)]">{item.label}</span>
          <span className="block text-[18px] font-bold tabular-nums">{item.value}</span>
        </li>
      ))}
    </ul>
  );
}

/** 1日ぶんのコマ割り表。建物ごとに、行 = コマの時間、列 = 部屋 (画像のコマ割り表と同じ形) */
function DateGrid({
  date,
  candidates,
  byCandidate,
  genreCode,
  maybeWeight,
}: {
  date: string;
  candidates: Candidate[];
  byCandidate: Map<string, PlanResult["assignments"][number]>;
  genreCode: Map<number, string>;
  maybeWeight: number;
}) {
  const sections = [...new Set(candidates.map((c) => c.section))];
  return (
    <section>
      <GroupHeader>{formatDateLabel(date)}</GroupHeader>
      <div className="space-y-2">
        {sections.map((section) => {
          const list = candidates.filter((c) => c.section === section);
          const rooms = [...new Set(list.map((c) => c.roomId))].sort((a, b) => a - b);
          const times = [...new Set(list.map((c) => `${c.startTime}〜${c.endTime}`))].sort();
          return (
            <div key={section} className="overflow-hidden rounded-xl bg-[var(--cell)]">
              <table className="w-full table-fixed text-[13px]">
                <thead>
                  <tr className="text-[var(--muted)]">
                    <th className="w-[92px] px-2 py-1.5 text-left font-semibold">{section}</th>
                    {rooms.map((roomId) => (
                      <th key={roomId} className="px-1 py-1.5 font-normal">
                        {(ROOM_BY_ID.get(roomId)?.name ?? "?").replace(/[(（][^)）]*[)）]$/, "")}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {times.map((range) => (
                    <tr key={range} className="border-t border-[var(--separator)]">
                      <td className="px-2 py-1 tabular-nums text-[var(--muted)]">{range}</td>
                      {rooms.map((roomId) => {
                        const c = list.find((x) => x.roomId === roomId && `${x.startTime}〜${x.endTime}` === range);
                        if (!c) return <td key={roomId} />;
                        const a = byCandidate.get(c.id);
                        if (!a) {
                          return (
                            <td key={roomId} className="px-1 py-1 text-center text-[var(--muted)]">
                              ○
                            </td>
                          );
                        }
                        const code = genreCode.get(a.genreId) ?? "?";
                        const color = GENRE_COLORS[code as GenreCode];
                        return (
                          <td key={roomId} className="p-0.5">
                            <div
                              className={`rounded-md px-1 py-0.5 text-center leading-tight ${a.belowMin ? "ring-2 ring-[var(--danger-solid)]" : ""}`}
                              style={{ backgroundColor: color?.bg, color: color?.fg }}
                            >
                              <span className="block font-bold">{code}</span>
                              <span className="block text-[11px] tabular-nums opacity-90">
                                ○{a.ok} △{a.maybe} ≒{(a.ok + a.maybe * maybeWeight).toFixed(0)}人
                              </span>
                              {a.lostToOverlap > 0 ? (
                                <span className="block text-[10px]">重なり −{a.lostToOverlap}</span>
                              ) : null}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </section>
  );
}

