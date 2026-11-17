# Desenvolvimento local

A referência validada é Node.js 24 e Bun 1.4.4. As dependências são definidas no `bun.lock`.

```sh
bun install --frozen-lockfile
bun run check
```

Para abrir a interface, configure um Supabase de desenvolvimento usando as variáveis descritas em [`.env.example`](../.env.example) e execute `bun run dev`. Use um projeto de teste e contatos sintéticos. Guarde as credenciais locais fora do Git. O build de checagem já usa valores sintéticos e dispensa conta no Supabase.

| Comando | Verifica |
| --- | --- |
| `bun run lint` | ESLint e regras de formatação |
| `bun run typecheck` | Tipos TypeScript |
| `bun run test` | Vitest, incluindo PGlite e provedor simulado |
| `bun run build:check` | Build de validação com configuração Supabase sintética |
| `bun run check` | As quatro etapas na ordem usada na CI |

O `bun run build:check` usa a pasta de saída padrão do build. Para obter um build destinado ao deploy, execute `bun run build` com a configuração do ambiente de destino.

Para investigar o produto, comece em [PRODUCT.md](../PRODUCT.md) e siga os pontos de entrada em [architecture.md](architecture.md). Para checar um fluxo publicado, siga o [roteiro operacional](post-quote-published-test.md).
