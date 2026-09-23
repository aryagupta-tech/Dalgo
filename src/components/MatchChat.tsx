import { useEffect, useRef, useState } from "react";
import { MessageCircle, Send } from "lucide-react";
import {
  Badge,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import type { MatchChatMessage, MatchView } from "../../shared/types";
import { api } from "../api";

export function MatchChat({
  match,
  userId,
}: {
  match: MatchView;
  userId: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [local, setLocal] = useState<MatchChatMessage[]>([]);
  const [unread, setUnread] = useState(0);
  const lastSeen = useRef<string | null>(null);
  const pendingId = useRef<string | null>(null);
  const remote = match.chat ?? [];
  const messages =
    (local.at(-1)?.sentAt ?? 0) > (remote.at(-1)?.sentAt ?? 0) ? local : remote;
  useEffect(() => {
    if (match.result) {
      setOpen(false);
      setLocal([]);
      setUnread(0);
      return;
    }
    const current = match.chat ?? [];
    const last = current.at(-1)?.id ?? null;
    if (last && lastSeen.current && last !== lastSeen.current && !open) {
      const seenIndex = current.findIndex(
        (item) => item.id === lastSeen.current,
      );
      const newCount = current
        .slice(seenIndex + 1)
        .filter((item) => item.senderId !== userId).length;
      setUnread((count) => Math.min(99, count + newCount));
    }
    lastSeen.current = last;
  }, [match.chat, match.result, open, userId]);
  if (match.mode !== "human" || match.result) return null;
  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setError("");
    pendingId.current ??= crypto.randomUUID();
    try {
      const view = await api<MatchView>(`/matches/${match.id}/chat`, {
        method: "POST",
        body: JSON.stringify({ requestId: pendingId.current, text }),
      });
      setLocal(view.chat ?? []);
      setDraft("");
      pendingId.current = null;
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setSending(false);
    }
  }
  return (
    <>
      <Button
        variant="text"
        size="small"
        startIcon={
          <Badge badgeContent={unread} color="primary">
            <MessageCircle size={16} />
          </Badge>
        }
        onClick={() => {
          setOpen(true);
          setUnread(0);
        }}
        aria-label={
          unread
            ? `Open match chat, ${unread} unread messages`
            : "Open match chat"
        }
      >
        Chat
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        fullWidth
        maxWidth="sm"
        aria-labelledby="match-chat-title"
      >
        <DialogTitle id="match-chat-title">Match chat</DialogTitle>
        <DialogContent dividers>
          <Stack
            spacing={1.25}
            sx={{ minHeight: 200, maxHeight: "45vh", overflowY: "auto" }}
            role="log"
            aria-label="Match messages"
          >
            {messages.length ? (
              messages.map((item) => (
                <Box
                  key={item.id}
                  sx={{
                    alignSelf:
                      item.senderId === userId ? "flex-end" : "flex-start",
                    maxWidth: "85%",
                    bgcolor: item.senderId === userId ? "#303030" : "#202020",
                    borderRadius: 1.5,
                    px: 1.5,
                    py: 1,
                  }}
                >
                  <Typography variant="caption" color="text.secondary">
                    {item.senderId === userId ? "You" : "Opponent"}
                  </Typography>
                  <Typography
                    sx={{ overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}
                  >
                    {item.text}
                  </Typography>
                </Box>
              ))
            ) : (
              <Typography color="text.secondary">No messages yet.</Typography>
            )}
          </Stack>
          {error && (
            <Typography
              role="alert"
              color="error"
              variant="body2"
              sx={{ mt: 1 }}
            >
              {error}
            </Typography>
          )}
          <TextField
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              pendingId.current = null;
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
            label="Message your opponent"
            slotProps={{ htmlInput: { maxLength: 500 } }}
            fullWidth
            size="small"
            sx={{ mt: 2 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)} color="inherit">
            Close
          </Button>
          <Button
            onClick={() => void send()}
            disabled={sending || !draft.trim()}
            variant="contained"
            startIcon={<Send size={15} />}
          >
            Send
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
