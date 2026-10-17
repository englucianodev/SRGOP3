const { parse } = require('cookie');
const { authenticate } = require('../middlewares/security');
const { User, Notification } = require('../models');
let io;
function setup(server) {
  io = server;
  io.use(async (socket, next) => {
    try { socket.data.auth = await authenticate(parse(socket.handshake.headers.cookie || '').srgop); next(); }
    catch { next(new Error('Autenticação: sessão inválida.')); }
  });
  io.on('connection', socket => {
    socket.join(`user:${socket.data.auth.user._id}`);
    const timer = setInterval(async () => {
      try { await authenticate(parse(socket.handshake.headers.cookie || '').srgop); }
      catch { socket.disconnect(true); }
    }, 15000);
    socket.on('disconnect', () => clearInterval(timer));
  });
}
async function publish(occurrence, event = 'atualizacao', message = 'Ocorrência atualizada.') {
  if (!io) return;
  const users = await User.find({ ativo: true, excluido: false, $or: [{ tipoAcesso: { $in: ['Administrativo', 'Oficial'] } }, { guarnicao: { $in: occurrence.guarnicoesRelacionadas || [] } }, { _id: occurrence.criadoPor }] }).select('_id');
  for (const user of users) {
    if (event === 'despacho' || event === 'apoio') await Notification.create({ usuario: user._id, ocorrencia: occurrence._id, mensagem: message });
    io.to(`user:${user._id}`).emit(event, { ocorrencia: String(occurrence._id), guarnicao: String(occurrence.guarnicao || ''), message });
  }
}
const disconnect = id => io?.in(`user:${id}`).disconnectSockets(true);
module.exports = { setup, publish, disconnect };
