"use client";

import React from "react";
import { useBanner } from "@/context/banner-context";
import { AlertCircle, X, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

export function GlobalBanner() {
  const { banner, hideBanner } = useBanner();

  if (!banner.isVisible) return null;

  const themes = {
    warning: {
      bg: "linear-gradient(45deg, #7c2d12 25%, #9a3412 25%, #9a3412 50%, #7c2d12 50%, #7c2d12 75%, #9a3412 75%, #9a3412 100%)",
      border: "#b45309",
      text: "#ffedd5",
      iconBg: "bg-orange-950/40",
      iconColor: "#e7e7e7",
      linkDecoration: "decoration-orange-300/40",
    },
    info: {
      bg: "linear-gradient(45deg, #1e3a8a 25%, #1d4ed8 25%, #1d4ed8 50%, #1e3a8a 50%, #1e3a8a 75%, #1d4ed8 75%, #1d4ed8 100%)",
      border: "#1d4ed8",
      text: "#dbeafe",
      iconBg: "bg-blue-950/40",
      iconColor: "#e7e7e7",
      linkDecoration: "decoration-blue-300/40",
    },
  };

  const currentTheme = themes[banner.type] || themes.warning;

  return (
    <div
      className={cn(
        "relative w-full border-b px-4 py-2.5 flex items-center justify-center gap-3 transition-all duration-500 animate-in fade-in slide-in-from-top-full z-[100]",
      )}
      style={{
        background: currentTheme.bg,
        backgroundSize: "32px 32px",
        borderColor: currentTheme.border,
        color: currentTheme.text,
      }}
    >
      <div className="flex items-center gap-3 max-w-7xl mx-auto w-full justify-center">
        <div
          className={cn(
            "flex items-center justify-center w-5 h-5 rounded flex-shrink-0",
            currentTheme.iconBg,
          )}
        >
          <AlertCircle className={cn("w-3.5 h-3.5", currentTheme.iconColor)} />
        </div>
        <div className="flex items-center gap-2 text-[13px] font-semibold tracking-tight leading-none">
          <span className="translate-y-[0.5px] -mt-1.5">{banner.message}</span>
          {banner.link && (
            <>
              <span className="opacity-40 font-normal">·</span>
              <a
                href={banner.link.url}
                className={cn(
                  "hover:text-white transition-colors underline underline-offset-4 font-bold flex items-center gap-1.5",
                  currentTheme.linkDecoration,
                )}
                target="_blank"
                rel="noopener noreferrer"
              >
                {banner.link.text}
              </a>
            </>
          )}
        </div>
      </div>

      {banner.isSticky && (
        <button
          onClick={hideBanner}
          className="absolute right-4 p-1.5 rounded-full hover:bg-white/10 transition-all active:scale-95 flex items-center justify-center"
          aria-label="Close banner"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
