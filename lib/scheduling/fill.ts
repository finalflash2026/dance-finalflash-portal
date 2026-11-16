import { keyOf } from "./plan";
import type { Answer, AnswerKey, PlanInput } from "./types";

/**
 * 回答の無い人を「全部 ○」として埋める (SPEC.md §6.2 / v1.45)。
 *
 * 日程調整をしない月でも自動で割り振れるように。回答した人の回答はそのまま使う。
 * 埋めるのは計算の直前だけで、画面の「回答した人」には数えない。
 */
export function fillUnanswered(input: PlanInput): PlanInput {
  const answers: PlanInput["answers"] = { ...input.answers };
  for (const member of input.members) {
    if (Object.keys(answers[member.id] ?? {}).length > 0) continue;
    const all: Partial<Record<AnswerKey, Answer>> = {};
    for (const candidate of input.candidates) all[keyOf(candidate)] = "ok";
    answers[member.id] = all;
  }
  return { ...input, answers };
}
