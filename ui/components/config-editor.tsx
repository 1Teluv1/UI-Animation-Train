"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

const Monaco = dynamic(() => import("@monaco-editor/react").then((m) => m.default), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-muted-foreground gap-2 text-sm">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading editor…
    </div>
  ),
});

export function ConfigEditor({
  value,
  onChange,
  language = "yaml",
  height = 480,
}: {
  value: string;
  onChange: (next: string) => void;
  language?: string;
  height?: number;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  if (!mounted) {
    return <div style={{ height }} className="rounded-md border bg-black/40" />;
  }
  return (
    <div style={{ height }} className="rounded-md border overflow-hidden">
      <Monaco
        value={value}
        language={language}
        theme="vs-dark"
        options={{
          fontSize: 13,
          minimap: { enabled: false },
          tabSize: 2,
          wordWrap: "on",
          scrollBeyondLastLine: false,
          renderLineHighlight: "gutter",
        }}
        onChange={(v) => onChange(v ?? "")}
      />
    </div>
  );
}
