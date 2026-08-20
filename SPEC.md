# ダンスサークル練習管理サイト 開発仕様書 v1.6

## 改訂履歴
| 版 | 主な変更内容 |
|---|---|
| v1.0 | 初版。3層データ設計(予約枠→コマ→申請/ナンバー)、権限3段階、購読URL方式を策定 |
| v1.1 | 代表Figma案を合流: 3タブ構成(§6.0) / 全タブ「ミニカレンダー→日別ビュー」導線 / 空き申請をコマ単位→**自由時間帯(15分刻み)**に変更(claims再設計・排他制約) / タブ③に「今日の予定」「お知らせ」追加(notifications新設) / ナンバー絞り込みチップ / 設定画面分離 |
| v1.2 | 呼称「ジャン練」→**「公式練」**に全面変更 / **出欠機能を追加**(attendances新設・出欠管理窓・お知らせ連動。§6.4.2) |
| v1.3 | ランニングコスト0化: **Claude APIを廃止**。スクショ読み取りはサイト外(折衝係が自前のAIで実施)に移し、**CSVアップロードで取り込む**方式に変更(§9)。外部有料サービスはゼロ |
| v1.4 | **管理者に限り「1ジャン」「期」を修正可能**に(登録ミス救済。usernameは自動追従、本人は変更不可のまま。§6.5.1)。admin_audit_logs新設 |
| v1.5 | タブ①に**「今日の練習場所」施錠状況ボード**を追加(room_status新設。○=開錠済/×=施錠中、既定×、誰でも切替可。§6.1.1) |
| v1.6 | **OB/OGロールを追加**。卒業者はアカウント削除ではなくOBへ移行し、タブ②③(ナンバー・マイカレンダー)のみ利用可能に。縦イベでのナンバー参加を継続できる(§3.6) |
| v1.7 | **仕様変更2件**。①空き申請の時間粒度を**15分刻み→10分刻み**に変更(§6.1)。UI で丸めるだけでなく`claims`のCHECK制約でDB側でも強制する(クライアントからRLS経由で直接insertする設計のため、UIだけでは回避できてしまう)。②**タブ③のミニカレンダーをドット表示→予定ラベル表示**に変更(§6.0/§6.4)。タブ①②はドットのまま。あわせて`room_status.updated_at`をUPDATE時に更新するトリガを追加(§6.1.1の「3時間以上経過」判定が既定値のままでは機能しないため) |
| v1.13.2 | 実装時の修正(仕様変更なし)。ホーム画面から開いたとき、**ライトモードでも画面上端が黒くなる**のを修正(§12)。マニフェストの `background_color` を黒にしていたのが原因で、iOS はこれをスプラッシュだけでなく上端の塗りにも使う。あわせて `theme-color` を静的にも出すようにした(タグが無いと iOS が `background_color` を使うため) |
| v1.13.1 | **機能追加1件**。**ホーム画面に追加したときのアイコンとアプリ名(`ff Calendar`)を設定**(§12)。iOS Safari で「アプリのように開く」(standalone)ようにし、ステータスバーの色をテーマに追従させた。テンプレート由来の `favicon.ico` を差し替え |
| v1.13 | **機能追加1件**。**ダークモード(グレー背景)を追加**し、設定画面からライト/ダークを切り替えられるようにした(§12 / §6.4.1)。真っ黒ではなくグレーを地にする。あわせて画面側に直書きしていた色をすべて CSS 変数に集約し、**両テーマとも WCAG AA (4.5:1) 以上**を満たすよう調整した(ライト側でも「申請済み」の白文字が 2.6:1 しかなかったのを修正)。ジャンル色・ナンバー色は意味を持つ色なのでテーマでは変えない |
| v1.12 | **仕様変更1件+実装修正1件**(実運用の指摘による)。①**同じ日・同じジャンル・同じ時間帯の公式練が複数の部屋にある場合、1件にまとめて場所を併記する**(§6.4-1)。1回の練習に部屋を2つ押さえることがあり、そのままでは自分の予定と購読カレンダーに同じ練習が2件並ぶため。まとめるのは時間が完全に一致するときだけとし、出欠は代表のコマに寄せる(§6.4.2)。②タブ③の絞り込みチップが**1ナンバーにつきメンバー人数分だけ並ぶ**不具合を修正。`number_members` を `user_id` で絞っておらず、RLS が見せる「そのナンバーの全メンバー行」を数えていた |
| v1.11.1 | 実装時の追加(仕様変更なし)。§5.2に**`graduate_to_ob` 関数**を追加。§3.6のOB移行に伴う3つの削除とロール更新を1トランザクションで行う(supabase-jsには複数文をまたぐトランザクションが無く、アプリ側で4本に分けると途中失敗で「OBなのに未来の申請が残る」中途半端な状態になるため)。あわせて§8.9に、**自分自身のOB化・admin剥奪は拒否**すること、一括OB化は**現役のみを対象**に数えること、**username変更時は`auth.users`のダミーメールも更新する**こと(忘れると本人がログインできなくなる)を明記。アカウント削除は`DELETE`メソッドではなく**POSTの専用パス**にし、cascadeの付いていない参照が残っていれば409で止める。§13.3のバックアップを`.github/workflows/backup.yml`として具体化 |
| v1.11 | **仕様変更3件**(実運用の指摘による)。①タブ②③の日別タイムラインの時間軸を、**09:00〜22:00 に収まらない予定がある日は 00:00〜24:00 の全時間帯**にする(§6.3/§6.4)。ナンバー練には深夜練が入ることがあり、端で切ると予定が見えなくなるため。収まる日は従来どおり 09:00〜22:00。②出欠の遅刻・早退の時刻を**15分刻みプルダウン→1分刻みの自由入力**に変更(§6.4.2)。実際の到着・退出時刻は15分刻みに乗らない。③**出欠のお知らせを廃止**(§6.4.2 / §6.4-2)。1件の変更で参加者全員に通知が飛び、量に見合う価値が無いと判断したため。`attendances` のトリガを削除する(§5.2) |
| v1.10 | **仕様変更3件**(実運用の指摘による)。①お知らせは**タップして既読にしたらリストから消す**(§6.4-2)。既読が淡色で残り続けると、その下のカレンダーが遠くなるだけで読む価値が無いため。②絞り込みチップを**ジャンル単位・ナンバー単位に細分**(§6.4-3)。`すべて / 公式練 / ナンバー…` では公式練が1つの束のままで、「今週のBREAKだけ見たい」ができなかった。`すべて / {自分の1〜3ジャン} / 空き申請 / {各ナンバー}` に変更する。③**ナンバーの削除**を追加(§6.3)。`del_numbers` のRLSポリシーは最初からあったが画面が無く、作ったナンバーを消す手段が無かった |
| v1.9.2 | **仕様変更1件**(実運用の指摘による)。公開時に、予約枠の**未割当時間を自動で「空き」コマにする**(§6.2 Step3)。申請は公開済の`open`コマにしか付けられないため、コマを作らないと予約している部屋がタブ①に列すら出ず空き申請ができなかった。予約枠は全日程・全部屋にわたるので1件ずつ「空き」を置く運用は現実的でなく、**予約した=使える**を既定にする。開放したくない時間帯は明示的に「使用不可」で塞ぐ |
| v1.9.1 | **仕様追加1件**。コマ割りエディタに**曜日の絞り込み**を追加(§6.2 Step2-1)。公式練は月・水・木にしか入らないため、既定でこの3曜日だけを表示する。ただし他の曜日の予約枠にも「空き」コマを置きたい場合があるので、切り替えで全曜日も出せるようにし、隠している件数を表示する |
| v1.9 | **仕様変更2件**(実運用の指摘による)。①コマ割りエディタを**予約枠ごとの個別リスト→月まとめタイムライン**に変更(§6.2 Step2)。Step1の確認画面と同じ「縦=日付×部屋 / 横=時刻」で、1ヶ月ぶんの埋め残しを1画面で見渡せるようにする。あわせてコマ長のプリセットに**70分**を追加(70/90/110分)。②**対象期を月単位に変更**。コマごとではなくページ最上部で選び、その月の公式練コマすべてに即時反映する。対象期は月単位で決まるものであり、コマごとに設定するのは手数が多すぎたため |
| v1.8.1 | **仕様追加1件**。Step2に**予約枠の取消**を追加(§6.2 Step2)。取込確定後に読み取りミスに気付いた場合、それまでSQLでしか直せなかった。取消時はぶら下がるコマも消す(`status='cancelled'` にするだけだとコマが公開カレンダーに残り続けるため)。あわせて§5.2に`slots`の**排他制約**を追加し、同一予約枠内でコマの時間が重ならないことをDB側でも保証する(コマはクライアントからRLS経由で直接書くため、UIの検証だけでは折衝係2人の同時編集を防げない) |
| v1.8 | **仕様変更1件**。CSV取込の確認画面を**編集可能なテーブル→月まとめタイムライン**に変更(§6.2 Step1-3)。実運用で「1行ずつのカードでは月ぶんの確認に手間がかかりすぎる」ことが判明したため。縦=日付×部屋・横=時刻のグリッドにして1画面で見渡せるようにし、あわせて同一(日付・部屋)の時間重なりを警告するようにした |
| v1.7.1 | 実装時の追加(仕様変更なし)。§5.2に`reservations`の**部分ユニークインデックス**(`status='active'`のみ対象)を追加。§9.4の重複ガードは「selectしてからinsert」の2段階のため、折衝係2人が同時に同じCSVを確定すると両方通ってしまう。`claims`の排他制約と同じくDB側にも一意性を持たせる |
| v1.6.2 | 実装時の修正(仕様変更なし)。§5.2に**GRANTセクションを追加**。Supabaseプロジェクト既定の権限付与に暗黙依存していたため、環境によっては`permission denied for table`となっていた。GRANT(テーブル単位)とRLS(行単位)の二段構えを明示 |
| v1.6.1 | 実装時の修正(仕様変更なし)。§5.2のSQLで**RLSヘルパー関数(`app_role`/`is_number_member`)の定義位置を全テーブル作成後へ移動**(先頭に置くと参照先テーブル未作成で`42P01`エラー。`language sql`の関数は作成時に本体が検証されるため)。あわせて`set search_path = public, extensions;`を冒頭に追加(Supabaseで`btree_gist`が`extensions`スキーマにある場合に`claims`の排他制約が解決できないため) |

> 本書は VS Code + Claude Code で開発することを前提に、**この文書単体で開発着手できる**ことを目指した仕様書である。
> 読者(実装者)はサークルの事情を一切知らない前提で書く。

---

## 0. プロジェクト概要

### 0.1 背景
- 約150人のダンスサークル。9ジャンルが存在する。
- 「折衝係」が市民センター(南大沢文化会館=通称フレスコ)と大学(都立大の施設予約サイト)で練習室を予約している。
- 現状: 予約結果のスクショ → 折衝がExcelで時間割(コマ割り)作成 → 写真化してLINEで共有 → 各自が手動でカレンダー登録。空き部屋の使用はLINEノートのコメントで宣言。一覧性が低く、手間が多い。

### 0.2 目的
1. 折衝の作った練習日程をサイト上で一元管理・全員に自動共有する。
2. 空き部屋の使用宣言をLINEコメントからサイト上の「申請」に置き換える。
3. 有志企画「ナンバー」の練習日程をメンバー限定で管理する。
4. 各自のカレンダーアプリ(Google/Apple)に購読URLで自動反映する。

### 0.3 スコープ外(作らないもの)
- チャット/コメント機能、通知(プッシュ/メール)、施設予約サイトとの直接連携、決済。
- リアルタイム同期(数秒単位)。ページ再読込で最新が見えれば良い。

---

## 1. 用語集

