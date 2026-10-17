const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');
const { User, City, Session } = require('../models');
const { check, text } = require('../utils/errors');
const audit = require('../services/audit');
const { disconnect } = require('../services/realtime');
const cookieOptions = () => ({ httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: process.env.COOKIE_SAME_SITE || 'lax', path: '/' });
function password(value) { check(typeof value === 'string' && value.length >= 12 && Buffer.byteLength(value) <= 72, 'Senha: use pelo menos 12 caracteres e no máximo 72 bytes.'); return value; }
async function createUser(data, admin = false) {
  check(await City.exists({ _id: data.cidade, ativo: true }), 'Cidade não encontrada.');
  const senha = password(data.senha);
  if (!admin) check(senha === data.confirmarSenha, 'A confirmação da senha não confere.');
  return User.create({ nomeCompleto: text(data.nomeCompleto, 'Nome completo', 3), email: text(data.email, 'E-mail').toLowerCase(), senha: await bcrypt.hash(senha, 12), cidade: data.cidade, tipoAcesso: admin ? data.tipoAcesso : 'Praça', perfilSolicitado: data.tipoAcesso || 'Praça', ativo: admin });
}
exports.register = async (req, res) => {
  const user = await createUser(req.body);
  await audit(req, 'cadastro', 'User', user._id, 'Cadastro aguardando aprovação administrativa.');
  res.status(201).json({ message: 'Cadastro recebido. Aguarde a ativação e aprovação do perfil pelo Administrativo.' });
};
exports.login = async (req, res) => {
  const email = text(req.body.email, 'E-mail').toLowerCase();
  const user = await User.findOne({ email, excluido: false }).select('+senha');
  check(user && typeof req.body.senha === 'string' && await bcrypt.compare(req.body.senha, user.senha), 'E-mail ou senha incorretos.', 401);
  check(user.ativo, 'Seu cadastro aguarda ativação pelo Administrativo.', 403);
  const jti = randomUUID();
  const seconds = req.body.lembrar ? 7 * 86400 : 12 * 3600;
  const token = jwt.sign({ sub: String(user._id), jti, v: user.versaoSessao }, process.env.JWT_SECRET, { expiresIn: seconds, algorithm: 'HS256' });
  await Session.create({ usuario: user._id, jti, expiraEm: new Date(Date.now() + seconds * 1000) });
  req.user = user;
  await audit(req, 'login', 'User', user._id);
  res.cookie('srgop', token, { ...cookieOptions(), ...(req.body.lembrar ? { maxAge: seconds * 1000 } : {}) });
  res.json({ user: await User.findById(user._id).populate('cidade') });
};
exports.logout = async (req, res) => {
  if (req.session) { req.session.revogada = true; await req.session.save(); await audit(req, 'logout', 'User', req.user._id); disconnect(req.user._id); }
  res.clearCookie('srgop', cookieOptions()).json({ message: 'Sessão encerrada.' });
};
exports.createUser = createUser;
exports.password = password;
