import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";

export class Store {
  db: DatabaseSync;
  constructor(dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(path.join(dataDir, "nozzle.db"));
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS gases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        gamma REAL NOT NULL, R REAL NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS geometries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL, version INTEGER NOT NULL,
        throat_area REAL NOT NULL,
        downstream_areas TEXT NOT NULL,  -- JSON array
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS cases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        gas_id INTEGER NOT NULL REFERENCES gases(id),
        geom_id INTEGER NOT NULL REFERENCES geometries(id),
        T0 REAL NOT NULL, p0 REAL NOT NULL,
        shock_at_index INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        case_id INTEGER REFERENCES cases(id),
        kind TEXT NOT NULL,           -- state | profile | compare
        payload TEXT NOT NULL,        -- JSON
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }
  close() { this.db.close(); }

  addGas(name: string, gamma: number, R: number) {
    const r = this.db.prepare("INSERT INTO gases(name,gamma,R) VALUES(?,?,?)").run(name, gamma, R);
    return Number(r.lastInsertRowid);
  }
  listGases() { return this.db.prepare("SELECT * FROM gases ORDER BY id").all(); }
  getGas(id: number) { return this.db.prepare("SELECT * FROM gases WHERE id=?").get(id) as any; }

  addGeometry(name: string, version: number, throatArea: number, downstreamAreas: number[]) {
    const r = this.db.prepare("INSERT INTO geometries(name,version,throat_area,downstream_areas) VALUES(?,?,?,?)")
      .run(name, version, throatArea, JSON.stringify(downstreamAreas));
    return Number(r.lastInsertRowid);
  }
  listGeometries() { return this.db.prepare("SELECT * FROM geometries ORDER BY id").all(); }
  getGeometry(id: number) { return this.db.prepare("SELECT * FROM geometries WHERE id=?").get(id) as any; }

  addCase(name: string, gasId: number, geomId: number, T0: number, p0: number, shockAtIndex: number | null) {
    const r = this.db.prepare("INSERT INTO cases(name,gas_id,geom_id,T0,p0,shock_at_index) VALUES(?,?,?,?,?,?)")
      .run(name, gasId, geomId, T0, p0, shockAtIndex);
    return Number(r.lastInsertRowid);
  }
  listCases() { return this.db.prepare("SELECT * FROM cases ORDER BY id").all(); }
  getCase(id: number) { return this.db.prepare("SELECT * FROM cases WHERE id=?").get(id) as any; }

  addSnapshot(caseId: number | null, kind: string, payload: unknown) {
    const r = this.db.prepare("INSERT INTO snapshots(case_id,kind,payload) VALUES(?,?,?)")
      .run(caseId, kind, JSON.stringify(payload));
    return Number(r.lastInsertRowid);
  }
  getSnapshot(id: number) { return this.db.prepare("SELECT * FROM snapshots WHERE id=?").get(id) as any; }
  listSnapshots() { return this.db.prepare("SELECT id,case_id,kind,created_at FROM snapshots ORDER BY id").all(); }
}
