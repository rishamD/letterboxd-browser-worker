module.exports = {
  apps: [{
    name: 'browser-worker',
    script: 'src/server.js', // Updated path
    instances: 1,
    exec_mode: 'fork',
    env_production: {
      NODE_ENV: 'production',
      PORT: 8081,
      PROXY_LIST: process.env.PROXY_LIST 
    }
  }]
};