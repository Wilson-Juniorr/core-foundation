import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import {
  BellRing,
  BarChart3,
  BookOpen,
  CalendarDays,
  LayoutDashboard,
  LogOut,
  Menu,
  MessagesSquare,
  Repeat,
  Settings,
  ShieldCheck,
  Users,
  Workflow,
} from "lucide-react";

import { GlobalSearch } from "@/components/global-search";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { getAutomationPolicy } from "@/lib/automation.functions";
import { cn } from "@/lib/utils";

const PRODUCT_NAME = "Próximo Passo";

/**
 * Barra de estado: quando a operação está em modo teste, pausada ou exigindo
 * aprovação, isso precisa ficar visível em toda tela — não escondido em uma aba.
 */
function OperationBanner() {
  const policy = useQuery({
    queryKey: ["automation", "policy"],
    queryFn: () => getAutomationPolicy(),
    staleTime: 60_000,
  });

  const notices: string[] = [];
  if (policy.data?.automation_paused) notices.push("Automações pausadas (parada de emergência)");
  if (policy.data?.test_mode) notices.push("Modo teste: mensagens automáticas são simuladas");
  if (policy.data?.require_approval_all) notices.push("Aprovação obrigatória para todo envio");
  if (notices.length === 0) return null;

  return (
    <div className="border-b border-[var(--warning)]/30 bg-[var(--warning)]/10 px-4 py-2 text-xs text-[var(--warning)] sm:px-8">
      {notices.join(" · ")}{" "}
      <Link to="/configuracoes" className="underline">
        Ajustar
      </Link>
    </div>
  );
}

const ACTIVE_ITEMS = [
  { to: "/dashboard", label: "Visão Geral", icon: LayoutDashboard },
  { to: "/atencao", label: "Precisa de Mim", icon: BellRing },
  { to: "/pipeline", label: "Pipeline", icon: Workflow },
  { to: "/clientes", label: "Clientes", icon: Users },
  { to: "/conversas", label: "Conversas", icon: MessagesSquare },
  { to: "/followups", label: "Follow-ups", icon: Repeat },
  { to: "/biblioteca", label: "Biblioteca", icon: BookOpen },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/automacao", label: "Orquestrador", icon: ShieldCheck },
  { to: "/configuracoes", label: "Configurações", icon: Settings },
] as const;

const UPCOMING_ITEMS = [{ label: "Agenda", icon: CalendarDays }] as const;

function NavContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  return (
    <div className="bg-sidebar text-sidebar-foreground flex h-full flex-col gap-6 py-4">
      <div className="px-4">
        <p className="font-display text-base font-bold tracking-tight">{PRODUCT_NAME}</p>
        <p className="text-sidebar-foreground/70 mt-1 flex items-center gap-1.5 text-[11px] font-semibold">
          <span className="bg-success size-1.5 rounded-full" aria-hidden />
          Operação ativa
        </p>
      </div>

      <nav className="flex flex-col gap-0.5 px-2">
        {ACTIVE_ITEMS.map((item) => {
          const active = pathname === item.to || pathname.startsWith(`${item.to}/`);
          return (
            <Link
              key={item.to}
              to={item.to}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors duration-150",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground font-semibold"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
              )}
            >
              <item.icon className={cn("size-4", active && "text-sidebar-primary")} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="flex flex-col gap-1 px-2">
        <p className="text-sidebar-foreground/50 px-3 pb-1 text-[11px] font-semibold tracking-wider uppercase">
          Em breve
        </p>
        {UPCOMING_ITEMS.map((item) => (
          <span
            key={item.label}
            aria-disabled="true"
            title="Disponível em um próximo módulo"
            className="text-sidebar-foreground/40 flex cursor-not-allowed items-center gap-3 rounded-md px-3 py-2 text-sm"
          >
            <item.icon className="size-4" />
            {item.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export function AppShell({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function handleSignOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="bg-background flex min-h-screen">
      <aside className="bg-sidebar hidden w-60 shrink-0 lg:block">
        <NavContent />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="bg-card sticky top-0 z-30 flex items-center gap-3 border-b px-4 py-3 shadow-sm sm:px-6">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden"
                aria-label="Abrir navegação"
              >
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="bg-sidebar w-72 border-0 p-0">
              <SheetTitle className="sr-only">Navegação</SheetTitle>
              <NavContent onNavigate={() => setMobileOpen(false)} />
            </SheetContent>
          </Sheet>

          <div className="min-w-0 flex-1">
            <h1 className="font-display truncate text-lg font-bold tracking-tight">{title}</h1>
            {description ? (
              <p className="text-muted-foreground truncate text-xs">{description}</p>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            <GlobalSearch />
            {actions}
            <Button variant="ghost" size="icon" onClick={handleSignOut} aria-label="Sair da conta">
              <LogOut className="size-4" />
            </Button>
          </div>
        </header>

        <OperationBanner />

        <main className="min-w-0 flex-1 px-4 py-5 sm:px-6 sm:py-6">{children}</main>

        <footer className="text-muted-foreground/70 flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2 text-[11px] sm:px-6">
          <span className="flex items-center gap-1.5">
            <span className="bg-success size-1.5 rounded-full" aria-hidden />
            Sistema online
          </span>
          <span>{PRODUCT_NAME} · acompanhamento comercial</span>
        </footer>
      </div>
    </div>
  );
}
