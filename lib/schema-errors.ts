/**
 * 表・列・関数が DB に無いときのエラーか (SPEC.md §13.4 / v1.49)
 *
 * 本番の DB がまだ 0020〜0029 を流していない間は、新しい表を読むと
 * このエラーになる。読むだけの所は「無い」として空で返し、画面ごと止めない。
 */
export function isMissingRelation(
  error: { code?: string | null; message?: string | null } | null | undefined,
): boolean {
  if (!error) return false;
  return (
    error.code === "PGRST205" || // 表が無い (PostgREST)
    error.code === "PGRST202" || // 関数が無い (PostgREST)
    error.code === "PGRST204" || // 列が無い (PostgREST)
    error.code === "42P01" ||
    error.code === "42883" ||
    error.code === "42703" ||
    /does not exist|Could not find/i.test(error.message ?? "")
  );
}
