module.exports = {
  apps: [
    {
      name: 'tokenwallet-mcp',
      cwd: __dirname,
      script: 'dist/index.js',
      args: '--http --port 8788',
      interpreter: 'node',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '256M',
      env: {
        NODE_ENV: 'production',
        MCP_TRANSPORT: 'http',
        PORT: '8788',
        // 同机部署指向本地 api；若分开部署则改成 https://api.你的域名.com/v1
        TOKENWALLET_API_URL: 'http://127.0.0.1:8787/v1',
      },
    },
  ],
}
