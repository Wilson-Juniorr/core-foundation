-- ENUMS
create type public.whatsapp_connection_status as enum ('not_configured','disconnected','connecting','connected','error');
create type public.message_direction as enum ('inbound','outbound');
create type public.message_type as enum ('text','audio','image','document','video','unsupported');
create type public.message_status as enum ('pending','sent','delivered','read','failed','received');

-- CONNECTIONS
create table public.whatsapp_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'uzapi',
  instance_identifier text,
  phone_number text,
  display_name text,
  status public.whatsapp_connection_status not null default 'not_configured',
  webhook_secret text not null default encode(gen_random_bytes(24), 'hex'),
  last_connected_at timestamptz,
  last_event_at timestamptz,
  last_synced_at timestamptz,
  last_sync_status text,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index whatsapp_connections_user_id_key on public.whatsapp_connections(user_id);

grant select, insert, update, delete on public.whatsapp_connections to authenticated;
grant all on public.whatsapp_connections to service_role;
alter table public.whatsapp_connections enable row level security;
create policy whatsapp_connections_all_own on public.whatsapp_connections
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create trigger whatsapp_connections_set_updated_at before update on public.whatsapp_connections
  for each row execute function public.set_updated_at();

-- CREDENTIALS (locked: server-only)
create table public.whatsapp_credentials (
  connection_id uuid primary key references public.whatsapp_connections(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  base_url text not null,
  token text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant all on public.whatsapp_credentials to service_role;
alter table public.whatsapp_credentials enable row level security;
create trigger whatsapp_credentials_set_updated_at before update on public.whatsapp_credentials
  for each row execute function public.set_updated_at();

-- CONVERSATIONS
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  whatsapp_connection_id uuid not null references public.whatsapp_connections(id) on delete cascade,
  external_chat_id text not null,
  phone_number text,
  display_name text,
  last_message_at timestamptz,
  last_message_preview text,
  unread_count integer not null default 0,
  is_archived boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index conversations_connection_chat_key
  on public.conversations(whatsapp_connection_id, external_chat_id);
create index conversations_user_last_message_idx
  on public.conversations(user_id, last_message_at desc nulls last);
create index conversations_contact_idx on public.conversations(contact_id);

grant select, insert, update, delete on public.conversations to authenticated;
grant all on public.conversations to service_role;
alter table public.conversations enable row level security;
create policy conversations_all_own on public.conversations
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create trigger conversations_set_updated_at before update on public.conversations
  for each row execute function public.set_updated_at();

-- MESSAGES
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  external_message_id text,
  direction public.message_direction not null,
  sender_phone text,
  recipient_phone text,
  message_type public.message_type not null default 'text',
  text_content text,
  media_url text,
  media_mime_type text,
  media_filename text,
  media_duration integer,
  status public.message_status not null default 'pending',
  sent_at timestamptz not null default now(),
  delivered_at timestamptz,
  read_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index messages_user_external_id_key
  on public.messages(user_id, external_message_id)
  where external_message_id is not null;
create index messages_conversation_sent_at_idx on public.messages(conversation_id, sent_at);

grant select, insert, update, delete on public.messages to authenticated;
grant all on public.messages to service_role;
alter table public.messages enable row level security;
create policy messages_all_own on public.messages
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create trigger messages_set_updated_at before update on public.messages
  for each row execute function public.set_updated_at();

-- OWNERSHIP VALIDATION
create or replace function public.validate_conversation_ownership()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not exists (
    select 1 from public.whatsapp_connections c
    where c.id = new.whatsapp_connection_id and c.user_id = new.user_id
  ) then
    raise exception 'whatsapp_connection_id does not belong to the owning user';
  end if;
  if new.contact_id is not null and not exists (
    select 1 from public.contacts c where c.id = new.contact_id and c.user_id = new.user_id
  ) then
    raise exception 'contact_id does not belong to the owning user';
  end if;
  return new;
end;
$$;
revoke execute on function public.validate_conversation_ownership() from anon, authenticated;

create trigger conversations_validate_ownership before insert or update on public.conversations
  for each row execute function public.validate_conversation_ownership();

create or replace function public.validate_message_ownership()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not exists (
    select 1 from public.conversations c
    where c.id = new.conversation_id and c.user_id = new.user_id
  ) then
    raise exception 'conversation_id does not belong to the owning user';
  end if;
  if new.contact_id is not null and not exists (
    select 1 from public.contacts c where c.id = new.contact_id and c.user_id = new.user_id
  ) then
    raise exception 'contact_id does not belong to the owning user';
  end if;
  return new;
end;
$$;
revoke execute on function public.validate_message_ownership() from anon, authenticated;

create trigger messages_validate_ownership before insert or update on public.messages
  for each row execute function public.validate_message_ownership();

-- REALTIME
alter table public.conversations replica identity full;
alter table public.messages replica identity full;
alter publication supabase_realtime add table public.conversations;
alter publication supabase_realtime add table public.messages;
