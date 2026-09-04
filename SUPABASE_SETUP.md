# Googleサインインとクラウド同期のセットアップ

BrewNote は既定でサーバを持たないローカル専用アプリです。この設定を行うと、
**Googleサインインした人だけ**、レシピ（`coffee_recipes`）と記録（`coffee_brews`）が
Supabase にも同期され、スマホとパソコンで同じ記録帳を見られるようになります。
サインインしない場合の挙動は変わりません（IndexedDB だけで完結し、ネットワークには
一切触れません）。

必要なのは次の3つです。

1. Supabase プロジェクト（テーブルとRLSポリシー）
2. Google Cloud の OAuth クライアントID
3. `app.js` の3つの定数を、自分の値に書き換える

---

## 1. テーブルとRLSポリシーを作る

Supabase ダッシュボードの **SQL Editor** で以下を実行します。

このSQLは**何度実行しても安全**な形で書いてあります。SQL Editor は貼り付けた内容を
1つのトランザクションで流すため、1文でもエラーになると前の行まで巻き戻り、
**何も適用されないまま終わります**。`create policy` は「既にある」だけでエラーに
なるので、そのまま並べると2回目以降が丸ごと無効になってしまいます。

```sql
-- レシピ
create table if not exists public.coffee_recipes (
  user_id    uuid    not null references auth.users(id) on delete cascade,
  id         text    not null,
  data       jsonb   not null default '{}'::jsonb,
  deleted    boolean not null default false,
  updated_at bigint  not null default 0,
  primary key (user_id, id)
);
alter table public.coffee_recipes enable row level security;

do $$ begin
  create policy "individuals manage their own recipes"
    on public.coffee_recipes for all
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

-- 記録
create table if not exists public.coffee_brews (
  user_id    uuid    not null references auth.users(id) on delete cascade,
  id         text    not null,
  data       jsonb   not null default '{}'::jsonb,
  deleted    boolean not null default false,
  updated_at bigint  not null default 0,
  primary key (user_id, id)
);
alter table public.coffee_brews enable row level security;

do $$ begin
  create policy "individuals manage their own brews"
    on public.coffee_brews for all
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

-- 別の端末での追加・変更をその場で受け取るための Realtime 配信
do $$ begin
  alter publication supabase_realtime add table public.coffee_recipes;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.coffee_brews;
exception when duplicate_object then null; end $$;
```

RLS（行レベルセキュリティ）により、各行は自分の `user_id` のものしか読み書き
できません。anon key を配布していても、他人の記録が見えたり書き換えられたりする
ことはありません。

### データの形について

レシピも記録も、中身はまるごと `data`（jsonb）に入れています。味の軸を1つ増やす、
豆の項目を足す、といった変更のたびにSQLを流し直さなくて済むようにするためです。
同期の判定に使う `id` / `updated_at` / `deleted` だけを列に出しています。

## 2. Google側の設定

### 2-1. OAuth クライアントIDを作る

1. Google Cloud Console → **APIとサービス → 認証情報**
2. 「認証情報を作成」→ **OAuth クライアント ID** → 種類は**ウェブアプリケーション**
3. **承認済みの JavaScript 生成元**に、このアプリを配信するオリジンを登録する
   - GitHub Pages なら `https://<ユーザー名>.github.io`
   - 手元で試すなら `http://localhost:8000` など
4. できたクライアントID（`....apps.googleusercontent.com`）を控える

### 2-2. Supabase 側にそのクライアントIDを教える

Supabase ダッシュボード → **Authentication → Providers → Google** を有効にし、
**Authorized Client IDs** に 2-1 のクライアントIDを入れます。

BrewNote は Google のIDトークンを `signInWithIdToken` でそのまま Supabase に渡す
ため（リダイレクトを挟まない）、この欄の登録が必要です。Client Secret は要りません。

## 3. アプリ側に書き込む

`app.js` の「8. Googleサインインと Supabase 同期」にある3つの定数を、
自分の値に書き換えます。

```js
const SUPABASE_URL      = "https://xxxxxxxx.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_...";   // anon / publishable key
const GOOGLE_CLIENT_ID  = "...apps.googleusercontent.com";
```

anon key は RLS で守られる前提の**公開鍵**なので、フロントエンドに埋め込んで
問題ありません（`service_role` key は絶対に置かないでください）。

## うまくいかないときは

| 症状 | たいていの原因 |
| --- | --- |
| 「同期先のテーブルがありません」と出る | 1. のSQLが未実行、または別プロジェクトに実行した |
| サインインボタンが出ない・すぐ消える | 承認済みの JavaScript 生成元に、今開いているオリジンが入っていない |
| サインインはできるのに同期しない | Supabase の Google プロバイダの Authorized Client IDs が空 |
| 別の端末の変更が届かない | Realtime 配信の `alter publication` が未実行（次回起動時の同期では追いつきます） |

同じ `id` の記録が両方にある場合は、`updated_at` が新しいほうを採ります。
削除は「消したという印」（`deleted`）を残して同期するので、片方で消した記録が
もう片方から蘇ることはありません。
