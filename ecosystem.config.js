module.exports = {
  apps: [{
    name: 'browser-worker',
    script: 'server.js',
    instances: 1,      // DO NOT increase this on t2.micro
    exec_mode: 'fork', // Fork is more memory-efficient for single instances
    env_production: {
      NODE_ENV: 'production',
      PORT: 8081
    }
  }]
};