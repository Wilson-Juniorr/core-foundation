-- ============ enums ============
create type public.followup_delay_unit as enum ('minutes','hours','days');
create type public.followup_action_type as enum ('text_message','audio','image','document');
create type public.followup_run_status as enum ('active','paused','stopped','completed','cancelled','failed');
create type public.scheduled_action_status as enum ('scheduled','processing','sent','cancelled','failed','skipped');

-- ============ user_settings ============
create table public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  timezone text not null default 'America/Sao_Paulo',
  send_window_start time not null default '08:00',
  send_window_end time not null default '20:00',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.user_settings to authenticated;
grant all on public.user_settings to service_role;
alter table public.user_settings enable row level security;
create policy user_settings_select_own on public.user_settings for select to authenticated using (auth.uid() = user_id);
create policy user_settings_insert_own on public.user_settings for insert to authenticated with check (auth.uid() = user_id);
create policy user_settings_update_own on public.user_settings for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create trigger user_settings_set_updated_at before update on public.user_settings for each row execute function public.set_updated_at();

-- ============ followup_flows ============
create table public.followup_flows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  is_active boolean not null default true,
  stop_on_reply boolean not null default true,
  window_start time,
  window_end time,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.followup_flows to authenticated;
grant all on public.followup_flows to service_role;
alter table public.followup_flows enable row level security;
create policy followup_flows_all_own on public.followup_flows for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create trigger followup_flows_set_updated_at before update on public.followup_flows for each row execute function public.set_updated_at();
create index followup_flows_user_idx on public.followup_flows (user_id, updated_at desc);

-- ============ followup_flow_steps ============
create table public.followup_flow_steps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  flow_id uuid not null references public.followup_flows(id) on delete cascade,
  position integer not null,
  delay_value integer not null default 0,
  delay_unit public.followup_delay_unit not null default 'hours',
  action_type public.followup_action_type not null default 'text_message',
  content text,
  media_reference text,
  media_mime_type text,
  media_filename text,
  preferred_time_start time,
  preferred_time_end time,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint followup_flow_steps_delay_positive check (delay_value >= 0 and delay_value <= 10000)
);
grant select, insert, update, delete on public.followup_flow_steps to authenticated;
grant all on public.followup_flow_steps to service_role;
alter table public.followup_flow_steps enable row level security;
create policy followup_flow_steps_all_own on public.followup_flow_steps for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create trigger followup_flow_steps_set_updated_at before update on public.followup_flow_steps for each row execute function public.set_updated_at();
create index followup_flow_steps_flow_idx on public.followup_flow_steps (flow_id, position);

create or replace function public.validate_flow_step_ownership()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.followup_flows f where f.id = new.flow_id and f.user_id = new.user_id) then
    raise exception 'flow_id does not belong to the owning user';
  end if;
  return new;
end;
$$;
revoke execute on function public.validate_flow_step_ownership() from anon, authenticated;
create trigger followup_flow_steps_validate_ownership before insert or update on public.followup_flow_steps for each row execute function public.validate_flow_step_ownership();

-- ============ followup_runs ============
create table public.followup_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  flow_id uuid not null references public.followup_flows(id) on delete restrict,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  opportunity_id uuid references public.opportunities(id) on delete set null,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  status public.followup_run_status not null default 'active',
  current_step_id uuid references public.followup_flow_steps(id) on delete set null,
  started_at timestamptz not null default now(),
  paused_at timestamptz,
  stopped_at timestamptz,
  completed_at timestamptz,
  stop_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.followup_runs to authenticated;
grant all on public.followup_runs to service_role;
alter table public.followup_runs enable row level security;
create policy followup_runs_all_own on public.followup_runs for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create trigger followup_runs_set_updated_at before update on public.followup_runs for each row execute function public.set_updated_at();
create index followup_runs_user_status_idx on public.followup_runs (user_id, status, started_at desc);
create index followup_runs_conversation_idx on public.followup_runs (conversation_id, status);
-- no máximo um acompanhamento vivo (ativo ou pausado) por conversa
create unique index followup_runs_one_live_per_conversation on public.followup_runs (conversation_id) where status in ('active','paused');

