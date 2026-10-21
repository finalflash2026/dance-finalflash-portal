/**
 * 割り振りの計算 (SPEC.md §6.8.3)。
 *
 * **整数計画法で解く。** 変数は「ジャンル g をコマ k に入れるか」(0/1) だけで、
 * 人数は前もって点数の表にまとめる。150人いても変数の数は ジャンル × コマ のまま。
 *
 *   最大化  Σ 点数[g][k] · x[g][k]  −  Σ 重なりの減点 · y
 *   制約    1つのコマには1ジャンルまで
 *           各ジャンルのコマ数は N か N+1 (ほぼ平等)
 *           同じジャンルを同じ時間に2部屋に入れない
 *           y ≥ (ジャンル g がその時間にある) + (ジャンル h がその時間にある) − 1
 *
 * 「同じ時間」は、その日のコマの境目で区切った細かい時間 (区間) で数える。
 * 建物ごとにコマの長さが違う (70分・90分) ので、コマ単位では重なりを測れないため。
 *
 * ソルバーは外から渡す (HiGHS)。ここは LP の文字列を作って、答えを読むだけ。
 */
import { fromMinutes, toMinutes } from "@/lib/time";

import type {
  Answer,
  AnswerKey,
  Assignment,
  Band,
  Candidate,
  Member,
  PlanInput,
  PlanResult,
  PlanSettings,
} from "./types";

/** HiGHS の solve() の必要なところだけ */
export interface Solver {
  solve(
    lp: string,
    options?: Record<string, unknown>,
  ): {
    Status: string;
    /** 変数名 → { Primal: 値 }。解けなかったときは中身が違うので object で受ける */
    Columns: object;
  };
}

/** コマの開始時刻から回答の時間帯を決める (§6.8.2) */
export function bandOf(startTime: string): Band {
  const minutes = toMinutes(startTime);
  if (minutes < 16 * 60) return "day";
  if (minutes < 19 * 60) return "evening";
  return "night";
}

export const BAND_LABELS: Record<Band, string> = {
  day: "昼",
  evening: "夕方",
  night: "夜",
};

export function answerKey(date: string, band: Band): AnswerKey {
  return `${date}|${band}`;
}

/** 重なりの減点を測る長さの単位 (分)。おおよそ1コマの長さ */
const OVERLAP_UNIT_MINUTES = 90;

export const DEFAULT_SETTINGS: Omit<PlanSettings, "perGenre"> = {
  maybeWeight: 0.5,
  genreWeights: [1, 0.7, 0.5],
  minPeople: 0,
  timeLimitSeconds: 10,
};

/** 既定の「1ジャンルあたりのコマ数」。全部のコマをほぼ均等に分ける */
export function defaultPerGenre(input: PlanInput): number {
  return Math.floor(input.candidates.length / Math.max(1, input.genres.length));
}

function answerValue(answer: Answer | undefined, maybeWeight: number): number {
  if (answer === "ok") return 1;
  if (answer === "maybe") return maybeWeight;
  return 0;
}

/** メンバー m にとってのジャンル g の重み。取っていなければ 0 */
function genreWeight(member: Member, genreId: number, settings: PlanSettings): number {
  const rank = member.genres.indexOf(genreId);
  return rank === -1 ? 0 : (settings.genreWeights[rank] ?? 0);
}

/** その日のコマの境目で区切った区間。各区間にかかっているコマを持つ */
interface Piece {
  date: string;
  start: number;
  end: number;
  band: Band;
  candidateIds: string[];
}

export function piecesOf(candidates: Candidate[]): Piece[] {
  const byDate = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const list = byDate.get(c.date) ?? [];
    list.push(c);
    byDate.set(c.date, list);
  }
  const pieces: Piece[] = [];
  for (const [date, list] of [...byDate].sort(([a], [b]) => a.localeCompare(b))) {
    const bounds = [
      ...new Set(list.flatMap((c) => [toMinutes(c.startTime), toMinutes(c.endTime)])),
    ].sort((a, b) => a - b);
    for (let i = 0; i < bounds.length - 1; i++) {
      const [start, end] = [bounds[i], bounds[i + 1]];
      const covering = list.filter(
        (c) => toMinutes(c.startTime) <= start && toMinutes(c.endTime) >= end,
      );
      if (covering.length === 0) continue;
      pieces.push({
        date,
        start,
        end,
        band: bandOf(fromMinutes(start)),
        candidateIds: covering.map((c) => c.id).sort(),
      });
    }
  }
  return pieces;
}

/** 点数の表: score[genreId][candidateId] = 重み付きの見込み人数 */
export function scoreTable(
  input: PlanInput,
  settings: PlanSettings,
): Map<number, Map<string, number>> {
  const table = new Map<number, Map<string, number>>();
  for (const genre of input.genres) table.set(genre.id, new Map());
  for (const candidate of input.candidates) {
    const key = answerKey(candidate.date, bandOf(candidate.startTime));
    for (const member of input.members) {
      const value = answerValue(input.answers[member.id]?.[key], settings.maybeWeight);
      if (value === 0) continue;
      for (const genreId of member.genres) {
        const row = table.get(genreId);
        if (!row) continue;
        row.set(
          candidate.id,
          (row.get(candidate.id) ?? 0) + value * genreWeight(member, genreId, settings),
        );
      }
    }
  }
  return table;
}

