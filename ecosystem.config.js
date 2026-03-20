/**
 * DarwinFi PM2 Ecosystem Config
 *
 * Canonical process declarations for all DarwinFi services.
 * Usage: pm2 start ecosystem.config.js --only <name>
 */

module.exports = {
  apps: [
    {
      name: 'darwinfi',
      script: 'dist/src/agent/darwin-agent.js',
      cwd: '/opt/murphy/darwinfi',
      min_uptime: '30s',
      max_restarts: 10,
    },
    {
      name: 'darwinfi-candles',
      script: 'dist/src/instinct/data/candle-collector.js',
      cwd: '/opt/murphy/darwinfi',
      min_uptime: '30s',
      max_restarts: 10,
      restart_delay: 10000, // avoid GeckoTerminal 429s on rapid restart
    },
    {
      name: 'darwinfi-instinct',
      script: 'dist/src/instinct/instinct-agent.js',
      cwd: '/opt/murphy/darwinfi',
      min_uptime: '30s',
      max_restarts: 10,
    },
    {
      name: 'frontier',
      script: 'dist/src/agent/frontier-agent.js',
      cwd: '/opt/murphy/darwinfi',
      min_uptime: '30s',
      max_restarts: 10,
    },
    {
      name: 'darwinfi-immune',
      script: 'dist/src/immune/immune-agent.js',
      cwd: '/opt/murphy/darwinfi',
      min_uptime: '30s',
      max_restarts: 10,
    },
    {
      name: 'darwinfi-evolution',
      script: 'dist/src/evolution/orchestrator.js',
      cwd: '/opt/murphy/darwinfi',
      min_uptime: '30s',
      max_restarts: 5,
      restart_delay: 30000, // 30s delay on restart
    },
  ],
};
