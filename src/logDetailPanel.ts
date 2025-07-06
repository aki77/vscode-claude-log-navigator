import * as vscode from 'vscode';
import { TranscriptEntry, ContentItem } from './models';

export class LogDetailPanel {
  public static currentPanel: LogDetailPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];

  public static createOrShow(extensionUri: vscode.Uri, message: TranscriptEntry) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (LogDetailPanel.currentPanel) {
      LogDetailPanel.currentPanel._panel.reveal(column);
      LogDetailPanel.currentPanel._update(message);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'claudeLogDetail',
      'Claude Log Detail',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, 'media'),
          vscode.Uri.joinPath(extensionUri, 'out', 'compiled')
        ]
      }
    );

    LogDetailPanel.currentPanel = new LogDetailPanel(panel, extensionUri);
    LogDetailPanel.currentPanel._update(message);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._extensionUri = extensionUri;

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
  }

  public dispose() {
    LogDetailPanel.currentPanel = undefined;

    this._panel.dispose();

    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  private _update(message: TranscriptEntry) {
    const webview = this._panel.webview;
    this._panel.title = `Log Detail - ${message.type}`;
    this._panel.webview.html = this._getHtmlForWebview(webview, message);
  }

  private _getHtmlForWebview(webview: vscode.Webview, message: TranscriptEntry): string {
    // Handle summary entries specially
    if (message.type === 'summary') {
      return this._renderSummaryEntry(message);
    }
    
    const content = this._renderContent(message.message?.content);
    const timestamp = message.timestamp ? new Date(message.timestamp).toLocaleString() : 'No timestamp';
    const usage = message.message?.usage ? `
      <div class="usage-info">
        <h3>Token Usage</h3>
        <p>Input: ${message.message.usage.input_tokens}</p>
        <p>Output: ${message.message.usage.output_tokens}</p>
        <p>Total: ${message.message.usage.input_tokens + message.message.usage.output_tokens}</p>
        ${message.message.usage.cache_creation_input_tokens ? `<p>Cache Creation: ${message.message.usage.cache_creation_input_tokens}</p>` : ''}
      </div>
    ` : '';

    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Claude Log Detail</title>
        <style>
          body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 20px;
            line-height: 1.6;
          }
          .header {
            border-bottom: 1px solid var(--vscode-panel-border);
            padding-bottom: 10px;
            margin-bottom: 20px;
          }
          .metadata {
            color: var(--vscode-descriptionForeground);
            font-size: 0.9em;
          }
          .content {
            margin: 20px 0;
          }
          .usage-info {
            background-color: var(--vscode-editor-inactiveSelectionBackground);
            padding: 15px;
            border-radius: 4px;
            margin-top: 20px;
          }
          .usage-info h3 {
            margin-top: 0;
            color: var(--vscode-textLink-foreground);
          }
          .tool-use {
            background-color: var(--vscode-textBlockQuote-background);
            border-left: 4px solid var(--vscode-textBlockQuote-border);
            padding: 10px;
            margin: 10px 0;
          }
          .tool-result {
            background-color: var(--vscode-editor-findMatchBackground);
            padding: 10px;
            border-radius: 4px;
            margin: 10px 0;
          }
          pre {
            background-color: var(--vscode-textCodeBlock-background);
            padding: 10px;
            border-radius: 4px;
            overflow-x: auto;
          }
          code {
            background-color: var(--vscode-textCodeBlock-background);
            padding: 2px 4px;
            border-radius: 2px;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>${message.type.toUpperCase()}</h1>
          <div class="metadata">
            ${message.sessionId ? `<p>Session ID: ${message.sessionId}</p>` : ''}
            <p>Timestamp: ${timestamp}</p>
            ${message.uuid ? `<p>UUID: ${message.uuid}</p>` : ''}
            ${message.message?.role ? `<p>Role: ${message.message.role}</p>` : ''}
            ${message.message?.model ? `<p>Model: ${message.message.model}</p>` : ''}
            ${message.requestId ? `<p>Request ID: ${message.requestId}</p>` : ''}
          </div>
        </div>
        
        <div class="content">
          ${content}
        </div>

        ${usage}
      </body>
      </html>
    `;
  }

  private _renderContent(content: string | ContentItem[] | undefined): string {
    if (typeof content === 'string') {
      return this._formatText(content);
    }

    if (Array.isArray(content)) {
      return content.map(item => this._renderContentItem(item)).join('');
    }

    return '<p>No content available</p>';
  }

  private _renderContentItem(item: ContentItem): string {
    switch (item.type) {
      case 'text':
        return this._formatText(item.text || '');
      
      case 'tool_use':
        return `
          <div class="tool-use">
            <h3>Tool Use: ${item.name}</h3>
            ${item.id ? `<p><strong>ID:</strong> ${item.id}</p>` : ''}
            <pre><code>${JSON.stringify(item.input, null, 2)}</code></pre>
          </div>
        `;
      
      case 'tool_result':
        return `
          <div class="tool-result">
            <h3>Tool Result</h3>
            ${item.tool_use_id ? `<p><strong>Tool Use ID:</strong> ${item.tool_use_id}</p>` : ''}
            <pre><code>${item.content || ''}</code></pre>
          </div>
        `;
      
      case 'thinking':
        return `
          <div class="thinking">
            <h3>Thinking</h3>
            <p>${this._formatText(item.content || '')}</p>
          </div>
        `;
      
      case 'image':
        return `
          <div class="image">
            <h3>Image</h3>
            <p>Image content (${item.source?.type || 'unknown'})</p>
          </div>
        `;
      
      default:
        return `
          <div class="unknown-content">
            <h3>Unknown Content Type: ${item.type}</h3>
            <pre><code>${JSON.stringify(item, null, 2)}</code></pre>
          </div>
        `;
    }
  }

  private _formatText(text: string): string {
    // Simple markdown-like formatting
    text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/\*(.*?)\*/g, '<em>$1</em>');
    text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
    text = text.replace(/```([^`]+)```/g, '<pre><code>$1</code></pre>');
    text = text.replace(/\n/g, '<br>');
    
    return `<p>${text}</p>`;
  }

  private _renderSummaryEntry(message: TranscriptEntry): string {
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Session Summary</title>
        <style>
          body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 20px;
            line-height: 1.6;
          }
          .header {
            border-bottom: 1px solid var(--vscode-panel-border);
            padding-bottom: 10px;
            margin-bottom: 20px;
          }
          .summary-header {
            background: linear-gradient(45deg, var(--vscode-textLink-foreground), var(--vscode-button-background));
            color: var(--vscode-button-foreground);
            padding: 20px;
            border-radius: 8px;
            margin-bottom: 20px;
            text-align: center;
          }
          .summary-content {
            background-color: var(--vscode-editor-inactiveSelectionBackground);
            padding: 20px;
            border-radius: 8px;
            border-left: 4px solid var(--vscode-textLink-foreground);
          }
          .metadata {
            color: var(--vscode-descriptionForeground);
            font-size: 0.9em;
            background-color: var(--vscode-textBlockQuote-background);
            padding: 15px;
            border-radius: 4px;
            margin-top: 20px;
          }
          .summary-icon {
            font-size: 2em;
            margin-bottom: 10px;
          }
        </style>
      </head>
      <body>
        <div class="summary-header">
          <div class="summary-icon">📄</div>
          <h1>Session Summary</h1>
        </div>
        
        <div class="summary-content">
          <h2>Summary</h2>
          <p>${message.summary || 'No summary available'}</p>
        </div>

        <div class="metadata">
          <h3>Metadata</h3>
          ${message.leafUuid ? `<p><strong>Leaf UUID:</strong> ${message.leafUuid}</p>` : ''}
          ${message.type ? `<p><strong>Type:</strong> ${message.type}</p>` : ''}
          ${message.sessionId ? `<p><strong>Session ID:</strong> ${message.sessionId}</p>` : ''}
          ${message.uuid ? `<p><strong>UUID:</strong> ${message.uuid}</p>` : ''}
        </div>
      </body>
      </html>
    `;
  }
}