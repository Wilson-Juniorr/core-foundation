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
    <div className="border-b bg-amber-50 px-4 py-2 text-xs text-amber-900 sm:px-8 dark:bg-amber-950/40 dark:text-amber-200">
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
    <div className="flex h-full flex-col gap-8 px-3 py-6">
      <div className="px-3">
        <p className="font-display text-base font-semibold tracking-tight">{PRODUCT_NAME}</p>
        <p className="text-signal mt-1 flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.14em] uppercase">
          <span className="bg-signal size-1.5 rounded-full" aria-hidden />
          Operação ativa
        </p>
      </div>

      <nav className="flex flex-col gap-0.5">
        {ACTIVE_ITEMS.map((item) => {
          const active = pathname === item.to || pathname.startsWith(`${item.to}/`);
          return (
            <Link
              key={item.to}
              to={item.to}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-3 border-l-2 px-3 py-2 text-sm transition-colors duration-150",
                active
                  ? "border-signal bg-secondary text-foreground font-semibold"
                  : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground border-transparent",
              )}
            >
              <item.icon className={cn("size-4", active && "text-signal")} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="flex flex-col gap-1">
        <p className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
          Em breve
        </p>
        {UPCOMING_ITEMS.map((item) => (
          <span
            key={item.label}
            aria-disabled="true"
            title="Disponível em um próximo módulo"
            className="flex cursor-not-allowed items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground/50"
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
      <aside className="bg-sidebar hidden w-64 shrink-0 border-r lg:block">
        <NavContent />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="bg-background/80 sticky top-0 z-30 flex items-center gap-3 border-b px-4 py-3 backdrop-blur sm:px-8">
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
            <SheetContent side="left" className="w-72 p-0">
              <SheetTitle className="sr-only">Navegação</SheetTitle>
              <NavContent onNavigate={() => setMobileOpen(false)} />
            </SheetContent>
          </Sheet>

          <div className="min-w-0 flex-1">
            <h1 className="font-display truncate text-lg font-semibold tracking-tight">{title}</h1>
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

        <main className="grid-tech min-w-0 flex-1 px-4 py-6 sm:px-8 sm:py-8">{children}</main>

        <footer className="text-muted-foreground/70 flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2 text-[10px] tracking-[0.12em] uppercase sm:px-8">
          <span className="flex items-center gap-1.5">
            <span className="bg-signal size-1.5 rounded-full" aria-hidden />
            Sistema online
          </span>
          <span>{PRODUCT_NAME} · acompanhamento comercial</span>
        </footer>
      </div>
    </div>
  );
}
