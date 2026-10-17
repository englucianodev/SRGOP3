require('dotenv').config();
const http = require('http');
const { Server } = require('socket.io');
const connect = require('./config/database');
const createApp = require('./app');
const { setup } = require('./services/realtime');
const { expireShifts } = require('./services/operations');
async function start() {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32 || process.env.JWT_SECRET.startsWith('troque_')) throw new Error('Configuração: defina JWT_SECRET com uma chave aleatória de pelo menos 32 caracteres.');
  await connect();
  const server = http.createServer(createApp());
  const origins = (process.env.CLIENT_URL || 'http://localhost:5173').split(',').map(v => v.trim());
  const io = new Server(server, { cors: { origin: origins, credentials: true }, allowRequest: (req, callback) => callback(null, origins.includes(req.headers.origin)) });
  setup(io);
  await expireShifts();
  const timer = setInterval(() => expireShifts().catch(error => console.error('Turnos:', error.message)), 15000);
  server.listen(process.env.PORT || 5000, () => console.log('SRGOP API disponível na porta ' + (process.env.PORT || 5000)));
  async function shutdown() { clearInterval(timer); io.close(); server.close(); await require('mongoose').disconnect(); process.exit(0); }
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
}
start().catch(error => { console.error('Inicialização:', error.message); process.exit(1); });
