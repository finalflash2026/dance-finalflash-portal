import { z } from "zod";

import { dummyEmail } from "@/lib/auth/email";
import { hasSupabaseEnv } from "@/lib/env";
import { clientIp, hitRateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/auth/login  (SPEC.md §8.2 / §3.3)
 *
 * このサイトはメールアドレスを持たないため、username からダミーメールを
 * **再合成**して signInWithPassword する (合成規則は §3.2 と同じ)。
 *
 * 失敗時のメッセージは理由によらず「IDまたはパスワードが違います」で統一する。
 * 「そのIDは存在しません」と返すと、ユーザーの在籍を外部から探れてしまうため。
 */
export const runtime = "nodejs";

const LOGIN_ERROR = "IDまたはパスワードが違います";

const schema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1),
});

const TOO_MANY = "試行回数が多すぎます。しばらく待ってからやり直してください";

export async function POST(request: Request) {
  if (!hasSupabaseEnv()) {
    return Response.json(
      { error: "サーバーの設定が未完了です(Supabase 未接続)。" },
      { status: 503 },
    );
  }

  // 試行回数の制限は DB で数える (§13.2 / v1.31.4)。IP ごと 10回/分
  if (!(await hitRateLimit(`login:ip:${clientIp(request)}`, 10, 60_000))) {
    return Response.json({ error: TOO_MANY }, { status: 429 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: LOGIN_ERROR }, { status: 401 });
  }

  // **ユーザーIDごとにも数える** (10回/10分)。IP を変えながら1人を狙う総当たりを止める
  if (
    !(await hitRateLimit(
      `login:user:${parsed.data.username.toLowerCase()}`,
      10,
      10 * 60_000,
    ))
  ) {
    return Response.json({ error: TOO_MANY }, { status: 429 });
  }

  // createClient のセッション書き込みで cookie がセットされる
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: dummyEmail(parsed.data.username),
    password: parsed.data.password,
  });

  if (error) {
    return Response.json({ error: LOGIN_ERROR }, { status: 401 });
  }

  return Response.json({ ok: true });
}
