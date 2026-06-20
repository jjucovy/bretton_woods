module.exports = {
  apps: [{
    name: 'bretton-woods',
    script: 'server.js',
    watch: true,
    ignore_watch: [
      'game-state.json',
      'game-state-*.json',
      'node_modules',
      '.git',
      'logs',
      '*.log'
    ],
    watch_options: {
      followSymlinks: false
    },
    env: {
      NODE_ENV: 'production',
      PORT: 65002
    }
  }]
};
