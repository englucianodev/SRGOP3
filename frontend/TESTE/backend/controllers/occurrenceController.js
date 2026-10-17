const fs = require('fs/promises');
const path = require('path');
const M = require('../models');
const O = require('../services/operations');
const { check, pick, text } = require('../utils/errors');
const audit = require('../services/audit');
const { publish } = require('../services/realtime');
const fields = ['data', 'hora', 'cidade', 'tipoCrime', 'localizacao', 'coordenadas', 'descricao', 'prioridade'];
const populated = query => query.populate('cidade guarnicao viatura').populate('criadoPor responsavel historico.usuario apoios.solicitadoPor apoios.autorizadoPor', 'nomeCompleto').populate('apoios.guarnicao', 'nome cidade');
function filter(req) {
  const f = O.scope(req.user);
  for (const field of ['cidade', 'prioridade', 'status', 'guarnicao', 'viatura', 'tipoCrime']) if (req.query[field]) f[field] = req.query[field];
  if (req.query.usuario) f.criadoPor = req.query.usuario;
  if (req.query.inicio || req.query.fim) { f.data = {}; if (req.query.inicio) f.data.$gte = String(req.query.inicio); if (req.query.fim) f.data.$lte = String(req.query.fim); }
  if (req.query.q) f.protocolo = { $regex: String(req.query.q).slice(0, 80).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  return f;
}
exports.filter = filter;
exports.list = async (req, res) => res.json(await populated(M.Occurrence.find(filter(req)).sort({ createdAt: -1 }).limit(500)));
exports.get = async (req, res) => { await O.occurrenceFor(req); res.json(await populated(M.Occurrence.findById(req.params.id))); };
exports.save = async (req, res) => {
  let occurrence;
  await O.tx(async () => {
    const data = pick(req.body, fields);
    if (data.cidade) check(await M.City.exists({ _id: data.cidade, ativo: true }), 'Município inválido.');
    if (data.data) check(!Number.isNaN(Date.parse(data.data)) && new Date(data.data).toISOString().slice(0, 10) === data.data, 'Data da ocorrência inválida.');
    if (data.tipoCrime) { const settings = await M.SystemSetting.findOne({ chave: 'geral' }); check(settings?.tiposCrime.includes(data.tipoCrime), 'Tipo de crime não cadastrado.'); }
    if (req.params.id) {
      occurrence = await O.occurrenceFor(req);
      check(O.manager(req.user) || O.same(occurrence.criadoPor, req.user._id), 'Você não pode editar ocorrências de outros usuários.', 403);
      check(occurrence.status === 'Em aberto', 'Somente ocorrências em aberto podem ser editadas.', 409);
      Object.assign(occurrence, data);
    } else occurrence = new M.Occurrence({ ...data, criadoPor: req.user._id });
    occurrence.historico.push(O.history(req, req.params.id ? 'edição' : 'cadastro', req.params.id ? `Campos atualizados: ${Object.keys(data).join(', ')}` : 'Registro inicial'));
    await occurrence.save(); await audit(req, req.params.id ? 'edição' : 'cadastro', 'Occurrence', occurrence._id);
  });
  await publish(occurrence); res.status(req.params.id ? 200 : 201).json(occurrence);
};
exports.remove = async (req, res) => {
  let occurrence;
  await O.tx(async () => {
    occurrence = await O.occurrenceFor(req); check(occurrence.status === 'Em aberto', 'Somente ocorrências em aberto podem ser excluídas.', 409);
    occurrence.excluido = true; occurrence.historico.push(O.history(req, 'exclusão lógica')); await occurrence.save(); await audit(req, 'exclusão', 'Occurrence', occurrence._id);
  });
  await publish(occurrence); res.json({ message: 'Ocorrência excluída; histórico preservado.' });
};
exports.cancel = async (req, res) => {
  let occurrence;
  await O.tx(async () => {
    occurrence = await O.occurrenceFor(req); check(['Em aberto', 'Despachada'].includes(occurrence.status), 'Não é possível cancelar este atendimento.', 409);
    occurrence.historico.push(O.history(req, 'cancelamento', text(req.body.motivo, 'Motivo', 5)));
    if (occurrence.guarnicao) await M.Crew.updateOne({ _id: occurrence.guarnicao, ocorrenciaAtiva: occurrence._id }, { $unset: { ocorrenciaAtiva: 1 } });
    occurrence.status = 'Cancelada'; await occurrence.save(); await audit(req, 'cancelamento', 'Occurrence', occurrence._id);
  });
  await publish(occurrence); res.json(occurrence);
};
exports.upload = async (req, res) => {
  try {
    check(req.file, 'Selecione um arquivo PDF, JPEG ou PNG.');
    const bytes = await fs.readFile(req.file.path);
    const valid = (req.file.mimetype === 'application/pdf' && bytes.subarray(0, 5).toString() === '%PDF-') || (req.file.mimetype === 'image/png' && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) || (req.file.mimetype === 'image/jpeg' && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255);
    check(valid, 'O conteúdo do arquivo não corresponde ao formato permitido.');
    await O.tx(async () => {
      const occurrence = await O.occurrenceFor(req);
      check(O.manager(req.user) || O.same(occurrence.criadoPor, req.user._id) || O.same(occurrence.responsavel, req.user._id), 'Sem permissão para anexar.', 403);
      check(!['Encerrada', 'Cancelada'].includes(occurrence.status) && occurrence.anexos.length < 10, 'Registro encerrado ou limite de 10 anexos atingido.');
      occurrence.anexos.push({ nome: path.basename(req.file.originalname), arquivo: req.file.filename, mime: req.file.mimetype, tamanho: req.file.size });
      occurrence.historico.push(O.history(req, 'anexo', req.file.originalname)); await occurrence.save(); await audit(req, 'anexo', 'Occurrence', occurrence._id);
    });
    res.status(201).json({ message: 'Anexo salvo.' });
  } catch (error) { if (req.file) await fs.unlink(req.file.path).catch(() => {}); throw error; }
};
exports.download = async (req, res) => {
  const occurrence = await O.occurrenceFor(req); const attachment = occurrence.anexos.id(req.params.attachment);
  check(attachment, 'Anexo não encontrado.', 404);
  const file = path.join(path.resolve(process.env.UPLOAD_DIR || './uploads'), path.basename(attachment.arquivo)); await fs.access(file);
  res.set('Content-Type', attachment.mime).set('X-Content-Type-Options', 'nosniff').download(file, attachment.nome);
};
exports.support = async (req, res) => {
  let occurrence;
  await O.tx(async () => {
    occurrence = await O.occurrenceFor(req);
    check(occurrence.status === 'Em atendimento', 'Apoio exige atendimento em andamento.', 409);
    check(O.manager(req.user) || O.same(occurrence.responsavel, req.user._id), 'Somente o responsável pode solicitar apoio.', 403);
    if (req.body.apoioId) {
      check(O.manager(req.user), 'Somente a supervisão pode autorizar apoio.', 403);
      const support = occurrence.apoios.id(req.body.apoioId); check(support?.status === 'Pendente', 'Pedido de apoio não está pendente.', 409);
      const crew = await O.activeCrew(support.guarnicao); check(!crew.ocorrenciaAtiva, 'Guarnição de apoio ocupada.', 409);
      crew.ocorrenciaAtiva = occurrence._id; crew.status = 'Em atendimento'; await crew.save();
      support.status = 'Autorizado'; support.autorizadoPor = req.user._id; occurrence.guarnicoesRelacionadas.addToSet(crew._id);
      occurrence.historico.push(O.history(req, 'apoio autorizado', crew.nome));
    } else {
      const crew = await O.activeCrew(req.body.guarnicao);
      check(!crew.ocorrenciaAtiva && !O.same(crew._id, occurrence.guarnicao), 'Guarnição de apoio indisponível.', 409);
      check(!occurrence.apoios.some(a => O.same(a.guarnicao, crew._id) && a.status !== 'Concluído'), 'Já existe solicitação para esta guarnição.', 409);
      occurrence.apoios.push({ guarnicao: crew._id, solicitadoPor: req.user._id, motivo: text(req.body.motivo, 'Motivo do apoio', 5) });
      occurrence.historico.push(O.history(req, 'apoio solicitado', crew.nome));
    }
    await occurrence.save(); await audit(req, 'apoio', 'Occurrence', occurrence._id);
  });
  await publish(occurrence, 'apoio', 'Solicitação de apoio atualizada.'); res.json(occurrence);
};
