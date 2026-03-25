# ChatGPT & Gemini Conversation Toolkit

A Chrome-compatible browser extension for `chatgpt.com`, `chat.openai.com`, and `gemini.google.com`.

It focuses on long-conversation usability:

- Optimize long chats by temporarily hiding older turns
- Jump to the previous or next user message
- Export the full current conversation as JSON
- Bulk delete rendered sidebar conversations
- Use the same floating toolkit UI on both ChatGPT and Gemini

![Toolkit preview](./image/image.png)

## Current improvements

Compared with the original ChatGPT-only version, this edition adds:

- ChatGPT and Gemini dual-site support
- A single toggle button for `优化长会话 / 恢复隐藏消息`
- `上一轮 / 下一轮` user-turn navigation
- Integrated bulk delete mode with refined checkbox UI
- A custom bulk-delete confirmation dialog
- A draggable floating icon with anchored popup behavior

## Install

### Chrome / Edge

1. Open `chrome://extensions/` or `edge://extensions/`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select this project folder

### Firefox

1. Open `about:debugging#/runtime/this-firefox`
2. Click `Load Temporary Add-on`
3. Select `manifest.json` in this project

## Usage

1. Open a ChatGPT or Gemini conversation page
2. Click the floating round icon to expand the toolkit
3. Use:
   - `上一轮 / 下一轮` to navigate by user turns
   - `优化长会话` to hide older rendered turns
   - `一键导出` to export the full conversation JSON
   - `批量删除 conversation` to select and remove rendered sidebar conversations

## Export format

```json
{
  "site": "ChatGPT or Gemini",
  "exportedAt": "2026-03-25T08:00:00.000Z",
  "url": "https://chatgpt.com/c/...",
  "messageCount": 2,
  "messages": [
    {
      "index": 1,
      "role": "user",
      "text": "Hello"
    },
    {
      "index": 2,
      "role": "assistant",
      "text": "Hi"
    }
  ]
}
```

## Project origin

This repository is forked and extended from the local project:

- `/Users/onceblossom/Desktop/git/ChatGPT-Chrome-Toolkit/chatgpt-Long-conversation-optimization`
  Upstream: [bujue3709/chatgpt-Long-conversation-optimization](https://github.com/bujue3709/chatgpt-Long-conversation-optimization)

It also integrates bulk-delete functionality from the local project:

- `/Users/onceblossom/Desktop/git/ChatGPT-Chrome-Toolkit/bulk-delete-chatGPT`
  Upstream: [qcrao/bulk-delete-chatGPT](https://github.com/qcrao/bulk-delete-chatGPT)

Thanks to both original authors for the foundation and ideas that made this version possible.

## Files

- `manifest.json`: extension manifest
- `contentScript.js`: core behavior and site adapters
- `styles.css`: floating toolkit styles
- `image/`: README assets
