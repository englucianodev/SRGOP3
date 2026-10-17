const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const request = require('supertest');
const bcrypt = require('bcryptjs');
process.env.JWT_SECRET = 'chave-exclusiva-de-testes-com-mais-de-32-caracteres';
process.env.CLIENT_URL = 'http://localhost:5173';
process.env.NODE_ENV = 'test';
process.env.UPLOAD_DIR = require('path').resolve(__dirname, '../../.runtime/test-uploads');
const M = require('../models');
require('../config/database');
const createApp = require('../app');
const { expireShifts } = require('../services/operations');
const { day } = require('../utils/errors');
let repl, app, city, admin, official, official2, soldier, soldier2, crew, occurrence;
const agents = {};
const headers = { Origin: 'http://localhost:5173', 'X-SRGOP-Client': 'web' };
const pass = 'SenhaDeTeste123!';
const send = (who, method, url, data = {}) => agents[who][method](`/api${url}`).set(headers).send(data);
before(async () => {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { version: '7.0.14' } });
  await mongoose.connect(repl.getUri()); await Promise.all(Object.values(M).map(m => m.init()));
  city = await M.City.create({ nome: 'Cidade de teste', coordenadas: { lat: -5.2, lng: -44.4 } });
  await M.SystemSetting.create({ chave: 'geral' });
  const senha = await bcrypt.hash(pass, 4);
  const people = [['admin', 'Administrativo'], ['official', 'Oficial'], ['official2', 'Oficial'], ['soldier', 'Praça'], ['soldier2', 'Praça']];
  const users = [];
  app = createApp();
  for (const [name, role] of people) { users.push(await M.User.create({ nomeCompleto: name, email: `${name}@teste.local`, senha, cidade: city._id, tipoAcesso: role, ativo: true })); agents[name] = request.agent(app); const response = await send(name, 'post', '/auth/login', { email: `${name}@teste.local`, senha: pass }); assert.equal(response.status, 200); assert.equal(response.body.user.senha, undefined); }
  [admin, official, official2, soldier, soldier2] = users;
}, { timeout: 180000 });
after(async () => { await mongoose.disconnect(); await repl?.stop(); });
test('API exige sessão e retorna origem clara', async () => {
  const result = await request(app).get('/api/occurrences'); assert.equal(result.status, 401); assert.match(result.body.origem, /occurrences/);
});
test('cadastro público não concede privilégio nem ativa conta', async () => {
  const result = await request(app).post('/api/auth/register').set(headers).send({ nomeCompleto: 'Cadastro teste', email: 'novo@teste.local', senha: pass, confirmarSenha: pass, cidade: city._id, tipoAcesso: 'Administrativo' });
  assert.equal(result.status, 201); const user = await M.User.findOne({ email: 'novo@teste.local' }); assert.equal(user.tipoAcesso, 'Praça'); assert.equal(user.ativo, false); assert.equal(user.perfilSolicitado, 'Administrativo');
});
test('Praça não gerencia usuários nem frota e Oficial só consulta usuários', async () => {
  assert.equal((await send('soldier', 'get', '/users')).status, 403);
  assert.equal((await send('soldier', 'post', '/vehicles', {})).status, 403);
  assert.equal((await send('official', 'post', '/users', {})).status, 403);
  assert.equal((await send('official', 'get', '/users')).status, 200);
});
test('origem não autorizada é bloqueada', async () => { const result = await agents.admin.post('/api/crews').send({ nome: 'Invasão' }); assert.equal(result.status, 403); });
test('CPU único é protegido em corrida entre oficiais', async () => {
  const results = await Promise.all([send('official', 'post', '/cpu'), send('official2', 'post', '/cpu')]); assert.deepEqual(results.map(r => r.status).sort(), [201, 409]); assert.equal(await M.DailyOfficer.countDocuments({ data: day() }), 1);
  assert.equal((await send('admin', 'post', '/cpu')).status, 403);
});
test('ingresso cria turno de 24h e motorista único', async () => {
  const created = await send('admin', 'post', '/crews', { nome: 'Equipe teste', cidade: city._id }); assert.equal(created.status, 201); crew = created.body;
  const first = await send('soldier', 'post', `/crews/${crew._id}/join`, { motorista: true }); assert.equal(first.status, 200); assert.equal(new Date(first.body.fimTurno) - new Date(first.body.inicioTurno), 86400000);
  assert.equal((await send('soldier2', 'post', `/crews/${crew._id}/join`, { motorista: true })).status, 409);
  assert.equal((await send('soldier2', 'post', `/crews/${crew._id}/join`, { motorista: false })).status, 200);
});
test('ocorrência persiste, não permite status injetado e protege consulta de Praça', async () => {
  const result = await send('admin', 'post', '/occurrences', { data: day(), hora: '12:30', cidade: city._id, tipoCrime: 'Furto', localizacao: 'Rua de teste', descricao: 'Ocorrência de teste', prioridade: 'Alta', status: 'Encerrada' });
  assert.equal(result.status, 201); occurrence = result.body; assert.equal(occurrence.status, 'Em aberto'); assert.ok(occurrence.protocolo);
  assert.equal((await send('soldier', 'get', `/occurrences/${occurrence._id}`)).status, 404);
  assert.equal((await send('soldier', 'post', `/dispatches/${occurrence._id}`, { guarnicao: crew._id })).status, 403);
});
test('despacho associa guarnição, histórico e responsável', async () => {
  const result = await send('official', 'post', `/dispatches/${occurrence._id}`, { guarnicao: crew._id }); assert.equal(result.status, 200); assert.equal(result.body.status, 'Despachada');
  assert.equal(await M.Dispatch.countDocuments({ ocorrencia: occurrence._id }), 1); assert.equal((await send('soldier', 'get', `/occurrences/${occurrence._id}`)).status, 200);
});
test('aceite concorrente cria apenas um atendimento e bloqueia segunda aceitação', async () => {
  const results = await Promise.all([send('soldier', 'post', `/attendances/${occurrence._id}/accept`), send('soldier2', 'post', `/attendances/${occurrence._id}/accept`)]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]); assert.equal(await M.Attendance.countDocuments({ ocorrencia: occurrence._id }), 1);
  const row = await M.Occurrence.findById(occurrence._id); assert.equal(row.status, 'Em atendimento');
});
test('encerramento exige resumo e mantém resultados, duração e auditoria', async () => {
  assert.equal((await send('official', 'post', `/attendances/${occurrence._id}/close`, { resumo: 'curto' })).status, 400);
  const result = await send('official', 'post', `/attendances/${occurrence._id}/close`, { resumo: 'Atendimento concluído e registrado para testes.', resultados: { armasApreendidas: 1, abordagens: 3 } });
  assert.equal(result.status, 200); assert.equal(result.body.status, 'Encerrada'); assert.equal(result.body.resultados.armasApreendidas, 1);
  const c = await M.Crew.findById(crew._id); assert.equal(c.status, 'Disponível'); assert.ok(!c.ocorrenciaAtiva);
  assert.equal(await M.User.countDocuments({ atendimentoAtivo: occurrence._id }), 0); assert.ok(await M.AuditLog.exists({ acao: 'close', entidadeId: occurrence._id }));
});
test('Praça não encerra turno antecipadamente e prazo encerra automaticamente', async () => {
  assert.equal((await send('soldier', 'post', `/crews/${crew._id}/end`, { motivo: 'Saída sem autorização' })).status, 403);
  await M.Crew.updateOne({ _id: crew._id }, { fimTurno: new Date(Date.now() - 1000) }); await expireShifts();
  const c = await M.Crew.findById(crew._id); assert.equal(c.status, 'Fora de serviço'); assert.equal(c.integrantes.length, 0); assert.ok(!(await M.User.findById(soldier._id)).guarnicao);
});
test('relatórios calculam resultados reais e ocultam hash de senha', async () => {
  const result = await send('admin', 'get', '/dashboard'); assert.equal(result.status, 200); assert.equal(result.body.stats['Armas Apreendidas'], 1);
  const users = await send('admin', 'get', '/users'); assert.ok(users.body.every(u => !Object.hasOwn(u, 'senha')));
});
test('inatividade é verificada no servidor, logout revoga sessão', async () => {
  await M.Session.updateMany({ usuario: soldier._id }, { ultimaAtividade: new Date(Date.now() - 301000) }); assert.equal((await send('soldier', 'get', '/auth/me')).status, 401);
  assert.equal((await send('official2', 'post', '/auth/logout')).status, 200); assert.equal((await send('official2', 'get', '/auth/me')).status, 401);
});
