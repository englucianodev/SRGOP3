const M = require('../models');
const O = require('../services/operations');
const { day } = require('../utils/errors');
const { filter } = require('./occurrenceController');
exports.dashboard = async (req, res) => {
  const today = day();
  const [rows, vehicles, crews, cities, cpu] = await Promise.all([
    M.Occurrence.find(O.scope(req.user)).select('data status prioridade duracaoSegundos resultados'),
    O.manager(req.user) ? M.Vehicle.countDocuments() : 0,
    O.manager(req.user) ? M.Crew.countDocuments({ fimTurno: { $gt: new Date() }, status: { $ne: 'Fora de serviço' } }) : (req.user.guarnicao ? 1 : 0),
    M.City.countDocuments({ ativo: true }), M.DailyOfficer.findOne({ data: today }).populate('oficial', 'nomeCompleto')
  ]);
  const closed = rows.filter(r => r.status === 'Encerrada');
  const sum = name => rows.reduce((total, row) => total + (row.resultados?.[name] || 0), 0);
  res.json({ stats: {
    Hoje: rows.filter(r => r.data === today).length, 'Mês': rows.filter(r => r.data.startsWith(today.slice(0, 7))).length,
    Ano: rows.filter(r => r.data.startsWith(today.slice(0, 4))).length, Encerradas: closed.length,
    'Em Aberto': rows.filter(r => !['Encerrada', 'Cancelada'].includes(r.status)).length,
    Alertas: rows.filter(r => r.prioridade === 'Alta' && !['Encerrada', 'Cancelada'].includes(r.status)).length,
    Viaturas: vehicles, 'Guarnições': crews, Cidades: cities,
    'Tempo Médio': closed.length ? `${Math.round(closed.reduce((s, r) => s + r.duracaoSegundos, 0) / closed.length / 60)} min` : '—',
    'Operações': rows.filter(r => r.status === 'Em atendimento').length,
    'Armas Apreendidas': sum('armasApreendidas'), 'Veículos Recuperados': sum('veiculosRecuperados'), Conduzidos: sum('conduzidos'), Abordagens: sum('abordagens')
  }, cpu });
};
exports.report = async (req, res) => {
  const rows = await M.Occurrence.find(filter(req)).populate('cidade guarnicao viatura').populate('criadoPor', 'nomeCompleto').sort({ data: -1 }).limit(10000);
  const group = key => Object.entries(rows.reduce((acc, row) => { const name = row[key]?.nome || row[key]?.prefixo || row[key] || 'Não informado'; acc[name] = (acc[name] || 0) + 1; return acc; }, {})).map(([nome, total]) => ({ nome, total }));
  const crews = await M.Crew.find(req.query.cidade ? { cidade: req.query.cidade } : {}).populate('cidade');
  const users = await M.User.find({ ativo: true, excluido: false, ...(req.query.cidade ? { cidade: req.query.cidade } : {}) }).populate('cidade guarnicao');
  const vehicles = await M.Vehicle.find({ status: 'Em manutenção', ...(req.query.cidade ? { cidade: req.query.cidade } : {}) }).populate('cidade');
  const closed = rows.filter(r => r.status === 'Encerrada');
  res.json({ rows, porCidade: group('cidade'), porCrime: group('tipoCrime'), porPrioridade: group('prioridade'), porStatus: group('status'), porGuarnicao: group('guarnicao'), porViatura: group('viatura'), usuariosAtivos: users, turnos: crews, manutencao: vehicles, tempoMedio: closed.length ? Math.round(closed.reduce((sum, r) => sum + r.duracaoSegundos, 0) / closed.length) : 0, limite: 10000 });
};
