/**
 * 未ログイン時の共通レイアウト (/login, /signup)。
 * タブバーは出さない。
 */
export default function PublicLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-dvh flex-col justify-center">
      <main className="mx-auto w-full max-w-sm px-6 py-10">{children}</main>
    </div>
  );
}
