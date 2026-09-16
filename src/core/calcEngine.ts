/** Board calculator — Standard + Scientific, Windows Calc–style semantics. */

export type CalcMode = 'standard' | 'scientific';
export type CalcAngle = 'deg' | 'rad';

export type CalcKey =
  | '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9'
  | '.' | '±' | '+' | '−' | '×' | '÷' | '=' | '%'
  | 'CE' | 'C' | '⌫'
  | '√' | 'x²' | '1/x'
  | 'MC' | 'MR' | 'M+' | 'M−' | 'MS'
  | '(' | ')' | 'π' | 'e' | 'xʸ' | '10ˣ' | 'eˣ' | 'log' | 'ln' | 'n!' | '|x|'
  | 'sin' | 'cos' | 'tan' | 'asin' | 'acos' | 'atan'
  | 'sinh' | 'cosh' | 'tanh'
  | '2nd' | 'DEG' | 'RAD' | 'Exp'
  | 'mode-standard' | 'mode-scientific';

export interface CalcPersisted {
  mode: CalcMode;
  angle: CalcAngle;
  display: string;
  expr: string;
  memory: number | null;
  second: boolean;
  /** Opaque machine blob for mid-entry sync. */
  state: string;
}

export interface CalcPublic {
  mode: CalcMode;
  angle: CalcAngle;
  display: string;
  expr: string;
  memory: number | null;
  second: boolean;
  error: boolean;
  hasMemory: boolean;
}

interface Machine {
  mode: CalcMode;
  angle: CalcAngle;
  display: string;
  expr: string;
  memory: number | null;
  second: boolean;
  error: string | null;
  /** Value waiting for a binary op. */
  acc: number | null;
  pendingOp: '+' | '−' | '×' | '÷' | 'xʸ' | null;
  /** True while the user is typing into display. */
  entering: boolean;
  /** Just finished `=`; next digit starts fresh. */
  justEvaluated: boolean;
  /** Open paren depth for expression line. */
  parenDepth: number;
  /** Buffered left side for chained precedence (a + b × …). */
  precAcc: number | null;
  precOp: '+' | '−' | null;
}

const ERR_DIV0 = 'Cannot divide by zero';
const ERR_OVERFLOW = 'Overflow';
const ERR_INVALID = 'Invalid input';
const MAX_ABS = 1e308;
const MAX_DIGITS = 16;

export function defaultCalcPersisted(mode: CalcMode = 'standard'): CalcPersisted {
  const m = freshMachine(mode);
  return persist(m);
}

export function calcFromPersisted(p: Partial<CalcPersisted> | null | undefined): CalcPublic {
  const m = hydrate(p);
  return toPublic(m);
}

export function applyCalcKey(p: Partial<CalcPersisted> | null | undefined, key: CalcKey): CalcPersisted {
  let m = hydrate(p);
  m = reduce(m, key);
  return persist(m);
}

export function calcPublicFromPersisted(p: Partial<CalcPersisted> | null | undefined): CalcPublic {
  return toPublic(hydrate(p));
}

function freshMachine(mode: CalcMode = 'standard'): Machine {
  return {
    mode,
    angle: 'deg',
    display: '0',
    expr: '',
    memory: null,
    second: false,
    error: null,
    acc: null,
    pendingOp: null,
    entering: false,
    justEvaluated: false,
    parenDepth: 0,
    precAcc: null,
    precOp: null,
  };
}

function hydrate(p: Partial<CalcPersisted> | null | undefined): Machine {
  const base = freshMachine(p?.mode === 'scientific' ? 'scientific' : 'standard');
  if (!p) return base;
  base.mode = p.mode === 'scientific' ? 'scientific' : 'standard';
  base.angle = p.angle === 'rad' ? 'rad' : 'deg';
  base.display = typeof p.display === 'string' && p.display.length ? p.display : '0';
  base.expr = typeof p.expr === 'string' ? p.expr : '';
  base.memory = typeof p.memory === 'number' && Number.isFinite(p.memory) ? p.memory : null;
  base.second = p.second === true;
  if (typeof p.state === 'string' && p.state.length) {
    try {
      const raw = JSON.parse(p.state) as Partial<Machine>;
      if (typeof raw.acc === 'number' || raw.acc === null) base.acc = raw.acc ?? null;
      if (raw.pendingOp === '+' || raw.pendingOp === '−' || raw.pendingOp === '×' || raw.pendingOp === '÷' || raw.pendingOp === 'xʸ' || raw.pendingOp === null) {
        base.pendingOp = raw.pendingOp ?? null;
      }
      if (typeof raw.entering === 'boolean') base.entering = raw.entering;
      if (typeof raw.justEvaluated === 'boolean') base.justEvaluated = raw.justEvaluated;
      if (typeof raw.parenDepth === 'number') base.parenDepth = raw.parenDepth;
      if (typeof raw.precAcc === 'number' || raw.precAcc === null) base.precAcc = raw.precAcc ?? null;
      if (raw.precOp === '+' || raw.precOp === '−' || raw.precOp === null) base.precOp = raw.precOp ?? null;
      if (typeof raw.error === 'string' || raw.error === null) base.error = raw.error ?? null;
    } catch {
      /* ignore corrupt state */
    }
  }
  if (
    base.display === ERR_DIV0 ||
    base.display === ERR_OVERFLOW ||
    base.display === ERR_INVALID
  ) {
    base.error = base.display;
  }
  return base;
}

