export type Result<T = void> =
  { ok: true; value: T; warnings?: string[] } | { ok: false; error: string }; // error = user-facing message from MSG (§9.4)

/** Success with a value; `warnings` are shown as warning toasts by the UI. */
export function ok<T>(value: T, warnings?: string[]): Result<T> {
  return warnings === undefined ? { ok: true, value } : { ok: true, value, warnings };
}

/** Success with no value. */
export function done(warnings?: string[]): Result<void> {
  return ok(undefined, warnings);
}

/** Failure; `error` must be a message from MSG. Assignable to any Result<T>. */
export function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}
