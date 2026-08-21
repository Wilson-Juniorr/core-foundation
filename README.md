# Core Foundation

MÓDULO 01 — FUNDAÇÃO DO SISTEMA

Você está iniciando a construção de uma aplicação profissional que será evoluída incrementalmente por módulos.

Este é o Módulo 01.

Não tente antecipar funcionalidades dos próximos módulos. O objetivo desta etapa é criar uma fundação sólida, organizada, escalável e visualmente profissional para que WhatsApp, automações, IA e demais funcionalidades sejam adicionados posteriormente sem necessidade de reconstrução.

1. CONTEXTO DO PRODUTO

Estamos construindo uma plataforma inteligente de acompanhamento comercial.

O problema inicial que o produto resolverá é:

Nenhum cliente ativo deve ser esquecido. Toda negociação precisa ter um próximo passo.

A plataforma será utilizada inicialmente como um sistema operacional pessoal para acompanhamento de clientes e oportunidades comerciais.

No futuro, ela será capaz de:

conectar-se ao WhatsApp;

armazenar e acompanhar conversas;

executar fluxos automáticos de follow-up;

interromper automações quando o cliente responder;

agendar mensagens;

utilizar inteligência artificial para compreender o histórico do cliente;

gerar mensagens contextuais;

utilizar textos, áudios, imagens e documentos;

identificar clientes que precisam de intervenção humana;

manter memória estruturada de cada negociação;

sugerir próximas ações;

acompanhar oportunidades comercialmente.

IMPORTANTE:

Essas funcionalidades futuras NÃO devem ser implementadas neste módulo.

A arquitetura criada agora deve apenas permitir que sejam adicionadas posteriormente.

2. PRINCÍPIOS DO PROJETO

Todo desenvolvimento deve seguir estes princípios.

2.1 Modularidade

O sistema será construído progressivamente.

Não criar componentes gigantes ou páginas monolíticas.

Separar adequadamente:

páginas;

componentes;

hooks;

serviços;

tipos;

utilitários;

acesso a dados;

regras de domínio.

2.2 Simplicidade

Não adicionar funcionalidades que não foram solicitadas.

Evitar overengineering.

Não criar recursos apenas porque “podem ser úteis futuramente”.

2.3 Manutenibilidade

Código deve ser:

organizado;

legível;

tipado;

reutilizável quando fizer sentido;

fácil de modificar;

fácil de auditar posteriormente.

Evitar:

duplicação;

any desnecessário;

valores mágicos;

lógica de negócio espalhada pela interface;

componentes excessivamente grandes.

2.4 Segurança

Não colocar:

tokens;

API keys;

secrets;

senhas;

credenciais;

diretamente no frontend ou no repositório.

Qualquer integração futura deve utilizar variáveis de ambiente e backend quando necessário.

2.5 Banco como fonte de verdade

Não utilizar dados mockados como arquitetura definitiva.

Mocks podem ser usados temporariamente durante construção visual, mas o resultado final deste módulo deve utilizar persistência real para as funcionalidades implementadas.

3. STACK

Utilizar a stack padrão e estável suportada pelo Lovable.

Preferencialmente:

React;

TypeScript;

Vite;

Tailwind CSS;

componentes consistentes com o ecossistema utilizado pelo Lovable;

Supabase para autenticação e banco de dados.

Não introduzir frameworks ou bibliotecas adicionais sem necessidade concreta.

Se alguma decisão técnica precisar divergir disso, priorizar compatibilidade, simplicidade e manutenibilidade.

4. OBJETIVO DO MÓDULO 01

Ao final deste módulo, deve existir uma aplicação funcional contendo:

autenticação;

estrutura principal da aplicação;

dashboard inicial;

gerenciamento básico de clientes;

pipeline comercial;

oportunidades;

página detalhada do cliente;

navegação consistente;

banco de dados real;

responsividade básica;

tratamento adequado de loading, vazio e erro.

NÃO implementar ainda:

WhatsApp;

UZAPI;

IA;

follow-ups automáticos;

motor de fluxos;

envio de mensagens;

agendamento automático;

biblioteca de áudios;

geração de textos;

automações;

integrações com CRM.

5. AUTENTICAÇÃO

Implementar autenticação utilizando Supabase Auth.

Criar:

Login

Campos:

e-mail;

senha.

Ações:

entrar;

sair.

Implementar:

proteção das rotas internas;

redirecionamento de usuário não autenticado;

persistência correta da sessão;

loading durante verificação da sessão;

tratamento de erro de autenticação.

