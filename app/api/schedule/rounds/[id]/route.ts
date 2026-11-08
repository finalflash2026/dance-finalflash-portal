import { z } from "zod";

import { requireRole } from "@/lib/auth/guard";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * PATCH /api/schedule/rounds/[id]  (SPEC.md §6.8.5 / v1.44)
 *
 * 締め切る・受付を戻す・締切を変える。**折衝・3役だけ**。
 */
export const runtime = "nodejs";

const schema = z
  .object({
    status: z.enum(["open", "closed"]).optional(),
    deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .refine((v) => v.status || v.deadline, "変える内容がありません");

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireRole("coordinator");
  if (guard instanceof Response) return guard;

  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "入力が正しくありません。" }, { status: 400 });
  }

  const { error } = await createAdminClient().from("schedule_rounds").update(parsed.data).eq("id", id);
  if (error) {
    return Response.json({ error: `変えられませんでした: ${error.message}` }, { status: 500 });
  }
  return Response.json({ ok: true });
}
