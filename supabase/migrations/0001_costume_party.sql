create extension if not exists pgcrypto;

create table if not exists public.costume_entries (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (char_length(trim(display_name)) between 1 and 60),
  category text not null check (category in ('Scariest', 'Prettiest', 'Funniest', 'Group')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.event_control (
  id integer primary key default 1 check (id = 1),
  event_name text not null default 'Costume Party',
  status text not null default 'waiting' check (status in ('waiting', 'voting', 'paused')),
  current_entry_id uuid references public.costume_entries(id) on delete set null,
  session_id uuid,
  started_at timestamptz,
  ends_at timestamptz,
  paused_remaining_ms integer,
  updated_at timestamptz not null default now()
);

insert into public.event_control (id, event_name, status)
values (1, 'Costume Party', 'waiting') on conflict (id) do nothing;

create table if not exists public.costume_votes (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.costume_entries(id) on delete cascade,
  voter_key uuid not null,
  score smallint not null check (score between 1 and 5),
  created_at timestamptz not null default now(),
  constraint one_vote_per_voter_per_entry unique (entry_id, voter_key)
);

alter table public.costume_entries enable row level security;
alter table public.event_control enable row level security;
alter table public.costume_votes enable row level security;
revoke all on public.costume_entries from anon, authenticated;
revoke all on public.event_control from anon, authenticated;
revoke all on public.costume_votes from anon, authenticated;

create or replace function public.broadcast_costume_control()
returns trigger language plpgsql security definer set search_path = public, realtime as $$
begin
  perform realtime.send(
    jsonb_build_object(
      'status', new.status, 'event_name', new.event_name,
      'current_entry_id', new.current_entry_id, 'session_id', new.session_id,
      'started_at', new.started_at, 'ends_at', new.ends_at,
      'paused_remaining_ms', new.paused_remaining_ms, 'updated_at', new.updated_at
    ), 'state_updated', 'costume-party-live', false
  );
  return new;
end;
$$;

drop trigger if exists costume_control_broadcast on public.event_control;
create trigger costume_control_broadcast after update on public.event_control
for each row execute function public.broadcast_costume_control();

create or replace function public.broadcast_costume_vote_summary()
returns trigger language plpgsql security definer set search_path = public, realtime as $$
declare v_average numeric; v_count bigint;
begin
  if not exists (
    select 1 from public.event_control
    where id = 1
      and status = 'voting'
      and current_entry_id = new.entry_id
      and ends_at > now() + interval '5 seconds'
  ) then
    return new;
  end if;

  select round(avg(score)::numeric, 2), count(*) into v_average, v_count
  from public.costume_votes where entry_id = new.entry_id;
  perform realtime.send(
    jsonb_build_object('entry_id', new.entry_id, 'average', v_average, 'vote_count', v_count),
    'votes_updated', 'costume-party-live', false
  );
  return new;
end;
$$;

drop trigger if exists costume_votes_broadcast on public.costume_votes;
create trigger costume_votes_broadcast after insert on public.costume_votes
for each row execute function public.broadcast_costume_vote_summary();

create or replace function public.broadcast_costume_entries()
returns trigger language plpgsql security definer set search_path = public, realtime as $$
begin
  perform realtime.send(jsonb_build_object('changed', true), 'entries_updated', 'costume-party-live', false);
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

drop trigger if exists costume_entries_broadcast on public.costume_entries;
create trigger costume_entries_broadcast after insert or update or delete on public.costume_entries
for each row execute function public.broadcast_costume_entries();
