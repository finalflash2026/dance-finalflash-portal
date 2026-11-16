import { AdminClient, type AdminUser } from "../../admin/AdminClient";
import { demoRows } from "@/lib/supabase/demo-data";

/** 管理者画面のデモ (SPEC §14.1 / v1.31.13)。見本の名簿で開く。保存はされない */
export default function DemoAdmin() {
  const users: AdminUser[] = demoRows("profiles").map((row) => ({
    userId: row.user_id as string,
    username: row.username as string,
    generation: row.generation as number,
    mainGenreId: row.main_genre_id as number,
    displayName: row.display_name as string,
    role: row.role as AdminUser["role"],
  }));
  return <AdminClient currentUserId={users[0]?.userId ?? ""} initialUsers={users} loadError={null} />;
}
