/**
 * Own-property map lookup.
 *
 * `MAP[key] ?? fallback` is the idiom this replaces, and it has a hole: every
 * object literal inherits `toString`, `constructor`, `valueOf`,
 * `hasOwnProperty` and friends from `Object.prototype`. A lookup with one of
 * those as the key returns a FUNCTION, which is neither `null` nor `undefined`,
 * so `??` (and a plain truthiness test) hands it straight through. The caller
 * then treats a function as its value type.
 *
 * What that costs depends on the call site, and both shapes are live here:
 *
 *   - a value that gets INTERPOLATED into output — `presentLabel('toString')`
 *     writes `function toString() { [native code] }` into an exported date, and
 *     a divider width did the same into the preview's `<style>` block;
 *   - a value that gets USED — `slotsFor('toString').map(…)` is a TypeError, so
 *     a crafted view crashes the exporter rather than rendering a default.
 *
 * Neither needs prototype pollution. The key is enough, and keys reach these
 * maps from stored resume/view JSON, which arrives from imports and backups.
 *
 * `Object.hasOwn` would say this in one call, but the client targets ES2020
 * (see tsconfig), so it is the `Object.prototype.hasOwnProperty.call` form.
 *
 * `NoInfer` on the fallback so the value type comes from the MAP: without it
 * `lookup(SECTION_EXTRAS, key, [])` infers `never[]` from the empty literal.
 *
 * Pure module, zero imports — safe to use from any layer.
 */

/**
 * `map[key]` when `key` is the map's OWN property, else `fallback`.
 *
 * Prefer this over `map[key] ?? fallback` wherever `key` can come from data
 * rather than from a literal in the same file.
 */
export function lookup<T>(
  map: Readonly<Record<string, T>>, key: string, fallback: NoInfer<T>,
): T {
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : fallback
}
