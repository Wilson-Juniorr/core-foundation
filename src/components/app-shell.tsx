import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import {
  BellRing,
  BarChart3,
  BadgePercent,
  BookOpen,
  ChevronDown,
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
import { whatsappOperationalStatusQuery } from "@/lib/whatsapp.queries";

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

  const whatsapp = useQuery(whatsappOperationalStatusQuery());
  const notices: string[] = [];
  if (policy.data?.test_mode) notices.push("Modo teste ativo");
  if (policy.data?.require_approval_all) notices.push("Envios exigem aprovação");
  if (policy.isError) notices.push("Estado das automações indisponível");
  const connectionNotice =
    whatsapp.data === "error" || whatsapp.data === "disconnected"
      ? "WhatsApp desconectado"
      : whatsapp.isError
        ? "Estado do WhatsApp indisponível"
        : null;
  const automationPaused = policy.data?.automation_paused;
  if (notices.length === 0 && !connectionNotice && !automationPaused) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-amber-300/60 bg-amber-50 px-4 py-2.5 text-xs font-medium text-amber-950 sm:px-6 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-100">
      {automationPaused && (
        <Link to="/automacao" className="underline underline-offset-2">
          Automações pausadas
        </Link>
      )}
      {notices.length > 0 && (
        <Link to="/configuracoes" className="hover:underline">
          {notices.join(" · ")}
        </Link>
      )}
      {connectionNotice && (
        <Link to="/configuracoes/whatsapp" className="underline underline-offset-2">
          {connectionNotice}
        </Link>
      )}
    </div>
  );
}

const DAILY_ITEMS = [
  { to: "/dashboard", label: "Início", icon: LayoutDashboard },
  { to: "/atencao", label: "Precisa de Mim", icon: BellRing },
  { to: "/clientes", label: "Clientes", icon: Users },
  { to: "/conversas", label: "Conversas", icon: MessagesSquare },
  { to: "/pipeline", label: "Pipeline", icon: Workflow },
  { to: "/followups", label: "Follow-ups", icon: Repeat },
] as const;

const TOOL_ITEMS = [
  { to: "/biblioteca", label: "Biblioteca", icon: BookOpen },
  { to: "/condicoes", label: "Condições", icon: BadgePercent },
  { to: "/analytics", label: "Indicadores", icon: BarChart3 },
  { to: "/automacao", label: "Automações", icon: ShieldCheck },
  { to: "/configuracoes", label: "Configurações", icon: Settings },
] as const;

function NavContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const isActive = (to: string) => pathname === to || pathname.startsWith(`${to}/`);
  const toolActive = TOOL_ITEMS.some((item) => isActive(item.to));
  const [showTools, setShowTools] = useState(false);
  const toolsOpen = showTools || toolActive;

  function renderItem(item: (typeof DAILY_ITEMS)[number] | (typeof TOOL_ITEMS)[number]) {
    const active = isActive(item.to);
    return (
      <Link
        key={item.to}
        to={item.to}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-sidebar-primary",
          active
            ? "bg-sidebar-accent text-sidebar-accent-foreground font-semibold"
            : "text-sidebar-foreground/85 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
        )}
      >
        <item.icon className={cn("size-4", active && "text-sidebar-primary")} aria-hidden />
        {item.label}
      </Link>
    );
  }

  return (
    <div className="bg-sidebar text-sidebar-foreground flex h-full flex-col overflow-y-auto px-3 py-5">
      <Link
        to="/dashboard"
        onClick={onNavigate}
        className="font-display mb-6 rounded-lg px-3 py-2 text-lg font-bold tracking-tight focus-visible:outline-2 focus-visible:outline-sidebar-primary"
      >
        {PRODUCT_NAME}
      </Link>
      <nav aria-label="Menu principal" className="space-y-4">
        <div className="space-y-1">{DAILY_ITEMS.map(renderItem)}</div>
        <div className="border-t border-sidebar-border pt-3">
          <button
            type="button"
            aria-expanded={toolsOpen}
            aria-disabled={toolActive}
            onClick={() => !toolActive && setShowTools((open) => !open)}
            className="text-sidebar-foreground/80 hover:bg-sidebar-accent/60 flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left text-sm focus-visible:outline-2 focus-visible:outline-sidebar-primary"
          >
            Mais ferramentas
            <ChevronDown
              className={cn("size-4 transition-transform", toolsOpen && "rotate-180")}
              aria-hidden
            />
          </button>
          {toolsOpen && <div className="mt-1 space-y-1">{TOOL_ITEMS.map(renderItem)}</div>}
        </div>
      </nav>
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
      <aside className="bg-sidebar sticky top-0 hidden h-dvh w-56 shrink-0 lg:block">
        <NavContent />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="bg-card sticky top-0 z-30 flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-3 sm:px-6">
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

          <div className="flex shrink-0 items-center gap-1.5">
            <GlobalSearch />
            <Button variant="ghost" size="icon" onClick={handleSignOut} aria-label="Sair da conta">
              <LogOut className="size-4" />
            </Button>
          </div>
          {actions && (
            <div className="order-last flex w-full flex-wrap gap-2 sm:order-none sm:w-auto">
              {actions}
            </div>
          )}
        </header>

        <OperationBanner />

        <main className="min-w-0 flex-1 px-4 py-5 sm:px-6 sm:py-6">{children}</main>
      </div>
    </div>
  );
}
