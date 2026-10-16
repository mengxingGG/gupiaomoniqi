export type ReasoningEffort = "auto" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
export interface AssistantSettings {
  baseUrl: string;
  model: string;
  hasKey: boolean;
  contextTokens: number;
  modelContextTokens: number;
  reasoning: ReasoningEffort;
  toolsEnabled: boolean;
}
export interface AssistantScope {
  mode: "VIRTUAL" | "REAL";
  instrumentId?: string;
  portfolio: boolean;
  transactions: boolean;
  watchlist: boolean;
  web: boolean;
}
export interface AssistantMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  model?: string;
  sources?: { title: string; url: string }[];
}
export interface AssistantSession {
  id: string;
  title: string;
  pinned: boolean;
  scope: AssistantScope;
  messages: AssistantMessage[];
  updatedAt: string;
  task?: {
    id: string;
    status: "running" | "complete" | "stopped" | "error";
    progress: string;
    error?: string;
    contextTokens: number;
    effectiveWindow: number;
    compacted: boolean;
  };
}
export interface AssistantMemory { text: string; revision: string; enabled: boolean; canUndo: boolean }
export interface AssistantOverview { settings: AssistantSettings; sessions: AssistantSession[]; memory: AssistantMemory }
