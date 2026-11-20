create table public.iot_room_snapshots (
  owner_id uuid not null default auth.uid(),
  room_index smallint not null check (room_index between 0 and 3),
  room_state jsonb not null check (jsonb_typeof(room_state) = 'object'),
  records jsonb not null check (jsonb_typeof(records) = 'array' and jsonb_array_length(records) <= 120),
  updated_at timestamptz not null default now(),
  primary key (owner_id, room_index)
);

alter table public.iot_room_snapshots enable row level security;
revoke all on public.iot_room_snapshots from anon, authenticated;
grant select, insert, update on public.iot_room_snapshots to authenticated;
create policy "Own room snapshots" on public.iot_room_snapshots
  for all to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