create or replace function public.validate_followup_run_ownership()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.followup_flows f where f.id = new.flow_id and f.user_id = new.user_id) then
    raise exception 'flow_id does not belong to the owning user';
  end if;
  if not exists (select 1 from public.contacts c where c.id = new.contact_id and c.user_id = new.user_id) then
    raise exception 'contact_id does not belong to the owning user';
  end if;
  if not exists (select 1 from public.conversations c where c.id = new.conversation_id and c.user_id = new.user_id) then
    raise exception 'conversation_id does not belong to the owning user';
  end if;
  if new.opportunity_id is not null and not exists (
    select 1 from public.opportunities o where o.id = new.opportunity_id and o.user_id = new.user_id
  ) then
    raise exception 'opportunity_id does not belong to the owning user';
  end if;
  return new;
end;
$$;
revoke execute on function public.validate_followup_run_ownership() from anon, authenticated;
create trigger followup_runs_validate_ownership before insert or update on public.followup_runs for each row execute function public.validate_followup_run_ownership();

-- ============ scheduled_actions ============
create table public.scheduled_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  flow_run_id uuid references public.followup_runs(id) on delete cascade,
  flow_step_id uuid references public.followup_flow_steps(id) on delete set null,
  contact_id uuid references public.contacts(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  opportunity_id uuid references public.opportunities(id) on delete set null,
  action_type public.followup_action_type not null default 'text_message',
  content text,
  media_reference text,
  media_mime_type text,
  media_filename text,
  scheduled_for timestamptz not null,
  status public.scheduled_action_status not null default 'scheduled',
  cancel_on_reply boolean not null default true,
  executed_at timestamptz,
  external_message_id text,
  message_id uuid references public.messages(id) on delete set null,
  attempts integer not null default 0,
  last_error text,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint scheduled_actions_attempts_bounded check (attempts >= 0 and attempts <= 10)
);
grant select, insert, update on public.scheduled_actions to authenticated;
grant all on public.scheduled_actions to service_role;
alter table public.scheduled_actions enable row level security;
create policy scheduled_actions_all_own on public.scheduled_actions for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create trigger scheduled_actions_set_updated_at before update on public.scheduled_actions for each row execute function public.set_updated_at();
-- idempotência: a mesma ação lógica nunca pode existir duas vezes
create unique index scheduled_actions_idempotency_key_uniq on public.scheduled_actions (user_id, idempotency_key);
create index scheduled_actions_due_idx on public.scheduled_actions (scheduled_for) where status = 'scheduled';
create index scheduled_actions_conversation_idx on public.scheduled_actions (conversation_id, status, scheduled_for);
create index scheduled_actions_run_idx on public.scheduled_actions (flow_run_id, status, scheduled_for);
create index scheduled_actions_user_idx on public.scheduled_actions (user_id, status, scheduled_for);

create or replace function public.validate_scheduled_action_ownership()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.conversations c where c.id = new.conversation_id and c.user_id = new.user_id) then
    raise exception 'conversation_id does not belong to the owning user';
  end if;
  if new.contact_id is not null and not exists (
    select 1 from public.contacts c where c.id = new.contact_id and c.user_id = new.user_id
  ) then
    raise exception 'contact_id does not belong to the owning user';
  end if;
  if new.flow_run_id is not null and not exists (
    select 1 from public.followup_runs r where r.id = new.flow_run_id and r.user_id = new.user_id
  ) then
    raise exception 'flow_run_id does not belong to the owning user';
  end if;
  return new;
end;
$$;
revoke execute on function public.validate_scheduled_action_ownership() from anon, authenticated;
create trigger scheduled_actions_validate_ownership before insert or update on public.scheduled_actions for each row execute function public.validate_scheduled_action_ownership();

-- realtime para acompanhar automações na interface
alter table public.followup_runs replica identity full;
alter table public.scheduled_actions replica identity full;
alter publication supabase_realtime add table public.followup_runs;
alter publication supabase_realtime add table public.scheduled_actions;