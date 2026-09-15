// Env gate for the cloud feature: both VITE_ vars present -> configured. Absent (self-hosted /
// local dev without a Supabase project) -> null, and every cloud command stays hidden
// (commandCapabilities().cloudConfigured gates visibility — packages/ui-core/src/commands/registry.ts).
export function cloudConfig(): { url: string; key: string } | null {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  return { url, key };
}