| 用語 | 意味 |
|---|---|
| 期 | 入会年度の代。数値(例: 22)。ユーザー属性。 |
| 1ジャン | メインジャンル。アカウント作成時に決め、**本人は変更不可**(管理者のみ修正可: §6.5.1)。 |
| 2ジャン/3ジャン | サブジャンル。最大2つ。本人がいつでも変更可。 |
| 9ジャンル | BREAK, HIPHOP, POP, LOCK, JAZZ, HOUSE, PUNKING, KRUMP, GIRLS |
| 折衝(係) | 施設予約とコマ割りを担当する係。 |
| 3役 | サークル最上位幹部3名。=管理者。 |
| OB/OG | 卒業生。公式練には参加できないが、ナンバー(縦イベ)には参加できる。§3.6 |
| 縦イベ | OB/OGと現役生が合同で参加するイベント。ナンバーを披露する。 |
| 予約枠 | 施設サイトで実際に取れた予約1件(例: 8/6 剣道場 13:00〜21:30)。 |
| コマ | 予約枠を折衝が分割した時間割の1マス(例: 剣道場 13:00〜14:50 BREAK)。 |
| 公式練 | コマに割り当てられたジャンル練習(旧称: 公式練)。 |
| 空きコマ | 公式練が入っていない使用可能コマ。誰でも申請して使える。 |
| 申請(claim) | 空きコマの使用宣言。従来のLINEノート宣言の置き換え。 |
| 施錠状況ボード | 今日の各練習場所の鍵の状態を○/×で示す掲示板。○=開錠済(そのまま入れる)/×=施錠中(鍵を取りに行く必要あり)。予約とは独立(§6.1.1)。 |
| ナンバー | 有志が主催しメンバーを募って作るショー。**存在自体メンバー外に非公開**。 |
| スタ練 | 各自がレンタルスタジオを借りて行う練習。ナンバー機能側で管理。 |
| ユーザーID(username) | `{期}{1ジャンコード}{名前}` 例: `22BREAKせいあ` |

---

## 2. 技術スタック / 開発環境

| 区分 | 採用 | 備考 |
|---|---|---|
| フロント/サーバー | Next.js 15 (App Router, TypeScript) | Route Handlers をAPIに使用 |
| スタイル | Tailwind CSS | |
| DB/認証/ストレージ | Supabase (PostgreSQL + Auth + Storage) | RLSを全面使用 |
| ホスティング | Vercel | GitHub連携で自動デプロイ。Vercel Cron 使用(§13.4) |
| ソース管理 | GitHub (private リポジトリ) | mainブランチ=本番。§2.2 |
| 主要npm | `@supabase/supabase-js`, `@supabase/ssr`, `papaparse`(CSV解析), `date-fns`, `zod` | |

- 開発は VS Code + Claude Code。GitHubのprivateリポジトリを作成し、直下に本書 `SPEC.md` を置いて参照する。
- タイムゾーンは**全機能 Asia/Tokyo 固定**。DBは `date` / `time` 型で保持し、UTC変換で日付ズレを起こさないこと。

### 2.2 リポジトリ運用とデプロイ
- GitHub private リポジトリ1つ。VercelとGitHubを連携し、**`main` へのpushで本番へ自動デプロイ**(ビルド完了後に無停止で切替。失敗時はVercel管理画面から即ロールバック)。
- ブランチ: `main`(本番) / 作業は `feat/xxx` ブランチを切り、Pull Request経由でmergeする。PRごとにVercelがプレビューURLを発行するので、パイロット参加者への事前確認に使える。
- `.gitignore` に `.env*` を必ず含める。**APIキー・service role keyをコミットしない**(秘密は Vercel の Environment Variables と手元の `.env.local` にのみ置く)。
- DBスキーマ変更は `supabase/migrations/` に連番SQLとして追加し、コードと同じPRで管理する。適用順は**先にDB(マイグレーション適用)→後にコードのデプロイ**とし、無停止で更新する(§13.5)。
- 仕様変更時は**先に本書 `SPEC.md` を更新してから**実装する(文書と実装の乖離防止)。

### 2.1 環境変数(.env.local)
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=        # サーバー専用。クライアントに絶対露出させない
APP_BASE_URL=https://<デプロイURL> # ics内UIDドメイン・購読URL生成に使用
CRON_SECRET=                      # Vercel Cron認証用ランダム文字列
```

---

## 3. ロールと認証

### 3.1 ロール
| role | 対象 | できること |
|---|---|---|
| `ob` | 卒業生(OB/OG) | **タブ②③のみ**。ナンバー作成/所属、マイカレンダー、出欠(ナンバー分)。§3.6 |
| `member` | 現役サークル生 | 上記 + タブ①(全体カレンダー・空き申請・施錠ボード)、公式練の出欠 |
| `coordinator` | 折衝係 + 3役 | 上記 + CSV取込、予約枠/コマの作成編集、公開 |
| `admin` | 3役のみ | 上記 + 全ユーザーの削除/情報変更/パスワードリセット/ロール変更、合言葉変更 |

- 現役側の権限は `admin ⊃ coordinator ⊃ member` の包含で判定する(例: coordinator要求箇所は `role IN ('coordinator','admin')`)。
- `ob` は包含関係の**外**にあり、memberより制限が強い。**OBはcoordinator/adminになれない**(roleの一値として排他表現しているため構造的に不可能)。
- 「現役のみ許可」の判定は `public.app_role() <> 'ob'` を用いる。

### 3.2 アカウント登録(サインアップ)
- **Supabaseの一般サインアップは無効化**し(ダッシュボード: Authentication → Sign In / Up → "Allow new users to sign up" OFF)、登録は必ず自前API `/api/auth/signup` 経由で行う(内部で Admin API `auth.admin.createUser` を使用)。これにより合言葉検証を強制できる。
- 入力項目: 期(数値)、1ジャン(9択)、名前(ひらがな/カタカナ/漢字可)、マイパスワード(8文字以上)、**サークル生合言葉**。
- username は `{期}{ジャンルコード}{名前}` をサーバーで組み立てる。重複時はエラー(同姓同名は名前側で区別してもらう)。
- メールアドレスは使わない。Supabase Auth用にダミーメールを合成する:
  `u_{sha256(username)先頭16桁}@noemail.example.com`(メール確認は無効化: Authentication → Email → "Confirm email" OFF)。
- 合言葉は `app_settings` にbcryptハッシュで保存し、サーバー側で照合する。

### 3.3 ログイン
- username + マイパスワード。サーバーで username→ダミーメールを再合成し `signInWithPassword`。セッション管理は `@supabase/ssr` の標準パターン(cookie)。

### 3.4 ロール昇格
- ログイン済みユーザーが `/api/role/elevate` に「折衝パスワード」or「管理者パスワード」を送る → bcrypt照合 → service roleで `profiles.role` を更新。
- 降格・任意変更は admin が管理画面から実施(service role経由)。

### 3.5 パスワード運用
- 本人によるパスワード変更: ログイン中に旧パスワード確認の上 `auth.updateUser`。
- 忘れた場合: メールが無いため **adminが管理画面から仮パスワードを再設定**(`auth.admin.updateUserById`)。
- 合言葉3種(サークル生/折衝/管理者)は admin 画面から変更可能。**代替わり・卒業時に必ず変更する**運用を画面上に注記として表示する。

---

### 3.6 OB/OGへの移行(v1.6)
**背景**: 卒業後もOB/OGは「縦イベ」(OB/OGと現役の合同イベント)でナンバーを披露するため、ナンバー機能は継続利用する。一方、公式練や練習室の使用は現役の活動であり対象外。そのため**卒業者はアカウント削除ではなくOBへ移行**する。

**移行操作**: adminが管理画面から `role` を `ob` に変更する(単独/複数選択で一括実行可)。確認ダイアログ必須。`admin_audit_logs` に記録。
- coordinator/admin を OB にする場合は、先に降格が必要(またはOB化と同時に降格する旨をダイアログで明示)。
- 誤操作時は admin が `member` に戻せる(復帰も同経路)。

**移行時の自動処理**(サーバー側でトランザクション実行):
1. **未来日の `claims` を削除**(練習室の使用権は現役の活動のため)。過去分は履歴として残す。
2. **未来日の公式練 `attendances`(slot_id側)を削除**。ナンバー分(number_event_id側)は保持。
3. `user_subgenres` を削除(公式練に紐づく設定のため無意味になる)。`main_genre_id` はusernameの一部なので保持する。
4. ナンバー所属(`number_members`)・過去の出欠・購読トークンは**すべて保持**。

**OBができること / できないこと**
| 項目 | OB |
|---|---|
| タブ① 全体カレンダー | **不可**(タブバーに表示しない。URL直打ちは `/me` へリダイレクト) |
| 空き申請 / 施錠ボード | 不可 |
| 公式練の閲覧・出欠 | 不可(マイカレンダー・購読icsにも含めない) |
| タブ② ナンバー | 可(作成・主催・メンバー追加・日程登録すべて可) |
| タブ③ マイカレンダー | 可(ナンバー予定のみ表示) |
| 出欠(ナンバー練) | 可 |
| 購読URL | 可(ナンバー予定のみ含まれる) |
| 名簿への掲載 | される(現役がナンバーに誘えるようにするため。**「OB/OG」バッジを表示**し、名簿検索に「現役のみ/OBのみ/全員」フィルタを設ける。既定は「現役のみ」) |
| 折衝・管理者への昇格 | **不可**(合言葉を入力しても拒否) |
| お知らせ | ナンバー関連のみ受信(`schedule_updated` は配信対象外。出欠の通知は v1.11 で廃止) |

## 4. マスタデータ

### 4.1 ジャンル(9件・固定シード)
`BREAK, HIPHOP, POP, LOCK, JAZZ, HOUSE, PUNKING, KRUMP, GIRLS`(code=表示名。表示順もこの順)

### 4.2 部屋(10件・固定シード)
| section(列グループ) | room name |
|---|---|
| 7号館 | スタジオ101(7号館) |
| フレスコ | 練習室1(フレスコ) |
| フレスコ | 練習室2(フレスコ) |
| フレスコ | 展示・多目的室(フレスコ) |
| 講堂 | リハーサル室 |
| 講堂 | 控室136 |
| 講堂 | 控室132 |
| 講堂 | 控室131 |
| アリーナ | アリーナA |
| アリーナ | アリーナB |
| アリーナ | アリーナC |
| アリーナ | 剣道場(体育館) |

(計12件。①カレンダーの列はこの順で section ごとにグループ表示する)

### 4.3 部屋エイリアス(CSV取込の正規化用シード)
施設サイト上の表記 → rooms への対応表。取込CSVの部屋名はこの表で正規化する。

| alias(施設サイト表記) | 正規部屋 |
|---|---|
| スタジオ101 | スタジオ101(7号館) |
| 第1練習室 / 第1練習室(南大沢文化会館) | 練習室1(フレスコ) |
| 第2練習室 | 練習室2(フレスコ) |
| 展示・多目的室(全面) / 展示・多目的室 | 展示・多目的室(フレスコ) |
| リハーサル室 | リハーサル室 |
| 控室131 / 控室132 / 控室136 | 同名 |
| アリーナA / アリーナB / アリーナC | 同名 |
| 剣道場 | 剣道場(体育館) |

未知の表記が来た場合はエラーにせず「未対応部屋」として確認UIに出し、折衝が手動で正規部屋を選ぶ(選んだ対応は `room_aliases` に保存して学習させる)。

---

## 5. データベース仕様

### 5.1 レイヤ構造(設計思想)
```
第1層 reservations(予約枠)… 施設から借りた事実。CSV取込で作成。
第2層 slots(コマ)        … 折衝が予約枠を分割して作る公式時間割。空きコマも行として持つ。
第3層 claims / numbers系  … 個人の行動(空き申請・ナンバー練)。
```

### 5.2 スキーマ全文(現行)
**本節は「今あるべきスキーマ」を示す**。新規環境はこの全文をそのまま流せば構築できる。

既存環境への適用は `supabase/migrations/` の連番SQLで行う(§2.2)。適用済みのマイグレーションは**後から書き換えない**ため、本節と各ファイルの関係は次のとおり:
- `0001_init.sql` … 初期スキーマ
- `0002_claims_and_room_status.sql` … v1.7 の差分(claims の10分刻みCHECK / room_status の updated_at トリガ)
- `0003_reservations_unique.sql` … v1.7.1 の差分(reservations の active 部分ユニークインデックス)
- `0004_slots_no_overlap.sql` … v1.8.1 の差分(slots の同一予約枠内の排他制約)
- `0005_drop_attendance_notify.sql` … v1.11 の差分(出欠のお知らせトリガを削除)
- `0006_graduate_to_ob.sql` … v1.11.1 の差分(OB移行の自動処理をまとめたDB関数)

本節 = 0001 + 0002 + 0003 + 0004 + 0005 + 0006 を適用した状態。

```sql
-- =========================================================
-- 0001_init.sql  ダンスサークル練習管理  初期スキーマ
-- =========================================================
-- Supabase では拡張が extensions スキーマに入っていることがある。
-- claims の排他制約が btree_gist の演算子クラスを解決できるよう、
-- 両スキーマを検索パスに入れておく(存在しないスキーマ名は無視されるので安全)。
set search_path = public, extensions;

