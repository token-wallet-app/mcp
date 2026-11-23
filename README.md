# tokenwallet-mcp

TokenWallet 官方 MCP Server。安装后通过手机 App 扫码绑定，即可**自动读取本机 AI 客户端（如 Codex CLI）的真实剩余额度与重置时间**并定时同步到 TokenWallet App，无需每次对话手动触发。

## 一行命令安装（推荐）

### Codex CLI
```bash
codex mcp add tokenwallet -- npx -y tokenwallet-mcp
```

### Claude Code
```bash
claude mcp add tokenwallet -- npx -y tokenwallet-mcp
```

### Claude Desktop / Cursor
在 MCP 配置文件中添加：
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

## 使用方式

1. 安装完成后，在客户端对话中说：**「帮我连接 TokenWallet，生成绑定二维码」**；
2. 打开手机 TokenWallet App → 点击 `+` → 选择对应平台 → 点击「扫描二维码」完成绑定（支持免登录直接扫码）；
3. 绑定后，本机 MCP 会每 60 秒自动检测最新真实额度并静默上报到 `https://api.token-wallet.app/v1`。

## 提供的工具

- `connect_tokenwallet`：生成配对二维码与链接（若本机有 Codex 日志会自动附带当前真实 5h / 周额度与精确重置时间）
- `sync_codex_quota`：立即读取本机 `~/.codex/sessions` 最新真实额度并上报
- `report_quota`：向已绑定卡片上报自定义额度指标
- `check_connection_status`：检查待扫码会话与已绑定卡片
- `list_connections`：查看已绑定卡片及节点在线状态

## 环境变量

- `TOKENWALLET_API_URL`：后端 API 地址，默认 `https://api.token-wallet.app/v1`
- `CODEX_HOME`：自定义 Codex 数据目录，默认 `~/.codex`
- `TOKENWALLET_MCP_HOME`：本地节点凭证目录，默认 `~/.tokenwallet-mcp`

## 自托管远程模式（Streamable HTTP）

```bash
npx -y tokenwallet-mcp --http --port 8788
```
