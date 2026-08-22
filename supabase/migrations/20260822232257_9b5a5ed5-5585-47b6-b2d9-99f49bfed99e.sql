create index if not exists idx_contacts_user_created on public.contacts (user_id, created_at desc);
create index if not exists idx_opportunities_user_created on public.opportunities (user_id, created_at desc);
create index if not exists idx_opportunities_user_stage_status on public.opportunities (user_id, pipeline_stage_id, status);
create index if not exists idx_messages_conv_direction_sent on public.messages (conversation_id, direction, sent_at);
create index if not exists idx_messages_user_direction_sent on public.messages (user_id, direction, sent_at desc);
create index if not exists idx_messages_user_status on public.messages (user_id, status);
create index if not exists idx_scheduled_actions_user_status_exec on public.scheduled_actions (user_id, status, executed_at desc);
create index if not exists idx_scheduled_actions_message on public.scheduled_actions (message_id);
create index if not exists idx_scheduled_actions_user_sched on public.scheduled_actions (user_id, scheduled_for);
create index if not exists idx_followup_runs_user_flow_started on public.followup_runs (user_id, flow_id, started_at desc);
create index if not exists idx_timeline_events_user_type_created on public.timeline_events (user_id, event_type, created_at desc);
create index if not exists idx_timeline_events_opportunity_created on public.timeline_events (opportunity_id, created_at);
create index if not exists idx_message_drafts_user_strategy on public.message_drafts (user_id, strategy_id, strategy_version);
create index if not exists idx_ai_jobs_user_status on public.ai_analysis_jobs (user_id, status);
create index if not exists idx_ai_usage_user_created on public.ai_usage_events (user_id, created_at desc);

