-- FTS5 index over configs, kept in sync by triggers.
CREATE VIRTUAL TABLE configs_fts USING fts5(
  name,
  summary,
  description,
  content='configs',
  content_rowid='rowid',
  tokenize='porter unicode61 remove_diacritics 2'
);
--> statement-breakpoint
CREATE TRIGGER configs_fts_insert AFTER INSERT ON configs BEGIN
  INSERT INTO configs_fts(rowid, name, summary, description)
  VALUES (new.rowid, new.name, new.summary, new.description_md);
END;
--> statement-breakpoint
CREATE TRIGGER configs_fts_delete AFTER DELETE ON configs BEGIN
  INSERT INTO configs_fts(configs_fts, rowid, name, summary, description)
  VALUES ('delete', old.rowid, old.name, old.summary, old.description_md);
END;
--> statement-breakpoint
CREATE TRIGGER configs_fts_update AFTER UPDATE ON configs BEGIN
  INSERT INTO configs_fts(configs_fts, rowid, name, summary, description)
  VALUES ('delete', old.rowid, old.name, old.summary, old.description_md);
  INSERT INTO configs_fts(rowid, name, summary, description)
  VALUES (new.rowid, new.name, new.summary, new.description_md);
END;
--> statement-breakpoint
INSERT INTO configs_fts(rowid, name, summary, description)
SELECT rowid, name, summary, description_md FROM configs;
