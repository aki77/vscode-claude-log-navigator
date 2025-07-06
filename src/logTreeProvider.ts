import * as vscode from 'vscode';
import { LogSession, TranscriptEntry, DateFilter } from './models';
import { LogFileParser } from './logFileParser';
import { ProjectDetector } from './projectDetector';
import { formatCostSummary } from './costCalculator';

export class LogTreeProvider implements vscode.TreeDataProvider<TreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<TreeItem | undefined | null | void> = new vscode.EventEmitter<TreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

  private sessions: LogSession[] = [];
  private projectDetector: ProjectDetector;
  private logFileParser?: LogFileParser;
  private dateFilter?: DateFilter;
  private initialized: boolean = false;
  private initializing: boolean = false;
  private initializationError?: string;

  constructor() {
    this.projectDetector = new ProjectDetector();
    // initialize() call removed - now lazy loaded
  }

  private async initialize(): Promise<void> {
    console.log('LogTreeProvider: Initializing...');
    try {
      const projectPath = await this.projectDetector.detectCurrentProject();
      console.log('LogTreeProvider: Project path:', projectPath);
      
      if (projectPath) {
        const config = vscode.workspace.getConfiguration('claudeLogNavigator');
        const maxFiles = config.get<number>('maxFiles', 500);
        this.logFileParser = new LogFileParser(projectPath, maxFiles);
        await this.loadSessions();
        console.log('LogTreeProvider: Loaded sessions:', this.sessions.length);
        this.initialized = true;
        this.initializationError = undefined;
      } else {
        console.log('LogTreeProvider: No project path found');
        this.initializationError = 'No Claude project found in current workspace';
        this.initialized = true;
      }
    } catch (error) {
      console.error('LogTreeProvider: Initialization failed:', error);
      this.initializationError = error instanceof Error ? error.message : 'Unknown initialization error';
      this.initialized = true;
    } finally {
      this.initializing = false;
    }
  }

  private async lazyInitialize(): Promise<void> {
    if (this.initialized || this.initializing) {
      return;
    }
    
    this.initializing = true;
    this._onDidChangeTreeData.fire(); // Show loading state
    
    await this.initialize();
    this._onDidChangeTreeData.fire(); // Show final state
  }

  async refresh(): Promise<void> {
    this.initialized = false;
    this.initializing = false;
    this.initializationError = undefined;
    await this.lazyInitialize();
  }

  async applyDateFilter(filter: DateFilter): Promise<void> {
    this.dateFilter = filter;
    await this.loadSessions();
    this._onDidChangeTreeData.fire();
  }

  async clearFilter(): Promise<void> {
    this.dateFilter = undefined;
    await this.loadSessions();
    this._onDidChangeTreeData.fire();
  }

  private async loadSessions(): Promise<void> {
    if (!this.logFileParser) {
      this.sessions = [];
      return;
    }

    try {
      this.sessions = await this.logFileParser.parseLogFiles(this.dateFilter);
    } catch (error) {
      console.error('Failed to load sessions:', error);
      this.sessions = [];
    }
  }

  getTreeItem(element: TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TreeItem): Thenable<TreeItem[]> {
    console.log('LogTreeProvider: getChildren called, element:', element ? 'exists' : 'null', 'initialized:', this.initialized, 'initializing:', this.initializing);
    
    if (!element) {
      // Root level - handle initialization state
      if (this.initializing) {
        return Promise.resolve([new LoadingTreeItem()]);
      }
      
      if (this.initializationError) {
        return Promise.resolve([new ErrorTreeItem(this.initializationError)]);
      }
      
      if (!this.initialized) {
        // Trigger lazy initialization
        this.lazyInitialize();
        return Promise.resolve([new LoadingTreeItem()]);
      }
      
      // Return sessions
      const sessionItems = this.sessions.map(session => new SessionTreeItem(session));
      console.log('LogTreeProvider: Returning session items:', sessionItems.length);
      return Promise.resolve(sessionItems);
    } else if (element instanceof SessionTreeItem) {
      // Session level - return messages
      const messageItems = element.session.messages.map(message => new MessageTreeItem(message));
      console.log('LogTreeProvider: Returning message items:', messageItems.length);
      return Promise.resolve(messageItems);
    }

    return Promise.resolve([]);
  }

  getSession(sessionId: string): LogSession | undefined {
    return this.sessions.find(s => s.sessionId === sessionId);
  }

  getMessage(sessionId: string, messageId: string): TranscriptEntry | undefined {
    const session = this.getSession(sessionId);
    return session?.messages.find(m => m.uuid === messageId);
  }

  updateMaxFiles(maxFiles: number): void {
    if (this.logFileParser) {
      this.logFileParser.updateMaxFiles(maxFiles);
    }
  }
}

export abstract class TreeItem extends vscode.TreeItem {
  constructor(label: string, collapsibleState: vscode.TreeItemCollapsibleState) {
    super(label, collapsibleState);
  }
}

