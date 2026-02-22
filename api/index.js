// Vercel serverless function entry point
// This wraps the React Router server for Vercel

import { createRequestHandler } from '@react-router/node';
import * as build from '../build/server/index.js';

export default createRequestHandler({ build });
