# DevMate

A VS Code extension that explains errors and stack traces in plain English using AI.

## What it does (v0.0.1)

Select an error message or stack trace in any file, right-click, choose
**"DevMate: Explain Selected Error"**, and get a plain-English breakdown
plus a suggested fix in a side panel.

## Setup

1. Get a Groq openai/gpt-oss-120b API key from https://console.groq.com
2. Open this folder in VS Code
3. Press `F5` to launch an Extension Development Host (a second VS Code
   window with the extension loaded)
4. In that new window, open Settings, search "DevMate", and paste your
   API key into `devmate.groqApiKey`
5. Select some error text in any file, right-click, run the command

## Roadmap

- [x] v1: Error explainer
- [ ] v2: README generator from project scan
- [ ] v3: Commit message helper from git diff
- [ ] v4: Code-linked notes

## Project structure

```
devmate-extension/
  package.json      # extension manifest: commands, settings, metadata
  src/
    extension.js     # all extension logic lives here for now
```
