import type { ConnectionStatus } from "./types";

/**
 * Lê o status bruto da conexão vindo do provedor.
 *
 * ATENÇÃO: "disconnected" contém a palavra "connected". A desconexão precisa
 * ser testada ANTES da conexão — senão um WhatsApp desconectado passa como
 * conectado e nenhum alerta é disparado.
 */
export function mapConnectionStatus(raw: string | null): ConnectionStatus {
  const value = (raw ?? "").toLowerCase().trim();
  if (
    value.includes("disconnect") ||
    value.includes("logout") ||
    value.includes("logged out") ||
    value.includes("close") ||
    value.includes("not connected") ||
    value.includes("unpaired")
  ) {
    return "disconnected";
  }
  if (value.includes("error") || value.includes("banned")) return "error";
  if (value.includes("qr") || value.includes("connecting") || value.includes("pairing")) {
    return "connecting";
  }
  if (value === "connected" || value.includes("open") || value.includes("authenticated")) {
    return "connected";
  }
  return "disconnected";
}

/**
 * A UAZAPI também devolve flags booleanas (`status.connected`, `status.loggedIn`).
 * Quando alguma delas diz "não", a sessão está fora — vale mais que o texto.
 */
export function sessionFlagsSayOffline(response: Record<string, unknown>): boolean {
  const flags = response["status"];
  if (!flags || typeof flags !== "object") return false;
  const record = flags as Record<string, unknown>;
  return record["connected"] === false || record["loggedIn"] === false;
}

/** Resposta de erro do provedor que significa "WhatsApp desconectado". */
export function isDisconnectedReply(statusCode: number | null, body: string): boolean {
  const text = body.toLowerCase();
  if (
    text.includes("disconnected") ||
    text.includes("not connected") ||
    text.includes("not logged") ||
    text.includes("logged out") ||
    text.includes("not reconnectable")
  ) {
    return true;
  }
  return statusCode === 503 && text.includes("session");
}

/** Mensagem padrão usada em toda a cadeia; o motor reconhece "desconectado". */
export const DISCONNECTED_USER_MESSAGE =
  "WhatsApp desconectado. Reconecte o número lendo o QR Code em Configurações → WhatsApp.";

export function isDisconnectedMessage(message: string): boolean {
  return /desconectad|disconnect/i.test(message);
}
