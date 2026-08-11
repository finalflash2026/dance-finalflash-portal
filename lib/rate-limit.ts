/**
 * 簡易レート制限 (SPEC.md §8.1)
 *
 * 「同一IP 5回/分。簡易でよい(Upstash等は使わずメモリ+Vercelの制約で妥協可)」
 * という要件に対する最小実装。プロセスメモリに持つため、Vercel の
 * サーバーレス環境ではインスタンスをまたいで共有されない。
 * 総当たりを完全に止める仕組みではなく、素朴な連打を抑えるためのもの。
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/** 期限切れエントリを間引く (メモリリーク防止) */
function sweep(now: number) {
  if (buckets.size < 500) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

/**
 * @returns 許可なら true。上限超過なら false
 */
export function checkRateLimit(
  key: string,
  limit = 5,
  windowMs = 60_000,
): boolean {
  const now = Date.now();
  sweep(now);

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= limit) return false;

  bucket.count += 1;
  return true;
}

/** リクエストの発信元IP。Vercel では x-forwarded-for の先頭が実クライアント */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}