export class SessionTreeItem extends TreeItem {
  constructor(public readonly session: LogSession) {
    const duration = session.endTime.getTime() - session.startTime.getTime();
    const durationMinutes = Math.round(duration / (1000 * 60));
    
    // Include summary in the main label
    const timeLabel = `${session.startTime.toLocaleDateString()} ${session.startTime.toLocaleTimeString()}`;
    const costLabel = session.totalCost > 0 ? `, ${formatCostSummary(session.totalCost)}` : '';
    const statsLabel = `(${session.messages.length} msgs, ${session.totalTokens} tokens, ${durationMinutes}min${costLabel})`;
    
    super(
      `${timeLabel} ${statsLabel}`,
      vscode.TreeItemCollapsibleState.Collapsed
    );

    this.description = session.summary;
    this.tooltip = `${session.summary}\n\nSession ID: ${session.sessionId}\nMessages: ${session.messages.length}\nTokens: ${session.totalTokens}\nCost: ${formatCostSummary(session.totalCost)}\nDuration: ${durationMinutes} minutes`;
    this.iconPath = new vscode.ThemeIcon('history');
    this.contextValue = 'logSession';
  }
}

export class MessageTreeItem extends TreeItem {
  constructor(public readonly message: TranscriptEntry) {
    const label = message.type === 'summary' 
      ? `Summary - ${message.summary || 'Session Summary'}`
      : `${message.timestamp ? new Date(message.timestamp).toLocaleTimeString() : 'No time'} - ${message.type}`;
    
    super(label, vscode.TreeItemCollapsibleState.None);

    this.description = this.getMessagePreview();
    this.tooltip = this.getMessageTooltip();
    this.iconPath = this.getMessageIcon();
    this.contextValue = 'logMessage';
    
    // Store session ID and message ID for commands
    this.command = {
      command: 'claudeLogNavigator.openLogDetail',
      title: 'Open Log Detail',
      arguments: [this.message]
    };
  }

  private getMessagePreview(): string {
    // Handle summary entries
    if (this.message.type === 'summary') {
      return this.message.summary || 'Session summary';
    }
    
    // Handle entries without message field
    if (!this.message.message) {
      return 'System entry (no message content)';
    }
    
    let content = '';
    const messageContent = this.message.message.content;
    
    if (typeof messageContent === 'string') {
      content = messageContent;
    } else if (Array.isArray(messageContent)) {
      const textContent = messageContent.find(item => item.type === 'text');
      if (textContent?.text) {
        content = textContent.text;
      } else {
        // Show tool use info if no text content
        const toolUse = messageContent.find(item => item.type === 'tool_use');
        if (toolUse) {
          content = `Tool: ${toolUse.name}`;
        } else {
          content = `${messageContent.length} content items`;
        }
      }
    } else {
      content = 'No content';
    }
    
    return content.length > 50 ? content.substring(0, 50) + '...' : content;
  }

  private getMessageTooltip(): string {
    let tooltip = `Type: ${this.message.type}`;
    
    // Add timestamp if available
    if (this.message.timestamp) {
      tooltip += `\nTime: ${new Date(this.message.timestamp).toLocaleString()}`;
    }
    
    // Handle summary entries
    if (this.message.type === 'summary') {
      if (this.message.leafUuid) {
        tooltip += `\nLeaf UUID: ${this.message.leafUuid}`;
      }
      if (this.message.summary) {
        tooltip += `\nSummary: ${this.message.summary}`;
      }
      return tooltip;
    }
    
    // Handle entries without message field
    if (!this.message.message) {
      if (this.message.uuid) {
        tooltip += `\nUUID: ${this.message.uuid}`;
      }
      if (this.message.sessionId) {
        tooltip += `\nSession ID: ${this.message.sessionId}`;
      }
      tooltip += `\nSystem entry (no message content)`;
      return tooltip;
    }
    
    const usage = this.message.message.usage;
    if (usage) {
      const totalTokens = usage.input_tokens + usage.output_tokens;
      tooltip += `\nTokens: ${totalTokens} (${usage.input_tokens} in, ${usage.output_tokens} out)`;
      if (usage.cache_creation_input_tokens) {
        tooltip += `\nCache creation: ${usage.cache_creation_input_tokens}`;
      }
      if (usage.cache_read_input_tokens) {
        tooltip += `\nCache read: ${usage.cache_read_input_tokens}`;
      }
      if (usage.cost && usage.cost > 0) {
        tooltip += `\nCost: ${formatCostSummary(usage.cost)}`;
      }
    }
    
    return tooltip;
  }

  private getMessageIcon(): vscode.ThemeIcon {
    switch (this.message.type) {
      case 'user':
        return new vscode.ThemeIcon('account');
      case 'assistant':
        return new vscode.ThemeIcon('robot');
      case 'summary':
        return new vscode.ThemeIcon('notebook');
      default:
        // Show gear icon for entries without message field
        if (!this.message.message) {
          return new vscode.ThemeIcon('gear');
        }
        return new vscode.ThemeIcon('comment');
    }
  }
}

export class LoadingTreeItem extends TreeItem {
  constructor() {
    super('Loading Claude logs...', vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('loading~spin');
    this.description = 'Please wait';
    this.contextValue = 'loading';
  }
}

export class ErrorTreeItem extends TreeItem {
  constructor(errorMessage: string) {
    super('Failed to load logs', vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('error');
    this.description = errorMessage;
    this.tooltip = `Error: ${errorMessage}`;
    this.contextValue = 'error';
  }
}