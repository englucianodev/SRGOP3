const bcrypt = require('bcryptjs');
const M = require('../models');
const { check, pick, text } = require('../utils/errors');
const O = require('../services/operations');
const audit = require('../services/audit');
const { createUser, password } = require('./authController');
const { disconnect } = require('../services/realtime');
const configs = {
  users: { model: 'User', fields: ['nomeCompleto', 'email', 'cidade', 'tipoAcesso', 'ativo'], populate: ['cidade', 'guarnicao'] },
  crews: { model: 'Crew', fields: ['nome', 'cidade'], populate: ['cidade', 'viatura', 'integrantes', 'motorista'] },
  vehicles: { model: 'Vehicle', fields: ['prefixo', 'placa', 'cidade', 'quilometragem', 'ultimaRevisao', 'proximaRevisao', 'revisaoKm', 'status', 'coordenadas', 'observacoes'], populate: ['cidade', 'guarnicao', 'ultimoMotorista'] },
  cities: { model: 'City', fields: ['nome', 'coordenadas', 'ativo'], populate: [] }
};
exports.list = kind => async (req, res) => {
  const c = configs[kind]; const filter = kind === 'users' ? { excluido: false } : {};
  if (req.query.cidade && kind !== 'cities') filter.cidade = req.query.cidade;
  if (kind === 'crews' && req.user.tipoAcesso === 'Praça') filter.$or = [{ status: 'Disponível' }, { status: 'Fora de serviço' }, { _id: req.user.guarnicao }];
  let query = M[c.model].find(filter).sort({ createdAt: -1 }).limit(500);
  for (const path of c.populate) query = query.populate(path, ['integrantes', 'motorista'].includes(path) ? 'nomeCompleto tipoAcesso' : undefined);
  res.json(await query);
};
exports.save = kind => async (req, res) => {
  const c = configs[kind]; let doc;
  await O.tx(async () => {
    const data = pick(req.body, c.fields);
    if (data.cidade) check(await M.City.exists({ _id: data.cidade, ativo: true }), 'Cidade não encontrada.');
    if (req.params.id) {
      doc = await M[c.model].findById(req.params.id); check(doc, 'Registro não encontrado.', 404);
      if (kind === 'users') {
        check(!O.same(doc._id, req.user._id) || (data.ativo !== false && (!data.tipoAcesso || data.tipoAcesso === 'Administrativo')), 'Não desative nem remova seu próprio perfil administrativo.');
        check(!doc.atendimentoAtivo && !doc.guarnicao, 'Encerre o serviço do usuário antes de alterar o cadastro.', 409);
        if (req.body.senha) doc.senha = await bcrypt.hash(password(req.body.senha), 12);
        doc.versaoSessao += 1;
      }
      if (kind === 'crews') check(!doc.ocorrenciaAtiva, 'Guarnição vinculada a uma ocorrência. Finalize antes de editar.', 409);
      if (kind === 'vehicles') {
        check(data.quilometragem === undefined || Number(data.quilometragem) >= doc.quilometragem, 'A quilometragem não pode diminuir.');
        check(!doc.guarnicao || !data.status || data.status === 'Em operação', 'Desassocie a viatura antes de alterar seu status.');
      }
      Object.assign(doc, data);
    } else doc = kind === 'users' ? await createUser(req.body, true) : new M[c.model](data);
    if (kind === 'crews' && Object.hasOwn(req.body, 'viatura')) await O.bindVehicle(doc, req.body.viatura || null);
    if (kind === 'cities' && data.ativo === false) check(!await M.Crew.exists({ cidade: doc._id, status: { $ne: 'Fora de serviço' } }), 'A cidade possui guarnições em serviço.');
    await doc.save(); await audit(req, req.params.id ? 'edição' : 'cadastro', c.model, doc._id);
  });
  if (kind === 'users') disconnect(doc._id);
  res.status(req.params.id ? 200 : 201).json(await M[c.model].findById(doc._id));
};
exports.remove = kind => async (req, res) => {
  const c = configs[kind];
  await O.tx(async () => {
    const doc = await M[c.model].findById(req.params.id); check(doc, 'Registro não encontrado.', 404);
    if (kind === 'users') {
      check(!O.same(doc._id, req.user._id), 'Você não pode excluir seu próprio usuário.');
      check(!doc.guarnicao && !doc.atendimentoAtivo, 'Usuário em serviço. Encerre o turno primeiro.', 409);
      doc.excluido = true; doc.ativo = false; doc.versaoSessao += 1; await doc.save();
    } else {
      if (kind === 'crews') check(doc.status === 'Fora de serviço' && !doc.ocorrenciaAtiva && !doc.viatura && !await M.Occurrence.exists({ guarnicoesRelacionadas: doc._id }), 'Guarnição vinculada ou com histórico: mantenha fora de serviço.', 409);
      if (kind === 'vehicles') check(!doc.guarnicao && !await M.Occurrence.exists({ viatura: doc._id }), 'Viatura vinculada ou com histórico: marque como indisponível.', 409);
      if (kind === 'cities') for (const model of [M.User, M.Crew, M.Vehicle, M.Occurrence]) check(!await model.exists({ cidade: doc._id }), 'Cidade em uso: desative em vez de excluir.', 409);
      await doc.deleteOne();
    }
    await audit(req, 'exclusão', c.model, doc._id);
  });
  if (kind === 'users') disconnect(req.params.id);
  res.json({ message: 'Registro excluído.' });
};
exports.leaveCrew = async (req, res) => {
  await O.tx(async () => {
    const crew = await M.Crew.findById(req.params.id); check(crew, 'Guarnição não encontrada.', 404);
    text(req.body.motivo, 'Motivo da saída', 5);
    check(!crew.ocorrenciaAtiva, 'Encerre a ocorrência antes de remover integrantes.', 409);
    const user = await M.User.findOne({ _id: req.body.usuario, guarnicao: crew._id }); check(user, 'Integrante não encontrado.', 404);
    check(crew.integrantes.length > 1, 'Para retirar o último integrante, encerre o turno.');
    crew.integrantes.pull(user._id); if (O.same(crew.motorista, user._id)) crew.motorista = undefined;
    crew.historico.push(O.history(req, 'saída autorizada', `${user.nomeCompleto}: ${req.body.motivo}`));
    user.guarnicao = undefined; await user.save(); await crew.save(); await audit(req, 'saída', 'Crew', crew._id, req.body.motivo);
  });
  disconnect(req.body.usuario); res.json({ message: 'Saída autorizada e registrada.' });
};
