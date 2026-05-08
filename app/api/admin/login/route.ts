import { NextResponse } from 'next/server';

interface LoginBody {
  password: string;
}

// POST /api/admin/login — 관리자 비밀번호 검증 + httpOnly 쿠키 설정
export async function POST(request: Request) {
  let body: LoginBody;
  try {
    body = (await request.json()) as LoginBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    return NextResponse.json(
      { error: 'ADMIN_PASSWORD가 서버에 설정되지 않았습니다.' },
      { status: 500 }
    );
  }

  if (!body.password || body.password !== expected) {
    return NextResponse.json({ error: '비밀번호가 틀렸습니다.' }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: 'admin-session',
    value: expected,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 8, // 8시간
    secure: process.env.NODE_ENV === 'production',
  });
  return res;
}

// DELETE /api/admin/login — 로그아웃
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: 'admin-session',
    value: '',
    httpOnly: true,
    path: '/',
    maxAge: 0,
  });
  return res;
}
