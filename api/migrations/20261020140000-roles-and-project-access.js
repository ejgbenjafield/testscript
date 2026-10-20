'use strict';

const fs = require('fs');
const path = require('path');

function sql(name) {
  return fs.readFileSync(path.join(__dirname, 'sqls', name), 'utf8');
}

exports.up = function (db) {
  return db.runSql(sql('20261020140000-roles-and-project-access-up.sql'));
};

exports.down = function (db) {
  return db.runSql(sql('20261020140000-roles-and-project-access-down.sql'));
};

exports._meta = { version: 1 };
