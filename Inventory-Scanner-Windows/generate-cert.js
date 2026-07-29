const fs = require('fs');
const path = require('path');

function generateCerts() {
  const certsDir = path.join(__dirname, 'certs');
  const keyPath = path.join(certsDir, 'server.key');
  const certPath = path.join(certsDir, 'server.cert');

  // Skip if certs already exist
  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
  }

  console.log('🔐 Generating self-signed SSL certificate...');

  const selfsigned = require('selfsigned');

  const attrs = [
    { name: 'commonName', value: 'Inventory Scanner' },
    { name: 'organizationName', value: 'Local Dev' },
  ];

  const pems = selfsigned.generate(attrs, {
    days: 3650, // 10 years
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [
      {
        name: 'subjectAltName',
        altNames: [
          { type: 2, value: 'localhost' },
          { type: 7, ip: '127.0.0.1' },
          // Add common local network IPs
          { type: 7, ip: '192.168.1.1' },
          { type: 7, ip: '192.168.0.1' },
          { type: 7, ip: '10.0.0.1' },
        ],
      },
    ],
  });

  if (!fs.existsSync(certsDir)) {
    fs.mkdirSync(certsDir, { recursive: true });
  }

  fs.writeFileSync(keyPath, pems.private);
  fs.writeFileSync(certPath, pems.cert);

  console.log('✅ SSL certificate generated in certs/');

  return { key: pems.private, cert: pems.cert };
}

module.exports = { generateCerts };
