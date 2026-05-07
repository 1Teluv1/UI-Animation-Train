"use client";

import { useState } from "react";
import useSWR from "swr";
import { Search, Library, LayoutGrid, List } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { VideoGrid } from "@/components/video-grid";
import { MetadataTable } from "@/components/metadata-table";
import { ASSET_TYPES, type MetadataRecord } from "@/lib/types";

const fetcher = (u: string) => fetch(u).then((r) => r.json());

interface ListResp {
  items: MetadataRecord[];
  total: number;
  page: number;
  pageSize: number;
}

export default function DatasetPage() {
  const [page, setPage] = useState(1);
  const pageSize = 24;
  const [category, setCategory] = useState<string>("__all__");
  const [source, setSource] = useState<string>("__all__");
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"grid" | "table">("grid");

  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (category !== "__all__") params.set("category", category);
  if (source !== "__all__") params.set("source", source);
  if (search) params.set("search", search);

  const { data, isLoading } = useSWR<ListResp>(`/api/dataset/list?${params.toString()}`, fetcher, {
    keepPreviousData: true,
  });
  const totalPages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Library className="h-5 w-5" />
          Dataset Browser
        </h1>
        <p className="text-sm text-muted-foreground">
          Filter, preview, and inspect everything in <code className="font-mono text-xs">dataset/metadata.jsonl</code>.
        </p>
      </header>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm">Filters</CardTitle></CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-[1fr_180px_180px_120px]">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder="Search subject or caption…"
                className="pl-8"
              />
            </div>
            <Select value={category} onValueChange={(v) => { setCategory(v); setPage(1); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All categories</SelectItem>
                {ASSET_TYPES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={source} onValueChange={(v) => { setSource(v); setPage(1); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All sources</SelectItem>
                <SelectItem value="lm_studio">LM Studio</SelectItem>
                <SelectItem value="fallback_template">Fallback</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex gap-1">
              <Button variant={view === "grid" ? "default" : "outline"} size="icon" onClick={() => setView("grid")}>
                <LayoutGrid className="h-4 w-4" />
              </Button>
              <Button variant={view === "table" ? "default" : "outline"} size="icon" onClick={() => setView("table")}>
                <List className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="text-xs text-muted-foreground">
        {isLoading ? "Loading…" : `${data?.total ?? 0} samples · page ${page} / ${totalPages}`}
      </div>

      {view === "grid" ? (
        <VideoGrid items={data?.items ?? []} />
      ) : (
        <MetadataTable items={data?.items ?? []} />
      )}

      <div className="flex items-center justify-between gap-2 pt-4">
        <Button variant="outline" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>← Prev</Button>
        <span className="text-xs text-muted-foreground">page {page} / {totalPages}</span>
        <Button variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next →</Button>
      </div>
    </div>
  );
}
