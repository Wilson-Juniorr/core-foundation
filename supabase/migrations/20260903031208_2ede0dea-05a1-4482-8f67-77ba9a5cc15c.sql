WITH new_flow AS (
  INSERT INTO public.followup_flows (user_id, name, description, kind, is_active, stop_on_reply, window_start, window_end)
  SELECT u.id,
         'Pós-cotação — até a decisão',
         'Acompanhamento inteligente após o envio da cotação: só libera o cliente com recusa explícita, entende o motivo e, se necessário, declina com elegância.',
         'smart',
         true,
         false,
         '09:00',
         '19:00'
  FROM auth.users u
  WHERE NOT EXISTS (
    SELECT 1 FROM public.followup_flows f
    WHERE f.user_id = u.id AND f.name = 'Pós-cotação — até a decisão'
  )
  RETURNING id, user_id
)
INSERT INTO public.smart_flow_configs (
  flow_id, user_id, goal, max_duration_days, autonomy, allowed_strategies, allowed_media,
  max_pressure, min_hours_between_actions, max_actions_per_week, handoff_situations,
  completion_criteria, confidence_min
)
SELECT nf.id,
       nf.user_id,
       'Levar o cliente à decisão depois da cotação enviada, sem pressionar. Só encerrar quando ele recusar de forma explícita, e antes disso entender o motivo da recusa.',
       90,
       'assist',
       ARRAY['LIGHT_FOLLOWUP','QUESTION_DISCOVERY','VALUE_REINFORCEMENT','DECISION_SIMPLIFICATION','LOW_EFFORT_REPLY','WAITING_DECISION','FUTURE_CALLBACK','REACTIVATION','LOSS_REASON_DISCOVERY','GRACEFUL_DECLINE','HUMAN_HANDOFF']::text[],
       ARRAY['text','audio']::text[],
       60,
       36,
       2,
       ARRAY['Cliente irritado','Pedido de desconto','Dúvida jurídica ou contratual','Cliente quer fechar','Cliente pediu ligação']::text[],
       'Cliente confirmou a recusa e recebeu a mensagem de encerramento, ou fechou o negócio.',
       0.6
FROM new_flow nf;