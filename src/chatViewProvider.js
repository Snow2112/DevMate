const vscode = require('vscode');

/**
 * This class implements VS Code's "WebviewViewProvider" interface — it's how
 * you add a custom panel to the sidebar (the same mechanism Copilot Chat and
 * other chat-style extensions use).
 *
 * VS Code calls `resolveWebviewView` once, when the user opens the panel.
 * We keep a reference to the webview so we can push new messages into it
 * later, and we listen for messages coming FROM the webview (i.e. when the
 * user types something and hits send).
 */
class DevMateChatViewProvider {
  constructor(context) {
    this.context = context;
    this.history = []; // { role: 'user' | 'assistant', text: string }
  }

  resolveWebviewView(webviewView) {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true
    };

    webviewView.webview.html = this._getHtml();

    // Listen for messages sent from the webview's JS (see the <script> at
    // the bottom of _getHtml). This is the ONLY way data crosses the
    // boundary between "extension code" (Node.js, full access) and
    // "webview code" (sandboxed, browser-like).
    webviewView.webview.onDidReceiveMessage(async (message) => {
      if (message.type === 'ask') {
        await this._handleUserMessage(message.text);
      }
    });
  }

  /**
   * Called externally (e.g. from a command) to pre-fill and send a message,
   * so "explain this selection" can feed straight into the chat instead of
   * opening a separate popup panel.
   */
  async sendExternalMessage(text) {
    if (!this.view) {
      // Panel isn't open yet — open it first.
      await vscode.commands.executeCommand('devmateChatView.focus');
    }
    await this._handleUserMessage(text);
  }

  async _handleUserMessage(text) {
    if (!text || text.trim().length === 0) return;

    this.history.push({ role: 'user', text });
    this._postToWebview({ type: 'addMessage', role: 'user', text });
    this._postToWebview({ type: 'setLoading', loading: true });

    const config = vscode.workspace.getConfiguration('devmate');
    const apiKey = config.get('groqApiKey');

    if (!apiKey) {
      const errText = 'No Groq API key set. Open Settings, search "DevMate", and paste your key into devmate.groqApiKey.';
      this.history.push({ role: 'assistant', text: errText });
      this._postToWebview({ type: 'addMessage', role: 'assistant', text: errText });
      this._postToWebview({ type: 'setLoading', loading: false });
      return;
    }

    try {
      const editor = vscode.window.activeTextEditor;
      const languageId = editor ? editor.document.languageId : 'unknown';
      const fileName = editor ? editor.document.fileName : '(no active file)';

      const reply = await this._callGroq(apiKey, text, languageId, fileName);
      this.history.push({ role: 'assistant', text: reply });
      this._postToWebview({ type: 'addMessage', role: 'assistant', text: reply });
    } catch (err) {
      const errText = `Error: ${err.message}`;
      this.history.push({ role: 'assistant', text: errText });
      this._postToWebview({ type: 'addMessage', role: 'assistant', text: errText });
    } finally {
      this._postToWebview({ type: 'setLoading', loading: false });
    }
  }

  _postToWebview(message) {
    if (this.view) {
      this.view.webview.postMessage(message);
    }
  }

  async _callGroq(apiKey, userText, languageId, fileName) {
    // Include recent conversation history so follow-up questions have context,
    // not just the latest message in isolation.
    const conversationMessages = this.history.slice(-10).map((m) => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.text
    }));

    const systemContext = `You are DevMate, a focused coding assistant inside VS Code. The user's active file is ${fileName} (${languageId}).

Scope: only help with programming-related topics — errors, stack traces, code explanation, debugging, programming concepts, and general dev questions (e.g. "what is Python" is fine). If the user asks for something clearly unrelated to programming (poems, trivia, general chit-chat, creative writing, etc.), politely decline in one sentence and steer back to coding help — don't fulfill the off-topic request.

If the user pastes an error message or stack trace, ALWAYS structure your response in exactly this format using markdown:

## Original Error
(briefly restate the key error line, in a code block)

## What's Happening
(explain in plain, beginner-friendly English what this error means — assume the reader is new to programming, avoid jargon without explaining it)

## Why It Happened
(the likely root cause, based on the actual code/stack trace shown)

## How to Fix It
(concrete, numbered steps, with a short corrected code example)

For other in-scope questions (explaining code, general programming questions), just answer naturally — don't force this structure.

Keep explanations clear and practical, not overly long.`;

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-120b',
        max_tokens: 1000,
        messages: [{ role: 'system', content: systemContext }, ...conversationMessages]
      })
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error('DevMate Groq API error:', response.status, errBody);
      throw new Error(`API error (${response.status}): ${errBody}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || 'No response returned.';
  }

  _getHtml() {
    // Everything here runs in a sandboxed browser-like context, NOT Node.js.
    // It can only talk to the extension via postMessage.
    return String.raw`<!DOCTYPE html>
<html>
<head>
<style>
  * { box-sizing: border-box; }
  body {
    font-family: var(--vscode-font-family);
    color: var(--vscode-foreground);
    background: var(--vscode-sideBar-background, var(--vscode-editor-background));
    display: flex;
    flex-direction: column;
    height: 100vh;
    margin: 0;
    padding: 0;
    font-size: 13px;
  }
  #messages {
    flex: 1;
    overflow-y: auto;
    padding: 12px 10px;
  }
  .msg-row {
    display: flex;
    gap: 8px;
    margin-bottom: 16px;
    align-items: flex-start;
  }
  .avatar {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 600;
    color: white;
  }
  .avatar.user { background: var(--vscode-button-background); }
  .avatar.assistant { background: #6b5bd6; }
  .bubble {
    flex: 1;
    padding: 8px 12px;
    border-radius: 8px;
    white-space: pre-wrap;
    line-height: 1.5;
  }
  .bubble.user {
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border);
  }
  .bubble.assistant {
    background: transparent;
    border: 1px solid var(--vscode-panel-border);
  }
  #inputArea {
    display: flex;
    padding: 10px;
    border-top: 1px solid var(--vscode-panel-border);
    gap: 6px;
  }
  #textInput {
    flex: 1;
    resize: none;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border);
    border-radius: 6px;
    padding: 8px;
    font-family: inherit;
    font-size: 13px;
  }
  #sendBtn {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
    border-radius: 6px;
    padding: 0 16px;
    cursor: pointer;
    font-weight: 500;
  }
  #sendBtn:hover {
    background: var(--vscode-button-hoverBackground);
  }
  #loading {
    padding: 4px 12px 8px;
    font-size: 12px;
    opacity: 0.6;
    display: none;
  }
  #emptyState {
    opacity: 0.5;
    padding: 20px 12px;
    text-align: center;
    font-size: 12px;
  }
  #headerBar {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    padding: 6px 10px;
    border-bottom: 1px solid var(--vscode-panel-border);
    gap: 6px;
    font-size: 12px;
  }
  #autoReadToggle {
    display: flex;
    align-items: center;
    gap: 5px;
    cursor: pointer;
    opacity: 0.85;
  }
  #autoReadToggle input { cursor: pointer; }
  .speak-btn {
    background: none;
    border: none;
    cursor: pointer;
    opacity: 0.55;
    padding: 2px 4px;
    font-size: 13px;
    color: var(--vscode-foreground);
    flex-shrink: 0;
  }
  .speak-btn:hover { opacity: 1; }
  .speak-btn.speaking { opacity: 1; color: #6b5bd6; }
  .bubble-row {
    display: flex;
    align-items: flex-start;
    gap: 4px;
    flex: 1;
  }
</style>
</head>
<body>
  <div id="headerBar">
    <label id="autoReadToggle">
      <input type="checkbox" id="autoReadCheckbox" />
      🔊 Auto-read replies
    </label>
  </div>
  <div id="messages"><div id="emptyState">Paste an error or ask DevMate a question to get started.</div></div>
  <div id="loading">DevMate is thinking...</div>
  <div id="inputArea">
    <textarea id="textInput" rows="2" placeholder="Paste an error, or ask a question..."></textarea>
    <button id="sendBtn">Send</button>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const messagesEl = document.getElementById('messages');
    const inputEl = document.getElementById('textInput');
    const sendBtn = document.getElementById('sendBtn');
    const loadingEl = document.getElementById('loading');
    const emptyStateEl = document.getElementById('emptyState');
    const autoReadCheckbox = document.getElementById('autoReadCheckbox');

    // ---- Read-aloud support (100% local/free) ----
    // Uses the browser/OS speech engine only — no paid TTS API calls.
    function textToSpeechFriendly(raw) {
      let t = raw || '';

      // Do not read the model's "Original Error" section aloud. It is
      // usually a raw exception/stack trace and is much harder to follow
      // than the plain-English explanation that follows it.
      t = t.replace(/^#{1,6}\s*Original Error\s*$/gim, '\n__DEV_MATE_SKIP_ERROR_SECTION__\n');
      t = t.replace(/^__DEV_MATE_SKIP_ERROR_SECTION__\n[\s\S]*?(?=^#{1,6}\s+|$)/m, ' ');

      // Replace fenced code blocks with a short spoken cue instead of
      // attempting to read source code character-by-character.
      const fence = String.fromCharCode(96);
      const fencedCode = new RegExp(fence + fence + fence + '[\\s\\S]*?' + fence + fence + fence, 'g');
      t = t.replace(fencedCode, ' Here is a code example. ');

      // Inline code is also skipped; the surrounding explanation is what
      // matters in speech.
      t = t.replace(new RegExp(fence + '([^' + fence + ']+)' + fence, 'g'), ' code ');

      // Markdown headings: speak the words, not the syntax.
      t = t.replace(/^#{1,6}\s+/gm, '');
      t = t.replace(/\*\*(.+?)\*\*/g, '$1');
      t = t.replace(/\*(.+?)\*/g, '$1');
      t = t.replace(/^[-*]\s+/gm, '');
      t = t.replace(/^\d+\.\s+/gm, 'Step ');
      t = t.replace(/^>\s+/gm, '');
      t = t.replace(/\[(.*?)\]\((.*?)\)/g, '$1');

      // Hide common raw error/stack-trace lines even if the model does not
      // use the requested "Original Error" heading.
      const lines = t.split(/\r?\n/).filter((line) => {
        const x = line.trim();
        if (!x) return true;
        if (/^(at\s+.+|Caused by:|Traceback \(most recent call last\):)$/i.test(x)) return false;
        if (/^(error|exception|typeerror|referenceerror|syntaxerror|rangeerror|warning):/i.test(x)) return false;
        if (/^File ".+", line \d+/i.test(x)) return false;
        return true;
      });
      t = lines.join(' ');

      t = t.replace(/---+/g, '. ');
      t = t.replace(/\n{2,}/g, '. ');
      t = t.replace(/\n/g, ' ');
      return t.replace(/\s+/g, ' ').trim();
    }

    let currentUtterance = null;
    let currentSpeakButton = null;
    let preferredVoice = null;
    let voicesLoaded = false;
    let speechEnginePrimed = false;
    let pendingAutoRead = null;

    function chooseBestVoice() {
      if (!('speechSynthesis' in window)) return null;
      const voices = window.speechSynthesis.getVoices() || [];
      const english = voices.filter((v) => /^en(-|_)/i.test(v.lang));
      if (!english.length) return voices[0] || null;

      // Prefer installed natural/premium-sounding OS voices where available.
      const preferredNames = [
        'Microsoft Aria Online (Natural)',
        'Microsoft Jenny Online (Natural)',
        'Microsoft Guy Online (Natural)',
        'Microsoft Aria',
        'Microsoft Jenny',
        'Microsoft Guy',
        'Google US English',
        'Google UK English Female',
        'Google UK English Male',
        'Samantha',
        'Karen',
        'Daniel'
      ];

      for (const wanted of preferredNames) {
        const exact = english.find((v) => v.name.toLowerCase() === wanted.toLowerCase());
        if (exact) return exact;
      }

      const natural = english.find((v) => /natural|online/i.test(v.name));
      return natural || english.find((v) => /female|woman/i.test(v.name)) || english[0];
    }

    function loadVoices() {
      preferredVoice = chooseBestVoice();
      voicesLoaded = true;
    }

    function primeSpeechEngine() {
      if (!('speechSynthesis' in window)) return;
      loadVoices();

      // Chrome requires speechSynthesis to originate from a user activation.
      // The Auto-read checkbox is a real user gesture, so use that gesture to
      // warm up the speech engine with a silent utterance. Later replies can
      // then be spoken automatically without relying on a synthetic .click().
      try {
        window.speechSynthesis.cancel();
        // IMPORTANT: this must be a genuinely audible utterance, not fully
        // silent. A volume:0 utterance likely doesn't count as "real audio
        // playback" to Chromium's autoplay-unlock tracking, so priming with
        // silence may never actually unlock later async speak() calls. We
        // use a very short, quiet single character instead — audible in
        // principle, but brief and unobtrusive.
        const warmup = new SpeechSynthesisUtterance('.');
        warmup.volume = 0.01;
        warmup.rate = 10;
        warmup.pitch = 1;
        if (preferredVoice) warmup.voice = preferredVoice;
        warmup.lang = preferredVoice?.lang || 'en-US';
        warmup.onend = () => {
          speechEnginePrimed = true;
          processPendingAutoRead();
        };
        warmup.onerror = () => {
          // Some speech engines reject zero-volume/blank utterances. The user
          // gesture has still occurred, so mark the engine as primed and let
          // the real reply attempt normally.
          speechEnginePrimed = true;
          processPendingAutoRead();
        };
        window.speechSynthesis.speak(warmup);
        // Most engines finish this effectively immediately.
        setTimeout(() => {
          speechEnginePrimed = true;
          processPendingAutoRead();
        }, 250);
      } catch (err) {
        speechEnginePrimed = true;
        processPendingAutoRead();
      }
    }

    if ('speechSynthesis' in window) {
      loadVoices();
      window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
    }

    function resetSpeakButton(btnEl) {
      if (!btnEl) return;
      btnEl.classList.remove('speaking');
      btnEl.textContent = '🔊';
      btnEl.title = 'Read this aloud';
    }

    function stopSpeaking(btnEl) {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      if (currentUtterance) {
        currentUtterance.onend = null;
        currentUtterance.onerror = null;
      }
      currentUtterance = null;
      currentSpeakButton = null;
      document.querySelectorAll('.speak-btn.speaking').forEach(resetSpeakButton);
      resetSpeakButton(btnEl);
    }

    function processPendingAutoRead() {
      if (!pendingAutoRead || !autoReadCheckbox.checked) return;
      const pending = pendingAutoRead;
      pendingAutoRead = null;
      speak(pending.text, pending.button, true);
    }

    function speak(text, btnEl, isAutoRead = false) {
      if (!('speechSynthesis' in window)) return;

      // Clicking the same button while speaking is an explicit STOP action.
      if (!isAutoRead && btnEl && btnEl.classList.contains('speaking')) {
        stopSpeaking(btnEl);
        return;
      }

      if (isAutoRead && !speechEnginePrimed) {
        pendingAutoRead = { text, button: btnEl };
        primeSpeechEngine();
        return;
      }

      stopSpeaking();

      const friendly = textToSpeechFriendly(text);
      if (!friendly) {
        resetSpeakButton(btnEl);
        return;
      }

      if (!voicesLoaded || !preferredVoice) loadVoices();

      try {
        window.speechSynthesis.resume();
      } catch (err) {
        // Some speech engines do not expose resume reliably; speak() below
        // will still work when available.
      }

      const utterance = new SpeechSynthesisUtterance(friendly);
      currentUtterance = utterance;
      if (preferredVoice) utterance.voice = preferredVoice;
      utterance.lang = preferredVoice?.lang || 'en-US';
      utterance.rate = 0.96;
      utterance.pitch = 1.0;
      utterance.volume = 1.0;

      if (btnEl) {
        currentSpeakButton = btnEl;
        btnEl.classList.add('speaking');
        btnEl.textContent = '⏹';
        btnEl.title = 'Stop reading';
      }

      const finish = () => {
        if (currentUtterance === utterance) {
          currentUtterance = null;
          currentSpeakButton = null;
        }
        resetSpeakButton(btnEl);
      };

      utterance.onend = finish;
      utterance.onerror = finish;

      // KNOWN CHROMIUM QUIRK: speechSynthesis.speak() can silently produce
      // no audio at all (no error fires) when it's called from an async
      // callback that isn't a direct continuation of a user gesture — which
      // is exactly what auto-read is, since the reply arrives from an API
      // response, not a click. A manual button click works because it IS a
      // direct gesture.
      //
      // The documented workaround: force-cancel any queued/idle speech and
      // re-issue speak() after a tiny delay. This reliably "unsticks" the
      // speech queue in both cases (manual click and async auto-read), so
      // we always do it rather than branching the two code paths.
      window.speechSynthesis.cancel();
      setTimeout(() => {
        // If something else took over the queue in the meantime (e.g. the
        // user hit stop, or another message started speaking), don't speak.
        if (currentUtterance !== utterance) return;
        window.speechSynthesis.speak(utterance);
      }, 50);
    }

    function escapeHtml(str) {
      return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }

    // A small, deliberately limited markdown renderer — handles just the
    // subset we ask the model to use (headers, bold, code blocks, inline
    // code, numbered/bulleted lists). Everything is HTML-escaped first, so
    // there's no way for model output to inject real HTML/scripts.
    function renderMarkdown(text) {
      const escaped = escapeHtml(text);
      const lines = escaped.split('\n');
      const fence = String.fromCharCode(96);
      let html = '';
      let inCodeBlock = false;
      let inList = false;

      for (const line of lines) {
        if (line.trim().startsWith(fence + fence + fence)) {
          if (!inCodeBlock) {
            html += '<pre><code>';
            inCodeBlock = true;
          } else {
            html += '</code></pre>';
            inCodeBlock = false;
          }
          continue;
        }

        if (inCodeBlock) {
          html += line + '\n';
          continue;
        }

        let processed = line
          .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
          .replace(new RegExp(fence + '(.+?)' + fence, 'g'), '<code>$1</code>');

        if (/^##\s+/.test(processed)) {
          if (inList) { html += '</ul>'; inList = false; }
          html += '<h3>' + processed.replace(/^##\s+/, '') + '</h3>';
        } else if (/^#\s+/.test(processed)) {
          if (inList) { html += '</ul>'; inList = false; }
          html += '<h2>' + processed.replace(/^#\s+/, '') + '</h2>';
        } else if (/^[-*]\s+/.test(processed)) {
          if (!inList) { html += '<ul>'; inList = true; }
          html += '<li>' + processed.replace(/^[-*]\s+/, '') + '</li>';
        } else if (/^\d+\.\s+/.test(processed)) {
          if (!inList) { html += '<ul>'; inList = true; }
          html += '<li>' + processed.replace(/^\d+\.\s+/, '') + '</li>';
        } else if (processed.trim() === '') {
          if (inList) { html += '</ul>'; inList = false; }
          html += '<br>';
        } else {
          if (inList) { html += '</ul>'; inList = false; }
          html += '<p>' + processed + '</p>';
        }
      }
      if (inList) html += '</ul>';
      if (inCodeBlock) html += '</code></pre>';
      return html;
    }

    function addMessageToDOM(role, text) {
      if (emptyStateEl) emptyStateEl.remove();
      const row = document.createElement('div');
      row.className = 'msg-row';
      const avatar = document.createElement('div');
      avatar.className = 'avatar ' + role;
      avatar.textContent = role === 'user' ? 'U' : 'D';

      const bubbleRow = document.createElement('div');
      bubbleRow.className = 'bubble-row';

      const bubble = document.createElement('div');
      bubble.className = 'bubble ' + role;
      if (role === 'assistant') {
        bubble.innerHTML = renderMarkdown(text);
      } else {
        bubble.textContent = text; // user input stays plain text, no rendering needed
      }
      bubbleRow.appendChild(bubble);

      let speakBtn = null;
      if (role === 'assistant') {
        speakBtn = document.createElement('button');
        speakBtn.className = 'speak-btn';
        speakBtn.title = 'Read this aloud';
        speakBtn.textContent = '🔊';
        speakBtn.addEventListener('click', () => speak(text, speakBtn));
        bubbleRow.appendChild(speakBtn);
      }

      row.appendChild(avatar);
      row.appendChild(bubbleRow);
      messagesEl.appendChild(row);
      messagesEl.scrollTop = messagesEl.scrollHeight;

      // Auto-read: if enabled, use the SAME per-message speaker button
      // as manual read-aloud. This makes the button show ⏹ while the
      // automatic reply is being spoken, so the user can stop it.
      if (role === 'assistant' && autoReadCheckbox.checked) {
        // Do NOT call speakBtn.click(): that creates a synthetic click, not a
        // trusted user activation. Use the same button visually, but start
        // speech through the auto-read path instead.
        speak(text, speakBtn, true);
      }
    }

    function send() {
      const text = inputEl.value.trim();
      if (!text) return;
      vscode.postMessage({ type: 'ask', text });
      inputEl.value = '';
    }

    autoReadCheckbox.addEventListener('change', () => {
      if (autoReadCheckbox.checked) {
        // This trusted checkbox interaction is the user gesture needed by
        // Chromium's speech synthesis autoplay protection.
        speechEnginePrimed = false;
        primeSpeechEngine();
      } else {
        pendingAutoRead = null;
        if (currentSpeakButton) {
          stopSpeaking(currentSpeakButton);
        }
      }
    });

    sendBtn.addEventListener('click', send);
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    });

    window.addEventListener('message', (event) => {
      const message = event.data;
      if (message.type === 'addMessage') {
        addMessageToDOM(message.role, message.text);
      } else if (message.type === 'setLoading') {
        loadingEl.style.display = message.loading ? 'block' : 'none';
      }
    });
  </script>
</body>
</html>`;
  }
}

module.exports = { DevMateChatViewProvider };
