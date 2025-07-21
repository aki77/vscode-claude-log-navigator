import * as vscode from 'vscode';
import { TranscriptEntry, ContentItem } from './models';
import { calculateCost, formatCost, CostBreakdown } from './costCalculator';

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
    
    // Handle system entries specially
    if (message.type === 'system') {
      return this._renderSystemEntry(message);
    }
    
    const content = this._renderContent(message.message?.content);
    const timestamp = message.timestamp ? new Date(message.timestamp).toLocaleString() : 'No timestamp';
    const usage = message.message?.usage ? this._renderUsageInfo(message) : '';
    const rawJson = JSON.stringify(message, null, 2);

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
          .cost-info {
            background-color: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            padding: 10px;
            border-radius: 4px;
            margin-top: 10px;
          }
          .cost-breakdown {
            font-size: 0.9em;
            margin-top: 8px;
          }
          .cost-breakdown div {
            margin: 2px 0;
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
          .raw-json-section {
            margin-top: 30px;
            border-top: 1px solid var(--vscode-panel-border);
            padding-top: 20px;
          }
          .toggle-json-btn {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            display: flex;
            align-items: center;
            gap: 5px;
          }
          .toggle-json-btn:hover {
            background-color: var(--vscode-button-hoverBackground);
          }
          .json-content {
            margin-top: 10px;
            background-color: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            padding: 15px;
            overflow-x: auto;
            max-height: 500px;
            overflow-y: auto;
          }
          .json-content pre {
            margin: 0;
            white-space: pre-wrap;
            word-break: break-word;
          }
          .arrow {
            transition: transform 0.2s ease;
            display: inline-block;
          }
          .arrow.down {
            transform: rotate(90deg);
          }
          .ansi-bold { font-weight: bold; }
          .ansi-red { color: #e74c3c; }
          .ansi-green { color: #2ecc71; }
          .ansi-yellow { color: #f1c40f; }
          .ansi-blue { color: #3498db; }
          .ansi-magenta { color: #9b59b6; }
          .ansi-cyan { color: #1abc9c; }
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
            ${message.gitBranch ? `<p>Git Branch: ${message.gitBranch}</p>` : ''}
            ${message.cwd ? `<p>CWD: ${message.cwd}</p>` : ''}
            ${message.version ? `<p>Version: ${message.version}</p>` : ''}
            ${message.userType ? `<p>User Type: ${message.userType}</p>` : ''}
          </div>
        </div>
        
        <div class="content">
          ${content}
        </div>

        ${usage}

        <div class="raw-json-section">
          <button class="toggle-json-btn" onclick="toggleJsonView()">
            <span class="arrow">▶</span>
            <span>Show Raw JSON</span>
          </button>
          <div class="json-content" id="json-content" style="display: none;">
            <pre><code>${this._escapeHtml(rawJson)}</code></pre>
          </div>
        </div>

        <script>
          function toggleJsonView() {
            const jsonContent = document.getElementById('json-content');
            const button = document.querySelector('.toggle-json-btn');
            const arrow = button.querySelector('.arrow');
            const text = button.querySelector('span:last-child');
            
            if (jsonContent.style.display === 'none') {
              jsonContent.style.display = 'block';
              arrow.classList.add('down');
              text.textContent = 'Hide Raw JSON';
            } else {
              jsonContent.style.display = 'none';
              arrow.classList.remove('down');
              text.textContent = 'Show Raw JSON';
            }
          }
        </script>
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

  private _renderUsageInfo(message: TranscriptEntry): string {
    const usage = message.message?.usage;
    if (!usage) {return '';}
    
    const model = message.message?.model || 'unknown';
    const serviceTier = usage.service_tier;
    
    let costInfo = '';
    if (usage.input_tokens || usage.output_tokens) {
      const costBreakdown = calculateCost(usage, model, serviceTier);
      costInfo = `
        <div class="cost-info">
          <strong>Cost: ${formatCost(costBreakdown.totalCost)}</strong>
          <div class="cost-breakdown">
            <div>Input (${usage.input_tokens} tokens): ${formatCost(costBreakdown.inputCost)}</div>
            <div>Output (${usage.output_tokens} tokens): ${formatCost(costBreakdown.outputCost)}</div>
            ${costBreakdown.cacheCreationCost > 0 ? `<div>Cache Creation (${usage.cache_creation_input_tokens} tokens): ${formatCost(costBreakdown.cacheCreationCost)}</div>` : ''}
            ${costBreakdown.cacheReadCost > 0 ? `<div>Cache Read (${usage.cache_read_input_tokens} tokens): ${formatCost(costBreakdown.cacheReadCost)}</div>` : ''}
            ${serviceTier ? `<div>Service Tier: ${serviceTier}</div>` : ''}
            <div>Model: ${model}</div>
          </div>
        </div>
      `;
    }
    
    return `
      <div class="usage-info">
        <h3>Token Usage</h3>
        <p>Input: ${usage.input_tokens}</p>
        <p>Output: ${usage.output_tokens}</p>
        <p>Total: ${usage.input_tokens + usage.output_tokens}</p>
        ${usage.cache_creation_input_tokens ? `<p>Cache Creation: ${usage.cache_creation_input_tokens}</p>` : ''}
        ${usage.cache_read_input_tokens ? `<p>Cache Read: ${usage.cache_read_input_tokens}</p>` : ''}
        ${costInfo}
      </div>
    `;
  }

  private _renderSummaryEntry(message: TranscriptEntry): string {
    const rawJson = JSON.stringify(message, null, 2);
    
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
          .raw-json-section {
            margin-top: 30px;
            border-top: 1px solid var(--vscode-panel-border);
            padding-top: 20px;
          }
          .toggle-json-btn {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            display: flex;
            align-items: center;
            gap: 5px;
          }
          .toggle-json-btn:hover {
            background-color: var(--vscode-button-hoverBackground);
          }
          .json-content {
            margin-top: 10px;
            background-color: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            padding: 15px;
            overflow-x: auto;
            max-height: 500px;
            overflow-y: auto;
          }
          .json-content pre {
            margin: 0;
            white-space: pre-wrap;
            word-break: break-word;
          }
          .arrow {
            transition: transform 0.2s ease;
            display: inline-block;
          }
          .arrow.down {
            transform: rotate(90deg);
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

        <div class="raw-json-section">
          <button class="toggle-json-btn" onclick="toggleJsonView()">
            <span class="arrow">▶</span>
            <span>Show Raw JSON</span>
          </button>
          <div class="json-content" id="json-content" style="display: none;">
            <pre><code>${this._escapeHtml(rawJson)}</code></pre>
          </div>
        </div>

        <script>
          function toggleJsonView() {
            const jsonContent = document.getElementById('json-content');
            const button = document.querySelector('.toggle-json-btn');
            const arrow = button.querySelector('.arrow');
            const text = button.querySelector('span:last-child');
            
            if (jsonContent.style.display === 'none') {
              jsonContent.style.display = 'block';
              arrow.classList.add('down');
              text.textContent = 'Hide Raw JSON';
            } else {
              jsonContent.style.display = 'none';
              arrow.classList.remove('down');
              text.textContent = 'Show Raw JSON';
            }
          }
        </script>
      </body>
      </html>
    `;
  }

  private _escapeHtml(text: string): string {
    const map: { [key: string]: string } = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
  }

  private _convertAnsiToHtml(text: string): string {
    // Convert ANSI escape sequences to HTML
    return text
      .replace(/\u001b\[1m/g, '<span class="ansi-bold">')
      .replace(/\u001b\[22m/g, '</span>')
      .replace(/\u001b\[31m/g, '<span class="ansi-red">')
      .replace(/\u001b\[32m/g, '<span class="ansi-green">')
      .replace(/\u001b\[33m/g, '<span class="ansi-yellow">')
      .replace(/\u001b\[34m/g, '<span class="ansi-blue">')
      .replace(/\u001b\[35m/g, '<span class="ansi-magenta">')
      .replace(/\u001b\[36m/g, '<span class="ansi-cyan">')
      .replace(/\u001b\[39m/g, '</span>')
      .replace(/\u001b\[0m/g, '</span>');
  }

  private _renderSystemEntry(message: TranscriptEntry): string {
    const timestamp = message.timestamp ? new Date(message.timestamp).toLocaleString() : 'No timestamp';
    const content = message.content ? this._convertAnsiToHtml(this._escapeHtml(message.content)) : 'No content';
    const rawJson = JSON.stringify(message, null, 2);

    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>System Log Detail</title>
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
            background-color: var(--vscode-textBlockQuote-background);
            padding: 15px;
            border-radius: 4px;
            border-left: 4px solid var(--vscode-textBlockQuote-border);
          }
          .raw-json-section {
            margin-top: 30px;
            border-top: 1px solid var(--vscode-panel-border);
            padding-top: 20px;
          }
          .toggle-json-btn {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            display: flex;
            align-items: center;
            gap: 5px;
          }
          .toggle-json-btn:hover {
            background-color: var(--vscode-button-hoverBackground);
          }
          .json-content {
            margin-top: 10px;
            background-color: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            padding: 15px;
            overflow-x: auto;
            max-height: 500px;
            overflow-y: auto;
          }
          .json-content pre {
            margin: 0;
            white-space: pre-wrap;
            word-break: break-word;
          }
          .arrow {
            transition: transform 0.2s ease;
            display: inline-block;
          }
          .arrow.down {
            transform: rotate(90deg);
          }
          .ansi-bold { font-weight: bold; }
          .ansi-red { color: #e74c3c; }
          .ansi-green { color: #2ecc71; }
          .ansi-yellow { color: #f1c40f; }
          .ansi-blue { color: #3498db; }
          .ansi-magenta { color: #9b59b6; }
          .ansi-cyan { color: #1abc9c; }
          .level-info { color: var(--vscode-textLink-foreground); }
          .level-warning { color: #f1c40f; }
          .level-error { color: #e74c3c; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>SYSTEM ${message.level ? `<span class="level-${message.level}">[${message.level.toUpperCase()}]</span>` : ''}</h1>
          <div class="metadata">
            ${message.sessionId ? `<p>Session ID: ${message.sessionId}</p>` : ''}
            <p>Timestamp: ${timestamp}</p>
            ${message.uuid ? `<p>UUID: ${message.uuid}</p>` : ''}
            ${message.toolUseID ? `<p>Tool Use ID: ${message.toolUseID}</p>` : ''}
            ${message.gitBranch ? `<p>Git Branch: ${message.gitBranch}</p>` : ''}
            ${message.cwd ? `<p>CWD: ${message.cwd}</p>` : ''}
            ${message.version ? `<p>Version: ${message.version}</p>` : ''}
            ${message.userType ? `<p>User Type: ${message.userType}</p>` : ''}
          </div>
        </div>
        
        <div class="content">
          <p>${content}</p>
        </div>

        <div class="raw-json-section">
          <button class="toggle-json-btn" onclick="toggleJsonView()">
            <span class="arrow">▶</span>
            <span>Show Raw JSON</span>
          </button>
          <div class="json-content" id="json-content" style="display: none;">
            <pre><code>${this._escapeHtml(rawJson)}</code></pre>
          </div>
        </div>

        <script>
          function toggleJsonView() {
            const jsonContent = document.getElementById('json-content');
            const button = document.querySelector('.toggle-json-btn');
            const arrow = button.querySelector('.arrow');
            const text = button.querySelector('span:last-child');
            
            if (jsonContent.style.display === 'none') {
              jsonContent.style.display = 'block';
              arrow.classList.add('down');
              text.textContent = 'Hide Raw JSON';
            } else {
              jsonContent.style.display = 'none';
              arrow.classList.remove('down');
              text.textContent = 'Show Raw JSON';
            }
          }
        </script>
      </body>
      </html>
    `;
  }
}