create or replace function public.analytics_overview(_from timestamptz, _to timestamptz)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
with sent_actions as (
  select sa.id, sa.conversation_id, sa.contact_id, sa.executed_at
  from public.scheduled_actions sa
  where sa.user_id = auth.uid()
    and sa.status = 'sent'
    and sa.executed_at >= _from and sa.executed_at < _to
),
reply_info as (
  select s.id, s.contact_id, s.executed_at,
    (select min(m.sent_at) from public.messages m
      where m.conversation_id = s.conversation_id and m.direction = 'inbound'
        and m.sent_at > s.executed_at and m.sent_at < s.executed_at + interval '72 hours') as replied_at,
    (select max(m2.sent_at) from public.messages m2
      where m2.conversation_id = s.conversation_id and m2.direction = 'inbound'
        and m2.sent_at < s.executed_at) as prev_inbound_at
  from sent_actions s
),
outbound as (
  select m.id, m.status, (sa.id is not null) as automated
  from public.messages m
  left join public.scheduled_actions sa on sa.message_id = m.id
  where m.user_id = auth.uid() and m.direction = 'outbound'
    and m.sent_at >= _from and m.sent_at < _to
),
period_opps as (
  select o.id, o.status, o.contact_id
  from public.opportunities o
  where o.user_id = auth.uid() and o.created_at >= _from and o.created_at < _to
),
opps_with_flow as (
  select p.id, p.status,
    exists (select 1 from public.followup_runs r where r.user_id = auth.uid() and r.contact_id = p.contact_id) as has_followup
  from period_opps p
)
select jsonb_build_object(
  'new_contacts', (select count(*) from public.contacts c where c.user_id = auth.uid() and c.created_at >= _from and c.created_at < _to),
  'new_opportunities', (select count(*) from period_opps),
  'opportunities_open', (select count(*) from public.opportunities o where o.user_id = auth.uid() and o.status = 'open'),
  'opportunities_won', (select count(*) from public.timeline_events t where t.user_id = auth.uid() and t.event_type = 'opportunity_won' and t.created_at >= _from and t.created_at < _to),
  'opportunities_lost', (select count(*) from public.timeline_events t where t.user_id = auth.uid() and t.event_type = 'opportunity_lost' and t.created_at >= _from and t.created_at < _to),
  'opportunities_without_next_action', (select count(*) from public.opportunities o where o.user_id = auth.uid() and o.status = 'open' and o.next_action_at is null),
  'opportunities_overdue', (select count(*) from public.opportunities o where o.user_id = auth.uid() and o.status = 'open' and o.next_action_at is not null and o.next_action_at < now()),
  'followups_started', (select count(*) from public.followup_runs r where r.user_id = auth.uid() and r.started_at >= _from and r.started_at < _to),
  'followups_sent', (select count(*) from sent_actions),
  'followups_with_reply', (select count(*) from reply_info where replied_at is not null),
  'reply_rate', (select case when count(*) = 0 then null else round(count(replied_at)::numeric * 100 / count(*), 1) end from reply_info),
  'avg_reply_seconds', (select case when count(replied_at) = 0 then null else round(avg(extract(epoch from (replied_at - executed_at)))) end from reply_info),
  'recovered_contacts', (select count(distinct contact_id) from reply_info where replied_at is not null and (prev_inbound_at is null or prev_inbound_at < executed_at - interval '7 days')),
  'messages_automatic', (select count(*) from outbound where automated),
  'messages_manual', (select count(*) from outbound where not automated),
  'messages_failed', (select count(*) from outbound where status = 'failed'),
  'actions_failed', (select count(*) from public.scheduled_actions sa where sa.user_id = auth.uid() and sa.status = 'failed' and sa.updated_at >= _from and sa.updated_at < _to),
  'human_interventions', (select count(*) from public.timeline_events t where t.user_id = auth.uid() and t.event_type in ('attention_handoff_paused','attention_resolved','followup_paused') and t.created_at >= _from and t.created_at < _to),
  'opt_out_contacts', (select count(*) from public.contact_preferences p where p.user_id = auth.uid() and p.do_not_contact),
  'opt_outs_in_period', (select count(*) from public.timeline_events t where t.user_id = auth.uid() and t.event_type = 'customer_opt_out' and t.created_at >= _from and t.created_at < _to),
  'conversion_with_followup', (select jsonb_build_object(
      'total', count(*),
      'won', count(*) filter (where status = 'won'),
      'rate', case when count(*) = 0 then null else round(count(*) filter (where status = 'won')::numeric * 100 / count(*), 1) end
    ) from opps_with_flow where has_followup),
  'conversion_without_followup', (select jsonb_build_object(
      'total', count(*),
      'won', count(*) filter (where status = 'won'),
      'rate', case when count(*) = 0 then null else round(count(*) filter (where status = 'won')::numeric * 100 / count(*), 1) end
    ) from opps_with_flow where not has_followup)
);
$$;

create or replace function public.analytics_funnel(_from timestamptz, _to timestamptz)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
with events as (
  select t.opportunity_id,
         (t.metadata->>'from_stage_id')::uuid as from_stage_id,
         (t.metadata->>'to_stage_id')::uuid as to_stage_id,
         t.created_at
  from public.timeline_events t
  where t.user_id = auth.uid() and t.event_type = 'stage_changed' and t.opportunity_id is not null
),
segments as (
  select e.from_stage_id as stage_id, o.created_at as entered_at, e.created_at as left_at
  from events e
  join public.opportunities o on o.id = e.opportunity_id
  where e.created_at = (select min(e2.created_at) from events e2 where e2.opportunity_id = e.opportunity_id)
  union all
  select e.to_stage_id as stage_id, e.created_at as entered_at,
         (select min(e3.created_at) from events e3 where e3.opportunity_id = e.opportunity_id and e3.created_at > e.created_at) as left_at
  from events e
),
durations as (
  select stage_id, extract(epoch from (coalesce(left_at, now()) - entered_at)) as seconds
  from segments
  where stage_id is not null and entered_at >= _from - interval '365 days'
)
select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.position), '[]'::jsonb)
from (
  select s.id as stage_id, s.name, s.position,
    (select count(*) from public.opportunities o where o.user_id = auth.uid() and o.pipeline_stage_id = s.id and o.status = 'open') as open_count,
    (select count(*) from public.opportunities o where o.user_id = auth.uid() and o.pipeline_stage_id = s.id and o.status = 'won') as won_count,
    (select count(*) from public.opportunities o where o.user_id = auth.uid() and o.pipeline_stage_id = s.id and o.status = 'lost') as lost_count,
    (select count(*) from events e where e.to_stage_id = s.id and e.created_at >= _from and e.created_at < _to) as entered_in_period,
    (select round(avg(d.seconds)) from durations d where d.stage_id = s.id) as avg_seconds_in_stage
  from public.pipeline_stages s
  where s.user_id = auth.uid() and s.is_active
) x;
$$;