create extension if not exists pgcrypto;

-- 注: RLS ヘルパー関数 (app_role / is_number_member) は、参照するテーブルを
--     作った後でなければ作成できないため、テーブル定義の後・RLS の前に置いてある。
--     language sql の関数は作成時に本体が検証されるため
--     (check_function_bodies は既定 on)、先に書くと 42P01 で失敗する。

-- ---------- マスタ ----------
create table public.genres (
  id smallint primary key,
  code text unique not null,          -- 'BREAK' 等
  sort_order smallint not null
);

create table public.rooms (
  id smallint primary key,
  name text unique not null,
  section text not null,              -- '7号館'/'フレスコ'/'講堂'/'アリーナ'
  sort_order smallint not null
);

create table public.room_aliases (
  alias text primary key,
  room_id smallint not null references public.rooms(id)
);

-- ---------- ユーザー ----------
create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,          -- 22BREAKせいあ
  generation smallint not null,           -- 期
  main_genre_id smallint not null references public.genres(id),
  display_name text not null,             -- 名前部分
  role text not null default 'member' check (role in ('ob','member','coordinator','admin')),
  created_at timestamptz not null default now()
);

create table public.user_subgenres (      -- 2ジャン・3ジャン
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  slot smallint not null check (slot in (2,3)),
  genre_id smallint not null references public.genres(id),
  primary key (user_id, slot)
);

-- ---------- 第1層: 予約枠 ----------
create table public.import_files (
  id uuid primary key default gen_random_uuid(),
  filename text not null,                 -- アップロードされたCSVのファイル名(監査用)
  row_count int not null default 0,       -- 取り込んだ行数
  uploaded_by uuid not null references public.profiles(user_id),
  status text not null default 'pending' check (status in ('pending','confirmed')),
  created_at timestamptz not null default now()
);

create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  import_file_id uuid references public.import_files(id),
  date date not null,
  start_time time not null,
  end_time time not null,
  room_id smallint not null references public.rooms(id),
  status text not null default 'active' check (status in ('active','cancelled')),
  note text,
  created_by uuid not null references public.profiles(user_id),
  created_at timestamptz not null default now(),
  check (start_time < end_time)
);
-- 同一枠の二重取込を DB でも禁止する(§9.4の重複ガードはselect→insertの2段階で、
-- 折衝係2人の同時確定を防げないため)。取消済を取り直すのは正当なので active のみ対象。
create unique index reservations_active_unique
  on public.reservations (date, room_id, start_time, end_time)
  where status = 'active';

-- ---------- 第2層: コマ ----------
create table public.slots (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.reservations(id) on delete cascade,
  date date not null,
  start_time time not null,
  end_time time not null,
  room_id smallint not null references public.rooms(id),
  status text not null check (status in ('genre','open','unavailable')),
  genre_id smallint references public.genres(id),     -- status='genre' のとき必須
  target_generations smallint[],                      -- null=全期対象
  published boolean not null default false,
  note text,
  updated_at timestamptz not null default now(),
  check (start_time < end_time),
  check (status <> 'genre' or genre_id is not null)
);
create index on public.slots (date, room_id);
create index on public.slots (published, date);
-- 同一予約枠内でコマの時間が重ならないことをDB側でも保証する。
-- コマはクライアントからRLS経由で直接書くため、UIの検証だけでは
-- 折衝係2人が同じ枠を同時に編集したときに重なりが通ってしまう。
-- 範囲型は claims と同じ public.timerange を使う (定義は下の claims 節)。
alter table public.slots
  add constraint slots_no_overlap exclude using gist (
    reservation_id with =,
    public.timerange(start_time, end_time) with &&
  );

-- ---------- 第3層: 空き申請(自由時間帯・v1.1変更) ----------
-- 空きコマ(slots.status='open')の範囲内で、開始/終了を自由に選んで申請する。
-- 同一コマ内の時間帯重複は排他制約で禁止(=先着保証)。
create extension if not exists btree_gist;
create type public.timerange as range (subtype = time);

create table public.claims (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references public.slots(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  start_time time not null,
  end_time time not null,
  purpose text,                            -- 用途メモ(任意)
  created_at timestamptz not null default now(),
  check (start_time < end_time),
  exclude using gist (
    slot_id with =,
    public.timerange(start_time, end_time) with &&
  ),
  -- 申請時間の粒度は10分刻み(§6.1・v1.7で15分から変更)。
  -- claims はクライアントから RLS 経由で直接 insert する設計のため、
  -- UI で丸めるだけでは API 直叩きで回避できる。DB でも強制する。
  -- extract(epoch from time) は0時からの秒数。600秒=10分で割り切れるかを見れば
  -- 分の粒度と秒がゼロであることを同時に検証できる。
  constraint claims_ten_minutes check (
    extract(epoch from start_time)::int % 600 = 0
    and extract(epoch from end_time)::int % 600 = 0
  )
);

-- ---------- 第3層: ナンバー ----------
create table public.numbers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references public.profiles(user_id),
  created_at timestamptz not null default now()
);

create table public.number_members (
  number_id uuid not null references public.numbers(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (number_id, user_id)
);

create table public.number_events (
  id uuid primary key default gen_random_uuid(),
  number_id uuid not null references public.numbers(id) on delete cascade,
  date date not null,
  start_time time not null,
  end_time time not null,
  place text not null,                     -- 自由記入(レンタルスタジオ名等)
  note text,
  created_at timestamptz not null default now(),
  check (start_time < end_time)
);

-- 作成者を自動でメンバーに追加
create or replace function public.add_owner_as_member()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.number_members (number_id, user_id) values (new.id, new.owner_id)
  on conflict do nothing;
  return new;
end $$;
create trigger trg_numbers_owner_member
after insert on public.numbers
for each row execute function public.add_owner_as_member();

-- ---------- 購読トークン ----------
create table public.calendar_tokens (
  user_id uuid primary key references public.profiles(user_id) on delete cascade,
  token text unique not null,              -- 32byte以上のURL-safeランダム
  created_at timestamptz not null default now()
);

-- ---------- お知らせ(v1.1追加) ----------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  type text not null check (type in ('number_added','schedule_updated','attendance_updated')),
  title text not null,
  body text,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index on public.notifications (user_id, created_at desc);

-- ナンバー追加時に本人へお知らせを自動生成
create or replace function public.notify_number_added()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (user_id, type, title)
  select new.user_id, 'number_added',
         'ナンバー「' || n.name || '」に追加されました'
  from public.numbers n where n.id = new.number_id
    and new.user_id <> n.owner_id;   -- 作成者本人には出さない
  return new;
end $$;
create trigger trg_notify_number_added
after insert on public.number_members
for each row execute function public.notify_number_added();

-- ---------- 出欠(v1.2追加) ----------
create table public.attendances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  slot_id uuid references public.slots(id) on delete cascade,          -- 公式練の出欠
  number_event_id uuid references public.number_events(id) on delete cascade, -- ナンバー練の出欠
  status text not null check (status in ('absent','late','leave_early')),
  time_value time,   -- late=到着予定時刻 / leave_early=退出予定時刻
  updated_at timestamptz not null default now(),
  check (num_nonnulls(slot_id, number_event_id) = 1),
  check (status = 'absent' or time_value is not null),
  unique (user_id, slot_id),
  unique (user_id, number_event_id)
);
-- 行が無い人=「出席」扱い(デフォルト行は作らない)

-- 出欠のお知らせは v1.11 で廃止した(§6.4.2)。
-- 公式練は参加者が数十人おり、1人が遅刻を登録するだけで同数のお知らせが
-- 生まれていた。出欠の状況は出欠管理窓を開けば分かるため、量に見合わない。
-- (旧: notify_attendance() と trg_notify_attendance。0005 で削除)

-- ---------- 今日の施錠状況ボード(v1.5追加) ----------
-- 各練習場所の「鍵が開いているか」を全員で共有する掲示板。
-- 予約(reservations)や申請(claims)とは独立した、その日限りの手動ステータス。
create table public.room_status (
  date date not null,
  room_id smallint not null references public.rooms(id),
  is_unlocked boolean not null,           -- true=開錠済(○) / false=施錠中(×)
  updated_by uuid not null references public.profiles(user_id),
  updated_at timestamptz not null default now(),
  primary key (date, room_id)
);
-- 行が存在しない = 未設定。UI上は「×(施錠中)」を既定表示とする。
-- 日付をキーに含むため、日付が変わると自動的に×へ戻る(夜間は施錠されている実態と一致。リセット処理不要)。

-- updated_at は default now() だけだと UPDATE で更新されない。
-- §6.1.1「○のまま3時間以上経過したら淡色＋警告」がこの値に依存するため、
-- BEFORE トリガでサーバー時刻を必ず入れる(クライアント送信値は時計ずれ・詐称の余地がある)。
create or replace function public.touch_room_status_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger trg_room_status_touch
before insert or update on public.room_status
for each row execute function public.touch_room_status_updated_at();

-- ---------- 管理操作の監査ログ(v1.4追加) ----------
create table public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.profiles(user_id),
  target_user_id uuid references public.profiles(user_id) on delete set null,
  action text not null,                    -- 'update_profile' / 'reset_password' / 'delete_user' 等
  detail jsonb,                            -- {before:{...}, after:{...}}
  created_at timestamptz not null default now()
);
-- 参照はadminのみ。書込はサーバー(service role)のみ

-- ---------- OB化の自動処理(v1.11.1追加。§3.6) ----------
-- 未来のclaims削除・未来の公式練attendances削除・サブジャンル削除・role更新を
-- **1トランザクションで**行う。supabase-js に複数文をまたぐトランザクションが
-- 無いため、アプリ側で4本に分けると途中失敗で
-- 「OBなのに未来の申請が残る」中途半端な状態が残ってしまう。
-- 一括OB化(§8.9)と単独のロール変更で同じ経路を使う。
create or replace function public.graduate_to_ob(p_user_ids uuid[])
returns int
language plpgsql
as $$
declare
  v_today date := (now() at time zone 'Asia/Tokyo')::date;
  v_count int;
begin
  delete from public.claims c using public.slots s
  where c.slot_id = s.id and c.user_id = any(p_user_ids) and s.date >= v_today;

  delete from public.attendances a using public.slots s
  where a.slot_id = s.id and a.user_id = any(p_user_ids) and s.date >= v_today;

  delete from public.user_subgenres where user_id = any(p_user_ids);

  update public.profiles set role = 'ob'
  where user_id = any(p_user_ids) and role <> 'ob';
  get diagnostics v_count = row_count;

  return v_count;
end;
$$;
-- ログイン中のユーザーからは呼べないようにする(adminの判定はAPI側)
revoke all on function public.graduate_to_ob(uuid[]) from public;
revoke all on function public.graduate_to_ob(uuid[]) from anon, authenticated;
grant execute on function public.graduate_to_ob(uuid[]) to service_role;

-- ---------- 設定(合言葉ハッシュ等) ----------
create table public.app_settings (
  key text primary key,                    -- 'signup_pass' / 'coordinator_pass' / 'admin_pass'
  value_hash text not null,                -- bcrypt
  updated_at timestamptz not null default now()
);

