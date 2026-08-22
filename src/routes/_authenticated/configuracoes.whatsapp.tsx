import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { ErrorState, LoadingState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDateTime } from "@/lib/domain/datetime";
import { formatPhone } from "@/lib/domain/phone";
import {
  disconnectWhatsApp,
  refreshWhatsAppStatus,
  saveWhatsAppSettings,
  startWhatsAppSession,
  syncWhatsAppHistory,
} from "@/lib/whatsapp.functions";
import { whatsappConnectionQuery, whatsappKeys } from "@/lib/whatsapp.queries";
import { CONNECTION_STATUS_LABELS } from "@/lib/whatsapp/labels";

export const Route = createFileRoute("/_authenticated/configuracoes/whatsapp")({
  head: () => ({
    meta: [
      { title: "Conexão do WhatsApp | Próximo Passo" },
      {
        name: "description",
        content:
          "Configure a integração com a UZAPI, conecte o WhatsApp por QR Code e importe o histórico recente.",
      },
      { property: "og:title", content: "Conexão do WhatsApp | Próximo Passo" },
      {
        property: "og:description",
        content: "Conecte o WhatsApp da sua operação comercial em poucos passos.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: WhatsAppSettingsPage,
});

function WhatsAppSettingsPage() {
  const queryClient = useQueryClient();
  const connection = useQuery(whatsappConnectionQuery());
  const [baseUrl, setBaseUrl] = useState("https://");
  const [token, setToken] = useState("");
  const [instance, setInstance] = useState("");
  const [qrCode, setQrCode] = useState<string | null>(null);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: whatsappKeys.connection });

  const saveMutation = useMutation({
    mutationFn: () =>
      saveWhatsAppSettings({
        data: { base_url: baseUrl.trim(), token: token.trim(), instance_identifier: instance.trim() },
      }),
    onSuccess: async () => {
      setToken("");
      await invalidate();
      toast.success("Credenciais salvas com segurança");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const connectMutation = useMutation({
    mutationFn: () => startWhatsAppSession(),
    onSuccess: async (result) => {
      setQrCode(result.qrCode);
      await invalidate();
      toast.success(
        result.qrCode ? "Escaneie o QR Code no WhatsApp" : "Sessão iniciada. Verifique o status.",
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const statusMutation = useMutation({
    mutationFn: () => refreshWhatsAppStatus(),
    onSuccess: async () => {
      await invalidate();
      toast.success("Status atualizado");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const disconnectMutation = useMutation({
    mutationFn: () => disconnectWhatsApp(),
    onSuccess: async () => {
      setQrCode(null);
      await invalidate();
      toast.success("WhatsApp desconectado");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const syncMutation = useMutation({
    mutationFn: () => syncWhatsAppHistory({ data: {} }),
    onSuccess: async (result) => {
      await Promise.all([
        invalidate(),
        queryClient.invalidateQueries({ queryKey: whatsappKeys.conversationsRoot }),
      ]);
      toast.success(
        `Importação concluída: ${result.chats} conversas e ${result.messages} mensagens novas`,
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (connection.isLoading) {
    return (
      <AppShell title="WhatsApp" description="Conexão e importação de histórico">
        <LoadingState />
      </AppShell>
    );
  }

  if (connection.isError) {
    return (
      <AppShell title="WhatsApp" description="Conexão e importação de histórico">
        <ErrorState
          title="Não foi possível carregar a configuração."
          onRetry={() => void connection.refetch()}
        />
      </AppShell>
    );
  }

  const data = connection.data;
  const configured = Boolean(data?.has_credentials);

  return (
    <AppShell title="WhatsApp" description="Conexão via UZAPI e importação de histórico">
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Credenciais da UZAPI</CardTitle>
            <CardDescription>
              O token é guardado somente no servidor e nunca é exibido novamente.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                saveMutation.mutate();
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="base_url">URL base</Label>
                <Input
                  id="base_url"
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  placeholder="https://sua-instancia.uzapi.dev"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="token">Token</Label>
                <Input
                  id="token"
                  type="password"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  placeholder={configured ? "•••••••• (substituir)" : "Token da instância"}
                  autoComplete="off"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="instance">Identificador da instância (opcional)</Label>
                <Input
                  id="instance"
                  value={instance}
                  onChange={(event) => setInstance(event.target.value)}
                  placeholder="minha-instancia"
                />
              </div>
              <Button type="submit" disabled={saveMutation.isPending}>
                {saveMutation.isPending ? "Salvando…" : "Salvar credenciais"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle>Status da conexão</CardTitle>
              <Badge variant={data?.status === "connected" ? "default" : "secondary"}>
                {data ? CONNECTION_STATUS_LABELS[data.status] : "Não configurado"}
              </Badge>
            </div>
            <CardDescription>
              {data?.phone_number
                ? `Número conectado: ${formatPhone(data.phone_number)}`
                : "Nenhum número conectado ainda."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!configured ? (
              <p className="text-muted-foreground text-sm">
                Salve as credenciais da UZAPI para liberar a conexão.
              </p>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => connectMutation.mutate()} disabled={connectMutation.isPending}>
                    {connectMutation.isPending && (
                      <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
                    )}
                    Conectar / gerar QR Code
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => statusMutation.mutate()}
                    disabled={statusMutation.isPending}
                  >
                    Atualizar status
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => disconnectMutation.mutate()}
                    disabled={disconnectMutation.isPending}
                  >
                    Desconectar
                  </Button>
                </div>

                {qrCode && (
                  <div className="space-y-2 rounded-md border p-4">
                    <p className="text-sm font-medium">Escaneie no WhatsApp</p>
                    <img
                      src={qrCode.startsWith("data:") ? qrCode : `data:image/png;base64,${qrCode}`}
                      alt="QR Code para conectar o WhatsApp"
                      className="size-56 rounded-md bg-white p-2"
                    />
                    <p className="text-muted-foreground text-xs">
                      O código expira em pouco tempo e não é armazenado.
                    </p>
                  </div>
                )}

                <dl className="text-muted-foreground grid gap-1 text-xs">
                  <div className="flex gap-2">
                    <dt>Último evento:</dt>
                    <dd>{data?.last_event_at ? formatDateTime(data.last_event_at) : "—"}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt>Conectado em:</dt>
                    <dd>{data?.last_connected_at ? formatDateTime(data.last_connected_at) : "—"}</dd>
                  </div>
                  {data?.last_error && (
                    <div className="text-destructive flex gap-2">
                      <dt>Último erro:</dt>
                      <dd>{data.last_error}</dd>
                    </div>
                  )}
                </dl>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Importar histórico recente</CardTitle>
            <CardDescription>
              Traz as conversas e mensagens recentes da instância. A importação é idempotente:
              rodar de novo não duplica mensagens.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button
              onClick={() => syncMutation.mutate()}
              disabled={!configured || syncMutation.isPending}
            >
              {syncMutation.isPending && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />}
              Importar histórico
            </Button>
            <p className="text-muted-foreground text-xs">
              {data?.last_synced_at
                ? `Última importação: ${formatDateTime(data.last_synced_at)} — ${data.last_sync_status ?? "sem detalhes"}`
                : "Nenhuma importação executada ainda."}
            </p>
            <div className="space-y-1">
              <p className="text-sm font-medium">Endereço do webhook</p>
              <code className="bg-muted block truncate rounded px-2 py-1 text-xs">
                {data?.webhook_url ?? "Disponível após salvar as credenciais"}
              </code>
              <p className="text-muted-foreground text-xs">
                Configurado automaticamente na UZAPI ao salvar. Contém um segredo — não compartilhe.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
