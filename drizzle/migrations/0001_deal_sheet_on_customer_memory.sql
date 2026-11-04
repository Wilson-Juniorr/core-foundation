ALTER TABLE public.customer_memory
  ADD COLUMN IF NOT EXISTS deal_stage text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS decision_maker text,
  ADD COLUMN IF NOT EXISTS quoted_operator text,
  ADD COLUMN IF NOT EXISTS quoted_plan text,
  ADD COLUMN IF NOT EXISTS quoted_value numeric,
  ADD COLUMN IF NOT EXISTS quoted_lives integer,
  ADD COLUMN IF NOT EXISTS temperature text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS temperature_reason text;