-- =========================================================
-- 権限 (GRANT)
-- Supabase の既定権限に依存せず、このマイグレーション単体で完結させる。
--
-- 二段構えになっている点に注意:
--   GRANT  = 「テーブルに触れるか」というテーブル単位の許可
--   RLS    = 「どの行に触れるか」という行単位の許可
-- authenticated には GRANT を広めに与え、**実際の可否は RLS ポリシーで決める**
-- (Supabase の標準的な設計)。ポリシーを持たないテーブル
-- (app_settings / calendar_tokens) は RLS が全拒否するため、
-- GRANT があってもクライアントからは一切読めない。
-- =========================================================
grant usage on schema public to anon, authenticated, service_role;

-- service_role: サーバー専用。RLS をバイパスして全操作できる
grant all privileges on all tables    in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;

-- authenticated: ログイン済みユーザー。行の可否は RLS が決める
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- anon(未ログイン)にはテーブル権限を与えない。
-- 認証不要なのは購読ics (§8.6) だけで、そこは service_role で処理するため。

-- 今後このスキーマに追加するテーブルにも同じ権限が付くようにしておく
alter default privileges in schema public
  grant all privileges on tables to service_role;
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;

-- =========================================================
-- RLS ヘルパー
-- 参照先テーブルが揃ってから作る必要があるため、ここに置く(冒頭の注記を参照)
-- =========================================================
-- ログインユーザーのロール取得(RLS内で使用)
create or replace function public.app_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where user_id = auth.uid()
$$;

-- ナンバーのメンバー判定(RLS再帰回避のため security definer)
create or replace function public.is_number_member(p_number uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.number_members
    where number_id = p_number and user_id = p_user
  )
$$;

-- =========================================================
-- RLS
-- =========================================================
alter table public.genres          enable row level security;
alter table public.rooms           enable row level security;
alter table public.room_aliases    enable row level security;
alter table public.profiles        enable row level security;
alter table public.user_subgenres  enable row level security;
alter table public.import_files    enable row level security;
alter table public.reservations    enable row level security;
alter table public.slots           enable row level security;
alter table public.claims          enable row level security;
alter table public.numbers         enable row level security;
alter table public.number_members  enable row level security;
alter table public.number_events   enable row level security;
alter table public.notifications   enable row level security;
alter table public.attendances     enable row level security;
alter table public.room_status     enable row level security;
alter table public.admin_audit_logs enable row level security;
alter table public.calendar_tokens enable row level security;  -- ポリシー無し=クライアント全拒否
alter table public.app_settings    enable row level security;  -- 同上(service roleのみ)

-- マスタ: ログイン者は読み取り可
create policy sel_genres on public.genres  for select to authenticated using (true);
create policy sel_rooms  on public.rooms   for select to authenticated using (true);
create policy sel_alias  on public.room_aliases for select to authenticated
  using (public.app_role() in ('coordinator','admin'));
create policy ins_alias  on public.room_aliases for insert to authenticated
  with check (public.app_role() in ('coordinator','admin'));

-- profiles: 名簿として全員読める。更新は本人(display_nameのみ列権限で許可)
create policy sel_profiles on public.profiles for select to authenticated using (true);
create policy upd_profiles on public.profiles for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke update on public.profiles from authenticated;
grant  update (display_name) on public.profiles to authenticated;
-- insert/delete/role変更はservice role(API)経由のみ

-- user_subgenres: 読みは全員、書きは本人
create policy sel_subg on public.user_subgenres for select to authenticated using (true);
create policy mod_subg on public.user_subgenres for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- import_files / reservations: 折衝以上のみ
create policy all_imports on public.import_files for all to authenticated
  using (public.app_role() in ('coordinator','admin'))
  with check (public.app_role() in ('coordinator','admin'));
create policy all_resv on public.reservations for all to authenticated
  using (public.app_role() in ('coordinator','admin'))
  with check (public.app_role() in ('coordinator','admin'));

-- slots: 公開済は現役のみ閲覧可(OBは公式練を見られない) / 下書き含む全操作は折衝以上
create policy sel_slots_pub on public.slots for select to authenticated
  using (
    (published = true and public.app_role() <> 'ob')
    or public.app_role() in ('coordinator','admin')
  );
create policy mod_slots on public.slots
  for all to authenticated
  using (public.app_role() in ('coordinator','admin'))
  with check (public.app_role() in ('coordinator','admin'));

-- claims: 全員閲覧可(全体カレンダーに表示するため)。
-- 申請は本人のみ・公開済openコマのみ。取消は本人 or 折衝以上。
create policy sel_claims on public.claims for select to authenticated
  using (public.app_role() <> 'ob');
create policy ins_claims on public.claims for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.app_role() <> 'ob'
    and exists (select 1 from public.slots s
                where s.id = slot_id and s.published and s.status = 'open'
                  and s.start_time <= claims.start_time
                  and claims.end_time <= s.end_time)
  );
create policy del_claims on public.claims for delete to authenticated
  using (user_id = auth.uid() or public.app_role() in ('coordinator','admin'));

-- attendances: 公式練分は全員閲覧可 / ナンバー練分はメンバーのみ。書込は本人かつ参加者のみ
create policy sel_att on public.attendances for select to authenticated
  using (
    slot_id is not null
    or exists (select 1 from public.number_events e
               where e.id = number_event_id
                 and public.is_number_member(e.number_id, auth.uid()))
  );
create policy mod_att on public.attendances for all to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and (
      (slot_id is not null and public.app_role() <> 'ob' and exists (
         select 1 from public.slots s
         where s.id = slot_id and s.published and s.status = 'genre'
           and (s.genre_id = (select main_genre_id from public.profiles p where p.user_id = auth.uid())
                or s.genre_id in (select genre_id from public.user_subgenres g where g.user_id = auth.uid()))
           and (s.target_generations is null
                or (select generation from public.profiles p where p.user_id = auth.uid())
                   = any(s.target_generations))))
      or
      (number_event_id is not null and exists (
         select 1 from public.number_events e
         where e.id = number_event_id
           and public.is_number_member(e.number_id, auth.uid())))
    )
  );

-- room_status: 全員が閲覧・切替可(鍵を開けた人/閉めた人が誰でも更新できる仕様)。
-- ただし updated_by は必ず本人(なりすまし防止)、変更できるのは当日分のみ。
create policy sel_rstatus on public.room_status for select to authenticated
  using (public.app_role() <> 'ob');
create policy ins_rstatus on public.room_status for insert to authenticated
  with check (updated_by = auth.uid() and public.app_role() <> 'ob'
              and date = (now() at time zone 'Asia/Tokyo')::date);
create policy upd_rstatus on public.room_status for update to authenticated
  using (date = (now() at time zone 'Asia/Tokyo')::date and public.app_role() <> 'ob')
  with check (updated_by = auth.uid() and public.app_role() <> 'ob'
              and date = (now() at time zone 'Asia/Tokyo')::date);

-- admin_audit_logs: adminのみ閲覧。書込はservice roleのみ(ポリシー無し)
create policy sel_audit on public.admin_audit_logs for select to authenticated
  using (public.app_role() = 'admin');

-- notifications: 本人のみ閲覧・既読化。生成はトリガ/サーバーのみ
create policy sel_notif on public.notifications for select to authenticated
  using (user_id = auth.uid());
create policy upd_notif on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- numbers系: メンバーのみ存在を知れる
create policy sel_numbers on public.numbers for select to authenticated
  using (public.is_number_member(id, auth.uid()));
create policy ins_numbers on public.numbers for insert to authenticated
  with check (owner_id = auth.uid());
create policy mod_numbers on public.numbers for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy del_numbers on public.numbers for delete to authenticated
  using (owner_id = auth.uid() or public.app_role() = 'admin');

create policy sel_nmembers on public.number_members for select to authenticated
  using (public.is_number_member(number_id, auth.uid()));
create policy ins_nmembers on public.number_members for insert to authenticated
  with check (exists (select 1 from public.numbers n
                      where n.id = number_id and n.owner_id = auth.uid()));
create policy del_nmembers on public.number_members for delete to authenticated
  using (
    user_id = auth.uid()  -- 自主脱退
    or exists (select 1 from public.numbers n
               where n.id = number_id and n.owner_id = auth.uid())
  );

create policy sel_nevents on public.number_events for select to authenticated
  using (public.is_number_member(number_id, auth.uid()));
create policy mod_nevents on public.number_events for all to authenticated
  using (exists (select 1 from public.numbers n
                 where n.id = number_id and n.owner_id = auth.uid()))
  with check (exists (select 1 from public.numbers n
                      where n.id = number_id and n.owner_id = auth.uid()));

-- =========================================================
-- シード
-- =========================================================
insert into public.genres (id, code, sort_order) values
 (1,'BREAK',1),(2,'HIPHOP',2),(3,'POP',3),(4,'LOCK',4),(5,'JAZZ',5),
 (6,'HOUSE',6),(7,'PUNKING',7),(8,'KRUMP',8),(9,'GIRLS',9);

insert into public.rooms (id, name, section, sort_order) values
 (1,'スタジオ101(7号館)','7号館',1),
 (2,'練習室1(フレスコ)','フレスコ',2),
 (3,'練習室2(フレスコ)','フレスコ',3),
 (4,'展示・多目的室(フレスコ)','フレスコ',4),
 (5,'リハーサル室','講堂',5),
 (6,'控室136','講堂',6),
 (7,'控室132','講堂',7),
 (8,'控室131','講堂',8),
 (9,'アリーナA','アリーナ',9),
 (10,'アリーナB','アリーナ',10),
 (11,'アリーナC','アリーナ',11),
 (12,'剣道場(体育館)','アリーナ',12);

insert into public.room_aliases (alias, room_id) values
 ('スタジオ101',1),
 ('第1練習室',2),('第2練習室',3),
 ('展示・多目的室(全面)',4),('展示・多目的室',4),
 ('リハーサル室',5),('控室136',6),('控室132',7),('控室131',8),
 ('アリーナA',9),('アリーナB',10),('アリーナC',11),('剣道場',12);
