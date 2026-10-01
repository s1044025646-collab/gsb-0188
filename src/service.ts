import { Store } from "./db";
import { assertGas, Gas, stateFromTotal, normalShock, machFromAreaRatio, Branch } from "./gas";
import { buildProfile, ProfileResult } from "./profile";
import { compareProfiles } from "./compare";

export interface ServiceOptions { dataDir: string; }

export class Service {
  store: Store;
  constructor(opts: ServiceOptions) { this.store = new Store(opts.dataDir); }
  close() { this.store.close(); }

  addGas(name: string, gamma: number, R: number) {
    assertGas({ gamma, R });
    return { id: this.store.addGas(name, gamma, R) };
  }
  addGeometry(name: string, version: number, throatArea: number, downstreamAreas: number[]) {
    if (!(throatArea > 0)) throw new Error("喉部面积必须为正值");
    if (!Array.isArray(downstreamAreas) || downstreamAreas.length === 0) throw new Error("下游截面列表不能为空");
    return { id: this.store.addGeometry(name, version, throatArea, downstreamAreas) };
  }
  addCase(name: string, gasId: number, geomId: number, T0: number, p0: number, shockAtIndex?: number) {
    if (!this.store.getGas(gasId)) throw new Error(`气体 ${gasId} 不存在`);
    if (!this.store.getGeometry(geomId)) throw new Error(`几何 ${geomId} 不存在`);
    if (!(T0 > 0) || !(p0 > 0)) throw new Error("总温总压必须为正值（绝对单位）");
    return { id: this.store.addCase(name, gasId, geomId, T0, p0, shockAtIndex ?? null) };
  }

  /** 单状态计算：总态 + 马赫数 → 静态量；或面积比反解。 */
  calcState(gasId: number, T0: number, p0: number, opts: { M?: number; AR?: number; branch?: Branch; A?: number }) {
    const g = this.mustGas(gasId);
    let M: number, diag;
    if (opts.AR !== undefined) {
      const r = machFromAreaRatio(g, opts.AR, opts.branch);
      M = r.M; diag = r.diag;
    } else if (opts.M !== undefined) {
      M = opts.M; diag = { iterations: 0, residual: 0, converged: true, method: "direct" };
    } else throw new Error("必须提供 M 或 AR 之一");
    const state = stateFromTotal(g, T0, p0, M, opts.A);
    const payload = { gas: g, state, diag };
    const id = this.store.addSnapshot(null, "state", payload);
    return { snapshotId: id, ...payload };
  }

  calcShock(gasId: number, M1: number) {
    const g = this.mustGas(gasId);
    const rel = normalShock(g, M1);
    const id = this.store.addSnapshot(null, "state", { gas: g, shock: rel });
    return { snapshotId: id, gas: g, shock: rel };
  }

  runCase(caseId: number): { snapshotId: number; profile: ProfileResult; totals: { T0: number; p0: number } } {
    const c = this.store.getCase(caseId);
    if (!c) throw new Error(`工况 ${caseId} 不存在`);
    const g = this.mustGas(c.gas_id);
    const geom = this.store.getGeometry(c.geom_id);
    const areas: number[] = JSON.parse(geom.downstream_areas);
    const profile = buildProfile(g, c.T0, c.p0, geom.throat_area, areas,
      c.shock_at_index === null ? undefined : c.shock_at_index);
    const payload = { caseId, gas: g, geometry: { ...geom, downstream_areas: areas }, totals: { T0: c.T0, p0: c.p0 }, profile };
    const id = this.store.addSnapshot(caseId, "profile", payload);
    return { snapshotId: id, profile, totals: { T0: c.T0, p0: c.p0 } };
  }

  compareSnapshots(idA: number, idB: number) {
    const sa = this.store.getSnapshot(idA), sb = this.store.getSnapshot(idB);
    if (!sa || !sb) throw new Error("快照不存在");
    const pa = JSON.parse(sa.payload), pb = JSON.parse(sb.payload);
    if (!pa.profile || !pb.profile) throw new Error("两个快照都必须是 profile 类型");
    const result = compareProfiles(pa.profile, pb.profile, pa.totals, pb.totals);
    const id = this.store.addSnapshot(null, "compare", { a: idA, b: idB, result });
    return { snapshotId: id, result };
  }

  getSnapshot(id: number) {
    const s = this.store.getSnapshot(id);
    if (!s) throw new Error(`快照 ${id} 不存在`);
    return { ...s, payload: JSON.parse(s.payload) };
  }

  private mustGas(id: number): Gas {
    const row = this.store.getGas(id);
    if (!row) throw new Error(`气体 ${id} 不存在`);
    const g = { gamma: row.gamma, R: row.R };
    assertGas(g);
    return g;
  }
}

/** 快照导出为 CSV（profile：逐截面；compare：逐行）。 */
export function snapshotToCsv(snap: { kind: string; payload: any }): string {
  const p = snap.payload;
  if (p.profile) {
    const lines = ["index,A,AR,branch,M,T(K),p(Pa),rho(kg/m3),V(m/s),mdot(kg/s),residual,iterations"];
    for (const s of p.profile.sections) {
      lines.push([s.index, s.A, s.AR, s.branch, s.M, s.T, s.p, s.rho, s.V, s.mdot, s.diag.residual, s.diag.iterations].join(","));
    }
    return lines.join("\n") + "\n";
  }
  if (p.result?.rows) {
    const lines = ["index,A1,A2,M1,M2,p1,p2,mdot1,mdot2,mdotRelErr"];
    for (const r of p.result.rows) {
      lines.push([r.index, r.A1, r.A2, r.M1 ?? "", r.M2 ?? "", r.p1 ?? "", r.p2 ?? "", r.mdot1 ?? "", r.mdot2 ?? "", r.mdotRelErr ?? ""].join(","));
    }
    return lines.join("\n") + "\n";
  }
  if (p.state) {
    const s = p.state;
    return "M,T(K),p(Pa),rho(kg/m3),V(m/s),mdot(kg/s)\n" + [s.M, s.T, s.p, s.rho, s.V, s.mdot ?? ""].join(",") + "\n";
  }
  return JSON.stringify(p, null, 2) + "\n";
}
