const Service = require('node-windows').Service;
const path = require('path');

// Define the service
const svc = new Service({
  name: 'SQL2005 Bridge Service',
  description: 'Local API bridge between SQL Server 2005 and modern apps',
  script: path.join(__dirname, 'server.js'),
  nodeOptions: [
    '--harmony',
    '--max_old_space_size=4096'
  ]
});

// Event listeners for logging
svc.on('install', () => {
  console.log('Service installed successfully.');
  svc.start();
});

svc.on('alreadyinstalled', () => {
  console.log('Service already installed.');
});

svc.on('start', () => {
  console.log('Service started!');
});

svc.on('error', err => {
  console.error('Error:', err);
});

// Install the service
svc.install();
