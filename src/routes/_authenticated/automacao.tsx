import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { CircleStop, ShieldCheck, TestTube2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { EmptyState, LoadingState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  getAutomationPolicy,
  listAutomationDecisions,
  saveAutomationPolicy,
  setEmergencyStop,
} from "@/lib/automation.functions";
import type { AutomationDecisionKind, AutomationPolicySettings } from "@/lib/automation/types";
import { DECISION_LABELS } from "@/lib/automation/types";
import { formatDateTime } from "@/lib/domain/datetime";

export const Route = createFileRoute("/_authenticated/automacao")({
  head: () => ({
    meta: [
      { title: "Orquestrador e Guardrails — Próximo Passo" },
      {
        name: "description",
        content:
          "Políticas de automação, silêncio inteligente, modo teste, parada de emergência e auditoria de cada decisão automática.",
      },
      { property: "og:title", content: "Orquestrador e Guardrails" },
      {
        property: "og:description",
        content: "Controle total das automações: políticas, limites e histórico de decisões.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AutomationPage,
});

const policyQuery = () => ({
  queryKey: ["automation-policy"] as const,
  queryFn: () => getAutomationPolicy(),
});

const decisionsQuery = () => ({
  queryKey: ["automation-decisions"] as const,
  queryFn: () => listAutomationDecisions({ data: { limit: 40 } }),
});

const DECISION_VARIANT: Record<
  AutomationDecisionKind,
  "default" | "secondary" | "destructive" | "outline"
> = {
  allowed: "secondary",
  blocked: "destructive",
  deferred: "outline",
  simulated: "outline",
  approval_required: "default",
  handoff: "destructive",
};

function EmergencyCard({ policy }: { policy: AutomationPolicySettings }) {
  const queryClient = useQueryClient();
  const toggle = useMutation({
    mutationFn: (paused: boolean) => setEmergencyStop({ data: { paused } }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["automation-policy"] });
      toast.success(
        result.paused
          ? "Automações pausadas. Nada é enviado até você retomar."
          : "Automações retomadas. As ações pendentes voltam a ser avaliadas.",
      );
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Não foi possível alterar."),
  });

  return (
    <Card className={policy.automation_paused ? "border-destructive/60" : undefined}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <CircleStop className="size-4 text-muted-foreground" />
          Parada de emergência
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <p className="max-w-xl text-muted-foreground">
          {policy.automation_paused
            ? `Todas as automações estão pausadas desde ${policy.automation_paused_at ? formatDateTime(policy.automation_paused_at) : "agora"}. As ações continuam na fila e nada é perdido.`
            : "Pausa imediatamente qualquer envio automático. As ações agendadas são adiadas, nunca descartadas."}
        </p>
        <Button
          variant={policy.automation_paused ? "default" : "destructive"}
          disabled={toggle.isPending}
          onClick={() => toggle.mutate(!policy.automation_paused)}
        >
          {policy.automation_paused ? "Retomar automações" : "Pausar tudo agora"}
        </Button>
      </CardContent>
    </Card>
  );
}

function PolicyForm({ policy }: { policy: AutomationPolicySettings }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<AutomationPolicySettings | null>(null);
  const current = draft ?? policy;

  const save = useMutation({
    mutationFn: (next: AutomationPolicySettings) =>
      saveAutomationPolicy({
        data: {
          test_mode: next.test_mode,
          test_mode_phone: next.test_mode_phone,
          conversation_cooldown_minutes: next.conversation_cooldown_minutes,
          manual_message_cooldown_minutes: next.manual_message_cooldown_minutes,
          active_conversation_minutes: next.active_conversation_minutes,
          max_automations_per_day: next.max_automations_per_day,
          max_flow_automations_per_day: next.max_flow_automations_per_day,
          confidence_auto_min: next.confidence_auto_min,
          confidence_approval_min: next.confidence_approval_min,
        },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["automation-policy"] });
      setDraft(null);
      toast.success("Políticas atualizadas.");
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar."),
  });

  const numberField = (
    id: keyof AutomationPolicySettings,
    label: string,
    help: string,
    step = 1,
  ) => (
    <div className="space-y-1.5">
      <Label htmlFor={String(id)}>{label}</Label>
      <Input
        id={String(id)}
        type="number"
        step={step}
        value={String(current[id] ?? "")}
        onChange={(event) =>
          setDraft({ ...current, [id]: Number(event.target.value) } as AutomationPolicySettings)
        }
      />
      <p className="text-xs text-muted-foreground">{help}</p>
    </div>
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="size-4 text-muted-foreground" />
          Políticas de automação
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5 text-sm">
        <div className="grid gap-4 sm:grid-cols-3">
          {numberField(
            "active_conversation_minutes",
            "Conversa ativa (min)",
            "Se o cliente escreveu neste intervalo, a automação espera.",
          )}
          {numberField(
            "manual_message_cooldown_minutes",
            "Após sua resposta (min)",
            "Tempo de silêncio depois de uma mensagem enviada por você.",
          )}
          {numberField(
            "conversation_cooldown_minutes",
            "Entre automações (min)",
            "Intervalo mínimo entre dois envios automáticos na mesma conversa.",
          )}
          {numberField(
            "max_automations_per_day",
            "Limite diário por cliente",
            "Máximo de mensagens automáticas por cliente em 24h.",
          )}
          {numberField(
            "max_flow_automations_per_day",
            "Limite diário por fluxo",
            "Máximo de etapas do mesmo fluxo em 24h.",
          )}
          {numberField(
            "confidence_auto_min",
            "Confiança p/ envio automático",
            "Abaixo disso o rascunho vai para aprovação.",
            0.05,
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          {numberField(
            "confidence_approval_min",
            "Confiança mínima p/ gerar",
            "Abaixo disso o caso é entregue para você resolver.",
            0.05,
          )}
        </div>

        <div className="rounded-lg border p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="flex items-center gap-2 font-medium">
                <TestTube2 className="size-4 text-muted-foreground" />
                Modo teste
              </p>
              <p className="text-xs text-muted-foreground">
                As decisões acontecem normalmente, mas nenhuma mensagem chega ao cliente.
              </p>
            </div>
            <Switch
              checked={current.test_mode}
              onCheckedChange={(value) => setDraft({ ...current, test_mode: value })}
            />
          </div>
          {current.test_mode ? (
            <div className="mt-3 space-y-1.5 sm:max-w-[260px]">
              <Label htmlFor="test-phone">Número de teste (opcional)</Label>
              <Input
                id="test-phone"
                value={current.test_mode_phone ?? ""}
                placeholder="+55 11 90000-0000"
                onChange={(event) =>
                  setDraft({ ...current, test_mode_phone: event.target.value || null })
                }
              />
            </div>
          ) : null}
        </div>

        <Button
          size="sm"
          disabled={!draft || save.isPending}
          onClick={() => draft && save.mutate(draft)}
        >
          {save.isPending ? "Salvando..." : "Salvar políticas"}
        </Button>
      </CardContent>
    </Card>
  );
}

function DecisionLog() {
  const decisions = useQuery(decisionsQuery());

  if (decisions.isPending) return <LoadingState />;
  if (!decisions.data?.length) {
    return (
      <EmptyState
        title="Nenhuma decisão registrada ainda"
        description="Toda vez que uma automação for avaliada, o motivo aparece aqui."
      />
    );
  }

  return (
    <div className="space-y-3">
      {decisions.data.map((decision) => (
        <Card key={decision.id}>
          <CardContent className="space-y-2 p-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={DECISION_VARIANT[decision.decision]}>
                {DECISION_LABELS[decision.decision]}
              </Badge>
              <span className="font-medium">{decision.contact_name ?? "Cliente sem vínculo"}</span>
              <span className="text-xs text-muted-foreground">
                {formatDateTime(decision.created_at)}
              </span>
              {decision.confidence != null ? (
                <Badge variant="outline">confiança {decision.confidence.toFixed(2)}</Badge>
              ) : null}
            </div>
            <p className="text-muted-foreground">{decision.reason}</p>
            {decision.rules.length ? (
              <ul className="flex flex-wrap gap-1.5">
                {decision.rules.map((rule) => (
                  <li
                    key={rule.rule}
                    className={
                      rule.passed
                        ? "rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                        : "rounded-md bg-destructive/10 px-2 py-0.5 text-xs text-destructive"
                    }
                    title={rule.detail ?? rule.label}
                  >
                    {rule.label}
                  </li>
                ))}
              </ul>
            ) : null}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function AutomationPage() {
  const policy = useQuery(policyQuery());

  return (
    <AppShell
      title="Orquestrador"
      description="Quando o sistema pode agir sozinho, quando ele espera e por quê."
    >
      <div className="space-y-6">
        {policy.isPending || !policy.data ? (
          <LoadingState />
        ) : (
          <>
            <EmergencyCard policy={policy.data} />
            <PolicyForm policy={policy.data} />
          </>
        )}

        <section className="space-y-3">
          <h2 className="text-base font-semibold">Histórico de decisões</h2>
          <DecisionLog />
        </section>
      </div>
    </AppShell>
  );
}
