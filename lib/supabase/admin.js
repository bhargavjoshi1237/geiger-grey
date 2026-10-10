import "server-only";
import { createClient } from "@supabase/supabase-js";

export function isAdminConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

// Service-role client for route handlers only.
export function adminClient() {
  if (!isAdminConfigured()) return null;
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    db: { schema: "grey" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
