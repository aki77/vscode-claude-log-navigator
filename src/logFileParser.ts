import * as fs from 'fs';
import * as path from 'path';
import { TranscriptEntry, LogSession, DateFilter } from './models';

export class LogFileParser {
  private logDirectory: string;
  private maxFiles: number;

  constructor(logDirectory: string, maxFiles: number = 500) {
    this.logDirectory = logDirectory;
    this.maxFiles = maxFiles;
  }

  async parseLogFiles(dateFilter?: DateFilter): Promise<LogSession[]> {
    const logFiles = await this.getLogFiles();
    const sessions: LogSession[] = [];

    for (const logFile of logFiles) {
      const session = await this.parseLogFileToSession(logFile);
      if (session) {
        // Apply date filter if specified
        if (!dateFilter || this.sessionMatchesDateFilter(session, dateFilter)) {
          sessions.push(session);
        }
      }
    }

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
          // Skip entries without message field
          if (!entry.message) {
            console.warn(`Entry without message field in ${filePath}:`, entry);
            continue;
          }
          messages.push(entry);
        } catch (error) {
          console.warn(`Failed to parse line in ${filePath}:`, error);
        }
      }

      if (messages.length === 0) {
        return null;
      }

      // Since it's 1 session per file, all messages should have the same sessionId
      const sessionId = messages[0].sessionId;
      const startTime = new Date(messages[0].timestamp);
      const endTime = new Date(messages[messages.length - 1].timestamp);
      
      // Calculate total tokens from usage info
      const totalTokens = messages.reduce((sum, msg) => {
        const usage = msg.message?.usage;
        if (usage) {
          return sum + usage.input_tokens + usage.output_tokens;
        }
        return sum;
      }, 0);
      
      const summary = this.generateSessionSummary(messages);

      return {
        sessionId,
        messages,
        startTime,
        endTime,
        totalTokens,
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
    
    // Generate more informative summary
    const userMessages = messages.filter(msg => msg.type === 'user').length;
    const assistantMessages = messages.filter(msg => msg.type === 'assistant').length;
    const startTime = new Date(messages[0].timestamp);
    
    return `${userMessages} user, ${assistantMessages} assistant messages - ${startTime.toLocaleDateString()}`;
  }
}