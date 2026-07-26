/**
 * GET /health
 * Production health check for deployment on Render.
 */
const getHealthStatus = (req, res) => {
  return res.status(200).json({
    status: 'OK',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
};

module.exports = {
  getHealthStatus
};
