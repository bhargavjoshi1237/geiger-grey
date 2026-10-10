"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { NotificationBell, defaultNavigate } from "@geiger/notify/react";
import { createClient } from "@/lib/supabase/client";
import { BASE_PATH } from "@/lib/base_path";

function announce(notification) {
  toast(notification.title, { description: notification.body || undefined });
}

function reportError(error, scope) {
  if (scope !== "realtime") toast.error(error.message);
}

// Suite notification bell (all Geiger apps) on this app's session client.
export function NotificationsBell() {
  const router = useRouter();
  const [supabase] = useState(createClient);

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