function persist(m: Machine): CalcPersisted {
  return {
    mode: m.mode,
    angle: m.angle,
    display: m.error ?? m.display,
    expr: m.expr,
    memory: m.memory,
    second: m.second,
    state: JSON.stringify({
      acc: m.acc,
      pendingOp: m.pendingOp,
      entering: m.entering,
      justEvaluated: m.justEvaluated,
      parenDepth: m.parenDepth,
      precAcc: m.precAcc,
      precOp: m.precOp,
      error: m.error,
    }),
  };
}

function toPublic(m: Machine): CalcPublic {
  return {
    mode: m.mode,
    angle: m.angle,
    display: m.error ?? m.display,
    expr: m.expr,
    memory: m.memory,
    second: m.second,
    error: Boolean(m.error),
    hasMemory: m.memory != null,
  };
}

function reduce(m: Machine, key: CalcKey): Machine {
  if (key === 'mode-standard' || key === 'mode-scientific') {
    const next = { ...m, mode: key === 'mode-scientific' ? 'scientific' as const : 'standard' as const, second: false };
    return clearPendingKeepValue(next);
  }
  if (key === 'DEG' || key === 'RAD') {
    return { ...m, angle: key === 'RAD' ? 'rad' : 'deg' };
  }
  if (key === '2nd') {
    return { ...m, second: !m.second };
  }

  if (m.error) {
    if (key === 'C' || key === 'CE') return clearAll(m);
    if (key === '⌫') return clearError(m);
    return m;
  }

  switch (key) {
    case 'C':
      return clearAll(m);
    case 'CE':
      return clearEntry(m);
    case '⌫':
      return backspace(m);
    case 'MC':
      return { ...m, memory: null };
    case 'MR':
      return m.memory == null ? m : setDisplay(m, formatNumber(m.memory), true);
    case 'MS':
      return { ...m, memory: currentValue(m) };
    case 'M+':
      return { ...m, memory: (m.memory ?? 0) + currentValue(m) };
    case 'M−':
      return { ...m, memory: (m.memory ?? 0) - currentValue(m) };
    case '0':
    case '1':
    case '2':
    case '3':
    case '4':
    case '5':
    case '6':
    case '7':
    case '8':
    case '9':
      return digit(m, key);
    case '.':
      return decimal(m);
    case '±':
      return negate(m);
    case 'Exp':
      return expEntry(m);
    case '+':
    case '−':
    case '×':
    case '÷':
    case 'xʸ':
      return binaryOp(m, key);
    case '=':
      return equals(m);
    case '%':
      return percent(m);
    case '√':
      return unary(m, (x) => (x < 0 ? NaN : Math.sqrt(x)), '√');
    case 'x²':
      return unary(m, (x) => x * x, 'sqr');
    case '1/x':
      return unary(m, (x) => (x === 0 ? Infinity : 1 / x), '1/');
    case '|x|':
      return unary(m, Math.abs, 'abs');
    case 'n!':
      return unary(m, factorial, 'n!');
    case '10ˣ':
      return unary(m, (x) => Math.pow(10, x), '10^');
    case 'eˣ':
      return unary(m, Math.exp, 'e^');
    case 'log':
      return unary(m, (x) => (x <= 0 ? NaN : Math.log10(x)), 'log');
    case 'ln':
      return unary(m, (x) => (x <= 0 ? NaN : Math.log(x)), 'ln');
    case 'sin':
      return unary(m, (x) => Math.sin(toRad(x, m.angle)), 'sin');
    case 'cos':
      return unary(m, (x) => Math.cos(toRad(x, m.angle)), 'cos');
    case 'tan':
      return unary(m, (x) => Math.tan(toRad(x, m.angle)), 'tan');
    case 'asin':
      return clearSecond(unary(m, (x) => fromRad(Math.asin(x), m.angle), 'asin'));
    case 'acos':
      return clearSecond(unary(m, (x) => fromRad(Math.acos(x), m.angle), 'acos'));
    case 'atan':
      return clearSecond(unary(m, (x) => fromRad(Math.atan(x), m.angle), 'atan'));
    case 'sinh':
      return clearSecond(unary(m, Math.sinh, 'sinh'));
    case 'cosh':
      return clearSecond(unary(m, Math.cosh, 'cosh'));
    case 'tanh':
      return clearSecond(unary(m, Math.tanh, 'tanh'));
    case 'π':
      return setDisplay(m, formatNumber(Math.PI), true);
    case 'e':
      return setDisplay(m, formatNumber(Math.E), true);
    case '(':
      return openParen(m);
    case ')':
      return closeParen(m);
    default:
      return m;
  }
}

