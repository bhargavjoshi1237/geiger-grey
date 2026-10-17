"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { NotificationBell, defaultNavigate } from "@geiger/notify/react";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { BASE_PATH } from "@/lib/base_path";

function announce(notification) {
  toast(notification.title, { description: notification.body || undefined });
}

function isMissingSchemaError(error) {
  const message = error?.message || "";
  return error?.code === "PGRST106" || message.includes("Invalid schema");
}

function reportError(error, scope) {
  // Schema not exposed (yet) — the bell stays hidden, so don't toast.
  if (isMissingSchemaError(error)) return;
  if (scope !== "realtime") toast.error(error.message);
}

// Suite notification bell (all Geiger apps) on this app's session client.
// No Supabase env → no session to subscribe with, so render nothing instead
// of letting the bell try to connect.
// The `notify` schema is owned by geiger-dash and must be listed under
// Supabase Settings → API → Exposed schemas. While it isn't exposed,
// PostgREST answers every notify query with PGRST106 "Invalid schema:
// notify" — probe once and stay hidden instead of spamming console/toasts.
export function NotificationsBell() {
  const router = useRouter();
  const [supabase] = useState(() => (isSupabaseConfigured() ? createClient() : null));
  const [notifyAvailable, setNotifyAvailable] = useState(null);

  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    supabase
      .schema("notify")
      .from("inbox")
      .select("id")
      .limit(1)
      .then(({ error }) => {
        if (!alive) return;
        if (isMissingSchemaError(error)) {
          console.warn(
            "[notify] schema not exposed on this Supabase project — hiding the notification bell. " +
              "Fix: Supabase Dashboard → Settings → API → Exposed schemas → add `notify` (owned by geiger-dash).",
          );
          setNotifyAvailable(false);
        } else {
          setNotifyAvailable(true);
        }
      })
      .catch(() => {
        // Probe couldn't reach PostgREST — let the bell mount and surface real errors itself.
        if (alive) setNotifyAvailable(true);
      });
    return () => {
      alive = false;
    };
  }, [supabase]);

  if (!supabase || notifyAvailable !== true) return null;

  // Links inside Grey stay client-side; other suite apps load through the shared origin.
  const navigate = (url) => {
    if (BASE_PATH && (url === BASE_PATH || url.startsWith(`${BASE_PATH}/`) || url.startsWith(`${BASE_PATH}?`))) {
      router.push(url.slice(BASE_PATH.length) || "/");
    } else {
      defaultNavigate(url);
    }
  };

  return (
    <NotificationBell
      supabase={supabase}
      app="grey"
      className="hidden sm:inline-flex"
      onReceive={announce}
      onError={reportError}
      onNavigate={navigate}
    />
  );
}
