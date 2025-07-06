import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

export class ProjectDetector {
  private claudeProjectsDir: string;

  constructor() {
    this.claudeProjectsDir = path.join(os.homedir(), '.claude', 'projects');
  }

  async detectCurrentProject(): Promise<string | null> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    console.log('Workspace folders:', workspaceFolders?.map(f => f.uri.fsPath));
    
    if (!workspaceFolders || workspaceFolders.length === 0) {
      console.log('No workspace folders found');
      return null;
    }

    const currentWorkspacePath = workspaceFolders[0].uri.fsPath;
    const claudeProjectPath = this.convertProjectPathToClaudeDir(currentWorkspacePath);
    
    console.log('Current workspace path:', currentWorkspacePath);
    console.log('Claude project path:', claudeProjectPath);
    console.log('Claude project path exists:', fs.existsSync(claudeProjectPath));
    
    if (fs.existsSync(claudeProjectPath)) {
      return claudeProjectPath;
    }

    return null;
  }

  async hasClaudeProject(): Promise<boolean> {
    const projectPath = await this.detectCurrentProject();
    return projectPath !== null;
  }

  private convertProjectPathToClaudeDir(projectPath: string): string {
    // Convert project path to Claude directory format
    // Example: /Users/aki/src/github.com/aki77/vscode-claude-log-navigator -> ~/.claude/projects/-Users-aki-src-github-com-aki77-vscode-claude-log-navigator
    const normalizedPath = path.normalize(projectPath);
    
    // Replace all path separators with hyphens, then replace dots with hyphens
    const claudeDirName = normalizedPath.replace(/[/.]/g, '-');
    
    return path.join(this.claudeProjectsDir, claudeDirName);
  }

  async listAllClaudeProjects(): Promise<string[]> {
    if (!fs.existsSync(this.claudeProjectsDir)) {
      return [];
    }

    const entries = fs.readdirSync(this.claudeProjectsDir, { withFileTypes: true });
    return entries
      .filter(entry => entry.isDirectory())
      .map(entry => path.join(this.claudeProjectsDir, entry.name));
  }

  getClaudeProjectsDirectory(): string {
    return this.claudeProjectsDir;
  }
}