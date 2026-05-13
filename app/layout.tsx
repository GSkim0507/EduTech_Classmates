import type { Metadata } from 'next';
import './globals.css';
import ToastViewport from '@/components/Toast';
import BrandHeader from '@/components/BrandHeader';

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
        {/* next/font/google의 subsets에 'korean'이 없어 한글 글리프가 빠지므로 직접 로드 유지 */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Gowun+Dodum&family=Jua&display=swap"
        />
      </head>
      <body className="min-h-full flex flex-col pt-16">
        <BrandHeader />
        {children}
        <ToastViewport />
      </body>
    </html>
  );
}
