const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const { originGuard, errorHandler } = require('./middlewares/security');
function createApp() {
  const app = express(); app.set('trust proxy', 1); app.use(helmet());
  app.use(cors({ origin: (process.env.CLIENT_URL || 'http://localhost:5173').split(',').map(v => v.trim()), credentials: true }));
  app.use(express.json({ limit: '1mb' })); app.use(cookieParser()); app.use(originGuard);
  app.use('/api', require('./routes'));
  app.use((req, res, next) => next(Object.assign(new Error('Rota não encontrada.'), { status: 404 })));
  app.use(errorHandler); return app;
}
module.exports = createApp;
