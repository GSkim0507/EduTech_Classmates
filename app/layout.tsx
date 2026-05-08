import type { Metadata } from 'next';
import './globals.css';
import ToastViewport from '@/components/Toast';

export const metadata: Metadata = {
  title: 'The Annoying Friend — 깐깐한 친구와 함께 글쓰기',
  description: '한국 초등 4–6학년 주장 글쓰기 학습용 AI 학습 동료',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="h-full antialiased">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Gowun+Dodum&family=Jua&display=swap"
        />
      </head>
      <body className="min-h-full flex flex-col">
        {children}
        <ToastViewport />
      </body>
    </html>
  );
}
