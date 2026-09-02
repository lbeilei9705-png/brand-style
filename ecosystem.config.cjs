module.exports = {
  apps: [{
    name: "brand-style-server",
    cwd: __dirname,
    script: "apps/server/src/index.ts",
    interpreter: "node",
    interpreter_args: "--experimental-strip-types",
    instances: 1,
    exec_mode: "fork",
    autorestart: true,
    max_restarts: 10,
    min_uptime: "10s",
    restart_delay: 3000,
    kill_timeout: 10000,
    max_memory_restart: "768M",
    time: true,
    env: {
      NODE_ENV: "production",
      PORT: "5180",
    },
  }],
};
