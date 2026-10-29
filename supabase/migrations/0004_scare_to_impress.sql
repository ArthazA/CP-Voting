-- Scare to Impress changes: Best Group category, group tag, changeable votes,
-- and vote broadcasts that no longer carry the average (guests only get counts).

-- 1. Allow the Group category.
alter table public.costume_entries drop constraint if exists costume_entries_category_check;
alter table public.costume_entries
  add constraint costume_entries_category_check
  check (category in ('Scariest', 'Prettiest', 'Funniest', 'Group'));

-- 2. GROUP tag. Entries in the Group category are always groups; other categories can have groups too.
alter table public.costume_entries
  add column if not exists is_group boolean not null default false;
update public.costume_entries set is_group = true where category = 'Group';

-- 3. Votes can be changed until the timer ends (the API upserts on entry_id + voter_key).
alter table public.costume_votes
  add column if not exists updated_at timestamptz not null default now();

create or replace function public.broadcast_costume_vote_summary()
returns trigger language plpgsql security definer set search_path = public, realtime as $$
declare v_count bigint;
begin
  if not exists (
    select 1 from public.event_control
    where id = 1 and status = 'voting' and current_entry_id = new.entry_id
  ) then
    return new;
  end if;

  select count(*) into v_count from public.costume_votes where entry_id = new.entry_id;
  -- The channel is public, so only the count goes out. The host desk fetches the average itself.
  perform realtime.send(
    jsonb_build_object('entry_id', new.entry_id, 'vote_count', v_count),
    'votes_updated', 'costume-party-live', false
  );
  return new;
end;
$$;

drop trigger if exists costume_votes_broadcast on public.costume_votes;
create trigger costume_votes_broadcast after insert or update on public.costume_votes
for each row execute function public.broadcast_costume_vote_summary();
