class AppError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const check = (condition, message, status = 400) => { if (!condition) throw new AppError(status, message); };
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const pick = (data, fields) => Object.fromEntries(fields.filter(k => Object.hasOwn(data, k)).map(k => [k, data[k]]));
const text = (value, name, min = 1) => { check(typeof value === 'string' && value.trim().length >= min, `${name}: informe pelo menos ${min} caracteres.`); return value.trim(); };
const day = (date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Fortaleza', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
module.exports = { AppError, check, wrap, pick, text, day };
