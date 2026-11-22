# TokenWallet MCP Server

TokenWallet 官方 MCP Server，用于让 ChatGPT、Claude Code、Codex CLI、Cursor 等 AI 客户端生成配对二维码并向 TokenWallet App 上报实时 Token 额度。

## 环境变量

- `TOKENWALLET_API_URL`：TokenWallet 后端 API 地址，默认 `http://localhost:8787/v1`
- `PORT`：Streamable HTTP 模式端口，默认 `8788`
- `TOKENWALLET_MCP_HOME`：本地凭证目录，默认 `~/.tokenwallet-mcp`

## 安装与构建

```bash
npm install
npm run build
```

## 1. 给 ChatGPT（网页端 / 桌面端）安装

ChatGPT 的自定义 MCP 连接器使用 **Streamable HTTP（HTTPS）**：

1. 启动本地 Streamable HTTP MCP：
   ```bash
   npm run dev:http
   # 监听 http://localhost:8788/mcp
   ```
2. 用 Cloudflare Tunnel（免费无需账号）暴露为 HTTPS：
   ```bash
   cloudflared tunnel --url http://localhost:8788
   ```
   得到类似 `https://xxxx.trycloudflare.com`，你的 MCP 地址就是：
   `https://xxxx.trycloudflare.com/mcp`
3. 在 ChatGPT → **设置 → 连接器 / Apps（开发者模式）→ 添加自定义 MCP**，填入上面的 `https://.../mcp` 地址。
4. 在 ChatGPT 对话中输入：「帮我连接 TokenWallet，生成绑定二维码」，用手机 TokenWallet App 扫码即可（支持免登录直接扫码）。

## 2. 给 Codex CLI / Claude Code / Claude Desktop / Cursor 安装（stdio）

在客户端的 MCP 配置中加入：

```json
{
  "mcpServers": {
    "tokenwallet": {
      "command": "node",
      "args": ["E:/Develop/TokenWallet/mcp/dist/index.js"],
      "env": {
        "TOKENWALLET_API_URL": "http://localhost:8787/v1"
      }
    }
  }
}
```

## 提供的工具

- `connect_tokenwallet`：创建配对会话并输出二维码图片 + 链接，后台自动轮询等待手机扫码
- `check_connection_status`：检查待扫码会话与已绑定卡片
- `report_quota`：向已绑定卡片上报最新额度（`POST /v1/reports`）
- `list_connections`：查看已绑定卡片及节点在线状态
