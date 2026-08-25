'use strict';
const mongoose = require('mongoose');
const env = require('./env');
const logger = require('../utils/logger');

mongoose.set('strictQuery', true);

async function connectDB(uri = env.MONGO_URI) {
  const conn = await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10000,
    maxPoolSize: 20,
  });
  logger.info(`MongoDB connected: ${conn.connection.host}/${conn.connection.name}`);
  return conn;
}

async function disconnectDB() {
  await mongoose.connection.close();
}

module.exports = { connectDB, disconnectDB };
