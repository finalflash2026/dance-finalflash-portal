# 本番をサークルのアカウントへ移す手順

2026-11 時点。先輩の個人の Vercel にある本番を、サークル共用のアカウントが持つ Vercel・Supabase へ移す。
方針の話し合いは `docs/migration-summary.html` にまとめてある。ここは実際の作業の順番。

## 0. 結論

- **コードはこのリポジトリ (`finalflash2026/dance-finalflash-portal`) のまま続けてよい。** `finalflash2026` は GitHub の Organization で、個人の持ち物ではないため。やることは持ち主の整理だけ (下の 1.)。
- **リポジトリは公開のままにする。** Vercel の無料プラン (Hobby) は、Organization の**非公開**リポジトリからはデプロイできない ([Vercel Community](https://community.vercel.com/t/unable-to-deploy-from-organizational-private-repository/16334))。公開でも困らないよう、秘密の値はコードに入れていない (`.env*` は除外。2026-11-11 に履歴も確認済み)。
- **DB は「プロジェクトの移動」で移す。** Supabase は組織から組織へプロジェクトを移せる ([Supabase Docs](https://supabase.com/docs/guides/platform/project-transfer))。URL・キー・ログイン中の人・データがそのまま残るので、部員は何もしなくてよい。移せないときだけ書き出して入れ直す (下の 3-B)。
- **変わるのはアプリの URL だけ。** 新しい Vercel では `○○.vercel.app` が変わるので、ホーム画面に追加している人は追加し直す。iOS アプリは作り直して配る。

## 1. 持ち物を決める

サークル共用のメールアドレスで、次の3つを作る。パスワードと2段階認証の復旧コードは代表と担当の2人で持つ。

| サービス | 持ち主 | 担当者の入り方 |
|---|---|---|
| GitHub | `finalflash2026` の Owner に共用アカウントを入れる | 担当者は個人で Member (書き込み)。先輩が唯一の Owner なら、共用アカウントを Owner に足してもらう |
| Vercel (Hobby) | 共用アカウント | Hobby は1人しか入れないので、共用アカウントでログインする |
| Supabase | 共用アカウントで組織を作る | 担当者は個人で組織に招待 (無料でも人数の上限なし) |
| Google Cloud (Google ログインの OAuth クライアント) | 共用アカウントでプロジェクトを作る、または今のプロジェクトに Owner で足してもらう | 担当者は個人で招待 |
| バックアップ | 共用アカウントの**非公開**リポジトリ `dance-finalflash-ops` | GitHub と同じ |

## 2. 先輩にお願いすること

1. GitHub: `finalflash2026` に共用アカウントを Owner で招待
2. Supabase: 共用アカウントを、今の本番がある組織に **Owner** で招待 (移動にはこちら側の Owner 権限が要る)
3. 今の設定の値を引き継ぐ (チャットに貼らず、会って渡すかパスワード管理の共有で)
   - `SUPABASE_SERVICE_ROLE_KEY`・`CRON_SECRET`
   - `NEXT_PUBLIC_VAPID_PUBLIC_KEY`・`VAPID_PRIVATE_KEY`・`VAPID_SUBJECT` (**同じ鍵を使う**。変えると今通知を受け取っている人に届かなくなる)
   - Google ログインの OAuth クライアント (Google Cloud のプロジェクト)
4. Vercel の使用量 (Usage) の画面を見せてもらう (無料枠に収まるかの確認)
5. 独自ドメインを使っているか

## 3. DB を移す

### 3-A. プロジェクトの移動 (第一候補)

1. 共用アカウントで Supabase の組織を作る (Free)
2. 先輩の組織の Owner になった共用アカウントで、本番プロジェクトの Settings → General → Transfer project → 移し先にサークルの組織を選ぶ
3. 移し先が Free のときは、無料のプロジェクト2つまでの枠に収まっているか確かめられる。1〜2分止まることがある
4. 終わったら、URL・anon key・service role key が変わっていないことを確かめる (変わらない)

### 3-B. 移せなかったとき (書き出して入れ直す)

1. 先輩に、本番の DB を `pg_dump` で書き出してもらう (`auth` スキーマを含める。パスワードのハッシュと Google の紐づけが残るので、部員はそのままログインできる)
2. サークルの組織に新しいプロジェクトを作り、書き出したものを入れる
3. URL とキーが変わるので、4. の環境変数を新しい値にする
4. Supabase の Authentication → URL Configuration と Providers → Google を、今の本番と同じに設定する
5. ログインしたままの人は一度ログアウトされる (トークンを作る鍵が変わるため)

## 4. アプリを移す (Vercel)

1. 共用アカウントで Vercel に GitHub でログインし、`finalflash2026/dance-finalflash-portal` を Import (Framework は Next.js のまま)
2. Environment Variables に入れる

   | 名前 | 値 |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL`・`NEXT_PUBLIC_SUPABASE_ANON_KEY`・`SUPABASE_SERVICE_ROLE_KEY` | Supabase の Project Settings → API |
   | `APP_BASE_URL` | 新しい URL (例 `https://ff-calendar.vercel.app`) |
   | `CRON_SECRET` | 今の本番と同じ |
   | `NEXT_PUBLIC_VAPID_PUBLIC_KEY`・`VAPID_PRIVATE_KEY`・`VAPID_SUBJECT` | 今の本番と同じ |
   | `NEXT_PUBLIC_GOOGLE_CLIENT_ID`・`NEXT_PUBLIC_GOOGLE_IOS_CLIENT_ID` | Google Cloud の OAuth クライアント |

3. Region は `hnd1` (vercel.json で指定済み)。毎朝の Cron 2本は Hobby の「1日1回」に収まっている
4. Google Cloud の OAuth クライアントの「承認済みの JavaScript 生成元」に新しい URL を足す。Supabase の Authentication → URL Configuration の Site URL と Redirect URLs も新しい URL に
5. デプロイして、部員には案内せずに動作を確かめる (ログイン・空き申請・出欠・通知・購読 ics)

## 5. 大規模アップデートの DB の変更 (移行と同じ日にしない)

v1.49 から、**コードは DB より先に出してよい** (`release/no-db-change`)。DB に 0020〜0029 の表が無い間は、その表を使う機能 (イベント・締切・告知、日程調整、毎朝のリマインド、出欠の「出席」と理由など) が隠れ、ほかは動く (SPEC §13.5)。

- 順番: ① 今の本番にコードだけ入れる (PR のマージ。DB はそのまま) → ② 今の DB のまま新しいアカウントへ移す (3.・4.) → ③ 落ち着いたら、新しい本番の DB で 0020〜0029 を番号順に流す。1分ほどで隠れていた機能が出る (コードのデプロイは要らない)
- **移行と ③ は別の日に**する。どちらで問題が出たか分からなくなるため
- ③ の前に 7. のバックアップを1回取っておく

## 6. 切り替えの日

1. 試験期間・大会の前後を避けて日を決める
2. 当日: 新しい URL を部員に案内 (ホーム画面に追加し直す・購読 ics の URL も変わる)。iOS アプリは `CAP_SERVER_URL` を新しい URL にして作り直す
3. 旧 URL はしばらく残す。先輩の Vercel で旧 URL から新しい URL へ転送 (Redirect) を置いてもらえると、案内を見ていない人も迷わない
4. 1〜2週間問題が無ければ、先輩の Vercel のプロジェクトを止める (DB は移動済みなので消さないこと。3-B のときは旧 DB も残しておき、1か月後に消す)

## 7. バックアップ

1. 共用アカウントで非公開リポジトリ `dance-finalflash-ops` を作り、`docs/ops/backup.yml` を `.github/workflows/backup.yml` に置く
2. Secrets に `SUPABASE_DB_URL` (Session pooler の URI) を入れ、手で1回動かして書き出せるか確かめる
3. 長期休みのあとは動いているか確かめる (60日動きの無いリポジトリは GitHub が止める)

## 8. 毎年の代替わりでやること

- GitHub の Member と Supabase の組織のメンバーを入れ替える
- 共用アカウントのパスワードを変え、2段階認証の復旧コードを新しい担当に渡す
- この文書と `docs/migration-summary.html` を引き継ぐ