create or replace function public.analytics_flows(_from timestamptz, _to timestamptz)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
with runs as (
  select r.id, r.flow_id, r.status, r.started_at, r.conversation_id, r.current_step_id,
    (select min(m.sent_at) from public.messages m
      where m.conversation_id = r.conversation_id and m.direction = 'inbound' and m.sent_at > r.started_at) as replied_at
  from public.followup_runs r
  where r.user_id = auth.uid() and r.started_at >= _from and r.started_at < _to
),
step_positions as (
  select s.id, s.position from public.followup_flow_steps s where s.user_id = auth.uid()
)
select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.started desc), '[]'::jsonb)
from (
  select f.id as flow_id, f.name, f.is_active,
    count(r.id) as started,
    count(r.replied_at) as replied,
    case when count(r.id) = 0 then null else round(count(r.replied_at)::numeric * 100 / count(r.id), 1) end as reply_rate,
    count(*) filter (where r.status = 'completed') as completed,
    count(*) filter (where r.status in ('stopped','cancelled','paused')) as interrupted,
    count(*) filter (where r.status = 'failed') as failed,
    round(avg(extract(epoch from (r.replied_at - r.started_at)))) as avg_reply_seconds,
    (select sp.position from step_positions sp
      where sp.id = (select r2.current_step_id from runs r2 where r2.flow_id = f.id and r2.replied_at is not null
                     order by r2.replied_at desc limit 1)) as last_reply_step_position,
    (select count(distinct o.id) from public.opportunities o
      join public.followup_runs r3 on r3.contact_id = o.contact_id and r3.flow_id = f.id
      where o.user_id = auth.uid() and o.status = 'won') as won_opportunities
  from public.followup_flows f
  left join runs r on r.flow_id = f.id
  where f.user_id = auth.uid()
  group by f.id, f.name, f.is_active
) x;
$$;

create or replace function public.analytics_strategies(_from timestamptz, _to timestamptz)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
with drafts as (
  select d.id, d.strategy_id, d.strategy_version, d.strategy_name, d.status, d.contact_id, d.created_at
  from public.message_drafts d
  where d.user_id = auth.uid() and d.strategy_id is not null
    and d.created_at >= _from and d.created_at < _to
)
select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.generated desc), '[]'::jsonb)
from (
  select d.strategy_id, d.strategy_version,
    coalesce(max(s.name), max(d.strategy_name)) as name,
    max(s.version) as current_version,
    count(*) as generated,
    count(*) filter (where d.status = 'sent') as sent,
    count(*) filter (where d.status = 'approved') as approved,
    count(*) filter (where d.status = 'edited') as edited,
    count(*) filter (where d.status = 'rejected') as rejected,
    count(distinct d.contact_id) as contacts,
    (select count(distinct o.id) from public.opportunities o
      where o.user_id = auth.uid() and o.status = 'won'
        and o.contact_id in (select d2.contact_id from drafts d2 where d2.strategy_id = d.strategy_id and d2.strategy_version = d.strategy_version and d2.status = 'sent')
    ) as won_opportunities
  from drafts d
  left join public.message_strategies s on s.id = d.strategy_id
  group by d.strategy_id, d.strategy_version
) x;
$$;

