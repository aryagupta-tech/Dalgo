import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../worker/core";
import {
  AVATAR_DIMENSION,
  AVATAR_MAX_BYTES,
  updateProfileAvatar,
  validateAvatar,
  webpDimensions,
} from "../worker/avatar";
import type { Env } from "../worker/env";

vi.mock("../worker/db", () => ({
  db: vi.fn(),
}));

import { db } from "../worker/db";

const USER = "11111111-1111-4111-8111-111111111111";

function vp8(width = AVATAR_DIMENSION, height = AVATAR_DIMENSION) {
  const bytes = new Uint8Array(30);
  bytes.set(new TextEncoder().encode("RIFF"), 0);
  new DataView(bytes.buffer).setUint32(4, 22, true);
  bytes.set(new TextEncoder().encode("WEBP"), 8);
  bytes.set(new TextEncoder().encode("VP8 "), 12);
  new DataView(bytes.buffer).setUint32(16, 10, true);
  bytes[23] = 0x9d;
  bytes[24] = 0x01;
  bytes[25] = 0x2a;
  new DataView(bytes.buffer).setUint16(26, width, true);
  new DataView(bytes.buffer).setUint16(28, height, true);
  return bytes;
}

function runtime() {
  return {
    SUPABASE_URL: "https://project.invalid",
    SUPABASE_SECRET_KEY: "sb_secret_backend",
  } as Env;
}

afterEach(() => vi.restoreAllMocks());

describe("profile avatar validation", () => {
  it("reads WebP frame dimensions and accepts only the canonical output", () => {
    const image = vp8();
    expect(webpDimensions(image)).toEqual({ width: 512, height: 512 });
    expect(() => validateAvatar(image, "image/webp")).not.toThrow();
  });

  it("rejects wrong MIME, malformed content, dimensions, and size", () => {
    expect(() => validateAvatar(vp8(), "image/png")).toThrow(AppError);
    expect(() => validateAvatar(new Uint8Array(30), "image/webp")).toThrow(
      /valid 512 by 512/,
    );
    const wrongRiffLength = vp8();
    new DataView(wrongRiffLength.buffer).setUint32(4, 21, true);
    expect(() => validateAvatar(wrongRiffLength, "image/webp")).toThrow(
      /valid 512 by 512/,
    );
    expect(() => validateAvatar(vp8(511, 512), "image/webp")).toThrow(
      /512 by 512/,
    );
    expect(() =>
      validateAvatar(new Uint8Array(AVATAR_MAX_BYTES + 1), "image/webp"),
    ).toThrow(/too large/);
  });
});

describe("profile avatar storage", () => {
  it("uses the authenticated account path and cleans the previous object", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
      .mockResolvedValueOnce(new Response("[]", { status: 200 }));
    vi.mocked(db).mockResolvedValueOnce([
      {
        previous_storage_path:
          USER + "/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp",
        profile_id: USER,
        display_name: "Ada",
        username: "ada",
        username_configured_at: "2026-09-20T00:00:00Z",
        avatar_url: "https://project.invalid/storage/avatar.webp",
      },
    ]);

    const profile = await updateProfileAvatar(runtime(), USER, vp8());

    expect(profile).toMatchObject({ id: USER, avatar: expect.any(String) });
    const uploadUrl = String(fetchMock.mock.calls[0][0]);
    expect(uploadUrl).toContain("/profile-avatars/" + USER + "/");
    const rpcBody = JSON.parse(String(vi.mocked(db).mock.calls[0][2]?.body));
    expect(rpcBody.p_user_id).toBe(USER);
    expect(rpcBody.p_storage_path).toMatch(
      new RegExp("^" + USER + "/[0-9a-f-]+[.]webp$"),
    );
    expect(fetchMock.mock.calls[1][1]?.method).toBe("DELETE");
    expect(fetchMock.mock.calls[1][1]?.body).toContain(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp",
    );
  });

  it("removes the new object when the atomic profile swap fails", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
      .mockResolvedValueOnce(new Response("[]", { status: 200 }));
    vi.mocked(db).mockRejectedValueOnce(new Error("database unavailable"));

    await expect(updateProfileAvatar(runtime(), USER, vp8())).rejects.toThrow(
      "database unavailable",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1]?.method).toBe("DELETE");
    expect(String(fetchMock.mock.calls[1][1]?.body)).toContain(USER);
  });
});
