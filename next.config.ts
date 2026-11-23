import type { NextConfig } from "next";

/**
 * セキュリティ用の応答ヘッダー (SPEC.md §13.2 / v1.31.4)。全ページに付ける。
 *
 * - X-Frame-Options / frame-ancestors … 他のサイトに埋め込ませない。見えない枠の上で
 *   「開けましたと報告する」などを押させる誤操作 (クリックジャッキング) を防ぐ
 * - nosniff … 画像などを勝手にスクリプトとして解釈させない
 * - Referrer-Policy … 外へ出るリンクに、こちらの URL (日付など) を渡しすぎない
 * - Permissions-Policy … 使わない端末機能は最初から閉じておく
 *
 * CSP の他の項目 (読み込んでよいスクリプトの制限) は、テーマと起動アニメーションの
 * インラインスクリプトや Next の動作と両立させる手間が大きいので、本版では付けない。
 */
const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
];

const nextConfig: NextConfig = {
  /*
   * 日程調整の計算 (SPEC §6.8.3) で使うソルバー。WASM のファイルを実行時に
   * 読むので、まとめずに node_modules から読ませ、デプロイにも含める
   */
  serverExternalPackages: ["highs"],
  outputFileTracingIncludes: {
    "/api/schedule/plan": ["./node_modules/highs/build/**"],
  },
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  experimental: {
    /*
     * クライアント側ルーターキャッシュの保持時間 (SPEC.md §12 / v1.14)
     *
     * 既定は動的ルートが 0 秒で、**タブを行き来するたびに毎回サーバーへ取りに行く**。
     * その間スケルトンが出るので、切り替えのたびに待たされる体感になっていた。
     *
     * 30秒だけ持たせると、隣のタブを見て戻る程度の操作は即座に描き直せる。
     * 古い値が問題になりうるものは、それぞれ自前で取り直している:
     *   - 施錠ボード / 部室の鍵 … マウント時と15秒ごとに再取得 (§6.1.1 / §6.1.2)
     *   - 空き申請の重複       … 表示が古くても DB の排他制約が弾く (§6.1)
     *
     * **メモリ上のキャッシュ**なので端末のストレージは使わない。
     * タブを閉じれば消える。
     */
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
  },
};

export default nextConfig;
