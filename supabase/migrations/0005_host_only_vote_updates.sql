-- Send live vote counts to the host desk only. Before this, every vote was broadcast to every
-- guest's phone, which on a 220-guest night exceeds Supabase's message limits within seconds.
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
  perform realtime.send(
    jsonb_build_object('entry_id', new.entry_id, 'vote_count', v_count),
    'votes_updated', 'costume-party-host', false
  );
  return new;
end;
$$;
