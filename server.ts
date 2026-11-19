import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { apiRouter } from './server/apiRouter.ts';
import {
  safeRequestLoggerMiddleware,
  sanitizeErrorMessage,
  securityHeadersMiddleware,
} from './server/security.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isProduction = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT) || 3000;

export async function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(securityHeadersMiddleware);
  app.use(safeRequestLoggerMiddleware);

  // Bounded payload limit for compressed multi-view photos
  app.use(express.json({ limit: '25mb' }));
  app.use(express.urlencoded({ extended: true, limit: '25mb' }));

  // Mount API router
  app.use('/api', apiRouter);

  // JSON parse & payload-too-large sanitized error handler
  app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!err) return next();
    if (err.type === 'entity.too.large' || err.status === 413) {
      return res.status(413).json({
        success: false,
        code: 'PAYLOAD_TOO_LARGE',
        error: 'Dung lượng dữ liệu gửi lên vượt quá giới hạn cho phép (tối đa 25MB).',
      });
    }
    if (err instanceof SyntaxError && 'body' in err) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_JSON',
        error: 'Dữ liệu JSON gửi lên không đúng định dạng.',
      });
    }
    const status = Number(err.statusCode || err.status) || 500;
    return res.status(status).json({
      success: false,
      error: sanitizeErrorMessage(err, 'Lỗi xử lý yêu cầu trên máy chủ.'),
    });
  });

  return app;
}

async function startServer() {
  const app = await createApp();

  // In development, hook Vite into express
  if (!isProduction) {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        watch: null,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // In production, serve dist folder
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Recycle Art Studio server running at http://0.0.0.0:${PORT}`);
  });
}

// Only start listener if run directly (not as imported serverless function)
if (process.env.NODE_ENV !== 'test' && !process.env.VERCEL) {
  startServer().catch(err => {
    console.error('Failed to start Recycle Art Studio server:', err);
    process.exit(1);
  });
}
