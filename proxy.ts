import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Next.js 16: middleware → proxy
// /admin/* 경로 + /api/admin/sessions* 경로를 비밀번호 쿠키로 보호.
// /api/admin/login만 예외.

const PUBLIC_ADMIN_PATHS = ['/admin/login', '/api/admin/login'];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // admin 경로가 아니면 통과
  const isAdminPath =
    pathname.startsWith('/admin') || pathname.startsWith('/api/admin');
  if (!isAdminPath) return NextResponse.next();

  // 로그인 페이지/엔드포인트는 public
  if (PUBLIC_ADMIN_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next();
  }

  const cookie = request.cookies.get('admin-session');
  const expected = process.env.ADMIN_PASSWORD;

  if (!expected || !cookie || cookie.value !== expected) {
    // API 호출이면 401 JSON, 그 외에는 로그인 페이지로 redirect
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const loginUrl = new URL('/admin/login', request.url);
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*', '/api/admin/:path*'],
};
