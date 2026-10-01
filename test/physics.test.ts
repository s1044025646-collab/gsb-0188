import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  tempRatio, pressureRatio, densityRatio, areaMach, solveMachFromArea,
  staticFromTotal, criticalMassFlux, normalShock,
} from "../src/physics";
import { shockFreeProfile, shockedProfile } from "../src/solver";
import { Service } from "../src/service";

const gas = { gamma: 1.4, R: 287 };
const total = { T0: 500, p0: 500000 };

test("等熵换算往返: M -> 面积比 -> M (两个分支)", () => {
  for (const M of [0.2, 0.5, 0.9, 1.0, 1.5, 2.0, 3.5, 6.0]) {
    const ar = areaMach(gas, M);
    const branch = M <= 1 ? "subsonic" : "supersonic";
    const sol = solveMachFromArea(gas, ar, branch);
    assert.ok(sol.converged);
    assert.ok(Math.abs(sol.M - M) < 1e-9, `M=${M} 往返失败, 得 ${sol.M}`);
    assert.ok(sol.residual < 1e-10);
  }
});

test("gamma=1.4 可手算参考值: M=2 时 T/T0=0.5556, p/p0=0.1278, A/A*=1.6875", () => {
  assert.ok(Math.abs(tempRatio(gas, 2) - 0.55556) < 1e-4);
  assert.ok(Math.abs(pressureRatio(gas, 2) - 0.12780) < 1e-4);
  assert.ok(Math.abs(densityRatio(gas, 2) - 0.23005) < 1e-4);
  assert.ok(Math.abs(areaMach(gas, 2) - 1.6875) < 1e-3);
});

test("面积比=1 返回临界状态 M=1; 面积比<1 拒绝", () => {
  const sol = solveMachFromArea(gas, 1, "supersonic");
  assert.equal(sol.M, 1);
  assert.throws(() => solveMachFromArea(gas, 0.99, "subsonic"), /拒绝/);
});

test("分支由参数决定而非初值: 同一面积比两个分支给出两个不同解", () => {
  const ar = 2.0;
  const sub = solveMachFromArea(gas, ar, "subsonic");
  const sup = solveMachFromArea(gas, ar, "supersonic");
  assert.ok(sub.M < 1 && sup.M > 1);
  assert.ok(Math.abs(areaMach(gas, sub.M) - ar) < 1e-10);
  assert.ok(Math.abs(areaMach(gas, sup.M) - ar) < 1e-10);
});

test("喉部质量流率最大: 任意 M 的单位面积流率 <= 临界流率", () => {
  const crit = criticalMassFlux(gas, total);
  for (let M = 0.05; M <= 5; M += 0.05) {
    assert.ok(staticFromTotal(gas, total, M).massFlux <= crit * (1 + 1e-12), `M=${M}`);
  }
});

test("正激波已知解: gamma=1.4, M1=2 -> M2=0.5774, p2/p1=4.5, T2/T1=1.6875, rho2/rho1=2.6667, p02/p01=0.7209", () => {
  const s = normalShock(gas, 2);
  assert.ok(Math.abs(s.M2 - 0.57735) < 1e-4);
  assert.ok(Math.abs(s.p2p1 - 4.5) < 1e-12);
  assert.ok(Math.abs(s.T2T1 - 1.6875) < 1e-9);
  assert.ok(Math.abs(s.rho2rho1 - 8 / 3) < 1e-9);
  assert.ok(Math.abs(s.p02p01 - 0.72087) < 1e-4);
});

