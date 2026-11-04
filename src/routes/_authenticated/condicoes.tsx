import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/condicoes")({
  head: () => ({
    meta: [
      { title: "Condições e campanhas — Próximo Passo" },
      {
        name: "description",
        content: "Descontos e campanhas das operadoras que o agente usa no pós-cotação.",
      },
      { property: "og:title", content: "Condições e campanhas" },
      {
        property: "og:description",
        content: "Cadastre descontos, validade e prazo de emissão para o agente trabalhar.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ConditionsPage,
});

const KEY = ["commercial_conditions"];
const EMPTY = {
  operator: "",
  title: "",
  discount: "",
  audience: "",
  validUntil: "",
  issuance: "",
  notes: "",
};

function ConditionsPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState(EMPTY);
  const list = useQuery({
    queryKey: KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("commercial_conditions")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("commercial_conditions").insert({
        operator: form.operator.trim(),
        title: form.title.trim(),
        discount_percent: form.discount ? Number(form.discount) : null,
        audience: form.audience.trim() || null,
        valid_until: form.validUntil || null,
        issuance_days: form.issuance ? Number(form.issuance) : null,
        notes: form.notes.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setForm(EMPTY);
      toast.success("Condição cadastrada. O agente já passa a usar.");
      qc.invalidateQueries({ queryKey: KEY });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const update = useMutation({
    mutationFn: async (v: { id: string; is_active?: boolean; remove?: boolean }) => {
      const q = supabase.from("commercial_conditions");
      const { error } = v.remove
        ? await q.delete().eq("id", v.id)
        : await q.update({ is_active: v.is_active ?? true }).eq("id", v.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
    onError: (e: Error) => toast.error(e.message),
  });

  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const today = new Date().toISOString().slice(0, 10);

  return (
    <AppShell
      title="Condições e campanhas"
      description="O agente só oferece descontos cadastrados aqui, sempre citando a validade e o prazo de emissão."
    >
      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Nova condição</CardTitle>
            <CardDescription>Ex.: Amil · 40% nas 3 primeiras mensalidades</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (!form.operator.trim() || !form.title.trim()) {
                  toast.error("Informe a operadora e a condição.");
                  return;
                }
                create.mutate();
              }}
            >
              <Field label="Operadora">
                <Input
                  value={form.operator}
                  onChange={set("operator")}
                  placeholder="Amil, Bradesco, SulAmérica..."
                />
              </Field>
              <Field label="Condição">
                <Input
                  value={form.title}
                  onChange={set("title")}
                  placeholder="Desconto nas 3 primeiras mensalidades"
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Desconto (%)">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={form.discount}
                    onChange={set("discount")}
                  />
                </Field>
                <Field label="Válida até">
                  <Input type="date" value={form.validUntil} onChange={set("validUntil")} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Vale para">
                  <Input
                    value={form.audience}
                    onChange={set("audience")}
                    placeholder="PME, novas vidas..."
                  />
                </Field>
                <Field label="Emissão (dias)">
                  <Input type="number" min={0} value={form.issuance} onChange={set("issuance")} />
                </Field>
              </div>
              <Field label="Observações">
                <Input value={form.notes} onChange={set("notes")} />
              </Field>
              <Button type="submit" className="w-full" disabled={create.isPending}>
                {create.isPending ? "Salvando..." : "Cadastrar condição"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="space-y-3">
          {list.isLoading && <p className="text-muted-foreground text-sm">Carregando...</p>}
          {list.data?.length === 0 && (
            <p className="text-muted-foreground text-sm">
              Nenhuma condição ainda. Sem condições, o agente defende o valor do plano e não oferece
              desconto.
            </p>
          )}
          {list.data?.map((c) => {
            const expired = c.valid_until != null && c.valid_until < today;
            return (
              <Card key={c.id}>
                <CardContent className="flex items-start justify-between gap-4 p-4">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{c.operator}</span>
                      {c.discount_percent != null && <Badge>{c.discount_percent}% off</Badge>}
                      {expired && <Badge variant="destructive">Vencida</Badge>}
                      {!c.is_active && <Badge variant="secondary">Pausada</Badge>}
                    </div>
                    <p className="text-sm">{c.title}</p>
                    <p className="text-muted-foreground text-xs">
                      {[
                        c.audience && `Para ${c.audience}`,
                        c.valid_until && `Até ${c.valid_until.split("-").reverse().join("/")}`,
                        c.issuance_days != null && `Emissão em ${c.issuance_days} dia(s)`,
                        c.notes,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={c.is_active}
                      onCheckedChange={(v) => update.mutate({ id: c.id, is_active: v })}
                      aria-label="Ativa"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Excluir"
                      onClick={() => update.mutate({ id: c.id, remove: true })}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
