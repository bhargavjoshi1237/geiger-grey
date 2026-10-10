"use client";

import { useLayoutEffect, useRef } from "react";

const PREFIX = "geiger-grey:shell";
// The last signed-in user, so the synchronous first paint can pick that user's entries.
const USER_KEY = `${PREFIX}:user`;

const memory = new Map();
let memoryUser;

function storageKey(name, projectId, userId) {
  return `${PREFIX}:${name}:${projectId}:${userId}`;
}

function lastUserId() {
  if (memoryUser !== undefined) return memoryUser;
  if (typeof window === "undefined") return null;
  try {
    memoryUser = window.localStorage.getItem(USER_KEY) || null;
  } catch {
    memoryUser = null;
  }
  return memoryUser;
}

function readShellCache(name, projectId) {
  const userId = lastUserId();
  if (!name || !projectId || !userId) return null;
  const key = storageKey(name, projectId, userId);
  if (memory.has(key)) return memory.get(key);
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (!entry || typeof entry !== "object" || !("value" in entry) || entry.userId !== userId) return null;
    memory.set(key, entry);
    return entry;
  } catch {
    return null;
  }
}

// Entries are keyed by project and user, so one browser never paints another user's shell.
export function writeShellCache(name, projectId, userId, value) {
  if (!name || !projectId || !userId) return;
  const key = storageKey(name, projectId, userId);
  const entry = { userId, value };
  memory.set(key, entry);
  memoryUser = userId;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(USER_KEY, userId);
    window.localStorage.setItem(key, JSON.stringify(entry));
  } catch {
  }
}

// Forget the signed-in user on sign-out so the next user's first paint starts clean.
export function clearShellCacheUser() {
  memory.clear();
  memoryUser = null;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(USER_KEY);
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
