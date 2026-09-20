import { useEffect } from "react";
import { ARENAS, LANGUAGES } from "../shared/types";
import { useAuth } from "./auth";

export function useDalgoTools() {
  const { config } = useAuth();
  useEffect(() => {
    const registry = (document as any).modelContext;
    if (!registry?.registerTool) return;
    const lifecycle = new AbortController();
    Promise.resolve(
      registry.registerTool(
        {
          name: "read_arena_catalog",
          title: "Read Dalgo arenas",
          description:
            "Read the three arenas, supported languages, and whether online matches are enabled.",
          inputSchema: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
          annotations: { readOnlyHint: true, untrustedContentHint: false },
          execute: () => ({
            arenas: Object.entries(ARENAS).map(([id, arena]) => ({
              id,
              name: arena.name,
              durationSeconds: arena.duration,
            })),
            languages: Object.keys(LANGUAGES),
            onlinePlayEnabled: config.playEnabled,
          }),
        },
        { signal: lifecycle.signal },
      ),
    ).catch(() => {});
    return () => lifecycle.abort();
  }, [config.playEnabled]);
}
