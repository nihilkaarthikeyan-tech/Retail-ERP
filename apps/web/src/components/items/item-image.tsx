// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Image from "next/image";
import { useId, useState } from "react";
import { Alert, Button } from "@/components/ui";
import { api, API_URL, errorMessage } from "@/lib/api";
import type { ItemDto } from "@/lib/types";

const MAX_BYTES = 500 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/webp"];

interface ItemImageProps {
  item: ItemDto;
  readOnly: boolean;
  onChanged: (item: ItemDto) => void;
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the file"));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      // "data:image/png;base64,...." → the part after the comma.
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}

/** Picture of an item: preview, upload (JPEG/PNG/WebP up to 500 KB) and remove. */
export function ItemImage({ item, readOnly, onChanged }: ItemImageProps) {
  const inputId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Changes with every upload so the browser fetches the new picture, not its cache.
  const [version, setVersion] = useState(0);

  async function upload(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (!ALLOWED.includes(file.type)) {
      setError("Only JPEG, PNG or WebP pictures are allowed.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(`The picture is ${Math.round(file.size / 1024)} KB; the limit is 500 KB.`);
      return;
    }
    setBusy(true);
    try {
      const dataBase64 = await readAsBase64(file);
      await api.put(`/items/${item.id}/image`, { mimeType: file.type, dataBase64 });
      const fresh = await api.get<ItemDto>(`/items/${item.id}`);
      setVersion((v) => v + 1);
      onChanged(fresh);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setError(null);
    setBusy(true);
    try {
      await api.delete(`/items/${item.id}/image`);
      const fresh = await api.get<ItemDto>(`/items/${item.id}`);
      onChanged(fresh);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const src = `${API_URL}/items/${item.id}/image?v=${version}-${item.updatedAt}`;

  return (
    <div className="image-panel">
      {item.hasImage ? (
        <Image src={src} alt={`Picture of ${item.name}`} width={160} height={160} unoptimized className="image-preview" />
      ) : (
        <div className="image-preview image-empty" aria-hidden="true">
          No picture
        </div>
      )}
      <Alert kind="error">{error}</Alert>
      {!readOnly ? (
        <div className="actions" style={{ marginTop: 8 }}>
          <label htmlFor={inputId} className="btn">
            {item.hasImage ? "Replace picture" : "Upload picture"}
          </label>
          <input
            id={inputId}
            type="file"
            className="sr-only"
            accept="image/jpeg,image/png,image/webp"
            disabled={busy}
            onChange={(e) => {
              void upload(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          {item.hasImage ? (
            <Button variant="danger" busy={busy} onClick={remove}>
              Remove picture
            </Button>
          ) : null}
        </div>
      ) : null}
      <p className="field-hint">JPEG, PNG or WebP, up to 500 KB.</p>
    </div>
  );
}
