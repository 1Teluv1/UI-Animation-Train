import type { Metadata } from "next";
import { Toaster } from "sonner";
import { Nav } from "@/components/nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "UI-Animation-Train Console",
  description: "Local Wan2.2 LoRA dataset & training console",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-background text-foreground antialiased">
        <div className="flex min-h-screen">
          <Nav />
          <main className="flex-1 overflow-auto">
            <div className="mx-auto max-w-7xl p-6 md:p-8">{children}</div>
          </main>
        </div>
        <Toaster theme="dark" position="bottom-right" richColors />
      </body>
    </html>
  );
}
