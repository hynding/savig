/** Evaluator for SavigScript AST. */

import type { Expr, Value } from './parse';

export interface EvalEnv {
  vars: ReadonlyMap<string, Value>;
  time: number;
  sceneIndex: number;
  sceneTime: number;
  random(): number;
  /** Sampled animated x/y of an authored object at the current time (its own scene's local
   *  clock), for the xOf('id')/yOf('id') built-ins. `undefined` = unknown object. Hosts that
   *  can't sample (e.g. a bare test env) may omit them — the built-ins then eval-error. */
  objectX?(id: string): number | undefined;
  objectY?(id: string): number | undefined;
}

export type EvalResult = { ok: true; value: Value } | { ok: false; message: string };

export function evaluate(ast: Expr, env: EvalEnv): EvalResult {
  try {
    return { ok: true, value: evalNode(ast, env) };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

/**
 * Internal evaluation function that throws errors.
 * The public evaluate() wraps this in a try/catch to maintain the contract
 * that evaluate() never throws.
 */
function evalNode(n: Expr, env: EvalEnv): Value {
  switch (n.kind) {
    case 'lit':
      return n.value;

    case 'var': {
      if (n.name === 'time') return env.time;
      if (n.name === 'sceneIndex') return env.sceneIndex;
      if (n.name === 'sceneTime') return env.sceneTime;
      const v = env.vars.get(n.name);
      if (v === undefined) throw new Error(`unknown variable "${n.name}"`);
      return v;
    }

    case 'call': {
      if (n.name === 'random') return env.random();
      const lookup = n.name === 'xOf' ? env.objectX : env.objectY;
      const v = lookup?.(n.arg ?? '');
      if (v === undefined) throw new Error(`${n.name}: unknown object "${n.arg ?? ''}"`);
      return v;
    }

    case 'unary': {
      const v = evalNode(n.expr, env);
      if (n.op === '-') {
        if (typeof v !== 'number') throw new Error('unary - needs a number');
        return -v;
      }
      // n.op === '!'
      if (typeof v !== 'boolean') throw new Error('! needs a boolean');
      return !v;
    }

    case 'binary': {
      // Short-circuit logical operators
      if (n.op === '&&' || n.op === '||') {
        const l = evalNode(n.left, env);
        if (typeof l !== 'boolean') throw new Error(`${n.op} needs booleans`);
        if (n.op === '&&' && !l) return false;
        if (n.op === '||' && l) return true;
        const r = evalNode(n.right, env);
        if (typeof r !== 'boolean') throw new Error(`${n.op} needs booleans`);
        return r;
      }

      // Evaluate both sides for all other operators
      const l = evalNode(n.left, env);
      const r = evalNode(n.right, env);

      switch (n.op) {
        case '+': {
          // String concatenation if either side is a string (but not if booleans mix in)
          if (typeof l === 'string' || typeof r === 'string') {
            if (typeof l === 'boolean' || typeof r === 'boolean') {
              throw new Error('+ cannot mix booleans');
            }
            return String(l) + String(r);
          }
          // Numeric addition
          if (typeof l !== 'number' || typeof r !== 'number') {
            throw new Error('+ cannot mix booleans');
          }
          return l + r;
        }

        case '-':
        case '*':
        case '/':
        case '%': {
          if (typeof l !== 'number' || typeof r !== 'number') {
            throw new Error(`${n.op} needs numbers`);
          }
          if ((n.op === '/' || n.op === '%') && r === 0) {
            throw new Error('division by zero');
          }
          if (n.op === '-') return l - r;
          if (n.op === '*') return l * r;
          if (n.op === '/') return l / r;
          return l % r;
        }

        case '==':
          return typeof l === typeof r ? l === r : false;

        case '!=':
          return typeof l === typeof r ? l !== r : true;

        case '<':
        case '<=':
        case '>':
        case '>=': {
          if (typeof l !== 'number' || typeof r !== 'number') {
            throw new Error(`${n.op} needs numbers`);
          }
          if (n.op === '<') return l < r;
          if (n.op === '<=') return l <= r;
          if (n.op === '>') return l > r;
          return l >= r;
        }

        default:
          throw new Error(`unknown operator: ${n.op}`);
      }
    }

    case 'ternary': {
      const c = evalNode(n.cond, env);
      if (typeof c !== 'boolean') throw new Error('?: condition needs a boolean');
      return evalNode(c ? n.then : n.else, env);
    }
  }
}
