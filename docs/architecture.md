# Arquitetura

| Área | Entrada | Onde investigar |
| --- | --- | --- |
| Rotas e interface | [src/routes](../src/routes) | [Convenções do roteador](../src/routes/README.md) e [componentes](../src/components) |
| CRM | [Funções do CRM](../src/lib/crm.functions.ts) | [Serviços do CRM](../src/lib/crm.server.ts) e [tipos](../src/lib/crm.types.ts) |
| Follow-up | [Funções de follow-up](../src/lib/followup.functions.ts) | [Executor](../src/lib/followup/engine.server.ts) e [política](../src/lib/automation) |
| Pós-cotação | [Funções do pós-cotação](../src/lib/post-quote.functions.ts) | [Cadência](../src/lib/smart/post-quote-cadence.ts), [motor Smart](../src/lib/smart/engine.server.ts) e [runtime](../src/lib/smart/post-quote-runtime.server.ts) |
| WhatsApp | [Funções do WhatsApp](../src/lib/whatsapp.functions.ts) | [Webhook](../src/routes/api.public.whatsapp.$connectionId.ts), [adaptador UAZAPI](../src/lib/whatsapp/uazapi.server.ts) e [persistência](../src/lib/whatsapp/store.server.ts) |
| Memória e decisões | [Análise](../src/lib/ai/analysis.server.ts) | [Controle da conversa](../src/lib/smart/control.server.ts) e [decisão](../src/lib/smart/decision.server.ts) |

Rotas e componentes acionam funções de servidor. Autenticação e acesso a dados do usuário ficam no Supabase. Operações administrativas e credenciais dos provedores ficam em módulos de servidor. Os webhooks e agendadores entram por rotas próprias e têm controles de autenticação específicos.

O ciclo de pós-cotação passa pela ativação, avaliação do contexto, preparação e checagem da ação, aceite do envio e agendamento seguinte. O contexto tem versão e as gravações de ações e aceites usam RPCs. Em mudanças desse fluxo, rastreie também mensagens novas, respostas do provedor e reprocessamentos.

A configuração do Drizzle aponta para [drizzle/migrations](../drizzle/migrations). O repositório também guarda [supabase/migrations](../supabase/migrations). Antes de qualquer operação no banco, confira o destino e as migrações já aplicadas. O teste isolado usa PGlite e não replica toda a configuração do Supabase hospedado.
