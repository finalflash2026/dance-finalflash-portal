"use client";

import { useMemo, useState } from "react";

import { ErrorMessage, GroupHeader, Segmented, groupClass, primaryButtonClass } from "@/components/ui";
import { GENRE_COLORS, ROOM_BY_ID, type GenreCode } from "@/lib/constants";
import { BAND_LABELS, DEFAULT_SETTINGS, answerKey, bandOf, defaultPerGenre } from "@/lib/scheduling/plan";
import type {
  Answer,
  AnswerKey,
  Band,
  Candidate,
  PlanInput,
  PlanResult,
  PlanSettings,
} from "@/lib/scheduling/types";
import { formatDateLabel, getWeekday } from "@/lib/time";

/**
 * 日程調整からのコマ割り (SPEC.md §6.8.4 / v1.32 デモ)
 *
 * 「回答する」はメンバーの画面の見本、「集計と割り振り」は折衝・3役の画面。
 * いまは見本のデータ (150人・来月の予約枠) で動き、保存はされない。
 */
export function ScheduleClient({ initialInput, me }: { initialInput: PlanInput; me: string }) {
  const [tab, setTab] = useState<"answer" | "plan">("plan");
  const [input, setInput] = useState(initialInput);

  return (
    <main className="mx-auto max-w-3xl space-y-4 px-4 py-3">
      <h1 className="text-[28px] font-bold leading-tight">日程調整</h1>
      <p className="rounded-xl bg-[var(--fill)] px-3 py-2 text-[14px] text-[var(--muted)]">
        見本のデータ (150人・来月の予約枠) で動くお試し版です。保存はされません。
      </p>
      <Segmented
        label="画面"
        value={tab}
        onChange={setTab}
        size="large"
        options={[
          { value: "answer", label: "回答する (メンバー)" },
          { value: "plan", label: "集計と割り振り" },
        ]}
      />
      {tab === "answer" ? (
        <AnswerPanel
          input={input}
          me={me}
          onChange={(answers) =>
            setInput((prev) => ({ ...prev, answers: { ...prev.answers, [me]: answers } }))
          }
        />
      ) : (
        <PlanPanel input={input} />
      )}
    </main>
  );
}

// ---------- 回答する (§6.8.2) ----------

const ANSWER_STYLE: Record<Answer | "none", { label: string; className: string }> = {
  ok: { label: "○", className: "bg-[#34c759] text-white" },
  maybe: { label: "△", className: "bg-[#ff9f0a] text-white" },
  no: { label: "×", className: "bg-[var(--muted)] text-white opacity-70" },
  none: { label: "−", className: "bg-[var(--fill)] text-[var(--muted)]" },
};
const NEXT: Record<Answer | "none", Answer | undefined> = {
  none: "ok",
  ok: "maybe",
  maybe: "no",
  no: undefined,
};
const WEEKDAY = ["日", "月", "火", "水", "木", "金", "土"];

/** 回答する日と時間帯 (その日に練習場所を取っている時間帯だけ) */
function answerSlots(candidates: Candidate[]): { date: string; bands: Band[] }[] {
  const map = new Map<string, Set<Band>>();
  for (const c of candidates) {
    const set = map.get(c.date) ?? new Set<Band>();
    set.add(bandOf(c.startTime));
    map.set(c.date, set);
  }
  const order: Band[] = ["day", "evening", "night"];
  return [...map]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, set]) => ({ date, bands: order.filter((b) => set.has(b)) }));
}

