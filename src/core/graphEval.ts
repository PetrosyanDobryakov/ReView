export interface CompiledFn {
  fn: (x: number) => number;
  error?: undefined;
}

export interface CompileError {
  fn?: undefined;
  error: string;
}

type Tok =
  | { t: 'num'; v: number }
  | { t: 'id'; v: string }
  | { t: 'op'; v: string }
  | { t: 'x' }
  | { t: 'end' };

const FUNCS: Record<string, (...args: number[]) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  cot: (a) => 1 / Math.tan(a),
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  arcsin: Math.asin,
  arccos: Math.acos,
  arctan: Math.atan,
  sqrt: Math.sqrt,
  abs: Math.abs,
  ln: Math.log,
  log10: Math.log10,
  lg: Math.log10,
  exp: Math.exp,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  sign: Math.sign,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  min: Math.min,
  max: Math.max,
  pow: Math.pow,
};

const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E };

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === ' ') {
      i++;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      const num = parseFloat(src.slice(i, j));
      if (!isFinite(num)) throw new Error('bad number');
      toks.push({ t: 'num', v: num });
      i = j;
      continue;
    }
    if (/[a-zA-Z]/.test(ch)) {
      let j = i;
      while (j < src.length && /[a-zA-Z0-9]/.test(src[j])) j++;
      const word = src.slice(i, j).toLowerCase();
      if (word === 'x') toks.push({ t: 'x' });
      else if (word in FUNCS || word in CONSTS) toks.push({ t: 'id', v: word });
      else throw new Error(`unknown: ${word}`);
      i = j;
      continue;
    }
    if ('+-*/^()%,'.includes(ch)) {
      toks.push({ t: 'op', v: ch });
      i++;
      continue;
    }
    throw new Error(`bad char: ${ch}`);
  }
  toks.push({ t: 'end' });
  return toks;
}

function parse(src: string): (x: number) => number {
  const toks = tokenize(src);
  let pos = 0;
  const peek = () => toks[pos];
  const next = () => toks[pos++];

  function parseExpr(): (x: number) => number {
    let left = parseTerm();
    for (;;) {
      const tk = peek();
      if (tk.t === 'op' && (tk.v === '+' || tk.v === '-')) {
        next();
        const right = parseTerm();
        const l = left;
        left = tk.v === '+' ? (x) => l(x) + right(x) : (x) => l(x) - right(x);
      } else break;
    }
    return left;
  }

  function parseTerm(): (x: number) => number {
    let left = parseUnary();
    for (;;) {
      const tk = peek();
      if (tk.t === 'op' && (tk.v === '*' || tk.v === '/' || tk.v === '%')) {
        next();
        const right = parseUnary();
        const l = left;
        left =
          tk.v === '*'
            ? (x) => l(x) * right(x)
            : tk.v === '/'
              ? (x) => l(x) / right(x)
              : (x) => l(x) % right(x);
      } else break;
    }
    return left;
  }

  function parseUnary(): (x: number) => number {
    const tk = peek();
    if (tk.t === 'op' && tk.v === '-') {
      next();
      const inner = parseUnary();
      return (x) => -inner(x);
    }
    if (tk.t === 'op' && tk.v === '+') {
      next();
      return parseUnary();
    }
    return parsePower();
  }

  function parsePower(): (x: number) => number {
    const base = parseAtom();
    const tk = peek();
    if (tk.t === 'op' && tk.v === '^') {
      next();
      const exp = parseUnary(); // right-assoc
      return (x) => Math.pow(base(x), exp(x));
    }
    return base;
  }

  function parseArgs(): Array<(x: number) => number> {
    const args: Array<(x: number) => number> = [parseExpr()];
    for (;;) {
      const tk = peek();
      if (tk.t === 'op' && tk.v === ',') {
        next();
        args.push(parseExpr());
      } else break;
    }
    return args;
  }

  function parseAtom(): (x: number) => number {
    const tk = next();
    if (tk.t === 'num') {
      const v = tk.v;
      return () => v;
    }
    if (tk.t === 'x') return (x) => x;
    if (tk.t === 'id') {
      if (tk.v in CONSTS) {
        const c = CONSTS[tk.v];
        return () => c;
      }
      const f = FUNCS[tk.v];
      const open = peek();
      if (!(open.t === 'op' && open.v === '(')) throw new Error(`need (): ${tk.v}`);
      next();
      const args = parseArgs();
      const close = peek();
      if (!(close.t === 'op' && close.v === ')')) throw new Error('missing )');
      next();
      return (x) => f(...args.map((a) => a(x)));
    }
    if (tk.t === 'op' && tk.v === '(') {
      const inner = parseExpr();
      const close = peek();
      if (!(close.t === 'op' && close.v === ')')) throw new Error('missing )');
      next();
      return inner;
    }
    throw new Error('unexpected');
  }

  const fn = parseExpr();
  const tail = peek();
  if (tail.t !== 'end') throw new Error('extra tokens');
  return fn;
}

const cache = new Map<string, CompiledFn | CompileError>();

export function compileGraph(expr: string): CompiledFn | CompileError {
  const key = expr.trim();
  const hit = cache.get(key);
  if (hit) return hit;
  let result: CompiledFn | CompileError;
  try {
    result = { fn: parse(key) };
  } catch (err) {
    result = { error: err instanceof Error ? err.message : String(err) };
  }
  if (cache.size > 200) cache.clear();
  cache.set(key, result);
  return result;
}
