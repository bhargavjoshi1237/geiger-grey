"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

// Copy-to-clipboard with a short-lived `copied` flag for swapping a Copy icon to a Check.
// -> { copied, copy(text) }
export function useCopy({ resetMs = 1500, successMessage = "Copied" } = {}) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef(null);

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );

  const copy = useCallback(
    async (text) => {
      try {
        await navigator.clipboard.writeText(text ?? "");
        setCopied(true);
        if (successMessage) toast.success(successMessage);
        if (resetTimer.current) clearTimeout(resetTimer.current);
        resetTimer.current = setTimeout(() => {
          resetTimer.current = null;
          setCopied(false);
        }, resetMs);
      } catch (error) {
        console.error("[use-copy]", error);
        toast.error("Couldn't copy");
      }
    },
    [resetMs, successMessage],
  );

  return { copied, copy };
}
