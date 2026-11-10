# Roteiro de homologação — pós-cotação

Aplicativo: https://engage-flow-89.lovable.app

Execute somente após publicar a versão com esta correção. Esta rodada não publicou, ativou, reagendou, aprovou ou enviou mensagens por você.

## Preparação segura

- Use um contato novo com outro WhatsApp que você controla (não o número remetente conectado à UAZAPI).
- Abra uma oportunidade de teste e anote sua tarefa manual atual. Não use clientes antigos.
- Confira que o WhatsApp remetente está conectado. Use horário de São Paulo, dia útil, dentro da interseção das janelas configuradas (a política usa 09h–19h).
- Não altere a autonomia do fluxo compartilhado nem libere aprovações em lote.

## Seu caminho real

1. **Envie a cotação manualmente** na conversa do contato de teste. Confira sua chegada no WhatsApp receptor e a presença dessa cotação no histórico do CRM. Essa mensagem manual não conta como contato da cadência.
2. **Abra a ficha do contato**, selecione a oportunidade aberta e clique em **Ativar pós-cotação**. Confira **0 de 8**. A primeira data automática é o primeiro dia útil às 10h que respeita no mínimo 24 horas após a ativação; não é necessariamente amanhã.
3. Em **Quem conduz a conversa**, se estiver **Você**, clique em **Devolver, mas me mostrar antes** — não em **Devolver ao agente agora**. Se houver resposta sua pendente, revisão de data ou tema sensível, resolva isso antes; não force a liberação. Essa devolução exige aprovação da próxima mensagem, não de todas as mensagens futuras.
4. Se a conversa já estiver **Agente** e você não tiver confirmado a exigência de aprovação da próxima mensagem, **pare aqui**: não reagende um envio automático. Use **Instruções para o agente** para solicitar retorno com mensagem para aprovação, confira a interpretação e só confirme se ela disser que mostrará antes de enviar. Se isso não estiver disponível ou não for confirmado na tela, não prossiga.
5. Em **Pós-cotação → Reagendar**, escolha para **esse contato** um horário útil futuro com folga para conferir a mensagem (por exemplo, 10–15 minutos, dentro das janelas). Clique em **Confirmar horário**. Isso é uma alteração manual e explícita da agenda só desse teste; a regra automática de 24h permanece intacta. Confira data e **0 de 8**. Se houver prazo posterior combinado com o cliente, preserve-o.
6. Aguarde a avaliação automática e a mensagem aparecer em **Mensagem que será enviada**, com **Aguardando sua aprovação** (também disponível em **Follow-ups → Aprovações**). Leia o texto e confira a base no histórico/cotação. **Não clique em Aprovar e enviar** se aparecer apenas envio automático ou se o texto não fizer sentido; pause o teste.
7. Quando você decidir liberar, clique em **Aprovar e enviar**. Aprovar não muda o horário: o agendador envia a partir da data combinada após suas verificações. Se o horário já passou, a mensagem pode sair no próximo ciclo permitido. Antes da aprovação, nada deve ter chegado ao receptor e o contador deve ser **0 de 8**.
8. Confira a **chegada no WhatsApp receptor**, não só o estado “enviado” no CRM. Anote texto, horário, se houve duplicação e comprovante de recebimento. Confira **1 de 8**, próxima data na ficha e agenda de pós-cotação da oportunidade. A oportunidade deve continuar aberta e sua tarefa manual intacta. Aceite do provedor e entrega ao telefone são verificações distintas.
9. **Pause somente esse contato** após concluir a conferência, antes do segundo envio. Assim a continuação não fica automática durante sua homologação. Pausar deve preservar **1 de 8**. Para uma nova tentativa, devolva com aprovação novamente quando necessário; não reutilize uma aprovação anterior.

## Regressões de data pelo WhatsApp receptor

Faça cada cenário separadamente, apenas neste contato, antes de aprovar qualquer mensagem. Não empilhe cenários numa única conversa sem resolver a revisão anterior.

| Mensagem recebida                       | Resultado esperado                                          |
| --------------------------------------- | ----------------------------------------------------------- |
| Me chama dia 32                         | Bloqueado · revisão de data; responsável Você; nenhum envio |
| Me chama dia 0                          | Mesmo bloqueio                                              |
| Me chama às 14h                         | Mesmo bloqueio: falta o dia                                 |
| Me chama quinta dia 13/03/2026 às 14h25 | Revisão: 13/03/2026 é sexta, não quinta                     |
| Me chama sexta dia 13/03/2026 às 14h25  | Um único compromisso, sexta às 14h25, sem duplicação        |

As duas datas de março são exemplos históricos dos testes automatizados: **não as use para agendar um envio real agora**. Para testar no publicado, substitua por uma data futura útil, calculando o dia da semana correspondente; no caso contraditório, escreva outro dia da semana. Confira a concordância antes do ajuste de feriados/fins de semana. Horas e minutos explícitos devem continuar iguais após esse ajuste.

Uma resposta nova deve invalidar a mensagem pendente. Para liberar um bloqueio, confirme o prazo real com o contato, clique em **Marcar como revisado** e reagende explicitamente. Revisão de data não é aprovação de envio.

## Se algo não funcionar

- Se a avaliação não acontecer, anote data/hora, status, responsável, motivo e próxima ação; isso pode indicar pendência do agendador publicado. Não libere outros clientes para investigar.
- Se aparecer **Envio sem confirmação**, não reenvie. Confira a conversa do remetente e a do receptor, descreva a evidência e só então use **Chegou ao cliente** ou **Não chegou**. Sem prova suficiente, mantenha bloqueado. “Não chegou” pausa e exige reagendamento explícito.
- Se uma nova resposta chegar antes do envio, não aprove o texto antigo. Espere a atualização e revisão contextual.
- Guarde evidências das telas de aprovação, recebimento no WhatsApp, contador e próxima data no CRM. Não inclua credenciais ou tokens.

## O que este roteiro ainda não comprova

Publicação desta versão, execução real do agendador, devolução humana na sessão publicada, recebimento UAZAPI e correlação de tentativas ainda dependem da sua execução controlada. Os testes automatizados usam banco isolado, relógio controlado e provedor falso, sem mensagens reais. As etapas B e C não foram iniciadas.
