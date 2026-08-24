/**
 * Autenticação centralizada dos endpoints de scheduler (`/api/public/hooks/*`).
 *
 * Apenas o secret dedicado `FOLLOWUP_CRON_SECRET` é aceito. Chaves anon /
 * publishable (e qualquer variável `VITE_*`) são explicitamente recusadas:
 * elas ficam expostas no frontend e não podem autorizar execução de
 * automações. A comparação é em tempo constante sobre digests SHA-256.
 */
import { createHash, timingSafeEqual } from "node:crypto";

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function extractToken(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+([^\s,]+)$/i.exec(header);
  if (match?.[1]) return match[1];
  const custom = request.headers.get("x-cron-secret");
  return custom && custom.trim() !== "" ? custom.trim() : null;
}

/**
 * Retorna `null` quando a requisição está autorizada, ou a `Response` de erro
 * que o handler deve devolver imediatamente.
 */
export function authorizeCronRequest(request: Request): Response | null {
  const expected = process.env["FOLLOWUP_CRON_SECRET"];
  if (!expected || expected.trim() === "") {
    console.error("cron_secret_missing");
    return Response.json({ error: "server_misconfigured" }, { status: 500 });
  }

  const provided = extractToken(request);
  if (!provided) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const ok = timingSafeEqual(digest(provided), digest(expected));
  if (!ok) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  return null;
}
