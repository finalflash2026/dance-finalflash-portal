# しくみの解説(フレームワークとファイルの役割)

このサイトが「何で作られていて」「どのファイルが何をしているか」を、コードを読んだことがない人にも分かるように説明する。細かい決まりごとは `SPEC.md`、今回の大規模アップデートの経緯は `docs/major-update.md` にある。

---

## 1. 全体像

```
 スマホ(ブラウザ / ホーム画面のアプリ)
        │  ① ページを開く・ボタンを押す
        ▼
 Vercel(サーバー)…… Next.js が動いている
   ├ 画面をサーバーで組み立てて返す(Server Component)
   ├ API(app/api/…)で書き込みや通知の送信をする
   └ 毎朝7時・毎晩3時に決まった処理を動かす(Cron)
        │  ② データを読み書きする
        ▼
 Supabase …… データベース(PostgreSQL)とログインの仕組み
   └ 「誰がどの行を読める/書けるか」を DB 自身が判定する(RLS)

 別ルート:
   Google / iPhone のカレンダー ──(購読URL)──▶ /api/cal/… が予定を .ics で返す
   通知 ──(Web Push)──▶ 各端末の Service Worker(public/sw.js)が表示する
```

ポイントは3つ。

1. **画面はほとんどサーバーで作る。** スマホに重い処理をさせず、最初から中身の入った HTML を返す。
2. **データの守りは DB 側に置く。** 画面でボタンを隠すのは補助で、本当の判定は Supabase の RLS(行ごとの権限)が行う。誰かが API を直接叩いても、見てはいけない行は返らない。
3. **外部の有料サービスを使わない。** Vercel と Supabase の無料枠で動く(SPEC §0)。

---

## 2. 使っているフレームワーク・ライブラリ

| 名前 | 何をするものか | このサイトでの使いどころ |
|---|---|---|
| **Next.js 15**(App Router) | React で作るサイトの土台。ページの道順(URL)、サーバーでの画面組み立て、API、画像の配信をまとめて面倒を見る | `app/` 以下の各画面と `app/api/` の API。`middleware.ts` でログインしていない人を止める |
| **React 19** | 画面を「部品(コンポーネント)」の組み合わせで作る仕組み。状態が変わると必要な所だけ描き直す | `components/` と各画面の `*Client.tsx` |
| **TypeScript** | JavaScript に「型」を付けたもの。書き間違いを実行前に見つけられる | すべての `.ts` / `.tsx`。`npm run typecheck` で検査 |
| **Tailwind CSS 4** | `className="px-4 text-sm"` のように、短いクラス名で見た目を書く仕組み | 全画面の見た目。色は `app/globals.css` の変数(トークン)で一元管理 |
| **Supabase** | データベース(PostgreSQL)・ログイン・権限管理をまとめて提供するサービス | 予定・申請・ナンバーなどすべてのデータ。ログイン。RLS |
| **@supabase/ssr / supabase-js** | Supabase を Next.js から使うための公式部品。ログイン状態を cookie で持ち回る | `lib/supabase/` の3種類のクライアント |
| **Vercel** | Next.js の会社が運営するホスティング。GitHub に push すると自動で本番に出る。Cron(定時実行)もある | 本番サーバー。`vercel.json` に Cron を定義 |
| **web-push** | ブラウザの「プッシュ通知」を送るための部品(VAPID 鍵で署名する) | `lib/push.ts` |
| **Service Worker** | ブラウザの裏で動く小さなスクリプト。通知の受け取りや、ファイルの端末保存ができる | `public/sw.js` |
| **zod** | 受け取ったデータが正しい形かを検査する部品 | 各 API の入力チェック |
| **bcryptjs** | パスワードを元に戻せない形(ハッシュ)にする部品 | 合言葉(サークル生/折衝/3役)の保存と照合 |
| **papaparse** | CSV を読む部品 | 折衝係の予約取込(`lib/csv.ts`) |
| **date-fns** | 日付の計算部品 | 一部の日付計算(基本は `lib/time.ts` の自前関数) |
| **ESLint** | コードの書き方の問題を見つける道具 | `npm run lint` |

---

## 3. フォルダとファイルの役割

### 3.1 一番上の階層

