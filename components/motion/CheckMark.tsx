/**
 * 完了のチェックが描かれる (SPEC §12「動き」/ v1.36)。丸が弾んで出て、
 * その上にチェックの線が引かれる。表示した瞬間に一度だけ動く。
 */
export function CheckMark({ size = 20, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden
      className={`check-pop inline-block shrink-0 ${className}`}
    >
      <circle cx="12" cy="12" r="11" fill="currentColor" />
      <path
        d="M7 12.5l3.2 3.2L17 9"
        fill="none"
        stroke="white"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={1}
        className="check-draw"
      />
    </svg>
  );
}
