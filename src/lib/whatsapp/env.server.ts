/**
 * Credenciais de servidor da UAZAPI vindas de variáveis de ambiente.
 *
 * Nada aqui pode chegar ao navegador: apenas código server-side importa este
 * módulo. As variáveis são lidas sob demanda (o runtime injeta por requisição)
 * e permitem trocar servidor/token sem reconstruir a aplicação.
 */
export type UazapiEnv = {
  baseUrl: string | null;
  adminToken: string | null;
  instanceToken: string | null;
  instanceName: string | null;
};

function clean(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

export function readUazapiEnv(): UazapiEnv {
  const baseUrl = clean(process.env["UAZAPI_BASE_URL"]);
  return {
    baseUrl: baseUrl ? baseUrl.replace(/\/+$/, "") : null,
    adminToken: clean(process.env["UAZAPI_ADMIN_TOKEN"]),
    instanceToken: clean(process.env["UAZAPI_INSTANCE_TOKEN"]),
    instanceName: clean(process.env["UAZAPI_INSTANCE_NAME"]),
  };
}

/** Diagnóstico sem expor valores: apenas presença de cada variável. */
export function uazapiEnvPresence(): Record<string, boolean> {
  const env = readUazapiEnv();
  return {
    base_url: env.baseUrl !== null,
    admin_token: env.adminToken !== null,
    instance_token: env.instanceToken !== null,
  };
}
