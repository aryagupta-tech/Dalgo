import type { FriendIdentity } from "../shared/types";
import { AppError } from "./core";
import { db } from "./db";
import { supabaseSecretKey, type Env } from "./env";

export const AVATAR_BUCKET = "profile-avatars";
export const AVATAR_MAX_BYTES = 500_000;
export const AVATAR_DIMENSION = 512;

function ascii(bytes: Uint8Array, offset: number, length: number) {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function uint24le(bytes: Uint8Array, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

export function webpDimensions(
  bytes: Uint8Array,
): { width: number; height: number } | null {
  if (
    bytes.length < 30 ||
    ascii(bytes, 0, 4) !== "RIFF" ||
    ascii(bytes, 8, 4) !== "WEBP"
  )
    return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(4, true) !== bytes.length - 8) return null;

  let canvas: { width: number; height: number } | null = null;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const type = ascii(bytes, offset, 4);
    const size = view.getUint32(offset + 4, true);
    const data = offset + 8;
    const next = data + size + (size % 2);
    if (data + size > bytes.length || next > bytes.length) return null;

    if (type === "VP8X" && size >= 10) {
      canvas = {
        width: uint24le(bytes, data + 4) + 1,
        height: uint24le(bytes, data + 7) + 1,
      };
    } else if (type === "VP8L" && size >= 5 && bytes[data] === 0x2f) {
      const b1 = bytes[data + 1];
      const b2 = bytes[data + 2];
      const b3 = bytes[data + 3];
      const b4 = bytes[data + 4];
      const frame = {
        width: 1 + (((b2 & 0x3f) << 8) | b1),
        height: 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6)),
      };
      return canvas &&
        (canvas.width !== frame.width || canvas.height !== frame.height)
        ? null
        : frame;
    } else if (
      type === "VP8 " &&
      size >= 10 &&
      bytes[data + 3] === 0x9d &&
      bytes[data + 4] === 0x01 &&
      bytes[data + 5] === 0x2a
    ) {
      const frame = {
        width: view.getUint16(data + 6, true) & 0x3fff,
        height: view.getUint16(data + 8, true) & 0x3fff,
      };
      return canvas &&
        (canvas.width !== frame.width || canvas.height !== frame.height)
        ? null
        : frame;
    }
    offset = next;
  }
  return null;
}

export function validateAvatar(bytes: Uint8Array, contentType: string | null) {
  if (contentType?.split(";", 1)[0].trim().toLowerCase() !== "image/webp")
    throw new AppError("Profile pictures must be uploaded as WebP.", 415);
  if (!bytes.length) throw new AppError("Choose a profile picture.", 400);
  if (bytes.length > AVATAR_MAX_BYTES)
    throw new AppError("The cropped profile picture is too large.", 413);
  const dimensions = webpDimensions(bytes);
  if (
    !dimensions ||
    dimensions.width !== AVATAR_DIMENSION ||
    dimensions.height !== AVATAR_DIMENSION
  )
    throw new AppError(
      "Profile pictures must be valid 512 by 512 pixel WebP images.",
      400,
    );
}

function storageHeaders(env: Env) {
  const key = supabaseSecretKey(env);
  if (!env.SUPABASE_URL || !key)
    throw new AppError("Profile pictures are being connected.", 503);
  return {
    apikey: key,
    ...(key.startsWith("sb_secret_") ? {} : { Authorization: "Bearer " + key }),
  };
}

function storageUrl(env: Env, suffix: string) {
  return env.SUPABASE_URL!.replace(/\/$/, "") + "/storage/v1" + suffix;
}

async function removeAvatarObject(env: Env, path: string) {
  const response = await fetch(storageUrl(env, "/object/" + AVATAR_BUCKET), {
    method: "DELETE",
    headers: {
      ...storageHeaders(env),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prefixes: [path] }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok)
    console.error(
      JSON.stringify({
        event: "avatar_cleanup_failed",
        status: response.status,
      }),
    );
  return response.ok;
}

type AvatarSwapRow = {
  previous_storage_path: string | null;
  profile_id: string;
  display_name: string;
  username: string;
  username_configured_at: string | null;
  avatar_url: string;
};

export async function updateProfileAvatar(
  env: Env,
  userId: string,
  bytes: Uint8Array,
): Promise<FriendIdentity> {
  const path = userId + "/" + crypto.randomUUID() + ".webp";
  const publicUrl = storageUrl(
    env,
    "/object/public/" + AVATAR_BUCKET + "/" + path,
  );
  const upload = await fetch(
    storageUrl(env, "/object/" + AVATAR_BUCKET + "/" + path),
    {
      method: "POST",
      headers: {
        ...storageHeaders(env),
        "Content-Type": "image/webp",
        "Cache-Control": "max-age=3600",
        "x-upsert": "false",
      },
      body: bytes.slice().buffer as ArrayBuffer,
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!upload.ok) {
    console.error(
      JSON.stringify({ event: "avatar_upload_failed", status: upload.status }),
    );
    throw new AppError(
      "Your profile picture could not be uploaded. Try again.",
      503,
    );
  }

  let row: AvatarSwapRow;
  try {
    const rows = await db<AvatarSwapRow[]>(env, "rpc/swap_profile_avatar", {
      method: "POST",
      body: JSON.stringify({
        p_user_id: userId,
        p_avatar_url: publicUrl,
        p_storage_path: path,
      }),
    });
    if (!rows[0])
      throw new AppError(
        "Your profile picture could not be saved. Try again.",
        503,
      );
    row = rows[0];
  } catch (error) {
    await removeAvatarObject(env, path).catch(() => false);
    throw error;
  }

  if (row.previous_storage_path)
    await removeAvatarObject(env, row.previous_storage_path).catch(() => false);

  return {
    id: row.profile_id,
    username: row.username_configured_at ? row.username : "",
    usernameConfigured: Boolean(row.username_configured_at),
    name: row.display_name || row.username,
    avatar: row.avatar_url,
  };
}
