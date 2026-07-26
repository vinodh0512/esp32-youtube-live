const mongoose = require('mongoose');
const { mongoUri } = require('./env');

const connectDB = async () => {
  if (!mongoUri) {
    console.log('[Database] No MONGODB_URI supplied. Backend running strictly in-memory.');
    return;
  }

  try {
    const conn = await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 3000
    });
    console.log(`[Database] MongoDB Connected: ${conn.connection.host} (History logging enabled)`);
    return conn;
  } catch (error) {
    console.log(`[Database] Optional MongoDB unavailable: ${error.message}`);
    console.log('[Database] System will continue running cleanly in-memory without MongoDB.');
  }
};

mongoose.connection.on('disconnected', () => {
  console.log('[Database] MongoDB disconnected. Falling back to in-memory mode.');
});

module.exports = connectDB;
