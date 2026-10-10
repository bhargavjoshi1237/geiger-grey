"use client";

import { useLayoutEffect, useRef } from "react";

const PREFIX = "geiger-grey:shell";

const memory = new Map();

function storageKey(name, projectId) {
  return `${PREFIX}:${name}:${projectId}`;
}

function readShellCache(name, projectId) {
  if (!name || !projectId) return null;
  const key = storageKey(name, projectId);
  if (memory.has(key)) return memory.get(key);
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (!entry || typeof entry !== "object" || !("value" in entry)) return null;
    memory.set(key, entry);
    return entry;
  } catch {
    return null;
  }
}

export function writeShellCache(name, projectId, userId, value) {
  if (!name || !projectId) return;
  const key = storageKey(name, projectId);
  const entry = { userId: userId ?? null, value };
  memory.set(key, entry);
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(entry));
  } catch {
  }
}

export function usePaintFromShellCache(name, projectId, apply) {
  const seededFor = useRef(null);

  useLayoutEffect(() => {
    const key = `${name}:${projectId}`;
    if (!projectId || seededFor.current === key) return;
    seededFor.current = key;
    const entry = readShellCache(name, projectId);
    if (entry) apply(entry);
  }, [name, projectId, apply]);
}

export function sameStringList(a, b) {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((value, i) => value === b[i]);
}