```

### 5.3 Storage
- **不要**(v1.3でスクショ保存を廃止)。CSVはサーバーで解析するだけで保存しない(ファイル名と行数のみ `import_files` に監査記録)。Supabase Storageは使用しない。

---

## 6. 機能仕様

### 6.0 タブ構造(v1.1・全カレンダー共通)
アプリ本体は下部固定タブバーで3画面を切り替える(代表デザイン準拠)。
- タブ① 全体カレンダー(ジャンル練+空き申請) … §6.1
- タブ② ナンバーカレンダー … §6.3
- タブ③ マイカレンダー … §6.4

**OB/OGの表示(v1.6)**: `role='ob'` のユーザーにはタブ①を表示せず、**タブ②③の2タブ構成**とする。初期表示はタブ③。`/`(タブ①)へのURL直打ちは `/me` へリダイレクトする。

**共通ナビゲーションパターン**: どのタブも入口は「月のミニカレンダー」。
- 予定が存在する日にドット表示(タブ①=公開slotsのある日 / タブ②=所属ナンバーの予定がある日)。**タブ③のみドットではなく予定ラベルを表示する**(件数が少なく内容まで一覧できるため。v1.7で変更。§6.4)。
- 日付タップでその日の詳細ビューへ(詳細の形式はタブごとに異なる。下記)。
- 月送り(前月/翌月スワイプまたは矢印)。初期値=当日を含む月・当日選択。

### 6.1 タブ① 全体カレンダー(全員閲覧)
折衝が公開した `slots` と申請 `claims` を表示する。

**日別詳細ビュー(日付タップ後)**
- **列=練習場所、行=時間**のグリッド(v1.1で日単位表示に変更。Excel表の1日分に相当)。
- 列: `rooms` を section ごとにグループ化した固定順(§4.2)。その日に slot が1件も無い部屋列は非表示にして幅を節約。
- 行: 09:00〜22:00 の時間軸(30分刻みの目盛)。slot は開始〜終了の長さを持つブロックとして描画(Appleカレンダーのタイムライン様式)。
  - `status='genre'` → ジャンル色ブロック+ジャンルコード。`target_generations` があれば「(22期)」付記。
  - `status='open'` → 枠内をさらに分割表示: 申請済の時間帯は申請者username入りブロック、残りは「空き」ブロック(タップで申請へ)。
  - `status='unavailable'` → グレー「×」ブロック。
- ブロックタップで詳細モーダル(時間、部屋、ジャンル/申請者、note、自分の申請なら取消ボタン)。
- 横スクロール可。時間軸列は sticky 固定。

**空き申請フロー(v1.1: 自由時間帯)**
1. 空きブロックをタップ → 申請シートを表示。対象部屋の当日タイムバー(9〜22時)を描画し、不可・公式練・申請済は塞がった表示、空き範囲内で開始/終了をドラッグまたはプルダウン選択(**10分刻み**。v1.7で15分から変更)。
2. 選択範囲は親の空きコマ内に収まり、既存 claims と重ならないことをクライアントで即時検証(視覚的に選べないようにする)。
3. 確認画面(代表デザイン準拠): 名前(自動)/申請場所/申請日時/申請内容(用途メモ)→「はい/いいえ」→ `claims` insert。
4. 排他制約(§5.2)により同時申請の重複はDBで必ず片方が失敗する。失敗時は「その時間帯は先に申請が入りました」と表示して最新状態を再取得。
5. 自分の申請はタブ③と購読icsに自動反映。取消は本人(折衝以上も可)。

#### 6.1.1 「今日の練習場所」施錠状況ボード(v1.5追加)
タブ①の**最上部に常時表示**するカード(ミニカレンダーより上)。選択中の日付に関わらず、常に**今日**の状況を示す。

**目的**: 練習場所は施錠されており、入室には鍵の受け取りが必要。「今その部屋の鍵が開いているか」を全員で共有し、**鍵を取りに行く手間が要るかどうか**を一目で分かるようにする。

**意味**
- `×` = **施錠中**。入室するには鍵を取りに行く必要がある。
- `○` = **開錠済**。誰かが既に開けているので、そのまま入れる。

**表示**
- 行に**今日の練習場所**を並べる。対象は「今日、公開済み `slots` が1件以上ある部屋」を §4.2 の順で表示(該当0件なら「今日は練習場所の予約がありません」と表示しカードを畳む)。
- 各行の右に○/×トグルボタン。`room_status` に行が無い部屋は**既定で `×`(施錠中)**として表示する。
- 各行に最終更新情報を小さく添える(例: `14:32 22BREAKせいあ`)。誰が開け閉めしたかが分かることで、鍵の所在を追える。

**操作**
- **誰でも**タップで切替可能(権限による制限なし)。タップ即保存(upsert)、確認ダイアログなし。
  - 鍵を開けた人: `×` → `○` に切り替える
  - 鍵を閉めた人: `○` → `×` に切り替える
- 保存時に `updated_by` は必ず操作者本人、`date` は当日固定(RLSで強制)。
- 競合は後勝ち(last-write-wins)。誤りは誰でもすぐ戻せるため許容する。
- お知らせ通知は**発生させない**(切替が頻繁なため通知過多になる)。

**更新の鮮度**
- カードは**60秒ごとに自動再取得**し、画面上部に「最終取得 HH:MM」を表示。手動更新(引っ張って更新)にも対応する。
- `○`(開錠済)のまま最終更新から3時間以上経過した行は淡色表示にし、`(情報が古い可能性)` を添える。閉錠後に×へ戻し忘れた状態を、行って空振りする前に気付けるようにする。×側にはこの警告を出さない(既定値であり実害がないため)。

**独立性(重要)**
- このボードは鍵の状態を共有する掲示板であり、`slots` / `claims` / 出欠には一切影響しない。×でもその部屋の予約・申請は有効なまま(鍵を取りに行けば使える)。日付が変われば全部屋が自動的に×(施錠中)に戻る。

#### 6.1.2 「部室の鍵の所持」ボード(v1.12追加)
タブ①の**施錠状況ボード(§6.1.1)とミニカレンダーの間**に置くカード。

**目的**: 部室の鍵は1本しかなく、手渡しで回っている。今どこにあるかが分からないと部室が開けられないため、**現在の所持者を全員に公開する**。

**表示**
- 現在の所持者の username と、いつから持っているか(例: `22BREAKせいあ / 8/20 18:32 から`)。
- 記録が1件も無ければ「まだ登録されていません」と出す。
- 直近の受け渡し履歴を折りたたみで数件添える。行方が分からなくなったとき、最後に持っていた人からたどれるようにするため。

**操作**
- 「**私が部室の鍵を持っています**」ボタン。押すと自分が所持者になり、全員の画面に反映される。
- **前の所持者の操作は要らない**(受け取った人が押すだけで完了する)。渡す側と受け取る側の両方に操作を求めると、片方が忘れた時点で表示が止まるため。
- 自分が既に所持者として表示されているときはボタンを押せない(押しても何も変わらないため)。
- 確認ダイアログを出す。誤タップで所持者が入れ替わると、実際に鍵を持っている人が分からなくなるため。

**記録の持ち方**
- 1行を書き換えるのではなく、**受け渡しのたびに1行追加**する(`club_key_holders`)。現在の所持者は `taken_at` が最新の行。履歴が残り、同時操作の競合も考えなくてよい。
- 施錠状況ボードと違い**日付でリセットしない**。鍵は日をまたいで同じ人が持っているのが普通のため。
- 書き込めるのは**自分が持っていること**だけ(RLSで `user_id = auth.uid()` を強制)。他人を所持者にはできない。
- 更新・削除はできない。押し間違えたら正しい人がもう一度押せばよい。
- お知らせ通知は**発生させない**(§6.1.1 と同じ理由)。

**独立性**: 施錠状況ボード(§6.1.1)とは別物。あちらは「練習場所が今開いているか」、こちらは「部室の鍵を誰が持っているか」で、互いに影響しない。

### 6.2 折衝ワークフロー(coordinator以上)
`/coordinator` 配下。3ステップ構成。

**Step1: CSV取込(v1.3)**
0. 事前作業(サイト外): 折衝係が予約完了ページのスクショを**自前のAI**(ChatGPT/Claude等の個人利用)に読ませ、§9.2のテンプレート形式のCSVを出力させる。画面には手順とコピー用プロンプトを常時表示する(§9.3)。
1. そのCSVファイルをアップロード(複数可) → `/api/import/parse` が解析 → `import_files` 行作成。ファイル自体は保存しない。
2. 解析結果を予約行の配列 `{date, start, end, room_raw}` として受け取る(§9)。
3. 確認画面: 読み取り結果を**月まとめタイムライン**で表示する(v1.8)。**縦=日付×部屋 / 横=時刻**の1行1予約枠で、1ヶ月ぶんの取込を1画面で見渡せる。日付・時刻の読み取りミスや抜け・重複がひと目で分かることを狙う。
   - ブロックをタップすると日付/時刻/部屋の編集パネルが開く。行の追加/削除/修正が可能。
   - 時刻や日付が不正でタイムラインに置けない行、および部屋が未解決の行は、タイムラインの**上に「要修正」カードとして並べ**、その場で直させる。要修正が1件でも残っていれば確定させない。
   - `room_raw` は `room_aliases` で正規化。未知の表記は赤くハイライトし、部屋プルダウンで手動選択 → 選択結果を `room_aliases` に保存(次回から自動)。
   - 同一(日付・部屋)で時間が重なるブロックは警告表示する。施設側ではありえない状態であり、読み取りミスの可能性が高いため。ただし確定は妨げない(折衝係の判断を優先する)。
4. 「確定」→ `reservations` に一括insert、`import_files.status='confirmed'`(row_count更新)。
   - 重複ガード: 同一 (date, room_id, start_time, end_time) の active な既存行があればスキップし件数を表示。

**Step2: コマ割りエディタ**
1. 月を選ぶと、その月の予約枠を**月まとめタイムライン**で表示する(v1.9)。**縦=日付×部屋(予約枠) / 横=時刻**で、Step1の確認画面と同じ見方。1ヶ月ぶんのコマ割り状況を1画面で見渡せ、埋め残しがひと目で分かる。
   - **曜日の絞り込み(v1.9.1)**: 公式練は月・水・木にしか入らないため、既定でこの3曜日だけを表示する。ただし**完全に隠しはしない** — 他の曜日の予約枠にも「空き」コマを置いて個人練に開放したい場合があるので、「すべての曜日」に切り替えられるようにし、**隠している件数を必ず表示する**。
2. **この月の対象期(v1.9)**: ページ最上部で対象期を複数選択する。**対象期は月単位で決まる**ため、コマごとには設定しない。
   - ここを変えると、**その月の公式練コマすべてに即時反映される**。
   - 未選択=全期。新しく作るコマにもこの選択が入る。
3. コマ追加: タイムラインの「未割当」区間をタップすると、その時刻を開始としてコマ作成が開く。長さは**プリセット(70分・90分・110分)または手入力**。状態(公式練/空き/使用不可)、ジャンルを選ぶ。
4. バリデーション: コマは親予約枠の時間内に収まる。同一予約枠内のコマ同士は時間が重ならない。**重なりは`slots`の排他制約でDB側でも禁止する**(§5.2)。
5. 予約枠のうちコマ未設定の時間帯はタイムライン上「未割当」として破線で表示する。**編集中はDB行を作らず**、公開時に自動で「空き」コマになる(下記Step3 / v1.9.2)。公開済コマと下書きコマは見た目で区別する。
6. **予約枠の取消(v1.8.1)**: タイムラインの各予約枠(行ラベル)に取消ボタンを置く。取込確定後に読み取りミスに気付いたときの唯一の訂正手段。
   - `reservations.status='cancelled'` にすると同時に、**ぶら下がるコマを削除する**。状態だけ変えるとコマが公開カレンダーに残り続けるため。
   - コマや空き申請がぶら下がっている場合は件数と申請者名を出して確認を取る(公開済コマの変更と同じ扱い。下記Step3参照)。
   - 取り消した枠と同じ(日付・部屋・時間)を再度取り込むことは可能(§9.4のユニークインデックスは`status='active'`のみが対象)。

**Step3: 公開**
- **未割当の自動「空き」化(v1.9.2)**: 公開の直前に、その月の予約枠のうちコマが割り当てられていない時間帯を `status='open'` のコマとして自動生成する。
  - 理由: 申請は `claims.slot_id` が指す公開済の `open` コマにしか付けられないため、コマを作らない限り**予約している部屋がタブ①に列すら出ず、空き申請ができない**。予約枠は全日程・全部屋にわたるので、折衝係が1件ずつ「空き」を置く運用は現実的でない。
  - **予約した=使える**を既定とする。個人練に開放したくない時間帯は、折衝係が明示的に「使用不可」コマを置いて塞ぐ。
  - 申請の最小粒度(10分・§6.1)に満たない隙間はコマを作らない(申請できないため)。
  - 生成件数は公開前の確認と結果に表示する。
- 月単位で「この月の下書きコマを一括公開」ボタン → 対象 slots の `published=true`。同時に全ユーザーへ `schedule_updated` のお知らせを一括insert(公開済月の再公開時は「更新されました」文言)。
- 公開後の修正も可(即時反映)。公開済コマを `open` から他へ変更する際、既にその時間帯に `claims` があれば警告を出し、続行時は該当 claim を削除して申請者名を表示する(手動連絡を促す)。

### 6.3 タブ② ナンバーカレンダー(完全メンバー制)
**カレンダービュー(タブのメイン)**: ミニカレンダー(所属ナンバーの予定がある日にドット)→ 日付タップで縦タイムライン(行=時間軸のみ、列なし。Appleカレンダー様式)。**時間軸は既定 09:00〜22:00 だが、そこに収まらない予定がある日は 00:00〜24:00 の全時間帯にする**(v1.11。深夜練が端で切れて見えなくなるのを防ぐ)。各予定ブロックに「ナンバー名 @場所」を表示。ナンバーごとに色を自動割当。
画面上部に「ナンバー管理」ボタン → 従来どおりの管理画面群(`/numbers`)へ。

- **一覧・検索ページは作らない**。`/numbers` には自分が所属するナンバーだけが並ぶ。非メンバーには存在自体不可視(RLSで強制)。
- 作成: 名前を入力 → `numbers` insert(作成者=owner、トリガでメンバーに自動追加)。**OBも作成・主催できる**(縦イベ用)。
- メンバー管理(ownerのみ): 名簿(profiles全件、期/1ジャン/名前/**現役・OB**で検索・絞込)から選んで追加。OB/OGには一覧上でバッジを表示し、既定フィルタは「現役のみ」。縦イベ用にOBを誘う場合はフィルタを切り替える。削除も可。メンバーの自主脱退も可。
- 日程管理(ownerのみ): 日付・開始・終了・場所(自由記入)・メモで `number_events` を追加/編集/削除。**①のslotsとは無関係**。スタ練もここに登録する。
- **ナンバーの削除(ownerのみ・v1.10)**: メンバーと日程も一緒に消える(`on delete cascade`)。メンバー全員の予定と購読icsから消えるため、メンバー数・日程数を出して確認を取る。誤操作の影響が大きいので確認は名前の一致で行う。
- メンバーの画面: 日程が閲覧できるのみ。追加通知は行わない(LINEで周知済みの前提。次回ログイン時にマイカレンダーへ現れる)。

### 6.4 ③ マイカレンダー
`/me`。以下を日付順の縦リストで統合表示(行=日時、列なし)。

**抽出ロジック(表示・ics共通。これを単一のクエリ/関数 `getMyEvents(userId, from, to)` に実装)**
0. **OB(`role='ob'`)の場合は 3 のみ**を対象とする(公式練・空き申請は含めない)。以下1〜2は現役のみ。
1. 公式練: `slots` where `published=true` and `status='genre'` and `genre_id ∈ {自分の1ジャン+2ジャン+3ジャン}` and (`target_generations is null` or 自分の期 = any)。
   - **同じ日・同じジャンル・同じ時間帯のコマが複数の部屋にある場合は1件にまとめる**(v1.12)。1回の練習に部屋を2つ押さえることがあり、コマは部屋ごとに1行できるため、そのままでは自分の予定と購読カレンダーに同じ練習が2件並ぶ。場所は`練習室1・練習室2`のように部屋の既定順で併記する。
   - **まとめるのは開始・終了が完全に一致するときだけ**。部分的な重なりでまとめると、まとめ後の時間帯が実際より長くなり「19:30に終わるはずが20:00と表示される」ことになる。
   - まとめた予定の代表IDは**元コマのIDを並べ替えた先頭**に固定する。ics の UID に使うため、取得順で変わると購読側で予定が消えて再登場してしまう(§10)。
2. 自分の空き申請: `claims` where `user_id=自分` join slots(published)。時刻は claims 自身の start/end を用いる。
3. ナンバー練: `number_events` where 自分がメンバー(RLSが自動で絞る)。

**画面構成(v1.1・代表デザイン準拠。上から順に)**
1. **今日の予定カード**: 当日分の自分のイベントを時刻順リスト(例: `18:00〜19:30 PUNKING 公式練 @リハーサル室`)。0件なら「今日の予定はありません」。
2. **お知らせカード**: `notifications` の**未読のみ**を新しい順に表示。タップで既読化(`read_at`更新)し、**リストから消す**(v1.10)。**カードの高さは固定し、件数が多いときは枠の中でスクロールさせる**(v1.11) — 伸びると下のカレンダーまで延々とスクロールすることになるため。既読が淡色で残り続けると、その下のカレンダーが遠くなるだけで読む価値が無いため。未読が0件ならカードごと出さない。種類は
   - `number_added`: 他者が作ったナンバーに自分が追加された(トリガで自動生成)
   - `schedule_updated`: 折衝が月を公開/公開済コマを変更した(公開APIが全ユーザーへ一括insert。文言例「8月の練習日程が更新されました」)
   - ~~`attendance_updated`~~: **v1.11で廃止**。出欠の変更では通知しない(§6.4.2)
3. **絞り込みチップ**(横スクロール・v1.10): `すべて / {自分の1〜3ジャン} / 空き申請 / {所属ナンバー名}…`。**ジャンル単位・ナンバー単位まで細かく絞れる**こと(「今週のBREAKだけ見たい」に応えるため)。ジャンルは自分の1〜3ジャンを固定で並べる(その月に予定が無いジャンルもチップは出す。絞り込まれているのか予定が無いのか区別できなくなるため)。OBにはジャンルと空き申請のチップを出さない。選択状態はローカル保存。
4. **ミニカレンダー**(チップの絞り込みを反映)。**各日のマスに予定ラベルを表示する**(v1.7で変更。ドットではなく`18:00 PUNKING`のように時刻＋名称を並べる。マスに入りきらない場合は末尾に`+N件`)。→ 日付タップで縦タイムライン(行=時間軸のみ、列なし。時間軸の扱いは§6.3と同じでv1.11の全時間帯対応を含む)。予定ブロックのタップで出欠管理窓(§6.4.2)。
5. ヘッダ右上のプロフィールアイコン → **設定画面**(§6.4.1)。

#### 6.4.2 出欠管理窓(v1.2追加)
タブ③の日別タイムラインで予定ブロックをタップすると開くモーダル。対象は**公式練とナンバー練**(空き申請・他人の申請は対象外=通常の詳細表示のみ)。タブ②の日別ビューのナンバー練ブロックからも同じ窓を開ける。

**表示(上部): 参加者と出欠状況の一覧**
- 参加者の定義: 公式練=そのジャンルを1〜3ジャンに持ち、対象期に該当する全メンバー / ナンバー練=そのナンバーのメンバー。
- 各行: username + 状態バッジ。attendances に行が無い人は「出席」(既定)。登録済みは「欠席」「遅刻 15:00」「早退 15:00」のように表示。

**操作(下部): 自分の出欠登録**
- ボタン3つ: 「欠席」「遅刻」「早退」。
- 「遅刻」「早退」を押すと、そのボタン横に時刻入力欄が展開(**1分刻みの自由入力**。v1.11で15分刻みプルダウンを廃止 — 実際の到着・退出時刻は15分刻みに乗らないため)。例: 15時に帰る → 「早退」+「15:00」。
- 「欠席」は時刻不要で即登録(確認ダイアログあり)。
- 登録済みの自分の状態は選び直しで上書き、「出席に戻す」で取消(行削除)。出席の人は何も操作しなくてよい。
- **お知らせは出さない(v1.11で廃止)**。1件の変更で参加者全員に通知が飛び、量に見合う価値が無いため。出欠の状況はこの窓を開けば分かる。`attendances` のトリガ `trg_notify_attendance` は削除する(§5.2)。

**まとめた公式練の扱い(v1.12)**: §6.4-1 で複数の部屋を1件にまとめた場合も、**出欠は部屋ごとのコマ(`slot_id`)に紐づいている**。読むときは元のコマ全部を対象にし(1人が複数行を持っていたら1つに畳む)、**書くときは代表のコマに寄せて、他のコマに残っている自分の行は消す**。寄せないと1人が2行持ち、取り消しても片方が残る。

**権限**: 自分の出欠のみ登録・変更可。ナンバー練の出欠状況は非メンバーには一切見えない(ナンバー秘匿と同水準)。OBはナンバー練の出欠のみ登録でき、公式練の出欠窓は表示されない(そもそも公式練が表示されないため)。

#### 6.4.1 設定画面(プロフィールアイコンから)
- サブジャンル設定: 2ジャン/3ジャンのプルダウン(1ジャンと重複不可、空も可)。変更即保存。**OBには表示しない**(公式練に紐づく設定のため)。
- 購読URL欄: webcal/https 両形式のURL表示、コピー、**再発行ボタン**(旧トークン即無効化。確認ダイアログ付き)。Google/Apple での登録手順を折りたたみで併記。
- **表示テーマの切り替え(v1.13)**: ライトモード(白背景)/ ダークモード(グレー背景)の2択。押した瞬間に切り替わり、この端末にだけ保存される(§12)。
- パスワード変更、ロール昇格(合言葉入力)、ログアウト。

### 6.5 管理者機能
`/admin`(adminのみ)。
- ユーザー一覧(検索: 期/ジャンル/名前/**現役・OB**)。各行: ロール変更、表示名変更、**1ジャン修正・期修正(§6.5.1)**、**OB/OGへ移行・現役へ復帰(§3.6)**、仮パスワード再設定、アカウント削除(auth.users削除→cascade)。
- **卒業処理は原則「OBへ移行」**を用いる(削除は誤登録アカウントの整理などに限る)。期を指定して複数人を一括OB化できるUIを用意する。
- 合言葉変更(3種)。入力→bcryptハッシュ化→`app_settings` upsert。
- 削除・降格の操作は確認ダイアログ必須。自分自身のadmin剥奪と自己削除は禁止(最後のadmin消失防止)。**自分の行ではロール欄自体を操作不可にする**(押せるのに毎回断られる作りにしない)。
- 在籍の絞り込みの既定は**「現役のみ」**(§3.6の名簿検索と揃える)。OB行には「OB/OG」バッジを出す。
- 保存しても一覧は引き直さない。数十人の一覧で開いた行と読んでいた位置が先頭に戻ると操作が続かないため、返ってきた値で該当行だけ差し替える。
- 仮パスワードは発行後にその場で表示する(再表示できないため画面から消さない)。削除は確認ダイアログに加えて**「削除」と入力**させる(ロール変更と違い元に戻せないため)。

#### 6.5.1 1ジャン・期の修正(v1.4追加)
登録時の入力ミス救済および代替わり対応のため、**adminのみ** `profiles.main_genre_id` と `profiles.generation` を修正できる。本人および coordinator は変更不可。

**挙動**
- 修正時、`username` をサーバー側で `{期}{1ジャンコード}{表示名}` に**自動再生成**して同時更新する(表示名変更時も同様)。再生成後のusernameが既存と重複する場合は409で拒否し、表示名の調整を促す。
- 確認ダイアログに「変更後のログインIDは `23HIPHOPせいあ` になります。本人へ必ず連絡してください」と新IDを明示する。
- ユーザーの内部識別子は `user_id`(UUID)であり username ではないため、**過去の申請・出欠・ナンバー所属・購読URLはすべて維持される**(データ欠損なし)。
- 1ジャン変更により、その人のマイカレンダー・購読ics・公式練の出欠対象が新ジャンルに切り替わる(次回取得時に反映)。
- サブジャンル(2/3ジャン)に新しい1ジャンと同じジャンルが登録されていた場合は、重複を避けるため当該サブジャンル行を自動削除する。
- 監査のため、変更内容(旧値→新値・実行者・日時)を `admin_audit_logs` に記録する。

---

## 7. 画面一覧・ルーティング

| パス | 権限 | 内容 |
|---|---|---|
| `/login` | 公開 | username+パスワード |
| `/signup` | 公開 | §3.2 の登録フォーム |
| `/` | member(**OB不可**) | タブ① 全体カレンダー(§6.1)。OBは `/me` へリダイレクト |
| `/number-cal` | member + ob | タブ② ナンバーカレンダー(§6.3) |
| `/me` | member + ob | タブ③ マイカレンダー(§6.4) |
| `/settings` | member + ob | 設定(§6.4.1)。OBはサブジャンル設定を非表示 |
| `/numbers` | member + ob | ナンバー管理: 所属一覧 + 新規作成(タブ②から遷移) |
| `/numbers/[id]` | メンバーのみ | 日程一覧。ownerには編集UI・メンバー管理タブ |
| `/coordinator` | coordinator | Step1〜3 タブ(§6.2) |
| `/admin` | admin | §6.5 |
| `/api/...` | - | §8 |

- 未ログインは `/login` へリダイレクト(middleware)。権限不足は404を返す(存在を隠す。特に `/numbers/[id]`)。
- 下部タブバー: ①全体 / ②ナンバー / ③マイ の3タブ固定。折衝・管理へのリンクはタブ③設定画面内にロールに応じて表示。

---

## 8. APIルート仕様(Next.js Route Handlers)

すべて `app/api/**/route.ts`。クライアントからのDB直接操作はRLS範囲内の読み書きに限り、以下は**サーバー専用処理**(service role / 外部API / 秘密照合)。

### 8.1 `POST /api/auth/signup`
```
req : { generation:number, mainGenreId:number, displayName:string,
        password:string, passphrase:string }
