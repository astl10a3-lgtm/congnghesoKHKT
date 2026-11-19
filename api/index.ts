import express from 'express';
import dotenv from 'dotenv';
import { apiRouter } from '../server/apiRouter.js';

dotenv.config();

const app = express();

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Mount both at /api and at / so any rewritten path matches
app.use('/api', apiRouter);
app.use('/', apiRouter);

export default app;
