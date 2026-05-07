import { Badge } from "@/components/ui/badge";
import type { JobStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

export function StatusBadge({ status, className }: { status: JobStatus; className?: string }) {
  const map: Record<JobStatus, { label: string; variant: "default" | "secondary" | "destructive" | "success" | "warning" | "outline" }> = {
    running:   { label: "running",   variant: "warning" },
    done:      { label: "done",      variant: "success" },
    error:     { label: "error",     variant: "destructive" },
    cancelled: { label: "cancelled", variant: "secondary" },
  };
  const { label, variant } = map[status];
  return <Badge variant={variant} className={cn("uppercase text-[10px] tracking-wider", className)}>{label}</Badge>;
}
