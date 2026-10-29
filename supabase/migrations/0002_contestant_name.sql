-- Add the wearer's name separately from the costume name already in display_name.
alter table public.costume_entries
  add column if not exists contestant_name text not null default 'TBA';

update public.costume_entries
set contestant_name = 'TBA'
where contestant_name is null or char_length(trim(contestant_name)) = 0;

alter table public.costume_entries
  alter column contestant_name drop default,
  alter column contestant_name set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'costume_entries_contestant_name_length'
      and conrelid = 'public.costume_entries'::regclass
  ) then
    alter table public.costume_entries
      add constraint costume_entries_contestant_name_length
      check (char_length(trim(contestant_name)) between 1 and 60);
  end if;
end;
$$;
