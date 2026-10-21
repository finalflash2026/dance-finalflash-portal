/**
 * 確認の窓 (SPEC §6.7.8 / v1.32.7)。`window.confirm` の代わりに使う。
 *
 * ブラウザの確認ダイアログは、ホーム画面から開いたアプリの中で急に
 * ブラウザの見た目のものが出て、他の確認 (鍵の報告など、下から出る窓) と
 * 揃わない。呼び方は `window.confirm` と同じ1行のまま、結果を待つだけにする:
 *
 *   if (!(await confirmAction("削除しますか?"))) return;
 *
 * 窓を描くのは `components/ConfirmHost.tsx` (ルートのレイアウトに1つ)。
 */
export interface ConfirmOptions {
  message: string;
  /** 押すと進むボタンの文字。既定は「はい」 */
  confirmLabel?: string;
  /** 消す・取り消す操作。ボタンを赤い文字にする。既定は文面から判断する */
  destructive?: boolean;
}

export interface ConfirmRequest extends Required<ConfirmOptions> {
  resolve: (ok: boolean) => void;
}

let show: ((request: ConfirmRequest) => void) | null = null;

/** ConfirmHost が窓を出す関数を登録する。外すときは null */
export function registerConfirmHost(fn: ((request: ConfirmRequest) => void) | null) {
  show = fn;
}

const DESTRUCTIVE = /削除|取り消|取消|外し|外す|OB|降格|初期化/;

export function confirmAction(input: string | ConfirmOptions): Promise<boolean> {
  const options = typeof input === "string" ? { message: input } : input;
  const request = {
    message: options.message,
    confirmLabel: options.confirmLabel ?? "はい",
    destructive: options.destructive ?? DESTRUCTIVE.test(options.message),
  };
  // 窓の部品がまだ無い (読み込み途中など) ときだけ、ブラウザの確認に頼る
  if (!show) return Promise.resolve(window.confirm(request.message));
  const open = show;
  return new Promise((resolve) => open({ ...request, resolve }));
}
