import { createBrowserClient } from "@supabase/ssr";

let browserClient = null;

// Browser client pinned to the grey schema; use .schema("public") for suite tables.
export function createClient() {
  if (browserClient) return browserClient;
  browserClient = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { db: { schema: "grey" } },
  );
  return browserClient;
}
