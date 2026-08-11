import { SignupForm } from "./SignupForm";

/**
 * サインアップ (SPEC.md §3.2)
 *
 * Supabase の一般サインアップは無効化してあるため、登録は必ず
 * POST /api/auth/signup を経由する (合言葉の検証を強制するため)。
 */
export default function SignupPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">新規登録</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          サークル生合言葉が必要です
        </p>
      </header>
      <SignupForm />
    </div>
  );
}
