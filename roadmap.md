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
- [x] Política persistida, controles e testes integrados em banco isolado/provedor falso
- [ ] Confirmação operacional UAZAPI para tentativas sem recibo (capacidade de correlação do provedor não confirmada)
- [x] Regras de agenda: 1º contato 24h+10h e 8 contatos por silêncio (testadas)
- [x] Mensagem preparada não se anular sozinha (versão do contexto atômica)
- [x] Envio Smart não encerrar o acompanhamento
- [x] Resposta antiga não cancelar retornos novos
- [x] Leitor de datas: acentos, minutos, prazos e horário original; datas inválidas rejeitadas
- [ ] Bloqueio visível de expressão de data inválida/ambígua (atualmente não cria compromisso)
- [ ] Ativação e controles pelo navegador com cliente isolado (painel autenticado conferido; ciclo testado no banco isolado)
- [x] Memória em conversas com mais de 400 mensagens
- [x] Janelas sem interseção bloqueiam; aprovação mantém horário; sem reenvio cego
- [x] Botão "Ativar pós-cotação" + próximo contato visível
## Etapa B
- [ ] Decisão por mensagem (texto/áudio), botões Assumir/Resolvida/Reagendar/Pausar/Encerrar
## Etapa C
- [ ] Áudios da Biblioteca, encerramento em partes, recibos UAZAPI, simulação completa
