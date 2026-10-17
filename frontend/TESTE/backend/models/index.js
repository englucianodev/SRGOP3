const mongoose = require('mongoose');
const { randomUUID } = require('crypto');
const { Schema } = mongoose;
const roles = ['Administrativo', 'Oficial', 'Praça'];
const ref = (model, required = false) => ({ type: Schema.Types.ObjectId, ref: model, required });
const str = (required = false, max = 250) => ({ type: String, trim: true, required, maxlength: max });
const num = { type: Number, min: 0, default: 0 };
const coordinates = new Schema({ lat: { type: Number, min: -90, max: 90, required: true }, lng: { type: Number, min: -180, max: 180, required: true } }, { _id: false });
const history = new Schema({ acao: str(true), usuario: ref('User'), data: { type: Date, default: Date.now }, detalhe: str(false, 6000) }, { _id: false });
function model(name, fields, indices = []) {
  const schema = new Schema(fields, { timestamps: true, strict: 'throw', optimisticConcurrency: true });
  for (const [keys, options] of indices) schema.index(keys, options);
  return mongoose.models[name] || mongoose.model(name, schema);
}
const User = model('User', {
  nomeCompleto: str(true, 150), email: { ...str(true), lowercase: true, match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ },
  senha: { type: String, required: true, select: false }, cidade: ref('City', true),
  tipoAcesso: { type: String, enum: roles, default: 'Praça' }, perfilSolicitado: { type: String, enum: roles, default: 'Praça' },
  ativo: { type: Boolean, default: false }, guarnicao: ref('Crew'), versaoSessao: num,
  atendimentoAtivo: ref('Occurrence'), excluido: { type: Boolean, default: false }
}, [[{ email: 1 }, { unique: true }], [{ cidade: 1, ativo: 1 }, {}]]);
const City = model('City', { nome: str(true, 120), coordenadas: coordinates, ativo: { type: Boolean, default: true } }, [[{ nome: 1 }, { unique: true }]]);
const Vehicle = model('Vehicle', {
  prefixo: str(true, 30), placa: { ...str(true, 8), uppercase: true, match: /^[A-Z]{3}-?[0-9][A-Z0-9][0-9]{2}$/ }, cidade: ref('City', true),
  quilometragem: num, ultimaRevisao: Date, proximaRevisao: Date, revisaoKm: num,
  status: { type: String, enum: ['Disponível', 'Em operação', 'Em manutenção', 'Indisponível'], default: 'Disponível' },
  ultimoMotorista: ref('User'), guarnicao: ref('Crew'), coordenadas: coordinates, observacoes: str(false, 3000)
}, [[{ placa: 1 }, { unique: true }], [{ prefixo: 1 }, { unique: true }], [{ cidade: 1, status: 1 }, {}]]);
const Crew = model('Crew', {
  nome: str(true, 100), cidade: ref('City', true), viatura: ref('Vehicle'), integrantes: [ref('User')], motorista: ref('User'),
  status: { type: String, enum: ['Disponível', 'Em atendimento', 'Indisponível', 'Fora de serviço'], default: 'Fora de serviço' },
  inicioTurno: Date, fimTurno: Date, ocorrenciaAtiva: ref('Occurrence'), historico: [history]
}, [[{ nome: 1 }, { unique: true }], [{ cidade: 1, status: 1, fimTurno: 1 }, {}]]);
const Occurrence = model('Occurrence', {
  protocolo: { type: String, default: () => `OP-${new Date().getFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}` },
  data: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ }, hora: { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
  cidade: ref('City', true), tipoCrime: str(true, 120), localizacao: str(true, 500), coordenadas: coordinates, descricao: str(true, 12000),
  prioridade: { type: String, enum: ['Alta', 'Média', 'Baixa'], default: 'Média' },
  status: { type: String, enum: ['Em aberto', 'Despachada', 'Em atendimento', 'Encerrada', 'Cancelada'], default: 'Em aberto' },
  criadoPor: ref('User', true), guarnicao: ref('Crew'), guarnicoesRelacionadas: [ref('Crew')], viatura: ref('Vehicle'), responsavel: ref('User'),
  despachadaEm: Date, inicioAtendimento: Date, fimAtendimento: Date, duracaoSegundos: num, resumo: str(false, 6000),
  resultados: { armasApreendidas: num, veiculosRecuperados: num, conduzidos: num, abordagens: num }, historico: [history],
  anexos: [{ nome: str(true), arquivo: str(true), mime: str(true), tamanho: num }],
  apoios: [{ guarnicao: ref('Crew', true), solicitadoPor: ref('User', true), motivo: str(true, 1000), autorizadoPor: ref('User'), status: { type: String, enum: ['Pendente', 'Autorizado', 'Concluído'], default: 'Pendente' }, data: { type: Date, default: Date.now } }],
  excluido: { type: Boolean, default: false }
}, [[{ protocolo: 1 }, { unique: true }], [{ cidade: 1, status: 1, data: -1 }, {}], [{ guarnicoesRelacionadas: 1 }, {}]]);
const Dispatch = model('Dispatch', { ocorrencia: ref('Occurrence', true), guarnicao: ref('Crew', true), usuario: ref('User', true), motivo: str(false, 1000) }, [[{ ocorrencia: 1, createdAt: -1 }, {}]]);
const Attendance = model('Attendance', {
  ocorrencia: ref('Occurrence', true), guarnicao: ref('Crew', true), responsavel: ref('User', true), inicio: { type: Date, required: true }, fim: Date,
  duracaoSegundos: num, resumo: str(false, 6000), observacoes: [history], status: { type: String, enum: ['Em andamento', 'Encerrado'], default: 'Em andamento' }
}, [[{ ocorrencia: 1 }, { unique: true }]]);
const DailyOfficer = model('DailyOfficer', { data: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ }, oficial: ref('User', true), assumiuEm: { type: Date, default: Date.now }, historico: [history] }, [[{ data: 1 }, { unique: true }]]);
const Notification = model('Notification', { usuario: ref('User', true), ocorrencia: ref('Occurrence'), mensagem: str(true, 1000), lida: { type: Boolean, default: false } }, [[{ usuario: 1, lida: 1, createdAt: -1 }, {}]]);
const AuditLog = model('AuditLog', { usuario: ref('User'), acao: str(true), entidade: str(true), entidadeId: String, detalhe: str(false, 6000), ip: String }, [[{ createdAt: -1 }, {}], [{ usuario: 1 }, {}]]);
const SystemSetting = model('SystemSetting', { chave: { type: String, default: 'geral', enum: ['geral'] }, instituicao: { ...str(true), default: '18º BPM · Polícia Militar do Maranhão' }, inatividadeMinutos: { type: Number, min: 1, max: 30, default: 5 }, alertaSegundos: { type: Number, min: 10, max: 600, default: 60 }, som: { type: Boolean, default: true }, tiposCrime: { type: [String], default: ['Furto', 'Roubo', 'Violência doméstica', 'Trânsito', 'Perturbação do sossego', 'Averiguação', 'Outros'] }, modulosDashboard: { type: [String], default: ['Hoje', 'Mês', 'Ano', 'Encerradas', 'Em Aberto', 'Alertas', 'Viaturas', 'Guarnições', 'Cidades', 'Tempo Médio', 'Operações', 'Armas Apreendidas', 'Veículos Recuperados', 'Conduzidos', 'Abordagens', 'CPU'] } }, [[{ chave: 1 }, { unique: true }]]);
const Session = model('Session', { usuario: ref('User', true), jti: str(true), ultimaAtividade: { type: Date, default: Date.now }, expiraEm: { type: Date, required: true }, revogada: { type: Boolean, default: false } }, [[{ jti: 1 }, { unique: true }], [{ expiraEm: 1 }, { expireAfterSeconds: 0 }]]);
module.exports = { User, Occurrence, Dispatch, Attendance, Crew, Vehicle, City, DailyOfficer, Notification, AuditLog, SystemSetting, Session };