/**
 * 重なりの減点: loss[g|h][date|band] = g と h が同じ時間にあると、
 * 優先度の低いほうに来られなくなる人数 (重み付き)
 */
function overlapLoss(input: PlanInput, settings: PlanSettings) {
  const loss = new Map<string, Map<AnswerKey, number>>();
  for (const member of input.members) {
    const genres = member.genres;
    if (genres.length < 2) continue;
    const answers = input.answers[member.id] ?? {};
    for (let hi = 0; hi < genres.length; hi++) {
      for (let lo = hi + 1; lo < genres.length; lo++) {
        const [a, b] = [genres[hi], genres[lo]].sort((x, y) => x - y);
        const pair = `${a}|${b}`;
        const row = loss.get(pair) ?? new Map<AnswerKey, number>();
        for (const [key, answer] of Object.entries(answers) as [AnswerKey, Answer][]) {
          const value = answerValue(answer, settings.maybeWeight);
          if (value === 0) continue;
          row.set(key, (row.get(key) ?? 0) + value * genreWeight(member, genres[lo], settings));
        }
        loss.set(pair, row);
      }
    }
  }
  return loss;
}

const fmt = (n: number) => Number(n.toFixed(4)).toString();

/** LP 形式 (CPLEX LP) の文字列を作る。変数名は x_g_k / y_n */
export function buildLp(input: PlanInput, settings: PlanSettings) {
  const genreIds = input.genres.map((g) => g.id);
  const index = new Map(input.candidates.map((c, i) => [c.id, i]));
  const x = (g: number, id: string) => `x_${g}_${index.get(id)}`;
  const scores = scoreTable(input, settings);
  const pieces = piecesOf(input.candidates);
  const loss = overlapLoss(input, settings);

  const objective: string[] = [];
  const constraints: string[] = [];
  const binaries: string[] = [];
  let yCount = 0;

  for (const g of genreIds) {
    for (const c of input.candidates) {
      const name = x(g, c.id);
      binaries.push(name);
      // 点数が 0 でも入れられるように、ごく小さな正の値を足す (コマ数の下限を満たすため)
      objective.push(`+ ${fmt((scores.get(g)?.get(c.id) ?? 0) + 0.001)} ${name}`);
    }
  }

  // 1つのコマには1ジャンルまで
  input.candidates.forEach((c, i) => {
    constraints.push(`one_${i}: ${genreIds.map((g) => x(g, c.id)).join(" + ")} <= 1`);
  });

  // 各ジャンルのコマ数は N か N+1
  for (const g of genreIds) {
    const sum = input.candidates.map((c) => x(g, c.id)).join(" + ");
    constraints.push(`min_${g}: ${sum} >= ${settings.perGenre}`);
    constraints.push(`max_${g}: ${sum} <= ${settings.perGenre + 1}`);
  }

  // 同じジャンルを同じ時間に2部屋に入れない。区間ごとに見る
  pieces.forEach((piece, p) => {
    if (piece.candidateIds.length < 2) return;
    for (const g of genreIds) {
      constraints.push(
        `same_${g}_${p}: ${piece.candidateIds.map((id) => x(g, id)).join(" + ")} <= 1`,
      );
    }
  });

  // 重なりの減点。y ≥ (g がこの区間にある) + (h がこの区間にある) − 1
  pieces.forEach((piece) => {
    if (piece.candidateIds.length < 2) return;
    const key = answerKey(piece.date, piece.band);
    const length = (piece.end - piece.start) / OVERLAP_UNIT_MINUTES;
    for (const [pair, row] of loss) {
      const weight = (row.get(key) ?? 0) * length;
      if (weight < 0.01) continue;
      const [g, h] = pair.split("|").map(Number);
      if (!genreIds.includes(g) || !genreIds.includes(h)) continue;
      const y = `y_${yCount++}`;
      objective.push(`- ${fmt(weight)} ${y}`);
      const terms = [
        ...piece.candidateIds.map((id) => `- ${x(g, id)}`),
        ...piece.candidateIds.map((id) => `- ${x(h, id)}`),
      ].join(" ");
      constraints.push(`ov_${yCount}: ${y} ${terms} >= -1`);
    }
  });

  const yNames = Array.from({ length: yCount }, (_, i) => `y_${i}`);
  const lp = [
    "Maximize",
    ` obj: ${objective.join(" ")}`,
    "Subject To",
    ...constraints.map((line) => ` ${line}`),
    "Bounds",
    ...yNames.map((y) => ` 0 <= ${y} <= 1`),
    "Binary",
    ` ${binaries.join(" ")}`,
    "End",
  ].join("\n");

  return {
    lp,
    variables: binaries.length + yCount,
    constraints: constraints.length,
    read: (raw: object) => {
      const columns = raw as Record<string, { Primal?: number }>;
      const picked: { candidateId: string; genreId: number }[] = [];
      for (const g of genreIds) {
        for (const c of input.candidates) {
          if ((columns[x(g, c.id)]?.Primal ?? 0) > 0.5) {
            picked.push({ candidateId: c.id, genreId: g });
          }
        }
      }
      return picked;
    },
  };
}

