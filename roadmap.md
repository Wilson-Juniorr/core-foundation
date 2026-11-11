# Agente pós-cotação
- [x] Agenda em dias úteis/feriados + "daqui N dias"
- [x] Condições e campanhas (tela + uso pelo agente)
- [x] Ficha viva: etapa, decisor, plano cotado e temperatura por cliente
- [x] Desenho de saída/volta do agente (regras + falhas)
- [x] Devolver ao agente após intervenção humana (análise + instruções + travas)
- [x] Lista "Esperando você" + alerta de parados há 2 dias úteis
- [x] Evitar que o agente confunda a própria mensagem com a do consultor
- [x] Alerta de 10 min no WhatsApp pessoal
- [ ] Usuário cadastrar o número pessoal em Configurações → WhatsApp e publicar
- [ ] Painel por etapa
- [ ] Ajuste de tom (aguarda exemplos reais de conversa do usuário)

# Pós-cotação confiável (plano aprovado 06/11)
## Etapa A
- [x] Patch de seleção aplicado: Yasmin F Souza sem oportunidade (consulta e ficha confirmadas); zero/uma/várias e fechadas validadas em 1280px/390px com respostas simuladas, sem escrita/ativação/envio; suíte 105/105 e lint dos arquivos alterados OK
- [x] Corrigir dia 0/32, hora sem dia e conflito dia da semana/data; compromisso único com minutos; regressões reproduzidas antes da correção e suíte 94/94 após
- [x] Preparar roteiro `docs/post-quote-published-test.md`: cotação manual → ficha → devolução com aprovação → reagendamento individual → aprovação/recebimento/1 de 8/CRM; sem ativação/envio pelo agente de desenvolvimento
- [ ] Executar roteiro no publicado com contato controlado pelo usuário (publicar esta versão; aprovação e envio pelo usuário; devolução exige aprovação apenas da próxima mensagem)
- [x] Política persistida, controles e testes integrados em banco isolado/provedor falso
- [ ] Confirmação operacional UAZAPI para tentativas sem recibo (capacidade de correlação do provedor não confirmada)
- [x] Regras de agenda: 1º contato 24h+10h e 8 contatos por silêncio (testadas)
- [x] Mensagem preparada não se anular sozinha (versão do contexto atômica)
- [x] Envio Smart não encerrar o acompanhamento
- [x] Resposta antiga não cancelar retornos novos
- [x] Leitor de datas: acentos, minutos, prazos e horário original; datas inválidas rejeitadas
- [x] Data inválida/ambígua vira bloqueio visível + revisão ("Marcar como revisado"); sexta sem hora = 15h; "até sexta" = próximo dia permitido 15h; esposa na quinta = segunda 15h (testado)
- [x] Smart antigo: envio não reativa acompanhamento recém-encerrado (teste falha sem a correção)
- [x] Envio incerto: resolução auditável "Chegou / Não chegou" exige descrição do que foi verificado; sem isso segue bloqueado; nunca reenvia sozinho
- [x] Ativação, pausa, reagendar, encerrar e aviso de revisão conferidos no navegador (desktop e celular) com cliente fictício, sem envio; dados de teste apagados
- [x] Ciclo completo isolado: ativar → 1º contato → mensagem → aceite → contagem → próximo; resposta nova invalida; pausa/reagendar preservam contagem; aprovação mantém horário; 8º encerra sem 9º; tarefa manual preservada; falhas visíveis
- [ ] Homologar no app publicado: cron real disparando, envio real UAZAPI e recebimento de recibo (depende de publicar)
- [ ] Página do cliente no celular tem rolagem lateral (523px em tela de 390px) — anterior a esta rodada, fora do painel
- [x] Memória em conversas com mais de 400 mensagens
- [x] Janelas sem interseção bloqueiam; aprovação mantém horário; sem reenvio cego
- [x] Botão "Ativar pós-cotação" + próximo contato visível
## Etapa B
- [ ] Decisão por mensagem (texto/áudio), botões Assumir/Resolvida/Reagendar/Pausar/Encerrar
## Etapa C
- [ ] Áudios da Biblioteca, encerramento em partes, recibos UAZAPI, simulação completa
