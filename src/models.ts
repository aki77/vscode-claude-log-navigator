export interface TranscriptEntry {
  parentUuid?: string;
  isSidechain?: boolean;
  userType?: string;
  cwd?: string;
  sessionId?: string;
  version?: string;
  type: 'user' | 'assistant' | 'summary';
  uuid?: string;
  timestamp?: string;
  message?: Message;
  requestId?: string;
  toolUseResult?: any;
  // Summary-specific fields
  summary?: string;
  leafUuid?: string;
}

export interface Message {
  id?: string;
  type?: string;
  role: 'user' | 'assistant';
  model?: string;
  content: string | ContentItem[];
  stop_reason?: string | null;
  stop_sequence?: string | null;
  usage?: UsageInfo;
}

export interface ContentItem {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: any;
  content?: string;
  source?: any;
  tool_use_id?: string;
}

export interface UsageInfo {
  input_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens: number;
  service_tier?: string;
  cost?: number;
}

export interface LogSession {
  sessionId: string;
  messages: TranscriptEntry[];
  startTime: Date;
  endTime: Date;
  totalTokens: number;
  totalCost: number;
  summary: string;
}

export interface DateFilter {
  from?: Date;
  to?: Date;
  preset?: 'today' | 'yesterday' | 'week' | 'month';
}