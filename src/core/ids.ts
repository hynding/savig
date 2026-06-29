/** Deterministic, reproducible id generation for headless/agent authoring.
 *
 * `newId()` (engine) returns a random UUID — right for humans, wrong for agents: a short authored
 * twice would differ byte-for-byte, can't be diffed, and ids can't be predicted to reference later.
 * `createIdFactory` returns a sequential generator so a whole short is reproducible from scratch. */
export function createIdFactory(prefix = 'o'): () => string {
  let n = 0;
  return () => `${prefix}${++n}`;
}
