import { describe, expect, test } from 'bun:test';
import { stableJson } from '../../src/util/stable-json';

describe('util.stable-json', () => {
  test('stableJson sorts keys recursively and is deterministic', () => {
    const a = { b: 1, a: { d: 1, c: 2 } };
    const b = { a: { c: 2, d: 1 }, b: 1 };
    expect(stableJson(a)).toBe(stableJson(b));
    expect(stableJson(a)).toBe('{"a":{"c":2,"d":1},"b":1}');
  });
});
