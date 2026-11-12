ALTER TABLE public.followup_runs
  ADD COLUMN post_quote_context_note text
  CHECK (post_quote_context_note IS NULL OR
         (policy_key IS NOT DISTINCT FROM 'post_quote_v1' AND
          char_length(btrim(post_quote_context_note)) BETWEEN 20 AND 1500));
