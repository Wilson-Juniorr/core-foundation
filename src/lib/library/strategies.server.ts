import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import type { StrategyInput } from "./api-types";
import type { ContentAssetType, MessageStrategy, StrategyAutonomy } from "./types";

export type { StrategyInput };

type Client = SupabaseClient<Database>;
type Row = Database["public"]["Tables"]["message_strategies"]["Row"];

export function mapStrategy(row: Row): MessageStrategy {
  return {
    id: row.id,
    name: row.name,
    objective: row.objective,
    tone: row.tone,
    should_mention: row.should_mention,
    should_avoid: row.should_avoid,
    when_to_use: row.when_to_use,
    channel: row.channel,
    allowed_asset_types: (row.allowed_asset_types ?? []) as ContentAssetType[],
    allowed_assets: row.allowed_assets ?? [],
    forbidden_behaviors: row.forbidden_behaviors ?? [],
    autonomy_mode: row.autonomy_mode,
    max_length: row.max_length,
    is_active: row.is_active,
    version: row.version,
    updated_at: row.updated_at,
  };
}

export async function listStrategies(client: Client): Promise<MessageStrategy[]> {
  const { data, error } = await client
    .from("message_strategies")
    .select("*")
    .order("name", { ascending: true })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapStrategy);
}

export async function getStrategy(client: Client, strategyId: string): Promise<MessageStrategy> {
  const { data, error } = await client
    .from("message_strategies")
    .select("*")
    .eq("id", strategyId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Estratégia não encontrada.");
  return mapStrategy(data);
}

/**
 * Salvar uma estratégia sobe a versão. Rascunhos antigos guardam a versão e o
 * snapshot usados, portanto editar hoje não reescreve o histórico.
 */
export async function saveStrategy(
  client: Client,
  userId: string,
  input: StrategyInput,
): Promise<{ strategyId: string; version: number }> {
  const payload = {
    user_id: userId,
    name: input.name,
    objective: input.objective,
    tone: input.tone,
    should_mention: input.should_mention,
    should_avoid: input.should_avoid,
    when_to_use: input.when_to_use,
    allowed_asset_types: input.allowed_asset_types,
    allowed_assets: input.allowed_assets,
    forbidden_behaviors: input.forbidden_behaviors,
    autonomy_mode: input.autonomy_mode,
    max_length: input.max_length,
    is_active: input.is_active,
  };

  if (input.id) {
    const current = await getStrategy(client, input.id);
    const { error } = await client
      .from("message_strategies")
      .update({ ...payload, version: current.version + 1 })
      .eq("id", input.id);
    if (error) throw new Error(error.message);
    return { strategyId: input.id, version: current.version + 1 };
  }

  const { data, error } = await client
    .from("message_strategies")
    .insert(payload)
    .select("id, version")
    .single();
  if (error) throw new Error(error.message);
  return { strategyId: data.id, version: data.version };
}

export async function deleteStrategy(client: Client, strategyId: string): Promise<void> {
  const { error } = await client.from("message_strategies").delete().eq("id", strategyId);
  if (error) throw new Error(error.message);
}

/** Estratégias iniciais sugeridas — criadas apenas quando o usuário pede. */
const DEFAULT_STRATEGIES: Omit<StrategyInput, "id">[] = [
  {
    name: "Primeiro contato leve",
    objective: "Iniciar a conversa, se apresentar e entender o que a pessoa procura.",
    tone: "leve, cordial e direto",
    should_mention: "de onde veio o contato, quando registrado",
    should_avoid: "falar de preço ou condições nesta etapa",
    when_to_use: "Lead novo, sem histórico de conversa.",
    allowed_asset_types: [],
    allowed_assets: [],
    forbidden_behaviors: ["pressure", "false_urgency", "invent_offer", "long_message"],
    autonomy_mode: "approval_required",
    max_length: 400,
    is_active: true,
  },
  {
    name: "Segundo contato com reforço de valor",
    objective: "Retomar a conversa lembrando o benefício prático do que foi discutido.",
    tone: "consultivo e tranquilo",
    should_mention: "o que o cliente demonstrou valorizar",
    should_avoid: "repetir a mensagem anterior",
    when_to_use: "Cliente viu a proposta inicial e não respondeu.",
    allowed_asset_types: ["audio", "image"],
    allowed_assets: [],
    forbidden_behaviors: ["pressure", "false_urgency", "invent_offer", "invent_facts"],
    autonomy_mode: "approval_required",
    max_length: 500,
    is_active: true,
  },
  {
    name: "Pós-cotação sem pressão",
    objective: "Confirmar se a cotação chegou e abrir espaço para dúvidas.",
    tone: "prestativo, sem cobrança",
    should_mention: "que a cotação foi enviada, se estiver registrado",
    should_avoid: "pedir decisão ou falar de prazo de validade não registrado",
    when_to_use: "Cotação enviada e sem retorno.",
    allowed_asset_types: ["audio"],
    allowed_assets: [],
    forbidden_behaviors: ["pressure", "false_urgency", "invent_offer", "negotiate"],
    autonomy_mode: "approval_required",
    max_length: 450,
    is_active: true,
  },
  {
    name: "Lembrar informação pendente",
    objective: "Retomar uma pendência que o cliente ficou de enviar.",
    tone: "gentil e prático",
    should_mention: "exatamente qual documento ou informação está pendente",
    should_avoid: "cobrar ou soar impaciente",
    when_to_use: "Há pendência registrada na memória do cliente.",
    allowed_asset_types: ["audio", "document"],
    allowed_assets: [],
    forbidden_behaviors: ["pressure", "false_urgency", "invent_facts"],
    autonomy_mode: "approval_required",
    max_length: 400,
    is_active: true,
  },
  {
    name: "Objeção de preço",
    objective: "Acolher a objeção de preço e recolocar a conversa em valor, sem negociar.",
    tone: "seguro, respeitoso e consultivo",
    should_mention: "o que já está incluído, quando registrado",
    should_avoid: "prometer desconto, comparar de forma agressiva com concorrentes",
    when_to_use: "Cliente sinalizou que achou caro.",
    allowed_asset_types: ["audio"],
    allowed_assets: [],
    forbidden_behaviors: ["invent_offer", "negotiate", "pressure", "false_urgency"],
    autonomy_mode: "approval_required",
    max_length: 500,
    is_active: true,
  },
  {
    name: "Cliente com alto interesse",
    objective: "Facilitar o próximo passo prático de quem já está decidido.",
    tone: "direto e organizado",
    should_mention: "o próximo passo combinado",
    should_avoid: "reabrir discussões já resolvidas",
    when_to_use: "Interesse alto ou sinal forte de fechamento.",
    allowed_asset_types: ["document"],
    allowed_assets: [],
    forbidden_behaviors: ["false_urgency", "invent_offer", "invent_facts"],
    autonomy_mode: "approval_required",
    max_length: 400,
    is_active: true,
  },
  {
    name: "Recuperação de cliente frio",
    objective: "Reabrir a conversa com quem parou de responder há muito tempo.",
    tone: "leve, sem cobrança, deixando a porta aberta",
    should_mention: "o tempo desde o último contato, de forma natural",
    should_avoid: "culpar o cliente pelo silêncio",
    when_to_use: "Sem resposta há muitos dias.",
    allowed_asset_types: [],
    allowed_assets: [],
    forbidden_behaviors: ["pressure", "false_urgency", "insist_after_stop"],
    autonomy_mode: "approval_required",
    max_length: 350,
    is_active: true,
  },
  {
    name: "Última tentativa elegante",
    objective: "Encerrar o ciclo com elegância, deixando o canal aberto para o futuro.",
    tone: "educado, tranquilo e definitivo",
    should_mention: "que não vamos insistir",
    should_avoid: "qualquer tom de cobrança ou culpa",
    when_to_use: "Depois de várias tentativas sem resposta.",
    allowed_asset_types: [],
    allowed_assets: [],
    forbidden_behaviors: ["pressure", "false_urgency", "insist_after_stop"],
    autonomy_mode: "approval_required",
    max_length: 350,
    is_active: true,
  },
];

export async function seedDefaultStrategies(
  client: Client,
  userId: string,
): Promise<{ created: number }> {
  const existing = await listStrategies(client);
  const names = new Set(existing.map((item) => item.name.toLowerCase()));
  const missing = DEFAULT_STRATEGIES.filter((item) => !names.has(item.name.toLowerCase()));
  for (const strategy of missing) {
    await saveStrategy(client, userId, strategy);
  }
  return { created: missing.length };
}
