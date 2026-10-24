"use client";

import React, { useEffect, useRef, useState } from "react";
import { Check, Crop, Loader2, RotateCcw, X } from "lucide-react";

import { Button } from "@geiger/ui/button";
import { Dropzone } from "@/components/internal/shared/dropzone";
import { cn } from "@/lib/utils";
import { IMAGE_LIMITS } from "@/lib/grey/image_input";
import { Notice } from "./tool_result";

const ACCEPT = "image/jpeg,image/png,image/webp";
// Decoding a huge file can stall the tab; anything this big is rejected before it's read.
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const JPEG_QUALITY = 0.9;
// Smallest selection (share of each side) "Use selection" accepts.
const MIN_SELECTION = 0.03;

const clamp01 = (n) => Math.min(1, Math.max(0, n));

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("decode_failed"));
    img.src = url;
  });
}

// Draws `region` (in the image's own pixels) onto a canvas no larger than `maxSide` on its long
// side — never enlarged — flattened onto white, and encodes it as JPEG.
// -> { data /* bare base64 */, mimeType, previewUrl, width, height }
function encodeRegion(img, region, maxSide = IMAGE_LIMITS.clientMaxSide) {
  const scale = Math.min(1, maxSide / Math.max(region.width, region.height));
  const width = Math.max(1, Math.round(region.width * scale));
  const height = Math.max(1, Math.round(region.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, region.x, region.y, region.width, region.height, 0, 0, width, height);
  const previewUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  return { data: previewUrl.slice(previewUrl.indexOf(",") + 1), mimeType: "image/jpeg", previewUrl, width, height };
}

const fullRegion = (img) => ({ x: 0, y: 0, width: img.naturalWidth, height: img.naturalHeight });

/**
 * One image for a tool run. The browser downsizes it to IMAGE_LIMITS.clientMaxSide on the long side
 * (JPEG) and the preview shows exactly what is sent. Optional crop: drag a rectangle, then "Use
 * selection" crops the full-resolution original before downsizing.
 * value / onChange: { data, mimeType: "image/jpeg", previewUrl, width, height } | null
 */
export function ImageInput({ value, onChange, disabled = false, compact = false, hint }) {
  // The decoded original and its object URL — read only in handlers.
  const originalRef = useRef(null);
  const areaRef = useRef(null);
  const dragRef = useRef(null);
  const [full, setFull] = useState(null); // { value, name } — the uncropped encoding
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [cropping, setCropping] = useState(false);
  const [selection, setSelection] = useState(null); // { x, y, w, h } as shares of the image
  const [cropped, setCropped] = useState(false);

  // The parent cleared the value: drop the original too.
  if (!value && full && !busy) {
    setFull(null);
    setCropping(false);
    setSelection(null);
    setCropped(false);
  }

  useEffect(
    () => () => {
      if (originalRef.current?.url) URL.revokeObjectURL(originalRef.current.url);
    },
    [],
  );

  const release = () => {
    if (originalRef.current?.url) URL.revokeObjectURL(originalRef.current.url);
    originalRef.current = null;
  };

  const handleFiles = async (files) => {
    const file = files?.[0];
    if (!file) return;
    setError(null);
    if (file.size > MAX_FILE_BYTES) {
      setError("Choose an image under 25 MB.");
      return;
    }
    setBusy(true);
    release();
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImage(url);
      originalRef.current = { img, url };
      const encoded = encodeRegion(img, fullRegion(img));
      setFull({ value: encoded, name: file.name || "Image" });
      setCropped(false);
      setCropping(false);
      setSelection(null);
      onChange?.(encoded);
    } catch {
      URL.revokeObjectURL(url);
      setError("This image couldn't be read. Use a JPEG, PNG or WebP file.");
      onChange?.(null);
    } finally {
      setBusy(false);
    }
  };

  const remove = () => {
    release();
    setFull(null);
    setCropping(false);
    setSelection(null);
    setCropped(false);
    setError(null);
    onChange?.(null);
  };

  const pointAt = (event) => {
    const rect = areaRef.current.getBoundingClientRect();
    return {
      x: clamp01((event.clientX - rect.left) / rect.width),
      y: clamp01((event.clientY - rect.top) / rect.height),
    };
  };

  const onPointerDown = (event) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = pointAt(event);
    dragRef.current = start;
    setSelection({ x: start.x, y: start.y, w: 0, h: 0 });
  };

  const onPointerMove = (event) => {
    const start = dragRef.current;
    if (!start) return;
    const point = pointAt(event);
    setSelection({
      x: Math.min(start.x, point.x),
      y: Math.min(start.y, point.y),
      w: Math.abs(point.x - start.x),
      h: Math.abs(point.y - start.y),
    });
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

  const selectionUsable = selection && selection.w >= MIN_SELECTION && selection.h >= MIN_SELECTION;

  const applySelection = () => {
    const img = originalRef.current?.img;
    if (!img || !selectionUsable) return;
    const { naturalWidth: w, naturalHeight: h } = img;
    const region = {
      x: Math.round(selection.x * w),
      y: Math.round(selection.y * h),
      width: Math.max(1, Math.round(selection.w * w)),
      height: Math.max(1, Math.round(selection.h * h)),
    };
    onChange?.(encodeRegion(img, region));
    setCropped(true);
    setCropping(false);
    setSelection(null);
  };

  const cancelCrop = () => {
    setCropping(false);
    setSelection(null);
  };

  const reset = () => {
    if (full) onChange?.(full.value);
    setCropped(false);
    setCropping(false);
    setSelection(null);
  };

  const outlineButton =
    "border-border bg-transparent text-muted-foreground hover:bg-surface-active hover:text-foreground";

  if (busy) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-surface-subtle py-10 text-sm text-text-secondary">
        <Loader2 className="h-4 w-4 animate-spin" /> Preparing image…
      </div>
    );
  }

  if (!value) {
    return (
      <div className="space-y-2">
        <Dropzone
          accept={ACCEPT}
          disabled={disabled}
          onFiles={handleFiles}
          hint={hint || `JPEG, PNG or WebP. Resized to ${IMAGE_LIMITS.clientMaxSide} px on the long side before it's sent.`}
          className={compact ? "py-6" : undefined}
        />
        {error ? <Notice tone="danger">{error}</Notice> : null}
      </div>
    );
  }

  const shown = cropping && full ? full.value : value;

  return (
    <div className="space-y-2">
      <div className="flex justify-center rounded-xl border border-border bg-surface-card p-2">
        <div className="relative inline-block max-w-full overflow-hidden rounded-lg">
          <img
            src={shown.previewUrl}
            alt={cropping ? "Original image — drag to select a part" : "The image that will be sent"}
            className={cn("block max-w-full select-none object-contain", compact ? "max-h-48" : "max-h-80")}
            draggable={false}
          />
          {cropping ? (
            <div
              ref={areaRef}
              aria-hidden="true"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              className="absolute inset-0 cursor-crosshair touch-none"
            >
              {selection ? (
                <div
                  className="pointer-events-none absolute border-2 border-primary shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"
                  style={{
                    left: `${selection.x * 100}%`,
                    top: `${selection.y * 100}%`,
                    width: `${selection.w * 100}%`,
                    height: `${selection.h * 100}%`,
                  }}
                />
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 truncate text-xs text-text-tertiary">
          {cropping
            ? "Drag across the image to select the part to search with."
            : `${full?.name ? `${full.name} · ` : ""}${value.width} × ${value.height} px${cropped ? " · cropped" : ""} — this is what's sent`}
        </p>
        <div className="flex shrink-0 items-center gap-1.5">
          {cropping ? (
            <>
              <Button size="sm" variant="ghost" onClick={cancelCrop}>
                Cancel
              </Button>
              <Button size="sm" onClick={applySelection} disabled={!selectionUsable}>
                <Check className="h-4 w-4" /> Use selection
              </Button>
            </>
          ) : (
            <>
              {full ? (
                <Button size="sm" variant="outline" className={outlineButton} disabled={disabled} onClick={() => setCropping(true)}>
                  <Crop className="h-4 w-4" /> Crop
                </Button>
              ) : null}
              {cropped ? (
                <Button size="sm" variant="outline" className={outlineButton} disabled={disabled} onClick={reset}>
                  <RotateCcw className="h-4 w-4" /> Reset
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="outline"
                className={outlineButton}
                disabled={disabled}
                onClick={remove}
                aria-label="Remove image"
              >
                <X className="h-4 w-4" /> Remove
              </Button>
            </>
          )}
        </div>
      </div>
      {error ? <Notice tone="danger">{error}</Notice> : null}
    </div>
  );
}

export default ImageInput;