function clearAll(m: Machine): Machine {
  return {
    ...freshMachine(m.mode),
    angle: m.angle,
    memory: m.memory,
  };
}

function clearEntry(m: Machine): Machine {
  return { ...m, display: '0', error: null, entering: true, justEvaluated: false };
}

function clearError(m: Machine): Machine {
  return { ...m, display: '0', error: null, entering: false, justEvaluated: false };
}

function clearSecond(m: Machine): Machine {
  return m.second ? { ...m, second: false } : m;
}

function clearPendingKeepValue(m: Machine): Machine {
  const v = m.error ? 0 : currentValue(m);
  return {
    ...m,
    display: m.error ? '0' : formatNumber(v),
    expr: '',
    error: null,
    acc: null,
    pendingOp: null,
    entering: false,
    justEvaluated: true,
    parenDepth: 0,
    precAcc: null,
    precOp: null,
  };
}

function backspace(m: Machine): Machine {
  if (!m.entering || m.justEvaluated) return m;
  let d = m.display;
  if (d.length <= 1 || (d.length === 2 && d.startsWith('-'))) {
    return { ...m, display: '0', entering: true };
  }
  d = d.slice(0, -1);
  if (d === '-' || d === '') d = '0';
  return { ...m, display: d };
}

function digit(m: Machine, d: string): Machine {
  if (!m.entering || m.justEvaluated) {
    return { ...m, display: d, entering: true, justEvaluated: false };
  }
  if (m.display === '0') return { ...m, display: d };
  if (m.display === '-0') return { ...m, display: `-${d}` };
  if (significantDigits(m.display) >= MAX_DIGITS) return m;
  return { ...m, display: m.display + d };
}

function decimal(m: Machine): Machine {
  if (!m.entering || m.justEvaluated) {
    return { ...m, display: '0.', entering: true, justEvaluated: false };
  }
  if (m.display.includes('.')) return m;
  return { ...m, display: m.display + '.' };
}

function negate(m: Machine): Machine {
  if (m.display.startsWith('-')) return { ...m, display: m.display.slice(1) || '0', entering: true };
  if (m.display === '0') return m;
  return { ...m, display: `-${m.display}`, entering: true };
}

function expEntry(m: Machine): Machine {
  if (!m.entering || m.justEvaluated) {
    return { ...m, display: '0.e+0', entering: true, justEvaluated: false };
  }
  if (/e/i.test(m.display)) return m;
  return { ...m, display: `${m.display}e+0`, entering: true };
}

function opPrec(op: '+' | '−' | '×' | '÷' | 'xʸ'): number {
  if (op === '+' || op === '−') return 1;
  if (op === 'xʸ') return 3;
  return 2;
}

function binaryOp(m: Machine, op: '+' | '−' | '×' | '÷' | 'xʸ'): Machine {
  const value = currentValue(m);
  let next = { ...m };

  // Replace pending op when user taps another before entering a new value (2 + × → 2 ×).
  if (next.pendingOp && next.acc != null && !next.entering && !next.justEvaluated) {
    next.pendingOp = op;
    next.expr = buildExprLine({ ...next, pendingOp: op });
    return next;
  }

  // Higher precedence than pending (+ then ×): stash lower op, start high-prec chain.
  if (
    next.pendingOp &&
    next.acc != null &&
    (next.pendingOp === '+' || next.pendingOp === '−') &&
    opPrec(op) > opPrec(next.pendingOp)
  ) {
    next.precAcc = next.acc;
    next.precOp = next.pendingOp;
    next.acc = value;
    next.pendingOp = op;
    next.expr = buildExprLine(next);
    next.entering = false;
    next.justEvaluated = false;
    next.display = formatNumber(value);
    return next;
  }

  // Same/lower precedence: resolve pending (and any stashed +/−) first.
  if (next.pendingOp && next.acc != null) {
    const applied = applyBinary(next.acc, next.pendingOp, value, next);
    if (applied.error) return applied;
    next = applied;
  }
  if (next.precAcc != null && next.precOp) {
    const folded = finishPrec(next, currentValue(next));
    if (folded.error) return folded;
    next = folded;
  }

  next.acc = currentValue(next);
  next.pendingOp = op;
  next.expr = buildExprLine(next);
  next.entering = false;
  next.justEvaluated = false;
  next.display = formatNumber(currentValue(next));
  return next;
}

