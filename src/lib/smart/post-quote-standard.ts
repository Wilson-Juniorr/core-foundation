import type { SmartDecision, SmartStrategy } from "./types";

/** Texto neutro: não presume leitura, preço, plano ou promessa que não conhecemos. */
export const POST_QUOTE_STANDARD_MESSAGES = [
  "Olá! Passando para saber se posso ajudar na análise das opções de plano de saúde. Ficou alguma dúvida?",
  "Oi! Se estiver difícil comparar as opções, posso ajudar a organizar os pontos que mais importam para você. O que gostaria de avaliar?",
  "Olá! Como está sua busca pelo plano de saúde? Se suas prioridades mudaram, me conte para ajustarmos o atendimento.",
  "Oi! Tem algum ponto que esteja dificultando sua decisão sobre o plano? Posso encaminhar sua dúvida para analisarmos juntos.",
  "Passando para deixar meu contato à disposição. Se quiser retomar a análise com mais calma, podemos combinar um momento que seja bom para você.",
  "Olá! A contratação do plano ainda está nos seus planos para agora ou ficou para mais adiante? Assim consigo respeitar melhor seu momento.",
  "Oi! Antes de encerrar este acompanhamento, queria saber se ainda posso ajudar com a escolha do plano de saúde.",
  "Imagino que a rotina esteja corrida. Ainda faz sentido continuar a análise ou prefere deixar para outro momento? Vou encerrar os lembretes deste ciclo; quando quiser retomar, estou à disposição.",
] as const;

export function standardPostQuoteDecision(
  input: { postQuoteContact?: number | undefined },
  allowed: SmartStrategy[],
): SmartDecision {
  const strategy =
    allowed.find((s) => s === (input.postQuoteContact === 8 ? "SOFT_CLOSE" : "LIGHT_FOLLOWUP")) ??
    allowed.find((s) => ["CHECK_IN", "QUESTION_DISCOVERY", "DECISION_SIMPLIFICATION"].includes(s));
  return {
    action: strategy ? "send" : "handoff",
    strategy: strategy ?? null,
    message: strategy
      ? POST_QUOTE_STANDARD_MESSAGES[Math.min(7, Math.max(0, (input.postQuoteContact ?? 1) - 1))]!
      : null,
    reason: strategy
      ? "Acompanhamento padrão: contexto limitado; nenhuma condição comercial presumida."
      : "Não há estratégia de acompanhamento neutro permitida neste fluxo.",
    confidence: strategy ? 1 : 0,
    waitHours: 0,
    nextResponsible: strategy ? "customer" : "human",
    model: "post-quote-standard",
    promptVersion: "post-quote-standard@1",
  };
}
