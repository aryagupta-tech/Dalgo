import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ARENAS, LANGUAGES } from "../shared/types";
import { useAuth } from "./auth";
export function useDalgoTools() {
  const navigate = useNavigate();
  const { config } = useAuth();
  useEffect(() => {
    const registry = (document as any).modelContext;
    if (!registry?.registerTool) return;
    const lifecycle = new AbortController();
    const register = (tool: any) =>
      Promise.resolve(
        registry.registerTool(tool, { signal: lifecycle.signal }),
      ).catch(() => {});
    register({
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
        arenas: Object.entries(ARENAS).map(([id, a]) => ({
          id,
          name: a.name,
          durationSeconds: a.duration,
        })),
        languages: Object.keys(LANGUAGES),
        onlinePlayEnabled: config.playEnabled,
      }),
    });
    register({
      name: "open_arena_preview",
      title: "Explore a Dalgo arena",
      description:
        "Open the requested arena preview. This only navigates; it does not start a ranked match, run code, or change ratings.",
      inputSchema: {
        type: "object",
        properties: {
          arena: { type: "string", enum: ["easy", "medium", "hard"] },
        },
        required: ["arena"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: async (input: any) => {
        if (
          !input ||
          !Object.hasOwn(ARENAS, input.arena) ||
          Object.keys(input).some((k) => k !== "arena")
        )
          throw new Error("Choose easy, medium, or hard.");
        navigate("/preview/" + input.arena);
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
        return {
          arena: input.arena,
          path: "/preview/" + input.arena,
          mode: "preview",
          ratingChanges: false,
        };
      },
    });
    return () => lifecycle.abort();
  }, [navigate, config.playEnabled]);
}
