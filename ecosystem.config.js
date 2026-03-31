module.exports = {
  apps: [{
    name: 'browser-worker',
    script: 'src/server.js',
    instances: 1,
    exec_mode: 'cluster',
    env: {
      PORT: 8081,
      PROXY_LIST: process.env.PROXY_LIST
    }
  }]
};