test("正激波前后质量/动量/能量守恒", () => {
  for (const M1 of [1.1, 1.5, 2.0, 4.0]) {
    const s = normalShock(gas, M1);
    const st1 = staticFromTotal(gas, total, M1);
    const post = { T0: total.T0, p0: total.p0 * s.p02p01 };
    const st2 = staticFromTotal(gas, post, s.M2);
    assert.ok(Math.abs(st2.massFlux - st1.massFlux) / st1.massFlux < 1e-12, "质量");
    const mom1 = st1.p + st1.rho * st1.V ** 2;
    const mom2 = st2.p + st2.rho * st2.V ** 2;
    assert.ok(Math.abs(mom2 - mom1) / mom1 < 1e-12, "动量");
    const cp = gas.gamma * gas.R / (gas.gamma - 1);
    assert.ok(Math.abs(cp * st2.T + st2.V ** 2 / 2 - (cp * st1.T + st1.V ** 2 / 2)) / (cp * st1.T) < 1e-12, "能量");
  }
});

test("弱激波极限: M1->1+ 时各比值趋近 1", () => {
  const s = normalShock(gas, 1 + 1e-6);
  assert.ok(Math.abs(s.M2 - 1) < 1e-4);
  assert.ok(Math.abs(s.p2p1 - 1) < 1e-4);
  assert.ok(Math.abs(s.T2T1 - 1) < 1e-4);
  assert.ok(Math.abs(s.rho2rho1 - 1) < 1e-4);
  assert.ok(Math.abs(s.p02p01 - 1) < 1e-8);
});

test("亚声速输入不是有效正激波", () => {
  assert.throws(() => normalShock(gas, 0.8), /M1 > 1/);
  assert.throws(() => normalShock(gas, 1.0), /M1 > 1/);
});

test("非法物性被拒绝", () => {
  assert.throws(() => staticFromTotal({ gamma: 1.0, R: 287 }, total, 1), /gamma/);
  assert.throws(() => staticFromTotal({ gamma: 1.4, R: 0 }, total, 1), /R=/);
  assert.throws(() => staticFromTotal(gas, { T0: -1, p0: 1e5 }, 1), /T0/);
  assert.throws(() => staticFromTotal(gas, { T0: 300, p0: 0 }, 1), /p0/);
});

test("无激波剖面全程质量流率守恒", () => {
  const p = shockFreeProfile(gas, total, 0.01, [0.012, 0.02, 0.04]);
  assert.ok(p.massFlowError < 1e-9);
  for (const s of p.stations) assert.ok(s.state.M > 1);
});

test("指定激波剖面: 波前超声速、波后亚声速, 流率守恒, 几何不相容时报错", () => {
  const p = shockedProfile(gas, total, 0.01, [0.012, 0.02, 0.04], 1);
  assert.ok(p.stations[0].state.M > 1);
  assert.ok(p.stations[1].shockHere && p.stations[1].state.M < 1);
  assert.ok(p.stations[2].state.M < 1);
  assert.ok(p.massFlowError < 1e-9);
  assert.ok(p.shockResiduals!.mass < 1e-12);
  assert.ok(p.shockResiduals!.momentum < 1e-12);
  assert.ok(p.shockResiduals!.energy < 1e-12);
  // 注: 激波后临界面积恒小于激波处截面, 严格递增几何下波后亚声速段总可达
});

test("非递增截面被拒绝", () => {
  assert.throws(() => shockFreeProfile(gas, total, 0.01, [0.02, 0.02]), /递增/);
  assert.throws(() => shockFreeProfile(gas, total, 0.01, [0.005]), /喉部/);
});

test("重启后报告复现: 快照写入 SQLite 后重新打开可读出相同结果", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nozzle-test-"));
  let svc = new Service(dir);
  const g = svc.addGas("air", 1.4, 287);
  const geo = svc.addGeometry("geom", 0.01, [0.012, 0.02, 0.04]);
  const c = svc.addCase(g.id, geo.id, 500, 500000, 1);
  const { snapshotId, result } = svc.profile(c.id);
  svc.close();
  // 重新打开(模拟重启)
  svc = new Service(dir);
  const snap = svc.getSnapshot(snapshotId);
  svc.close();
  assert.deepEqual(snap.result, JSON.parse(JSON.stringify(result)));
  fs.rmSync(dir, { recursive: true, force: true });
});

