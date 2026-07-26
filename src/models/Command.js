const mongoose = require('mongoose');

const CommandSchema = new mongoose.Schema(
  {
    command: {
      type: String,
      enum: ['ON', 'OFF', 'NONE'],
      required: true
    },
    pollId: {
      type: String,
      required: true
    },
    status: {
      type: String,
      default: 'completed'
    },
    votes: {
      ON: { type: Number, default: 0 },
      OFF: { type: Number, default: 0 }
    },
    timestamp: {
      type: Date,
      default: Date.now
    }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('Command', CommandSchema);
