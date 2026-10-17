const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { rateLimit } = require('express-rate-limit');
const M = require('../models');
const A = require('../controllers/authController');
const R = require('../controllers/resourceController');
const C = require('../controllers/occurrenceController');
const Reports = require('../controllers/reportController');
const O = require('../services/operations');
const audit = require('../services/audit');
const { auth, allow } = require('../middlewares/security');
const { wrap, check, pick, day, text } = require('../utils/errors');
const router = express.Router();
const supervisors = allow('Administrativo', 'Oficial');
const admin = allow('Administrativo');
const loginLimit = rateLimit({ windowMs: 15 * 60000, limit: 25, standardHeaders: 'draft-7', legacyHeaders: false, handler: (req, res) => res.status(429).json({ message: 'Muitas tentativas. Aguarde 15 minutos.', origem: 'Autenticação', redirect: '/dashboard' }) });
router.get('/health', (req, res) => res.json({ status: 'ok', database: require('mongoose').connection.readyState === 1 }));
router.get('/auth/cities', wrap(async (req, res) => res.json(await M.City.find({ ativo: true }).select('nome').sort({ nome: 1 }))));
router.post('/auth/register', loginLimit, wrap(A.register));
router.post('/auth/login', loginLimit, wrap(A.login));
router.post('/auth/logout', wrap(async (req, res) => {
  try { Object.assign(req, await require('../middlewares/security').authenticate(req.cookies.srgop)); } catch { /* Cookies expirados também são removidos. */ }
  await A.logout(req, res);
}));
router.use(auth);
router.get('/auth/me', (req, res) => res.json({ user: req.user, ultimaAtividade: req.session.ultimaAtividade }));
router.post('/auth/activity', wrap(async (req, res) => { req.session.ultimaAtividade = new Date(); await req.session.save(); res.json({ ok: true }); }));
router.get('/dashboard', wrap(Reports.dashboard));
router.get('/settings', wrap(async (req, res) => res.json(await M.SystemSetting.findOne({ chave: 'geral' }))));
router.put('/settings', admin, wrap(async (req, res) => {
  const settings = await M.SystemSetting.findOne({ chave: 'geral' }); check(settings, 'Execute o seed para criar as configurações.', 409);
  Object.assign(settings, pick(req.body, ['instituicao', 'inatividadeMinutos', 'alertaSegundos', 'som', 'tiposCrime', 'modulosDashboard']));
  check(settings.tiposCrime.length > 0 && settings.tiposCrime.every(t => typeof t === 'string' && t.trim().length > 0 && t.length < 120), 'Informe tipos de crime válidos.');
  await settings.save(); await audit(req, 'configuração', 'SystemSetting', settings._id); res.json(settings);
}));
router.get('/cpu', wrap(async (req, res) => res.json(await M.DailyOfficer.findOne({ data: day() }).populate('oficial', 'nomeCompleto'))));
router.post('/cpu', allow('Oficial'), wrap(async (req, res) => {
  let cpu; await O.tx(async () => { cpu = await M.DailyOfficer.create({ data: day(), oficial: req.user._id }); await audit(req, 'assumiu CPU', 'DailyOfficer', cpu._id); }); res.status(201).json(cpu);
}));
router.put('/cpu', admin, wrap(async (req, res) => {
  text(req.body.motivo, 'Motivo da alteração', 5);
  check(await M.User.exists({ _id: req.body.oficial, tipoAcesso: 'Oficial', ativo: true }), 'Selecione um Oficial ativo.');
  const cpu = await M.DailyOfficer.findOneAndUpdate({ data: day() }, { $set: { oficial: req.body.oficial, assumiuEm: new Date() }, $push: { historico: O.history(req, 'CPU alterado', req.body.motivo) } }, { upsert: true, new: true, runValidators: true });
  await audit(req, 'CPU alterado', 'DailyOfficer', cpu._id, req.body.motivo); res.json(cpu);
}));
for (const kind of ['users', 'crews', 'vehicles', 'cities']) {
  router.get(`/${kind}`, ...(['users', 'vehicles'].includes(kind) ? [supervisors] : []), wrap(R.list(kind)));
  const editPermission = ['cities', 'users'].includes(kind) ? admin : supervisors;
  router.post(`/${kind}`, editPermission, wrap(R.save(kind)));
  router.put(`/${kind}/:id`, editPermission, wrap(R.save(kind)));
  router.delete(`/${kind}/:id`, editPermission, wrap(R.remove(kind)));
}
router.post('/crews/:id/join', wrap(async (req, res) => res.json(await O.join(req))));
router.post('/crews/:id/leave', supervisors, wrap(R.leaveCrew));
router.post('/crews/:id/end', supervisors, wrap(async (req, res) => res.json(await O.endCrew(req.params.id, req))));
router.patch('/vehicles/:id/location', supervisors, wrap(async (req, res) => {
  const vehicle = await M.Vehicle.findById(req.params.id); check(vehicle, 'Viatura não encontrada.', 404);
  vehicle.coordenadas = req.body.coordenadas; await vehicle.save(); await audit(req, 'localização', 'Vehicle', vehicle._id); res.json(vehicle);
}));
router.get('/occurrences', wrap(C.list));
router.post('/occurrences', wrap(C.save));
router.get('/occurrences/:id', wrap(C.get));
router.put('/occurrences/:id', wrap(C.save));
router.delete('/occurrences/:id', supervisors, wrap(C.remove));
router.post('/occurrences/:id/cancel', supervisors, wrap(C.cancel));
const uploadRoot = path.resolve(process.env.UPLOAD_DIR || './uploads'); fs.mkdirSync(uploadRoot, { recursive: true });
const upload = multer({ storage: multer.diskStorage({ destination: uploadRoot, filename: (req, file, cb) => cb(null, randomUUID()) }), limits: { fileSize: 5 * 1024 * 1024, files: 1 }, fileFilter: (req, file, cb) => cb(null, ['application/pdf', 'image/png', 'image/jpeg'].includes(file.mimetype)) });
router.post('/occurrences/:id/attachments', upload.single('arquivo'), wrap(C.upload));
router.get('/occurrences/:id/attachments/:attachment', wrap(C.download));
router.get('/dispatches', supervisors, wrap(async (req, res) => res.json(await M.Dispatch.find().populate('ocorrencia guarnicao').populate('usuario', 'nomeCompleto').sort({ createdAt: -1 }).limit(500))));
router.post('/dispatches/:id', supervisors, wrap(async (req, res) => res.json(await O.dispatch(req))));
router.get('/attendances', wrap(async (req, res) => {
  const occurrenceIds = await M.Occurrence.find(O.scope(req.user)).distinct('_id');
  res.json(await M.Attendance.find({ ocorrencia: { $in: occurrenceIds } }).populate('ocorrencia guarnicao').populate('responsavel', 'nomeCompleto').limit(500));
}));
for (const action of ['accept', 'reject', 'note', 'close']) router.post(`/attendances/:id/${action}`, wrap(async (req, res) => res.json(await O.attend(req, action))));
router.post('/attendances/:id/support', wrap(C.support));
router.get('/reports', supervisors, wrap(Reports.report));
router.get('/notifications', wrap(async (req, res) => res.json(await M.Notification.find({ usuario: req.user._id }).sort({ createdAt: -1 }).limit(100))));
router.patch('/notifications/:id', wrap(async (req, res) => { const n = await M.Notification.findOneAndUpdate({ _id: req.params.id, usuario: req.user._id }, { lida: true }, { new: true }); check(n, 'Notificação não encontrada.', 404); res.json(n); }));
router.get('/audit-logs', supervisors, wrap(async (req, res) => res.json(await M.AuditLog.find(req.query.usuario ? { usuario: req.query.usuario } : {}).populate('usuario', 'nomeCompleto').sort({ createdAt: -1 }).limit(200))));
module.exports = router;
