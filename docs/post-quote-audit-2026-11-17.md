# Revisão do pós-cotação — 17/11/2026

## Estado observado

A main permaneceu em `4c9d65a`; PR #1 aberto como draft em `6dcba21`, sem merge. Portanto os testes e melhorias anteriores da branch não comprovavam o funcionamento da versão central/publicada.

O código da branch exigia cotação reconhecida por palavras no histórico (ou resumo obrigatório), suspendia avaliação sem isso e instruía a IA a esperar/transferir quando não houvesse um fato concreto. Mídias enviadas pelo consultor pendentes também bloqueavam a geração. Esses comportamentos contrariavam a operação desejada.

## Correção

- Ativação tenta recuperar a conversa, mas histórico vazio/indisponível não impede criar o ciclo e a próxima data. Resumo opcional. Pedido de parada encontrado continua bloqueando.
- Decisão usa contexto parcial e permite mensagem neutra. Sem contexto utilizável nem resposta do cliente/instrução/compromisso para interpretar, usa um dos oito textos versionados sem chamar IA. Falha de IA também permite esse caminho quando só existem mensagens de saída. Nunca substitui análise de uma resposta do cliente por texto cego.
- Mídia enviada pelo consultor não bloqueia a cadência apenas por estar ilegível. Mídias de entrada ainda exigem análise/revisão para não ignorar respostas.
- Falta de histórico não exige aprovação por si só. Autonomia configurada, revisão de qualidade e aprovação expressa permanecem.
- Cron recupera ciclos de pós-cotação ativos sem avaliação agendada. Não reativa pausados, não zera contadores e não reenvia tentativas incertas. Ciclos bloqueados pela regra antiga voltam na próxima avaliação.
- A próxima data é persistida desde a ativação. O texto é preparado nos quinze minutos anteriores para considerar mensagens recentes; antes disso existe agenda, não necessariamente um texto pronto.
- Erros na consulta do cron deixam de parecer uma fila vazia; falhas de avaliação recebem nova tentativa em cinco minutos para evitar ocupar sempre o início da fila.

## Verificação e limites

Testes isolados cobrem decisão real, qualidade dos oito textos, histórico ausente/parcial, falha da IA, retomada de ciclo sem avaliação, recuperação do bloqueio antigo, pausa manual e regressões de envio. O provedor desses testes é falso: não envia WhatsApp.

A consulta ao schema hospedado sem sessão autorizada retornou HTTP 401. O aplicativo abriu na página de entrada sem sessão autenticada. Isso não comprova falha do banco nem do agendador. Ainda é necessário verificar no ambiente autorizado:

1. Migrações 0006–0009 aplicadas antes de disponibilizar a branch; a correção desta rodada não adiciona migração.
2. Versão efetivamente publicada pelo Lovable e segredo do cron configurado no servidor.
3. Agendamento real de `followup-tick` e `ai-tick`, última execução e logs de falha. O repositório contém os handlers, mas não uma criação versionada desses jobs; não presumir que estejam ativos.
4. Clientes ativados: policy_key, status, proprietário da conversa, próxima data, aprovações, modo teste, conexão WhatsApp e tentativa incerta. Fluxos legados não são convertidos silenciosamente para a cadência explícita.
5. Recebimento em um número controlado e próximo contato persistido após o aceite.

Esta revisão não é certificação de segurança de todo o produto, nem evidência de entrega para clientes reais. OCR e transcrição possuem testes na suíte, mas anexos reais e credenciais dos provedores ainda precisam de verificação no ambiente publicado.
