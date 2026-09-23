import { useCallback, useEffect, useRef, useState } from "react";
import { Send, Trash2 } from "lucide-react";
import {
  Alert,
  Avatar,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import type {
  FriendChatView,
  FriendMessage,
  Friendship,
} from "../../shared/types";
import { api } from "../api";

export function FriendChat({
  friends,
  userId,
  onRemoved,
}: {
  friends: Friendship[];
  userId: string;
  onRemoved: () => Promise<void>;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<FriendMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const pendingId = useRef<string | null>(null);
  const activeFriend = useRef(selectedId);
  activeFriend.current = selectedId;
  const selected = friends.find((item) => item.id === selectedId) ?? null;
  useEffect(() => {
    if (!selectedId || !friends.some((item) => item.id === selectedId)) {
      setSelectedId(friends[0]?.id ?? null);
      setMessages([]);
      setDraft("");
    }
  }, [friends, selectedId]);
  const refresh = useCallback(
    async (quiet = false) => {
      if (!selectedId) return;
      try {
        const chat = await api<FriendChatView>(
          `/friends/${selectedId}/messages`,
        );
        if (activeFriend.current !== selectedId) return;
        setMessages(chat.messages);
        setError("");
      } catch (reason) {
        if (activeFriend.current !== selectedId) return;
        setMessages([]);
        if (!quiet) setError((reason as Error).message);
      }
    },
    [selectedId],
  );
  useEffect(() => {
    setMessages([]);
    setError("");
    void refresh();
    const timer = window.setInterval(() => void refresh(true), 4000);
    return () => window.clearInterval(timer);
  }, [refresh]);
  async function send() {
    const text = draft.trim();
    if (!selectedId || !text || sending) return;
    setSending(true);
    setError("");
    pendingId.current ??= crypto.randomUUID();
    try {
      const message = await api<FriendMessage>(
        `/friends/${selectedId}/messages`,
        {
          method: "POST",
          body: JSON.stringify({ requestId: pendingId.current, text }),
        },
      );
      setMessages((current) =>
        current.some((item) => item.id === message.id)
          ? current
          : [...current, message],
      );
      setDraft("");
      pendingId.current = null;
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setSending(false);
    }
  }
  async function remove() {
    if (!selectedId) return;
    setSending(true);
    try {
      await api(`/friends/${selectedId}`, { method: "DELETE" });
      setSelectedId(null);
      setMessages([]);
      setRemoveOpen(false);
      await onRemoved();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setSending(false);
    }
  }
  return (
    <Paper
      component="section"
      variant="outlined"
      sx={{ bgcolor: "#0d0d0d", overflow: "hidden" }}
    >
      <Stack
        direction="row"
        sx={{
          px: { xs: 2, sm: 2.5 },
          py: 2.25,
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <Typography component="h2" variant="h6">
          Messages
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Friends only
        </Typography>
      </Stack>
      {!friends.length ? (
        <Typography
          color="text.secondary"
          sx={{ px: 2.5, py: 3, borderTop: 1, borderColor: "divider" }}
        >
          Add a friend to start a conversation.
        </Typography>
      ) : (
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", sm: "210px minmax(0, 1fr)" },
            borderTop: 1,
            borderColor: "divider",
            minHeight: 350,
          }}
        >
          <Stack
            component="nav"
            aria-label="Friend conversations"
            direction={{ xs: "row", sm: "column" }}
            sx={{
              overflowX: "auto",
              borderRight: { sm: 1 },
              borderBottom: { xs: 1, sm: 0 },
              borderColor: "divider",
              p: 1,
              gap: 0.5,
            }}
          >
            {friends.map(({ id, friend }) => (
              <Button
                key={id}
                color="inherit"
                variant={id === selectedId ? "outlined" : "text"}
                onClick={() => setSelectedId(id)}
                sx={{
                  justifyContent: "flex-start",
                  minWidth: { xs: 120, sm: 0 },
                  textTransform: "none",
                  overflow: "hidden",
                }}
              >
                <Avatar
                  src={friend.avatar}
                  sx={{ width: 26, height: 26, mr: 1, fontSize: 13 }}
                >
                  {friend.name.slice(0, 1).toUpperCase()}
                </Avatar>
                <Typography noWrap>{friend.name}</Typography>
              </Button>
            ))}
          </Stack>
          <Stack sx={{ minWidth: 0, minHeight: 350 }}>
            <Stack
              direction="row"
              sx={{
                alignItems: "center",
                justifyContent: "space-between",
                px: 2,
                py: 1.25,
                borderBottom: 1,
                borderColor: "divider",
              }}
            >
              <Typography sx={{ fontWeight: 600 }}>
                {selected?.friend.name ?? "Select a friend"}
              </Typography>
              {selected && (
                <Button
                  size="small"
                  color="inherit"
                  startIcon={<Trash2 size={14} />}
                  onClick={() => setRemoveOpen(true)}
                >
                  Remove friend
                </Button>
              )}
            </Stack>
            <Stack
              role="log"
              aria-label="Friend messages"
              spacing={1}
              sx={{
                flex: 1,
                minHeight: 180,
                maxHeight: 350,
                overflowY: "auto",
                p: 2,
              }}
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
                      {item.senderId === userId ? "You" : selected?.friend.name}
                    </Typography>
                    <Typography sx={{ overflowWrap: "anywhere" }}>
                      {item.text}
                    </Typography>
                  </Box>
                ))
              ) : (
                <Typography color="text.secondary">No messages yet.</Typography>
              )}
            </Stack>
            {error && (
              <Alert severity="error" sx={{ mx: 2, mb: 1 }}>
                {error}
              </Alert>
            )}
            <Stack
              direction="row"
              spacing={1}
              sx={{ p: 1.5, borderTop: 1, borderColor: "divider" }}
            >
              <TextField
                size="small"
                label="Message"
                aria-label="Message your friend"
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
                slotProps={{ htmlInput: { maxLength: 500 } }}
                fullWidth
                disabled={!selected}
              />
              <Button
                variant="contained"
                aria-label="Send friend message"
                onClick={() => void send()}
                disabled={!selected || !draft.trim() || sending}
              >
                {sending ? <CircularProgress size={18} /> : <Send size={18} />}
              </Button>
            </Stack>
          </Stack>
        </Box>
      )}
      <Dialog
        open={removeOpen}
        onClose={() => setRemoveOpen(false)}
        aria-labelledby="remove-friend-title"
      >
        <DialogTitle id="remove-friend-title">
          Remove {selected?.friend.name}?
        </DialogTitle>
        <DialogContent>
          <Typography>
            Removing a friend permanently deletes your conversation with them.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRemoveOpen(false)} color="inherit">
            Keep friend
          </Button>
          <Button
            color="error"
            disabled={sending}
            onClick={() => void remove()}
          >
            Remove friend
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}
