# 同期をつなぐ（Supabase + Google）

**このリポジトリのアプリは、すでに既定の Supabase プロジェクトを向いています。**
設定 → 同期 の2つの欄は最初から埋まっているので、ふつうは
**「Googleで入る」を押すだけ**です。この文書は、

- 自分の Supabase プロジェクトに向けたい人
- 既定のプロジェクトを一から作り直したい人

のための手順です。欄に入っているキーはブラウザに置く前提のもので、これだけでは
誰の一杯も読めません。守っているのは手順2で入れる row-level security です。
同期を切りたければ、2つの欄を空にして保存すれば端末の中だけに戻ります。

Coffeerence はつながなくても使えます。

つないだあとも、端末の中の控え（IndexedDB）は残り続けます。線が切れているあいだ
に淹れた一杯は箱に積まれ、つながった瞬間に上がります。

---

## 1. プロジェクトを作る

[supabase.com](https://supabase.com) で新しいプロジェクトを作ります。

## 2. 表を作る

プロジェクトの **SQL Editor** を開いて、下をまるごと貼って実行します。

```sql
-- 記録・レシピ・設定。中身はまるごと data に入れる。
-- アプリ側の項目が増えても、ここを作り直さずに済む。

create table if not exists public.recipes (
  id          text        not null,
  user_id     uuid        not null references auth.users(id) on delete cascade,
  updated_at  timestamptz not null default now(),
  deleted     boolean     not null default false,
  data        jsonb       not null,
  primary key (id)
);

create table if not exists public.brews (
  id          text        not null,
  user_id     uuid        not null references auth.users(id) on delete cascade,
  updated_at  timestamptz not null default now(),
  deleted     boolean     not null default false,
  data        jsonb       not null,
  primary key (id)
);

-- 設定は1人1行
create table if not exists public.prefs (
  user_id     uuid        not null references auth.users(id) on delete cascade,
  updated_at  timestamptz not null default now(),
  data        jsonb       not null,
  primary key (user_id)
);

create index if not exists recipes_user_updated on public.recipes (user_id, updated_at);
create index if not exists brews_user_updated   on public.brews   (user_id, updated_at);

-- ここが要。anon key は公開してよい鍵で、あなたの一杯を守るのはこの行の壁。
alter table public.recipes enable row level security;
alter table public.brews   enable row level security;
alter table public.prefs   enable row level security;

drop policy if exists "own recipes" on public.recipes;
create policy "own recipes" on public.recipes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own brews" on public.brews;
create policy "own brews" on public.brews
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own prefs" on public.prefs;
create policy "own prefs" on public.prefs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

## 3. Google でのログインを開ける

1. **Authentication → Providers → Google** を開き、有効にします。
2. そこに出ている **Callback URL**（`https://xxxx.supabase.co/auth/v1/callback`）を控えます。
3. [Google Cloud Console](https://console.cloud.google.com/apis/credentials) で
   **OAuth 2.0 クライアント ID**（種類は「ウェブ アプリケーション」）を作り、
   **承認済みのリダイレクト URI** に 2 で控えた Callback URL を貼ります。
4. できた **クライアント ID** と **クライアント シークレット** を、1 の画面に貼って保存します。

## 4. このアプリの住所を通す

**Authentication → URL Configuration → Redirect URLs** に、このアプリを開いている
住所を足します。ブラウザのアドレス欄にあるもの（`#` から後ろは要りません）。

例:

```
https://gmgngnm.github.io/coffee/index.html
```

ホーム画面に置いて使っている場合も、住所は同じです。

## 5. アプリに2行貼る

**Project Settings → API** から、

- **Project URL** → 設定の「Project URL」
- **anon public** キー → 設定の「Anon key」

を貼って、「Save and check」を押します。届けば「Project reached」と出ます。

そのあと **Sign in with Google** で入り、一度だけ
**「Upload everything on this device」** を押してください。いま端末にあるものが
まるごと上がります。2台目からは、入るだけで揃います。

---

## 気をつけること

- **anon key は公開してよい鍵です。** どのプロジェクトに話しかけているかを言うだけの
  もので、これだけでは誰のデータも読めません。守っているのは 2 の row-level security です。
- **service_role key は絶対に貼らないでください。** あれは行の壁を素通りする鍵です。
- ぶつかったときは **updatedAt の新しいほうが勝ちます**。消したことも「墓標」として
  残るので、片方で消した記録が同期のたびに蘇ることはありません。
- 同期を切りたくなったら、設定の2つの欄を空にして「Save and check」を押します。
  端末の中の記録はそのまま残ります。
