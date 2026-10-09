const express = require('express');
const path = require('path');
const cors = require('cors');
require('dotenv').config();

const authMiddleware = require('./middleware/auth');
const errorHandler = require('./middleware/errorHandler');
const auditMiddleware = require('./middleware/audit');
const pool = require('./utils/db');
const { BUILD } = require('./build');

// Import routes
const authRoutes = require('./routes/auth');
const projectRoutes = require('./routes/projectRoutes');
const userRoutes = require('./routes/users');
const roleRoutes = require('./routes/roles');

const app = express();
const webRoot = path.resolve(__dirname, '..', '..');

// Khóa ký token còn là chuỗi mẫu → ai biết chuỗi này đều giả mạo được token Admin.
const weakSecret = !process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32 || /your_super_secret|change_in_production/i.test(process.env.JWT_SECRET);
if (weakSecret) console.warn('⚠️  JWT_SECRET trong backend/.env đang là chuỗi mẫu hoặc quá ngắn. Hãy đổi thành chuỗi ngẫu nhiên ≥ 32 ký tự (mọi người sẽ phải đăng nhập lại).');

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

// Middleware
app.use(express.json({ limit: '16mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cors({
  origin: process.env.CORS_ORIGIN?.split(','),
  credentials: true,
  exposedHeaders: ['Content-Disposition']
}));
app.use(auditMiddleware.auditMiddleware);

// Health check
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    // Liệt kê migration chưa chạy để giao diện cảnh báo (tránh chạy mã mới trên CSDL cũ)
    let pending = [];
    try {
      const fs = require('fs');
      const files = fs.readdirSync(path.join(webRoot, 'migrations')).filter(f => /^\d{8}_.+\.sql$/.test(f));
      const done = new Set((await pool.query('SELECT file_name FROM schema_migrations')).rows.map(r => r.file_name));
      pending = files.filter(f => !done.has(f)).sort();
    } catch (_) { pending = ['(chưa có bảng schema_migrations)']; }
    res.json({ status: 'OK', database: 'connected', build: BUILD, migrations_pending: pending, security_warnings: weakSecret ? ['JWT_SECRET_DEFAULT'] : [], timestamp: new Date() });
  } catch (error) {
    res.status(503).json({ status: 'UNAVAILABLE', database: 'disconnected', build: BUILD, timestamp: new Date() });
  }
});

// Chỉ phục vụ các tệp giao diện công khai (trang, api.js, thư mục js/, sw.js, favicon, logo).
// Không bao giờ để lộ backup dự án hay .env.
app.use('/js', express.static(path.join(webRoot, 'js'), { extensions: false, index: false }));
app.get('/', (req, res) => res.sendFile(path.join(webRoot, 'index.html')));
app.get('/api.js', (req, res) => res.sendFile(path.join(webRoot, 'api.js')));
app.get('/favicon.ico', (req, res) => res.sendFile(path.join(webRoot, 'favicon.ico')));
app.get('/manifest.webmanifest', (req, res) => res.type('application/manifest+json').sendFile(path.join(webRoot, 'manifest.webmanifest')));
app.get('/assets/vicoad-logo.png', (req, res) => res.sendFile(path.join(webRoot, 'assets', 'vicoad-logo.png')));
app.get('/assets/app-icon-180.png', (req, res) => res.sendFile(path.join(webRoot, 'assets', 'app-icon-180.png')));
app.get('/assets/app-icon-192.png', (req, res) => res.sendFile(path.join(webRoot, 'assets', 'app-icon-192.png')));
app.get('/assets/app-icon-512.png', (req, res) => res.sendFile(path.join(webRoot, 'assets', 'app-icon-512.png')));
app.get('/assets/mau-bang-tien-do.xlsx', (req, res) => res.download(path.join(webRoot, 'assets', 'mau-bang-tien-do.xlsx'), 'mau-bang-tien-do.xlsx'));
app.get('/sw.js', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(webRoot, 'sw.js'));
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/users', userRoutes);
app.use('/api/roles', roleRoutes);
app.use('/api/daily-logs', require('./routes/dailyLogs'));
app.use('/api/documents', require('./routes/documents'));
app.use('/api/issues', require('./routes/issues'));
app.use('/api/project-members', require('./routes/projectMembers'));
app.use('/api/project-personnel', require('./routes/projectPersonnel'));
app.use('/api/company-personnel', require('./routes/companyPersonnel'));
app.use('/api/bidding-packages', require('./routes/biddingPackages'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/reviews', require('./routes/reviews'));
app.use('/api/recycle-bin', require('./routes/recycleBin'));

// Error handler (last middleware)
app.use(errorHandler.errorHandler);

module.exports = app;
