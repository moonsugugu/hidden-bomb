const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');

module.exports = {
  apps: [
    {
      name: 'hidden-bomb-web',
      cwd: projectRoot,
      script: 'npm.cmd',
      args: 'run start:web',
      interpreter: 'none',
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'hidden-bomb-game',
      cwd: projectRoot,
      script: 'npm.cmd',
      args: 'run start:game',
      interpreter: 'none',
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'production',
        PORT: '3202',
      },
    },
  ],
};
