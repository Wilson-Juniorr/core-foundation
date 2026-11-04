CREATE TABLE public.commercial_conditions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  operator text NOT NULL,
  title text NOT NULL,
  discount_percent numeric,
  audience text,
  valid_until date,
  issuance_days integer,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.commercial_conditions TO authenticated;
GRANT ALL ON public.commercial_conditions TO service_role;
ALTER TABLE public.commercial_conditions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own conditions" ON public.commercial_conditions FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX commercial_conditions_user_idx ON public.commercial_conditions(user_id, is_active);