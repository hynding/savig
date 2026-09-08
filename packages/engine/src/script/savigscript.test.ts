import { describe, it, expect } from 'vitest';
import { parse, evaluate, type Value, type EvalEnv } from './index';

// Test helper
const run = (src: string, vars: Record<string, Value> = {}, env: Partial<EvalEnv> = {}) => {
  const p = parse(src);
  if (!p.ok) return p;
  return evaluate(p.ast, {
    vars: new Map(Object.entries(vars)),
    time: 0,
    sceneIndex: 0,
    sceneTime: 0,
    random: () => 0.5,
    ...env,
  });
};

describe('SavigScript', () => {
  describe('literals & precedence', () => {
    it('1 + 2 * 3', () => {
      const result = run('1 + 2 * 3');
      expect(result).toEqual({ ok: true, value: 7 });
    });

    it('(1 + 2) * 3', () => {
      const result = run('(1 + 2) * 3');
      expect(result).toEqual({ ok: true, value: 9 });
    });

    it('10 % 3', () => {
      const result = run('10 % 3');
      expect(result).toEqual({ ok: true, value: 1 });
    });

    it('-4 + 1', () => {
      const result = run('-4 + 1');
      expect(result).toEqual({ ok: true, value: -3 });
    });

    it('1 < 2 == true', () => {
      const result = run('1 < 2 == true');
      expect(result).toEqual({ ok: true, value: true });
    });

    it('true ? 1 : false ? 2 : 3 (ternary right-assoc)', () => {
      const result = run('true ? 1 : false ? 2 : 3');
      expect(result).toEqual({ ok: true, value: 1 });
    });
  });

  describe('strings', () => {
    it("'a' + 1", () => {
      const result = run("'a' + 1");
      expect(result).toEqual({ ok: true, value: 'a1' });
    });

    it('"x" + "y"', () => {
      const result = run('"x" + "y"');
      expect(result).toEqual({ ok: true, value: 'xy' });
    });

    it("'it\\'s' + \"\\n\"", () => {
      const result = run("'it\\'s' + \"\\n\"");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe("it's\n");
      }
    });

    it("parse('bad\\q') error", () => {
      const result = parse("'bad\\q'");
      expect(result.ok).toBe(false);
      expect(result).toHaveProperty('pos');
    });
  });

  describe('booleans & logic', () => {
    it('true && false', () => {
      const result = run('true && false');
      expect(result).toEqual({ ok: true, value: false });
    });

    it('false && (1 / 0 > 0) - short-circuit', () => {
      const result = run('false && (1 / 0 > 0)');
      expect(result).toEqual({ ok: true, value: false });
    });

    it('true || undeclared - short-circuit', () => {
      const result = run('true || undeclared');
      expect(result).toEqual({ ok: true, value: true });
    });

    it('!false', () => {
      const result = run('!false');
      expect(result).toEqual({ ok: true, value: true });
    });
  });

  describe('coercion errors (spec §4 table)', () => {
    it('true + 1 error', () => {
      const result = run('true + 1');
      expect(result.ok).toBe(false);
    });

    it("'a' - 1 error", () => {
      const result = run("'a' - 1");
      expect(result.ok).toBe(false);
    });

    it('1 / 0 error', () => {
      const result = run('1 / 0');
      expect(result.ok).toBe(false);
    });

    it("1 == 'a' returns false", () => {
      const result = run("1 == 'a'");
      expect(result).toEqual({ ok: true, value: false });
    });

    it("1 != 'a' returns true", () => {
      const result = run("1 != 'a'");
      expect(result).toEqual({ ok: true, value: true });
    });

    it("'a' < 'b' error", () => {
      const result = run("'a' < 'b'");
      expect(result.ok).toBe(false);
    });

    it('1 && true error', () => {
      const result = run('1 && true');
      expect(result.ok).toBe(false);
    });

    it('1 ? 2 : 3 error', () => {
      const result = run('1 ? 2 : 3');
      expect(result.ok).toBe(false);
    });
  });

  describe('variables & builtins', () => {
    it('score + 1 with vars', () => {
      const result = run('score + 1', { score: 2 });
      expect(result).toEqual({ ok: true, value: 3 });
    });

    it('missing variable error', () => {
      const result = run('missing');
      expect(result.ok).toBe(false);
    });

    it('time + sceneTime with env', () => {
      const result = run('time + sceneTime', {}, { time: 2, sceneTime: 1 });
      expect(result).toEqual({ ok: true, value: 3 });
    });

    it('random() < 1', () => {
      const result = run('random() < 1');
      expect(result).toEqual({ ok: true, value: true });
    });

    it('random(1) parse error', () => {
      const result = parse('random(1)');
      expect(result.ok).toBe(false);
    });

    it('foo() parse error', () => {
      const result = parse('foo()');
      expect(result.ok).toBe(false);
    });
  });

  describe('caps & errors', () => {
    it('depth cap via binary chain (1+1 repeated 40 times, under 500 char limit)', () => {
      const result = parse('1' + '+1'.repeat(40));
      expect(result.ok).toBe(false);
    });

    it('binary chain under depth cap (1+1 repeated 10 times)', () => {
      const result = parse('1' + '+1'.repeat(10));
      expect(result.ok).toBe(true);
    });

    it('source length cap 500', () => {
      const result = parse('x'.repeat(501));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.pos).toBe(500);
      }
    });

    it('paren nesting depth cap', () => {
      const result = parse('('.repeat(40) + '1' + ')'.repeat(40));
      expect(result.ok).toBe(false);
    });

    it('burial shape: leading op + deep chain + trailing ops', () => {
      // '1+' + (25 multiplications) + (25 additions)
      // This creates an AST where a deep chain is buried as a right operand
      const burial = '1+' + Array(25).fill('1').join('*') + '+1'.repeat(25);
      const result = parse(burial);
      expect(result.ok).toBe(false);
    });

    it('borderline: depth exactly 32 should pass', () => {
      // 31 unary negations + 1 literal = depth 32
      const result = parse('-'.repeat(31) + '1');
      expect(result.ok).toBe(true);
    });

    it('borderline: depth 33 should fail', () => {
      // 32 unary negations + 1 literal = depth 33
      const result = parse('-'.repeat(32) + '1');
      expect(result.ok).toBe(false);
    });

    it('sanity check: simple expression with mixed precedence', () => {
      const result = parse('1+2*3+4*5+6');
      expect(result.ok).toBe(true);
    });

    it('incomplete expression', () => {
      const result = parse('1 +');
      expect(result.ok).toBe(false);
    });

    it('unclosed paren', () => {
      const result = parse('(1 + 2');
      expect(result.ok).toBe(false);
    });
  });

  describe('forbidden forms', () => {
    it('a.b parse error', () => {
      const result = parse('a.b');
      expect(result.ok).toBe(false);
    });

    it('a[0] parse error', () => {
      const result = parse('a[0]');
      expect(result.ok).toBe(false);
    });

    it('a = 1 parse error', () => {
      const result = parse('a = 1');
      expect(result.ok).toBe(false);
    });
  });
});
