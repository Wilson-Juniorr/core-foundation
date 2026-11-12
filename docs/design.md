# Interface do CRM

A base usa shadcn/ui, Radix, Tailwind e ícones Lucide. A configuração está em [components.json](../components.json), os tokens em [src/styles.css](../src/styles.css) e os componentes em [src/components/ui](../src/components/ui).

## Ações e estados

- Na ficha do cliente, indique a oportunidade selecionada, o estado da automação, o próximo passo e quem precisa agir. Diferencie tarefa manual de agenda automática.
- Mostre por que uma ação está indisponível e como recuperar o fluxo. Preserve a seleção do usuário quando houver mais de uma oportunidade possível.
- Use rótulos que descrevam a ação e indiquem estados de carregamento, vazio, erro e sucesso. Garanta foco visível, navegação por teclado, mensagens acessíveis e uso em tela estreita.
- Em ações que enviam ou agendam WhatsApp, verifique o comportamento com conta e contatos de teste. O [roteiro publicado](post-quote-published-test.md) descreve os casos operacionais.

Em cada alteração de UI, valide a tela afetada em desktop e celular quando houver ambiente de teste. O build verifica integração de código. A navegação e a acessibilidade precisam de evidência própria.
