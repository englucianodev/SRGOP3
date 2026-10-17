const jwt = require('jsonwebtoken');
const { User, Session, SystemSetting } = require('../models');
const { check, wrap, AppError } = require('../utils/errors');
async function authenticate(token) {
  check(token, 'Sessão ausente. Entre no sistema.', 401);
  let payload;
  try { payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] }); }
  catch { throw new AppError(401, 'Sessão expirada ou inválida. Entre novamente.'); }
  const session = await Session.findOne({ jti: payload.jti, revogada: false, expiraEm: { $gt: new Date() } });
  const user = await User.findById(payload.sub).populate('cidade');
  const settings = await SystemSetting.findOne({ chave: 'geral' });
  check(session && user?.ativo && !user.excluido && payload.v === user.versaoSessao, 'Sessão encerrada ou usuário inativo.', 401);
  check(Date.now() - session.ultimaAtividade.getTime() < (settings?.inatividadeMinutos || 5) * 60000, 'Sessão encerrada por inatividade.', 401);
  return { user, session };
}
const auth = wrap(async (req, res, next) => { Object.assign(req, await authenticate(req.cookies.srgop)); next(); });
const allow = (...roles) => (req, res, next) => roles.includes(req.user.tipoAcesso) ? next() : next(new AppError(403, 'Seu perfil não tem permissão para esta ação.'));
function originGuard(req, res, next) {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const allowed = (process.env.CLIENT_URL || 'http://localhost:5173').split(',').map(v => v.trim());
    if (!allowed.includes(req.headers.origin) || req.headers['x-srgop-client'] !== 'web') return next(new AppError(403, 'Origem da requisição não autorizada.'));
  }
  next();
}
function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  console.error(`[${req.method} ${req.path}]`, error.name, error.message);
  let status = error.status || 500;
  let message = error.status ? error.message : 'Não foi possível concluir a operação. Tente novamente.';
  if (['ValidationError', 'CastError', 'StrictModeError'].includes(error.name)) { status = 400; message = 'Dados inválidos: ' + (error.name === 'ValidationError' ? Object.values(error.errors).map(e => e.path).join(', ') : 'verifique os campos e identificadores informados.'); }
  if (error.code === 11000) { status = 409; message = 'Já existe um registro com estes dados. CPU: apenas um oficial pode assumir por dia.'; }
  if (error.name === 'VersionError') { status = 409; message = 'O registro foi atualizado por outra pessoa. Atualize a página.'; }
  if (error.code === 'LIMIT_FILE_SIZE') { status = 413; message = 'O anexo excede o limite de 5 MB.'; }
  res.status(status).json({ message, origem: `${req.method} ${req.path}`, redirect: '/dashboard' });
}
module.exports = { auth, allow, authenticate, originGuard, errorHandler };