Não criar sistema complexo de organizações, equipes ou permissões neste momento.

Inicialmente, cada usuário deverá visualizar apenas seus próprios dados.

6. ESTRUTURA PRINCIPAL DA INTERFACE

Após autenticação, criar o shell principal da aplicação.

Desktop:

sidebar lateral;

área principal de conteúdo;

header quando necessário.

Mobile/tablet:

navegação adaptada;

sidebar não pode simplesmente quebrar ou ocupar a tela inteira.

Itens iniciais da navegação:

Visão Geral;

Pipeline;

Clientes.

Adicionar visualmente, mas como funcionalidades futuras/desabilitadas se isso melhorar a compreensão da arquitetura:

Conversas;

Follow-ups;

Agenda;

Biblioteca;

Configurações.

Não criar páginas completas para essas funcionalidades neste módulo.

Indicar de maneira discreta que ainda serão disponibilizadas.

7. IDENTIDADE VISUAL

Queremos uma aplicação com aparência de software profissional premium.

Direção:

limpa;

moderna;

sofisticada;

minimalista;

alta legibilidade;

bastante espaço visual;

hierarquia clara;

poucos elementos competindo por atenção.

Evitar:

excesso de gradientes;

excesso de cores;

cards desnecessários;

sombras pesadas;

aparência genérica de template administrativo;

excesso de bordas;

elementos gigantes.

A experiência deve lembrar um produto SaaS moderno e maduro.

Priorizar informação e velocidade operacional.

Criar consistência para:

tipografia;

espaçamentos;

botões;

inputs;

cards;

badges;

modais;

dropdowns;

tabelas/listas;

estados de interação.

Não gastar esforço criando branding definitivo.

Usar um nome provisório discreto para o produto caso seja necessário.

8. DASHBOARD — VISÃO GERAL

Criar uma página inicial útil, mas ainda simples.

Exibir indicadores provenientes do banco:

Clientes ativos

Quantidade de clientes não arquivados.

Oportunidades abertas

Quantidade de oportunidades ainda não concluídas.

Sem próxima ação

Quantidade de oportunidades abertas sem next_action_at.

Este indicador é conceitualmente muito importante para o produto.

Ações para hoje

Quantidade de oportunidades cuja next_action_at corresponde ao dia atual.

Criar também uma seção:

Precisa de atenção

Exibir oportunidades que:

estão abertas;

não possuem próxima ação;

OU

possuem próxima ação vencida.

Mostrar:

cliente;

oportunidade;

etapa;

próxima ação;

há quanto tempo está pendente.

Clicar deve levar ao cliente/oportunidade correspondente.

Não implementar IA nessa seção.

As regras neste módulo são determinísticas.

9. CLIENTES

Criar página:

Clientes

Permitir:

listar;

pesquisar;

criar;

editar;

arquivar;

visualizar.

Não implementar exclusão destrutiva pela interface.

Utilizar arquivamento/soft delete.

Campos iniciais:

nome;

telefone;

e-mail;

observações;

origem;

data de criação;

data de atualização;

arquivado.

Nome e telefone são os campos mais importantes.

Telefone deve ser preparado para posteriormente ser utilizado como identificador na integração com WhatsApp.

Normalizar o telefone sempre que possível.

Não bloquear a criação por ausência de e-mail.

10. PÁGINA DO CLIENTE

Criar uma página detalhada para cada cliente.

Estruturar de forma que futuramente seja o centro da inteligência comercial daquele relacionamento.

Exibir:

Cabeçalho

nome;

telefone;

e-mail;

origem;

status;

ações de edição.

Oportunidades

Exibir oportunidades relacionadas ao cliente.

Permitir criar nova oportunidade.

Próxima ação

Quando houver oportunidade ativa, exibir claramente:

descrição da próxima ação;

data/hora;

situação.

Permitir editar manualmente.

Timeline

Criar estrutura inicial de timeline.

Neste módulo registrar apenas eventos internos relevantes, como:

cliente criado;

cliente atualizado;

oportunidade criada;

mudança de etapa;

próxima ação alterada;

oportunidade concluída.

NÃO criar mensagens falsas de WhatsApp.

A timeline precisa estar preparada para receber mensagens e eventos automáticos futuramente.

11. PIPELINE

Criar uma visualização Kanban.

Etapas iniciais:

Novo negócio

Tentativa de contato

Contato realizado

Cotação enviada

Cotação aprovada

Documentação completa

IMPORTANTE:

Essas etapas devem vir do banco de dados.

Não hardcodar a lógica da aplicação em torno desses nomes.

