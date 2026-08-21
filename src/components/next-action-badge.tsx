import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/domain/datetime";
import { classifyNextAction, NEXT_ACTION_LABELS } from "@/lib/domain/next-action";
import { cn } from "@/lib/utils";

const STATE_CLASSES = {
  missing: "border-transparent bg-muted text-muted-foreground",
  overdue: "border-transparent bg-destructive text-destructive-foreground",
  today: "border-transparent bg-warning text-warning-foreground",
  upcoming: "border-transparent bg-secondary text-secondary-foreground",
} as const;

export function NextActionBadge({
  nextActionAt,
  withDate = false,
  className,
}: {
  nextActionAt: string | null;
  withDate?: boolean;
  className?: string;
}) {
  const state = classifyNextAction(nextActionAt);
  const label =
    withDate && nextActionAt
      ? `${NEXT_ACTION_LABELS[state]} · ${formatDateTime(nextActionAt)}`
      : NEXT_ACTION_LABELS[state];

  return <Badge className={cn(STATE_CLASSES[state], className)}>{label}</Badge>;
}
