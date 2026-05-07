"use client";

import { cn } from "@/lib/utils";

function fileFromVideoRel(rel: string): { type: string; name: string } {
  const norm = rel.replace(/\\/g, "/");
  const parts = norm.split("/");
  const name = parts[parts.length - 1];
  const type = parts.length > 1 ? parts[parts.length - 2] : "videos";
  return { type, name };
}

export function videoUrlFor(rel: string): string {
  const { type, name } = fileFromVideoRel(rel);
  return `/api/dataset/file/${encodeURIComponent(type)}/${encodeURIComponent(name)}`;
}

export function VideoPlayer({
  src,
  className,
  autoPlay = true,
  loop = true,
  muted = true,
  controls = true,
}: {
  src: string;
  className?: string;
  autoPlay?: boolean;
  loop?: boolean;
  muted?: boolean;
  controls?: boolean;
}) {
  return (
    <video
      src={src}
      className={cn("w-full h-auto rounded-md bg-black", className)}
      autoPlay={autoPlay}
      loop={loop}
      muted={muted}
      controls={controls}
      playsInline
    />
  );
}
