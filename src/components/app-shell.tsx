import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import {
  BookOpen,
  CalendarDays,
  LayoutDashboard,
  LogOut,
  Menu,
  MessagesSquare,
  Repeat,
  Settings,
  Users,
  Workflow,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

const PRODUCT_NAME = "Próximo Passo";

const ACTIVE_ITEMS = [
  { to: "/dashboard", label: "Visão Geral", icon: LayoutDashboard },
  { to: "/pipeline", label: "Pipeline", icon: Workflow },
  { to: "/clientes", label: "Clientes", icon: Users },
  { to: "/conversas", label: "Conversas", icon: MessagesSquare },
  { to: "/followups", label: "Follow-ups", icon: Repeat },
  { to: "/configuracoes/whatsapp", label: "Configurações", icon: Settings },
] as const;

const UPCOMING_ITEMS = [
  { label: "Agenda", icon: CalendarDays },
  { label: "Biblioteca", icon: BookOpen },
] as const;

function NavContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  return (
    <div className="flex h-full flex-col gap-8 px-4 py-6">
      <div className="px-2">
        <p className="font-display text-base font-semibold tracking-tight">{PRODUCT_NAME}</p>
        <p className="mt-1 text-xs text-muted-foreground">Acompanhamento comercial</p>
      </div>

      <nav className="flex flex-col gap-1">
        {ACTIVE_ITEMS.map((item) => {
          const active = pathname === item.to || pathname.startsWith(`${item.to}/`);
          return (
            <Link
              key={item.to}
              to={item.to}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-secondary font-medium text-secondary-foreground"
                  : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
              )}
            >
              <item.icon className="size-4" />
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
    <div className="flex min-h-screen bg-background">
      <aside className="hidden w-64 shrink-0 border-r bg-sidebar lg:block">
        <NavContent />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b px-4 py-4 sm:px-8">
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
            <h1 className="truncate text-lg font-semibold">{title}</h1>
            {description ? (
              <p className="truncate text-sm text-muted-foreground">{description}</p>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            {actions}
            <Button variant="ghost" size="icon" onClick={handleSignOut} aria-label="Sair da conta">
              <LogOut className="size-4" />
            </Button>
          </div>
        </header>

        <main className="min-w-0 flex-1 px-4 py-6 sm:px-8 sm:py-8">{children}</main>
      </div>
    </div>
  );
}
