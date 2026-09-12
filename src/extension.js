const vscode = require('vscode');
const { DevMateChatViewProvider } = require('./chatViewProvider');

let chatProvider;

/**
 * This function runs once when VS Code loads your extension.
 * It's the entry point — think of it like main() in other languages.
 */
function activate(context) {
  console.log('DevMate is now active');

  chatProvider = new DevMateChatViewProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('devmateChatView', chatProvider)
  );

  const disposable = vscode.commands.registerCommand(
    'devmate.explainError',
    async () => {
      await explainSelectedError();
    }
  );

  const clipboardDisposable = vscode.commands.registerCommand(
    'devmate.explainClipboard',
    async () => {
      await explainClipboardError();
    }
  );

  const openChatDisposable = vscode.commands.registerCommand(
    'devmate.openChat',
    async () => {
      await vscode.commands.executeCommand('devmateChatView.focus');
    }
  );

  context.subscriptions.push(disposable, clipboardDisposable, openChatDisposable);
}

async function explainSelectedError() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage('No active editor found.');
    return;
  }

  const selection = editor.selection;
  const selectedText = editor.document.getText(selection);

  if (!selectedText || selectedText.trim().length === 0) {
    vscode.window.showErrorMessage('Please select an error message or stack trace first.');
    return;
  }

  await chatProvider.sendExternalMessage(selectedText);
}

/**
 * Reads whatever is currently on the clipboard and sends it into the chat.
 * Fix for terminal errors: select it there, Ctrl+C, then run this command
 * (bound to Ctrl+Alt+E) — no pasting into a file required.
 */
async function explainClipboardError() {
  const clipboardText = await vscode.env.clipboard.readText();

  if (!clipboardText || clipboardText.trim().length === 0) {
    vscode.window.showErrorMessage('Clipboard is empty. Copy an error first (select it and Ctrl+C).');
    return;
  }

  await chatProvider.sendExternalMessage(clipboardText);
}

function deactivate() {}

module.exports = { activate, deactivate };
