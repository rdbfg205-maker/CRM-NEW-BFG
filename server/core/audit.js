'use strict';
const { get } = require('../db/db');
const { nowIso } = require('../lib/util');
function audit(user, entity, entityId, action, oldValue = null, newValue = null, ip = '') {
  const d = get();
  d.prepare('INSERT INTO audit_logs(user_id, username, entity, entity_id, action, old_value, new_value, ip, at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(
      user ? user.id : null,
      user ? user.username : 'system',
      entity, entityId || 0, action,
      oldValue ? JSON.stringify(oldValue) : null,
      newValue ? JSON.stringify(newValue) : null,
      ip || '', nowIso()
    );
}
module.exports = { audit };
