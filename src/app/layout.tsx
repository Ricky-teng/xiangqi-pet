import "./globals.css";
import type { Metadata, Viewport } from "next";
import AuthProvider from "@/components/AuthProvider";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";

export const metadata: Metadata = {
  title: "象棋小雞",
  description: "解開象棋殘局，養大你的小雞夥伴！",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "象棋小雞",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#E8B84B",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh-TW">
      <body>
        <AuthProvider>{children}</AuthProvider>
        <ServiceWorkerRegister />
      </body>
    </html>
  )
}
