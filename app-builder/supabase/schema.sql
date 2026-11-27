-- בונה האפליקציות: טבלת הפרויקטים בענן.
-- מריצים פעם אחת ב-Supabase: SQL Editor → New query → מדביקים → Run.

create table if not exists public.projects (
  id          text        not null,
  owner       uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  name        text        not null default 'פרויקט חדש',
  mode        text        not null default 'blocks' check (mode in ('blocks', 'code')),
  blocks      jsonb,
  html        text        not null default '',
  messages    jsonb       not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (owner, id)
);

create index if not exists projects_owner_updated on public.projects (owner, updated_at desc);

-- כל משתמש רואה ומשנה רק את הפרויקטים של עצמו.
alter table public.projects enable row level security;

drop policy if exists "read own projects" on public.projects;
create policy "read own projects" on public.projects
  for select to authenticated using ((select auth.uid()) = owner);

drop policy if exists "create own projects" on public.projects;
create policy "create own projects" on public.projects
  for insert to authenticated with check ((select auth.uid()) = owner);

drop policy if exists "update own projects" on public.projects;
create policy "update own projects" on public.projects
  for update to authenticated using ((select auth.uid()) = owner) with check ((select auth.uid()) = owner);

drop policy if exists "delete own projects" on public.projects;
create policy "delete own projects" on public.projects
  for delete to authenticated using ((select auth.uid()) = owner);
