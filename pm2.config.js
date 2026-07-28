module.exports = {
  apps: [{
    name: 'simmer',
    script: '/home/ubuntu/simmer/dist/index.js',
    cwd: '/home/ubuntu/simmer',
    uid: 'ubuntu',
    watch: true,
    ignore_watch: ['node_modules'],
    autorestart: true,
    env: {
      NODE_ENV: 'development'
    },
    env_production: {
      NODE_ENV: 'production'
    }
  }]
}
