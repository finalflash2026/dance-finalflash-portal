import Link from "next/link";

import { groupClass } from "@/components/ui";

/** デモ画面の目次。各画面を見本のデータで開く */
const SCREENS = [
  { href: "/demo/calendar", title: "ホーム(現役)", note: "今日・自主練できる部屋・鍵の入口・週の帯・その日" },
  { href: "/demo/keys", title: "鍵と連絡", note: "ホームの「練習場所の鍵・部室の鍵・連絡」から開く画面" },
  { href: "/demo/notifications", title: "お知らせ", note: "右上のベルから開く画面" },
  { href: "/demo/calendar?ob=1", title: "ホーム (OB/OG)", note: "鍵や他ジャンルが出ない2タブの見え方" },
  { href: "/demo/calendar?tour=1", title: "初回ツアー", note: "カレンダーの上で吹き出しの案内を始める" },
  { href: "/demo/numbers", title: "ナンバー", note: "所属ナンバー・作成・スタ練" },
  { href: "/demo/number", title: "ナンバー詳細(主催)", note: "日程・メンバーの編集" },
  { href: "/demo/number?member=1", title: "ナンバー詳細(メンバー)", note: "閲覧と出欠" },
  { href: "/schedule", title: "日程調整の回答", note: "出られる日を ○/△/× で答える" },
  { href: "/schedule/plan", title: "日程調整の割り振り(折衝・3役)", note: "150人の見本の回答から、ジャンルの割り振り案を作る" },
  { href: "/demo/settings", title: "設定", note: "カレンダーに追加・通知・外観モード・権限" },
  { href: "/demo/manage", title: "イベントと締切(管理)", note: "イベント・締切・告知の登録" },
];

export default function DemoIndex() {
  return (
    <main className="mx-auto max-w-2xl space-y-3 px-4 py-3">
      <h1 className="text-[28px] font-bold">画面の見本</h1>
      <ul className={groupClass}>
        {SCREENS.map((screen) => (
          <li key={screen.href}>
            <Link href={screen.href} className="block px-4 py-3">
              <span className="block text-[17px]">{screen.title}</span>
              <span className="block text-[13px] text-[var(--muted)]">{screen.note}</span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="px-1 text-[13px] text-[var(--muted)]">
        起動アニメーションは、タブを閉じてから開き直すともう一度流れます。
        右上の ? と歯車、下のタブも押せます(タブの行き先はデモではなく本来の画面です)。
      </p>
    </main>
  );
}
