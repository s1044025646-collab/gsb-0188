/** 业务服务层: API 与 CLI 共用 */
import { Gas, TotalState, staticFromTotal, normalShock, solveMachFromArea, Branch } from "./physics";
import { shockFreeProfile, shockedProfile, compareProfiles, ProfileResult } from "./solver";
import { openDb, insertGas, insertGeometry, insertCase, insertSnapshot, getSnapshot, listRows, Db } from "./db";

export class Service {
  private store: Db;
  constructor(dataDir: string) {
    this.store = openDb(dataDir);
  }
  close() { this.store.close(); }
  private get db() { return this.store.db; }

  addGas(name: string, gamma: number, R: number) {
    const id = insertGas(this.db, name, gamma, R);
    return { id, name, gamma, R };
  }
  addGeometry(name: string, throatArea: number, areas: number[]) {
    const id = insertGeometry(this.db, name, throatArea, areas);
    return { id, name, throatArea, areas };
  }
  addCase(gasId: number, geometryId: number, T0: number, p0: number, shockIndex: number | null) {
    const id = insertCase(this.db, gasId, geometryId, T0, p0, shockIndex);
    return { id, gasId, geometryId, T0, p0, shockIndex };
  }
  list(table: "gases" | "geometries" | "cases" | "snapshots") {
    return listRows(this.db, table);
  }

  /** 单状态计算: 总态 + 马赫数 -> 静态度 */
  state(gas: Gas, total: TotalState, M: number) {
    return staticFromTotal(gas, total, M);
  }
  /** 面积-马赫数反解 */
  machFromArea(gas: Gas, areaRatio: number, branch: Branch) {
    return solveMachFromArea(gas, areaRatio, branch);
  }
  /** 正激波 */
  shock(gas: Gas, M1: number) {
    return normalShock(gas, M1);
  }

  /** 剖面计算并保存快照 */
  profile(caseId: number): { snapshotId: number; result: ProfileResult } {
    const c = this.db.prepare("SELECT * FROM cases WHERE id=?").get(caseId) as
      { gas_id: number; geometry_id: number; T0: number; p0: number; shock_index: number | null } | undefined;
    if (!c) throw new Error(`工况 id=${caseId} 不存在`);
    const g = this.db.prepare("SELECT gamma,R FROM gases WHERE id=?").get(c.gas_id) as { gamma: number; R: number };
    const geo = this.db.prepare("SELECT throat_area,areas FROM geometries WHERE id=?").get(c.geometry_id) as
      { throat_area: number; areas: string };
    const gas: Gas = { gamma: g.gamma, R: g.R };
    const total: TotalState = { T0: c.T0, p0: c.p0 };
    const areas = JSON.parse(geo.areas) as number[];
    const result = c.shock_index === null
      ? shockFreeProfile(gas, total, geo.throat_area, areas)
      : shockedProfile(gas, total, geo.throat_area, areas, c.shock_index);
    const snapshotId = insertSnapshot(this.db, caseId, result.kind, result);
    return { snapshotId, result };
  }

  getSnapshot(id: number) {
    const s = getSnapshot(this.db, id);
    if (!s) throw new Error(`快照 id=${id} 不存在`);
    return s;
  }

  /** 比较两个快照(可对应不同几何/总态版本) */
  compare(snapshotIdA: number, snapshotIdB: number) {
    const a = this.getSnapshot(snapshotIdA).result as ProfileResult;
    const b = this.getSnapshot(snapshotIdB).result as ProfileResult;
    return compareProfiles(a, b);
  }
}

/** 剖面 CSV 导出 */
export function profileToCsv(p: ProfileResult): string {
  const head = "index,area,areaRatio,branch,M,T_K,p_Pa,rho_kg_m3,V_m_s,massFlow_kg_s,shockHere,machResidual,machIterations";
  const rows = p.stations.map(s => [
    s.index, s.area, s.areaRatio, s.branch, s.state.M, s.state.T, s.state.p,
    s.state.rho, s.state.V, s.massFlow, s.shockHere ? 1 : 0,
    s.machSolve.residual, s.machSolve.iterations,
  ].join(","));
  return [head, ...rows].join("\n") + "\n";
}
