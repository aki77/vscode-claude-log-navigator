import * as vscode from 'vscode';

export class SearchHistory {
  private static readonly HISTORY_KEY = 'claudeLogNavigator.searchHistory';
  private static readonly MAX_HISTORY_SIZE = 10;

  constructor(private context: vscode.ExtensionContext) {}

  async getHistory(): Promise<string[]> {
    return this.context.globalState.get<string[]>(SearchHistory.HISTORY_KEY, []);
  }

  async addQuery(query: string): Promise<void> {
    if (!query.trim()) {
      return;
    }

    const history = await this.getHistory();
    
    const existingIndex = history.indexOf(query);
    if (existingIndex !== -1) {
      history.splice(existingIndex, 1);
    }
    
    history.unshift(query);
    
    if (history.length > SearchHistory.MAX_HISTORY_SIZE) {
      history.splice(SearchHistory.MAX_HISTORY_SIZE);
    }

    await this.context.globalState.update(SearchHistory.HISTORY_KEY, history);
  }

  async clearHistory(): Promise<void> {
    await this.context.globalState.update(SearchHistory.HISTORY_KEY, []);
  }
}