// GENERATED FILE - do not edit by hand.
// Source: schema/tables.json. Regenerate with: node tools/gen-apps-script-schema.mjs
var SCHEMA = {
 "version": 3,
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
  "notification_prefs"
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
      "user_event"
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
  ]
 }
};
