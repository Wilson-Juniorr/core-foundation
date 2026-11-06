# Pós-cotação confiável — plano em 3 etapas

O novo modo começa **desligado** para todos os clientes atuais. Só liga quando você clicar em "Ativar pós-cotação". Os 8 clientes antigos continuam parados, e os outros fluxos não mudam.

## Etapa A — Agenda e correções que travam os envios

**O que você vai ver**
- O botão **"Ativar pós-cotação"** dentro do cliente.
- Ao lado, o próximo contato: data, motivo, quem deve agir e quantos contatos já foram feitos.
- Se você ainda deve alguma resposta ao cliente, ele não é cobrado. Fica uma tarefa para você.

**Primeiro contato:** pelo menos 24h depois da ativação, sempre às 10h, só em dia útil.
- Seg 9h → Ter 10h
- Seg 10h → Ter 10h
- Seg 10h01 → Qua 10h
- Seg 16h ou 21h → Qua 10h
- Sex 9h → Seg 10h

Se o cliente já combinou uma data, essa data é mantida.

**Contatos quando o cliente fica em silêncio (8 no total):**

| Contato | Quando | Horário |
|---|---|---|
| 1 | primeiro contato (regra acima) | 10h |
| 2 | +3 dias | 15h |
| 3 | +3 dias | 10h |
| 4 | +4 dias | 15h |
| 5 | +5 dias | 10h |
| 6 | +5 dias | 15h |
| 7 | +7 dias | 15h |
| 8 | +7 dias (encerramento) | 15h |

- Se a data cair em fim de semana ou feriado, passa para o próximo dia útil.
- Depois do 8º contato, o acompanhamento encerra. Não há reativação automática e o cliente não é marcado como venda perdida.

**Correções de erros que existem hoje**
1. A mensagem preparada às vezes se anulava sozinha antes de sair.
2. Depois de um envio do fluxo inteligente, o acompanhamento podia ser encerrado por engano.
3. Uma resposta antiga do cliente cancelava todos os retornos novos.
4. Leitura de datas errada: "amanhã às 14h" virava 10h, "até sexta" era tratado como "me chama sexta", e "31/02" era aceito.
5. Em conversas com mais de 400 mensagens, a memória do cliente parava de atualizar.
6. Dois horários permitidos que não se cruzam (por exemplo, 9h–12h e 15h–18h) agora bloqueiam o envio e mostram o conflito.
7. Quando você aprova uma mensagem, ela sai no horário combinado, não na hora da aprovação.
8. Uma falha de conexão no meio do envio não faz a mensagem ser reenviada às cegas.

## Etapa B — Entender texto e áudio, e passar a vez para você

- Toda mensagem do cliente, em texto ou áudio, gera uma decisão: agendar, aguardar, passar para você ou encerrar. O motivo fica registrado.
- Mensagens seguidas são lidas juntas, num intervalo de cerca de 20 segundos.
- Os áudios são transcritos sem atrasar o recebimento.
- Respostas esperadas:
  - "Vou falar com minha esposa", recebida numa quinta → retorno na segunda às 15h.
  - "Te respondo até sexta" → espera o prazo terminar e retorna no próximo dia útil às 15h.
  - "Ficou caro", dúvida de hospital ou carência, "quero contratar" → passa para você.
  - "Agora não" → encerra o ciclo.
  - "Não me chama mais" → bloqueia novos contatos.
  - Data confusa → fica para você revisar. O agente não inventa data.
- Botões no cliente: **Assumir**, **Pendência resolvida / retomar em 3 dias**, **Reagendar**, **Pausar** e **Encerrar**.
- Uma mensagem sua sem pendência faz o agente retomar sozinho em 3 dias às 15h. Se você deixou uma promessa ou pergunta pendente, ele espera você.
- O próximo passo da oportunidade no CRM fica igual ao do acompanhamento.

## Etapa C — Áudios gravados e conferência final

- O agente pode escolher um áudio da Biblioteca quando fizer sentido. Ele não usa áudio duas vezes seguidas e não usa áudio com quem prefere texto.
- O 8º contato pode ser uma mensagem única ou dividida em 3 partes. Se o cliente responder no meio, as partes restantes não saem.
- Seus áudios mandados pelo celular passam a ser reconhecidos. O sistema também confere as confirmações de entrega da UAZAPI.
- Simulação do ciclo completo com um WhatsApp falso, sem enviar nada de verdade.
- Conferência real das tarefas automáticas, da IA, da transcrição e do recebimento de mensagens.

## Detalhes técnicos

- A cadência fica dentro do motor Smart que já existe, como uma política versionada (`post_quote_v1`), com funções puras em `src/lib/smart/post-quote-cadence.ts` testadas com relógio controlável. Não é criado um terceiro motor.
- A versão do contexto passa a subir de forma atômica no banco, por uma função SQL, e só com eventos reais. As atualizações operacionais param de incrementar a versão.
- O executor clássico continua a sequência pelo tipo de fluxo (`kind`). O fluxo Smart registra o contato e calcula a próxima avaliação.
- A parada por resposta no Smart usa a última mensagem que aquela ação já analisou.
- O leitor de datas é reescrito com normalização de acentos, horas e minutos, validação de calendário e tipo: pedido de contato, prazo ou menção. A data é interpretada pelo horário da mensagem original.
- A memória usa um marcador de leitura `(sent_at, id)` com lotes processados em ordem.
- Mudanças só aditivas no banco: campos no run (referência da cotação, contador de contatos, `next_reason`/`next_owner`) e exclusão por run para avaliações simultâneas.
- O retorno continua centralizado em `decideReturn`.
- Testes Vitest para cada critério de aceite da seção 15. Typecheck, lint e build ao fim de cada etapa.
- Pendências que não dependem só do código: confirmar o formato real das confirmações de entrega da UAZAPI e cadastrar seu WhatsApp pessoal para os alertas.

Vou entregar uma etapa por vez e testar cada uma antes de seguir.