O sistema deve permitir que novas etapas sejam adicionadas futuramente sem reescrever o pipeline.

Cada oportunidade deve pertencer a uma etapa.

Cada card deve mostrar, de maneira enxuta:

cliente;

título da oportunidade;

etapa;

próxima ação;

indicador caso a próxima ação esteja atrasada.

Permitir movimentar oportunidades entre etapas por drag and drop.

Ao mudar uma oportunidade de etapa:

persistir imediatamente no banco;

atualizar interface;

registrar evento na timeline.

Implementar feedback apropriado caso a persistência falhe.

12. OPORTUNIDADES

Um cliente pode possuir uma ou mais oportunidades.

Campos iniciais:

título;

cliente;

etapa;

status;

valor estimado opcional;

próxima ação;

data/hora da próxima ação;

observações;

data de criação;

data de atualização.

Status iniciais:

open;

won;

lost;

archived.

Não confundir status da oportunidade com pipeline_stage.

Exemplo:

status = open

e

pipeline_stage = Cotação enviada

são informações diferentes.

13. PRÓXIMA AÇÃO

Esse conceito é fundamental.

Toda oportunidade aberta idealmente deve possuir uma próxima ação.

Campos:

descrição;

data/hora.

Exemplo:

Descrição:

"Entrar em contato para confirmar se analisou a cotação."

Data:

25/08/2026 às 10:30.

A interface deve destacar:

próxima ação futura;

próxima ação para hoje;

próxima ação atrasada;

oportunidade sem próxima ação.

Não criar automação ainda.

14. MODELO DE DADOS

Criar uma estrutura limpa e normalizada.

Tabelas mínimas esperadas:

profiles

Relacionada ao usuário autenticado.

contacts

Campos conceituais:

id

user_id

name

phone

email

source

notes

is_archived

created_at

updated_at

pipeline_stages

Campos conceituais:

id

user_id ou indicação apropriada de ownership

name

position

is_active

created_at

updated_at

opportunities

Campos conceituais:

id

user_id

contact_id

pipeline_stage_id

title

status

estimated_value

next_action_description

next_action_at

notes

created_at

updated_at

timeline_events

Campos conceituais:

id

user_id

contact_id

opportunity_id quando aplicável

event_type

metadata JSON

created_at

Não criar neste momento tabelas completas para WhatsApp, IA ou automações apenas para “preparar o futuro”.

Elas serão projetadas nos módulos correspondentes.

15. SEGURANÇA DO BANCO

Implementar Row Level Security adequadamente.

Cada usuário autenticado deve acessar somente os próprios:

contatos;

oportunidades;

etapas;

eventos.

Não utilizar simplesmente uma chave administrativa no frontend para contornar RLS.

Validar ownership também nos relacionamentos.

Exemplo:

um usuário não pode criar oportunidade apontando para contact_id pertencente a outro usuário.

16. ESTADOS DA INTERFACE

Toda tela que consulta dados deve tratar:

Loading

Mostrar feedback apropriado.

Empty state

Explicar claramente o que ainda não existe e oferecer ação relevante.

Exemplo:

"Nenhum cliente cadastrado."

Botão:

"Adicionar cliente"

Error state

Mostrar mensagem compreensível e opção de tentar novamente quando aplicável.

Não deixar erros técnicos crus aparecendo para o usuário.

17. RESPONSIVIDADE

A aplicação deve funcionar adequadamente em:

desktop;

tablet;

smartphone.

Desktop será a experiência principal.

No mobile:

evitar overflow horizontal;

adaptar sidebar;

adaptar cards;

adaptar formulários;

pipeline pode utilizar scroll horizontal controlado quando necessário.

18. ARQUITETURA PARA INTEGRAÇÕES FUTURAS

Não implementar integrações agora.

Entretanto, evitar acoplamentos que dificultem futuramente adicionar:

WhatsApp Provider;

UZAPI;

inteligência artificial;

CRM;

outros serviços.

Integrações externas futuras deverão passar por serviços/adapters próprios.

Exemplo conceitual futuro:

WhatsAppProvider

e uma implementação:

UzapiProvider

A aplicação não deve depender conceitualmente de UZAPI espalhada pelo código.

NÃO é necessário implementar esses adapters agora.

19. EVENTOS / TIMELINE

Criar um mecanismo simples para registrar eventos importantes.

Tipos iniciais podem incluir:

contact_created

contact_updated

opportunity_created

stage_changed

next_action_updated

opportunity_won

opportunity_lost

Metadata deve permitir armazenar contexto adicional sem exigir uma nova coluna para cada tipo de evento.

