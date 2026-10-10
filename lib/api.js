import { BASE_PATH } from "@/lib/base_path";
import { createClient } from "@/lib/supabase/client";

// Calls a Grey route handler with the caller's Supabase access token.
export async function apiFetch(path, { method = "GET", body } = {}) {
  try {
    const { data: { session } } = await createClient().auth.getSession();
    const res = await fetch(`${BASE_PATH}/api${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { data: null, error: json.error || `HTTP ${res.status}` };
    return { data: json, error: null };
  } catch (error) {
    console.error("[api.fetch]", error);
    return { data: null, error: "network_error" };
  }
}
