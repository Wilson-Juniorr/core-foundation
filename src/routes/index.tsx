import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Próximo Passo — acompanhamento comercial sem esquecimentos" },
      {
        name: "description",
        content:
          "Plataforma de acompanhamento comercial: cada cliente ativo monitorado e cada negociação com um próximo passo definido.",
      },
      { property: "og:title", content: "Próximo Passo — acompanhamento comercial" },
      {
        property: "og:description",
        content: "Cada cliente ativo monitorado e cada negociação com um próximo passo definido.",
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex items-center justify-between px-6 py-6 sm:px-10">
        <span className="font-display text-base font-semibold">Próximo Passo</span>
        <Link
          to="/auth"
          className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Entrar
        </Link>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-6 py-20 sm:px-10">
        <p className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
          Sistema operacional comercial
        </p>
        <h1 className="mt-6 text-4xl font-semibold leading-tight sm:text-5xl">
          Nenhum cliente ativo esquecido. Toda negociação com um próximo passo.
        </h1>
        <p className="mt-6 max-w-xl text-base text-muted-foreground">
          Centralize clientes, oportunidades e o pipeline comercial em um só lugar — com clareza
          sobre o que precisa da sua atenção hoje.
        </p>
        <div className="mt-10">
          <Link
            to="/auth"
            className="inline-flex items-center justify-center rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Acessar a plataforma
          </Link>
        </div>
      </main>

      <footer className="px-6 py-8 text-xs text-muted-foreground sm:px-10">
        Módulo 01 — fundação do sistema.
      </footer>
    </div>
  );
}
