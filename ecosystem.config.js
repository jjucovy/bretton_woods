module.exports = {
  apps: [{
    name: 'bretton-woods',
    script: 'server.js',
    instances: 1,
    exec_mode: 'fork',
    watch: false,
    env: {
      NODE_ENV: 'production',
      PORT: 65002
    }
  }]
};
