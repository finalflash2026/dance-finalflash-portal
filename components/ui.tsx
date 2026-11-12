/**
 * 画面の共通の部品 (SPEC.md §12 / v1.50)
 *
 * **ボタン・入力欄・まとまりの見た目はここの型だけを使う。** 画面ごとに Tailwind を
 * 直書きすると、角の丸み・高さ・文字の大きさが少しずつずれていく。
 *
 * - ボタンの大きさは3つ: 大 (50px。窓の一番下の決定)・中 (44px。欄の横・並べるもの)・小 (32px。行の中の「編集」など)
 * - 色は4つ: 主 (塗り)・副 (うすい地に青い文字)・消す (うすい地に赤い文字)・文字だけ
 * - 枠線は使わない。まとまりは面の色 (var(--cell)) と区切り線で示す
 * - 入力欄は 16px (iPhone で拡大されない大きさ)
 */

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-[13px] font-medium text-[var(--muted)]">{label}</span>
      {children}
      {hint ? (
        <span className="mt-1 block text-xs text-[var(--muted)]">{hint}</span>
      ) : null}
    </label>
  );
}

/** 入力欄 (1行・複数行・選択) */
export const inputClass =
  "mt-1 block w-full rounded-[10px] bg-[var(--background)] px-3 py-2.5 text-[16px] outline-none ring-1 ring-[var(--separator)] transition-shadow focus:ring-2 focus:ring-[var(--tint)] disabled:opacity-50";

/** 表の中などの小さい入力欄 */
export const compactInputClass =
  "rounded-[8px] bg-[var(--background)] px-2 py-1.5 text-[14px] outline-none ring-1 ring-[var(--separator)] focus:ring-2 focus:ring-[var(--tint)] disabled:opacity-50";

/** 大の主ボタン (primaryButtonClass と同じ。前からの名前) */
export const buttonClass =
  "flex h-[50px] w-full items-center justify-center rounded-[14px] bg-[var(--tint)] px-4 text-[17px] font-semibold text-white transition-opacity active:opacity-80 disabled:opacity-40";

/** 大の副ボタン (fillButtonClass と同じ。前からの名前) */
export const secondaryButtonClass =
  "flex h-[50px] w-full items-center justify-center rounded-[14px] bg-[var(--fill)] px-4 text-[17px] font-semibold text-[var(--tint)] transition-opacity active:opacity-70 disabled:opacity-40";

/** 中の副ボタン (欄の横・並べるもの) */
export const mediumButtonClass =
  "inline-flex h-11 items-center justify-center gap-1.5 rounded-xl bg-[var(--fill)] px-4 text-[15px] font-semibold text-[var(--tint)] transition-opacity active:opacity-70 disabled:opacity-40";

/** 小のボタン (行の中の「編集」など) */
export const smallButtonClass =
  "inline-flex h-8 shrink-0 items-center justify-center rounded-full bg-[var(--fill)] px-3 text-[13px] font-semibold text-[var(--tint)] transition-opacity active:opacity-70 disabled:opacity-40";

/** 小の消すボタン */
export const smallDestructiveButtonClass =
  "inline-flex h-8 shrink-0 items-center justify-center rounded-full bg-[var(--fill)] px-3 text-[13px] font-semibold text-[var(--danger-solid)] transition-opacity active:opacity-70 disabled:opacity-40";

/**
 * 設定画面の各項目のまとまり (SPEC §6.4.1 / §12 / v1.18.1 / v1.30)
 *
 * 以前は見出しと余白だけで区切っていたが、**どこからどこまでが1項目なのか
 * ぱっと見で分からない**という指摘が出た (v1.18.1)。
 *
 * v1.30 で**枠線から面の色**に変えた (§6.7.8)。枠で囲んだカードを積み重ねる形が
 * 「AIが作った画面っぽい」と言われていた。iOS の設定アプリと同じく、
 * 少しだけ色の違う面でまとまりを示す。他のボードやリストも同じ面に揃えている。
 */
export const settingsSectionClass =
  "space-y-3 rounded-xl bg-[var(--cell)] p-4";

