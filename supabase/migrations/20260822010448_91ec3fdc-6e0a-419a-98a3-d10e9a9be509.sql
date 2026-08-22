create type public.content_asset_type as enum ('text', 'audio', 'image', 'document');
create type public.strategy_autonomy as enum ('manual', 'approval_required', 'automatic');
create type public.draft_status as enum ('generated', 'edited', 'approved', 'rejected', 'sent');

create table public.content_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  type public.content_asset_type not null,
  purpose text,
  description text,
  body text,
  storage_reference text,
  mime_type text,
  filename text,
  duration_seconds integer,
  transcript text,
  tags text[] not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.content_assets to authenticated;
grant all on public.content_assets to service_role;
alter table public.content_assets enable row level security;
create policy "content_assets_own" on public.content_assets
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index content_assets_user_type_idx on public.content_assets (user_id, type, is_active);
create trigger content_assets_set_updated_at before update on public.content_assets
  for each row execute function public.set_updated_at();

create table public.message_strategies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  objective text not null,
  tone text not null default 'consultivo e direto',
  should_mention text,
  should_avoid text,
  when_to_use text,
  instructions text,
  channel text not null default 'whatsapp',
  allowed_asset_types public.content_asset_type[] not null default '{}',
  allowed_assets uuid[] not null default '{}',
  forbidden_behaviors text[] not null default '{}',
  autonomy_mode public.strategy_autonomy not null default 'approval_required',
  max_length integer not null default 600,
  is_active boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.message_strategies to authenticated;
grant all on public.message_strategies to service_role;
alter table public.message_strategies enable row level security;
create policy "message_strategies_own" on public.message_strategies
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index message_strategies_user_idx on public.message_strategies (user_id, is_active);
create trigger message_strategies_set_updated_at before update on public.message_strategies
  for each row execute function public.set_updated_at();

create table public.message_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete cascade,
  opportunity_id uuid references public.opportunities(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  strategy_id uuid references public.message_strategies(id) on delete set null,
  strategy_version integer,
  strategy_name text,
  generated_content text not null,
  original_content text not null,
  edited_content text,
  suggested_asset_id uuid references public.content_assets(id) on delete set null,
  asset_rationale text,
  status public.draft_status not null default 'generated',
  is_preview boolean not null default false,
  model text,
  prompt_version text,
  context_snapshot jsonb not null default '{}'::jsonb,
  rejection_reason text,
  message_id uuid references public.messages(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_at timestamptz,
  sent_at timestamptz
);

grant select, insert, update, delete on public.message_drafts to authenticated;
grant all on public.message_drafts to service_role;
alter table public.message_drafts enable row level security;
create policy "message_drafts_own" on public.message_drafts
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index message_drafts_user_status_idx on public.message_drafts (user_id, status, created_at desc);
create index message_drafts_contact_idx on public.message_drafts (contact_id, created_at desc);
create trigger message_drafts_set_updated_at before update on public.message_drafts
  for each row execute function public.set_updated_at();

create or replace function public.validate_draft_ownership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.contact_id is not null and not exists (
    select 1 from public.contacts c where c.id = new.contact_id and c.user_id = new.user_id
  ) then
    raise exception 'contact_id does not belong to the owning user';
  end if;
  if new.opportunity_id is not null and not exists (
    select 1 from public.opportunities o where o.id = new.opportunity_id and o.user_id = new.user_id
  ) then
    raise exception 'opportunity_id does not belong to the owning user';
  end if;
  if new.conversation_id is not null and not exists (
    select 1 from public.conversations c where c.id = new.conversation_id and c.user_id = new.user_id
  ) then
    raise exception 'conversation_id does not belong to the owning user';
  end if;
  if new.strategy_id is not null and not exists (
    select 1 from public.message_strategies s where s.id = new.strategy_id and s.user_id = new.user_id
  ) then
    raise exception 'strategy_id does not belong to the owning user';
  end if;
  if new.suggested_asset_id is not null and not exists (
    select 1 from public.content_assets a where a.id = new.suggested_asset_id and a.user_id = new.user_id
  ) then
    raise exception 'suggested_asset_id does not belong to the owning user';
  end if;
  return new;
end;
$$;

revoke execute on function public.validate_draft_ownership() from public, anon, authenticated;

create trigger message_drafts_validate_ownership before insert or update on public.message_drafts
  for each row execute function public.validate_draft_ownership();