import { NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { db, now } from '@/lib/db';
import type { CreateSessionInput } from '@/lib/types';

// POST /api/sessions — 새 세션 생성
export async function POST(request: Request) {
  let body: CreateSessionInput;
  try {
    body = (await request.json()) as CreateSessionInput;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { personaName, grade, topic } = body;
  if (!personaName?.trim() || !grade || !topic?.trim()) {
    return NextResponse.json(
      { error: '별명, 학년, 주제는 모두 필수입니다.' },
      { status: 400 }
    );
  }

  if (grade < 4 || grade > 6) {
    return NextResponse.json(
      { error: '학년은 4–6 사이여야 합니다.' },
      { status: 400 }
    );
  }

  const id = nanoid(12);
  const ts = now();

  await db.execute({
    sql: `INSERT INTO sessions
            (id, persona_name, grade, topic, started_at, last_updated, status, current_phase)
          VALUES (?, ?, ?, ?, ?, ?, 'active', 'intro')`,
    args: [id, personaName.trim(), grade, topic.trim(), ts, ts],
  });

  return NextResponse.json({ id });
}
