# Melhorias de dia a dia (uso real)

Sua ideia (aviso de cliente duplicado) entra como item 1. Olhei o sistema e listei outros pontos do mesmo tipo: atrito pequeno que aparece todo dia.

## 1. Aviso de cliente duplicado no cadastro

Ao digitar o telefone (ou e-mail) no formulário de novo cliente, o sistema verifica se já existe alguém com aquele número e mostra um aviso na hora:

- "Já existe um cliente com este telefone: **Ariane**"
- Botão **Ver cliente** (abre a ficha) e botão **Cadastrar mesmo assim**
- A comparação usa o telefone normalizado (+55 + DDD), então "(11) 91238-9903" e "11912389903" são reconhecidos como o mesmo número
- Mesmo aviso quando o cadastro vem por print/OCR, antes de salvar
- Salvar sem confirmar fica bloqueado enquanto houver duplicado

## 2. Vincular conversa do WhatsApp ao cliente automaticamente

Hoje aparece "Sem cliente vinculado" em conversas cujo número já existe no cadastro. Passa a sugerir o vínculo automaticamente pelo telefone, com um clique para confirmar.

## 3. Ações rápidas na ficha do cliente

Na página do cliente, botões diretos para: abrir conversa no WhatsApp, iniciar follow-up, definir próximo passo. Hoje isso exige navegar entre telas.

## 4. Busca global (atalho)

Campo de busca no topo que encontra cliente por nome ou telefone de qualquer tela e leva direto para a ficha.

## 5. Sinal de "já tem follow-up ativo"

Na lista de clientes e no pipeline, um selo mostrando que aquele cliente tem acompanhamento ativo, pausado ou bloqueado — evita iniciar fluxo duplicado sem perceber.

## 6. Confirmação ao iniciar fluxo em cliente que já respondeu

Se o cliente teve resposta recente, avisar antes de iniciar um fluxo automático ("este cliente respondeu há 2 dias — quer mesmo automatizar?").

## Detalhes técnicos

- Nova função de servidor `findContactsByPhoneOrEmail` (busca por telefone normalizado e e-mail, escopo do usuário) usada pelo formulário com debounce.
- `createContact` também passa a checar duplicado no servidor e exige a flag `allow_duplicate` para gravar — evita duplicado por corrida/duplo clique.
- Itens 2, 5 e 6 reutilizam dados já existentes (`conversations`, `followup_runs`), sem novas tabelas.
- Sem alteração de esquema do banco.

## Sugestão de execução

Começar pelos itens 1, 2 e 3 (maior impacto no dia a dia) e depois 4, 5 e 6. Me diga se quer tudo de uma vez ou por etapas, e se algum item não faz sentido para a sua rotina.
