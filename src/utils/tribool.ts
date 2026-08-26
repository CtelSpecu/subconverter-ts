/**
 * tribool.ts — three-state boolean semantics for subconverter
 *
 * Port of src/utils/tribool.h used throughout interfaces.cpp extra_settings.
 *
 * C++ tribool has three states: true / false / undef (indeterminate).
 * Priority chain semantics: `ext.x.define(arg).define(global)` means
 * "parameter wins, otherwise fall back to global, otherwise remain undef".
 * Output often checks `is_undef()` to distinguish "unset" from "explicitly false".
 *
 * TypeScript representation:
 *   Tribool = boolean | undefined   where `undefined` means undef
 */

export type Tribool = boolean | undefined;

/**
 * Parse a tribool from a URL query argument string.
 *
 * Mirrors C++: `tribool(getUrlArg(...))` where `getUrlArg` returns a string
 * and an empty string means "argument not present" → undef.
 *
 * Rules:
 *   - `undefined` or `""`  → `undefined` (undef)
 *   - case-insensitive `"true"` or `"1"` → `true`
 *   - case-insensitive `"false"` or `"0"` → `false`
 *   - any other value → `undefined` (undef, not an error)
 */
export function parseTribool(val: string | undefined): Tribool {
  if (val === undefined || val === '') {
    return undefined;
  }
  const lower = val.toLowerCase();
  if (lower === 'true' || lower === '1') {
    return true;
  }
  if (lower === 'false' || lower === '0') {
    return false;
  }
  return undefined;
}

/**
 * Define-chain helper: `a` wins if defined, otherwise `b` if defined,
 * otherwise undef.
 *
 * Equivalent to C++ `tribool::define` / `define` chain used as:
 * `ext.x.define(arg).define(global)`
 *
 * Overloaded to accept a plain `boolean` as `b` (common when the global
 * fallback is a non-tribool `bool` like `global.addEmoji`).
 *
 * @param a - higher-priority tribool
 * @param b - lower-priority tribool or plain boolean
 * @returns `a` if `a !== undefined`, else `b` if `b !== undefined`, else `undefined`
 */
export function triboolDefine(a: Tribool, b: Tribool | boolean | undefined): Tribool {
  if (a !== undefined) {
    return a;
  }
  if (b !== undefined) {
    return b;
  }
  return undefined;
}

/**
 * Resolve a tribool to a definite boolean with a default fallback.
 *
 * Equivalent to C++ `.get(def)` / `bool(tribool)` with default.
 *
 * @param val - tribool value
 * @param def - fallback when `val` is undef
 * @returns `val` if defined, otherwise `def`
 */
export function triboolGet(val: Tribool, def: boolean): boolean {
  return val !== undefined ? val : def;
}

/**
 * OOP wrapper around {@link Tribool} for call sites that prefer method chaining.
 *
 * Mirrors C++ `tribool` object API:
 *  - construction from a query string (`"true"/"1"/"false"/"0"/""`) or a boolean
 *  - `define(other)` → "this if defined, else other"
 *  - `get(def)` → definite boolean
 *  - `isUndef()` → true when value is `undefined`
 *
 * Define-chain example (mirrors `ext.x.define(arg).define(global)`):
 * ```ts
 * const result = new TriboolWrapper(urlArg).define(globalFlag).get(false);
 * ```
 */
export class TriboolWrapper {
  value: Tribool;

  constructor(v?: string | boolean) {
    if (v === undefined || v === '') {
      this.value = undefined;
    } else if (typeof v === 'string') {
      this.value = parseTribool(v);
    } else {
      // boolean (including false) — already a concrete value
      this.value = v;
    }
  }

  /**
   * Define-chain: return a new wrapper whose value is `this.value` if defined,
   * otherwise `other` if defined, otherwise undef.
   *
   * Does not mutate `this`; returns a new {@link TriboolWrapper} so that
   * chains like `a.define(b).define(c)` are pure and composable.
   */
  define(other: Tribool | boolean | undefined): TriboolWrapper {
    const resolved = triboolDefine(this.value, other);
    return new TriboolWrapper(resolved);
  }

  /**
   * Resolve to a definite boolean, using `def` when undef.
   * Equivalent to `triboolGet(this.value, def)`.
   */
  get(def: boolean): boolean {
    return triboolGet(this.value, def);
  }

  /**
   * True when the tribool is in the undef state (`undefined`).
   * Equivalent to C++ `is_undef()`.
   */
  isUndef(): boolean {
    return this.value === undefined;
  }
}