Exemplo de mudança de etapa:

{
  "from_stage_id": "...",
  "to_stage_id": "...",
  "from_stage_name": "Contato realizado",
  "to_stage_name": "Cotação enviada"
}


20. DATAS E HORÁRIOS

Armazenar timestamps de maneira consistente.

Preparar a aplicação para trabalhar corretamente com timezone.

Não espalhar conversões de data/hora pelos componentes.

Centralizar formatação/utilitários quando apropriado.

A interface deve exibir datas e horários de maneira natural para o usuário.

21. QUALIDADE DE CÓDIGO

Antes de considerar o módulo concluído:

remover código morto;

remover imports não utilizados;

eliminar erros TypeScript;

eliminar warnings relevantes;

evitar any;

verificar componentes duplicados;

verificar queries duplicadas;

conferir tratamento de erros;

conferir responsividade;

conferir RLS;

conferir rotas protegidas.

Não deixar TODOs críticos escondidos no código.

22. CRITÉRIOS DE ACEITE

O Módulo 01 somente estará concluído quando for possível executar o seguinte fluxo:

acessar aplicação sem autenticação;

ser direcionado ao login;

autenticar;

visualizar dashboard;

criar um cliente;

encontrar esse cliente na listagem;

pesquisar pelo cliente;

abrir sua página;

editar seus dados;

criar uma oportunidade;

definir etapa;

definir próxima ação;

visualizar oportunidade no pipeline;

mover oportunidade entre etapas;

atualizar página e confirmar que a mudança persistiu;

visualizar evento da mudança na timeline;

visualizar próxima ação no cliente;

visualizar indicadores corretos no dashboard;

marcar oportunidade como ganha ou perdida;

arquivar cliente sem exclusão destrutiva;

sair da conta;

confirmar que rotas privadas ficaram inacessíveis.

Também validar que um usuário não consegue acessar dados pertencentes a outro usuário.

23. TESTES

Executar/verificar os principais fluxos implementados.

Priorizar testes para:

autenticação;

criação de cliente;

edição de cliente;

arquivamento;

criação de oportunidade;

mudança de pipeline;

próxima ação;

timeline;

isolamento entre usuários.

Não mascarar falhas apenas para apresentar a interface como concluída.

Caso encontre problema estrutural, corrigir antes de prosseguir.

24. NÃO IMPLEMENTAR NESTE MÓDULO

É explicitamente proibido antecipar:

integração UZAPI;

conexão WhatsApp;

QR Code do WhatsApp;

envio de mensagens;

recebimento de mensagens;

histórico de WhatsApp;

IA;

OpenAI;

geração automática de mensagens;

análise de sentimento;

memória de IA;

follow-up automático;

scheduler de mensagens;

motor de fluxos;

áudios estratégicos;

automações;

CRM externo;

relatórios avançados.

Esses recursos terão módulos próprios.

25. PREPARAÇÃO PARA AUDITORIA

Este projeto será posteriormente auditado através do código-fonte no GitHub.

Portanto:

manter organização clara;

migrations devem estar versionadas;

não realizar mudanças silenciosas ou desnecessárias;

não esconder lógica crítica em componentes visuais;

manter nomes compreensíveis;

evitar hacks temporários;

manter código consistente;

documentar decisões não óbvias quando necessário.

26. EXECUÇÃO

Antes de começar:

analise a estrutura atual do projeto, caso já exista;

preserve configurações válidas existentes;

planeje internamente as alterações necessárias;

implemente somente o escopo deste módulo;

não invente requisitos.

Após implementar:

revise o código produzido;

execute build/typecheck/lint disponíveis;

corrija erros encontrados;

teste os fluxos principais;

revise responsividade;

revise persistência;

revise segurança/RLS.

27. RELATÓRIO FINAL OBRIGATÓRIO

Ao terminar, não responda apenas que o módulo foi concluído.

Apresente um relatório contendo:

Implementado

Liste exatamente o que foi criado.

Banco de dados

Liste:

tabelas;

relacionamentos;

migrations;

políticas RLS.

Arquivos/áreas principais alterados

Resuma a estrutura criada.

Testes realizados

Informe quais fluxos foram efetivamente verificados.

Pendências

Liste qualquer requisito deste prompt que não tenha sido implementado completamente.

Não declare como concluído algo que não tenha sido efetivamente implementado.

Próximo passo

Não iniciar o próximo módulo.

Aguardar validação e auditoria do Módulo 01.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/e1dd3ff2-15b8-40cb-919a-c6910f719bfa).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
