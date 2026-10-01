/** SQLite 持久化层: 气体参数、几何版本、工况、计算快照。使用 Node 内置 node:sqlite。 */
import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";

export interface Db {
  db: DatabaseSync;
  close(): void;
}

export function openDb(dataDir: string): Db {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, "nozzle.db");
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS gases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      gamma REAL NOT NULL,
      R REAL NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS geometries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      throat_area REAL NOT NULL,
      areas TEXT NOT NULL,           -- JSON 数组
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS cases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      gas_id INTEGER NOT NULL REFERENCES gases(id),
      geometry_id INTEGER NOT NULL REFERENCES geometries(id),
      T0 REAL NOT NULL,
      p0 REAL NOT NULL,
      shock_index INTEGER,           -- NULL 表示无激波
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id INTEGER NOT NULL REFERENCES cases(id),
      kind TEXT NOT NULL,
      result TEXT NOT NULL,          -- JSON
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return { db, close: () => db.close() };
}

export function insertGas(db: DatabaseSync, name: string, gamma: number, R: number): number {
  return Number(db.prepare("INSERT INTO gases(name,gamma,R) VALUES(?,?,?)").run(name, gamma, R).lastInsertRowid);
}
export function insertGeometry(db: DatabaseSync, name: string, throatArea: number, areas: number[]): number {
  return Number(db.prepare("INSERT INTO geometries(name,throat_area,areas) VALUES(?,?,?)")
    .run(name, throatArea, JSON.stringify(areas)).lastInsertRowid);
}
export function insertCase(db: DatabaseSync, gasId: number, geomId: number, T0: number, p0: number, shockIndex: number | null): number {
  return Number(db.prepare("INSERT INTO cases(gas_id,geometry_id,T0,p0,shock_index) VALUES(?,?,?,?,?)")
    .run(gasId, geomId, T0, p0, shockIndex).lastInsertRowid);
}
export function insertSnapshot(db: DatabaseSync, caseId: number, kind: string, result: unknown): number {
  return Number(db.prepare("INSERT INTO snapshots(case_id,kind,result) VALUES(?,?,?)")
    .run(caseId, kind, JSON.stringify(result)).lastInsertRowid);
}
export function getSnapshot(db: DatabaseSync, id: number): { id: number; case_id: number; kind: string; result: unknown } | null {
  const row = db.prepare("SELECT id,case_id,kind,result FROM snapshots WHERE id=?").get(id) as
    { id: number; case_id: number; kind: string; result: string } | undefined;
  return row ? { ...row, result: JSON.parse(row.result) } : null;
}
export function listRows(db: DatabaseSync, table: "gases" | "geometries" | "cases" | "snapshots"): unknown[] {
  return db.prepare(`SELECT * FROM ${table} ORDER BY id`).all() as unknown[];
}
