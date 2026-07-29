const express = require('express');
const https = require('https');
const http = require('http');
const path = require('path');
const os = require('os');
const cors = require('cors');
const { generateCerts } = require('./generate-cert');
const db = require('./db');

const app = express();
const HTTP_PORT = 8180;
const HTTPS_PORT = 8181;

// ── Middleware ────────────────────────────────────────────────────

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── API: Barcode Lookup ──────────────────────────────────────────

app.get('/api/lookup/:barcode', async (req, res) => {
  const { barcode } = req.params;

  if (!barcode || barcode.length < 4) {
    return res.status(400).json({ error: 'Invalid barcode' });
  }

  // Check cache first (saves API calls!)
  const cached = db.getCachedLookup(barcode);
  if (cached) {
    console.log(`📦 Cache hit for barcode: ${barcode}`);
    return res.json({ source: 'cache', ...cached });
  }

  try {
    console.log(`🔍 Looking up barcode: ${barcode}`);

    const response = await fetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${barcode}`, {
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      if (response.status === 429) {
        return res.status(429).json({ error: 'API rate limit reached (100/day). Try again tomorrow or add manually.' });
      }
      return res.status(response.status).json({ error: `UPCitemdb error: ${response.statusText}` });
    }

    const data = await response.json();

    if (data.code === 'OK' && data.items && data.items.length > 0) {
      const item = data.items[0];

      const result = {
        found: true,
        barcode: barcode,
        name: item.title || 'Unknown Product',
        manufacturer: item.brand || extractBrand(item.title),
        model_name: item.model || extractModel(item.title),
        model_number: item.model || '',
        category: item.category || guessCategory(item.title),
        description: item.description || '',
        image_url: (item.images && item.images.length > 0) ? item.images[0] : null,
        lowest_price: item.lowest_recorded_price || null,
        highest_price: item.highest_recorded_price || null,
        raw: item,
      };

      // Cache it
      db.setCachedLookup(barcode, result);

      return res.json({ source: 'api', ...result });
    } else {
      const notFound = { found: false, barcode: barcode };
      return res.json({ source: 'api', ...notFound });
    }
  } catch (err) {
    console.error('❌ Lookup error:', err.message);
    return res.status(500).json({ error: 'Failed to lookup barcode', details: err.message });
  }
});

// ── API: Assets CRUD ─────────────────────────────────────────────

// Create asset
app.post('/api/assets', (req, res) => {
  try {
    const result = db.createAsset(req.body);
    res.status(201).json({ success: true, ...result });
  } catch (err) {
    if (err.message.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: 'Asset tag already exists' });
    }
    console.error('❌ Create error:', err.message);
    res.status(500).json({ error: 'Failed to create asset' });
  }
});

// Get all assets
app.get('/api/assets', (req, res) => {
  const { q } = req.query;
  const assets = q ? db.searchAssets(q) : db.getAllAssets();
  res.json({ count: assets.length, assets });
});

// Get single asset
app.get('/api/assets/:id', (req, res) => {
  const asset = db.getAssetById(parseInt(req.params.id));
  if (!asset) return res.status(404).json({ error: 'Asset not found' });
  res.json(asset);
});

// Update asset
app.put('/api/assets/:id', (req, res) => {
  const updated = db.updateAsset(parseInt(req.params.id), req.body);
  if (!updated) return res.status(404).json({ error: 'Asset not found or no changes' });
  res.json({ success: true });
});

// Delete asset
app.delete('/api/assets/:id', (req, res) => {
  const deleted = db.deleteAsset(parseInt(req.params.id));
  if (!deleted) return res.status(404).json({ error: 'Asset not found' });
  res.json({ success: true });
});

// ── API: Export ───────────────────────────────────────────────────

app.get('/api/export/csv', (req, res) => {
  const assets = db.getAllAssets();

  if (assets.length === 0) {
    return res.status(404).json({ error: 'No assets to export' });
  }

  // Snipe-IT compatible CSV headers
  const headers = [
    'Item Name',
    'Asset Tag',
    'Serial Number',
    'Manufacturer',
    'Model Name',
    'Model Number',
    'Category',
    'Status',
    'Purchase Cost',
    'Notes',
  ];

  const rows = assets.map(a => [
    csvEscape(a.name),
    csvEscape(a.asset_tag),
    csvEscape(a.serial),
    csvEscape(a.manufacturer),
    csvEscape(a.model_name),
    csvEscape(a.model_number),
    csvEscape(a.category),
    csvEscape(a.status),
    a.purchase_cost || '',
    csvEscape(a.notes),
  ].join(','));

  const csv = [headers.join(','), ...rows].join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="snipeit-import-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv);
});

// ── API: Stats ───────────────────────────────────────────────────

app.get('/api/stats', (req, res) => {
  const total = db.getAssetCount();
  const assets = db.getAllAssets();
  const manufacturers = [...new Set(assets.map(a => a.manufacturer).filter(Boolean))];
  const categories = [...new Set(assets.map(a => a.category).filter(Boolean))];

  res.json({
    total,
    manufacturers: manufacturers.length,
    categories: categories.length,
    topManufacturers: manufacturers.slice(0, 10),
  });
});

// ── SPA Fallback ─────────────────────────────────────────────────

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Helper Functions ─────────────────────────────────────────────

function extractBrand(title) {
  if (!title) return '';
  const knownBrands = [
    'Samsung', 'Kingston', 'Corsair', 'Crucial', 'Western Digital', 'WD',
    'Seagate', 'Dell', 'HP', 'Lenovo', 'Asus', 'Acer', 'MSI', 'Gigabyte',
    'Intel', 'AMD', 'NVIDIA', 'LG', 'BenQ', 'ViewSonic', 'Logitech',
    'Microsoft', 'Apple', 'Cisco', 'Ubiquiti', 'MikroTik', 'TP-Link',
    'Netgear', 'APC', 'Eaton', 'Brother', 'Canon', 'Epson', 'Xerox',
    'G.Skill', 'TeamGroup', 'PNY', 'SanDisk', 'Toshiba', 'Hynix',
    'Micron', 'EVGA', 'Sapphire', 'Zotac', 'Razer', 'HyperX',
  ];
  for (const brand of knownBrands) {
    if (title.toLowerCase().includes(brand.toLowerCase())) {
      return brand;
    }
  }
  return title.split(' ')[0]; // Fallback: first word
}

function extractModel(title) {
  if (!title) return '';
  // Remove common brand names and return the rest as model
  const cleaned = title.replace(/\b(Samsung|Kingston|Corsair|Crucial|Western Digital|WD|Dell|HP|Lenovo|Asus|Acer)\b/gi, '').trim();
  // Limit to first 60 chars
  return cleaned.substring(0, 60).trim();
}

function guessCategory(title) {
  if (!title) return 'Uncategorized';
  const t = title.toLowerCase();
  if (t.includes('ram') || t.includes('memory') || t.includes('ddr')) return 'RAM';
  if (t.includes('ssd') || t.includes('solid state')) return 'SSD';
  if (t.includes('hdd') || t.includes('hard drive') || t.includes('hard disk')) return 'HDD';
  if (t.includes('laptop') || t.includes('notebook')) return 'Laptop';
  if (t.includes('desktop') || t.includes('tower') || t.includes('workstation')) return 'Desktop';
  if (t.includes('monitor') || t.includes('display')) return 'Monitor';
  if (t.includes('switch')) return 'Switch';
  if (t.includes('router')) return 'Router';
  if (t.includes('access point') || t.includes('wifi') || t.includes('wi-fi')) return 'Access Point';
  if (t.includes('keyboard')) return 'Keyboard';
  if (t.includes('mouse')) return 'Mouse';
  if (t.includes('headset') || t.includes('headphone')) return 'Headset';
  if (t.includes('webcam') || t.includes('camera')) return 'Webcam';
  if (t.includes('printer')) return 'Printer';
  if (t.includes('scanner')) return 'Scanner';
  if (t.includes('ups') || t.includes('battery backup')) return 'UPS';
  if (t.includes('server')) return 'Server';
  if (t.includes('phone') || t.includes('smartphone')) return 'Smartphone';
  if (t.includes('tablet') || t.includes('ipad')) return 'Tablet';
  if (t.includes('dock')) return 'Docking Station';
  if (t.includes('cable')) return 'Cable';
  if (t.includes('adapter')) return 'Adapter';
  return 'Uncategorized';
}

function csvEscape(val) {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// ── Get local network IPs ────────────────────────────────────────

function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push(iface.address);
      }
    }
  }
  return ips;
}

// ── Start Server ─────────────────────────────────────────────

async function startServer() {
  // Initialize database first
  await db.initDb();
  console.log('✅ Database initialized');

  // HTTP server (for localhost only)
  http.createServer(app).listen(HTTP_PORT, () => {
    console.log(`\n🌐 HTTP server: http://localhost:${HTTP_PORT}`);
  });

  // HTTPS server (for phone access)
  try {
    const certs = generateCerts();
    https.createServer({ key: certs.key, cert: certs.cert }, app).listen(HTTPS_PORT, '0.0.0.0', () => {
      const ips = getLocalIPs();
      console.log(`🔒 HTTPS server: https://localhost:${HTTPS_PORT}`);
      console.log('');
      console.log('📱 Deschide pe telefon (trebuie să fii pe aceeași rețea Wi-Fi):');
      ips.forEach(ip => {
        console.log(`   👉 https://${ip}:${HTTPS_PORT}`);
      });
      console.log('');
      console.log('⚠️  La prima accesare de pe telefon, acceptă avertismentul de certificat SSL.');
      console.log('');
    });
  } catch (err) {
    console.error('❌ Failed to start HTTPS server:', err.message);
    console.log('📱 Phone scanning will not work without HTTPS.');
    console.log('   The HTTP server is still running on localhost.');
  }
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down...');
  db.closeDb();
  process.exit(0);
});

startServer();
