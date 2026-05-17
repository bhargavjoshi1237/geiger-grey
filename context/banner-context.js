"use client";

import React, { createContext, useContext, useState, useCallback } from "react";

const BannerContext = createContext();

export function BannerProvider({ children }) {
  const [banner, setBanner] = useState({
    isVisible: false,
    message: "",
    type: "warning",
    isSticky: false,
    link: null,
  });

  const showBanner = useCallback((config) => {
    setBanner({
      isVisible: true,
      message: config.message || "",
      type: config.type || "warning",
      isSticky: config.isSticky ?? false,
      link: config.link || null,
    });
  }, []);

  const hideBanner = useCallback(() => {
    setBanner((prev) => ({ ...prev, isVisible: false }));
  }, []);

  return (
    <BannerContext.Provider value={{ banner, showBanner, hideBanner }}>
      {children}
    </BannerContext.Provider>
  );
}

export function useBanner() {
  const context = useContext(BannerContext);
  if (context === undefined) {
    throw new Error("useBanner must be used within a BannerProvider");
  }
  return context;
}
