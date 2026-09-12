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
      title: "Open a Dalgo demo",
      description:
        "Start or resume a clearly labelled local arena demo with a countdown and illustrative outcomes. It does not execute code, contact an opponent, or change ratings.",
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
        navigate("/demo/" + input.arena);
        await new Promise<void>((resolve, reject) => {
          const deadline = Date.now() + 10000;
          const check = () => {
            if (document.querySelector(`[data-demo-arena="${input.arena}"]`)) {
              resolve();
              return;
            }
            if (Date.now() > deadline) {
              reject(
                new Error(
                  "The demo did not finish loading. Retry from the lobby.",
                ),
              );
              return;
            }
            requestAnimationFrame(check);
          };
          requestAnimationFrame(check);
        });
        return {
          arena: input.arena,
          path: "/demo/" + input.arena,
          mode: "demo",
          ratingChanges: false,
        };
      },
    });
    return () => lifecycle.abort();
  }, [navigate, config.playEnabled]);
}
