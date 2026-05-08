import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const FILES = [
  '헌법_공통.html',
  '헌법_서론.html',
  '헌법_본론.html',
  '헌법_결론.html',
];

const dir = path.join(projectRoot, 'data', 'curriculum');

function htmlToMd(html) {
  // 1. style/script/head 블록 제거
  let s = html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<head[\s\S]*?<\/head>/gi, '');

  // 2. 헤딩 처리 (h1~h4 → ## / ### / ####)
  s = s.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, c) => `\n\n# ${stripTags(c).trim()}\n\n`);
  s = s.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, c) => `\n\n## ${stripTags(c).trim()}\n\n`);
  s = s.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, c) => `\n\n### ${stripTags(c).trim()}\n\n`);
  s = s.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, (_, c) => `\n\n#### ${stripTags(c).trim()}\n\n`);

  // 3. 표 → 마크다운 표
  s = s.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_, body) => convertTable(body));

  // 4. 리스트
  s = s.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, c) => `- ${stripTags(c).trim()}\n`);

  // 5. div / p → 줄바꿈
  s = s.replace(/<\/(p|div)>/gi, '\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');

  // 6. 강조
  s = s.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**');
  s = s.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*');

  // 7. 나머지 태그 제거
  s = stripTags(s);

  // 8. HTML entity
  s = decodeEntities(s);

  // 9. 공백 정리
  s = s.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+/g, ' ').replace(/[ \t]*\n[ \t]*/g, '\n');
  return s.trim();
}

function stripTags(html) {
  return String(html).replace(/<[^>]+>/g, ' ');
}

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&[a-z]+;/gi, ' ');
}

function convertTable(tableBody) {
  // <thead>...<tbody> 또는 그냥 <tr> 모음
  const trs = [...tableBody.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => m[1]);
  if (trs.length === 0) return '';

  const rows = trs.map((tr) => {
    const cells = [...tr.matchAll(/<(th|td)[^>]*>([\s\S]*?)<\/\1>/gi)].map((m) =>
      decodeEntities(stripTags(m[2])).replace(/\s+/g, ' ').trim()
    );
    return cells;
  });

  if (rows.length === 0) return '';

  const colCount = Math.max(...rows.map((r) => r.length));
  const norm = rows.map((r) => {
    while (r.length < colCount) r.push('');
    return r;
  });

  const header = norm[0];
  const sep = header.map(() => '---');
  const body = norm.slice(1);

  const lines = [
    `| ${header.join(' | ')} |`,
    `| ${sep.join(' | ')} |`,
    ...body.map((r) => `| ${r.join(' | ')} |`),
  ];
  return '\n\n' + lines.join('\n') + '\n\n';
}

let totalChars = 0;
for (const file of FILES) {
  const inPath = path.join(dir, file);
  const html = fs.readFileSync(inPath, 'utf-8');
  const md = htmlToMd(html);
  const outPath = path.join(dir, file.replace('.html', '.md'));
  fs.writeFileSync(outPath, md, 'utf-8');
  totalChars += md.length;
  console.log(`✓ ${path.basename(outPath)} (${md.length} chars)`);
}
console.log(`\n총 ${totalChars}자 변환 완료.`);
