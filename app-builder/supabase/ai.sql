-- App builder AI: daily usage counts and a public bucket for the pictures the AI draws.
-- Run once in Supabase (SQL Editor → New query → Run), after schema.sql.

create table if not exists public.ai_usage (user_id uuid not null default auth.uid() references auth.users (id) on delete cascade, day date not null default current_date, kind text not null, count int not null default 0, primary key (user_id, day, kind));
alter table public.ai_usage enable row level security;
drop policy if exists "read own usage" on public.ai_usage;
create policy "read own usage" on public.ai_usage for select to authenticated using ((select auth.uid()) = user_id);

-- Counts one use for the signed-in user. Returns the new count, or null when the daily limit is reached.
create or replace function public.take_quota(p_kind text, p_limit int) returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is null then return null; end if;
  insert into public.ai_usage (user_id, day, kind, count) values (auth.uid(), current_date, p_kind, 1)
  on conflict (user_id, day, kind) do update set count = public.ai_usage.count + 1 where public.ai_usage.count < p_limit
  returning count into n;
  return n;
end $$;
revoke all on function public.take_quota(text, int) from public, anon;
grant execute on function public.take_quota(text, int) to authenticated;

-- Pictures: anyone can view them (so shared games work), each user uploads only into their own folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('game-assets', 'game-assets', true, 3145728, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;
drop policy if exists "upload own game assets" on storage.objects;
create policy "upload own game assets" on storage.objects for insert to authenticated
with check (bucket_id = 'game-assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