処理: 1) app_settings.signup_pass とbcrypt照合(不一致→403)
      2) username組立 → 重複チェック(409)
      3) auth.admin.createUser({ email:ダミー, password, email_confirm:true })
      4) profiles insert (service role)
      5) calendar_tokens insert (token = 32byte random base64url)
res : { username }
```
レート制限: 同一IP 5回/分(簡易でよい。Upstash等は使わずメモリ+Vercelの制約で妥協可)。

### 8.2 `POST /api/auth/login`
username→ダミーメール合成→`signInWithPassword`。失敗時は「IDまたはパスワードが違います」で統一(存在探り防止)。

### 8.3 `POST /api/role/elevate`
`{ rolePassword }` を coordinator_pass / admin_pass の順に照合し、合致したロールへ更新(現ロールより下位への変更はしない)。**`role='ob'` のユーザーは合言葉が正しくても403で拒否する**(§3.6)。

### 8.4 `POST /api/import/parse`
- multipart: files[](text/csv, 各2MB以下)。coordinator以上のみ。
- papaparse でヘッダ付きCSVとして解析 → zodで各行検証 → 部屋名をエイリアス解決(§4.3)。
- res: `{ rows: [{date:'YYYY-MM-DD', start:'HH:MM', end:'HH:MM', room_raw:string, room_id:number|null, error?:string}], skipped:number }`
  (`room_id` は未解決ならnull。行単位のエラーは `error` に理由を入れ、UIで赤表示して修正させる。1行の不備で全体を落とさない)

### 8.5 `POST /api/reservations/bulk`
確認済み行の一括insert(§6.2 Step1-4)。coordinator以上。

### 8.6 `GET /api/cal/[token]`
- 認証不要(トークン自体が鍵)。`calendar_tokens` からユーザー特定(不一致→404)。
- §6.4 の抽出ロジックで**当月-1ヶ月〜+3ヶ月**のイベントを収集し、ics(§10)を返す。
- ヘッダ: `Content-Type: text/calendar; charset=utf-8`、`Cache-Control: private, max-age=3600`。

### 8.7 `POST /api/cal/regenerate`
本人の calendar_tokens を新トークンで置換。

### 8.8 `GET /api/health`
`?secret=CRON_SECRET` を検証し、DBに軽いselectを1回発行して200を返す(§13.4のkeep-alive用)。

### 8.9 admin系
`POST /api/admin/users/[id]/reset-password` / `PATCH /api/admin/users/[id]` / **`POST /api/admin/users/[id]/delete`** / `POST /api/admin/passphrases`。すべてサーバー側で admin ロール再検証。

> 削除は `DELETE` メソッドではなく **POST の専用パス**にする(v1.11.1)。同じURLに更新と削除を並べると、メソッド1文字の間違いが「更新のつもりが削除」になるため。

`PATCH /api/admin/users/[id]` の更新可能項目: `role`(`ob` を含む), `display_name`, **`main_genre_id`**, **`generation`**。
- `role` を `ob` に変更する場合は §3.6 の自動処理(未来claims削除・未来公式練attendances削除・サブジャンル削除)を同一トランザクションで実行する。実体は §5.2 の `graduate_to_ob` 関数(v1.11.1)。
- `POST /api/admin/users/bulk-graduate` : `{ userIds: string[] }` を一括でOB化(同処理)。res: `{ updated:number }`。
  - **既にOBの人は対象から除いてから呼ぶ**。「N人を移行しました」の数が実態とずれると確認の意味が無くなるため。
  - 一度に渡せるのは200件まで(期ひとつで数十人。全員を送るような誤操作を上限で止める)。
- 処理: 値を更新 → `username` を再生成 → 重複チェック(409) → **`auth.users` のダミーメールを新usernameで再合成して更新** → サブジャンル重複行を削除 → `admin_audit_logs` に記録 → 新usernameを返す。
  - ダミーメールの更新は必須。ログインは username からメールを再合成して照合するため(§3.3)、忘れると**IDを変えた瞬間に本人がログインできなくなる**。更新に失敗した場合は profiles 側(username・表示名・期・1ジャン)を変更前に戻して500を返す。
- res: `{ username, role, generation, mainGenreId, displayName }`(呼び出し側は確認ダイアログで新IDを表示する)。監査ログの書込に失敗した場合のみ `warning` を添える(本体の変更は成功しているので500にはしない)。
- **自分自身の admin 剥奪・OB化は 403 で拒否する**(最後のadminが消えるのを防ぐ。§6.5)。一括OB化に自分が含まれる場合も、黙って除かずエラーにする(選択の取り違えが疑われるため)。
- `admin_audit_logs` は**対象1人につき1行**書く(一括操作でも同様)。「誰をまとめて処理したか」より「この人に何が起きたか」を後から引けるほうが実際の問い合わせに答えられる。

`POST /api/admin/users/[id]/reset-password`(§3.5)
- 仮パスワードをサーバーで生成し `auth.admin.updateUserById` で設定、**レスポンスで一度だけ返す**。res: `{ username, password }`。
- 読み上げて伝えるものなので、見間違えやすい文字(`0/O`・`1/l/I`)を除いた英数字12文字とする。
- **値はどこにも保存・記録しない**(監査ログにも入れない。§13.2「平文ログ禁止」)。監査ログには誰にいつ発行したかだけを残す。

`POST /api/admin/users/[id]/delete`(§6.5)
- 用途は**誤登録アカウントの整理**。卒業はOB移行を使う。自己削除は403。
- `profiles` を参照していて `on delete cascade` が付いていない参照(`numbers.owner_id` / `reservations.created_by` / `import_files.uploaded_by` / `room_status.updated_by` / `admin_audit_logs.actor_id`)が**1件でも残っていれば409**で止め、何が何件残っているかを日本語で返す。活動の記録があるアカウントは消さずOBへ移行させるため。
- 監査ログは**削除前に**書く(`target_user_id` が `on delete set null` のため、後から書くと誰の話か分からなくなる。detail に username を残す)。
- `auth.users` を削除すると `profiles` 以下(申請・出欠・ナンバー所属・購読トークン・お知らせ)が cascade で消える。

`POST /api/admin/passphrases`(§3.5 / §6.5)
- `{ signupPass?, coordinatorPass?, adminPass? }`。**空欄の項目は変更しない**(1つだけ変える場面が多いため)。6文字以上。
- bcrypt(10ラウンド)でハッシュ化して `app_settings` に upsert。`updated_at` は明示的に更新する(既定値は insert 時にしか効かない)。
- 監査ログには**変更したキー名だけ**を残す(値は平文ログ禁止)。既に付与されたロールは取り消されない。

---

## 9. CSV取込仕様(v1.3)

### 9.1 方式
Claude APIは使用しない。折衝係が**自前のAI**(ChatGPT / Claude等、個人アカウントで可)に予約完了ページのスクショを読ませてCSVを作り、そのCSVをサイトにアップロードする。サイト側はCSVの解析・正規化・確認UI・DB登録を担う。**サイトから外部有料APIは一切呼ばない。**

### 9.2 CSVテンプレート(必須形式)
- 文字コード: UTF-8(BOM有無どちらも受理)。区切り: カンマ。1行目はヘッダ固定。
```csv
date,start,end,room
2026-08-06,13:00,21:30,剣道場
2026-08-19,13:00,22:00,展示・多目的室(全面)
2026-08-05,13:00,17:00,第1練習室
```
| 列 | 形式 | 説明 |
|---|---|---|
| `date` | `YYYY-MM-DD` | 西暦。和暦はAI側で変換済みとする |
| `start` / `end` | `HH:MM` (24時間・ゼロ埋め) | `start < end` であること |
| `room` | 文字列 | 施設サイト表記のままでよい(§4.3で正規化) |

### 9.3 折衝係向けプロンプト(画面に常時表示・コピーボタン付き)
```
添付は施設予約サイトの予約一覧のスクリーンショットです。
予約1件を1行として、次の形式のCSVだけを出力してください(説明文なし)。

