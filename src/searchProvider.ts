import * as vscode from 'vscode';
import { LogSession, TranscriptEntry } from './models';
import { SearchHistory } from './searchHistory';
import { LogTreeProvider } from './logTreeProvider';

interface SearchQuickPickItem extends vscode.QuickPickItem {
  isHistory?: boolean;
  entry?: {
    session: LogSession;
    message: TranscriptEntry;
  };
}

export class SearchProvider {
  private searchHistory: SearchHistory;

  constructor(
    context: vscode.ExtensionContext,
    private logTreeProvider: LogTreeProvider
  ) {
    this.searchHistory = new SearchHistory(context);
  }

  async showSearchQuickPick(): Promise<void> {
    const quickPick = vscode.window.createQuickPick<SearchQuickPickItem>();
    quickPick.placeholder = '🔍 ログを検索...';
    quickPick.matchOnDescription = true;
    quickPick.matchOnDetail = true;

    // Load and show search history initially
    const history = await this.searchHistory.getHistory();
    const historyItems: SearchQuickPickItem[] = history.map(query => ({
      label: `📋 ${query}`,
      description: '(最近使用)',
      isHistory: true
    }));
    quickPick.items = historyItems;

    // Handle text input for search
    let searchTimeout: NodeJS.Timeout | undefined;
    quickPick.onDidChangeValue(value => {
      if (searchTimeout) {
        clearTimeout(searchTimeout);
      }

      if (!value) {
        // Show history when input is empty
        quickPick.items = historyItems;
        return;
      }

      // Debounce search
      searchTimeout = setTimeout(() => {
        this.performSearch(value, quickPick);
      }, 300);
    });

    // Handle selection
    quickPick.onDidAccept(async () => {
      const selection = quickPick.selectedItems[0];
      if (!selection) {
        return;
      }

      if (selection.isHistory) {
        // If history item selected, perform search with that query
        const query = selection.label.substring(3); // Remove "📋 " prefix
        quickPick.value = query;
        this.performSearch(query, quickPick);
      } else if (selection.entry) {
        // Navigate to selected log entry
        quickPick.hide();
        await this.navigateToEntry(selection.entry.session, selection.entry.message);
        
        // Add search query to history
        const query = quickPick.value.trim();
        if (query) {
          await this.searchHistory.addQuery(query);
        }
      }
    });

    quickPick.onDidHide(() => {
      if (searchTimeout) {
        clearTimeout(searchTimeout);
      }
      quickPick.dispose();
    });

    quickPick.show();
  }

  private async performSearch(query: string, quickPick: vscode.QuickPick<SearchQuickPickItem>): Promise<void> {
    if (!query.trim()) {
      return;
    }

    const searchResults: SearchQuickPickItem[] = [];
    const lowerQuery = query.toLowerCase();

    // Get all sessions from the tree provider
    const sessions = await this.getAllSessions();

    for (const session of sessions) {
      for (const message of session.messages) {
        if (this.messageMatchesQuery(message, lowerQuery)) {
          const item: SearchQuickPickItem = {
            label: this.formatSearchResult(message),
            description: this.formatTimestamp(message.timestamp),
            detail: this.getMessagePreview(message, 100),
            entry: { session, message }
          };
          searchResults.push(item);
        }
      }
    }

    quickPick.items = searchResults;
    quickPick.busy = false;
  }

  private messageMatchesQuery(message: TranscriptEntry, lowerQuery: string): boolean {
    // Search in message content
    if (message.message) {
      const content = message.message.content;
      if (typeof content === 'string' && content.toLowerCase().includes(lowerQuery)) {
        return true;
      } else if (Array.isArray(content)) {
        for (const item of content) {
          if (item.text && item.text.toLowerCase().includes(lowerQuery)) {
            return true;
          }
          if (item.name && item.name.toLowerCase().includes(lowerQuery)) {
            return true;
          }
          if (item.input && JSON.stringify(item.input).toLowerCase().includes(lowerQuery)) {
            return true;
          }
        }
      }
    }

    // Search in summary
    if (message.summary && message.summary.toLowerCase().includes(lowerQuery)) {
      return true;
    }

    // Search in system content
    if (message.content && message.content.toLowerCase().includes(lowerQuery)) {
      return true;
    }

    return false;
  }

  private formatSearchResult(message: TranscriptEntry): string {
    if (message.type === 'summary') {
      return `📝 Summary: ${message.summary || 'Session Summary'}`;
    } else if (message.type === 'system') {
      return `⚙️ System${message.level ? ` [${message.level}]` : ''}`;
    } else if (message.type === 'user') {
      return '👤 User';
    } else if (message.type === 'assistant') {
      return '🤖 Assistant';
    }
    return `📄 ${message.type}`;
  }

  private formatTimestamp(timestamp?: string): string {
    if (!timestamp) {
      return '';
    }
    const date = new Date(timestamp);
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
  }

  private getMessagePreview(message: TranscriptEntry, maxLength: number = 100): string {
    let content = '';

    if (message.summary) {
      content = message.summary;
    } else if (message.content) {
      content = this.stripAnsiCodes(message.content);
    } else if (message.message) {
      const messageContent = message.message.content;
      if (typeof messageContent === 'string') {
        content = messageContent;
      } else if (Array.isArray(messageContent)) {
        const textContent = messageContent.find(item => item.type === 'text');
        if (textContent?.text) {
          content = textContent.text;
        } else {
          const toolUse = messageContent.find(item => item.type === 'tool_use');
          if (toolUse) {
            content = `Tool: ${toolUse.name}`;
          }
        }
      }
    }

    // Clean up whitespace and truncate
    content = content.replace(/\s+/g, ' ').trim();
    return content.length > maxLength ? content.substring(0, maxLength) + '...' : content;
  }

  private stripAnsiCodes(text: string): string {
    return text.replace(/\u001b\[[0-9;]*m/g, '');
  }

  private async getAllSessions(): Promise<LogSession[]> {
    // Get root items (sessions) from the tree provider
    const rootItems = await this.logTreeProvider.getChildren();
    const sessions: LogSession[] = [];

    for (const item of rootItems) {
      // Check if the item is a SessionTreeItem by checking for the session property
      if ((item as any).session) {
        sessions.push((item as any).session);
      }
    }

    return sessions;
  }

  private async navigateToEntry(session: LogSession, message: TranscriptEntry): Promise<void> {
    // Show the log detail view
    await vscode.commands.executeCommand('claudeLogNavigator.openLogDetail', message);

    // Select and reveal the message in the tree view
    if (session.sessionId) {
      // If message has no UUID, find its index in the session
      if (!message.uuid) {
        const messageIndex = session.messages.findIndex(m => m === message);
        if (messageIndex !== -1) {
          // Pass a unique identifier based on index
          await this.logTreeProvider.selectMessageByIndex(session.sessionId, messageIndex);
        }
      } else {
        await this.logTreeProvider.selectMessage(session.sessionId, message.uuid);
      }
    }
  }
}