create or replace function public.analytics_health()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
select jsonb_build_object(
  'connections', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'status', c.status, 'phone_number', c.phone_number,
        'display_name', c.display_name, 'last_event_at', c.last_event_at,
        'last_synced_at', c.last_synced_at, 'last_sync_status', c.last_sync_status)), '[]'::jsonb)
      from public.whatsapp_connections c where c.user_id = auth.uid()),
  'webhook_last_event_at', (select max(c.last_event_at) from public.whatsapp_connections c where c.user_id = auth.uid()),
  'actions_pending', (select count(*) from public.scheduled_actions sa where sa.user_id = auth.uid() and sa.status in ('scheduled','processing')),
  'actions_overdue', (select count(*) from public.scheduled_actions sa where sa.user_id = auth.uid() and sa.status = 'scheduled' and sa.scheduled_for < now() - interval '5 minutes'),
  'actions_failed_24h', (select count(*) from public.scheduled_actions sa where sa.user_id = auth.uid() and sa.status = 'failed' and sa.updated_at > now() - interval '24 hours'),
  'actions_blocked_24h', (select count(*) from public.scheduled_actions sa where sa.user_id = auth.uid() and sa.status in ('blocked','skipped') and sa.updated_at > now() - interval '24 hours'),
  'messages_failed_24h', (select count(*) from public.messages m where m.user_id = auth.uid() and m.status = 'failed' and m.sent_at > now() - interval '24 hours'),
  'messages_failed_prev_24h', (select count(*) from public.messages m where m.user_id = auth.uid() and m.status = 'failed' and m.sent_at > now() - interval '48 hours' and m.sent_at <= now() - interval '24 hours'),
  'messages_sent_24h', (select count(*) from public.messages m where m.user_id = auth.uid() and m.direction = 'outbound' and m.sent_at > now() - interval '24 hours'),
  'ai_jobs_pending', (select count(*) from public.ai_analysis_jobs j where j.user_id = auth.uid() and j.status in ('pending','processing')),
  'ai_jobs_failed_24h', (select count(*) from public.ai_analysis_jobs j where j.user_id = auth.uid() and j.status = 'failed' and j.created_at > now() - interval '24 hours'),
  'ai_calls_failed_24h', (select count(*) from public.ai_usage_events e where e.user_id = auth.uid() and e.status <> 'success' and e.created_at > now() - interval '24 hours'),
  'ai_cost_30d', (select coalesce(round(sum(e.estimated_cost_usd), 4), 0) from public.ai_usage_events e where e.user_id = auth.uid() and e.created_at > now() - interval '30 days'),
  'attention_open', (select count(*) from public.attention_items a where a.user_id = auth.uid() and a.status = 'open'),
  'automation_paused', (select coalesce(bool_or(s.automation_paused), false) from public.user_settings s where s.user_id = auth.uid()),
  'test_mode', (select coalesce(bool_or(s.test_mode), false) from public.user_settings s where s.user_id = auth.uid())
);
$$;

revoke all on function public.analytics_overview(timestamptz, timestamptz) from public, anon;
revoke all on function public.analytics_funnel(timestamptz, timestamptz) from public, anon;
revoke all on function public.analytics_flows(timestamptz, timestamptz) from public, anon;
revoke all on function public.analytics_strategies(timestamptz, timestamptz) from public, anon;
revoke all on function public.analytics_health() from public, anon;

grant execute on function public.analytics_overview(timestamptz, timestamptz) to authenticated;
grant execute on function public.analytics_funnel(timestamptz, timestamptz) to authenticated;
grant execute on function public.analytics_flows(timestamptz, timestamptz) to authenticated;
grant execute on function public.analytics_strategies(timestamptz, timestamptz) to authenticated;
grant execute on function public.analytics_health() to authenticated;