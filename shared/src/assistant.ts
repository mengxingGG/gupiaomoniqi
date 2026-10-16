export type AssistantProvider = "openai-chat" | "openai-responses" | "deepseek" | "anthropic";
export type SearchProvider = "exa-free" | "exa-api" | "bing";
export type ReasoningEffort = "auto" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export interface AssistantSettings {
  provider: AssistantProvider;
  baseUrl: string;
  model: string;
  hasKey: boolean;
  contextTokens: number;
  reasoning: ReasoningEffort;
  toolsEnabled: boolean;
  claudeThinkingMode: "adaptive" | "budget";
  searchProvider: SearchProvider;
  hasSearchKey: boolean;
}
export interface AssistantScope {
  mode: "VIRTUAL" | "REAL";
  instrumentId?: string;
  market?: boolean;
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
export interface AssistantTradeProposal {
  id: string;
  messageId: string;
  callId: string;
  mode: "VIRTUAL" | "REAL";
  instrumentId: string;
  name: string;
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  orderMode: "MARKET" | "LIMIT";
  limitPrice?: number;
  quoteCurrency: string;
  referencePrice: number;
  quoteTime: string;
  estimatedAmount: number;
  reason: string;
  createdAt: string;
  expiresAt: string;
  status: "pending" | "executing" | "submitted" | "rejected" | "expired" | "failed" | "uncertain";
  approvedAt?: string;
  error?: string;
  result?: { orderId: string; status: "OPEN" | "FILLED" | "CANCELLED"; filledQuantity: number; price?: number; feeUsd?: number };
}
export interface AssistantSession {
  id: string;
  title: string;
  pinned: boolean;
  scope: AssistantScope;
  messages: AssistantMessage[];
  updatedAt: string;
  tradeProposals?: AssistantTradeProposal[];
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
