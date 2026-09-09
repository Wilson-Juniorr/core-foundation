import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { waLog } from "@/lib/whatsapp/log.server";

type Admin = SupabaseClient<Database>;

export interface OwnerAlert {
  kind: "down" | "recovered";
  title: string;
  body: string;
}

/**
 * Canal de aviso externo do dono da conta.
 *
 * O aviso dentro do sistema (Central de Atenção + auditoria) já foi gravado
 * antes desta chamada, portanto uma falha aqui nunca esconde o incidente.
 * Quando o domínio de e-mail estiver configurado, o envio real acontece aqui.
 */
export async function sendOwnerAlert(db: Admin, userId: string, alert: OwnerAlert): Promise<void> {
  const email = await ownerEmail(db, userId);

  // Registro sempre existe, mesmo sem canal externo ativo.
  waLog.info("owner_alert", {
    user_id: userId,
    kind: alert.kind,
    has_email: Boolean(email),
  });

  if (!email) return;

  // O envio de e-mail é ligado assim que o domínio de envio estiver
  // configurado; até então o incidente fica registrado no sistema.
  waLog.info("owner_alert_email_pending", { user_id: userId, kind: alert.kind });
}

async function ownerEmail(db: Admin, userId: string): Promise<string | null> {
  try {
    const { data } = await db.auth.admin.getUserById(userId);
    return data?.user?.email ?? null;
  } catch {
    return null;
  }
}
