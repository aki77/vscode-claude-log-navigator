import * as vscode from 'vscode';
import { LogTreeProvider } from './logTreeProvider';
import { LogDetailPanel } from './logDetailPanel';
import { ProjectDetector } from './projectDetector';
import { TranscriptEntry, DateFilter } from './models';
import { SearchProvider } from './searchProvider';

export function activate(context: vscode.ExtensionContext) {
  const projectDetector = new ProjectDetector();
  const logTreeProvider = new LogTreeProvider();
  const searchProvider = new SearchProvider(context, logTreeProvider);

  // Register tree view
  const treeView = vscode.window.createTreeView('claudeLogNavigator', {
    treeDataProvider: logTreeProvider,
    showCollapseAll: true
  });

  // Set tree view reference
  logTreeProvider.setTreeView(treeView);

  // Set context for when clause
  projectDetector.hasClaudeProject().then(hasProject => {
    console.log('Has Claude project:', hasProject);
    vscode.commands.executeCommand('setContext', 'workspaceHasClaudeProject', hasProject);
  });

  // Register commands
  const refreshCommand = vscode.commands.registerCommand('claudeLogNavigator.refresh', () => {
    logTreeProvider.refresh();
  });

  const filterByDateCommand = vscode.commands.registerCommand('claudeLogNavigator.filterByDate', async () => {
    const options = [
      { label: 'Today', value: 'today' },
      { label: 'Yesterday', value: 'yesterday' },
      { label: 'This Week', value: 'week' },
      { label: 'This Month', value: 'month' },
      { label: 'Custom Range', value: 'custom' }
    ];

    const selected = await vscode.window.showQuickPick(options, {
      placeHolder: 'Select date range'
    });

    if (!selected) {
      return;
    }

    let filter: DateFilter;

    if (selected.value === 'custom') {
      const fromInput = await vscode.window.showInputBox({
        prompt: 'Enter start date (YYYY-MM-DD)',
        placeHolder: '2023-01-01'
      });

      const toInput = await vscode.window.showInputBox({
        prompt: 'Enter end date (YYYY-MM-DD)',
        placeHolder: '2023-12-31'
      });

      if (!fromInput || !toInput) {
        return;
      }

      filter = {
        from: new Date(fromInput),
        to: new Date(toInput)
      };
    } else {
      filter = {
        preset: selected.value as 'today' | 'yesterday' | 'week' | 'month'
      };
    }

    await logTreeProvider.applyDateFilter(filter);
  });

  const clearFilterCommand = vscode.commands.registerCommand('claudeLogNavigator.clearFilter', () => {
    logTreeProvider.clearFilter();
  });

  const openLogDetailCommand = vscode.commands.registerCommand('claudeLogNavigator.openLogDetail', (message: TranscriptEntry) => {
    LogDetailPanel.createOrShow(context.extensionUri, message);
  });

  const searchLogsCommand = vscode.commands.registerCommand('claudeLogNavigator.searchLogs', () => {
    searchProvider.showSearchQuickPick();
  });

  // Register disposables
  context.subscriptions.push(
    treeView,
    refreshCommand,
    filterByDateCommand,
    clearFilterCommand,
    openLogDetailCommand,
    searchLogsCommand
  );

  // Watch for workspace changes
  vscode.workspace.onDidChangeWorkspaceFolders(async () => {
    const hasProject = await projectDetector.hasClaudeProject();
    vscode.commands.executeCommand('setContext', 'workspaceHasClaudeProject', hasProject);
    logTreeProvider.refresh();
  });

  // Watch for configuration changes
  vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration('claudeLogNavigator.maxFiles')) {
      const config = vscode.workspace.getConfiguration('claudeLogNavigator');
      const maxFiles = config.get<number>('maxFiles', 500);
      logTreeProvider.updateMaxFiles(maxFiles);
      logTreeProvider.refresh();
    }
  });

  console.log('Claude Log Navigator is now active!');
}

export function deactivate() {
  if (LogDetailPanel.currentPanel) {
    LogDetailPanel.currentPanel.dispose();
  }
}
