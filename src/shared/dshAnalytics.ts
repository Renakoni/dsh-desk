export type DshTrajectoryDay = {
  date: string;
  sessions: number;
  turns: number;
  steps: number;
  toolCalls: number;
  failedToolCalls: number;
  totalTokens: number;
  llmMs: number;
  toolMs: number;
};

export type DshToolMetric = {
  name: string;
  calls: number;
  errors: number;
  durationMs: number;
};

export type DshSessionMetric = {
  sessionId: string;
  title: string;
  filePath: string;
  projectPath?: string;
  projectName: string;
  provider: string;
  model: string;
  createdAt: number;
  lastActivity: number;
  durationMs: number;
  turns: number;
  steps: number;
  toolCalls: number;
  failedToolCalls: number;
  llmMs: number;
  toolMs: number;
  ttftMs: number;
  ttftSteps: number;
  decodeMs: number;
  decodeTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  contextWindow?: number;
  pressureTokens?: number;
  projectedTokens?: number;
  systemTokens?: number;
  toolsTokens?: number;
  messageTokens?: number;
};

export type DshAnalyticsTotals = {
  sessions: number;
  turns: number;
  steps: number;
  toolCalls: number;
  failedToolCalls: number;
  llmMs: number;
  toolMs: number;
  ttftMs: number;
  ttftSteps: number;
  decodeMs: number;
  decodeTokens: number;
};

export type DshAnalyticsSnapshot = {
  totals: DshAnalyticsTotals;
  daily: DshTrajectoryDay[];
  tools: DshToolMetric[];
  sessions: DshSessionMetric[];
  sessionRoot: string;
  lastScannedAt: number;
};

export function emptyDshAnalyticsSnapshot(sessionRoot = "", scannedAt = Date.now()): DshAnalyticsSnapshot {
  return {
    totals: {
      sessions: 0,
      turns: 0,
      steps: 0,
      toolCalls: 0,
      failedToolCalls: 0,
      llmMs: 0,
      toolMs: 0,
      ttftMs: 0,
      ttftSteps: 0,
      decodeMs: 0,
      decodeTokens: 0
    },
    daily: [],
    tools: [],
    sessions: [],
    sessionRoot,
    lastScannedAt: scannedAt
  };
}
