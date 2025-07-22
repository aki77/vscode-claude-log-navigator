import * as fs from 'fs';
import * as path from 'path';
import { TranscriptEntry, LogSession, DateFilter } from './models';
import { calculateCost } from './costCalculator';

export class LogFileParser {
  private logDirectory: string;
  private maxFiles: number;

  constructor(logDirectory: string, maxFiles: number = 500) {
    this.logDirectory = logDirectory;
    this.maxFiles = maxFiles;
  }

  async parseLogFiles(dateFilter?: DateFilter): Promise<LogSession[]> {
    const logFiles = await this.getLogFiles();
    const sessionMap = new Map<string, LogSession>();

    for (const logFile of logFiles) {
      const session = await this.parseLogFileToSession(logFile);
      if (session) {
        // Apply date filter if specified
        if (!dateFilter || this.sessionMatchesDateFilter(session, dateFilter)) {
          // Check if we already have a session with this ID
          const existingSession = sessionMap.get(session.sessionId);
          if (existingSession) {
            // Merging duplicate session with same ID
            // Merge messages from both sessions
            existingSession.messages.push(...session.messages);
            // Update end time if this session is newer
            if (session.endTime > existingSession.endTime) {
              existingSession.endTime = session.endTime;
            }
            // Update start time if this session is older
            if (session.startTime < existingSession.startTime) {
              existingSession.startTime = session.startTime;
            }
            // Update totals
            existingSession.totalTokens += session.totalTokens;
            existingSession.totalCost += session.totalCost;
          } else {
            sessionMap.set(session.sessionId, session);
          }
        }
      }
    }

    // Convert map to array and sort messages within each session
    const sessions = Array.from(sessionMap.values());
    sessions.forEach(session => {
      // Sort messages by timestamp within each session
      session.messages.sort((a, b) => {
        if (!a.timestamp || !b.timestamp) {
          return 0;
        }
        return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      });
    });

    // Sort sessions by start time (newest first)
    sessions.sort((a, b) => b.startTime.getTime() - a.startTime.getTime());

    return sessions;
  }

  private async getLogFiles(): Promise<string[]> {
    if (!fs.existsSync(this.logDirectory)) {
      return [];
    }

    const files = fs.readdirSync(this.logDirectory);
    const logFiles = files
      .filter(file => file.endsWith('.jsonl'))
      .map(file => {
        const filePath = path.join(this.logDirectory, file);
        const stats = fs.statSync(filePath);
        return { path: filePath, mtime: stats.mtime };
      })
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime()) // Newest first
      .slice(0, this.maxFiles) // Limit to maxFiles
      .map(file => file.path);

