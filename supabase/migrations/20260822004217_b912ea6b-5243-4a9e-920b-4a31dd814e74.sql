-- Módulo 04: memória do cliente, insights e uso de IA

create type public.memory_source as enum ('ai', 'human', 'system');
create type public.ai_job_status as enum ('pending', 'processing', 'done', 'failed');
create type public.insight_status as enum ('open', 'accepted', 'dismissed');

create table public.customer_memory (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  opportunity_id uuid references public.opportunities(id) on delete set null,
  current_summary text,
  customer_intent text not null default 'unknown',
  interest_level text not null default 'unknown',
  sentiment text not null default 'unknown',
  main_objections jsonb not null default '[]'::jsonb,
  pending_information jsonb not null default '[]'::jsonb,
  customer_commitments jsonb not null default '[]'::jsonb,
  seller_commitments jsonb not null default '[]'::jsonb,
  important_dates jsonb not null default '[]'::jsonb,
  products_or_services jsonb not null default '[]'::jsonb,
  relevant_values jsonb not null default '[]'::jsonb,
  decision_factors jsonb not null default '[]'::jsonb,
  competitors jsonb not null default '[]'::jsonb,
  next_step_detected text,
  do_not_contact boolean not null default false,
  last_analyzed_message_id uuid references public.messages(id) on delete set null,
  last_analyzed_at timestamp with time zone,
  confidence numeric(3,2) not null default 0 check (confidence >= 0 and confidence <= 1),
  /* Origem por campo: { "current_summary": { "source": "human", "at": "..." } }.
     Campos marcados como human nunca são sobrescritos pela IA. */
  field_sources jsonb not null default '{}'::jsonb,
  analysis_status text not null default 'idle',
  last_error text,
  model text,
  prompt_version text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create unique index customer_memory_scope_idx
  on public.customer_memory (user_id, contact_id, coalesce(opportunity_id, '00000000-0000-0000-0000-000000000000'::uuid));

grant select, insert, update on public.customer_memory to authenticated;
grant all on public.customer_memory to service_role;
alter table public.customer_memory enable row level security;

create policy customer_memory_select_own on public.customer_memory
  for select to authenticated using (auth.uid() = user_id);
create policy customer_memory_insert_own on public.customer_memory
  for insert to authenticated with check (auth.uid() = user_id);
create policy customer_memory_update_own on public.customer_memory
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create trigger customer_memory_set_updated_at
  before update on public.customer_memory
  for each row execute function public.set_updated_at();

create table public.conversation_insights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete cascade,
  opportunity_id uuid references public.opportunities(id) on delete set null,
  insight_type text not null,
  content text not null,
  confidence numeric(3,2) not null default 0 check (confidence >= 0 and confidence <= 1),
  source_message_id uuid references public.messages(id) on delete set null,
  source public.memory_source not null default 'ai',
  status public.insight_status not null default 'open',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create index conversation_insights_contact_idx
  on public.conversation_insights (user_id, contact_id, created_at desc);
/* Evita insight duplicado para a mesma mensagem/tipo/conteúdo. */
create unique index conversation_insights_dedupe_idx
  on public.conversation_insights (user_id, contact_id, insight_type, md5(content), coalesce(source_message_id, '00000000-0000-0000-0000-000000000000'::uuid));

grant select, insert, update, delete on public.conversation_insights to authenticated;
grant all on public.conversation_insights to service_role;
alter table public.conversation_insights enable row level security;

create policy conversation_insights_all_own on public.conversation_insights
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create trigger conversation_insights_set_updated_at
  before update on public.conversation_insights
  for each row execute function public.set_updated_at();

create table public.ai_analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete cascade,
  reason text not null default 'inbound_message',
  status public.ai_job_status not null default 'pending',
  attempts integer not null default 0,
  last_error text,
  requested_at timestamp with time zone not null default now(),
  claimed_at timestamp with time zone,
  finished_at timestamp with time zone,
  created_at timestamp with time zone not null default now()
);

/* Proteção contra processamento duplicado: um job pendente por contato. */
create unique index ai_analysis_jobs_pending_idx
  on public.ai_analysis_jobs (user_id, contact_id)
  where status in ('pending', 'processing');

create index ai_analysis_jobs_due_idx
  on public.ai_analysis_jobs (status, requested_at)
  where status = 'pending';

grant select on public.ai_analysis_jobs to authenticated;
grant all on public.ai_analysis_jobs to service_role;
alter table public.ai_analysis_jobs enable row level security;

create policy ai_analysis_jobs_select_own on public.ai_analysis_jobs
  for select to authenticated using (auth.uid() = user_id);

create table public.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  purpose text not null default 'conversation_analysis',
  model text not null,
  prompt_version text not null,
  input_tokens integer,
  output_tokens integer,
  total_tokens integer,
  estimated_cost_usd numeric(10,6),
  status text not null default 'success',
  error_message text,
  duration_ms integer,
  created_at timestamp with time zone not null default now()
);

create index ai_usage_events_user_idx on public.ai_usage_events (user_id, created_at desc);

grant select on public.ai_usage_events to authenticated;
grant all on public.ai_usage_events to service_role;
alter table public.ai_usage_events enable row level security;

create policy ai_usage_events_select_own on public.ai_usage_events
  for select to authenticated using (auth.uid() = user_id);

-- Validação de propriedade cruzada (mesmo padrão dos módulos anteriores)
create or replace function public.validate_memory_ownership()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not exists (select 1 from public.contacts c where c.id = new.contact_id and c.user_id = new.user_id) then
    raise exception 'contact_id does not belong to the owning user';
  end if;
  if new.opportunity_id is not null and not exists (
    select 1 from public.opportunities o where o.id = new.opportunity_id and o.user_id = new.user_id
  ) then
    raise exception 'opportunity_id does not belong to the owning user';
  end if;
  return new;
end;
$$;

revoke execute on function public.validate_memory_ownership() from public, anon, authenticated;

create trigger customer_memory_validate_ownership
  before insert or update on public.customer_memory
  for each row execute function public.validate_memory_ownership();

create trigger conversation_insights_validate_ownership
  before insert or update on public.conversation_insights
  for each row execute function public.validate_memory_ownership();