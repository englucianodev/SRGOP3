const mongoose = require('mongoose');
mongoose.set('transactionAsyncLocalStorage', true);
mongoose.set('strictQuery', true);
module.exports = async function connect() {
  if (!process.env.MONGO_URI) throw new Error('Configuração: MONGO_URI não definida.');
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  if (!hello.setName && hello.msg !== 'isdbgrid') throw new Error('MongoDB: configure um replica set para as transações operacionais. Consulte o README.');
  const models = require('../models');
  await Promise.all(Object.values(models).map(model => model.init()));
};
