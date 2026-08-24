CREATE UNIQUE INDEX IF NOT EXISTS conversations_connection_phone_key
  ON public.conversations (whatsapp_connection_id, phone_number)
  WHERE phone_number IS NOT NULL;