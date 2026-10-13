/** A new unique id for projects, tracks, clips and sources. */
export function newId(): string {
  return crypto.randomUUID();
}
