# Qualidade e revisão

O comando `bun run check` executa ESLint, checagem de tipos, Vitest e build com configuração sintética. O [workflow do GitHub](../.github/workflows/quality.yml) usa o mesmo comando em PRs e pushes para `main`.

## Verificações por mudança

| Área | Evidência esperada |
| --- | --- |
| Correção de bug | Reprodução quando viável, teste de regressão, resultado corrigido |
| WhatsApp e filas | Resposta durante a espera, contexto desatualizado, retry, duplicidade e resultado incerto conforme o trecho alterado |
| CRM e banco | Escopo de usuário, oportunidade correta, transação, falha parcial e preservação de tarefas manuais |
| Interface | Navegação por teclado, estados visíveis, comportamento em tela estreita e desktop |
| Provedores reais | Ensaio isolado com destino controlado, recibo observado e registro da versão testada |

Os testes de integração executam lógica real da aplicação e SQL em PGlite com provedores simulados. Use o [roteiro do pós-cotação](post-quote-published-test.md) para verificar a versão publicada.

## Melhorar as verificações

Ao encontrar uma falha de instrução, contexto ou checagem, registre a tarefa e o resultado esperado. Reproduza na mesma base e compare uma única mudança pequena sob as mesmas condições. Rode a verificação de forma independente e registre o resultado. Esse é o procedimento nativo inspirado no Harness2 do [Prompt 15](https://github.com/soumatheusgomes/vibe-coding-toolkit/blob/7ef68dd7b00ddfc5cd464458855e4ab66dd2128f/docs/prompts/15-harness-improvement.md).

Para revisar um diff que mexe com autorização, dados ou automações, estabeleça a revisão inicial e final. Examine os caminhos de falha e as fronteiras de acesso. Registre o cenário, o ponto no código, a evidência e as limitações. Consulte o [Prompt 13](https://github.com/soumatheusgomes/vibe-coding-toolkit/blob/7ef68dd7b00ddfc5cd464458855e4ab66dd2128f/docs/prompts/13-security-review.md) para orientar uma revisão separada.
