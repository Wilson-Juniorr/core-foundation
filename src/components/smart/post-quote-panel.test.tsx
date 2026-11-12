import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PostQuotePanel } from "./post-quote-panel";

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({}),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: vi.fn() }));
vi.mock("@/lib/post-quote.functions", () => ({
  activatePostQuoteFn: vi.fn(),
  controlPostQuoteFn: vi.fn(),
  postQuoteViewFn: vi.fn(),
  resolvePostQuoteFn: vi.fn(),
}));

const openA = { id: "a", title: "Cotação A", status: "open" };
const openB = { id: "b", title: "Cotação B", status: "open" };

function render(opportunities: (typeof openA)[]) {
  return renderToStaticMarkup(
    <PostQuotePanel
      contactId="contact"
      opportunities={opportunities}
      onCreateOpportunity={vi.fn()}
    />,
  );
}

describe("seleção da oportunidade do pós-cotação", () => {
  it("explica a falta de oportunidade e oferece abrir o formulário", () => {
    const html = render([]);
    expect(html).toContain("Nova oportunidade");
    expect(html).toContain("ainda não tem uma oportunidade");
    expect(html).not.toContain("Ativar pós-cotação");
  });

  it("distingue uma ficha com oportunidades encerradas", () => {
    const html = render([{ ...openA, status: "won" }]);
    expect(html).toContain("fechadas ou arquivadas");
    expect(html).toContain("Nova oportunidade");
  });

  it("permite ativar com a única oportunidade aberta", () => {
    expect(render([openA])).toMatch(
      /<button(?![^>]*\sdisabled="")[^>]*>(?:(?!<\/button>)[\s\S])*Ativar pós-cotação/,
    );
  });

  it("exige a seleção quando há duas oportunidades abertas", () => {
    expect(render([openA, openB])).toMatch(
      /<button[^>]*\sdisabled=""[^>]*>(?:(?!<\/button>)[\s\S])*Ativar pós-cotação/,
    );
  });
});
