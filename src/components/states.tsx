import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export function LoadingState({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }).map((_, index) => (
        <Skeleton key={index} className="h-16 w-full rounded-lg" />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed px-6 py-12 text-center">
      <p className="font-medium">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{description}</p>
      {action ? <div className="mt-6 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = "Não foi possível carregar estes dados",
  description = "Verifique sua conexão e tente novamente.",
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="rounded-lg border px-6 py-10 text-center">
      <AlertTriangle className="mx-auto size-5 text-muted-foreground" />
      <p className="mt-3 font-medium">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{description}</p>
      {onRetry ? (
        <Button variant="outline" className="mt-6" onClick={onRetry}>
          Tentar novamente
        </Button>
      ) : null}
    </div>
  );
}
