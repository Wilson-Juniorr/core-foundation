# Agente pós-cotação — quando sai e quando volta da conversa

## A regra de ouro
Cada cliente tem sempre **um dono**: **Agente**, **Você** ou **Encerrado**. Nunca os dois falando ao mesmo tempo e nunca "ninguém" sem você saber.

## 1. Quando o agente sai e passa pra você
- Você mandou qualquer mensagem, pelo sistema ou pelo celular
- O cliente falou de preço, desconto ou negociação
- O cliente fez uma pergunta técnica: carência, rede, coparticipação ou reembolso
- O cliente quer fechar ou mandou documento
- O cliente está irritado ou pediu pra parar
- Você prometeu algo, tipo "te mando amanhã"
- Chegou um áudio que não deu pra entender, ou a IA ficou em dúvida

Toda saída fica registrada no cliente com o **motivo** e **desde quando**.

## 2. Quando o agente volta: decisão por análise, não por relógio fixo
Quando você para de falar, o agente **lê a conversa inteira**, o motivo da saída e as suas instruções. Depois decide entre três caminhos:

| Caminho | Quando | Exemplo |
|---|---|---|
| **Volta direto** | Assunto simples resolvido, cliente só sumiu | Você tirou uma dúvida, cliente disse "vou ver" e sumiu |
| **Avisa e espera seu ok** | Assunto sensível já passou por você | Você falou de preço; ele mostra a mensagem que mandaria, e você aprova ou cancela |
| **Fica com você** | Ainda tem algo pendente seu | Cliente perguntou algo e você não respondeu; você prometeu enviar algo |

**Travas que a IA não consegue passar por cima:**
- Se teve preço, fechamento, irritação ou pergunta técnica, o agente **nunca volta direto**. No máximo ele avisa e espera seu ok.
- Se o cliente está esperando resposta sua, ele **nunca responde por você**.
- Se você tem promessa em aberto, ele espera passar a data prometida.
- Ele volta sempre em dia útil, entre 9h e 19h.
- Ao voltar, ele relê o que **você** disse, para não repetir nem contradizer. Ele nunca cita um valor diferente do que você passou.

## 3. Conversar com o agente dentro do cliente
Uma caixa **"Instruções para o agente"** fica na página do cliente. Você escreve do seu jeito:
- "Volta a falar com ela segunda, ela tá vendo com o marido"
- "Não fala nada até eu mandar"
- "Ela já aceitou, só falta o RG"
- "Pode voltar, já resolvi o preço com ela"

O agente responde o que entendeu, por exemplo: "Entendi: volto segunda 10/11 às 10h e lembro do marido". Você confirma ou corrige. As instruções ficam no histórico e o agente usa todas elas em cada decisão. A sua instrução **sempre vence** a análise dele.

## 4. Alerta no seu WhatsApp pessoal
- O cliente respondeu, a conversa está com você e você não respondeu em **10 minutos**: o número da empresa manda um aviso pro seu celular pessoal com o nome do cliente, o que ele disse e o link da conversa.
- Vai um aviso só por resposta do cliente, para não te encher de mensagens.
- Fora do horário útil, os avisos são juntados num resumo que chega às 8h.
- O agente vai pedir **um número pessoal diferente** do número da empresa, em Configurações.

## 5. Proteções contra erro
- **Duas vozes:** antes de cada envio, o agente confere se você ou o cliente falaram nesse meio-tempo. Se falaram, ele cancela.
- **O agente confunde a própria mensagem com a sua:** esse risco existe hoje e vai ser corrigido. Quando isso acontece, ele acha que você assumiu e se cala.
- **Cliente esquecido:** uma lista **"Esperando você"** mostra quem está parado, o motivo e desde quando. Se alguém ficar parado mais de 2 dias úteis sem decisão, você recebe um alerta.
- **IA fora do ar ou WhatsApp caído:** ele não manda mensagem genérica. Guarda a mensagem e tenta de novo depois.
- **Venda ganha ou perdida no funil:** o agente para na hora.
- **Os 8 clientes parados desde setembro:** ficam como estão, como você pediu. Eles só aparecem na lista "Esperando você", sem nenhum envio.

## O que fica pra você testar
1. Mandar mensagem pelo celular para um cliente do pós-cotação e ver o agente sair.
2. Escrever uma instrução e conferir a resposta dele.
3. Responder de outro número como "cliente" e esperar o aviso de 10 minutos no seu WhatsApp pessoal.

---

## Detalhes técnicos
- **Decisão de retorno:** novo módulo puro `src/lib/smart/handoff.ts`, com testes. Ele recebe o motivo da saída, as pendências, a última mensagem de cada lado e as instruções, e devolve os modos permitidos (`auto` / `confirm` / `hold`). A IA propõe o modo e a data, e as regras limitam essa proposta. Uma sugestão `auto` em assunto sensível vira `confirm`.
- **Schema (aditivo):**
  - Em `conversation_control`: `handoff_kind`, `handoff_at`, `return_mode`, `return_at`, `return_reason` e `last_alerted_inbound_at`.
  - Nova tabela `agent_instructions`, com texto, interpretação em JSON, status e quem criou, protegida por RLS.
  - Em `settings`: o número pessoal de alerta.
- **Saída:** `registerHumanIntervention`, `handoff()` e `registerCustomerMessage` gravam `handoff_kind`. Preço, técnico, fechamento e irritação são detectados nas regras/IA já existentes.
- **Volta:** o tick do follow-up avalia conversas com `owner=human` e run Smart pausado ou `human_active`. Quando `return_at` vence:
  - `auto`: troca o owner para `ai`, retoma o run e incrementa `context_version`.
  - `confirm`: cria a ação em `needs_approval`, que aparece na aba Aprovações.
  - O pré-check continua bloqueando por `owner=human`, então só a transição explícita libera o envio.
- **Instruções:** um server fn interpreta o texto com o Gateway (data e modo), e o texto entra no prompt de decisão. A instrução "não fala até eu mandar" vira `hold` sem prazo.
- **Eco:** o envio automático já grava a linha `pending` com `source: automation` antes de chamar o provider. No webhook outbound, antes de considerar intervenção humana, procura uma linha `pending`/`sent` de automação na mesma conversa nos últimos 2 minutos com o mesmo texto ou tipo, e vincula o `external_message_id` em vez de registrar intervenção.
- **Alerta de 10 min:** roda no mesmo tick de minuto e manda pela UAZAPI para o número pessoal. A deduplicação é feita por `last_alerted_inbound_at`. Fora da janela, a mensagem entra na fila do resumo das 8h.
- **Esquecidos:** um novo tipo `client_stuck` na Central de Atenção, para run Smart pausado ou owner humano sem atividade por mais de 2 dias úteis.
- **Regras novas no AGENTS.md:** a regra de retorno fica centralizada em `handoff.ts`, e a decisão de eco fica no webhook.