| ファイル | 役割 |
|---|---|
| `SPEC.md` | 仕様書。**変更するときは先にここを書き換えてから実装する**決まり |
| `package.json` | 使っているライブラリと、`npm run dev` などのコマンドの定義 |
| `middleware.ts` | **すべてのリクエストの入口の門番**。ログインしていなければ `/login` へ送る。ログイン状態(cookie)の更新もここ。購読URL・ヘルスチェック・Cron・画像などは通す |
| `next.config.ts` | Next.js の設定(タブを行き来したときの画面の使い回し時間など) |
| `vercel.json` | Vercel の設定。サーバーの地域(東京)と、Cron(毎晩3時のヘルスチェック・毎朝7時のリマインド) |
| `capacitor.config.ts` | **iOS アプリ**の設定(SPEC §2.3)。アプリが開く URL(ふだんは本番)を決める |
| `ios/` | iOS アプリの Xcode プロジェクト。中身は本番の Web を開く WebView 1枚なので、画面を変えるのに触る必要はない。`npm run ios:open` で Xcode が開く |
| `native/www/` | iOS アプリに同梱する、開けなかったとき(圏外など)のページ |
| `ios/App/project.yml` | Xcode プロジェクトの元(xcodegen)。target(アプリ・ウィジェット)を足すときはここを直して `npm run ios:project` |
| `ios/App/App/GlassTabBar.swift` ほか | アプリのネイティブの部品(SPEC §2.3.1): Liquid Glass のタブバー、Web から呼ぶ窓口(`FFNativePlugin.swift`) |
| `ios/App/Widget/` | ホーム画面・ロック画面のウィジェット。アプリが App Group に置いた予定を出す |
| `lib/app-digest.ts` / `app/api/app/digest` | アプリに渡す「これからの予定」と通知の文面(14日ぶん) |
| `lib/native-sync.ts` / `components/NativeBridge.tsx` | アプリを開いたときに、通知の予約とウィジェットを予定に合わせ直す |
| `scripts/cap.ts` | `npm run ios:sync`(本番を開く設定にする)と `npm run ios:dev`(手元の dev をシミュレーターで開く) |
| `tsconfig.json` / `eslint.config.mjs` / `postcss.config.mjs` | TypeScript・ESLint・Tailwind の設定 |
| `.env.example` | 環境変数の見本(Supabase の URL や鍵、VAPID 鍵など)。**本物の値は `.env.local` と Vercel にだけ置き、コミットしない** |

### 3.2 `app/` … 画面と API

Next.js の決まりで、**フォルダの並びがそのまま URL になる**。`page.tsx` が画面、`route.ts` が API、`layout.tsx` が共通の枠。`(app)` のようなカッコ付きフォルダは URL に出ないまとまり。

| パス | URL | 役割 |
|---|---|---|
| `app/layout.tsx` | 全ページ | HTML の一番外側。テーマ(明暗)と起動アニメーションの初期化スクリプトを最初に走らせる |
| `app/globals.css` | — | 色のトークン(ライト/ダーク)、共通のアニメーション |
| `app/manifest.ts` | `/manifest.webmanifest` | ホーム画面に追加したときの名前・アイコン |
| `app/(public)/login`・`signup` | `/login` `/signup` | ログインと新規登録 |
| `app/(app)/layout.tsx` | ログイン後の全画面 | ヘッダー(ベル・?・歯車)、下のタブバー、初回ツアー、起動時の案内 |
| `app/(app)/(calendar)/page.tsx` | `/` | **ホーム**。サーバーで予定・コマ・締切などを並列に取り、`CalendarHome.tsx` に渡す |
| `app/(app)/(calendar)/CalendarHome.tsx` | 〃 | ホームの操作部分(今日・自主練できる部屋・週の帯・その日の予定・絞り込み) |
| `app/(app)/keys` | `/keys` | 練習場所の鍵・部室の鍵・連絡 |
| `app/(app)/notifications` | `/notifications` | お知らせ一覧 |
| `app/(app)/number-cal`・`numbers/[id]` | `/number-cal` `/numbers/…` | ナンバーの一覧・作成・スタ練、ナンバーの詳細 |
| `app/(app)/settings` | `/settings` | 設定(カレンダー追加・通知・テーマ・権限) |
| `app/(app)/coordinator` | `/coordinator` | 折衝係の画面(CSV 取込 → コマ割り表 → 公開) |
| `app/(app)/manage` | `/manage` | イベント・締切・告知の登録(折衝・3役) |
| `app/(app)/admin` | `/admin` | 3役の管理画面(ユーザー・合言葉) |
| `app/(app)/demo` | `/demo` | **見本データで画面を見るためのデモ**。Supabase 未設定の手元でだけ開く(本番は 404) |

