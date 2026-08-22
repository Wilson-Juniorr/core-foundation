import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { whatsappKeys } from "@/lib/whatsapp.queries";

/**
 * Atualiza a Central de Conversas em tempo real. Um único canal cobre
 * mensagens e conversas; a invalidação delega o refetch ao React Query.
 */
export function useWhatsAppRealtime(conversationId: string | null) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const channel = supabase
      .channel("whatsapp-inbox")
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, () => {
        void queryClient.invalidateQueries({ queryKey: whatsappKeys.conversationsRoot });
        if (conversationId) {
          void queryClient.invalidateQueries({
            queryKey: whatsappKeys.conversation(conversationId),
          });
        }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, () => {
        void queryClient.invalidateQueries({ queryKey: whatsappKeys.conversationsRoot });
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [conversationId, queryClient]);
}