function AnswerPanel({
  input,
  me,
  onChange,
}: {
  input: PlanInput;
  me: string;
  onChange: (answers: Partial<Record<AnswerKey, Answer>>) => void;
}) {
  const mine = input.answers[me] ?? {};
  const slots = useMemo(() => answerSlots(input.candidates), [input.candidates]);
  const member = input.members.find((m) => m.id === me);

  function setMany(keys: AnswerKey[], value: Answer | undefined) {
    const next = { ...mine };
    for (const key of keys) {
      if (value) next[key] = value;
      else delete next[key];
    }
    onChange(next);
  }

  return (
    <div className="space-y-4">
      <div className={`${groupClass} space-y-2 p-4`}>
        <p className="text-[15px]">
          <b>{member?.name}</b> として回答します。押すたびに ○ → △ → × → 未回答 と変わります。
        </p>
        <ul className="space-y-1 text-[15px]">
          <li><span className="font-bold text-[#34c759]">○</span> 出られる</li>
          <li><span className="font-bold text-[#ff9f0a]">△</span> 出られるが、他の予定に響くのでできれば避けたい</li>
          <li><span className="font-bold text-[var(--muted)]">×</span> 出られない</li>
        </ul>
        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            className="h-10 rounded-full bg-[var(--fill)] px-4 text-[15px] font-semibold text-[var(--tint)]"
            onClick={() =>
              setMany(slots.flatMap((s) => s.bands.map((b) => answerKey(s.date, b))), "ok")
            }
          >
            全部○にする
          </button>
          {[1, 2, 3, 4, 5, 6, 0].map((wd) => (
            <button
              key={wd}
              type="button"
              className="h-10 rounded-full bg-[var(--fill)] px-3 text-[15px] text-[var(--tint)]"
              onClick={() =>
                setMany(
                  slots
                    .filter((s) => getWeekday(s.date) === wd)
                    .flatMap((s) => s.bands.map((b) => answerKey(s.date, b))),
                  "no",
                )
              }
            >
              {WEEKDAY[wd]}を×
            </button>
          ))}
        </div>
      </div>

      <ul className={groupClass}>
        {slots.map(({ date, bands }) => (
          <li key={date} className="flex items-center gap-3 px-4 py-2.5">
            <span
              className={`w-[88px] shrink-0 text-[16px] tabular-nums ${
                getWeekday(date) === 0
                  ? "text-[var(--accent)]"
                  : getWeekday(date) === 6
                    ? "text-[var(--info)]"
                    : ""
              }`}
            >
              {formatDateLabel(date)}
            </span>
            <span className="flex flex-1 flex-wrap justify-end gap-2">
              {bands.map((band) => {
                const key = answerKey(date, band);
                const value = mine[key] ?? "none";
                const style = ANSWER_STYLE[value];
                return (
                  <button
                    key={band}
                    type="button"
                    onClick={() => setMany([key], NEXT[value])}
                    aria-label={`${formatDateLabel(date)} ${BAND_LABELS[band]}`}
                    className="flex h-11 items-center gap-1.5 rounded-full bg-[var(--fill)] pl-3 pr-1.5 text-[14px]"
                  >
                    {BAND_LABELS[band]}
                    <span
                      className={`grid h-8 w-8 place-items-center rounded-full text-[17px] font-bold ${style.className}`}
                    >
                      {style.label}
                    </span>
                  </button>
                );
              })}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------- 集計と割り振り (§6.8.3) ----------

function PlanPanel({ input }: { input: PlanInput }) {
  const [settings, setSettings] = useState<PlanSettings>(() => ({
    ...DEFAULT_SETTINGS,
    perGenre: defaultPerGenre(input),
  }));
  const [result, setResult] = useState<PlanResult | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const answered = input.members.filter((m) => Object.keys(input.answers[m.id] ?? {}).length > 0).length;

  async function run() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/schedule/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input, settings }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? "計算できませんでした");
        return;
      }
      setResult(body as PlanResult);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <Stat label="回答した人" value={`${answered}/${input.members.length}`} />
        <Stat label="候補のコマ" value={`${input.candidates.length}コマ`} />
        <Stat label="ジャンル" value={`${input.genres.length}`} />
      </div>

      <section className={`${groupClass} space-y-4 p-4`}>
        <h2 className="text-[17px] font-bold">条件</h2>
        <NumberRow
          label="1ジャンルあたりのコマ数"
          hint={`各ジャンルはこの数か +1。最大 ${Math.floor(input.candidates.length / input.genres.length)}`}
          value={settings.perGenre}
          step={1}
          min={0}
          max={Math.floor(input.candidates.length / input.genres.length)}
          onChange={(perGenre) => setSettings({ ...settings, perGenre })}
        />
        <NumberRow
          label="△ の重み"
          hint="○ を 1 としたとき"
          value={settings.maybeWeight}
          step={0.1}
          min={0}
          max={1}
          onChange={(maybeWeight) => setSettings({ ...settings, maybeWeight })}
        />
        <NumberRow
          label="2ジャンの重み"
          hint="1ジャン = 1"
          value={settings.genreWeights[1]}
          step={0.1}
          min={0}
          max={1}
          onChange={(w) =>
            setSettings({ ...settings, genreWeights: [settings.genreWeights[0], w, settings.genreWeights[2]] })
          }
        />
        <NumberRow
          label="3ジャンの重み"
          hint="1ジャン = 1"
          value={settings.genreWeights[2]}
          step={0.1}
          min={0}
          max={1}
          onChange={(w) =>
            setSettings({ ...settings, genreWeights: [settings.genreWeights[0], settings.genreWeights[1], w] })
          }
        />
        <NumberRow
          label="人数の基準"
          hint="これに届かないコマに印を付ける (0 で付けない)"
          value={settings.minPeople}
          step={1}
          min={0}
          max={100}
          onChange={(minPeople) => setSettings({ ...settings, minPeople })}
        />
        <button type="button" onClick={run} disabled={pending} className={primaryButtonClass}>
          {pending ? "計算しています…" : "案を作る"}
        </button>
        <ErrorMessage>{error}</ErrorMessage>
      </section>

      {result ? <ResultView input={input} result={result} settings={settings} /> : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-[var(--cell)] px-3 py-2.5">
      <p className="text-[13px] text-[var(--muted)]">{label}</p>
      <p className="text-[17px] font-bold tabular-nums">{value}</p>
    </div>
  );
}

function NumberRow({
  label,
  hint,
  value,
  step,
  min,
  max,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  step: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v * 10) / 10));
  return (
    <div className="flex items-center gap-3">
      <span className="min-w-0 flex-1">
        <span className="block text-[16px]">{label}</span>
        <span className="block text-[13px] text-[var(--muted)]">{hint}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1">
        <StepButton label={`${label}を減らす`} onClick={() => onChange(clamp(value - step))}>−</StepButton>
        <span className="w-12 text-center text-[17px] font-semibold tabular-nums">{value}</span>
        <StepButton label={`${label}を増やす`} onClick={() => onChange(clamp(value + step))}>＋</StepButton>
      </span>
    </div>
  );
}

function StepButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="grid h-10 w-10 place-items-center rounded-full bg-[var(--fill)] text-[18px] text-[var(--tint)] active:opacity-60"
    >
      {children}
    </button>
  );
}

function ResultView({
  input,
  result,
  settings,
}: {
  input: PlanInput;
  result: PlanResult;
  settings: PlanSettings;
}) {
  const genreCode = new Map(input.genres.map((g) => [g.id, g.code]));
  const byCandidate = new Map(result.assignments.map((a) => [a.candidateId, a]));
  const dates = [...new Set(input.candidates.map((c) => c.date))].sort();
  const below = result.assignments.filter((a) => a.belowMin).length;
  const overlaps = result.assignments.filter((a) => a.lostToOverlap > 0).length;

  if (result.status === "infeasible" || result.status === "error") {
    return <ErrorMessage>{result.message ?? "計算できませんでした"}</ErrorMessage>;
  }

  return (
    <div className="space-y-4">
      <section className={`${groupClass} space-y-3 p-4`}>
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-[17px] font-bold">案</h2>
          <span className="text-[13px] text-[var(--muted)] tabular-nums">
            {result.status === "optimal" ? "最適" : "制限時間内で一番良い案"} ・ {(result.elapsedMs / 1000).toFixed(1)}秒
          </span>
        </div>
        <ul className="grid grid-cols-3 gap-2">
          {result.perGenre.map((g) => {
            const code = genreCode.get(g.genreId) ?? "?";
            const color = GENRE_COLORS[code as GenreCode];
            return (
              <li key={g.genreId} className="rounded-lg px-2 py-1.5" style={{ backgroundColor: color?.bg, color: color?.fg }}>
                <span className="block text-[13px] font-bold">{code}</span>
                <span className="block text-[12px] opacity-90 tabular-nums">
                  {g.slots}コマ・平均{g.slots ? (g.expected / g.slots).toFixed(1) : "0"}人
                </span>
              </li>
            );
          })}
        </ul>
        <p className="text-[14px] text-[var(--muted)]">
          {below > 0 ? `人数の基準に届かないコマ ${below}件 (赤い枠)。` : ""}
          {overlaps > 0 ? `1ジャンと2・3ジャンが重なったコマ ${overlaps}件 (「重なり」)。` : "1ジャンと2・3ジャンの重なりはありません。"}
        </p>
        <button type="button" disabled className={`${primaryButtonClass} opacity-50`}>
          この案で下書きに入れる (DB を作る段階で使えます)
        </button>
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