**API(`app/api/…/route.ts`)** … 画面から呼ばれる、書き込みや外部への送信を伴う処理。

| API | 役割 |
|---|---|
| `auth/login`・`logout`・`signup` | ログイン・ログアウト・登録(合言葉の照合を含む) |
| `role/elevate` | 合言葉で折衝・3役の権限を足す |
| `room-status`・`club-key/claim`・`board-messages` | 鍵の報告・部室の鍵・連絡。**全員に通知が飛ぶのでサーバー経由にしている** |
| `announcements` | 3役からの告知(お知らせ作成 + 通知) |
| `slots/publish`・`reservations/bulk`・`import/parse`・`rooms` | 折衝係の操作(公開・予約の取込・部屋の追加) |
| `push/subscribe`・`unsubscribe` | 端末の通知登録 |
| `cal/[token]`・`cal/regenerate` | カレンダー購読用の .ics を返す / 購読URLの作り直し |
| `cron/reminders` | 毎朝7時のリマインド(今日の予定・締切) |
| `health` | 毎晩 DB を軽く叩いて、Supabase の無料枠が休止しないようにする |
| `admin/…` | 3役の操作(ユーザー削除・パスワード再設定・一括 OB 化など) |

### 3.3 `components/` … 画面の部品

いくつもの画面で使う部品。主なもの:

| ファイル | 役割 |
|---|---|
| `ui.tsx` | ボタン・グループ化したリスト・切り替えボタン・スイッチなど、**見た目を揃えるための共通部品** |
| `Sheet.tsx` | 下から出る窓 |
| `TabBar.tsx`・`SwipeTabs.tsx`・`PageTransition.tsx` | 下のタブ、横スワイプでのタブ移動、画面切り替えの動き |
| `SettingsButton.tsx`・`HelpButton.tsx`・`BellButton.tsx` | 右上の歯車・?・ベル |
| `BackButton.tsx` | 左上の「‹ ホーム」などの戻るボタン |
| `Tour.tsx`・`LaunchPrompts.tsx` | 初回ツアー、ホーム画面追加・通知オンの案内 |
| `Splash.tsx` | 起動アニメーション |
| `LabelCalendar.tsx`・`DayTimeline.tsx`・`DayGrid.tsx` | 月カレンダー、その日の時間表、部屋×時間の表 |
| `ClaimSheet.tsx`・`AttendanceSheet.tsx` | 空き申請の窓、出欠の窓 |
| `RoomStatusBoard.tsx`・`ClubKeyBoard.tsx`・`BoardMessages.tsx` | 鍵のボードと連絡欄 |
| `NotificationList.tsx`・`NumberList.tsx`・`StudioPracticeSection.tsx` | お知らせ一覧・ナンバー一覧・スタ練 |
| `PullToRefresh.tsx`・`ServiceWorkerRegistrar.tsx` | 引っぱって更新、Service Worker の登録 |

### 3.4 `lib/` … 画面を持たない処理(計算・データの取り方)

