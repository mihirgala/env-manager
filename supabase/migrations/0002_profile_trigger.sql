-- P2: auto-create a profiles row on signup.
--
-- 0001 left a gap: projects.owner_id / env_snapshots.owner_id reference
-- profiles(id), but nothing inserted the row — so the first Push from a new
-- account failed on the foreign key. The app's RLS already allows self-insert,
-- but a trigger is robust against every client path (including the hosted
-- backend's OTP sign-ins, where the app never touches profiles directly).

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