    return logFiles;
  }

  private async parseLogFileToSession(filePath: string): Promise<LogSession | null> {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n').filter(line => line.trim());
      const messages: TranscriptEntry[] = [];

      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as TranscriptEntry;
          // Include all entries, even those without message field
          messages.push(entry);
          if (!entry.message) {
            console.info(`Entry without message field in ${filePath} (uuid: ${entry.uuid})`);
          }
        } catch (error) {
          console.warn(`Failed to parse line in ${filePath}:`, error);
        }
      }

      if (messages.length === 0) {
        return null;
      }

      // Since it's 1 session per file, all messages should have the same sessionId
      // Handle cases where sessionId might not exist (e.g., summary entries)
      const sessionId = messages.find(msg => msg.sessionId)?.sessionId || 'unknown';
      
      // Find messages with valid timestamps
      const messagesWithTimestamp = messages.filter(msg => msg.timestamp);
      
      let startTime: Date;
      let endTime: Date;
      
      if (messagesWithTimestamp.length > 0) {
        startTime = new Date(messagesWithTimestamp[0].timestamp!);
        endTime = new Date(messagesWithTimestamp[messagesWithTimestamp.length - 1].timestamp!);
        
        // Check if dates are valid
        if (isNaN(startTime.getTime())) {
          console.warn(`Invalid start timestamp in ${filePath}: ${messagesWithTimestamp[0].timestamp}`);
          startTime = new Date(); // Use current time as fallback
        }
        if (isNaN(endTime.getTime())) {
          console.warn(`Invalid end timestamp in ${filePath}: ${messagesWithTimestamp[messagesWithTimestamp.length - 1].timestamp}`);
          endTime = new Date(); // Use current time as fallback
        }
      } else {
        // No messages with timestamp found, use file modification time as fallback
        console.warn(`No valid timestamps found in ${filePath}, using file modification time`);
        const stats = fs.statSync(filePath);
        startTime = endTime = stats.mtime;
      }

      // Calculate total tokens and cost from usage info
      let totalTokens = 0;
      let totalCost = 0;

      messages.forEach(msg => {
        const usage = msg.message?.usage;
        if (usage) {
          totalTokens += usage.input_tokens + usage.output_tokens;
          
          // Calculate cost for this message
          const model = msg.message?.model || 'unknown';
          const serviceTier = usage.service_tier;
          
          if (usage.input_tokens || usage.output_tokens) {
            const costBreakdown = calculateCost(usage, model, serviceTier);
            usage.cost = costBreakdown.totalCost;
            totalCost += costBreakdown.totalCost;
          }
        }
      });

      const summary = this.generateSessionSummary(messages);

      return {
        sessionId,
        messages,
        startTime,
        endTime,
        totalTokens,
        totalCost,
        summary
      };
    } catch (error) {
      console.warn(`Failed to parse log file ${filePath}:`, error);
      return null;
    }
  }

  private sessionMatchesDateFilter(session: LogSession, filter: DateFilter): boolean {
    let fromDate: Date | undefined;
    let toDate: Date | undefined;

    if (filter.preset) {
      const now = new Date();
      switch (filter.preset) {
        case 'today':
          fromDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          toDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
          break;
        case 'yesterday':
          fromDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
          toDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          break;
        case 'week':
          fromDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          toDate = now;
          break;
        case 'month':
          fromDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          toDate = now;
          break;
      }
    } else {
      fromDate = filter.from;
      toDate = filter.to;
    }

    // Check if session start time falls within the date range
    if (fromDate && session.startTime < fromDate) {
      return false;
    }
    if (toDate && session.startTime > toDate) {
      return false;
    }
    return true;
  }

  updateMaxFiles(maxFiles: number): void {
    this.maxFiles = maxFiles;
  }

  private generateSessionSummary(messages: TranscriptEntry[]): string {
    const userMessage = messages.find(msg => msg.type === 'user');
    if (userMessage && userMessage.message) {
      let content = '';
      const messageContent = userMessage.message.content;

      if (typeof messageContent === 'string') {
        content = messageContent;
      } else if (Array.isArray(messageContent)) {
        const textContent = messageContent.find(item => item.type === 'text');
        content = textContent?.text || '';
      }

      // Return first 100 characters as summary
      if (content.length > 0) {
        return content.length > 100 ? content.substring(0, 100) + '...' : content;
      }
    }

    // Check if there's a summary entry
    const summaryEntry = messages.find(msg => msg.type === 'summary');
    if (summaryEntry && summaryEntry.summary) {
      return summaryEntry.summary;
    }

    // Generate more informative summary
    const userMessages = messages.filter(msg => msg.type === 'user').length;
    const assistantMessages = messages.filter(msg => msg.type === 'assistant').length;
    const summaryMessages = messages.filter(msg => msg.type === 'summary').length;
    
    const firstMessageWithTimestamp = messages.find(msg => msg.timestamp);
    const dateStr = firstMessageWithTimestamp ? 
      new Date(firstMessageWithTimestamp.timestamp!).toLocaleDateString() : 
      'Unknown date';

    return `${userMessages} user, ${assistantMessages} assistant${summaryMessages ? `, ${summaryMessages} summary` : ''} messages - ${dateStr}`;
  }
}
