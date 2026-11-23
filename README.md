# TokenWallet MCP

Official MCP server for [TokenWallet](https://token-wallet.app) — connect your AI clients to the TokenWallet app and keep your token quotas in sync automatically.

[简体中文](#简体中文)

---

## Installation

### Codex CLI

```bash
codex mcp add tokenwallet -- npx -y tokenwallet-mcp
```

### Claude Code

```bash
claude mcp add tokenwallet -- npx -y tokenwallet-mcp
```

### Claude Desktop / Cursor / Windsurf

Add the following to your MCP configuration file:

```json
{
  "mcpServers": {
    "tokenwallet": {
      "command": "npx",
      "args": ["-y", "tokenwallet-mcp"]
    }
  }
}
```

### VS Code

Add to your user or workspace `.vscode/mcp.json`:

```json
{
  "servers": {
    "tokenwallet": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "tokenwallet-mcp"]
    }
  }
}
```

## Quick Start

1. After installation, start a conversation in your AI client and say:  
   **"Connect to TokenWallet"**
2. Open the **TokenWallet** app on your phone, tap **+** → select the platform → **Scan QR Code** (or enter the 8-character pairing code manually).
3. Once connected, your quota updates will sync to the TokenWallet app automatically.

---

## 简体中文

[TokenWallet（词元钱包）](https://token-wallet.app) 官方 MCP 服务，将你的 AI 客户端连接到词元钱包 App，自动同步额度状态。

### 安装方式

#### Codex CLI

```bash
codex mcp add tokenwallet -- npx -y tokenwallet-mcp
```

#### Claude Code

```bash
claude mcp add tokenwallet -- npx -y tokenwallet-mcp
```

#### Claude Desktop / Cursor / Windsurf

在你的 MCP 配置文件中加入：

```json
{
  "mcpServers": {
    "tokenwallet": {
      "command": "npx",
      "args": ["-y", "tokenwallet-mcp"]
    }
  }
}
```

#### VS Code

在用户或项目 `.vscode/mcp.json` 中加入：

```json
{
  "servers": {
    "tokenwallet": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "tokenwallet-mcp"]
    }
  }
}
```

### 快速开始

1. 安装完成后，在 AI 客户端对话中输入：  
   **「帮我连接 TokenWallet」**
2. 打开手机上的 **词元钱包（TokenWallet）** App，点击右上角 **+** → 选择对应平台 → **扫描二维码**（若无法扫码可手动输入 8 位配对码）。
3. 绑定完成后，额度将自动同步至你的词元钱包 App。
