const http = require('http');
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const env = require('./src/config/env');
const connectDB = require('./src/config/db');
const commandRoutes = require('./src/routes/commandRoutes');
const healthRoutes = require('./src/routes/healthRoutes');
const testRoutes = require('./src/routes/testRoutes');
const debugRoutes = require('./src/routes/debugRoutes');
const { initWebSocketServer } = require('./src/services/webSocketService');
const { startMonitoringLoop } = require('./src/services/pollMonitorService');

const app = express();

// Global Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static assets explicitly with absolute path & MIME handling
app.use('/assets', express.static(path.join(__dirname, 'public', 'assets')));
app.use('/obs/assets', express.static(path.join(__dirname, 'public', 'assets')));
app.use('/frontend/assets', express.static(path.join(__dirname, 'public', 'assets')));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/frontend', express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, '..', 'frontend', 'dist')));

// API Routes
app.use('/health', healthRoutes);
app.use('/api', commandRoutes);
app.use('/api/debug', debugRoutes);
app.use('/api/test', testRoutes);

// Helper to resolve index.html path for SPA & OBS HUD routes
function getIndexPath() {
  const publicIndex = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(publicIndex)) return publicIndex;
  return path.join(__dirname, '..', 'frontend', 'dist', 'index.html');
}

// Dedicated routes for OBS Studio overlay HUD & SPA Routing Fallback
app.get(['/obs', '/overlay', '/frontend/obs', '/frontend/overlay', '*'], (req, res) => {
  res.sendFile(getIndexPath());
});

// Central Error Handler Middleware
app.use((err, req, res, next) => {
  console.error('[Unhandled Error]', err.stack || err.message);
  res.status(500).json({
    error: 'Internal Server Error',
    message: err.message
  });
});

// Create HTTP Server & attach WebSockets
const server = http.createServer(app);
initWebSocketServer(server);

// Start Server & Background YouTube Live Poll Loop
async function bootstrap() {
  // Attempt DB Connection asynchronously (system remains functional without DB)
  connectDB().catch(() => {});

  server.listen(env.port, () => {
    console.log('Server Started');

    // Start background YouTube live poll monitoring loop
    startMonitoringLoop().catch(err => {
      console.warn('[Monitoring Loop Warning]', err.message);
    });
  });
}

bootstrap();
