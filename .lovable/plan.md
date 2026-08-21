# Módulo 01 — Fundação do Sistema

Construir a base de uma plataforma de acompanhamento comercial: autenticação, shell da aplicação, dashboard, clientes, oportunidades, pipeline Kanban e timeline — com banco real e isolamento por usuário. Nada de WhatsApp, IA ou automações.

## Backend (Lovable Cloud)

Habilitar Lovable Cloud (banco + autenticação) e criar em uma única migration versionada:

- `profiles` — vinculado ao usuário autenticado, criado por trigger no cadastro.
- `contacts` — nome, telefone (normalizado E.164 quando possível), e-mail, origem, observações, `is_archived`, timestamps.
- `pipeline_stages` — nome, posição, `is_active`, por usuário; seed automático das 6 etapas iniciais (Novo negócio → Documentação completa) no cadastro do usuário.
- `opportunities` — título, `contact_id`, `pipeline_stage_id`, status (`open|won|lost|archived`), valor estimado, descrição e data/hora da próxima ação, observações, timestamps.
- `timeline_events` — tipo do evento, `contact_id`, `opportunity_id` opcional, `metadata` JSONB.

Segurança: RLS em todas as tabelas com políticas por `auth.uid()`, GRANTs explícitos, `updated_at` por trigger, e validação de ownership nos relacionamentos (não é possível apontar `contact_id`/`pipeline_stage_id` de outro usuário).

## Autenticação

- Página pública `/auth` com login e cadastro por e-mail/senha, erros tratados em linguagem clara.
- Rotas internas sob o gate autenticado, com redirecionamento para `/auth` e loading durante verificação de sessão.
- `/` = landing mínima com CTA de entrar (redireciona para o dashboard se já autenticado); sair limpa cache e volta para `/auth`.

## Interface

Shell com sidebar no desktop, drawer no mobile, header com contexto e menu da conta.

- Navegação ativa: Visão Geral, Pipeline, Clientes.
- Itens desabilitados com marcação discreta "em breve": Conversas, Follow-ups, Agenda, Biblioteca, Configurações (sem páginas).

Identidade visual: sistema de design em tokens semânticos (sem cores fixas nos componentes), tipografia sóbria, muito espaço em branco, poucas bordas/sombras, aparência de SaaS maduro. Nome provisório discreto do produto.

## Telas

**Visão Geral** — indicadores do banco: clientes ativos, oportunidades abertas, sem próxima ação, ações para hoje. Seção "Precisa de atenção" listando oportunidades abertas sem próxima ação ou com próxima ação vencida (cliente, oportunidade, etapa, próxima ação, tempo pendente), clicável até a página do cliente.

**Clientes** — lista com busca, criação/edição em diálogo, arquivar/reativar (sem exclusão destrutiva).

**Cliente (detalhe)** — cabeçalho com dados e ações; lista de oportunidades com criação; bloco de próxima ação editável com destaque de futura/hoje/atrasada/ausente; timeline dos eventos internos.

**Pipeline** — Kanban por etapas vindas do banco, cards enxutos com cliente, título, próxima ação e alerta de atraso; drag and drop persistindo imediatamente, registrando evento `stage_changed` e revertendo com aviso em caso de falha; scroll horizontal controlado no mobile.

Todas as telas com loading, empty state acionável e error state com "tentar novamente".

## Notas técnicas

- Rotas em `src/routes/` (TanStack Router); páginas protegidas sob `_authenticated/`.
- Acesso a dados via server functions autenticadas em `src/lib/*.functions.ts`, consumidas com TanStack Query; regras de domínio (normalização de telefone, classificação da próxima ação, registro de eventos) em módulos próprios, fora dos componentes.
- Utilitários centralizados de data/hora com timezone; nenhuma conversão espalhada em componentes.
- Camada de dados isolada por domínio para que provedores externos (WhatsApp/IA) possam ser adicionados depois como adapters — sem implementá-los agora.
- Ao final: typecheck/lint, verificação dos fluxos de aceite no preview e relatório com implementado, banco, arquivos, testes e pendências.
