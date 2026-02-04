const Service = require('node-windows').Service;
const path = require('path');

const svc = new Service({
  name: 'SQL2005 Bridge Service',
  script: path.join(__dirname, 'server.js')
});

svc.on('uninstall', () => {
  console.log('Service uninstalled.');
});

svc.uninstall();