date,start,end,room
規則:
- date は YYYY-MM-DD。和暦「令和N年」は西暦に変換(令和8年=2026年)。
- start / end は24時間表記 HH:MM のゼロ埋め。「13:00 〜 16:10」→ 13:00 と 16:10。
- room は部屋名のみ(会館名「八王子市南大沢文化会館」等は除く)。
- ヘッダ行・ページャ・予約以外の行は無視。読み取れない行は出力しない。
```
- 想定される元ページは2種類: 都立大予約サイト(日付/利用時間/施設)と、八王子市南大沢文化会館(利用日時に和暦、施設が2行表記)。
- 画面には「AIの出力は必ず確認画面で目視チェックしてから確定すること」の注意書きを表示する。

### 9.4 解析時のバリデーション(サーバー)
- ヘッダが `date,start,end,room` と一致しない場合はエラー(想定形式を提示して再アップロードを促す)。
- 行単位検証: 日付/時刻の形式、`start < end`、必須欄の空。不正行は `error` を付けて確認画面に赤表示し、その場で修正可能にする。
- 部屋名は `room_aliases` で解決。未知の表記は `room_id: null` として部屋プルダウンで手動選択させ、選択結果を `room_aliases` に保存(次回から自動解決)。
- 重複ガード: 同一 (date, room_id, start, end) の active な既存 `reservations` があればスキップし、件数を表示。

### 9.5 コスト
**0円**。CSV解析(papaparse)はサーバー内処理のみで、外部API課金は発生しない。折衝係が使うAIは各自の既存アカウント(無料枠で可)。

---

## 10. ics生成仕様

```
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//dance-circle-portal//JP
CALSCALE:GREGORIAN
X-WR-CALNAME:ダンス練習({username})
VTIMEZONE: TZID=Asia/Tokyo (+0900固定, STANDARDのみ)
```
- 各イベント:
  - `UID` は**恒久固定**: 公式練 `slot-{slots.id}@{APP_BASE_URLのホスト}` / 申請 `claim-{claims.id}@…` / ナンバー `numev-{number_events.id}@…`。同じ予定は毎回同じUIDで出す(重複表示防止の最重要ルール)。
  - `DTSTART;TZID=Asia/Tokyo` / `DTEND;TZID=Asia/Tokyo`(ローカル時刻形式)。
  - `SUMMARY`: 公式練 `「{GENRE} 公式練」` / 申請 `「空き使用({purpose or '個人練'})」` / ナンバー `「{ナンバー名}」`。
  - `LOCATION`: 部屋名 or number_events.place。
  - `DTSTAMP` は生成時刻。行折りは75オクテット、改行はCRLF、`,;\` はエスケープ。
- 予定の削除は「次回生成に含めない」ことで購読側から消える(差分管理は不要)。

---

## 11. 主要フロー図(テキスト)

```
[折衝] 自前AIでスクショ→CSV作成 → CSVアップ → 確認/修正 → reservations確定
     → コマ割り(slots下書き) → 月公開(published=true)