| ファイル | 役割 |
|---|---|
| `supabase/server.ts`・`client.ts`・`admin.ts` | Supabase への3種類の接続。**server** = サーバーでログイン中の本人として、**client** = ブラウザで本人として、**admin** = サーバー専用の全権(RLS を無視する。購読URL・通知・告知など限られた所だけで使う) |
| `supabase/demo-client.ts` | デモ画面用の空の接続(Supabase 未設定のときだけ) |
| `auth/session.ts`・`guard.ts` | ログイン中の本人の取得、API の権限チェック |
| `auth/email.ts`・`username.ts`・`token.ts` | メールを使わないための仮メール作成、ユーザーIDの組み立て、購読URL用の乱数 |
| `events.ts` | **自分の予定を集める中心の関数**(公式練・申請・ナンバー・スタ練・イベント・締切)。ホームと購読カレンダーの両方が使う |
| `event-display.ts` | 予定の色・短い名前・日ごとへの分け方 |
| `ics.ts` | 予定をカレンダーアプリ用の .ics 形式に書き出す |
| `push.ts`・`push-client.ts` | 通知を送る(サーバー)/ 端末を登録する(ブラウザ) |
| `reminders.ts` | 朝のリマインドの文面づくり |
| `claims.ts` | 空きコマを「申請済み」「空き」に分ける計算 |
| `slots.ts`・`slot-grid.ts`・`reservations.ts`・`import.ts`・`csv.ts` | 折衝係のコマ割り・予約取込の計算と検証 |
| `time.ts`・`day-span.ts`・`timeline.ts` | 日付・時刻の計算(**日本時間で、文字列のまま計算**して日付ずれを防ぐ)、日をまたぐ予定、時間表の配置 |
| `constants.ts`・`rooms.tsx`・`rooms-server.ts` | ジャンル・色・役職名などの定数、練習場所の一覧 |
| `theme.ts` | 明暗テーマの切り替え |
| `home-layout.ts` | ホームの欄の並びと表示/非表示 (端末に保存) |
| `rate-limit.ts` | ログイン・登録・権限追加の試行回数の制限。DB (`rate_limits` テーブル) で数えるので、サーバーが複数あっても効く |
| `cron-auth.ts` | Cron からの呼び出しかどうかの確認 |
| `use-live-refresh.ts`・`refresh-signal.ts`・`nav-direction.ts` | 鍵のボードの自動更新、引っぱって更新の合図、タブ移動の向き |

### 3.5 そのほか

| 場所 | 役割 |
|---|---|
| `supabase/migrations/0001〜0029_*.sql` | **データベースの設計図**。テーブル・権限(RLS)を番号順に積み重ねる。本番には Supabase の画面か CLI で番号順に流す |
| `public/sw.js` | Service Worker。通知の表示と、`/_next/static/`(アプリの部品ファイル)の端末保存 |
| `public/` のアイコン類 | ホーム画面のアイコンなど |
| `assets/` | 起動アニメーションのロゴ、ロゴの元データ(`assets/logo/`) |
| `scripts/set-passphrase.ts` | 合言葉を初めて設定するときのコマンド(`npm run set-passphrase`) |
| `prototypes/` | 試作(起動アニメーションの初期案など)。本番には関係しない |
| `docs/` | 計画メモ・この解説 |

---

## 4. 1つの操作を追ってみる

### 例1: ホームを開く
1. スマホが `/` を開く → `middleware.ts` がログイン済みか確かめる。
2. `app/(app)/layout.tsx` が本人の情報と未読の数を取り、ヘッダーとタブを用意する。
3. `app/(app)/(calendar)/page.tsx` が、予定(`lib/events.ts`)・コマ・締切などを **Supabase から並列に**取る。このとき Supabase の RLS が、本人が読んでよい行だけを返す。
4. 中身の入った HTML がスマホに届く。最初は起動アニメーションの静止したロゴが前に出ている。
5. JavaScript が読み込まれて画面が操作できるようになり(ハイドレーション)、ページの読み込みも終わったら、ロゴから光線が噴き出してホームへ溶ける。

### 例2: 「開けました」と報告する
1. `/keys` で部屋を押す → 確認の窓 → 「報告する」。
2. ブラウザが `POST /api/room-status` を呼ぶ。
3. サーバーが**本人として** `room_status` を書き換える(RLS が「今日の分だけ・本人として」を強制)。
4. 応答を返したあとで、`lib/push.ts` が現役全員の端末へ通知を送る。

### 例3: 毎朝7時のリマインド
1. Vercel の Cron が `GET /api/cron/reminders` を呼ぶ(秘密の合言葉付き)。
2. 通知を受け取る設定の人ごとに今日の予定を集め、`lib/reminders.ts` で文面を作って送る。
3. 締切が今日のもの、大事な締切で1週間後のものも全員へ送る。

---

## 5. よく使うコマンド

| コマンド | 何をするか |
|---|---|
| `npm run dev` | 手元で開発用サーバーを起動(http://localhost:3000) |
| `npm run typecheck` | 型の検査 |
| `npm run lint` | 書き方の検査 |
| `npm run build` | 本番用に組み立てる(Vercel もこれを実行する) |
| `npm run set-passphrase` | 合言葉の設定 |
