drop index if exists public.conversation_insights_dedupe_idx;

alter table public.conversation_insights
  add column if not exists dedupe_key text;

update public.conversation_insights
set dedupe_key = insight_type || '|' || coalesce(source_message_id::text, 'none') || '|' || lower(left(content, 200))
where dedupe_key is null;

create unique index conversation_insights_dedupe_idx
  on public.conversation_insights (user_id, contact_id, dedupe_key);