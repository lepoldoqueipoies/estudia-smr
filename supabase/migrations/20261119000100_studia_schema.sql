-- Studia: persistencia privada para GitHub Pages + Supabase Edge Functions.
-- Ejecutar una sola vez desde Supabase Dashboard > SQL Editor.

create table if not exists public.app_state (
  id integer primary key check (id = 1),
  revision bigint not null default 1,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

insert into public.app_state (id, revision, state)
values (1, 1, jsonb_build_object(
  'users', jsonb_build_array(jsonb_build_object('name','nixan1dev','role','admin','createdAt',1700000000000)),
  'events', '[]'::jsonb, 'news', '[]'::jsonb, 'subjects', '[]'::jsonb, 'schedule', '[]'::jsonb,
  'permissions', '{}'::jsonb, 'nicknames', '{}'::jsonb, 'avatars', '{}'::jsonb,
  'notifs', '[]'::jsonb, 'seenNotifs', '{}'::jsonb, 'banned', '[]'::jsonb, 'bannedIps', '[]'::jsonb,
  'messages', '[]'::jsonb, 'fileReservations', '[]'::jsonb
)) on conflict (id) do nothing;

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_name text not null,
  client_id text not null,
  message jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_name, client_id)
);
create index if not exists chat_messages_created_at_idx on public.chat_messages (created_at);

create table if not exists public.collected_diagnostics (
  id bigint generated always as identity primary key,
  username text not null,
  server_ip text,
  server_ts bigint not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists collected_diagnostics_username_idx on public.collected_diagnostics (username, server_ts desc);

alter table public.app_state enable row level security;
alter table public.chat_messages enable row level security;
alter table public.collected_diagnostics enable row level security;
revoke all on public.app_state from anon, authenticated;
revoke all on public.chat_messages from anon, authenticated;
revoke all on public.collected_diagnostics from anon, authenticated;
revoke all on public.app_state, public.chat_messages, public.collected_diagnostics from public;
grant all on public.app_state, public.chat_messages, public.collected_diagnostics to service_role;
grant usage, select on sequence public.collected_diagnostics_id_seq to service_role;
-- Las Edge Functions usan exclusivamente service_role. No añadas políticas públicas a estas tablas.

do $$
begin
  insert into storage.buckets (id, name, public, file_size_limit)
  values ('chat-files', 'chat-files', false, 314572800)
  on conflict (id) do update set public = false, file_size_limit = 314572800;
end $$;
-- Sin políticas storage.objects para anon/authenticated: solo se accede mediante URLs firmadas.
