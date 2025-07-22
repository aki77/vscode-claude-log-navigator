# Claude Log Navigator

A Visual Studio Code extension that helps you navigate and view Claude Code logs directly within your workspace. This extension automatically detects Claude projects and provides an intuitive interface to browse conversation history, analyze usage statistics, and review detailed message content.

![Demo](https://i.gyazo.com/17530d1f1c5ccb2e48317f9aea78f9e1.png)

## Features

- **Automatic Project Detection**: Automatically detects Claude projects in your workspace and loads corresponding log files
- **Conversation History**: Browse all your Claude conversation sessions with timestamps and summaries
- **Message Details**: View detailed message content with syntax highlighting and structured display
- **Search Functionality**: Search through messages with search history and direct navigation to results in the tree view
- **Usage Analytics**: Track token usage and cost information for each conversation
- **Date Filtering**: Filter conversations by date ranges (today, yesterday, this week, this month, or custom range)
- **Cost Calculation**: Automatic cost calculation based on model usage and service tiers

## Requirements

- Visual Studio Code 1.101.0 or higher
- Claude Code
- Claude log files stored in `~/.claude/projects/` directory

The extension automatically detects Claude projects in your workspace and loads the corresponding log files from the Claude projects directory.

## Extension Settings

This extension contributes the following settings:

- `claudeLogNavigator.maxFiles`: Maximum number of recent log files to load (default: 500, range: 10-10000)

You can adjust this setting in VS Code preferences to control how many log files are loaded for performance optimization.

## How to Use

1. **Open a Claude Project**: Open a workspace folder that corresponds to a Claude project
2. **Access Claude Logs Panel**: The extension automatically adds a "Claude Logs" panel to the bottom panel area
3. **Browse Conversations**: Expand the "Claude Code Logs" tree view to see all conversation sessions
4. **View Message Details**: Click on any message to open a detailed view in a new panel
5. **Filter by Date**: Use the filter button in the toolbar to filter conversations by date range
6. **Refresh**: Use the refresh button to reload the latest log files

### Available Commands

- **Refresh**: Reload log files from the Claude projects directory
- **Filter by Date**: Filter conversations by various date ranges
- **Clear Filter**: Remove any applied date filters
- **Search Messages**: Search through conversation messages with history tracking
- **Open Log Detail**: View detailed message content (available in context menu)

## Known Issues

- Large log files may take some time to load initially
- Cost calculations are estimates based on current pricing models
