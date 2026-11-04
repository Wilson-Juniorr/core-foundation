# Agente Pós-Cotação — Plano de Saúde

Um agente no WhatsApp que acompanha cada cliente depois da cotação até um "sim" ou "não" claro. Ele conversa, entende o momento de cada cliente, respeita o que o cliente pede ("me chama em 3 dias") e passa para você só o que precisa de você. Ele é construído em cima do fluxo inteligente "Pós-cotação" que já existe, e não do zero.

## 1. O "cérebro" de cada cliente (ficha viva)

Cada cliente tem uma ficha que o agente lê antes de qualquer mensagem e atualiza depois de cada resposta:

- **Etapa atual:** Cotação enviada → Analisando → Decidindo com alguém → Negociando condição → Documentação/emissão → Fechado / Perdido / Pausado
- **Quem decide:** só ele, esposa/marido, sócio, RH da empresa
- **Plano cotado:** operadora, tipo (PF, PME, adesão), vidas, valor e se inclui odonto
- **Últimas falas importantes** e o que ele já pediu
- **Promessas:** o que o cliente prometeu ("vejo com minha esposa") e o que você prometeu ("te mando a rede credenciada")
- **Temperatura (0–100)** e motivo
- **Quem está com a conversa:** Agente, Você, ou Aguardando o cliente

## 2. Entender cada resposta e reagir

A cada mensagem do cliente (inclusive áudio, que é transcrito), o agente classifica a intenção e escolhe o que fazer:

| O cliente diz | O agente faz |
|---|---|
| "Me chama daqui 3 dias" / "semana que vem" | Agenda nessa data, em dia útil e dentro do horário. Ex.: pediu na quinta → chama na segunda de manhã |
| "Vou ver com minha esposa" | Registra quem decide, espera cerca de 2 dias úteis e volta perguntando o que ela achou, oferecendo tirar dúvidas dos dois |
| "Tá caro" | Defende o valor (rede, carência, coparticipação) e oferece a condição ativa, se houver |
| "Vou pensar" | Espera, depois volta com um ângulo novo, nunca repetindo a mensagem anterior |
| Some sem responder | Segue a cadência padrão, que vai espaçando as mensagens |
| "Fechou, como faço?" | Passa para você imediatamente, com o resumo |
| Pergunta técnica sobre a proposta (rede, carência, PDF, reembolso) | Responde "vou confirmar e já te retorno" e passa para você |
| "Não quero mais" | Pergunta com educação o motivo (preço, atendimento, outra operadora), registra e encerra. Volta a chamar em 6 meses |

## 3. Passar para você e voltar (o ponto mais importante)

- **Quando ele passa para você:** pergunta técnica da proposta, pedido de fechamento, reclamação, negociação fora das regras ou baixa certeza sobre o que o cliente quis dizer.
- **Como ele avisa:** um alerta na Central de Atenção com o resumo, o motivo e o que o cliente perguntou. O agente fica calado nessa conversa.
- **Como ele volta:** quando você marcar "Devolver ao agente", ou automaticamente se você responder ao cliente e a conversa ficar parada X horas sem pendência sua. Antes de voltar, ele relê tudo o que você falou e continua a partir dali, sem repetir.
- Se você mandou uma mensagem manual, você sempre tem prioridade.

## 4. Condições e campanhas (nova tela)

Uma tela simples onde você cadastra:

- Operadora, desconto (30%, 40%, 75%...), validade ("até dia 20") e quem vale (novas vidas, PME...)
- Prazo de emissão da proposta

O agente usa isso com estratégia: "essa condição vai até sexta e a emissão leva X dias, então para garantir precisamos dos documentos até quarta". Ele também percebe na conversa quando **você** ofereceu uma condição e passa a trabalhar com ela. Ele nunca inventa desconto.

## 5. Agenda inteligente

- Só dias úteis, horário comercial em São Paulo, e evita feriados nacionais
- Respeita a data que o cliente pediu acima de qualquer cadência
- Cadência padrão quando o cliente não diz nada: D+1, D+3, D+6, D+10, D+15, depois quinzenal até 60–90 dias
- Prazos de campanha aproximam os contatos quando a validade está perto do fim

## 6. Painel de acompanhamento

Uma lista por etapa com: próxima ação e data, temperatura, quem está com a conversa, condição ativa e por que o agente decidiu o que decidiu. Você pode pausar, devolver ou assumir com um clique.

## Ordem de entrega

1. Ficha viva, leitura de intenção e agenda com dias úteis (o núcleo)
2. Passar para você e voltar ao fluxo, com alertas
3. Tela de condições/campanhas e uso estratégico de prazos
4. Painel por etapa
5. Ajuste do tom: o agente aprende com as mensagens que você escreve

## O que preciso de você antes do passo 3

- 3 a 5 exemplos reais de conversa pós-cotação (prints servem)
- As operadoras com que você mais trabalha

## Detalhes técnicos

- Reaproveitar o Smart Flow: `conversation_control` (dono da conversa), `commitments` (promessas/datas), pré-check antes do envio, stop-on-reply e o motor clássico intactos.
- Novo: estado do cliente (etapa, decisor, plano cotado, temperatura) por oportunidade; classificador de intenção com saída estruturada (intenção, data pedida, confiança, precisa de humano) usando o modelo de IA atual do gateway.
- Resolver de datas: expressões relativas em pt-BR → próximo dia útil em America/Sao_Paulo, com tabela de feriados nacionais e testes unitários (ex.: quinta + "3 dias" → segunda).
- Tabela `commercial_conditions` (operadora, desconto, validade, público, prazo de emissão) com RLS; o prompt só recebe as condições ativas, e o agente não pode citar condições fora dessa lista.
- Regras de handoff/retorno com testes, na mesma lógica de "touches" e cooldown já usada.
