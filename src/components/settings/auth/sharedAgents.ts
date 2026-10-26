export type SharedAgentId = "claude" | "codex" | "gemini";

export const SHARED_AGENTS: {
  id: SharedAgentId;
  name: string;
  short: string;
  color: string;
  icon: string;
}[] = [
  {
    id: "claude",
    name: "Claude Code",
    short: "CC",
    color: "#d97757",
    icon: "claude",
  },
  {
    id: "codex",
    name: "Codex",
    short: "CX",
    color: "#6aa7ff",
    icon: "openai",
  },
  {
    id: "gemini",
    name: "Gemini CLI",
    short: "GM",
    color: "#a889ff",
    icon: "gemini",
  },
];
