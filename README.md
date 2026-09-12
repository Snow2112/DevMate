# DevMate

A VS Code extension with an AI chat sidebar for explaining errors, stack traces,
and general coding questions — powered by Groq (free tier).

## What it does (v0.2.0)

- A **chat panel in the sidebar** (click the DevMate icon in the Activity Bar,
  or the icon button in the editor title bar) — paste an error or ask a
  question, get a reply, keep chatting with follow-ups.
- **Right-click a selection** in any file → "DevMate: Explain Selected Error"
  → sends it straight into the chat.
- **Ctrl+Alt+E** — explains whatever's on your clipboard (great for terminal
  errors: select the error in the terminal, Ctrl+C, then Ctrl+Alt+E).

## Setup

1. Get a free Groq API key from https://console.groq.com/keys
2. Open this folder in VS Code
3. Press `F5` to launch an Extension Development Host
4. In that new window, open Settings, search "DevMate", and paste your key
   into `devmate.groqApiKey`
5. Click the DevMate icon in the Activity Bar to open the chat, or select an
   error and right-click

## Roadmap

- [x] v1: Error explainer (popup panel)
- [x] v1.5: Chat sidebar UI + clipboard command
- [ ] v2: README generator from project scan
- [ ] v3: Commit message helper from git diff
- [ ] v4: Code-linked notes

## Project structure

```
devmate-extension/
  package.json           # extension manifest: commands, views, settings
  media/
    icon.svg              # activity bar icon
  src/
    extension.js          # entry point, command registration
    chatViewProvider.js   # sidebar chat webview + Groq calls
```
