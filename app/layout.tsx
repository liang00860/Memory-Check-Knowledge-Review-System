import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "忆检｜本地知识考察与科学复习",
  description:
    "在浏览器本地提取 PDF 与 DOCX 标红知识点，导入今日 ChatGPT/Codex 学习记录，生成自定题量的选择题专项卷，并按遗忘曲线复习。",
  openGraph: {
    title: "忆检｜把标红的知识变成下一题",
    description: "本地提取标红知识点，导入今日学习记录，生成选择题专项卷并科学复习。",
    type: "website",
    images: [
      {
        url: "/og.png",
        width: 1731,
        height: 909,
        alt: "忆检本地学习系统的红黑米白几何视觉",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "忆检｜把标红的知识变成下一题",
    description: "本地提取标红知识点，导入今日学习记录，生成选择题专项卷并科学复习。",
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
