/** Append-only audit log. Callers hold the lock. Never write secrets here. */

function auditEntry_(userId, action, entity, entityId, detail) {
  return {
    at: nowTs_(), user_id: userId || '', action: action, entity: entity || '',
    entity_id: entityId || '', detail: String(detail || '').slice(0, 500)
  };
}

function auditLog_(userId, action, entity, entityId, detail) {
  appendRow_(T.AUDIT, auditEntry_(userId, action, entity, entityId, detail));
}

function auditLogMany_(entries) {
  appendRows_(T.AUDIT, entries);
}
