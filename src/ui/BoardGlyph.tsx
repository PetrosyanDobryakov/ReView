import { memo, type ReactNode } from 'react';

// Procedural mini-board thumbnail. The board name picks the scene (sprint -> kanban,
// architecture -> flowchart, moodboard -> tiles, ...); the board id seeds every
// layout choice and color, so each board keeps its own picture.

function seedOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

type Rng = () => number;

function rng(seed: number): Rng {
  let a = seed || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const S = 40;
const f = (n: number) => Math.round(n * 10) / 10;
const pick = <T,>(r: Rng, list: readonly T[]): T => list[Math.floor(r() * list.length)]!;
const between = (r: Rng, a: number, b: number) => a + r() * (b - a);
const int = (r: Rng, a: number, b: number) => Math.floor(between(r, a, b + 1));

export type GlyphScene = 'kanban' | 'flow' | 'mood' | 'timeline' | 'mind' | 'chart' | 'math' | 'wire' | 'notes' | 'sketch';

// Substring match against the lowercased name; `=word` matches a whole word only
// (short tokens that would otherwise hit inside unrelated words). First scene wins.
const KEYWORDS: Array<[GlyphScene, string[]]> = [
  ['timeline', ['roadmap', 'роадмап', 'дорожн', 'timeline', 'таймлайн', 'onboard', 'онборд', 'release', 'релиз', 'history', 'истори', 'milestone', 'этап', 'launch', 'запуск', '路线', '时间线', '入职', '里程碑']],
  ['kanban', ['sprint', 'спринт', 'kanban', 'канбан', 'task', 'задач', 'todo', 'backlog', 'бэклог', 'retro', 'ретро', 'plan', 'план', 'standup', 'стендап', 'scrum', 'скрам', '任务', '计划', '看板', '复盘', '冲刺']],
  ['flow', ['architect', 'архитект', 'схем', 'scheme', 'schema', 'diagram', 'диаграм', 'flow', 'поток', 'процесс', 'process', '=бд', '=db', 'database', 'базы данных', '=sql', '=api', 'system', 'систем', 'infra', 'инфра', 'pipeline', 'пайплайн', '架构', '流程', '数据库', '系统']],
  ['mood', ['mood', 'мудборд', 'design', 'дизайн', 'landing', 'лендинг', 'brand', 'бренд', 'style', 'стиль', '=art', '=арт', 'photo', 'фото', 'inspir', 'вдохнов', 'reference', 'референс', 'palette', 'палитр', 'logo', 'лого', '设计', '灵感', '品牌']],
  ['mind', ['idea', 'идея', 'идеи', 'идей', 'brainstorm', 'брейншторм', 'мозгов', 'mindmap', '=mind', 'ментальн', '=map', 'карта', 'concept', 'концепт', 'research', 'исследов', '想法', '头脑', '思维', '脑图']],
  ['chart', ['metric', 'метрик', 'analytic', 'аналит', 'report', 'отчет', 'отчёт', '=kpi', 'stats', 'статист', 'sales', 'продаж', 'budget', 'бюджет', 'financ', 'финанс', 'revenue', 'выручк', 'dashboard', 'дашборд', 'growth', '数据', '报告', '统计', '预算']],
  ['math', ['math', 'матем', 'алгебр', 'algebra', 'геометр', 'geometr', 'calc', 'калькул', 'формул', 'formula', 'graph', 'график', 'физик', 'physic', 'function', 'функци', 'уравнен', 'equation', '数学', '函数', '物理', '方程']],
  ['wire', ['wireframe', 'вайрфрейм', 'prototype', 'прототип', '=app', 'прилож', 'screen', 'экран', 'website', '=site', 'сайт', 'mockup', 'макет', '=ui', '=ux', 'interface', 'интерфейс', 'mobile', 'мобил', '原型', '界面', '网站', '应用']],
  ['notes', ['note', 'замет', 'конспект', 'lecture', 'лекци', 'урок', 'lesson', 'meeting', 'встреч', 'созвон', '=call', '=doc', 'docs', 'документ', 'agenda', 'повестк', 'summary', 'итог', 'class', 'занят', 'homework', 'домашк', '笔记', '会议', '课', '作业']],
];

export function sceneForName(name: string): GlyphScene | null {
  const lower = name.toLocaleLowerCase();
  const words = new Set(lower.split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  for (const [scene, keys] of KEYWORDS) {
    for (const k of keys) {
      if (k.startsWith('=') ? words.has(k.slice(1)) : lower.includes(k)) return scene;
    }
  }
  return null;
}

const SCENES: GlyphScene[] = ['kanban', 'flow', 'mood', 'timeline', 'mind', 'chart', 'math', 'wire', 'notes'];
const FILLS = ['f1', 'f2', 'f3'] as const;
const STROKES = ['s1', 's2', 's3'] as const;

type Draw = { n: ReactNode[]; k: number };
function add(d: Draw, el: (key: number) => ReactNode) {
  d.n.push(el(d.k++));
}
function P(d: Draw, cls: string, path: string) {
  add(d, (key) => <path key={key} className={cls} d={path} />);
}
function R(d: Draw, cls: string, x: number, y: number, w: number, h: number, rx = 1.5) {
  add(d, (key) => <rect key={key} className={cls} x={f(x)} y={f(y)} width={f(w)} height={f(h)} rx={rx} />);
}
function C(d: Draw, cls: string, cx: number, cy: number, rad: number) {
  add(d, (key) => <circle key={key} className={cls} cx={f(cx)} cy={f(cy)} r={f(rad)} />);
}
function sticky(d: Draw, r: Rng, x: number, y: number, w: number, h: number, tilt = 0) {
  const cls = pick(r, FILLS);
  add(d, (key) => (
    <g key={key} transform={tilt ? `rotate(${f(tilt)} ${f(x + w / 2)} ${f(y + h / 2)})` : undefined}>
      <rect className={cls} x={f(x)} y={f(y)} width={f(w)} height={f(h)} rx="1.2" />
      {w > 8 ? <path className="fold" d={`M${f(x + w - 3)} ${f(y + h)}l3 -3v3z`} /> : null}
    </g>
  ));
}
function squiggle(r: Rng, x0: number, x1: number, y: number, amp: number, n = int(r, 3, 4)): string {
  let prev: [number, number] = [x0, y + (r() - 0.5) * amp];
  let d = `M${f(prev[0])} ${f(prev[1])}`;
  for (let i = 1; i <= n; i++) {
    const p: [number, number] = [x0 + (i / n) * (x1 - x0), y + (r() - 0.5) * amp];
    const mx = (prev[0] + p[0]) / 2;
    d += `C${f(mx)} ${f(prev[1])} ${f(mx)} ${f(p[1])} ${f(p[0])} ${f(p[1])}`;
    prev = p;
  }
  return d;
}
function textLines(d: Draw, r: Rng, x: number, y: number, w: number, count: number, gap = 4) {
  let path = '';
  for (let i = 0; i < count; i++) path += `M${f(x)} ${f(y + i * gap)}h${f(w * between(r, 0.45, 1))}`;
  P(d, 'ink thin', path);
}
function arrowHead(x: number, y: number, angle: number, size = 3.2): string {
  const a1 = angle + Math.PI * 0.8;
  const a2 = angle - Math.PI * 0.8;
  return `M${f(x + Math.cos(a1) * size)} ${f(y + Math.sin(a1) * size)}L${f(x)} ${f(y)}L${f(x + Math.cos(a2) * size)} ${f(y + Math.sin(a2) * size)}`;
}

const draw: Record<GlyphScene, (d: Draw, r: Rng) => void> = {
  kanban(d, r) {
    const cols = int(r, 2, 3);
    const gap = cols === 3 ? 2.5 : 3.5;
    const w = (30 - gap * (cols - 1)) / cols;
    for (let c = 0; c < cols; c++) {
      const x = 5 + c * (w + gap);
      R(d, 'faint', x, 5, w, 30, 2);
      P(d, 'ink thin', `M${f(x + 1.5)} 8.5h${f(w * between(r, 0.35, 0.65))}`);
      const n = int(r, c === cols - 1 ? 0 : 1, 3);
      const h = Math.min(w - 2, 6.5);
      for (let i = 0; i < n; i++) sticky(d, r, x + 1, 11.5 + i * (h + 1.6), w - 2, h, (r() - 0.5) * 8);
    }
  },
  flow(d, r) {
    const node = (x: number, y: number) => {
      const kind = pick(r, ['box', 'box', 'pill', 'diamond', 'db'] as const);
      const cls = `${pick(r, STROKES)} tint`;
      if (kind === 'diamond') P(d, cls, `M${f(x)} ${f(y - 5)}l5.5 5-5.5 5-5.5-5z`);
      else if (kind === 'db') P(d, cls, `M${f(x - 4.5)} ${f(y - 3)}v6a4.5 1.8 0 0 0 9 0v-6a4.5 1.8 0 0 0-9 0a4.5 1.8 0 0 0 9 0`);
      else R(d, cls, x - 5, y - 3.5, 10, 7, kind === 'pill' ? 3.5 : 1.5);
    };
    const link = (x0: number, y0: number, x1: number, y1: number) => {
      const ang = Math.atan2(y1 - y0, x1 - x0);
      P(d, 'ink thin', `M${f(x0)} ${f(y0)}L${f(x1)} ${f(y1)}${arrowHead(x1, y1, ang, 2.6)}`);
    };
    const variant = int(r, 0, 2);
    if (variant === 0) {
      // Tree: one root, two or three children.
      const kids = int(r, 2, 3);
      const rx = between(r, 16, 24);
      for (let i = 0; i < kids; i++) {
        const x = kids === 2 ? 11 + i * 18 : 8 + i * 12;
        link(rx, 14, x, 25);
        node(x, 30);
      }
      node(rx, 10);
    } else if (variant === 1) {
      // Zigzag chain.
      const y0 = between(r, 9, 13);
      const y1 = between(r, 9, 13);
      const x2 = between(r, 12, 28);
      link(15.5, y0, 24.5, y1);
      link(29, y1 + 4.5, x2 + 2, 25);
      node(10, y0);
      node(30, y1);
      node(x2, 29.5);
    } else {
      // Row with a branch down.
      const y = between(r, 11, 15);
      const bx = pick(r, [9, 31]);
      link(14.5, y, 25.5, y);
      link(bx, y + 4.5, bx, 25);
      node(9, y);
      node(31, y);
      node(bx, 30);
      textLines(d, r, bx === 9 ? 19 : 6, 27.5, 14, 2, 4);
    }
  },
  mood(d, r) {
    const cell = (x: number, y: number, w: number, h: number) => {
      const kind = pick(r, ['photo', 'photo', 'swatch', 'sticky', 'type'] as const);
      if (kind === 'photo') {
        const cls = pick(r, FILLS);
        R(d, `${cls} soft`, x, y, w, h, 1.8);
        const base = y + h;
        P(d, cls, `M${f(x)} ${f(base - 1.8)}L${f(x + w * 0.35)} ${f(y + h * 0.45)}L${f(x + w * 0.6)} ${f(y + h * 0.72)}L${f(x + w * 0.76)} ${f(y + h * 0.56)}L${f(x + w)} ${f(base - 2.5)}V${f(base - 1.8)}a1.8 1.8 0 0 1-1.8 1.8H${f(x + 1.8)}a1.8 1.8 0 0 1-1.8-1.8z`);
        C(d, 'paperf', x + w * 0.74, y + h * 0.27, Math.min(w, h) * 0.12);
      } else if (kind === 'swatch') {
        const n = w > 16 ? 4 : 3;
        const rad = Math.min(h * 0.28, (w / n) * 0.4);
        const off = int(r, 0, 2);
        for (let i = 0; i < n; i++) C(d, FILLS[(i + off) % 3]!, x + (w / n) * (i + 0.5), y + h / 2, rad);
      } else if (kind === 'sticky') {
        sticky(d, r, x + 1, y + 1, w - 2, h - 2, (r() - 0.5) * 10);
      } else {
        P(d, 'ink bold', `M${f(x + 1)} ${f(y + Math.min(h * 0.4, 5))}h${f(w * 0.6)}`);
        textLines(d, r, x + 1, y + Math.min(h * 0.4, 5) + 3.6, w - 2, h > 12 ? 3 : 1, 3.2);
      }
    };
    const layout = int(r, 0, 3);
    if (layout === 0) {
      cell(5, 5, 30, 14);
      cell(5, 21, 14, 14);
      cell(21, 21, 14, 14);
    } else if (layout === 1) {
      cell(5, 5, 14, 30);
      cell(21, 5, 14, 14);
      cell(21, 21, 14, 14);
    } else if (layout === 2) {
      cell(5, 5, 14, 14);
      cell(21, 5, 14, 14);
      cell(5, 21, 14, 14);
      cell(21, 21, 14, 14);
    } else {
      cell(5, 5, 19, 19);
      cell(26, 5, 9, 19);
      cell(5, 26, 30, 9);
    }
  },
  timeline(d, r) {
    const vertical = r() < 0.3;
    const n = int(r, 3, 5);
    const axis = between(r, 18, 22);
    if (vertical) P(d, 'ink', `M${f(axis - 8)} 6V34`);
    else P(d, 'ink', `M5 ${f(axis)}H34.5${arrowHead(34.5, axis, 0, 2.6)}`);
    const doneCount = int(r, 1, n);
    for (let i = 0; i < n; i++) {
      const t = 8 + (i / (n - 1)) * (vertical ? 24 : 22);
      const fill = i < doneCount ? pick(r, FILLS) : 'paperf ink thin';
      if (vertical) {
        C(d, fill, axis - 8, t, 2);
        textLines(d, r, axis - 3.5, t, between(r, 10, 20), 1);
      } else {
        C(d, fill, t, axis, 2);
        if (r() < 0.75) {
          const up = i % 2 === 0;
          P(d, 'ink thin', `M${f(t)} ${f(axis + (up ? -2.5 : 2.5))}v${up ? -3 : 3}`);
          sticky(d, r, t - 3.5, up ? axis - 12 : axis + 5.5, 7, 6.5, (r() - 0.5) * 10);
        }
      }
    }
  },
  mind(d, r) {
    const cx = between(r, 18, 22);
    const cy = between(r, 18, 22);
    const n = int(r, 3, 6);
    const start = r() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const a = start + (i / n) * Math.PI * 2 + (r() - 0.5) * 0.5;
      const len = between(r, 11, 14);
      const x = Math.max(6, Math.min(34, cx + Math.cos(a) * len));
      const y = Math.max(6, Math.min(34, cy + Math.sin(a) * len * 0.9));
      const bend = (r() - 0.5) * 8;
      const mx = (cx + x) / 2 - Math.sin(a) * bend;
      const my = (cy + y) / 2 + Math.cos(a) * bend;
      P(d, pick(r, ['ink thin', ...STROKES]), `M${f(cx)} ${f(cy)}Q${f(mx)} ${f(my)} ${f(x)} ${f(y)}`);
      if (r() < 0.5) C(d, pick(r, FILLS), x, y, between(r, 1.8, 2.8));
      else R(d, pick(r, FILLS), x - 3, y - 2.2, 6, 4.4, 1.2);
    }
    const core = pick(r, FILLS);
    add(d, (key) => <ellipse key={key} className={core} cx={f(cx)} cy={f(cy)} rx="6" ry="4.4" />);
  },
  chart(d, r) {
    const variant = int(r, 0, 2);
    if (variant === 2) {
      // Pie + legend.
      const cx = 15;
      const cy = 20;
      const rad = 9.5;
      let a0 = -Math.PI / 2;
      const parts = int(r, 2, 4);
      const weights = Array.from({ length: parts }, () => between(r, 0.5, 1.5));
      const total = weights.reduce((s, w) => s + w, 0);
      weights.forEach((w, i) => {
        const a1 = a0 + (w / total) * Math.PI * 2;
        const large = a1 - a0 > Math.PI ? 1 : 0;
        P(d, `${FILLS[i % 3]} wedge`, `M${cx} ${cy}L${f(cx + Math.cos(a0) * rad)} ${f(cy + Math.sin(a0) * rad)}A${rad} ${rad} 0 ${large} 1 ${f(cx + Math.cos(a1) * rad)} ${f(cy + Math.sin(a1) * rad)}z`);
        a0 = a1;
      });
      for (let i = 0; i < Math.min(parts, 3); i++) {
        C(d, FILLS[i]!, 28, 14 + i * 6, 1.4);
        P(d, 'ink thin', `M31 ${14 + i * 6}h${f(between(r, 2.5, 4))}`);
      }
      return;
    }
    P(d, 'ink thin', 'M6 5V34H35');
    if (variant === 0) {
      const n = int(r, 3, 6);
      const w = 26 / n;
      const mono = r() < 0.5 ? pick(r, FILLS) : null;
      let h = between(r, 6, 14);
      for (let i = 0; i < n; i++) {
        h = Math.max(4, Math.min(26, h + between(r, -5, 8)));
        R(d, mono ?? FILLS[i % 3]!, 8.5 + i * w, 32 - h, w * 0.68, h, 1);
      }
    } else {
      const n = int(r, 4, 6);
      const pts: Array<[number, number]> = [];
      let y = between(r, 22, 30);
      for (let i = 0; i < n; i++) {
        pts.push([8 + (i / (n - 1)) * 26, y]);
        y = Math.max(8, Math.min(31, y + between(r, -9, 5)));
      }
      const line = pts.map((p, i) => `${i ? 'L' : 'M'}${f(p[0])} ${f(p[1])}`).join('');
      const k = int(r, 0, 2);
      P(d, `${FILLS[k]} soft`, `${line}L34 32L8 32z`);
      P(d, STROKES[k]!, line);
      for (const [x, py] of pts) C(d, FILLS[k]!, x, py, 1.3);
    }
  },
  math(d, r) {
    const ox = between(r, 12, 20);
    const oy = between(r, 18, 24);
    P(d, 'ink thin', `M5 ${f(oy)}H35${arrowHead(35, oy, 0, 2)}M${f(ox)} 35V5${arrowHead(ox, 5, -Math.PI / 2, 2)}`);
    const curves = int(r, 1, 2);
    for (let c = 0; c < curves; c++) {
      const kind = pick(r, ['sin', 'parabola', 'cubic', 'exp'] as const);
      const amp = between(r, 5, 9);
      const freq = between(r, 0.25, 0.5);
      const ph = r() * 6;
      const a = between(r, 0.08, 0.2) * (r() < 0.5 ? 1 : -1);
      let path = '';
      for (let x = 6; x <= 34; x += 1) {
        const u = x - ox;
        let y =
          kind === 'sin' ? Math.sin(u * freq + ph) * amp
          : kind === 'parabola' ? a * u * u - amp * 0.6 * Math.sign(a)
          : kind === 'cubic' ? a * 0.04 * u * u * u - a * u
          : Math.exp(u * 0.14) - 1;
        y = oy - y;
        if (y < 4 || y > 36) {
          if (path) break;
          continue;
        }
        path += `${path ? 'L' : 'M'}${f(x)} ${f(y)}`;
      }
      if (path) P(d, STROKES[c]!, path);
    }
    if (r() < 0.5) C(d, 'f3', between(r, 24, 31), between(r, 8, 14), 1.5);
  },
  wire(d, r) {
    const variant = int(r, 0, 2);
    if (variant === 1) {
      // Phone.
      const x = between(r, 12, 14);
      R(d, 'ink thin paperf', x, 4, 14, 32, 3);
      P(d, 'ink thin', `M${f(x + 5.5)} 7h3`);
      R(d, `${pick(r, FILLS)} soft`, x + 2, 10, 10, 8, 1.2);
      textLines(d, r, x + 2.5, 22, 9, 2, 3.4);
      R(d, pick(r, FILLS), x + 2, 29.5, 10, 3.5, 1.7);
      return;
    }
    R(d, 'ink thin paperf', 5, 7, 30, 26, 2.2);
    P(d, 'ink thin', 'M5 12H35');
    for (let i = 0; i < 3; i++) C(d, 'inkf', 8 + i * 2.6, 9.5, 0.8);
    if (variant === 0) {
      // Landing: hero, text, button.
      R(d, `${pick(r, FILLS)} soft`, 8, 15, 24, 7, 1.2);
      textLines(d, r, 8.5, 25.5, 13, 2, 3.2);
      R(d, pick(r, FILLS), 24, 26, 8, 3.8, 1.9);
    } else {
      // Dashboard: sidebar + cards.
      R(d, 'faint', 7, 14, 6, 17, 1);
      const cols = int(r, 2, 3);
      const w = (18 - (cols - 1) * 1.5) / cols;
      for (let i = 0; i < cols; i++) R(d, `${FILLS[i % 3]} soft`, 15 + i * (w + 1.5), 14, w, 7, 1);
      textLines(d, r, 15, 25, 17, 2, 3.4);
    }
  },
  notes(d, r) {
    const variant = int(r, 0, 1);
    const x = between(r, 6, 8);
    P(d, 'ink bold', `M${f(x)} 9h${f(between(r, 10, 17))}`);
    if (variant === 0) {
      // Checklist.
      const n = int(r, 3, 4);
      for (let i = 0; i < n; i++) {
        const y = 15 + i * 5.5;
        const done = r() < 0.55;
        R(d, done ? pick(r, FILLS) : 'ink thin', x, y - 1.8, 3.6, 3.6, 0.9);
        if (done) P(d, 'paperline', `M${f(x + 0.8)} ${f(y)}l1 1 1.6-1.9`);
        P(d, 'ink thin', `M${f(x + 6)} ${f(y)}h${f(between(r, 10, 20))}`);
      }
    } else {
      // Paragraphs with a highlighted line and a margin sticky.
      const hl = int(r, 0, 4);
      const withSticky = r() < 0.7;
      for (let i = 0; i < 5; i++) {
        const y = 15 + i * 4.2;
        const w = between(r, 12, withSticky ? 17 : 24);
        if (i === hl) R(d, `${pick(r, FILLS)} soft`, x - 1, y - 1.8, w + 2, 3.6, 1);
        P(d, 'ink thin', `M${f(x)} ${f(y)}h${f(w)}`);
      }
      if (withSticky) sticky(d, r, 27, between(r, 6, 22), 8, 8, (r() - 0.5) * 14);
    }
  },
  sketch(d, r) {
    // Sticky and doodle share one row, an ink squiggle runs across the other.
    const left = r() < 0.5;
    const top = r() < 0.5;
    const sw = between(r, 10, 13);
    const sx = left ? between(r, 5, 8) : S - 5 - sw - r() * 3;
    const sy = top ? between(r, 5, 8) : S - 5 - sw - r() * 3;
    sticky(d, r, sx, sy, sw, sw, (r() - 0.5) * 16);
    const cx = left ? between(r, 27, 29) : between(r, 11, 13);
    const cy = top ? between(r, 12, 14) : between(r, 26, 28);
    const cls = pick(r, STROKES);
    const kind = pick(r, ['ring', 'box', 'triangle', 'arrow', 'lines', 'star', 'zigzag', 'spiral'] as const);
    if (kind === 'ring') C(d, cls, cx, cy, between(r, 4.5, 6.5));
    else if (kind === 'box') R(d, cls, cx - 5, cy - 4, 10, 8, 1);
    else if (kind === 'triangle') P(d, cls, `M${f(cx)} ${f(cy - 6)}L${f(cx + 6)} ${f(cy + 4.5)}H${f(cx - 6)}z`);
    else if (kind === 'arrow') {
      const dir = left ? 1 : -1;
      P(d, cls, `M${f(cx - 6 * dir)} ${f(cy + 4)}Q${f(cx - 2 * dir)} ${f(cy - 6)} ${f(cx + 6 * dir)} ${f(cy - 4)}${arrowHead(cx + 6 * dir, cy - 4, dir > 0 ? -0.3 : Math.PI + 0.3, 3.5)}`);
    } else if (kind === 'lines') P(d, cls, `M${f(cx - 6)} ${f(cy - 4)}h11M${f(cx - 6)} ${f(cy)}h7M${f(cx - 6)} ${f(cy + 4)}h9`);
    else if (kind === 'star') {
      let p = '';
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rad = i % 2 ? 2.6 : 6;
        p += `${i ? 'L' : 'M'}${f(cx + Math.cos(a) * rad)} ${f(cy + Math.sin(a) * rad)}`;
      }
      P(d, cls, `${p}z`);
    } else if (kind === 'zigzag') P(d, cls, `M${f(cx - 7)} ${f(cy + 3)}l3.5-6 3.5 6 3.5-6 3.5 6`);
    else {
      let p = '';
      for (let i = 0; i <= 28; i++) {
        const a = i * 0.45;
        const rad = 0.4 + i * 0.22;
        p += `${i ? 'L' : 'M'}${f(cx + Math.cos(a) * rad)} ${f(cy + Math.sin(a) * rad)}`;
      }
      P(d, cls, p);
    }
    P(d, 'ink', squiggle(r, 7, 33, top ? between(r, 28, 30) : between(r, 10, 12), 8));
  },
};

export const BoardGlyph = memo(function BoardGlyph({ id, name }: { id: string; name: string }) {
  const r = rng(seedOf(id));
  const h1 = Math.floor(r() * 360);
  const h2 = (h1 + 100 + Math.floor(r() * 50)) % 360;
  const h3 = (h1 + 210 + Math.floor(r() * 50)) % 360;
  const scene = sceneForName(name) ?? (r() < 0.45 ? 'sketch' : pick(r, SCENES));
  const d: Draw = { n: [], k: 0 };
  draw[scene](d, r);

  const dots: string[] = [];
  for (let y = 5; y < S; y += 7.5) for (let x = 5; x < S; x += 7.5) dots.push(`M${f(x)} ${f(y)}h0`);

  return (
    <svg
      className="board-glyph"
      data-scene={scene}
      viewBox={`0 0 ${S} ${S}`}
      aria-hidden="true"
      style={{ '--g-h': h1, '--g-h2': h2, '--g-h3': h3 } as React.CSSProperties}
    >
      <rect className="board-glyph-paper" x="0" y="0" width={S} height={S} rx="10" />
      <path className="board-glyph-dots" d={dots.join('')} />
      {d.n}
    </svg>
  );
});
