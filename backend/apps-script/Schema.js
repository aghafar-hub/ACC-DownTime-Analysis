// GENERATED FILE - do not edit by hand.
// Source: schema/tables.json. Regenerate with: node tools/gen-apps-script-schema.mjs
var SCHEMA = {
 "version": 6,
 "tableOrder": [
  "lines",
  "areas",
  "equipment",
  "equipment_areas",
  "equipment_aliases",
  "classifications",
  "reasons",
  "upload_batches",
  "events",
  "event_edits",
  "upload_warnings",
  "roles",
  "users",
  "tab_access",
  "settings",
  "audit_log",
  "notifications",
  "notification_state",
  "notification_prefs",
  "actions",
  "action_log",
  "action_tasks",
  "contractors",
  "area_targets",
  "task_templates",
  "task_template_steps",
  "user_activity"
 ],
 "tables": {
  "lines": {
   "description": "Reporting lines taken from the downtime sheet.",
   "key": [
    "line_id"
   ],
   "columns": [
    {
     "name": "line_id",
     "type": "text",
     "required": true
    },
    {
     "name": "name",
     "type": "text",
     "required": true
    },
    {
     "name": "sort_order",
     "type": "int",
     "required": true
    },
    {
     "name": "active",
     "type": "bool",
     "required": true
    }
   ]
  },
  "areas": {
   "description": "Downtime areas (the EQUIPMENT column of the downtime sheet).",
   "key": [
    "area_id"
   ],
   "columns": [
    {
     "name": "area_id",
     "type": "text",
     "required": true
    },
    {
     "name": "name",
     "type": "text",
     "required": true
    },
    {
     "name": "line_id",
     "type": "text",
     "required": true
    },
    {
     "name": "sort_order",
     "type": "int",
     "required": true
    },
    {
     "name": "active",
     "type": "bool",
     "required": true
    },
    {
     "name": "in_downtime_sheet",
     "type": "bool",
     "required": true
    },
    {
     "name": "notes",
     "type": "text",
     "required": false
    }
   ]
  },
  "equipment": {
   "description": "Equipment master. Seeded from the platform master plus codes found in the downtime lists.",
   "key": [
    "equipment_id"
   ],
   "columns": [
    {
     "name": "equipment_id",
     "type": "text",
     "required": true
    },
    {
     "name": "description",
     "type": "text",
     "required": false
    },
    {
     "name": "equipment_type",
     "type": "text",
     "required": false
    },
    {
     "name": "criticality",
     "type": "text",
     "required": false
    },
    {
     "name": "parent_id",
     "type": "text",
     "required": false
    },
    {
     "name": "status",
     "type": "enum",
     "required": true,
     "enum": [
      "Active",
      "Retired"
     ]
    },
    {
     "name": "origin",
     "type": "text",
     "required": false
    },
    {
     "name": "platform_plant_area",
     "type": "text",
     "required": false
    },
    {
     "name": "platform_main_area",
     "type": "text",
     "required": false
    },
    {
     "name": "platform_sub_area",
     "type": "text",
     "required": false
    },
    {
     "name": "needs_review",
     "type": "bool",
     "required": true
    },
    {
     "name": "review_note",
     "type": "text",
     "required": false
    },
    {
     "name": "created_at",
     "type": "timestamp",
     "required": false
    },
    {
     "name": "updated_at",
     "type": "timestamp",
     "required": false
    },
    {
     "name": "updated_by",
     "type": "text",
     "required": false
    }
   ]
  },
  "equipment_areas": {
   "description": "Which areas a code belongs to. A code may belong to several areas.",
   "key": [
    "equipment_id",
    "area_id"
   ],
   "columns": [
    {
     "name": "equipment_id",
     "type": "text",
     "required": true
    },
    {
     "name": "area_id",
     "type": "text",
     "required": true
    }
   ]
  },
  "equipment_aliases": {
   "description": "Typos and retired codes mapped to the canonical code.",
   "key": [
    "alias"
   ],
   "columns": [
    {
     "name": "alias",
     "type": "text",
     "required": true
    },
    {
     "name": "equipment_id",
     "type": "text",
     "required": true
    },
    {
     "name": "reason",
     "type": "text",
     "required": false
    }
   ]
  },
  "classifications": {
   "description": "Stoppage classifications.",
   "key": [
    "code"
   ],
   "columns": [
    {
     "name": "code",
     "type": "text",
     "required": true
    },
    {
     "name": "name",
     "type": "text",
     "required": true
    },
    {
     "name": "is_incident",
     "type": "bool",
     "required": true
    },
    {
     "name": "sort_order",
     "type": "int",
     "required": true
    }
   ]
  },
  "reasons": {
   "description": "Reasons listed per classification, kept exactly as in the downtime value list.",
   "key": [
    "reason_id"
   ],
   "columns": [
    {
     "name": "reason_id",
     "type": "text",
     "required": true
    },
    {
     "name": "classification",
     "type": "text",
     "required": true
    },
    {
     "name": "text_as_listed",
     "type": "text",
     "required": true
    },
    {
     "name": "match_key",
     "type": "text",
     "required": true
    },
    {
     "name": "order_no",
     "type": "int",
     "required": true
    },
    {
     "name": "active",
     "type": "bool",
     "required": true
    }
   ]
  },
  "upload_batches": {
   "description": "One row per upload.",
   "key": [
    "batch_id"
   ],
   "columns": [
    {
     "name": "batch_id",
     "type": "text",
     "required": true
    },
    {
     "name": "uploaded_by",
     "type": "text",
     "required": true
    },
    {
     "name": "uploaded_at",
     "type": "timestamp",
     "required": true
    },
    {
     "name": "file_name",
     "type": "text",
     "required": false
    },
    {
     "name": "file_hash",
     "type": "text",
     "required": false
    },
    {
     "name": "rows_read",
     "type": "int",
     "required": true
    },
    {
     "name": "rows_added",
     "type": "int",
     "required": true
    },
    {
     "name": "rows_identical",
     "type": "int",
     "required": true
    },
    {
     "name": "rows_skipped",
     "type": "int",
     "required": true
    },
    {
     "name": "warning_count",
     "type": "int",
     "required": true
    },
    {
     "name": "status",
     "type": "enum",
     "required": true,
     "enum": [
      "Started",
      "Completed",
      "Failed"
     ]
    }
   ]
  },
  "events": {
   "description": "One row per downtime record (one row of the downtime sheet). Freq, criticality and is_failure are sheet values.",
   "key": [
    "event_id"
   ],
   "columns": [
    {
     "name": "event_id",
     "type": "text",
     "required": true
    },
    {
     "name": "batch_id",
     "type": "text",
     "required": true
    },
    {
     "name": "event_date",
     "type": "date",
     "required": true
    },
    {
     "name": "line_id",
     "type": "text",
     "required": true
    },
    {
     "name": "area_id",
     "type": "text",
     "required": true
    },
    {
     "name": "code_raw",
     "type": "text",
     "required": true
    },
    {
     "name": "equipment_id",
     "type": "text",
     "required": false
    },
    {
     "name": "is_area_level",
     "type": "bool",
     "required": true
    },
    {
     "name": "stop_ts",
     "type": "timestamp",
     "required": true
    },
    {
     "name": "start_ts",
     "type": "timestamp",
     "required": true
    },
    {
     "name": "duration_s",
     "type": "float",
     "required": true
    },
    {
     "name": "freq",
     "type": "int",
     "required": true
    },
    {
     "name": "classification",
     "type": "text",
     "required": true
    },
    {
     "name": "criticality",
     "type": "enum",
     "required": true,
     "enum": [
      "INC",
      "NO_INC"
     ]
    },
    {
     "name": "is_failure",
     "type": "bool",
     "required": true
    },
    {
     "name": "reason_raw",
     "type": "text",
     "required": false
    },
    {
     "name": "reason_id",
     "type": "text",
     "required": false
    },
    {
     "name": "description",
     "type": "text",
     "required": false
    },
    {
     "name": "source_file",
     "type": "text",
     "required": false
    },
    {
     "name": "source_row",
     "type": "int",
     "required": false
    },
    {
     "name": "fingerprint",
     "type": "text",
     "required": true
    },
    {
     "name": "flags",
     "type": "text",
     "required": false
    },
    {
     "name": "edited",
     "type": "bool",
     "required": true
    },
    {
     "name": "is_void",
     "type": "bool",
     "required": true
    },
    {
     "name": "created_at",
     "type": "timestamp",
     "required": true
    },
    {
     "name": "accepted_flags",
     "type": "text",
     "required": false
    },
    {
     "name": "accepted_by",
     "type": "text",
     "required": false
    },
    {
     "name": "accepted_at",
     "type": "timestamp",
     "required": false
    }
   ]
  },
  "event_edits": {
   "description": "One row per changed field when an event is edited or voided in the app. Keeps the original value.",
   "key": [
    "edit_id"
   ],
   "columns": [
    {
     "name": "edit_id",
     "type": "text",
     "required": true
    },
    {
     "name": "event_id",
     "type": "text",
     "required": true
    },
    {
     "name": "edited_at",
     "type": "timestamp",
     "required": true
    },
    {
     "name": "edited_by",
     "type": "text",
     "required": true
    },
    {
     "name": "field",
     "type": "text",
     "required": true
    },
    {
     "name": "old_value",
     "type": "text",
     "required": false
    },
    {
     "name": "new_value",
     "type": "text",
     "required": false
    },
    {
     "name": "note",
     "type": "text",
     "required": false
    }
   ]
  },
  "upload_warnings": {
   "description": "Warnings raised by an upload, with the user's decision.",
   "key": [
    "warning_id"
   ],
   "columns": [
    {
     "name": "warning_id",
     "type": "text",
     "required": true
    },
    {
     "name": "batch_id",
     "type": "text",
     "required": true
    },
    {
     "name": "type",
     "type": "enum",
     "required": true,
     "enum": [
      "late_row",
      "changed_row",
      "missing_row",
      "unknown_code",
      "code_not_in_area",
      "unlisted_reason",
      "blank_reason",
      "end_before_start",
      "duration_mismatch",
      "orphan_continuation",
      "overlap_in_area",
      "placeholder_code",
      "edited_in_app",
      "missing_code",
      "missing_classification",
      "invalid_classification",
      "unknown_area",
      "line_mismatch",
      "late_month"
     ]
    },
    {
     "name": "source_row",
     "type": "int",
     "required": false
    },
    {
     "name": "event_id",
     "type": "text",
     "required": false
    },
    {
     "name": "detail",
     "type": "text",
     "required": false
    },
    {
     "name": "resolution",
     "type": "enum",
     "required": false,
     "enum": [
      "added",
      "skipped",
      "kept_stored",
      "accepted"
     ]
    },
    {
     "name": "resolved_by",
     "type": "text",
     "required": false
    }
   ]
  },
  "roles": {
   "description": "User roles.",
   "key": [
    "role_id"
   ],
   "columns": [
    {
     "name": "role_id",
     "type": "text",
     "required": true
    },
    {
     "name": "name",
     "type": "text",
     "required": true
    },
    {
     "name": "description",
     "type": "text",
     "required": false
    }
   ]
  },
  "users": {
   "description": "App accounts. Created by an admin; empty in the delivered database (the first admin is created by the setup function).",
   "key": [
    "user_id"
   ],
   "columns": [
    {
     "name": "user_id",
     "type": "text",
     "required": true
    },
    {
     "name": "email",
     "type": "text",
     "required": true
    },
    {
     "name": "display_name",
     "type": "text",
     "required": true
    },
    {
     "name": "role_id",
     "type": "text",
     "required": true
    },
    {
     "name": "password_hash",
     "type": "text",
     "required": true
    },
    {
     "name": "password_salt",
     "type": "text",
     "required": true
    },
    {
     "name": "hash_rounds",
     "type": "int",
     "required": true
    },
    {
     "name": "must_change",
     "type": "bool",
     "required": true
    },
    {
     "name": "active",
     "type": "bool",
     "required": true
    },
    {
     "name": "failed_attempts",
     "type": "int",
     "required": true
    },
    {
     "name": "locked_until",
     "type": "timestamp",
     "required": false
    },
    {
     "name": "created_at",
     "type": "timestamp",
     "required": true
    },
    {
     "name": "last_login_at",
     "type": "timestamp",
     "required": false
    },
    {
     "name": "created_by",
     "type": "text",
     "required": false
    }
   ]
  },
  "tab_access": {
   "description": "Tab level per role, with optional per-user overrides. A user override wins over the role.",
   "key": [
    "subject_type",
    "subject_id",
    "tab_id"
   ],
   "columns": [
    {
     "name": "subject_type",
     "type": "enum",
     "required": true,
     "enum": [
      "role",
      "user"
     ]
    },
    {
     "name": "subject_id",
     "type": "text",
     "required": true
    },
    {
     "name": "tab_id",
     "type": "enum",
     "required": true,
     "enum": [
      "overview",
      "pareto",
      "repeats",
      "reliability",
      "reports",
      "actions",
      "events",
      "upload",
      "master",
      "settings",
      "users"
     ]
    },
    {
     "name": "level",
     "type": "enum",
     "required": true,
     "enum": [
      "Hidden",
      "View",
      "Edit"
     ]
    }
   ]
  },
  "settings": {
   "description": "Admin-adjustable settings.",
   "key": [
    "key"
   ],
   "columns": [
    {
     "name": "key",
     "type": "text",
     "required": true
    },
    {
     "name": "value",
     "type": "text",
     "required": false
    },
    {
     "name": "description",
     "type": "text",
     "required": false
    },
    {
     "name": "updated_by",
     "type": "text",
     "required": false
    },
    {
     "name": "updated_at",
     "type": "timestamp",
     "required": false
    }
   ]
  },
  "audit_log": {
   "description": "Append-only log of every change.",
   "key": [],
   "columns": [
    {
     "name": "at",
     "type": "timestamp",
     "required": true
    },
    {
     "name": "user_id",
     "type": "text",
     "required": false
    },
    {
     "name": "action",
     "type": "text",
     "required": true
    },
    {
     "name": "entity",
     "type": "text",
     "required": false
    },
    {
     "name": "entity_id",
     "type": "text",
     "required": false
    },
    {
     "name": "detail",
     "type": "text",
     "required": false
    }
   ]
  },
  "notifications": {
   "description": "Stored alerts and updates (docs/notifications-design.md). Action items are derived live by the app and are never stored. Written by the server only.",
   "key": [
    "notification_id"
   ],
   "columns": [
    {
     "name": "notification_id",
     "type": "text",
     "required": true
    },
    {
     "name": "type",
     "type": "enum",
     "required": true,
     "enum": [
      "long_stop",
      "repeat_group",
      "failure_spike",
      "availability_low",
      "upload_gap",
      "upload_done",
      "user_event",
      "planned_overrun",
      "action_due",
      "action_ready_to_close",
      "task_overdue"
     ]
    },
    {
     "name": "severity",
     "type": "enum",
     "required": true,
     "enum": [
      "alert",
      "update"
     ]
    },
    {
     "name": "dedupe_key",
     "type": "text",
     "required": true
    },
    {
     "name": "title",
     "type": "text",
     "required": true
    },
    {
     "name": "detail",
     "type": "text",
     "required": false
    },
    {
     "name": "area_id",
     "type": "text",
     "required": false
    },
    {
     "name": "line_id",
     "type": "text",
     "required": false
    },
    {
     "name": "source_ref",
     "type": "text",
     "required": false
    },
    {
     "name": "created_at",
     "type": "timestamp",
     "required": true
    },
    {
     "name": "expires_at",
     "type": "timestamp",
     "required": true
    },
    {
     "name": "status",
     "type": "enum",
     "required": true,
     "enum": [
      "open",
      "resolved",
      "expired"
     ]
    },
    {
     "name": "resolved_at",
     "type": "timestamp",
     "required": false
    },
    {
     "name": "recipients",
     "type": "text",
     "required": false
    }
   ]
  },
  "notification_state": {
   "description": "Per user and notification: seen, snoozed or dismissed. One row per user and notification (upsert).",
   "key": [
    "user_id",
    "notification_id"
   ],
   "columns": [
    {
     "name": "user_id",
     "type": "text",
     "required": true
    },
    {
     "name": "notification_id",
     "type": "text",
     "required": true
    },
    {
     "name": "state",
     "type": "enum",
     "required": true,
     "enum": [
      "seen",
      "snoozed",
      "dismissed"
     ]
    },
    {
     "name": "snooze_until",
     "type": "timestamp",
     "required": false
    },
    {
     "name": "updated_at",
     "type": "timestamp",
     "required": true
    }
   ]
  },
  "notification_prefs": {
   "description": "Per user notification preferences. One row per user and key (upsert).",
   "key": [
    "user_id",
    "key"
   ],
   "columns": [
    {
     "name": "user_id",
     "type": "text",
     "required": true
    },
    {
     "name": "key",
     "type": "text",
     "required": true
    },
    {
     "name": "value",
     "type": "text",
     "required": false
    },
    {
     "name": "updated_at",
     "type": "timestamp",
     "required": true
    }
   ]
  },
  "actions": {
   "description": "Improvement actions (docs/actions-design.md). Created by people or drafted by the server rules; one dedupe_key per cause keeps one open action for it.",
   "key": [
    "action_id"
   ],
   "columns": [
    {
     "name": "action_id",
     "type": "text",
     "required": true
    },
    {
     "name": "title",
     "type": "text",
     "required": true
    },
    {
     "name": "detail",
     "type": "text",
     "required": false
    },
    {
     "name": "status",
     "type": "enum",
     "required": true,
     "enum": [
      "Draft",
      "Open",
      "In progress",
      "Closed",
      "Cancelled"
     ]
    },
    {
     "name": "priority",
     "type": "enum",
     "required": true,
     "enum": [
      "High",
      "Medium",
      "Low"
     ]
    },
    {
     "name": "source",
     "type": "enum",
     "required": true,
     "enum": [
      "auto_repeat",
      "auto_chronic",
      "auto_long_stop",
      "auto_planned_overrun",
      "notification",
      "report",
      "pareto",
      "event",
      "manual"
     ]
    },
    {
     "name": "source_ref",
     "type": "text",
     "required": false
    },
    {
     "name": "scope_kind",
     "type": "enum",
     "required": true,
     "enum": [
      "equipment",
      "area",
      "line",
      "plant"
     ]
    },
    {
     "name": "area_id",
     "type": "text",
     "required": false
    },
    {
     "name": "line_id",
     "type": "text",
     "required": false
    },
    {
     "name": "equipment_id",
     "type": "text",
     "required": false
    },
    {
     "name": "reason_key",
     "type": "text",
     "required": false
    },
    {
     "name": "owner_kind",
     "type": "enum",
     "required": true,
     "enum": [
      "contractor",
      "internal"
     ]
    },
    {
     "name": "owner",
     "type": "text",
     "required": false
    },
    {
     "name": "assignee",
     "type": "text",
     "required": false
    },
    {
     "name": "due_date",
     "type": "date",
     "required": false
    },
    {
     "name": "needs_stop",
     "type": "bool",
     "required": false
    },
    {
     "name": "root_cause",
     "type": "enum",
     "required": false,
     "enum": [
      "",
      "PRO",
      "MEC",
      "ELE",
      "AUT",
      "OPR",
      "EXT"
     ]
    },
    {
     "name": "required_action",
     "type": "text",
     "required": false
    },
    {
     "name": "created_by",
     "type": "text",
     "required": true
    },
    {
     "name": "created_at",
     "type": "timestamp",
     "required": true
    },
    {
     "name": "updated_at",
     "type": "timestamp",
     "required": true
    },
    {
     "name": "updated_by",
     "type": "text",
     "required": false
    },
    {
     "name": "closed_by",
     "type": "text",
     "required": false
    },
    {
     "name": "closed_at",
     "type": "timestamp",
     "required": false
    },
    {
     "name": "closure_note",
     "type": "text",
     "required": false
    },
    {
     "name": "effectiveness",
     "type": "enum",
     "required": false,
     "enum": [
      "",
      "Watching",
      "Effective",
      "Not effective"
     ]
    },
    {
     "name": "effectiveness_checked_at",
     "type": "timestamp",
     "required": false
    },
    {
     "name": "evidence",
     "type": "text",
     "required": false
    },
    {
     "name": "dedupe_key",
     "type": "text",
     "required": false
    },
    {
     "name": "template_id",
     "type": "text",
     "required": false
    }
   ]
  },
  "action_log": {
   "description": "History of every action: status changes, comments, edits and added evidence. Append-only.",
   "key": [
    "log_id"
   ],
   "columns": [
    {
     "name": "log_id",
     "type": "text",
     "required": true
    },
    {
     "name": "action_id",
     "type": "text",
     "required": true
    },
    {
     "name": "at",
     "type": "timestamp",
     "required": true
    },
    {
     "name": "by",
     "type": "text",
     "required": true
    },
    {
     "name": "kind",
     "type": "enum",
     "required": true,
     "enum": [
      "status",
      "comment",
      "edit",
      "evidence",
      "task_create",
      "task_status",
      "task_edit",
      "task_note"
     ]
    },
    {
     "name": "from_status",
     "type": "text",
     "required": false
    },
    {
     "name": "to_status",
     "type": "text",
     "required": false
    },
    {
     "name": "text",
     "type": "text",
     "required": false
    },
    {
     "name": "task_id",
     "type": "text",
     "required": false
    }
   ]
  },
  "action_tasks": {
   "description": "1.7.0: the tasks (the work) of an action. Never deleted: a task that is not needed gets the status Not needed.",
   "key": [
    "task_id"
   ],
   "columns": [
    {
     "name": "task_id",
     "type": "text",
     "required": true
    },
    {
     "name": "action_id",
     "type": "text",
     "required": true
    },
    {
     "name": "seq",
     "type": "int",
     "required": true
    },
    {
     "name": "title",
     "type": "text",
     "required": true
    },
    {
     "name": "owner_kind",
     "type": "enum",
     "required": true,
     "enum": [
      "contractor",
      "internal"
     ]
    },
    {
     "name": "owner",
     "type": "text",
     "required": false
    },
    {
     "name": "assignee",
     "type": "text",
     "required": false
    },
    {
     "name": "due_date",
     "type": "date",
     "required": false
    },
    {
     "name": "status",
     "type": "enum",
     "required": true,
     "enum": [
      "Open",
      "Contractor informed",
      "Waiting stoppage",
      "In progress",
      "Done",
      "Not needed"
     ]
    },
    {
     "name": "needs_stop",
     "type": "bool",
     "required": false
    },
    {
     "name": "est_stop_h",
     "type": "float",
     "required": false
    },
    {
     "name": "notes",
     "type": "text",
     "required": false
    },
    {
     "name": "template_step",
     "type": "text",
     "required": false
    },
    {
     "name": "created_at",
     "type": "timestamp",
     "required": true
    },
    {
     "name": "created_by",
     "type": "text",
     "required": true
    },
    {
     "name": "updated_at",
     "type": "timestamp",
     "required": true
    },
    {
     "name": "updated_by",
     "type": "text",
     "required": false
    },
    {
     "name": "done_at",
     "type": "timestamp",
     "required": false
    },
    {
     "name": "done_by",
     "type": "text",
     "required": false
    },
    {
     "name": "done_note",
     "type": "text",
     "required": false
    }
   ]
  },
  "contractors": {
   "description": "External contractors and internal teams that own actions, with the areas each contractor is responsible for.",
   "key": [
    "contractor_id"
   ],
   "columns": [
    {
     "name": "contractor_id",
     "type": "text",
     "required": true
    },
    {
     "name": "name",
     "type": "text",
     "required": true
    },
    {
     "name": "areas",
     "type": "text",
     "required": false
    },
    {
     "name": "kind",
     "type": "enum",
     "required": true,
     "enum": [
      "contractor",
      "internal"
     ]
    },
    {
     "name": "active",
     "type": "bool",
     "required": true
    },
    {
     "name": "sort_order",
     "type": "int",
     "required": true
    },
    {
     "name": "default_assignee",
     "type": "text",
     "required": false
    }
   ]
  },
  "area_targets": {
   "description": "Per area and year: availability target and planned-stop allowance, split into months.",
   "key": [
    "area_id",
    "year"
   ],
   "columns": [
    {
     "name": "area_id",
     "type": "text",
     "required": true
    },
    {
     "name": "year",
     "type": "int",
     "required": true
    },
    {
     "name": "availability_target_pct",
     "type": "float",
     "required": false
    },
    {
     "name": "planned_allowance_h_year",
     "type": "float",
     "required": true
    },
    {
     "name": "monthly_split",
     "type": "text",
     "required": true
    },
    {
     "name": "overhaul_months",
     "type": "text",
     "required": false
    },
    {
     "name": "updated_at",
     "type": "timestamp",
     "required": false
    },
    {
     "name": "updated_by",
     "type": "text",
     "required": false
    }
   ]
  },
  "task_templates": {
   "description": "1.7.0: ready-made task lists picked when an action is created; an auto draft gets the active template that applies to its rule.",
   "key": [
    "template_id"
   ],
   "columns": [
    {
     "name": "template_id",
     "type": "text",
     "required": true
    },
    {
     "name": "name",
     "type": "text",
     "required": true
    },
    {
     "name": "applies_to",
     "type": "text",
     "required": false
    },
    {
     "name": "active",
     "type": "bool",
     "required": true
    },
    {
     "name": "sort_order",
     "type": "int",
     "required": true
    },
    {
     "name": "updated_at",
     "type": "timestamp",
     "required": false
    },
    {
     "name": "updated_by",
     "type": "text",
     "required": false
    }
   ]
  },
  "task_template_steps": {
   "description": "1.7.0: the steps (tasks) of each task template, in order. Saving a template replaces all its steps.",
   "key": [
    "template_id",
    "seq"
   ],
   "columns": [
    {
     "name": "template_id",
     "type": "text",
     "required": true
    },
    {
     "name": "seq",
     "type": "int",
     "required": true
    },
    {
     "name": "title",
     "type": "text",
     "required": true
    },
    {
     "name": "default_owner",
     "type": "text",
     "required": true
    },
    {
     "name": "due_offset_days",
     "type": "int",
     "required": true
    },
    {
     "name": "needs_stop",
     "type": "bool",
     "required": false
    },
    {
     "name": "est_stop_h",
     "type": "float",
     "required": false
    }
   ]
  },
  "user_activity": {
   "description": "Who used the app and when (1.6.0): one row per user, upserted by the server at most once every 3 minutes per user. Shown to Admins in Settings > Active users.",
   "key": [
    "user_id"
   ],
   "columns": [
    {
     "name": "user_id",
     "type": "text",
     "required": true
    },
    {
     "name": "last_seen_at",
     "type": "timestamp",
     "required": true
    },
    {
     "name": "last_page",
     "type": "text",
     "required": false
    },
    {
     "name": "device",
     "type": "enum",
     "required": false,
     "enum": [
      "phone",
      "desktop"
     ]
    },
    {
     "name": "updated_at",
     "type": "timestamp",
     "required": true
    }
   ]
  }
 },
 "seeds": {
  "settings": [
   {
    "key": "availability_basis",
    "value": "B",
    "description": "A calendar; B calendar minus planned (headline); C minus planned and circumstantial"
   },
   {
    "key": "scheduled_hours_per_day",
    "value": "24",
    "description": "Scheduled hours per area per day"
   },
   {
    "key": "scheduled_days_per_week",
    "value": "7",
    "description": "Scheduled days per week"
   },
   {
    "key": "repeat_min_events",
    "value": "2",
    "description": "Failure events needed to flag a repeated failure"
   },
   {
    "key": "repeat_window_days",
    "value": "30",
    "description": "Window for repeated failures, in days"
   },
   {
    "key": "duration_short_max_min",
    "value": "30",
    "description": "Stops up to this many minutes are Short"
   },
   {
    "key": "duration_long_min_min",
    "value": "120",
    "description": "Stops from this many minutes are Long"
   },
   {
    "key": "availability_target_pct",
    "value": "",
    "description": "Availability target, percent; blank = none"
   },
   {
    "key": "default_comparison",
    "value": "previous_period",
    "description": "previous_period | same_period_last_year"
   },
   {
    "key": "lockout_attempts",
    "value": "5",
    "description": "Failed sign-ins before a temporary lock"
   },
   {
    "key": "lockout_minutes",
    "value": "15",
    "description": "Length of the temporary lock"
   },
   {
    "key": "session_hours",
    "value": "12",
    "description": "Session length without 'Keep me signed in'"
   },
   {
    "key": "session_hours_keep",
    "value": "720",
    "description": "Session length with 'Keep me signed in'"
   },
   {
    "key": "min_password_length",
    "value": "10",
    "description": "Minimum password length"
   },
   {
    "key": "notif_long_stop_hours",
    "value": "8",
    "description": "A failure event longer than this many hours raises an alert"
   },
   {
    "key": "notif_spike_pct",
    "value": "30",
    "description": "Failures in the last 30 days of data up by more than this percent on the 30 days before (and at least 5 now) raise an alert"
   },
   {
    "key": "notif_upload_gap_days",
    "value": "35",
    "description": "Latest stored event older than this many days raises 'No upload since'"
   },
   {
    "key": "notif_repeat_alert",
    "value": "true",
    "description": "true | false. A new repeated-failure group raises an alert"
   },
   {
    "key": "notif_retention_days",
    "value": "30",
    "description": "Alerts and updates expire after this many days"
   },
   {
    "key": "app_url",
    "value": "",
    "description": "Web address of the app, used for the link in digest emails; blank = no link"
   },
   {
    "key": "target_mtbf_h",
    "value": "",
    "description": "MTBF target, hours (above 0, up to 100000); blank = no target"
   },
   {
    "key": "target_mttr_h",
    "value": "",
    "description": "MTTR target, hours (above 0, up to 100000); blank = no target"
   },
   {
    "key": "actions_closers",
    "value": "",
    "description": "Comma-separated user ids who may close or cancel actions (Admins always can)"
   },
   {
    "key": "actions_repeat_n",
    "value": "3",
    "description": "Repeated-failure draft: this many failure events of the same equipment and reason ..."
   },
   {
    "key": "actions_repeat_days",
    "value": "30",
    "description": "... within this many days"
   },
   {
    "key": "actions_chronic_top",
    "value": "10",
    "description": "Chronic-equipment draft: in the top this many equipment by failure hours ..."
   },
   {
    "key": "actions_chronic_months",
    "value": "3",
    "description": "... for this many complete months in a row"
   },
   {
    "key": "actions_effect_days",
    "value": "60",
    "description": "Effectiveness check: days watched after closing (compared with the same number of days before)"
   },
   {
    "key": "actions_auto_draft",
    "value": "true",
    "description": "true | false. The server rules create Draft actions"
   }
  ],
  "roles": [
   {
    "role_id": "ROLE-ADMIN",
    "name": "Admin",
    "description": "Everything, including users and settings"
   },
   {
    "role_id": "ROLE-MGR",
    "name": "Manager",
    "description": "Views dashboards and master data"
   },
   {
    "role_id": "ROLE-ENG",
    "name": "Engineer",
    "description": "Uploads data, edits events and master data"
   },
   {
    "role_id": "ROLE-VIEW",
    "name": "Viewer",
    "description": "Views dashboards; never edits"
   }
  ],
  "tabAccess": {
   "ROLE-ADMIN": {
    "overview": "Edit",
    "pareto": "Edit",
    "repeats": "Edit",
    "reliability": "Edit",
    "reports": "Edit",
    "actions": "Edit",
    "events": "Edit",
    "upload": "Edit",
    "master": "Edit",
    "settings": "Edit",
    "users": "Edit"
   },
   "ROLE-MGR": {
    "overview": "View",
    "pareto": "View",
    "repeats": "View",
    "reliability": "View",
    "reports": "Edit",
    "actions": "Edit",
    "events": "View",
    "upload": "Hidden",
    "master": "View",
    "settings": "Hidden",
    "users": "Hidden"
   },
   "ROLE-ENG": {
    "overview": "View",
    "pareto": "View",
    "repeats": "View",
    "reliability": "View",
    "reports": "View",
    "actions": "Edit",
    "events": "Edit",
    "upload": "Edit",
    "master": "Edit",
    "settings": "Hidden",
    "users": "Hidden"
   },
   "ROLE-VIEW": {
    "overview": "View",
    "pareto": "View",
    "repeats": "View",
    "reliability": "View",
    "reports": "View",
    "actions": "View",
    "events": "View",
    "upload": "Hidden",
    "master": "Hidden",
    "settings": "Hidden",
    "users": "Hidden"
   }
  },
  "classifications": [
   {
    "code": "PRO",
    "name": "Production",
    "is_incident": true,
    "sort_order": 1
   },
   {
    "code": "MEC",
    "name": "Mechanical",
    "is_incident": true,
    "sort_order": 2
   },
   {
    "code": "ELE",
    "name": "Electrical",
    "is_incident": true,
    "sort_order": 3
   },
   {
    "code": "AUT",
    "name": "Automation",
    "is_incident": true,
    "sort_order": 4
   },
   {
    "code": "PL",
    "name": "Planned",
    "is_incident": false,
    "sort_order": 5
   },
   {
    "code": "CIR",
    "name": "Circumstantial",
    "is_incident": false,
    "sort_order": 6
   }
  ],
  "lines": [
   {
    "line_id": "L.1",
    "name": "Line 1",
    "sort_order": 1,
    "active": true
   },
   {
    "line_id": "L.2",
    "name": "Line 2",
    "sort_order": 2,
    "active": true
   }
  ],
  "areas": [
   {
    "area_id": "CR",
    "name": "Crusher",
    "line_id": "L.1",
    "sort_order": 1,
    "in_downtime_sheet": true
   },
   {
    "area_id": "RM.1",
    "name": "Raw Mill 1",
    "line_id": "L.1",
    "sort_order": 2,
    "in_downtime_sheet": true
   },
   {
    "area_id": "K.1",
    "name": "Kiln 1",
    "line_id": "L.1",
    "sort_order": 3,
    "in_downtime_sheet": true
   },
   {
    "area_id": "FM.1",
    "name": "Coal (fuel) Mill 1",
    "line_id": "L.1",
    "sort_order": 4,
    "in_downtime_sheet": true,
    "notes": "Name to be confirmed"
   },
   {
    "area_id": "HD",
    "name": "Hot Disc",
    "line_id": "L.1",
    "sort_order": 5,
    "in_downtime_sheet": true
   },
   {
    "area_id": "CM.1",
    "name": "Cement Mill 1",
    "line_id": "L.1",
    "sort_order": 6,
    "in_downtime_sheet": true
   },
   {
    "area_id": "CM.2",
    "name": "Cement Mill 2",
    "line_id": "L.1",
    "sort_order": 7,
    "in_downtime_sheet": true
   },
   {
    "area_id": "PK.1",
    "name": "Packing 1",
    "line_id": "L.1",
    "sort_order": 8,
    "in_downtime_sheet": false
   },
   {
    "area_id": "HY.1",
    "name": "Hydrogen (Line 1)",
    "line_id": "L.1",
    "sort_order": 9,
    "in_downtime_sheet": false
   },
   {
    "area_id": "RM.2",
    "name": "Raw Mill 2",
    "line_id": "L.2",
    "sort_order": 10,
    "in_downtime_sheet": true
   },
   {
    "area_id": "K.2",
    "name": "Kiln 2",
    "line_id": "L.2",
    "sort_order": 11,
    "in_downtime_sheet": true
   },
   {
    "area_id": "FM.2",
    "name": "Coal (fuel) Mill 2",
    "line_id": "L.2",
    "sort_order": 12,
    "in_downtime_sheet": true,
    "notes": "Name to be confirmed"
   },
   {
    "area_id": "AFR",
    "name": "AFR (old system)",
    "line_id": "L.2",
    "sort_order": 13,
    "in_downtime_sheet": true
   },
   {
    "area_id": "AFR new",
    "name": "AFR (new system)",
    "line_id": "L.2",
    "sort_order": 14,
    "in_downtime_sheet": true,
    "notes": "Equipment list to be supplied"
   },
   {
    "area_id": "SHR",
    "name": "AF Shredding",
    "line_id": "L.2",
    "sort_order": 15,
    "in_downtime_sheet": true
   },
   {
    "area_id": "CM.3",
    "name": "Cement Mill 3",
    "line_id": "L.2",
    "sort_order": 16,
    "in_downtime_sheet": true
   },
   {
    "area_id": "CM.4",
    "name": "Cement Mill 4",
    "line_id": "L.2",
    "sort_order": 17,
    "in_downtime_sheet": true
   },
   {
    "area_id": "PK.2",
    "name": "Packing 2",
    "line_id": "L.2",
    "sort_order": 18,
    "in_downtime_sheet": false
   },
   {
    "area_id": "HY.2",
    "name": "Hydrogen (Line 2)",
    "line_id": "L.2",
    "sort_order": 19,
    "in_downtime_sheet": false
   }
  ],
  "contractors": [
   {
    "contractor_id": "RHI",
    "name": "RHI",
    "areas": "CR,RM.1,RM.2,K.1,K.2,HD,AFR,AFR new,SHR,FM.1,FM.2,HY.1,HY.2",
    "kind": "contractor",
    "active": true,
    "sort_order": 1,
    "default_assignee": ""
   },
   {
    "contractor_id": "ASEC",
    "name": "ASEC",
    "areas": "CM.1,CM.2,CM.3,CM.4,PK.1,PK.2",
    "kind": "contractor",
    "active": true,
    "sort_order": 2,
    "default_assignee": ""
   },
   {
    "contractor_id": "MEC",
    "name": "Mechanical",
    "areas": "",
    "kind": "internal",
    "active": true,
    "sort_order": 3,
    "default_assignee": ""
   },
   {
    "contractor_id": "ELE",
    "name": "Electrical",
    "areas": "",
    "kind": "internal",
    "active": true,
    "sort_order": 4,
    "default_assignee": ""
   },
   {
    "contractor_id": "AUT",
    "name": "Automation",
    "areas": "",
    "kind": "internal",
    "active": true,
    "sort_order": 5,
    "default_assignee": ""
   },
   {
    "contractor_id": "PRO",
    "name": "Production",
    "areas": "",
    "kind": "internal",
    "active": true,
    "sort_order": 6,
    "default_assignee": ""
   }
  ],
  "taskTemplates": [
   {
    "template_id": "TT-REPEAT",
    "name": "Repeated failure",
    "applies_to": "auto_repeat,auto_chronic",
    "active": true,
    "sort_order": 1,
    "steps": [
     {
      "title": "Repair",
      "default_owner": "area_contractor",
      "due_offset_days": 2,
      "needs_stop": true,
      "est_stop_h": null
     },
     {
      "title": "Root cause (5-why)",
      "default_owner": "MEC",
      "due_offset_days": 7,
      "needs_stop": false,
      "est_stop_h": null
     },
     {
      "title": "Corrective action",
      "default_owner": "area_contractor",
      "due_offset_days": 21,
      "needs_stop": true,
      "est_stop_h": null
     },
     {
      "title": "Spare parts",
      "default_owner": "MEC",
      "due_offset_days": 14,
      "needs_stop": false,
      "est_stop_h": null
     }
    ]
   },
   {
    "template_id": "TT-LONGSTOP",
    "name": "Long stop",
    "applies_to": "auto_long_stop",
    "active": true,
    "sort_order": 2,
    "steps": [
     {
      "title": "Restore and report",
      "default_owner": "area_contractor",
      "due_offset_days": 1,
      "needs_stop": false,
      "est_stop_h": null
     },
     {
      "title": "Root cause (5-why)",
      "default_owner": "MEC",
      "due_offset_days": 7,
      "needs_stop": false,
      "est_stop_h": null
     },
     {
      "title": "Corrective action",
      "default_owner": "area_contractor",
      "due_offset_days": 21,
      "needs_stop": true,
      "est_stop_h": null
     }
    ]
   },
   {
    "template_id": "TT-PLANNED",
    "name": "Planned overrun",
    "applies_to": "auto_planned_overrun",
    "active": true,
    "sort_order": 3,
    "steps": [
     {
      "title": "Review planned work",
      "default_owner": "PRO",
      "due_offset_days": 7,
      "needs_stop": false,
      "est_stop_h": null
     },
     {
      "title": "Adjust allowance or plan",
      "default_owner": "PRO",
      "due_offset_days": 14,
      "needs_stop": false,
      "est_stop_h": null
     }
    ]
   }
  ]
 }
};