export function ErrorMessage({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return (
    <p
      role="alert"
      className="rounded-lg bg-[var(--danger-bg)] px-3 py-2 text-sm text-[var(--danger-fg)]"
    >
      {children}
    </p>
  );
}

// ---------- v1.30: iOS 標準に寄せた部品 (§6.7.8) ----------

/**
 * グループ化されたリスト (iOS の「設定」アプリと同じ形)。
 * **枠線で囲まず、面の色と細い区切り線でまとめる。** 枠で囲んだカードを
 * 積み重ねる形は、どこが押せてどこが説明なのかが読み取りにくかった。
 */
export const groupClass =
  "overflow-hidden rounded-xl bg-[var(--cell)] divide-y divide-[var(--separator)]";

/** まとまりの上に置く小さな見出し */
export function GroupHeader({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="px-4 pb-1.5 text-[13px] font-normal text-[var(--muted)]">
      {children}
    </h2>
  );
}

/** まとまりの下に置く補足 (説明はここに寄せて、行の中には書かない) */
export function GroupFooter({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-4 pt-1.5 text-[13px] leading-snug text-[var(--muted)]">
      {children}
    </p>
  );
}

/** 押せる文字 (iOS のリンク色)。「追加」「編集」など */
export const tintTextClass = "text-[var(--tint)] font-medium";

/** 塗りの主ボタン。窓の一番下などに1つだけ置く */
export const primaryButtonClass = buttonClass;

/** 薄い地の副ボタン */
export const fillButtonClass = secondaryButtonClass;

/** 消す操作。赤い文字だけで、塗りは使わない (iOS の destructive) */
export const destructiveButtonClass =
  "flex h-[50px] w-full items-center justify-center rounded-[14px] bg-[var(--fill)] px-4 text-[17px] font-semibold text-[var(--danger-solid)] transition-opacity active:opacity-70 disabled:opacity-40";

/**
 * 切り替えボタン (iOS の Segmented Control)。
 * 2〜4個の中から1つを選ぶ場所はこれに揃える。
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  size = "regular",
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
  /** large = 高さ 36px・文字 14px (よく押す切り替え。v1.31.7) */
  size?: "regular" | "large";
}) {
  const index = Math.max(0, options.findIndex((option) => option.value === value));
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={`relative flex rounded-[9px] bg-[var(--fill)] p-0.5 ${size === "large" ? "h-10" : ""}`}
    >
      {/*
       * 選択の印は1枚だけ置いて、横に滑らせる (v1.31.13)。押したところへ
       * 印が流れていくので、どこからどこへ切り替えたかが目で追える
       */}
      <span
        aria-hidden
        className="absolute bottom-0.5 top-0.5 rounded-[7px] glass-thumb transition-transform duration-[320ms] ease-[var(--ease-smooth)]"
        style={{
          left: 2,
          width: `calc((100% - 4px) / ${options.length})`,
          transform: `translateX(${index * 100}%)`,
        }}
      />
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={`relative z-10 flex-1 rounded-[7px] whitespace-nowrap transition-colors ${
              size === "large" ? "px-2 text-[14px]" : "px-2 py-1.5 text-[13px]"
            } ${selected ? "font-semibold" : "font-medium text-[var(--foreground)]"}`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** オン/オフのスイッチ (iOS の Toggle)。チェックボックスの代わりに使う */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors disabled:opacity-40 ${
        checked ? "bg-[#34c759]" : "bg-[var(--fill)]"
      }`}
    >
      <span
        aria-hidden
        // left-0 が無いと、つまみの基準がボタンの中央 (文字の位置) になり右へはみ出す
        className={`absolute left-0 top-[2px] h-[27px] w-[27px] rounded-full bg-white shadow-[0_2px_6px_rgba(0,0,0,0.2)] transition-transform ${
          checked ? "translate-x-[22px]" : "translate-x-[2px]"
        }`}
      />
    </button>
  );
}

/** グループの中の入力欄 (枠線を持たず、行の中に溶け込む) */
export const cellInputClass =
  "w-full bg-transparent px-4 py-3 text-[17px] outline-none placeholder:text-[var(--muted)]";

/** 大事な締切の印 (§6.7.2) */
export function ImportantBadge() {
  return (
    <span className="shrink-0 rounded-[5px] bg-[var(--danger-solid)] px-1.5 py-px text-[11px] font-bold text-white">
      大事
    </span>
  );
}
