import { BASE_PATH } from "@/lib/base_path";
import { createClient } from "@/lib/supabase/client";

async function authHeaders() {
  const { data: { session } } = await createClient().auth.getSession();
  return {
    "Content-Type": "application/json",
    ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
  };
}

// Calls a Grey route handler with the caller's Supabase access token. On failure, `error` is the
// route's error code and `message` its human-readable message (when the route sent one).
export async function apiFetch(path, { method = "GET", body } = {}) {
  try {
    const res = await fetch(`${BASE_PATH}/api${path}`, {
      method,
      headers: await authHeaders(),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { data: null, error: json.error || `HTTP ${res.status}`, message: json.message || null };
    return { data: json, error: null };
  } catch (error) {
    console.error("[api.fetch]", error);
    return { data: null, error: "network_error", message: "Couldn't reach the server. Check your connection and try again." };
  }
}

// Calls a Grey route that streams NDJSON events, handing each parsed event to onEvent as it
// arrives. Resolves once the stream ends: { error: null } on success, { error, code } when the
// request was rejected before streaming (error is the route's human-readable message), or
// { error: null, aborted: true } when `signal` cancelled it. Events carry their own errors.
export async function apiStream(path, { method = "POST", body, onEvent, signal } = {}) {
  try {
    const res = await fetch(`${BASE_PATH}/api${path}`, {
      method,
      headers: await authHeaders(),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
    if (!res.ok || !res.body) {
      const json = await res.json().catch(() => ({}));
      return { error: json.message || json.error || `HTTP ${res.status}`, code: json.error || null };
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const emit = (line) => {
      if (!line.trim()) return;
      try {
        onEvent?.(JSON.parse(line));
      } catch (error) {
        console.error("[api.stream.event]", error);
      }
    };
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        emit(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
      }
    }
    emit(buffer + decoder.decode());
    return { error: null };
  } catch (error) {
    if (error?.name === "AbortError") return { error: null, aborted: true };
    console.error("[api.stream]", error);
    return { error: "Couldn't reach the server. Check your connection and try again.", code: "network_error" };
  }
}
