create table public.flow_teams (
  id uuid not null default gen_random_uuid (),
  members jsonb null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  constraint flow_teams_pkey primary key (id)
) TABLESPACE pg_default;

create table public.flow_notifications (
  id uuid not null default gen_random_uuid (),
  user_id uuid not null,
  extra jsonb null default '{}'::jsonb,
  title text not null,
  description text not null,
  time timestamp with time zone not null default now(),
  type text not null,
  read boolean not null default false,
  icon text not null,
  icon_color text not null,
  bg_color text not null,
  constraint flow_notifications_pkey primary key (id)
) TABLESPACE pg_default;