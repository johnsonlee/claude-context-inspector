// API entities
export interface Project {
  name: string;
  displayName: string;
  sessionCount: number;
  isActive: boolean;
  costUSD: number;
}

export interface Session {
  sessionId: string;
  isAgent: boolean;
  title: string;
  startTime: string | null;
  endTime: string | null;
  messageCount: number;
  toolCallCount: number;
  thinkingBlockCount: number;
  summaryCount: number;
  fileSize: number;
  isActive: boolean;
  costUSD: number;
}

// Block discriminated union
export interface TextBlock { type: 'text'; text: string }
export interface ThinkingBlock { type: 'thinking'; text: string }
export interface ToolUseBlock { type: 'tool_use'; toolName: string; toolId: string; input: Record<string, unknown> }
export interface ToolResultBlock { type: 'tool_result'; toolUseId: string; content: string; isError: boolean }
export interface SummaryBlock { type: 'summary'; text: string }
export type Block = TextBlock | ThinkingBlock | ToolUseBlock | ToolResultBlock | SummaryBlock;

// Message
export interface Message {
  uuid: string | null;
  type: 'user' | 'assistant' | 'system' | 'summary';
  timestamp: string | null;
  isSidechain: boolean;
  blocks: Block[];
  model?: string | null;
  isCompactSummary?: boolean;
}

// Context Health
export interface ToolShift {
  tool: string;
  prePct: number;
  postPct: number;
  delta: number;
}

export interface CompactionEvent {
  index: number;
  timestamp: string | null;
  // Information loss
  messagesCompacted: number;
  preChars: number;
  summaryChars: number;
  compressionRatio: number;
  entitiesLost: string[];
  entitiesRetained: string[];
  toolCallsCompacted: number;
  timeSpanSeconds: number;
  // Behavioral diff
  toolShifts: ToolShift[];
  filesDropped: string[];
  filesAdded: string[];
  filesContinued: string[];
  thinkingRatePre: number;
  thinkingRatePost: number;
  avgResponseLenPre: number;
  avgResponseLenPost: number;
  summaryMissed: string[];
  driftSeverity: number;
}

export interface ContextHealth {
  compactionCount: number;
  compactions: CompactionEvent[];
  overallCompressionRatio: number;
  totalEntitiesLost: number;
  totalEntitiesRetained: number;
  healthScore: number;
  overallDriftSeverity: number;
}

// Composition
export interface Composition {
  messageCounts: { user: number; assistant: number; system: number };
  blockCounts: { thinking: number; toolUse: number; toolResult: number; summary: number };
  charBreakdown: { text: number; thinking: number; toolInput: number; toolResult: number; summary: number; total: number };
  toolNameCounts: Record<string, number>;
  models: Record<string, number>;
}

// Usage stats
export type UsageRange = 'day' | 'week' | 'month' | 'year' | 'all';

export interface UsageStats {
  totalCostUSD: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheCreationTokens: number;
  totalCacheReadTokens: number;
  messageCount: number;
  sessionCount: number;
  models: Record<string, { cost: number; messages: number }>;
}

// View state
export type View =
  | { page: 'projects'; project?: undefined; sessionId?: undefined }
  | { page: 'sessions'; project: Project; sessionId?: undefined }
  | { page: 'session'; project: Project; sessionId: string };
