require('dotenv').config();
const bcrypt = require('bcryptjs');
const M = require('../models');
const connect = require('../config/database');
const { day, check } = require('../utils/errors');
const { password } = require('../controllers/authController');
// Dados demonstrativos, não representam a delimitação oficial da área do batalhão.
const cities = [
  ['Presidente Dutra', -5.289, -44.49], ['Tuntum', -5.257, -44.649], ['Graça Aranha', -5.405, -44.335],
  ['Governador Eugênio Barros', -5.318, -44.246], ['Governador Luiz Rocha', -5.479, -44.077], ['Senador Alexandre Costa', -5.251, -44.054],
  ['Santo Antônio dos Lopes', -4.866, -44.365], ['São Domingos do Maranhão', -5.576, -44.385], ['Santa Filomena do Maranhão', -5.5, -44.564],
  ['Capinzal do Norte', -4.726, -44.329], ['Dom Pedro', -5.036, -44.44], ['Governador Archer', -5.022, -44.275],
  ['Joselândia', -4.987, -44.699], ['Gonçalves Dias', -5.147, -44.301]
];
async function seed() {
  check(process.env.SEED_PASSWORD, 'Defina SEED_PASSWORD antes de executar o seed.');
  const hash = await bcrypt.hash(password(process.env.SEED_PASSWORD), 12);
  await connect();
  for (const [nome, lat, lng] of cities) await M.City.updateOne({ nome }, { $setOnInsert: { nome, coordenadas: { lat, lng }, ativo: true } }, { upsert: true });
  await M.SystemSetting.updateOne({ chave: 'geral' }, { $setOnInsert: { chave: 'geral' } }, { upsert: true });
  const city = await M.City.findOne({ nome: 'Presidente Dutra' });
  for (const [email, nomeCompleto, tipoAcesso] of [['admin@srgop.local', 'Administrador de demonstração', 'Administrativo'], ['oficial@srgop.local', 'Oficial de demonstração', 'Oficial'], ['praca@srgop.local', 'Policial de demonstração', 'Praça'], ['praca2@srgop.local', 'Segundo policial de demonstração', 'Praça']]) {
    await M.User.updateOne({ email }, { $setOnInsert: { email, nomeCompleto, tipoAcesso, perfilSolicitado: tipoAcesso, senha: hash, cidade: city._id, ativo: true } }, { upsert: true });
  }
  for (let i = 1; i <= 3; i++) {
    await M.Vehicle.updateOne({ prefixo: `VTR-${1800 + i}` }, { $setOnInsert: { prefixo: `VTR-${1800 + i}`, placa: `DMO${i}A23`, cidade: city._id, quilometragem: 18000 * i, coordenadas: { lat: -5.289 + i * .004, lng: -44.49 + i * .003 }, status: i === 3 ? 'Em manutenção' : 'Disponível', proximaRevisao: new Date(Date.now() + (i - 2) * 86400000 * 5) } }, { upsert: true });
    await M.Crew.updateOne({ nome: `Águia ${String(i).padStart(2, '0')}` }, { $setOnInsert: { nome: `Águia ${String(i).padStart(2, '0')}`, cidade: city._id, status: 'Fora de serviço' } }, { upsert: true });
  }
  const user = await M.User.findOne({ email: 'admin@srgop.local' });
  for (let i = 0; i < 8; i++) await M.Occurrence.updateOne({ protocolo: `DEMO-${String(i + 1).padStart(4, '0')}` }, { $setOnInsert: { protocolo: `DEMO-${String(i + 1).padStart(4, '0')}`, data: day(), hora: `${String(8 + i).padStart(2, '0')}:30`, cidade: city._id, tipoCrime: ['Averiguação', 'Trânsito', 'Perturbação do sossego', 'Furto'][i % 4], localizacao: `Endereço demonstrativo ${i + 1}, Centro`, descricao: 'Registro fictício para treinamento e validação do fluxo operacional.', prioridade: ['Alta', 'Média', 'Baixa'][i % 3], criadoPor: user._id, coordenadas: { lat: -5.289 + i * .003, lng: -44.49 - i * .003 }, historico: [{ acao: 'seed', usuario: user._id, detalhe: 'Dado fictício.' }] } }, { upsert: true });
  console.log('Seed concluído: 14 cidades, 4 usuários, 3 guarnições, 3 viaturas e 8 ocorrências fictícias. Registros existentes preservados.');
}
seed().then(() => require('mongoose').disconnect()).catch(error => { console.error('Seed:', error.message); process.exit(1); });

