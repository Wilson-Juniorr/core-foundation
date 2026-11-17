# Integrar a branch `operacao-piloto` (PR #1) e publicar

## Leitura de código/schema (sem dados de clientes)
- O projeto não tem remote GitHub: `origin` e `secondary` são o armazenamento interno da Lovable. Main local = `4c9d65a`.
- O commit `e547d1eb…` não existe neste repositório; a PR #1 e a branch `operacao-piloto` não estão acessíveis daqui.
- Migrações versionadas presentes: só 0000–0005. As 0006–0009 não existem aqui, o que bate com as três colunas ausentes (`followup_runs.post_quote_context_note`, `opportunities.post_sale_stage`, `scheduled_actions.dispatch_approved_at`).

## Pré-requisito (do proprietário)
Escolher um caminho para trazer o código:
1. **Git sync**: conectar o projeto ao GitHub (Configurações → Git). Atenção: o Git sync sempre cria um repositório **novo**; não liga ao `Wilson-Juniorr/core-foundation` existente. Depois seria preciso dar push da `operacao-piloto` nesse repositório novo e fazer merge na branch sincronizada.
2. **Patch/arquivo** (mais rápido): enviar aqui `git format-patch 4c9d65a..e547d1eb` (ou um ZIP só dos arquivos alterados, sem `.git`), incluindo `drizzle/migrations/0006–0009*.sql` e as entradas do `_journal.json`/snapshots.

## Execução após receber o código
1. Conferir que a base da branch é `4c9d65a` (senão, resolver conflitos sem recriar a implementação).
2. Aplicar os arquivos de código byte a byte.
3. Migrações: aplicar 0006–0009 em ordem pela ferramenta de migração, com o SQL **idêntico** aos arquivos. Antes, revisar cada SQL: aceitar apenas mudanças aditivas (colunas nulas/com DEFAULT, índices, funções, triggers); qualquer DROP/rename/troca de tipo/NOT NULL sem default pausa para aprovação. Garantir `when` do journal maior que o último aplicado (0005), para nenhuma migração ser pulada.
4. Validar só via `information_schema` que as três colunas passaram a existir.
5. Rodar a suíte (esperado ≥149), tipos e build.
6. Checar scan de segurança e publicar.

## Fora do escopo
Nenhuma consulta a clientes, mensagens, execuções ou configurações; nenhum secret exibido. `.env` continua rastreado no Git — remover antes de conectar ao GitHub.
