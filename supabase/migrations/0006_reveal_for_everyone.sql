-- 1. Best Group is no longer a category; groups compete in Funniest, Prettiest or Scariest
--    (they keep their GROUP tag). Any entry saved as Group moves to Funniest.
update public.costume_entries set category = 'Funniest' where category = 'Group';
alter table public.costume_entries drop constraint if exists costume_entries_category_check;
alter table public.costume_entries
  add constraint costume_entries_category_check
  check (category in ('Scariest', 'Prettiest', 'Funniest'));

-- 2. Winner reveal shown on every guest phone and the live screen, stepped by the host.
alter table public.event_control
  add column if not exists reveal_active boolean not null default false,
  add column if not exists reveal_round integer not null default 0,
  add column if not exists reveal_step integer not null default 0;

create or replace function public.broadcast_costume_control()
returns trigger language plpgsql security definer set search_path = public, realtime as $$
begin
  perform realtime.send(
    jsonb_build_object(
      'status', new.status, 'event_name', new.event_name,
      'current_entry_id', new.current_entry_id, 'last_entry_id', new.last_entry_id,
      'session_id', new.session_id, 'started_at', new.started_at,
      'ends_at', new.ends_at, 'paused_remaining_ms', new.paused_remaining_ms,
      'reveal_active', new.reveal_active, 'reveal_round', new.reveal_round, 'reveal_step', new.reveal_step,
      'updated_at', new.updated_at
    ), 'state_updated', 'costume-party-live', false
  );
  return new;
end;
$$;
