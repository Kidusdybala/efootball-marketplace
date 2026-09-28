import { app } from './app.js';
import mongoose from 'mongoose';

let isConnected = false;

const connectDB = async (env) => {
  if (isConnected) return;
  const uri = env.MONGO_URI || process.env.MONGO_URI;
  if (!uri) {
    console.warn('MONGO_URI is not defined in environment variables. Database connection skipped.');
    return;
  }
  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000,
    });
    isConnected = true;
    console.log('MongoDB Connected in Worker');
  } catch (err) {
    console.error(`DB Connection Error: ${err.message}`);
  }
};

export default {
  async fetch(request, env, ctx) {
    if (env && typeof env === 'object') {
      // Safely assign environment variables to process.env
      for (const key of Object.keys(env)) {
        if (typeof env[key] === 'string') {
          process.env[key] = env[key];
        }
      }
    }
    
    // Ensure database connection
    await connectDB(env);
    
    return app.fetch(request, env, ctx);
  },
  
  async scheduled(event, env, ctx) {
    if (env && typeof env === 'object') {
      for (const key of Object.keys(env)) {
        if (typeof env[key] === 'string') {
          process.env[key] = env[key];
        }
      }
    }
    
    await connectDB(env);
    console.log('Cron triggered at:', event.scheduledTime);
    // Add any periodic background tasks here
  }
};
