import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, MessageSquareDot, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { ErrorState, LoadingState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { getAutomationPolicy, saveAutomationPolicy } from "@/lib/automation.functions";
import { getUserSettings, saveUserSettings } from "@/lib/followup.functions";
import { saveNotificationSettings, saveWorkspaceProfile } from "@/lib/system.functions";
import { notificationSettingsQuery, systemKeys, workspaceProfileQuery } from "@/lib/system.queries";

export const Route = createFileRoute("/_authenticated/configuracoes/")({
  head: () => ({
    meta: [
      { title: "Configurações da operação — Próximo Passo" },
      {
        name: "description",
        content:
          "Central de configurações: perfil, fuso e janela de envio, avisos, aprovação obrigatória e modo teste.",
      },
      { property: "og:title", content: "Configurações da operação" },
      {
        property: "og:description",
        content:
          "Ajuste como o sistema trabalha por você: horários, avisos e trilhos de segurança.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SettingsHubPage,
});

function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

function ProfileCard() {
  const queryClient = useQueryClient();
  const profile = useQuery(workspaceProfileQuery());
  const [name, setName] = useState("");

  useEffect(() => {
    if (profile.data) setName(profile.data.display_name ?? "");
  }, [profile.data]);

  const mutation = useMutation({
    mutationFn: () => saveWorkspaceProfile({ data: { display_name: name } }),
    onSuccess: async () => {
      toast.success("Perfil atualizado.");
      await queryClient.invalidateQueries({ queryKey: systemKeys.profile });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (profile.isLoading) return <LoadingState rows={2} />;
  if (profile.isError) return <ErrorState onRetry={() => profile.refetch()} />;

  return (
    <SectionCard title="Seu perfil" description="Como você aparece dentro do sistema.">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="display-name">Nome</Label>
          <Input
            id="display-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Seu nome"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="profile-email">E-mail de acesso</Label>
          <Input id="profile-email" value={profile.data?.email ?? ""} readOnly disabled />
        </div>
      </div>
      <Button
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending || name.trim().length < 2}
      >
        Salvar perfil
      </Button>
    </SectionCard>
  );
}

function OperationCard() {
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: ["followup", "settings"],
    queryFn: () => getUserSettings(),
  });
  const [timezone, setTimezone] = useState("America/Sao_Paulo");
  const [start, setStart] = useState("08:00");
  const [end, setEnd] = useState("20:00");
  const [pauseOnHandoff, setPauseOnHandoff] = useState(true);

  useEffect(() => {
    if (!settings.data) return;
    setTimezone(settings.data.timezone);
    setStart(settings.data.send_window_start);
    setEnd(settings.data.send_window_end);
    setPauseOnHandoff(settings.data.pause_automation_on_handoff);
  }, [settings.data]);

  const mutation = useMutation({
    mutationFn: () =>
      saveUserSettings({
        data: {
          timezone,
          send_window_start: start,
          send_window_end: end,
          pause_automation_on_handoff: pauseOnHandoff,
        },
      }),
    onSuccess: async () => {
      toast.success("Configurações de operação salvas.");
      await queryClient.invalidateQueries({ queryKey: ["followup", "settings"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (settings.isLoading) return <LoadingState rows={3} />;
  if (settings.isError) return <ErrorState onRetry={() => settings.refetch()} />;

  return (
    <SectionCard
      title="Horários e operação"
      description="Nenhuma automação sai fora da janela definida aqui."
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="timezone">Fuso horário</Label>
          <Input
            id="timezone"
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="window-start">Início dos envios</Label>
          <Input
            id="window-start"
            type="time"
            value={start}
            onChange={(event) => setStart(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="window-end">Fim dos envios</Label>
          <Input
            id="window-end"
            type="time"
            value={end}
            onChange={(event) => setEnd(event.target.value)}
          />
        </div>
      </div>
      <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
        <div>
          <p className="text-sm font-medium">Pausar automações quando algo precisar de mim</p>
          <p className="text-muted-foreground text-xs">
            Ao surgir um item na fila de atenção, o sistema para de enviar naquele cliente.
          </p>
        </div>
        <Switch checked={pauseOnHandoff} onCheckedChange={setPauseOnHandoff} />
      </div>
      <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
        Salvar operação
      </Button>
    </SectionCard>
  );
}

function ApprovalCard() {
  const queryClient = useQueryClient();
  const policy = useQuery({
    queryKey: ["automation", "policy"],
    queryFn: () => getAutomationPolicy(),
  });
  const [requireApproval, setRequireApproval] = useState(false);
  const [testMode, setTestMode] = useState(false);
  const [allowlist, setAllowlist] = useState("");

  useEffect(() => {
    if (!policy.data) return;
    setRequireApproval(policy.data.require_approval_all);
    setTestMode(policy.data.test_mode);
    setAllowlist(policy.data.test_mode_allowlist.join(", "));
  }, [policy.data]);

  const mutation = useMutation({
    mutationFn: () => {
      const current = policy.data!;
      return saveAutomationPolicy({
        data: {
          ...current,
          require_approval_all: requireApproval,
          test_mode: testMode,
          test_mode_allowlist: allowlist
            .split(",")
            .map((value) => value.trim())
            .filter((value) => value.length >= 8),
        },
      });
    },
    onSuccess: async () => {
      toast.success("Trilhos de segurança atualizados.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["automation", "policy"] }),
        queryClient.invalidateQueries({ queryKey: systemKeys.status }),
      ]);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (policy.isLoading) return <LoadingState rows={3} />;
  if (policy.isError) return <ErrorState onRetry={() => policy.refetch()} />;

  return (
    <SectionCard
      title="Segurança dos envios"
      description="Decida quanto o sistema pode fazer sozinho enquanto você ganha confiança."
    >
      <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
        <div>
          <p className="text-sm font-medium">Aprovação obrigatória</p>
          <p className="text-muted-foreground text-xs">
            Toda mensagem automática vira rascunho e espera seu aval.
          </p>
        </div>
        <Switch checked={requireApproval} onCheckedChange={setRequireApproval} />
      </div>
      <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
        <div>
          <p className="text-sm font-medium">Modo teste</p>
          <p className="text-muted-foreground text-xs">
            Nada chega ao cliente: as mensagens ficam registradas como simuladas.
          </p>
        </div>
        <Switch checked={testMode} onCheckedChange={setTestMode} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="allowlist">Números liberados no modo teste</Label>
        <Input
          id="allowlist"
          value={allowlist}
          onChange={(event) => setAllowlist(event.target.value)}
          placeholder="+55 11 99999-0000, +55 21 98888-0000"
        />
        <p className="text-muted-foreground text-xs">
          Separe por vírgula. Estes números recebem de verdade, para você validar ponta a ponta.
        </p>
      </div>
      <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
        Salvar segurança
      </Button>
    </SectionCard>
  );
}

function NotificationsCard() {
  const queryClient = useQueryClient();
  const notifications = useQuery(notificationSettingsQuery());
  const [failures, setFailures] = useState(true);
  const [approvals, setApprovals] = useState(true);
  const [attention, setAttention] = useState(true);

  useEffect(() => {
    if (!notifications.data) return;
    setFailures(notifications.data.notify_failures);
    setApprovals(notifications.data.notify_approvals);
    setAttention(notifications.data.notify_attention);
  }, [notifications.data]);

  const mutation = useMutation({
    mutationFn: () =>
      saveNotificationSettings({
        data: {
          notify_failures: failures,
          notify_approvals: approvals,
          notify_attention: attention,
        },
      }),
    onSuccess: async () => {
      toast.success("Avisos atualizados.");
      await queryClient.invalidateQueries({ queryKey: systemKeys.notifications });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (notifications.isLoading) return <LoadingState rows={3} />;
  if (notifications.isError) return <ErrorState onRetry={() => notifications.refetch()} />;

  const rows = [
    {
      key: "failures",
      label: "Falhas de envio",
      description: "Quando uma mensagem não chega ao cliente.",
      value: failures,
      set: setFailures,
    },
    {
      key: "approvals",
      label: "Rascunhos aguardando aprovação",
      description: "Quando a IA gera algo que depende do seu aval.",
      value: approvals,
      set: setApprovals,
    },
    {
      key: "attention",
      label: "Itens que precisam de mim",
      description: "Quando um cliente exige resposta humana.",
      value: attention,
      set: setAttention,
    },
  ];

  return (
    <SectionCard
      title="Avisos"
      description="Escolha o que deve aparecer em destaque na sua fila de trabalho."
    >
      {rows.map((row) => (
        <div
          key={row.key}
          className="flex items-center justify-between gap-4 rounded-lg border p-4"
        >
          <div>
            <p className="text-sm font-medium">{row.label}</p>
            <p className="text-muted-foreground text-xs">{row.description}</p>
          </div>
          <Switch checked={row.value} onCheckedChange={row.set} />
        </div>
      ))}
      <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
        Salvar avisos
      </Button>
    </SectionCard>
  );
}

function SettingsHubPage() {
  return (
    <AppShell
      title="Configurações"
      description="Tudo o que define como o sistema trabalha por você, em um só lugar."
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <MessageSquareDot className="size-4" aria-hidden />
              WhatsApp
            </CardTitle>
            <CardDescription>Conexão, QR Code e importação de histórico.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" size="sm">
              <Link to="/configuracoes/whatsapp">Abrir conexão</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="size-4" aria-hidden />
              Saúde do sistema
            </CardTitle>
            <CardDescription>Filas, falhas e histórico de alterações.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" size="sm">
              <Link to="/configuracoes/sistema">Abrir diagnóstico</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="size-4" aria-hidden />
              Orquestrador
            </CardTitle>
            <CardDescription>Políticas, limites e decisões automáticas.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" size="sm">
              <Link to="/automacao">Abrir orquestrador</Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <ProfileCard />
        <OperationCard />
        <ApprovalCard />
        <NotificationsCard />
      </div>
    </AppShell>
  );
}