/**
 * 決まった割り振りの見込み人数を数える (画面に出す数字)。
 * 同じ時間に優先度の高い自分のジャンルが入っていたら、そちらへ行くものとして外す
 */
export function evaluate(
  input: PlanInput,
  settings: PlanSettings,
  picked: { candidateId: string; genreId: number }[],
): Assignment[] {
  const byId = new Map(input.candidates.map((c) => [c.id, c]));
  const overlaps = (a: Candidate, b: Candidate) =>
    a.date === b.date &&
    toMinutes(a.startTime) < toMinutes(b.endTime) &&
    toMinutes(b.startTime) < toMinutes(a.endTime);

  return picked.map(({ candidateId, genreId }) => {
    const candidate = byId.get(candidateId)!;
    const key = answerKey(candidate.date, bandOf(candidate.startTime));
    // 同じ時間に入っている他のジャンル
    const concurrent = new Set(
      picked
        .filter((p) => p.candidateId !== candidateId && overlaps(byId.get(p.candidateId)!, candidate))
        .map((p) => p.genreId),
    );
    let ok = 0;
    let maybe = 0;
    let lost = 0;
    for (const member of input.members) {
      const rank = member.genres.indexOf(genreId);
      if (rank === -1) continue;
      const answer = input.answers[member.id]?.[key];
      if (answer !== "ok" && answer !== "maybe") continue;
      const goesElsewhere = member.genres.slice(0, rank).some((g) => concurrent.has(g));
      if (goesElsewhere) {
        lost++;
        continue;
      }
      if (answer === "ok") ok++;
      else maybe++;
    }
    const expected = ok + maybe * settings.maybeWeight;
    return {
      candidateId,
      genreId,
      ok,
      maybe,
      lostToOverlap: lost,
      belowMin: settings.minPeople > 0 && expected < settings.minPeople,
    };
  });
}

/** 入力の検査。計算できない条件なら理由を返す */
export function validate(input: PlanInput, settings: PlanSettings): string | null {
  if (input.candidates.length === 0) return "候補のコマがありません";
  if (input.genres.length === 0) return "ジャンルがありません";
  if (settings.perGenre < 0) return "1ジャンルあたりのコマ数は 0 以上にしてください";
  if (settings.perGenre * input.genres.length > input.candidates.length) {
    return `コマが足りません (${input.genres.length}ジャンル × ${settings.perGenre} = ${
      input.genres.length * settings.perGenre
    } > ${input.candidates.length}コマ)`;
  }
  return null;
}

export function plan(input: PlanInput, settings: PlanSettings, solver: Solver): PlanResult {
  const started = Date.now();
  const empty = (status: PlanResult["status"], message: string): PlanResult => ({
    status,
    message,
    assignments: [],
    perGenre: [],
    elapsedMs: Date.now() - started,
    size: { variables: 0, constraints: 0 },
  });

  const invalid = validate(input, settings);
  if (invalid) return empty("infeasible", invalid);

  const model = buildLp(input, settings);
  let solution: ReturnType<Solver["solve"]>;
  try {
    solution = solver.solve(model.lp, {
      time_limit: settings.timeLimitSeconds,
      // 同じ入力からは同じ答えを出す
      random_seed: 0,
      output_flag: false,
    });
  } catch (cause) {
    return empty("error", cause instanceof Error ? cause.message : String(cause));
  }

  const status: PlanResult["status"] =
    solution.Status === "Optimal"
      ? "optimal"
      : solution.Status === "Time limit reached"
        ? "time-limit"
        : solution.Status === "Infeasible"
          ? "infeasible"
          : "error";
  if (status === "infeasible" || status === "error") {
    return {
      ...empty(status, status === "infeasible" ? "条件を満たす割り振りがありません。1ジャンルあたりのコマ数を減らしてください" : `計算できませんでした (${solution.Status})`),
      size: { variables: model.variables, constraints: model.constraints },
    };
  }

  const picked = model.read(solution.Columns);
  const assignments = evaluate(input, settings, picked);
  const perGenre = input.genres.map((genre) => {
    const mine = assignments.filter((a) => a.genreId === genre.id);
    return {
      genreId: genre.id,
      slots: mine.length,
      expected: mine.reduce((sum, a) => sum + a.ok + a.maybe * settings.maybeWeight, 0),
    };
  });

  return {
    status,
    assignments,
    perGenre,
    elapsedMs: Date.now() - started,
    size: { variables: model.variables, constraints: model.constraints },
  };
}
