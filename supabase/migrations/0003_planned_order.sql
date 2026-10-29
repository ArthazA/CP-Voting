alter table public.costume_entries
  add column if not exists planned_order integer;

with ordered_entries as (
  select
    id,
    row_number() over (
      order by
        case category
          when 'Scariest' then 1
          when 'Prettiest' then 2
          when 'Funniest' then 3
          when 'Group' then 4
          else 5
        end,
        sort_order,
        created_at,
        id
    ) - 1 as position
  from public.costume_entries
)
update public.costume_entries as entries
set planned_order = ordered_entries.position
from ordered_entries
where entries.id = ordered_entries.id
  and entries.planned_order is null;

alter table public.costume_entries
  alter column planned_order set not null;

create index if not exists costume_entries_planned_order_idx
  on public.costume_entries(planned_order);

alter table public.event_control
  add column if not exists last_entry_id uuid references public.costume_entries(id) on delete set null;

create or replace function public.reorder_costume_entries(p_entry_ids uuid[])
returns void language plpgsql security definer set search_path = public, realtime as $$
declare expected_count bigint; requested_count integer;
begin
  requested_count := coalesce(cardinality(p_entry_ids), 0);
  select count(*) into expected_count from public.costume_entries;

  if requested_count <> expected_count then
    raise exception 'The planned order must include every costume exactly once.';
  end if;

  if requested_count <> (select count(distinct id) from unnest(p_entry_ids) as requested(id)) then
    raise exception 'The planned order contains duplicate costumes.';
  end if;

  if exists (
    select 1
    from unnest(p_entry_ids) as requested(id)
    left join public.costume_entries as entries on entries.id = requested.id
    where entries.id is null
  ) then
    raise exception 'The planned order contains a costume that no longer exists.';
  end if;

  update public.costume_entries as entries
  set planned_order = ordered.ordinality::integer - 1
  from unnest(p_entry_ids) with ordinality as ordered(id, ordinality)
  where entries.id = ordered.id;

  perform realtime.send(
    jsonb_build_object('planned_order_updated', true),
    'entries_updated', 'costume-party-live', false
  );
end;
$$;

revoke all on function public.reorder_costume_entries(uuid[]) from public, anon, authenticated;
grant execute on function public.reorder_costume_entries(uuid[]) to service_role;

create or replace function public.broadcast_costume_entries()
returns trigger language plpgsql security definer set search_path = public, realtime as $$
begin
  if tg_op = 'UPDATE'
    and old.planned_order is distinct from new.planned_order
    and old.contestant_name is not distinct from new.contestant_name
    and old.display_name is not distinct from new.display_name
    and old.category is not distinct from new.category
    and old.sort_order is not distinct from new.sort_order
  then
    return new;
  end if;

  perform realtime.send(jsonb_build_object('changed', true), 'entries_updated', 'costume-party-live', false);
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

create or replace function public.broadcast_costume_control()
returns trigger language plpgsql security definer set search_path = public, realtime as $$
begin
  perform realtime.send(
    jsonb_build_object(
      'status', new.status, 'event_name', new.event_name,
      'current_entry_id', new.current_entry_id, 'last_entry_id', new.last_entry_id,
      'session_id', new.session_id, 'started_at', new.started_at,
      'ends_at', new.ends_at, 'paused_remaining_ms', new.paused_remaining_ms,
      'updated_at', new.updated_at
    ), 'state_updated', 'costume-party-live', false
  );
  return new;
end;
$$;
