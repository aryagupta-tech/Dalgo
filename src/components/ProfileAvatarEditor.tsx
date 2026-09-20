import { useEffect, useRef, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { Camera, Upload } from "lucide-react";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Slider,
  Stack,
  Typography,
} from "@mui/material";
import type { FriendIdentity } from "../../shared/types";
import { api } from "../api";

const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
const MAX_SOURCE_EDGE = 4096;
const MAX_SOURCE_PIXELS = 16_000_000;
const MAX_OUTPUT_BYTES = 500_000;
const OUTPUT_SIZE = 512;

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("That image could not be opened."));
    image.src = source;
  });
}

async function croppedWebp(source: string, crop: Area) {
  const image = await loadImage(source);
  const canvas = document.createElement("canvas");
  canvas.width = OUTPUT_SIZE;
  canvas.height = OUTPUT_SIZE;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context)
    throw new Error("Image editing is unavailable in this browser.");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(
    image,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    OUTPUT_SIZE,
    OUTPUT_SIZE,
  );
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (value) =>
        value
          ? resolve(value)
          : reject(new Error("The cropped image could not be created.")),
      "image/webp",
      0.82,
    ),
  );
  if (blob.type !== "image/webp")
    throw new Error("WebP image encoding is unavailable in this browser.");
  if (blob.size > MAX_OUTPUT_BYTES)
    throw new Error(
      "This crop is still too large. Choose a simpler image or crop more closely.",
    );
  return blob;
}

export function ProfileAvatarEditor({
  disabled,
  onSaved,
}: {
  disabled?: boolean;
  onSaved: (profile: FriendIdentity) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState("");
  const [open, setOpen] = useState(false);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [cropPixels, setCropPixels] = useState<Area | null>(null);
  const [zoom, setZoom] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(
    () => () => {
      if (source) URL.revokeObjectURL(source);
    },
    [source],
  );

  function close(force = false) {
    if (busy && !force) return;
    setOpen(false);
    setCropPixels(null);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    if (source) URL.revokeObjectURL(source);
    setSource("");
  }

  async function choose(file: File | undefined) {
    if (fileInput.current) fileInput.current.value = "";
    setError("");
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("Choose a JPG, PNG, or WebP image.");
      return;
    }
    if (file.size > MAX_SOURCE_BYTES) {
      setError("Choose an image smaller than 5 MB.");
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    try {
      const image = await loadImage(objectUrl);
      if (
        image.naturalWidth > MAX_SOURCE_EDGE ||
        image.naturalHeight > MAX_SOURCE_EDGE ||
        image.naturalWidth * image.naturalHeight > MAX_SOURCE_PIXELS
      )
        throw new Error("Choose an image no larger than 4096×4096 pixels.");
      if (source) URL.revokeObjectURL(source);
      setSource(objectUrl);
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setCropPixels(null);
      setOpen(true);
    } catch (reason) {
      URL.revokeObjectURL(objectUrl);
      setError(
        reason instanceof Error
          ? reason.message
          : "That image could not be opened.",
      );
    }
  }

  async function save() {
    if (!source || !cropPixels || busy) return;
    setBusy(true);
    setError("");
    try {
      const body = await croppedWebp(source, cropPixels);
      const profile = await api<FriendIdentity>("/profile/avatar", {
        method: "PUT",
        headers: { "Content-Type": "image/webp" },
        body,
      });
      onSaved(profile);
      close(true);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Your profile picture could not be saved. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Stack spacing={1.25} sx={{ alignItems: "flex-start" }}>
        <Button
          variant="outlined"
          size="small"
          startIcon={<Camera size={16} aria-hidden="true" />}
          onClick={() => fileInput.current?.click()}
          disabled={disabled || busy}
        >
          Change profile picture
        </Button>
        <input
          ref={fileInput}
          hidden
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={(event) => void choose(event.target.files?.[0])}
        />
        {error && !open && (
          <Alert severity="error" sx={{ maxWidth: 520 }}>
            {error}
          </Alert>
        )}
      </Stack>

      <Dialog
        open={open}
        onClose={() => close()}
        fullWidth
        maxWidth="sm"
        aria-labelledby="avatar-editor-title"
      >
        <DialogTitle id="avatar-editor-title">Crop profile picture</DialogTitle>
        <DialogContent>
          <Typography color="text.secondary" variant="body2" sx={{ mb: 2 }}>
            Drag the image and use the slider to choose a square crop.
          </Typography>
          <Box
            sx={{
              position: "relative",
              height: { xs: 280, sm: 360 },
              overflow: "hidden",
              borderRadius: 1,
              backgroundColor: "#050505",
            }}
          >
            {source && (
              <Cropper
                image={source}
                crop={crop}
                zoom={zoom}
                aspect={1}
                cropShape="rect"
                showGrid
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={(_area, pixels) => setCropPixels(pixels)}
              />
            )}
          </Box>
          <Box sx={{ px: 0.5, pt: 2.5 }}>
            <Typography id="avatar-zoom-label" variant="caption">
              Zoom
            </Typography>
            <Slider
              aria-labelledby="avatar-zoom-label"
              min={1}
              max={3}
              step={0.01}
              value={zoom}
              onChange={(_event, value) => setZoom(value as number)}
              disabled={busy}
            />
          </Box>
          {error && (
            <Alert severity="error" sx={{ mt: 1 }}>
              {error}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={() => close()} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="contained"
            startIcon={<Upload size={16} aria-hidden="true" />}
            onClick={() => void save()}
            disabled={busy || !cropPixels}
          >
            {busy ? "Saving…" : "Save picture"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
