// Module-ref registry (the `stageCursor`/`textMeasure` precedent): env-derived, static-per-session
// facts that commands may gate their `visible` predicate on. The app bootstrap sets these once
// (e.g. from `cloudConfig() !== null`); unregistered ⇒ every flag defaults to its safe (off) value.
export interface CommandCapabilities {
  cloudConfigured: boolean;
}

let caps: CommandCapabilities = { cloudConfigured: false };

export function setCommandCapabilities(next: Partial<CommandCapabilities>): void {
  caps = { ...caps, ...next };
}

export function commandCapabilities(): CommandCapabilities {
  return caps;
}
