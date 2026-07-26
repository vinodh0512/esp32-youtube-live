const mongoose = require('mongoose');

const ProcessedPollSchema = new mongoose.Schema(
  {
    pollId: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    processed: {
      type: Boolean,
      default: true
    },
    question: {
      type: String
    },
    winner: {
      type: String,
      enum: ['ON', 'OFF', 'NONE']
    },
    processedAt: {
      type: Date,
      default: Date.now
    }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('ProcessedPoll', ProcessedPollSchema);
