import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { AssetFormDialog } from "@/components/library/asset-form-dialog";
import { DraftReviewList } from "@/components/library/draft-review-list";
import { StrategyFormDialog } from "@/components/library/strategy-form-dialog";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDateTime } from "@/lib/domain/datetime";
import {
  deleteContentAsset,
  deleteMessageStrategy,
  seedStrategies,
} from "@/lib/library.functions";
import { assetsQuery, libraryKeys, strategiesQuery } from "@/lib/library.queries";
import type { ContentAsset, MessageStrategy } from "@/lib/library/api-types";
import {
  assetTypeLabels,
  autonomyLabels,
  forbiddenBehaviorLabel,
} from "@/lib/library/labels";

export const Route = createFileRoute("/_authenticated/biblioteca")({
  head: () => ({
    meta: [
      { title: "Biblioteca estratégica | Próximo Passo" },
      {
        name: "description",
        content:
          "Guarde materiais comerciais, defina estratégias de mensagem e aprove os textos gerados pela IA antes do envio.",
      },
      { property: "og:title", content: "Biblioteca estratégica | Próximo Passo" },
      {
        property: "og:description",
        content:
          "Materiais, estratégias de mensagem e fila de aprovação das mensagens geradas por IA.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LibraryPage,
});

function LibraryPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const assets = useQuery(assetsQuery({ search }));
  const strategies = useQuery(strategiesQuery());

  const [assetDialogOpen, setAssetDialogOpen] = useState(false);
  const [editingAsset, setEditingAsset] = useState<ContentAsset | null>(null);
  const [strategyDialogOpen, setStrategyDialogOpen] = useState(false);
  const [editingStrategy, setEditingStrategy] = useState<MessageStrategy | null>(null);
  const [assetToDelete, setAssetToDelete] = useState<ContentAsset | null>(null);
  const [strategyToDelete, setStrategyToDelete] = useState<MessageStrategy | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: libraryKeys.root });

  const seedMutation = useMutation({
    mutationFn: () => seedStrategies(),
    onSuccess: async (result) => {
      await invalidate();
      toast.success(
        result.created > 0
          ? `${result.created} estratégias sugeridas criadas.`
          : "Você já tem as estratégias sugeridas.",
      );
    },
    onError: () => toast.error("Não foi possível criar as estratégias sugeridas."),
  });

  const deleteAssetMutation = useMutation({
    mutationFn: (assetId: string) => deleteContentAsset({ data: { assetId } }),
    onSuccess: async () => {
      await invalidate();
      setAssetToDelete(null);
      toast.success("Material removido.");
    },
    onError: () => toast.error("Não foi possível remover o material."),
  });

  const deleteStrategyMutation = useMutation({
    mutationFn: (strategyId: string) => deleteMessageStrategy({ data: { strategyId } }),
    onSuccess: async () => {
      await invalidate();
      setStrategyToDelete(null);
      toast.success("Estratégia removida.");
    },
    onError: () => toast.error("Não foi possível remover a estratégia."),
  });

  return (
    <AppShell
      title="Biblioteca estratégica"
      description="Seus materiais comerciais e as regras que a IA segue para escrever mensagens."
    >
      <div className="space-y-6">


        <Tabs defaultValue="materiais">
          <TabsList>
            <TabsTrigger value="materiais">Materiais</TabsTrigger>
            <TabsTrigger value="estrategias">Estratégias</TabsTrigger>
            <TabsTrigger value="aprovacao">Para aprovar</TabsTrigger>
            <TabsTrigger value="historico">Histórico</TabsTrigger>
          </TabsList>

          <TabsContent value="materiais" className="mt-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Input
                className="max-w-xs"
                placeholder="Buscar material"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <Button
                onClick={() => {
                  setEditingAsset(null);
                  setAssetDialogOpen(true);
                }}
              >
                <Plus className="mr-2 size-4" />
                Novo material
              </Button>
            </div>

            {assets.isLoading ? (
              <LoadingState />
            ) : assets.isError ? (
              <ErrorState onRetry={() => assets.refetch()} />
            ) : (assets.data ?? []).length === 0 ? (
              <EmptyState
                title="Nenhum material cadastrado"
                description="Adicione áudios, textos, imagens e documentos que você já usa no dia a dia comercial."
              />
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {(assets.data ?? []).map((asset) => (
                  <Card key={asset.id}>
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-2">
                        <CardTitle className="text-base">{asset.name}</CardTitle>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Editar material"
                            onClick={() => {
                              setEditingAsset(asset);
                              setAssetDialogOpen(true);
                            }}
                          >
                            <Pencil className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Remover material"
                            onClick={() => setAssetToDelete(asset)}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2 pt-1">
                        <Badge variant="secondary">{assetTypeLabels[asset.type]}</Badge>
                        {!asset.is_active ? <Badge variant="outline">Inativo</Badge> : null}
                        {asset.tags.map((tag) => (
                          <Badge key={tag} variant="outline">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-1 text-sm text-muted-foreground">
                      {asset.purpose ? <p>{asset.purpose}</p> : null}
                      {asset.body ? (
                        <p className="line-clamp-3 whitespace-pre-wrap">{asset.body}</p>
                      ) : null}
                      {asset.filename ? <p className="text-xs">{asset.filename}</p> : null}
                      <p className="text-xs">Atualizado em {formatDateTime(asset.updated_at)}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="estrategias" className="mt-4 space-y-4">
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => seedMutation.mutate()}
                disabled={seedMutation.isPending}
              >
                {seedMutation.isPending ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <Sparkles className="mr-2 size-4" />
                )}
                Criar estratégias sugeridas
              </Button>
              <Button
                onClick={() => {
                  setEditingStrategy(null);
                  setStrategyDialogOpen(true);
                }}
              >
                <Plus className="mr-2 size-4" />
                Nova estratégia
              </Button>
            </div>

            {strategies.isLoading ? (
              <LoadingState />
            ) : strategies.isError ? (
              <ErrorState onRetry={() => strategies.refetch()} />
            ) : (strategies.data ?? []).length === 0 ? (
              <EmptyState
                title="Nenhuma estratégia criada"
                description="Comece pelas estratégias sugeridas e ajuste o tom e as regras ao seu jeito de vender."
              />
            ) : (
              <div className="space-y-3">
                {(strategies.data ?? []).map((strategy) => (
                  <Card key={strategy.id}>
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <CardTitle className="text-base">{strategy.name}</CardTitle>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {strategy.objective}
                          </p>
                        </div>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Editar estratégia"
                            onClick={() => {
                              setEditingStrategy(strategy);
                              setStrategyDialogOpen(true);
                            }}
                          >
                            <Pencil className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Remover estratégia"
                            onClick={() => setStrategyToDelete(strategy)}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2 pt-2">
                        <Badge variant="secondary">
                          {autonomyLabels[strategy.autonomy_mode]}
                        </Badge>
                        <Badge variant="outline">versão {strategy.version}</Badge>
                        {!strategy.is_active ? <Badge variant="outline">Inativa</Badge> : null}
                        {strategy.allowed_asset_types.map((type) => (
                          <Badge key={type} variant="outline">
                            {assetTypeLabels[type]}
                          </Badge>
                        ))}
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-1 text-sm text-muted-foreground">
                      <p>Tom: {strategy.tone}</p>
                      {strategy.when_to_use ? <p>Quando usar: {strategy.when_to_use}</p> : null}
                      {strategy.forbidden_behaviors.length > 0 ? (
                        <p className="text-xs">
                          Proibido:{" "}
                          {strategy.forbidden_behaviors
                            .map((item) => forbiddenBehaviorLabel(item))
                            .join(" · ")}
                        </p>
                      ) : null}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="aprovacao" className="mt-4">
            <DraftReviewList status={null} />
          </TabsContent>

          <TabsContent value="historico" className="mt-4">
            <DraftReviewList status="sent" />
          </TabsContent>
        </Tabs>
      </div>

      <AssetFormDialog
        open={assetDialogOpen}
        onOpenChange={setAssetDialogOpen}
        asset={editingAsset}
      />
      <StrategyFormDialog
        open={strategyDialogOpen}
        onOpenChange={setStrategyDialogOpen}
        strategy={editingStrategy}
      />

      <AlertDialog
        open={Boolean(assetToDelete)}
        onOpenChange={(open) => !open && setAssetToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover material?</AlertDialogTitle>
            <AlertDialogDescription>
              O material deixa de ser oferecido à IA. Mensagens já enviadas não são afetadas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => assetToDelete && deleteAssetMutation.mutate(assetToDelete.id)}
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={Boolean(strategyToDelete)}
        onOpenChange={(open) => !open && setStrategyToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover estratégia?</AlertDialogTitle>
            <AlertDialogDescription>
              Rascunhos já gerados continuam guardados com o nome e a versão usados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                strategyToDelete && deleteStrategyMutation.mutate(strategyToDelete.id)
              }
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