function equals(m: Machine): Machine {
  let next = { ...m };
  const value = currentValue(next);

  if (next.pendingOp && next.acc != null) {
    next = applyBinary(next.acc, next.pendingOp, value, next);
    if (next.error) return next;
  }

  if (next.precAcc != null && next.precOp) {
    next = finishPrec(next, currentValue(next));
    if (next.error) return next;
  }

  next.expr = '';
  next.acc = null;
  next.pendingOp = null;
  next.precAcc = null;
  next.precOp = null;
  next.entering = false;
  next.justEvaluated = true;
  next.parenDepth = 0;
  return next;
}

function percent(m: Machine): Machine {
  const v = currentValue(m);
  if (m.acc != null && (m.pendingOp === '+' || m.pendingOp === '−')) {
    return setDisplay({ ...m, entering: false, justEvaluated: false }, formatNumber(m.acc * (v / 100)), false);
  }
  return setDisplay({ ...m, entering: false, justEvaluated: false }, formatNumber(v / 100), false);
}

function unary(m: Machine, fn: (x: number) => number, _label: string): Machine {
  const x = currentValue(m);
  const y = fn(x);
  return setResult(m, y);
}

function openParen(m: Machine): Machine {
  // Simplified: treat as starting a nested sub-expression by flushing display into pending when needed.
  return {
    ...m,
    parenDepth: m.parenDepth + 1,
    expr: `${m.expr}${m.expr && !m.expr.endsWith('(') && !m.expr.endsWith(' ') ? ' ' : ''}(`.trimStart(),
    entering: false,
    justEvaluated: false,
  };
}

function closeParen(m: Machine): Machine {
  if (m.parenDepth <= 0) return m;
  let next = { ...m, parenDepth: m.parenDepth - 1 };
  if (next.pendingOp && next.acc != null) {
    next = applyBinary(next.acc, next.pendingOp, currentValue(next), next);
    if (next.error) return next;
  }
  next.expr = `${next.expr} )`.replace(/\s+/g, ' ').trim();
  next.entering = false;
  next.justEvaluated = false;
  return next;
}

function applyBinary(a: number, op: '+' | '−' | '×' | '÷' | 'xʸ', b: number, m: Machine): Machine {
  let r: number;
  switch (op) {
    case '+':
      r = a + b;
      break;
    case '−':
      r = a - b;
      break;
    case '×':
      r = a * b;
      break;
    case '÷':
      if (b === 0) return fail(m, ERR_DIV0);
      r = a / b;
      break;
    case 'xʸ':
      r = Math.pow(a, b);
      break;
  }
  return setResult(
    {
      ...m,
      acc: null,
      pendingOp: null,
      entering: false,
      justEvaluated: false,
    },
    r
  );
}

function finishPrec(m: Machine, highResult: number): Machine {
  if (m.precAcc == null || !m.precOp) {
    return setResult({ ...m, precAcc: null, precOp: null }, highResult);
  }
  return applyBinary(m.precAcc, m.precOp, highResult, {
    ...m,
    precAcc: null,
    precOp: null,
    pendingOp: null,
    acc: null,
  });
}

function setResult(m: Machine, r: number): Machine {
  if (!Number.isFinite(r)) {
    if (r === Infinity || r === -Infinity) return fail(m, ERR_DIV0);
    return fail(m, ERR_INVALID);
  }
  if (Math.abs(r) > MAX_ABS) return fail(m, ERR_OVERFLOW);
  return {
    ...m,
    display: formatNumber(r),
    error: null,
    entering: false,
    justEvaluated: false,
  };
}

function setDisplay(m: Machine, display: string, asEntry: boolean): Machine {
  return {
    ...m,
    display,
    error: null,
    entering: asEntry,
    justEvaluated: asEntry,
  };
}

