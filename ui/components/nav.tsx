"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Sparkles,
  Library,
  ListChecks,
  ShieldCheck,
  Cpu,
  Wand2,
} from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/generate", label: "Generate", icon: Sparkles, badge: "Phase 1" },
  { href: "/dataset", label: "Dataset", icon: Library },
  { href: "/preprocess", label: "Preprocess", icon: ListChecks, badge: "Phase 2" },
  { href: "/quality", label: "Quality", icon: ShieldCheck },
  { href: "/train", label: "Train LoRA", icon: Cpu, badge: "Phase 3" },
  { href: "/inference", label: "Inference", icon: Wand2 },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <aside className="hidden md:flex md:w-64 shrink-0 flex-col border-r border-border bg-card/40 p-4">
      <div className="flex items-center gap-2 px-2 py-3">
        <div className="h-8 w-8 rounded-md bg-primary/20 flex items-center justify-center">
          <Sparkles className="h-4 w-4 text-primary" />
        </div>
        <div className="leading-tight">
          <div className="text-sm font-semibold">UI-Animation-Train</div>
          <div className="text-xs text-muted-foreground">Wan2.2 LoRA Console</div>
        </div>
      </div>
      <nav className="mt-4 flex flex-col gap-1">
        {items.map((it) => {
          const Icon = it.icon;
          const active = pathname === it.href || (it.href !== "/" && pathname.startsWith(it.href));
          return (
            <Link
              key={it.href}
              href={it.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-primary/15 text-primary-foreground/90 font-medium"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              <span className="flex-1">{it.label}</span>
              {it.badge && (
                <span className="text-[10px] uppercase tracking-wider rounded bg-secondary px-1.5 py-0.5 text-secondary-foreground/70">
                  {it.badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto px-3 py-2 text-[11px] text-muted-foreground">
        Local console · 127.0.0.1:3000
      </div>
    </aside>
  );
}
