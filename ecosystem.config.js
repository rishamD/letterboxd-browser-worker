module.exports = {
  apps: [{
    name: 'browser-worker',
    script: 'server.js',
    instances: 1,
    exec_mode: 'fork',
    env_production: {
      NODE_ENV: 'production',
      PORT: 8081,
      // PM2 will grab PROXY_LIST from the shell
      PROXY_LIST: process.env.PROXY_LIST 
    }
  }]
};