function fail(m: Machine, msg: string): Machine {
  return {
    ...m,
    display: msg,
    error: msg,
    expr: '',
    acc: null,
    pendingOp: null,
    precAcc: null,
    precOp: null,
    entering: false,
    justEvaluated: false,
    parenDepth: 0,
  };
}

function currentValue(m: Machine): number {
  const n = parseDisplay(m.display);
  return Number.isFinite(n) ? n : 0;
}

function parseDisplay(s: string): number {
  if (!s || s === ERR_DIV0 || s === ERR_OVERFLOW || s === ERR_INVALID) return NaN;
  const cleaned = s.replace(/−/g, '-');
  return Number(cleaned);
}

export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (Object.is(n, -0)) return '0';
  const abs = Math.abs(n);
  if (abs !== 0 && (abs >= 1e16 || abs < 1e-15)) {
    return trimExp(n.toExponential(MAX_DIGITS - 1));
  }
  let s = n.toPrecision(MAX_DIGITS);
  if (s.includes('e') || s.includes('E')) return trimExp(s);
  if (s.includes('.')) s = s.replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
}

function trimExp(s: string): string {
  return s
    .replace(/(\.\d*?)0+e/i, '$1e')
    .replace(/\.e/i, 'e')
    .replace(/e\+/i, 'e+')
    .replace(/e\-0+/i, 'e-')
    .replace(/e\+0+/i, 'e+');
}

function significantDigits(s: string): number {
  const body = s.replace(/^-/, '').replace(/\./, '').replace(/e.*$/i, '');
  return body.length;
}

function toRad(x: number, angle: CalcAngle): number {
  return angle === 'deg' ? (x * Math.PI) / 180 : x;
}

function fromRad(x: number, angle: CalcAngle): number {
  return angle === 'deg' ? (x * 180) / Math.PI : x;
}

function factorial(n: number): number {
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n) || n > 170) return NaN;
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

function buildExprLine(m: Machine): string {
  const parts: string[] = [];
  if (m.precAcc != null && m.precOp) {
    parts.push(formatNumber(m.precAcc), m.precOp);
  }
  if (m.acc != null && m.pendingOp) {
    parts.push(formatNumber(m.acc), m.pendingOp);
  }
  return parts.join(' ');
}

/** Map keyboard events to calc keys while the panel is focused. */
export function calcKeyFromKeyboard(e: KeyboardEvent, mode: CalcMode, second: boolean): CalcKey | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  const k = e.key;
  if (k >= '0' && k <= '9') return k as CalcKey;
  if (k === '.') return '.';
  if (k === '+') return '+';
  if (k === '-') return '−';
  if (k === '*' || k === 'x' || k === 'X') return '×';
  if (k === '/') return '÷';
  if (k === 'Enter' || k === '=') return '=';
  if (k === 'Backspace') return '⌫';
  // Escape closes the keypad in the UI — not CE.
  if (k === 'Escape') return null;
  if (k === '%') return '%';
  if (k === '(') return '(';
  if (k === ')') return ')';
  if (k === 'Delete') return 'CE';
  if (mode === 'scientific') {
    if (k === 'p' || k === 'P') return 'π';
    if (k === 'e' && !e.shiftKey) return 'e';
  }
  if (k === 'r' || k === 'R') return '√';
  if (k === 'q' || k === 'Q') return 'x²';
  if (second && mode === 'scientific') {
    /* reserved */
  }
  return null;
}

export function shapeFieldsFromPersisted(p: CalcPersisted): {
  calcMode: CalcMode;
  calcAngle: CalcAngle;
  calcDisplay: string;
  calcExpr: string;
  calcMemory: number | null;
  calcSecond: boolean;
  calcState: string;
} {
  return {
    calcMode: p.mode,
    calcAngle: p.angle,
    calcDisplay: p.display,
    calcExpr: p.expr,
    calcMemory: p.memory,
    calcSecond: p.second,
    calcState: p.state,
  };
}

export function persistedFromShape(v: {
  calcMode?: string;
  calcAngle?: string;
  calcDisplay?: string;
  calcExpr?: string;
  calcMemory?: number | null;
  calcSecond?: boolean;
  calcState?: string;
}): CalcPersisted {
  return {
    mode: v.calcMode === 'scientific' ? 'scientific' : 'standard',
    angle: v.calcAngle === 'rad' ? 'rad' : 'deg',
    display: v.calcDisplay ?? '0',
    expr: v.calcExpr ?? '',
    memory: typeof v.calcMemory === 'number' ? v.calcMemory : null,
    second: v.calcSecond === true,
    state: v.calcState ?? '',
  };
}
