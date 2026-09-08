/** Parser for SavigScript expression language using Pratt parsing. */

import { tokenize, type Token } from './tokenize';

export type Value = number | string | boolean;

export type Expr =
  | { kind: 'lit'; value: Value }
  | { kind: 'var'; name: string; pos: number }
  | { kind: 'call'; name: 'random'; pos: number }
  | { kind: 'unary'; op: '-' | '!'; expr: Expr; pos: number }
  | { kind: 'binary'; op: string; left: Expr; right: Expr; pos: number }
  | { kind: 'ternary'; cond: Expr; then: Expr; else: Expr; pos: number };

export type ParseResult = { ok: true; ast: Expr } | { ok: false; message: string; pos: number };

const BIN_PRECEDENCE: Record<string, number> = {
  '||': 1,
  '&&': 2,
  '==': 3,
  '!=': 3,
  '<': 4,
  '<=': 4,
  '>': 4,
  '>=': 4,
  '+': 5,
  '-': 5,
  '*': 6,
  '/': 6,
  '%': 6,
};

const MAX_DEPTH = 32;

interface Parser {
  tokens: Token[];
  pos: number;
}

function current(p: Parser): Token {
  return p.tokens[p.pos] ?? { kind: 'eof', text: '', pos: -1 };
}

function advance(p: Parser): void {
  p.pos++;
}

function parseExpr(p: Parser, minPrec: number, depth: number): Expr | null {
  if (depth > MAX_DEPTH) {
    return null;
  }

  let left = parsePrimary(p, depth);
  if (!left) return null;

  let leftDepth = depth; // Track depth of left-chain wrapping

  while (true) {
    const tok = current(p);
    if (tok.kind !== 'op') break;

    const prec = BIN_PRECEDENCE[tok.text];
    if (prec === undefined || prec < minPrec) break;

    // Check depth cap before wrapping left in a new binary node
    leftDepth++;
    if (leftDepth > MAX_DEPTH) {
      return null;
    }

    const op = tok.text;
    const opPos = tok.pos;
    advance(p);

    const right = parseExpr(p, prec + 1, leftDepth + 1);
    if (!right) return null;

    left = { kind: 'binary', op, left, right, pos: opPos };
  }

  // Handle ternary only at the outermost level (minPrec === 0)
  // Higher-precedence calls must leave ? unconsumed for their caller
  if (minPrec === 0 && current(p).kind === 'question') {
    advance(p);
    const then = parseExpr(p, 0, depth + 1);
    if (!then) return null;

    if (current(p).kind !== 'colon') {
      return null;
    }
    advance(p);

    const els = parseExpr(p, 0, depth + 1);
    if (!els) return null;

    // Get position from left expr, fallback based on expr type
    let pos = 0;
    if ('pos' in left) {
      pos = (left as any).pos;
    } else if (left.kind === 'lit') {
      pos = 0;
    }
    return { kind: 'ternary', cond: left, then, else: els, pos };
  }

  return left;
}

/**
 * Measure the AST depth iteratively using an explicit stack (no recursion).
 * Depth convention: a lone literal = 1; each nesting level adds 1.
 * This prevents stack overflow in evaluate() by ensuring any AST we accept
 * has depth ≤ 32, regardless of how the tree was structurally built.
 */
function measureASTDepth(expr: Expr): number {
  const stack: Array<{ node: Expr; depth: number }> = [{ node: expr, depth: 1 }];
  let maxDepth = 1;

  while (stack.length > 0) {
    const { node, depth } = stack.pop()!;
    maxDepth = Math.max(maxDepth, depth);

    switch (node.kind) {
      case 'lit':
      case 'var':
      case 'call':
        // Terminal nodes, no children
        break;
      case 'unary':
        stack.push({ node: node.expr, depth: depth + 1 });
        break;
      case 'binary':
        stack.push({ node: node.left, depth: depth + 1 });
        stack.push({ node: node.right, depth: depth + 1 });
        break;
      case 'ternary':
        stack.push({ node: node.cond, depth: depth + 1 });
        stack.push({ node: node.then, depth: depth + 1 });
        stack.push({ node: node.else, depth: depth + 1 });
        break;
    }
  }

  return maxDepth;
}

function parsePrimary(p: Parser, depth: number): Expr | null {
  if (depth > MAX_DEPTH) {
    return null;
  }

  const tok = current(p);

  // Literals
  if (tok.kind === 'num') {
    advance(p);
    return { kind: 'lit', value: tok.value as number };
  }

  if (tok.kind === 'str') {
    advance(p);
    return { kind: 'lit', value: tok.value as string };
  }

  // Keywords
  if (tok.kind === 'ident') {
    if (tok.text === 'true') {
      advance(p);
      return { kind: 'lit', value: true };
    }
    if (tok.text === 'false') {
      advance(p);
      return { kind: 'lit', value: false };
    }

    // Function call or variable
    const name = tok.text;
    const namePos = tok.pos;
    advance(p);

    if (current(p).kind === 'lparen') {
      // Function call
      if (name !== 'random') {
        return null; // only random() is callable
      }
      advance(p); // consume (

      // Check for arguments (not allowed)
      if (current(p).kind !== 'rparen') {
        return null; // random takes no args
      }

      advance(p); // consume )
      return { kind: 'call', name: 'random', pos: namePos };
    }

    // Variable reference
    return { kind: 'var', name, pos: namePos };
  }

  // Parenthesized expression
  if (tok.kind === 'lparen') {
    advance(p);
    const expr = parseExpr(p, 0, depth + 1);
    if (!expr) return null;

    if (current(p).kind !== 'rparen') {
      return null;
    }
    advance(p);
    return expr;
  }

  // Unary operators
  if (tok.kind === 'op' && (tok.text === '-' || tok.text === '!')) {
    const op = tok.text as '-' | '!';
    const opPos = tok.pos;
    advance(p);
    const expr = parsePrimary(p, depth + 1);
    if (!expr) return null;
    return { kind: 'unary', op, expr, pos: opPos };
  }

  return null;
}

export function parse(source: string): ParseResult {
  const tokenResult = tokenize(source);
  if (!tokenResult.ok) {
    return tokenResult;
  }

  const p: Parser = { tokens: tokenResult.tokens, pos: 0 };
  const expr = parseExpr(p, 0, 0);

  if (!expr) {
    const tok = current(p);
    return { ok: false, message: 'parse error', pos: tok.pos };
  }

  // Check for trailing tokens
  const trailing = current(p);
  if (trailing.kind !== 'eof') {
    return { ok: false, message: 'unexpected trailing tokens', pos: trailing.pos };
  }

  // Measure AST depth to catch structural burial patterns
  if (measureASTDepth(expr) > MAX_DEPTH) {
    return { ok: false, message: 'expression too deeply nested', pos: 0 };
  }

  return { ok: true, ast: expr };
}
