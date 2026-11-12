ALTER TABLE public.opportunities
  ADD COLUMN post_sale_stage text,
  ADD COLUMN post_sale_due_on date,
  ADD COLUMN post_sale_effective_on date,
  ADD COLUMN post_sale_note text,
  ADD COLUMN post_sale_version integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT opportunities_post_sale_state_check CHECK (
    (post_sale_stage IS NULL AND post_sale_due_on IS NULL AND post_sale_effective_on IS NULL
      AND post_sale_note IS NULL AND post_sale_version = 0)
    OR
    (post_sale_stage IS NOT NULL AND post_sale_version > 0 AND (
      (post_sale_stage IN ('issuing', 'pending') AND post_sale_due_on IS NOT NULL
        AND post_sale_effective_on IS NULL)
      OR (post_sale_stage = 'onboarding' AND post_sale_effective_on IS NOT NULL
        AND post_sale_due_on = post_sale_effective_on + 7 AND post_sale_due_on IS NOT NULL)
      OR (post_sale_stage = 'done' AND post_sale_effective_on IS NOT NULL
        AND post_sale_due_on IS NULL)
    ))
  ),
  ADD CONSTRAINT opportunities_post_sale_note_check CHECK (
    post_sale_note IS NULL OR char_length(btrim(post_sale_note)) BETWEEN 1 AND 1500
  ),
  ADD CONSTRAINT opportunities_post_sale_pending_note_check CHECK (
    post_sale_stage IS DISTINCT FROM 'pending' OR post_sale_note IS NOT NULL
  );
--> statement-breakpoint
CREATE INDEX opportunities_post_sale_due_idx
  ON public.opportunities (user_id, post_sale_due_on)
  WHERE status = 'won' AND post_sale_due_on IS NOT NULL;
