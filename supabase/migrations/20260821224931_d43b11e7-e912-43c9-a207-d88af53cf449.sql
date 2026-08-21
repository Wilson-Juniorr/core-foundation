-- Utility: updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_select_own" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "profiles_insert_own" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE TRIGGER profiles_set_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- contacts
CREATE TABLE public.contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  source TEXT,
  notes TEXT,
  is_archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX contacts_user_idx ON public.contacts (user_id, is_archived, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contacts TO authenticated;
GRANT ALL ON public.contacts TO service_role;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "contacts_all_own" ON public.contacts FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER contacts_set_updated_at BEFORE UPDATE ON public.contacts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- pipeline_stages
CREATE TABLE public.pipeline_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX pipeline_stages_user_idx ON public.pipeline_stages (user_id, position);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pipeline_stages TO authenticated;
GRANT ALL ON public.pipeline_stages TO service_role;
ALTER TABLE public.pipeline_stages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pipeline_stages_all_own" ON public.pipeline_stages FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER pipeline_stages_set_updated_at BEFORE UPDATE ON public.pipeline_stages FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- opportunities
CREATE TYPE public.opportunity_status AS ENUM ('open', 'won', 'lost', 'archived');

CREATE TABLE public.opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  pipeline_stage_id UUID NOT NULL REFERENCES public.pipeline_stages(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  status public.opportunity_status NOT NULL DEFAULT 'open',
  estimated_value NUMERIC(14,2),
  next_action_description TEXT,
  next_action_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX opportunities_user_idx ON public.opportunities (user_id, status);
CREATE INDEX opportunities_contact_idx ON public.opportunities (contact_id);
CREATE INDEX opportunities_stage_idx ON public.opportunities (pipeline_stage_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.opportunities TO authenticated;
GRANT ALL ON public.opportunities TO service_role;
ALTER TABLE public.opportunities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "opportunities_all_own" ON public.opportunities FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER opportunities_set_updated_at BEFORE UPDATE ON public.opportunities FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Ownership validation across relationships
CREATE OR REPLACE FUNCTION public.validate_opportunity_ownership()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = NEW.contact_id AND c.user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'contact_id does not belong to the owning user';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pipeline_stages s WHERE s.id = NEW.pipeline_stage_id AND s.user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'pipeline_stage_id does not belong to the owning user';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER opportunities_validate_ownership
BEFORE INSERT OR UPDATE ON public.opportunities
FOR EACH ROW EXECUTE FUNCTION public.validate_opportunity_ownership();

-- timeline_events
CREATE TABLE public.timeline_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE CASCADE,
  opportunity_id UUID REFERENCES public.opportunities(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX timeline_events_contact_idx ON public.timeline_events (contact_id, created_at DESC);
CREATE INDEX timeline_events_user_idx ON public.timeline_events (user_id, created_at DESC);
GRANT SELECT, INSERT ON public.timeline_events TO authenticated;
GRANT ALL ON public.timeline_events TO service_role;
ALTER TABLE public.timeline_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "timeline_events_select_own" ON public.timeline_events FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "timeline_events_insert_own" ON public.timeline_events FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.validate_timeline_event_ownership()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.contact_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.contacts c WHERE c.id = NEW.contact_id AND c.user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'contact_id does not belong to the owning user';
  END IF;
  IF NEW.opportunity_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.opportunities o WHERE o.id = NEW.opportunity_id AND o.user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'opportunity_id does not belong to the owning user';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER timeline_events_validate_ownership
BEFORE INSERT OR UPDATE ON public.timeline_events
FOR EACH ROW EXECUTE FUNCTION public.validate_timeline_event_ownership();

-- New user bootstrap: profile + default pipeline stages
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, email)
  VALUES (NEW.id, NEW.raw_user_meta_data ->> 'display_name', NEW.email)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.pipeline_stages (user_id, name, position)
  VALUES
    (NEW.id, 'Novo negócio', 1),
    (NEW.id, 'Tentativa de contato', 2),
    (NEW.id, 'Contato realizado', 3),
    (NEW.id, 'Cotação enviada', 4),
    (NEW.id, 'Cotação aprovada', 5),
    (NEW.id, 'Documentação completa', 6);

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();