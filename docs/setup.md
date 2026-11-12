# Configuração do projeto

A adoção inicial usa o [Vibe Coding Toolkit de Matheus Gomes](https://github.com/soumatheusgomes/vibe-coding-toolkit/tree/7ef68dd7b00ddfc5cd464458855e4ab66dd2128f), em especial o [roteiro para projetos existentes](https://github.com/soumatheusgomes/vibe-coding-toolkit/blob/7ef68dd7b00ddfc5cd464458855e4ab66dd2128f/docs/prompts/12-existing-project-setup.md). A base do projeto é a revisão `4c9d65a`, com TanStack Start, React, Bun, Supabase, Drizzle, shadcn/ui, ESLint e Vitest.

## Contexto do projeto

- [README.md](../README.md) indexa os documentos e preserva a especificação histórica.
- [PRODUCT.md](../PRODUCT.md) descreve os fluxos e critérios de aceitação.
- [AGENTS.md](../AGENTS.md) contém acordos e regras do projeto. [CLAUDE.md](../CLAUDE.md) referencia o mesmo conteúdo para esse cliente.
- [Arquitetura](architecture.md), [design](design.md), [onboarding](onboarding.md) e [qualidade](quality.md) guardam orientações por área. Use o documento responsável ao alterar um contrato ou comando.
- A [verificação anterior do pós-cotação](post-quote-stage-a-verification.md) e o [roteiro publicado](post-quote-published-test.md) continuam como evidência histórica e guia operacional.

## Integrações

| Componente | Decisão e evidência |
| --- | --- |
| Superpowers, Ponytail e Caveman | Planejamento proporcional, menor solução completa e comunicação direta incorporados ao fluxo do Codex. As extensões externas não foram configuradas neste ambiente. |
| Subagentes | Revisão independente somente leitura do pré-envio do WhatsApp, com três casos Vitest selecionados. A revisão mostrou a necessidade de um teste ponta a ponta do executor quando a resposta chega entre a última checagem e o envio. |
| React, documentação e descoberta | As orientações de React, composição, revisão de interface, escrita e descoberta foram instaladas em `.agents/skills`. Confira as origens em [skills-lock.json](../skills-lock.json). |
| Supabase e shadcn/ui | `supabase-postgres-best-practices` e `shadcn` disponíveis em `.agents/skills`, com origem registrada em [skills-lock.json](../skills-lock.json). Carregue as instruções relevantes antes de mudar banco ou UI. |
| ESLint, Biome e testes | ESLint e Vitest são as ferramentas existentes. A checagem mantém as regras do aplicativo e exclui apenas o material de terceiros instalado em `.agents/skills`, inclusive da formatação. O primeiro teste com as skills encontrou 71 erros de formatação em exemplos e scripts de terceiros. Considere novas regras a partir de violações medidas. |
| GitHub Actions e reparo de CI | Workflow usa a verificação local com Bun e lockfile. Diagnóstico de runs e logs pode usar a conexão GitHub quando houver um run. A CLI gh não estava autenticada nesta sessão. |
| Context7 | Indisponível nesta sessão. As consultas à documentação oficial suprem o diagnóstico de versões e comandos. |
| Graphify | O mapa em [architecture.md](architecture.md) cobre os pontos de entrada atuais. Considere um grafo automático se a navegação manual se tornar um gargalo. |
| Memória, Obsidian e Claude | Contexto compartilhado vive em Markdown versionado. O cliente Claude pode carregar a mesma base. Não há necessidade atual de vault externo ou sincronização de memória. |
| RTK e hooks | Dependem do cliente e de instalação apropriada no ambiente de trabalho. Os comandos existentes continuam disponíveis diretamente. |
| Browser, DevTools e Sentry | Validação da interface depende de ambiente de teste configurado. Diagnóstico em Sentry depende de uma conta e de um projeto já escolhidos. |
| Next.js, Vercel e React Native | Guias específicos de framework, análise de bundle Next.js, deploy Vercel e mobile ficam fora do escopo da stack atual. A interface é web e o deploy existente usa Lovable. |
| Revisão de segurança e diferenciais | A [revisão por risco](quality.md) referencia o roteiro oficial. Auditoria aprofundada e experimentos com provedores têm escopo próprio. |
| Harness2 e laboratório | Método nativo descrito em [quality.md](quality.md). A primeira comparação reuniu as verificações que já existiam em um comando, com a mesma suíte e o mesmo lockfile. O laboratório e os benchmarks upstream são atividades próprias. |
| Skills de artefato, aia-harness e Jev | Use recursos adicionais quando a tarefa tiver uma necessidade concreta. A base de desenvolvimento opera com o Codex e as ferramentas já disponíveis. |

As skills auxiliares foram identificadas pelo instalador do Codex no escopo do projeto. A pasta [skill-licenses](../.agents/skill-licenses) reúne os avisos de licença. O repositório [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills#license) declara MIT.

Para atualizar as skills auxiliares, confira primeiro a origem no lockfile, o catálogo publicado e o escopo do projeto. Compare o diff e rode `bun run check`.

## Evidência da primeira entrega

| Checagem | `4c9d65a` | Base com o toolkit |
| --- | --- | --- |
| Dependências | `bun install --frozen-lockfile` passou | Mesmo lockfile |
| ESLint | 0 erros, 7 avisos existentes de Fast Refresh | 0 erros, 7 avisos existentes de Fast Refresh |
| TypeScript | Passou | Passou |
| Vitest | 105 testes em 10 arquivos passaram | 105 testes em 10 arquivos passaram |
| Build | Passou com configuração sintética | Passou com configuração sintética |

Os resultados são locais em Linux, com Node.js 24.22.1 e Bun 1.4.4. O carregamento automático das skills auxiliares em uma nova sessão, o run remoto da CI e o ensaio publicado no WhatsApp ainda não foram observados.
