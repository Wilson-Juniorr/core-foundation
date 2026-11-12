# Próximo Passo

O sistema ajuda consultores comerciais a saber quem precisa de atenção e qual é o próximo passo em cada negociação. O primeiro uso é o acompanhamento de clientes e cotações de planos de saúde pelo WhatsApp.

## Fluxos disponíveis no código

| Fluxo       | Comportamento                                                                                                         |
| ----------- | --------------------------------------------------------------------------------------------------------------------- |
| CRM         | Cadastro de clientes e oportunidades, pipeline, tarefas e histórico                                                   |
| WhatsApp    | Conversas, vínculo com clientes, mensagens e recebimento de eventos pelo provedor configurado                         |
| Follow-up   | Ações agendadas, regras de envio, pausa, cancelamento e acompanhamento inteligente                                    |
| Pós-cotação | Ativação em oportunidade aberta, cadência explícita de oito contatos, próxima ação na ficha e controle pelo consultor |
| Pós-venda   | Acompanhamento de venda ganha, emissão, pendências, vigência e lembrete de acesso ao plano                            |
| Operação    | Fila de atenção, aprovações, auditoria, configurações e indicadores                                                   |

A disponibilidade de um fluxo na interface depende da configuração e da versão publicada. O [roteiro de pós-cotação](docs/post-quote-published-test.md) descreve a validação operacional.

## Regras de aceitação

- Uma mensagem vencida, invalidada por nova resposta ou ainda pendente de aprovação precisa ser bloqueada conforme a política aplicável.
- O agente respeita a janela de envio, o pedido de parada e a responsabilidade do consultor. A cadência conta contatos aceitos pelo provedor.
- Um envio incerto precisa ficar visível e aguardar confirmação. Evite nova tentativa antes de saber o que ocorreu com a anterior.
- A agenda da automação preserva as tarefas manuais do CRM.
- Valores, descontos e compromissos dependem das informações registradas no atendimento e das condições comerciais autorizadas.

## Uso no piloto

- Abra o cliente, marque a oportunidade como ganha e entre em **Pós-venda**. Registre a etapa confirmada e o prazo. O padrão para conferir emissão é de dois dias corridos e pode ser alterado.
- Ao registrar a vigência confirmada, o sistema marca a conferência de acesso ao plano para sete dias corridos depois da vigência. Os prazos do dia e atrasados aparecem em **Precisa de Mim**.
- A nota interna guarda os fatos confirmados quando o WhatsApp está sem histórico. O envio ao cliente é manual nesta etapa. O pós-cotação fica em **Acompanhamento** e permite recuperar histórico ou preparar uma mensagem a partir do resumo confirmado, mediante aprovação.
- Antes de disponibilizar as mudanças, confira a ordem das migrações de 0006 a 0009 e rode o piloto com um número controlado. A interface sinaliza desconexão, modo teste, parada e aprovação obrigatória.

## Próxima validação

Homologar o pós-cotação publicado com uma conversa de teste. Confirmar ativação, resposta durante a espera, aprovação, mídia, recibo e retomada antes de tratar esses cenários como verificados na operação real.
