# Etapa A — entrega e verificação (06/11/2026)

## Resultado
A cadência está conectada ao motor existente somente por ativação explícita. Nenhum cliente existente foi ativado; consulta confirmou zero runs `post_quote_v1` no ambiente real durante a entrega. A Etapa A ainda não deve ser considerada operacionalmente homologada pelas limitações abaixo.

## Correções
- `smart/engine.server.ts`: política em ativação/avaliação/agendamento, claim com lease, rechecagem depois da IA, inserção transacional, âncora da análise com IDs, atualizações operacionais sem invalidar texto.
- `smart/control.server.ts` e `smart/return.server.ts`: incrementos de contexto atômicos; pendências e retornos preservados.
- `followup/engine.server.ts`: Smart não avança etapas clássicas; simulação não conta; bloqueio de janelas/dias não úteis; reconciliação sem reenvio cego.
- `smart/post-quote-runtime.server.ts`: ativação, aceitação idempotente, oito contatos, pausa/retomada/reagendamento/encerramento.
- `smart/send-reconciliation.server.ts` e `whatsapp/service.server.ts`: tentativa persistida antes da chamada; resultado incerto fica visível e bloqueado; recibo local confirmado permite reconciliação.
- `smart/rules.ts`, `smart/commitments.server.ts`: acentos, horas/minutos, prazos distintos e instante original; datas impossíveis rejeitadas.
- `ai/analysis.server.ts`: cursor estável `(sent_at,id)`, primeiros 60 inéditos por lote e continuação na fila, sem teto de 400.
- `smart/approvals.server.ts`: aprovação preserva data futura.
- `followup/time.ts`: interseção vazia nunca libera envio.
- `automation/adaptive.server.ts`: texto Smart já preparado não é regenerado como etapa clássica sem estratégia.
- `post-quote.functions.ts`, `components/smart/post-quote-panel.tsx`, página do cliente: ativação explícita, contador, responsável, motivo, mensagem preparada e controles básicos.
- `crm.server.ts`, `crm.types.ts`: agenda pós-cotação separada da tarefa manual na oportunidade.
- `vitest.config.ts`, fixture/testes, `package.json`, `bun.lock`: banco PostgreSQL isolado e provedor falso; script `test`.
- Metadados ausentes completados em index, auth, pipeline e clientes; sem alteração visual dessas páginas.

## Migrations aplicadas e schema conferido
- `drizzle/migrations/0004_post_quote_stage_a.sql`: progresso da política, âncora, tentativa, cursor, agenda CRM, índice e RPCs atômicos.
- `drizzle/migrations/0005_post_quote_context_guards.sql`: mudanças de proposta/instrução invalidam contexto; agenda CRM sincronizada sem sobrescrever tarefa manual.

## Evidência da chamada da cadência
`activatePostQuote` → `startSmartFlow(policyKey: POST_QUOTE_POLICY)` → `nextSilenceContact` → `evaluateSmartRun` → `schedule_smart_action` → executor → `recordPostQuoteAccepted` → `nextSilenceContact` → `accept_post_quote_contact`.

Exemplo testado: ativação 09/03/2026 09h São Paulo → contato 10/03 10h → aceito, contador 1, status ativo → próximo 13/03 15h. O oitavo contato deixa `completed`, sem nova avaliação, sem reativação e com oportunidade aberta e tarefa manual preservada.

## Verificações
- 67 testes passaram: 54 unitários/regressão e 13 integrados com relógio controlado, PostgreSQL isolado e provedor falso.
- Testes integrados: ciclo completo, contexto operacional/real, corrida de geração, concorrência, resposta conhecida/nova com timestamp igual, oito aceitações idempotentes, tentativa incerta e recibo, aprovação futura, 425 mensagens sem pular IDs, clássico, pausa/reagendamento, simulação e falha comprovada.
- Lint passou sem erros; sete warnings preexistentes de Fast Refresh.
- Typecheck/build automáticos do ambiente: `build OK`; não executados manualmente.
- Navegador autenticado: painel na ficha de cliente, computador e celular. Nenhuma ativação/envio real executado. Há overflow horizontal preexistente na página completa; painel novo cabe no celular.

## Limitações / pendências
1. Expressões impossíveis são rejeitadas sem criar compromisso; ainda falta converter isso em bloqueio visível por cliente. Portanto não declarar a Etapa A totalmente concluída.
2. Tentativa sem recibo confiável permanece bloqueada. UAZAPI não tem idempotência/correlação por chave do cliente comprovada no adaptador atual; confirmar capacidade concreta antes de permitir reenvio. Não há controle novo para confirmar manualmente aceitação/rejeição.
3. Cron e confirmação de entrega reais não foram acionados para teste; dependem da versão publicada e conexão WhatsApp. Não alterar os clientes antigos para validar.
4. Ativação/pausa/reagendamento pelo navegador ainda não foram homologados com cliente isolado; os mesmos caminhos centrais foram exercitados em banco isolado.
5. O fixture executa RPCs reais, mas não reproduz toda a segurança/permissões do ambiente hospedado; isolamento hospedado não foi submetido a teste adversarial multiusuário.
6. Interpretação ampliada de áudio e seleção da Biblioteca (B/C) não iniciadas.
