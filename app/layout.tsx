import type { Metadata } from "next";
import "./globals.css";

const publicBasePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

export const metadata: Metadata = {
  title: "Wallpaper Still｜网页壁纸静态导出器",
  description: "导入 Wallpaper Engine 网页项目，自定义构图并导出高分辨率静态壁纸。",
  icons: { icon: `${publicBasePath}/favicon.png` },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
