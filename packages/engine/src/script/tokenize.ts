/** Tokenizer for SavigScript expression language. */

export interface Token {
  kind: 'num' | 'str' | 'ident' | 'op' | 'lparen' | 'rparen' | 'question' | 'colon' | 'eof';
  text: string;
  value?: number | string;
  pos: number;
}

export type TokenizeResult = { ok: true; tokens: Token[] } | { ok: false; message: string; pos: number };

const OPS = ['&&', '||', '==', '!=', '<=', '>=', '+', '-', '*', '/', '%', '<', '>', '!'];
const ESCAPES: Record<string, string> = { '\\': '\\', "'": "'", '"': '"', n: '\n', t: '\t' };

export function tokenize(source: string): TokenizeResult {
  if (source.length > 500) {
    return { ok: false, message: 'expression longer than 500 characters', pos: 500 };
  }

  const tokens: Token[] = [];
  let i = 0;

  while (i < source.length) {
    const c = source[i];

    // Skip whitespace
    if (/\s/.test(c)) {
      i++;
      continue;
    }

    // Numbers (including decimals starting with .)
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(source[i + 1] ?? ''))) {
      const start = i;
      while (i < source.length && /[0-9.]/.test(source[i])) {
        i++;
      }
      const text = source.slice(start, i);
      const value = Number(text);
      if (!Number.isFinite(value)) {
        return { ok: false, message: `bad number "${text}"`, pos: start };
      }
      tokens.push({ kind: 'num', text, value, pos: start });
      continue;
    }

    // Strings
    if (c === "'" || c === '"') {
      const quote = c;
      const start = i;
      let out = '';
      i++;

      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\') {
          const esc = ESCAPES[source[i + 1]];
          if (esc === undefined) {
            return { ok: false, message: `unknown escape "\\${source[i + 1] ?? ''}"`, pos: i };
          }
          out += esc;
          i += 2;
        } else {
          out += source[i];
          i++;
        }
      }

      if (i >= source.length) {
        return { ok: false, message: 'unterminated string', pos: start };
      }

      i++; // consume closing quote
      tokens.push({ kind: 'str', text: out, value: out, pos: start });
      continue;
    }

    // Identifiers (including keywords)
    if (/[A-Za-z_]/.test(c)) {
      const start = i;
      while (i < source.length && /[A-Za-z0-9_]/.test(source[i])) {
        i++;
      }
      tokens.push({ kind: 'ident', text: source.slice(start, i), pos: start });
      continue;
    }

    // Parentheses and ternary
    if (c === '(') {
      tokens.push({ kind: 'lparen', text: c, pos: i++ });
      continue;
    }
    if (c === ')') {
      tokens.push({ kind: 'rparen', text: c, pos: i++ });
      continue;
    }
    if (c === '?') {
      tokens.push({ kind: 'question', text: c, pos: i++ });
      continue;
    }
    if (c === ':') {
      tokens.push({ kind: 'colon', text: c, pos: i++ });
      continue;
    }

    // Operators
    const op = OPS.find((o) => source.startsWith(o, i));
    if (op) {
      tokens.push({ kind: 'op', text: op, pos: i });
      i += op.length;
      continue;
    }

    // Unknown character
    return { ok: false, message: `unexpected character "${c}"`, pos: i };
  }

  tokens.push({ kind: 'eof', text: '', pos: source.length });
  return { ok: true, tokens };
}
