'use strict';

const fs = require('fs');
const path = require('path');

function sql(name) {
  return fs.readFileSync(path.join(__dirname, 'sqls', name), 'utf8');
}

exports.up = function (db) {
  return db.runSql(sql('20261020170000-test-types-up.sql'));
};

exports.down = function (db) {
  return db.runSql(sql('20261020170000-test-types-down.sql'));
};

exports._meta = { version: 1 };
