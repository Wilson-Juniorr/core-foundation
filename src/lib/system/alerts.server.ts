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

  try {
    // O helper só existe depois que o domínio de envio é configurado.
    const module = await import("@/lib/email-templates/send-email").catch(() => null);
    const send = (
      module as {
        sendTemplateEmail?: (
          template: string,
          to: string,
          options: { templateData: Record<string, string>; idempotencyKey: string },
        ) => Promise<unknown>;
      } | null
    )?.sendTemplateEmail;
    if (!send) return;

    await send("system-alert", email, {
      templateData: { title: alert.title, body: alert.body },
      idempotencyKey: `system-alert-${alert.kind}-${userId}-${new Date().toISOString().slice(0, 13)}`,
    });
  } catch (error) {
    waLog.warn("owner_alert_email_failed", {
      reason: error instanceof Error ? error.message : "unknown",
    });
  }
}

async function ownerEmail(db: Admin, userId: string): Promise<string | null> {
  try {
    const { data } = await db.auth.admin.getUserById(userId);
    return data?.user?.email ?? null;
  } catch {
    return null;
  }
}
