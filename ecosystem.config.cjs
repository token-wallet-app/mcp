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
        TOKENWALLET_API_URL: 'https://api.token-wallet.app/v1',
      },
    },
  ],
}
