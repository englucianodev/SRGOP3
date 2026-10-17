const { AuditLog } = require('../models');
module.exports = (req, acao, entidade, id, detalhe = '') => AuditLog.create({ usuario: req.user?._id, acao, entidade, entidadeId: id ? String(id) : undefined, detalhe, ip: req.ip });
