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
  private treeView?: vscode.TreeView<TreeItem>;
  private sessionItemCache: Map<string, SessionTreeItem> = new Map();
  private messageItemCache: Map<string, MessageTreeItem> = new Map();

  constructor() {
    this.projectDetector = new ProjectDetector();
    // initialize() call removed - now lazy loaded
  }

  setTreeView(treeView: vscode.TreeView<TreeItem>): void {
    this.treeView = treeView;
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
    // Clear caches when refreshing
    this.sessionItemCache.clear();
    this.messageItemCache.clear();
    await this.lazyInitialize();
  }

  async applyDateFilter(filter: DateFilter): Promise<void> {
    this.dateFilter = filter;
    await this.loadSessions();
    // Clear caches when filter changes
    this.sessionItemCache.clear();
    this.messageItemCache.clear();
    this._onDidChangeTreeData.fire();
  }

  async clearFilter(): Promise<void> {
    this.dateFilter = undefined;
    await this.loadSessions();
    // Clear caches when filter changes
    this.sessionItemCache.clear();
    this.messageItemCache.clear();
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
      const sessionItems = this.sessions.map(session => {
        const cached = this.sessionItemCache.get(session.sessionId);
        if (cached) {
          return cached;
        }
        const item = new SessionTreeItem(session);
        this.sessionItemCache.set(session.sessionId, item);
        return item;
      });
      console.log('LogTreeProvider: Returning session items:', sessionItems.length);
      return Promise.resolve(sessionItems);
    } else if (element instanceof SessionTreeItem) {
      // Session level - return messages
      const messageItems = element.session.messages.map((message, index) => {
        const cacheKey = message.uuid 
          ? `${element.session.sessionId}-${message.uuid}`
          : `${element.session.sessionId}-idx${index}`;
        const cached = this.messageItemCache.get(cacheKey);
        if (cached && cached.message === message && cached.messageIndex === index) {
          return cached;
        }
        const item = new MessageTreeItem(message, element.session.sessionId, index);
        this.messageItemCache.set(cacheKey, item);
        return item;
      });
      console.log('LogTreeProvider: Returning message items:', messageItems.length);
      return Promise.resolve(messageItems);
    }

    return Promise.resolve([]);
  }

  getParent(element: TreeItem): TreeItem | undefined {
    if (element instanceof MessageTreeItem) {
      // Find the parent session for this message
      const session = this.sessions.find(s => s.sessionId === element.sessionId);
      if (session) {
        // Return cached session item or create new one
        let sessionItem = this.sessionItemCache.get(session.sessionId);
        if (!sessionItem) {
          sessionItem = new SessionTreeItem(session);
          this.sessionItemCache.set(session.sessionId, sessionItem);
        }
        return sessionItem;
      }
    }
    // Sessions are at root level, so they have no parent
    // LoadingTreeItem and ErrorTreeItem also have no parent
    return undefined;
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

  async selectMessage(sessionId: string, messageId: string): Promise<void> {
    if (!this.treeView) {
      console.warn('TreeView not initialized');
      return;
    }

    // Find the session and message
    const session = this.sessions.find(s => s.sessionId === sessionId);
    if (!session) {
      console.warn(`Session ${sessionId} not found`);
      return;
    }

    const messageIndex = session.messages.findIndex(m => m.uuid === messageId);
    if (messageIndex === -1) {
      console.warn(`Message ${messageId} not found in session ${sessionId}`);
      return;
    }
    
    const message = session.messages[messageIndex];

    // Get cached tree items or create new ones
    let sessionItem = this.sessionItemCache.get(sessionId);
    if (!sessionItem) {
      sessionItem = new SessionTreeItem(session);
      this.sessionItemCache.set(sessionId, sessionItem);
    }

    const messageCacheKey = message.uuid 
      ? `${sessionId}-${message.uuid}`
      : `${sessionId}-idx${messageIndex}`;
    let messageItem = this.messageItemCache.get(messageCacheKey);
    if (!messageItem) {
      messageItem = new MessageTreeItem(message, sessionId, messageIndex);
      this.messageItemCache.set(messageCacheKey, messageItem);
    }

    try {
      // First reveal and expand the session
      await this.treeView.reveal(sessionItem, {
        select: false,
        focus: false,
        expand: true
      });

      // Then reveal and select the message
      await this.treeView.reveal(messageItem, {
        select: true,
        focus: true,
        expand: false
      });
    } catch (error) {
      console.error('Failed to reveal tree item:', error);
    }
  }

  async expandSession(sessionId: string): Promise<void> {
    if (!this.treeView) {
      console.warn('TreeView not initialized');
      return;
    }

    const session = this.sessions.find(s => s.sessionId === sessionId);
    if (!session) {
      console.warn(`Session ${sessionId} not found`);
      return;
    }

    // Get cached tree item or create new one
    let sessionItem = this.sessionItemCache.get(sessionId);
    if (!sessionItem) {
      sessionItem = new SessionTreeItem(session);
      this.sessionItemCache.set(sessionId, sessionItem);
    }

    try {
      await this.treeView.reveal(sessionItem, {
        select: true,
        focus: true,
        expand: true
      });
    } catch (error) {
      console.error('Failed to expand session:', error);
    }
  }

  async revealMessage(sessionId: string, messageId: string): Promise<void> {
    // This is an alias for selectMessage for better API clarity
    await this.selectMessage(sessionId, messageId);
  }

  async selectMessageByIndex(sessionId: string, messageIndex: number): Promise<void> {
    if (!this.treeView) {
      console.warn('TreeView not initialized');
      return;
    }

    // Find the session
    const session = this.sessions.find(s => s.sessionId === sessionId);
    if (!session) {
      console.warn(`Session ${sessionId} not found`);
      return;
    }

    if (messageIndex < 0 || messageIndex >= session.messages.length) {
      console.warn(`Message index ${messageIndex} out of bounds for session ${sessionId}`);
      return;
    }
    
    const message = session.messages[messageIndex];

    // Get cached tree items or create new ones
    let sessionItem = this.sessionItemCache.get(sessionId);
    if (!sessionItem) {
      sessionItem = new SessionTreeItem(session);
      this.sessionItemCache.set(sessionId, sessionItem);
    }

    const messageCacheKey = message.uuid 
      ? `${sessionId}-${message.uuid}`
      : `${sessionId}-idx${messageIndex}`;
    let messageItem = this.messageItemCache.get(messageCacheKey);
    if (!messageItem) {
      messageItem = new MessageTreeItem(message, sessionId, messageIndex);
      this.messageItemCache.set(messageCacheKey, messageItem);
    }

    try {
      // First reveal and expand the session
      await this.treeView.reveal(sessionItem, {
        select: false,
        focus: false,
        expand: true
      });

      // Then reveal and select the message
      await this.treeView.reveal(messageItem, {
        select: true,
        focus: true,
        expand: false
      });
    } catch (error) {
      console.error('Failed to reveal tree item:', error);
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

    this.id = `session-${session.sessionId}`;
    this.description = session.summary;
    this.tooltip = `${session.summary}\n\nSession ID: ${session.sessionId}\nMessages: ${session.messages.length}\nTokens: ${session.totalTokens}\nCost: ${formatCostSummary(session.totalCost)}\nDuration: ${durationMinutes} minutes`;
    this.iconPath = new vscode.ThemeIcon('history');
    this.contextValue = 'logSession';
  }
}

export class MessageTreeItem extends TreeItem {
  constructor(public readonly message: TranscriptEntry, public readonly sessionId: string, public readonly messageIndex: number) {
    let label: string;
    if (message.type === 'summary') {
      label = `Summary - ${message.summary || 'Session Summary'}`;
    } else if (message.type === 'system') {
      const time = message.timestamp ? new Date(message.timestamp).toLocaleTimeString() : 'No time';
      const level = message.level ? ` [${message.level}]` : '';
      label = `${time} - System${level}`;
    } else {
      label = `${message.timestamp ? new Date(message.timestamp).toLocaleTimeString() : 'No time'} - ${message.type}`;
    }
    
    super(label, vscode.TreeItemCollapsibleState.None);

    // Use uuid if available, otherwise fall back to index-based ID
    if (message.uuid) {
      this.id = `message-${sessionId}-${message.uuid}`;
    } else {
      // Use index as fallback for messages without UUID
      this.id = `message-${sessionId}-idx${messageIndex}`;
    }
    
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

  private stripAnsiCodes(text: string): string {
    // Remove ANSI escape sequences
    return text.replace(/\u001b\[[0-9;]*m/g, '');
  }

  private getMessagePreview(): string {
    // Handle summary entries
    if (this.message.type === 'summary') {
      return this.message.summary || 'Session summary';
    }
    
    // Handle system entries
    if (this.message.type === 'system') {
      if (this.message.content) {
        // Remove ANSI codes and truncate
        const cleanContent = this.stripAnsiCodes(this.message.content);
        return cleanContent.length > 50 ? cleanContent.substring(0, 50) + '...' : cleanContent;
      }
      return 'System message';
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
    
    // Add common metadata
    if (this.message.gitBranch) {
      tooltip += `\nGit Branch: ${this.message.gitBranch}`;
    }
    if (this.message.version) {
      tooltip += `\nVersion: ${this.message.version}`;
    }
    if (this.message.cwd) {
      tooltip += `\nCWD: ${this.message.cwd}`;
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
    
    // Handle system entries
    if (this.message.type === 'system') {
      if (this.message.level) {
        tooltip += `\nLevel: ${this.message.level}`;
      }
      if (this.message.toolUseID) {
        tooltip += `\nTool Use ID: ${this.message.toolUseID}`;
      }
      if (this.message.content) {
        const cleanContent = this.stripAnsiCodes(this.message.content);
        tooltip += `\nContent: ${cleanContent}`;
      }
      if (this.message.uuid) {
        tooltip += `\nUUID: ${this.message.uuid}`;
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
      case 'system':
        return new vscode.ThemeIcon('gear');
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