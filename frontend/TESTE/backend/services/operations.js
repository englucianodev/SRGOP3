const mongoose = require('mongoose');
const M = require('../models');
const { check, text } = require('../utils/errors');
const audit = require('./audit');
const { publish, disconnect } = require('./realtime');
const tx = fn => mongoose.connection.transaction(fn);
const manager = user => ['Administrativo', 'Oficial'].includes(user.tipoAcesso);
const same = (a, b) => String(a?._id || a) === String(b?._id || b);
const history = (req, acao, detalhe = '') => ({ usuario: req.user._id, acao, detalhe });
function scope(user) {
  return user.tipoAcesso === 'Praça' ? { excluido: false, $or: [{ criadoPor: user._id }, { responsavel: user._id }, ...(user.guarnicao ? [{ guarnicoesRelacionadas: user.guarnicao }] : [])] } : { excluido: false };
}
async function occurrenceFor(req) {
  const occurrence = await M.Occurrence.findOne({ _id: req.params.id, ...scope(req.user) });
  check(occurrence, 'Ocorrência não encontrada ou não autorizada.', 404);
  return occurrence;
}
async function activeCrew(id) {
  const crew = await M.Crew.findById(id);
  check(crew && crew.fimTurno > new Date() && crew.inicioTurno && crew.integrantes.length && !['Fora de serviço', 'Indisponível'].includes(crew.status), 'Guarnição sem turno ativo ou indisponível.', 409);
  return crew;
}
async function bindVehicle(crew, vehicleId) {
  if (same(crew.viatura, vehicleId)) return;
  check(!crew.ocorrenciaAtiva, 'Não é possível trocar a viatura durante uma ocorrência.', 409);
  if (crew.viatura) await M.Vehicle.updateOne({ _id: crew.viatura, guarnicao: crew._id }, { $unset: { guarnicao: 1 }, $set: { status: 'Disponível' } });
  crew.viatura = undefined;
  if (vehicleId) {
    const vehicle = await M.Vehicle.findOneAndUpdate({ _id: vehicleId, status: 'Disponível', $or: [{ guarnicao: null }, { guarnicao: crew._id }] }, { $set: { guarnicao: crew._id, status: 'Em operação' } }, { new: true });
    check(vehicle, 'Viatura indisponível ou já vinculada a outra guarnição.', 409);
    crew.viatura = vehicle._id;
  }
}
async function dispatch(req) {
  let occurrence;
  await tx(async () => {
    occurrence = await occurrenceFor(req);
    check(['Em aberto', 'Despachada'].includes(occurrence.status), 'Somente ocorrências em aberto ou despachadas podem ser encaminhadas.', 409);
    const crew = await activeCrew(req.body.guarnicao);
    check(!crew.ocorrenciaAtiva && crew.status === 'Disponível', 'A guarnição já possui uma ocorrência.', 409);
    if (occurrence.guarnicao) await M.Crew.updateOne({ _id: occurrence.guarnicao, ocorrenciaAtiva: occurrence._id }, { $unset: { ocorrenciaAtiva: 1 } });
    crew.ocorrenciaAtiva = occurrence._id;
    await crew.save();
    occurrence.guarnicao = crew._id;
    occurrence.viatura = crew.viatura;
    occurrence.guarnicoesRelacionadas.addToSet(crew._id);
    occurrence.status = 'Despachada'; occurrence.despachadaEm = new Date();
    occurrence.historico.push(history(req, 'despacho', `Encaminhada para ${crew.nome}. ${req.body.motivo || ''}`));
    await occurrence.save();
    await M.Dispatch.create({ ocorrencia: occurrence._id, guarnicao: crew._id, usuario: req.user._id, motivo: req.body.motivo });
    await audit(req, 'despacho', 'Occurrence', occurrence._id);
  });
  await publish(occurrence, 'despacho', 'Nova ocorrência encaminhada à guarnição.');
  return occurrence;
}
async function attend(req, action) {
  let occurrence;
  await tx(async () => {
    occurrence = await occurrenceFor(req);
    const crew = await M.Crew.findById(occurrence.guarnicao);
    check(crew, 'Ocorrência sem guarnição responsável.', 409);
    const member = crew.integrantes.some(id => same(id, req.user._id));
    if (action === 'accept' || action === 'reject') {
      check(member && crew.fimTurno > new Date(), 'Somente integrantes em turno ativo podem aceitar ou rejeitar.', 403);
      check(occurrence.status === 'Despachada', 'Ocorrência já aceita ou indisponível.', 409);
      if (action === 'reject') {
        const motivo = text(req.body.motivo, 'Motivo da rejeição', 5);
        occurrence.status = 'Em aberto'; occurrence.guarnicao = undefined; occurrence.viatura = undefined;
        crew.ocorrenciaAtiva = undefined; await crew.save();
        occurrence.historico.push(history(req, 'rejeição', motivo));
      } else {
        const user = await M.User.findOneAndUpdate({ _id: req.user._id, atendimentoAtivo: null }, { atendimentoAtivo: occurrence._id }, { new: true });
        check(user, 'Você já está atendendo outra ocorrência.', 409);
        occurrence.status = 'Em atendimento'; occurrence.responsavel = req.user._id; occurrence.inicioAtendimento = new Date();
        crew.status = 'Em atendimento'; await crew.save();
        await M.Attendance.create({ ocorrencia: occurrence._id, guarnicao: crew._id, responsavel: req.user._id, inicio: occurrence.inicioAtendimento });
        occurrence.historico.push(history(req, 'aceite'));
      }
    } else {
      check(occurrence.status === 'Em atendimento', 'Atendimento não está em andamento.', 409);
      check(same(occurrence.responsavel, req.user._id) || manager(req.user), 'Somente o responsável ou a supervisão pode atualizar o atendimento.', 403);
      const attendance = await M.Attendance.findOne({ ocorrencia: occurrence._id });
      check(attendance, 'Registro de atendimento não encontrado.', 409);
      if (action === 'note') {
        const note = history(req, 'observação', text(req.body.observacao, 'Observação', 3));
        occurrence.historico.push(note); attendance.observacoes.push(note);
      } else if (action === 'close') {
        occurrence.resumo = text(req.body.resumo, 'Resumo do atendimento', 10);
        occurrence.fimAtendimento = new Date(); occurrence.status = 'Encerrada';
        occurrence.duracaoSegundos = Math.max(0, Math.floor((occurrence.fimAtendimento - occurrence.inicioAtendimento) / 1000));
        if (req.body.resultados) occurrence.resultados = req.body.resultados;
        attendance.fim = occurrence.fimAtendimento; attendance.resumo = occurrence.resumo; attendance.duracaoSegundos = occurrence.duracaoSegundos; attendance.status = 'Encerrado';
        crew.ocorrenciaAtiva = undefined; crew.status = crew.fimTurno > new Date() ? 'Disponível' : 'Fora de serviço'; await crew.save();
        for (const apoio of occurrence.apoios.filter(a => a.status === 'Autorizado')) {
          const supportCrew = await M.Crew.findById(apoio.guarnicao);
          if (supportCrew && same(supportCrew.ocorrenciaAtiva, occurrence._id)) { supportCrew.ocorrenciaAtiva = undefined; supportCrew.status = supportCrew.fimTurno > new Date() ? 'Disponível' : 'Fora de serviço'; await supportCrew.save(); }
          apoio.status = 'Concluído';
        }
        await M.User.updateOne({ _id: occurrence.responsavel }, { $unset: { atendimentoAtivo: 1 } });
        occurrence.historico.push(history(req, 'encerramento', occurrence.resumo));
      }
      await attendance.save();
    }
    await occurrence.save(); await audit(req, action, 'Occurrence', occurrence._id);
  });
  await publish(occurrence, 'atualizacao');
  return occurrence;
}
async function join(req) {
  let crew;
  await tx(async () => {
    check(typeof req.body.motorista === 'boolean', 'Informe se será o motorista.');
    const user = await M.User.findById(req.user._id);
    check(!user.guarnicao && !user.atendimentoAtivo, 'Você já pertence a uma guarnição ou está em atendimento.', 409);
    crew = await M.Crew.findById(req.params.id); check(crew, 'Guarnição não encontrada.', 404);
    check(crew.status !== 'Indisponível' && !crew.ocorrenciaAtiva, 'Guarnição indisponível para ingresso.', 409);
    if (crew.status === 'Fora de serviço') {
      crew.inicioTurno = new Date(); crew.fimTurno = new Date(Date.now() + 86400000); crew.status = 'Disponível';
    }
    check(crew.fimTurno > new Date(), 'Turno vencido. Aguarde o encerramento automático.', 409);
    if (req.body.motorista) { check(!crew.motorista, 'A guarnição já possui motorista.', 409); crew.motorista = user._id; }
    crew.integrantes.addToSet(user._id); crew.historico.push(history(req, 'ingresso', req.body.motorista ? 'Motorista' : 'Integrante'));
    user.guarnicao = crew._id; await user.save(); await crew.save();
    if (req.body.motorista && crew.viatura) await M.Vehicle.updateOne({ _id: crew.viatura }, { ultimoMotorista: user._id });
    await audit(req, 'ingresso', 'Crew', crew._id);
  });
  return crew;
}
async function endCrew(id, req, automatic = false) {
  let crew;
  await tx(async () => {
    crew = await M.Crew.findById(id); check(crew, 'Guarnição não encontrada.', 404);
    check(crew.status !== 'Fora de serviço', 'O turno já foi encerrado.', 409);
    if (automatic) check(crew.fimTurno <= new Date(), 'Turno ainda não expirou.', 409);
    else { check(manager(req.user), 'Encerramento antecipado exige Oficial ou Administrativo.', 403); text(req.body.motivo, 'Motivo do encerramento', 5); }
    const busy = crew.ocorrenciaAtiva && await M.Occurrence.findById(crew.ocorrenciaAtiva);
    if (busy?.status === 'Despachada' && same(busy.guarnicao, crew._id)) {
      busy.status = 'Em aberto'; busy.guarnicao = undefined; busy.viatura = undefined;
      busy.historico.push({ acao: 'turno encerrado', detalhe: 'Ocorrência retornou para despacho.' }); await busy.save();
    }
    // Atendimentos aceitos permanecem sob responsabilidade do policial até o encerramento.
    await M.User.updateMany({ guarnicao: crew._id }, { $unset: { guarnicao: 1 } });
    for (const member of crew.integrantes) disconnect(member);
    crew.integrantes = []; crew.motorista = undefined;
    if (busy?.status !== 'Em atendimento') crew.ocorrenciaAtiva = undefined;
    crew.status = 'Fora de serviço'; crew.fimTurno = new Date();
    crew.historico.push({ acao: automatic ? 'encerramento automático' : 'encerramento antecipado', usuario: req?.user?._id, detalhe: req?.body?.motivo || '24 horas de serviço concluídas.' });
    await crew.save(); await audit(req || {}, 'encerramento de turno', 'Crew', crew._id, req?.body?.motivo || 'Automático');
  });
  return crew;
}
async function expireShifts() {
  const expired = await M.Crew.find({ fimTurno: { $lte: new Date() }, status: { $ne: 'Fora de serviço' } }).select('_id');
  for (const crew of expired) { try { await endCrew(crew._id, null, true); } catch (error) { if (error.status !== 409) console.error('Turnos:', error.message); } }
}
module.exports = { tx, manager, same, history, scope, occurrenceFor, activeCrew, bindVehicle, dispatch, attend, join, endCrew, expireShifts };
