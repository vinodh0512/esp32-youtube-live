const WebSocket = require('ws');

let wss = null;

/**
 * Initializes WebSocket Server attached to HTTP Server.
 * @param {import('http').Server} server 
 */
function initWebSocketServer(server) {
  wss = new WebSocket.Server({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const clientIp = req.socket.remoteAddress;
    console.log(`[WebSocket] New client connected from ${clientIp} (Total clients: ${wss.clients.size})`);

    // Send connection greeting
    ws.send(JSON.stringify({
      event: 'connected',
      message: 'Connected to YouTube Live Poll ESP32 WebSocket Server',
      timestamp: new Date().toISOString()
    }));

    // Lazy load getDashboardState to prevent circular dependency
    try {
      const { getDashboardState } = require('./pollMonitorService');
      const currentState = getDashboardState();
      ws.send(JSON.stringify({
        event: 'dashboard_update',
        data: currentState
      }));
    } catch (e) {}

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());
        if (data.type === 'ping') {
          ws.send(JSON.stringify({ event: 'pong', timestamp: new Date().toISOString() }));
        }
      } catch (err) {
        // Ignore non-JSON ping
      }
    });

    ws.on('close', () => {
      console.log(`[WebSocket] Client disconnected (Remaining clients: ${wss ? wss.clients.size : 0})`);
    });

    ws.on('error', (err) => {
      console.warn('[WebSocket Error]', err.message);
    });
  });

  console.log('[WebSocket] Server initialized on path /ws');
}

/**
 * Broadcasts command state update to all connected WebSocket clients.
 * @param {Object} commandData 
 */
function broadcastCommandUpdate(commandData) {
  if (!wss) return;

  const payload = JSON.stringify({
    event: 'command_update',
    data: commandData
  });

  let sentCount = 0;
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
      sentCount++;
    }
  });

  if (sentCount > 0) {
    console.log(`[WebSocket Broadcast] Instant pushed updated command "${commandData.command}" to ${sentCount} clients.`);
  }
}

/**
 * Broadcasts dashboard state update to all connected WebSocket clients INSTANTLY.
 * @param {Object} dashboardData 
 */
function broadcastDashboardUpdate(dashboardData) {
  if (!wss) return;

  const payload = JSON.stringify({
    event: 'dashboard_update',
    data: dashboardData
  });

  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

/**
 * Returns total active WebSocket client connections.
 */
function getActiveConnectionCount() {
  return wss ? wss.clients.size : 0;
}

module.exports = {
  initWebSocketServer,
  broadcastCommandUpdate,
  broadcastDashboardUpdate,
  getActiveConnectionCount
};
