const vscode = require('vscode');

/**
 * This function runs once when VS Code loads your extension.
 * It's the entry point — think of it like main() in other languages.
 */
function activate(context) {
  console.log('DevMate is now active');

  // Register the command we defined in package.json.
  // The string here MUST match "command" in package.json exactly.
  const disposable = vscode.commands.registerCommand(
    'devmate.explainError',
    async () => {
      await explainSelectedError();
    }
  );

  // "context.subscriptions" is how VS Code knows to clean this up
  // when the extension is deactivated. Always push disposables here.
  context.subscriptions.push(disposable);
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

  // Grab the API key from user settings (Settings > Extensions > DevMate)
  const config = vscode.workspace.getConfiguration('devmate');
  const apiKey = config.get('groqApiKey');

  if (!apiKey) {
    const choice = await vscode.window.showErrorMessage(
      'No API key set. Add your free Groq API key in DevMate settings.',
      'Open Settings'
    );
    if (choice === 'Open Settings') {
      vscode.commands.executeCommand('workbench.action.openSettings', 'devmate.groqApiKey');
    }
    return;
  }

  // Also grab some surrounding context: the full file's language and a
  // snippet around the selection, so the model has more to work with.
  const languageId = editor.document.languageId;
  const fileName = editor.document.fileName;

  // Show a progress notification while we wait for the API.
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'DevMate: Asking Claude to explain this...',
      cancellable: false
    },
    async () => {
      try {
        const explanation = await callGroq(apiKey, selectedText, languageId, fileName);
        showResultPanel(explanation, selectedText);
      } catch (err) {
        vscode.window.showErrorMessage(`DevMate failed: ${err.message}`);
      }
    }
  );
}

/**
 * Calls Groq's API (free tier, OpenAI-compatible format).
 * Get a free key at https://console.groq.com/keys
 */
async function callGroq(apiKey, errorText, languageId, fileName) {
  const prompt = `You are helping a developer understand an error. Here is the context:

File: ${fileName}
Language: ${languageId}

Error / selected text:
${errorText}

Explain in plain English:
1. What this error means
2. The most likely cause
3. A concrete suggested fix (with a short code example if relevant)

Keep it concise and practical.`;

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'openai/gpt-oss-120b',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!response.ok) {
    const errBody = await response.text();
    console.error('DevMate Groq API error:', response.status, errBody);
    throw new Error(`API error (${response.status}): ${errBody}`);
  }

  const data = await response.json();
  // OpenAI-compatible format: choices[0].message.content
  return data.choices?.[0]?.message?.content || 'No explanation returned.';
}

/**
 * Shows the result in a WebView panel — basically a mini browser tab
 * inside VS Code where we control the HTML.
 */
function showResultPanel(explanation, originalError) {
  const panel = vscode.window.createWebviewPanel(
    'devmateExplanation',
    'DevMate: Error Explanation',
    vscode.ViewColumn.Beside,
    { enableScripts: false }
  );

  // Basic escaping so the error text can't break the HTML.
  const escapeHtml = (str) =>
    str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  panel.webview.html = `
    <html>
      <body style="font-family: sans-serif; padding: 16px; line-height: 1.5;">
        <h2>Original</h2>
        <pre style="background:#2222; padding:10px; border-radius:6px; white-space:pre-wrap;">${escapeHtml(originalError)}</pre>
        <h2>Explanation</h2>
        <div style="white-space:pre-wrap;">${escapeHtml(explanation)}</div>
      </body>
    </html>
  `;
}

function deactivate() {}

module.exports = { activate, deactivate };