[全員] タブ①閲覧 ─ 空き時間帯を選んで申請(claims) ─ 全体に表示
[有志] ナンバー作成 → 名簿からメンバー追加 → 日程登録(number_events)
[各自] /me で統合表示・サブジャン設定 → 購読URLをGoogle/Appleに登録
[Google/Apple] /api/cal/{token} を定期取得(数時間〜1日周期, 先方任せ)
```

---

## 12. UI/UX共通ルール
- 想定端末はスマホ最優先(LINE運用の置き換えのため)。PCは崩れない程度で可。
- 日本語UI。日付表示は `8/6(木)`、時刻は `13:00〜14:50`。
- ジャンル色は9色を定数 `GENRE_COLORS` で一元管理(コントラスト確保、文字は黒/白自動)。

**配色とテーマ(v1.13)**
- **ライトモード(白背景)とダークモード(グレー背景)の2種類**を用意し、設定画面から切り替える(§6.4.1)。既定はライト。ダークは**真っ黒にはしない**(グレーを地にして、面が上がるほど明るくする)。
- 色は `app/globals.css` の CSS 変数(トークン)に集約する。**画面側に色を直書きしない** — 直書きするとテーマを足すたびに全ファイルを探し回ることになる。
  - 地と文字: `--background` / `--foreground` / `--muted` / `--border` / `--surface`
  - 主ボタン・選択中のチップ: `--primary` / `--primary-fg`(前景色を背景に敷いて反転させる。**ダークでは明るいグレーに暗い文字**になるため、`text-white` の直書きは不可)
  - 意味を持つ色: `--danger-*` / `--success-*` / `--accent`(今日・未読)/ `--info`(土曜・折衝バッジ)/ `--ob`
  - コマのブロック色(`--slot-*` / `--reservation-*`): 「地」に近い色なのでテーマ側で持つ。白に近いままダークに置くと、空きコマの列が光る板の壁になる。`lib/constants.ts` からは `var(--…)` を参照する(インラインスタイルでも `var()` は効く)。
- **ジャンル色とナンバー色はテーマで変えない。**「BREAKは赤」のような意味を持つ色で、テーマごとに変えると同一性が失われるため。
- 文字と地の組み合わせは**両テーマとも WCAG AA (4.5:1) 以上**を満たすこと。
- 選択は端末ごとの好みなので `localStorage` に持つ(DBには入れない)。**最初のペイント前に `<html data-theme>` を立てる**(`app/layout.tsx` の inline script)。React の描画後に切り替えると、白い画面が一瞬出てからグレーになる。
- `<meta name="theme-color">` も同じ script が作り、テーマに追従させる。ホーム画面から開いたときの**ステータスバーがこの色で塗られる**ため、固定にするとダークで上端だけ白く残る。Next 側に出させない(選択を知らないサーバーが固定値を書き、後から書き換えると2つ並ぶため)。

**ホーム画面への追加(v1.13.1)**
- iOS Safari の「ホーム画面に追加」でアプリのように使えるようにする。表示名は **`ff Calendar`**(ブラウザのタブ名「ダンスサークル練習管理」とは別)。
- アイコンは `app/apple-icon.png`(180×180)。**iOS はこれを見る**(manifest の icons ではない)。元画像は `assets/icon-source.jpg` に置き、そこから各サイズを書き出す。
  - 透過にしない(iOSが透明部分を黒で塗る)、角を丸めない(iOSが丸める)、端に1割の余白を取る(角丸で切られる)。
- `app/manifest.ts` で `display: standalone`(Safariのバーを出さない)とアプリ名を指定する。manifest の icons は Android・PC 向け。
- **`background_color` を暗い色にしないこと。** iOS はこれを起動時のスプラッシュだけでなく**画面上端(ステータスバー周り)の塗り**にも使う。アイコンの黒地に合わせて `#000000` にしたところ、ライトモードでも上端が黒く残った(v1.13.2)。既定テーマの地の色と揃える。
- `<meta name="theme-color">` は**静的にも出しておく**(`viewport.themeColor`)。無いと iOS がタグを見つけられず `background_color` で上端を塗る。テーマの選択に応じた書き換えは、Next のメタタグより後ろに置いた inline script が行う。
- **`manifest.webmanifest` は middleware の対象から外す。** 通すと未ログイン時に `/login` へリダイレクトされ、ログイン前にホーム画面へ追加した人にアプリ名と standalone が効かない。
- iOSは追加時点のアイコンをキャッシュするため、**既に追加済みの人は削除して追加し直す**必要がある。
- 破壊的操作(削除・公開済変更・トークン再発行・合言葉変更)は必ず確認ダイアログ。
- エラーは日本語で具体的に(「先に申請が入りました」「合言葉が違います」等)。
- ローディング中はスケルトン/スピナー表示。楽観更新は不要(要件: 同期はシビアでない)。

## 13. 非機能要件

### 13.1 規模・性能
- ユーザー約150人、同時アクセスは数十まで。月間データ増加は slots 数百行程度 → Supabase無料枠(DB 500MB)で長期間問題なし。
- ①カレンダーは月単位取得(1クエリでその月のslots+claims+profilesをjoinし取得)。

### 13.2 セキュリティ
- 認可の最終防衛線は**RLS**(画面出し分けは補助)。service role key はサーバーのみ。外部有料APIは使用しない。
- 購読トークンは32byte乱数(base64url)。URL漏洩時は本人が再発行。icsには他人のナンバー情報を絶対に含めない(§6.4のロジックのみで生成)。
- 合言葉・各種パスワードはbcryptハッシュ保存。平文ログ禁止。
- `/numbers/[id]` の非メンバーアクセスは404(403にしない=存在秘匿)。
- 卒業者対応: adminがアカウント削除。合言葉は代替わりで変更(admin画面に注記)。

### 13.3 バックアップ
- Supabase無料枠は自動バックアップ無し。**GitHub Actionsで日次 `pg_dump` を取得**する(`.github/workflows/backup.yml`)。保管先は Actions のアーティファクト(保管90日)。JST 04:00 に実行し、手動実行もできる。
- 接続文字列はリポジトリシークレット `SUPABASE_DB_URL` に置く。**Session pooler(ポート5432)のURLを使う**こと。直結(`db.<ref>.supabase.co`)はIPv6のみで、GitHubのランナーはIPv4のため接続できない。
- `pg_dump` は**PostgreSQL公式コンテナ(`postgres:17-alpine`)で実行する**。ランナー同梱のクライアントはSupabaseより古いことがあり、かといって`apt`で入れると対話プロンプトで待ちに入ることがあるため。Dockerはランナーに同梱されている。
- 実行前に接続先を検査し、**Transaction pooler(6543)と直結URLは明示的に弾く**。特に直結はIPv6のみのため、エラーにならず待ち続けてジョブが終わらない。ジョブ全体に10分、ダンプに5分のタイムアウトを置く。
- シークレット未設定のまま成功扱いにしない(バックアップが無いのに緑になるのが最悪のため、未設定なら明示的に失敗させる)。
- GitHubは**60日間リポジトリに動きが無いとスケジュール実行を停止する**。長期休暇明けは有効になっているか確認する。

### 13.4 スリープ対策
- Supabase無料プロジェクトは1週間無アクセスで一時停止するため、Vercel Cron で `GET /api/health?secret=…` を1日1回実行(vercel.json の crons 設定)。長期休暇中も停止しない。

### 13.5 更新時の停止可否
- 通常の機能追加・修正は**無停止**。Vercelが新旧を切り替える方式のため、メンテナンス画面は不要。
- テーブル追加等のスキーマ変更も、「マイグレーション適用 → コードデプロイ」の順を守れば無停止。逆順は一時的にエラーとなるため禁止。
- 既存データの大規模な作り替えを伴う改修のみ、深夜帯に告知の上で数分〜十数分の停止を許容する。

## 14. セットアップ手順(初回)
0. GitHubでprivateリポジトリを作成し、`SPEC.md` をコミット。Next.jsプロジェクトを初期化。
1. Supabaseプロジェクト作成 → SQL Editorで `0001_init.sql` 実行。
2. Auth設定: "Allow new users to sign up" OFF / "Confirm email" OFF。
4. 合言葉初期値の投入: ローカルスクリプト `scripts/set-passphrase.ts`(service roleで3種をbcrypt化しupsert)を用意して実行。
5. `.env.local` 設定(§2.1)→ `npm run dev` で起動確認。
6. VercelでGitHubリポジトリをimport(自動デプロイ有効化)、環境変数設定、cron設定。
7. 動作確認: サインアップ→admin昇格(管理者パスワード)→折衝フロー一巡。

## 15. 開発フェーズと受け入れ基準

**Phase 1: 認証+①閲覧+購読URL(最小価値)**
- [ ] 合言葉なしで登録できない/合言葉ありで登録・ログインできる
- [ ] 手投入したslotsが①グリッドに正しく表示される(列=部屋グループ、行=日付×時間)
- [ ] 購読URLをGoogle/Appleカレンダーに登録すると自分の公式練だけが表示される
- [ ] 他人のトークンURLでは他人の予定が出る=自分のURLは自分の予定のみ(手動確認)

**Phase 2: 空き申請**
- [ ] 空きコマ内の自由時間帯(10分刻み)で申請でき、タブ①に申請者と時間帯が表示される
- [ ] 同一コマの重複時間帯への申請はDB制約で失敗し、適切なメッセージが出る(非重複なら両立する)
- [ ] 申請が本人のics に含まれる/取消で消える
- [ ] 「今日の練習場所」ボードに今日の部屋が並び、既定が×(施錠中)で、誰でも○/×を切替できて他ユーザーにも反映される

**Phase 3: 折衝ワークフロー**
- [ ] 実物スクショから自前AIで作ったCSV(都立大/フレスコ両形式)を取り込み、確認画面で修正→確定できる
- [ ] 未知の部屋表記を手動対応付けでき、次回から自動解決される
- [ ] コマ割り(分割・状態・ジャンル・対象期)→月一括公開が動く
- [ ] 重複取込がスキップされる

**Phase 4: ナンバー+管理者+運用整備**
- [ ] 非メンバーにはナンバーの存在が一切見えない(URL直叩きで404、DB直クエリでも0件)
- [ ] owner がメンバー追加/削除、日程CRUDできる。メンバー脱退で当人のicsから消える
- [ ] 出欠登録(欠席/遅刻+時刻/早退+時刻)ができ、参加者一覧と他メンバーのお知らせに反映される
- [ ] ナンバー練の出欠状況が非メンバーから見えない(SQLレベルで0件)
- [ ] admin のユーザー管理・合言葉変更・パスワード再設定が動く
- [ ] admin が卒業者をOBへ移行でき、当人はタブ①が消えタブ②③のみになる。ナンバー所属と購読URLは維持される
- [ ] admin が1ジャン/期を修正するとusernameが自動更新され、過去の申請・出欠・ナンバー所属が保持される
- [ ] cron keep-alive とバックアップが稼働

## 16. テスト観点(重点)
- **RLS**: 別ユーザーのセッションで numbers/number_events をselectして0件になること(SQLレベルで確認)。member が slots の下書き(published=false)を読めないこと。member が reservations を読めないこと。
- **claims競合**: 同一slotの重複時間帯へ並行insertし、排他制約で片方のみ成功すること。非重複時間帯なら両方成功すること。範囲がコマ外/10分刻み外の申請が弾かれること(コマ外はRLS、刻み外はCHECK制約)。
- **ics**: UIDが再生成で不変なこと。Apple/Google双方で購読でき、既存予定に影響しないこと。文字化け(UTF-8)・75オクテット折返しの検証。
- **CSV取込**: 正常CSV/ヘッダ不正/行不正(時刻逆転・空欄)/未知の部屋名/重複行 の各ケースを検証。不正行だけが赤表示され、他は取り込めること。
- **施錠状況ボード**: 未設定の部屋が×表示になること。当日以外の日付へのinsert/updateがRLSで弾かれること。updated_byを他人にした書込が弾かれること。日付が変わると全部屋が×(未設定)に戻ること。3時間以上前の○に警告表示が出ること。
- **OB/OG**: OBセッションで slots / claims / room_status をselectして0件になること。OBの公式練出欠insertが弾かれること。OBが折衝・管理者パスワードで昇格できないこと。OB化後に未来のclaimsと公式練attendancesが消え、ナンバー所属・過去履歴・購読URLが残ること。OBの購読icsにナンバー予定のみが含まれること。
- **1ジャン修正**: 修正後にusernameが再生成され重複時は拒否されること。修正後もclaims/attendances/number_membersと購読URLが維持されること。新1ジャンと同じサブジャンルが自動削除されること。
- **出欠**: 対象ジャンル・期に該当しないユーザーの公式練出欠insertがRLSで弾かれること。遅刻/早退で時刻未入力がDB制約で弾かれること。出欠更新でお知らせが本人以外に生成されること。
- **境界**: 対象期フィルタ、サブジャンル変更が即icsに反映(次回取得時)されること。

## 17. 将来拡張(本仕様では実装しない)
- 出欠の集計(出欠率・一覧エクスポート)、遅刻と早退の同時登録
- プッシュ/LINE通知、slots変更履歴、施設サイト自動巡回

---
以上。実装中に本仕様と矛盾・不足を見つけた場合は、SPEC.md に追記して更新しながら進めること。
