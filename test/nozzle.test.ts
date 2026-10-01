import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { areaRatio, machFromAreaRatio, stateFromTotal, normalShock, chokedMassFlux, assertGas } from "../src/gas";
import { buildProfile, shockResiduals } from "../src/profile";
import { Service } from "../src/service";

const AIR = { gamma: 1.4, R: 287 };
const tmp = (name: string) => {
  const dir = `data-test-${name}-${process.pid}`;
  fs.rmSync(dir, { recursive: true, force: true });
  return dir;
};

test("等熵换算往返：面积比 -> 马赫数 -> 面积比", () => {
  for (const M of [0.2, 0.5, 0.9, 1.5, 2.0, 3.5, 5.0]) {
    const AR = areaRatio(AIR, M);
    const branch = M < 1 ? "subsonic" : "supersonic";
    const { M: M2, diag } = machFromAreaRatio(AIR, AR, branch);
    assert.ok(Math.abs(M2 - M) < 1e-9, `M=${M} 反解得 ${M2}`);
    assert.ok(diag.converged && Math.abs(diag.residual) < 1e-10);
  }
});

test("面积比=1 返回临界；<1 拒绝；>1 必须指定分支且分支不由初值决定", () => {
  assert.equal(machFromAreaRatio(AIR, 1).M, 1);
  assert.throws(() => machFromAreaRatio(AIR, 0.5), /面积比/);
  assert.throws(() => machFromAreaRatio(AIR, 2), /分支/);
  const sub = machFromAreaRatio(AIR, 2, "subsonic").M;
  const sup = machFromAreaRatio(AIR, 2, "supersonic").M;
  assert.ok(sub < 1 && sup > 1);
  assert.ok(Math.abs(areaRatio(AIR, sub) - 2) < 1e-10);
  assert.ok(Math.abs(areaRatio(AIR, sup) - 2) < 1e-10);
});

test("手算基准：γ=1.4, M=2 的等熵关系", () => {
  const s = stateFromTotal(AIR, 300, 101325, 2, 0.01);
  assert.ok(Math.abs(s.T - 300 / 1.8) < 1e-9);
  assert.ok(Math.abs(s.p - 101325 / 7.824449) < 0.5); // p0/p = 1.8^3.5
  assert.ok(Math.abs(areaRatio(AIR, 2) - 1.6875) < 1e-4);
});

test("喉部质量流率最大（壅塞）", () => {
  const fluxAt = (M: number) => stateFromTotal(AIR, 300, 101325, M, 1).mdot!;
  const star = fluxAt(1);
  for (const M of [0.1, 0.5, 0.9, 0.99, 1.01, 1.5, 2, 4]) assert.ok(fluxAt(M) < star, `M=${M}`);
  assert.ok(Math.abs(star - chokedMassFlux(AIR, 300, 101325)) < 1e-6 * star);
});

test("正激波手算基准：M1=2", () => {
  const r = normalShock(AIR, 2);
  assert.ok(Math.abs(r.p2OverP1 - 4.5) < 1e-12);
  assert.ok(Math.abs(r.rho2OverRho1 - 8 / 3) < 1e-12);
  assert.ok(Math.abs(r.T2OverT1 - 1.6875) < 1e-12);
  assert.ok(Math.abs(r.M2 - 0.57735) < 1e-4);
  assert.ok(Math.abs(r.p02OverP01 - 0.720874) < 1e-5);
});

test("正激波前后质量/动量/能量守恒", () => {
  for (const M1 of [1.05, 1.5, 2, 3, 5]) {
    const r = normalShock(AIR, M1);
    const up = stateFromTotal(AIR, 300, 101325, M1, 0.02);
    const down = stateFromTotal(AIR, 300, 101325 * r.p02OverP01, r.M2, 0.02);
    const res = shockResiduals(AIR, up, down, 0.02);
    assert.ok(Math.abs(res.mass) < 1e-10, `mass ${res.mass}`);
    assert.ok(Math.abs(res.momentum) < 1e-10, `momentum ${res.momentum}`);
    assert.ok(Math.abs(res.energy) < 1e-12, `energy ${res.energy}`);
  }
});

test("弱激波极限：M1→1 时退化为无声波", () => {
  const r = normalShock(AIR, 1 + 1e-6);
  assert.ok(Math.abs(r.p2OverP1 - 1) < 1e-4);
  assert.ok(Math.abs(r.M2 - 1) < 1e-4);
  assert.ok(Math.abs(r.p02OverP01 - 1) < 1e-8);
});

test("非法输入拒绝：物性、亚声速激波、非正总态", () => {
  assert.throws(() => assertGas({ gamma: 1, R: 287 }));
  assert.throws(() => assertGas({ gamma: 1.4, R: -1 }));
  assert.throws(() => normalShock(AIR, 0.8), /M1 > 1/);
  assert.throws(() => normalShock(AIR, 1), /M1 > 1/);
  assert.throws(() => stateFromTotal(AIR, -300, 101325, 1));
});

test("剖面：无激波全程超声速，且各截面流率一致", () => {
  const p = buildProfile(AIR, 300, 101325, 0.01, [0.015, 0.02, 0.03]);
  assert.equal(p.kind, "shock-free");
  for (const s of p.sections.slice(1)) assert.ok(s.M > 1);
  for (const s of p.sections) assert.ok(Math.abs(s.mdot! - p.mdot) / p.mdot < 1e-9);
});

test("剖面：指定截面正激波后转亚声速，总压下降、A* 增大", () => {
  const p = buildProfile(AIR, 300, 101325, 0.01, [0.015, 0.02, 0.03], 1);
  assert.equal(p.kind, "with-shock");
  const sh = p.shock!;
  assert.ok(sh.relations.p02OverP01 < 1);
  assert.ok(sh.newAStar > p.AStar);
  const after = p.sections.filter(s => s.index > 1);
  for (const s of after) assert.ok(s.M < 1, `激波后应为亚声速, M=${s.M}`);
  assert.ok(Math.abs(sh.residuals.mass) < 1e-10);
});

test("不相容几何拒绝：非递增截面", () => {
  assert.throws(() => buildProfile(AIR, 300, 101325, 0.01, [0.02, 0.015]), /递增/);
  assert.throws(() => buildProfile(AIR, 300, 101325, 0.01, [0.005]), /喉部/);
});

test("持久化：重启后快照报告可复现", () => {
  const dir = tmp("restart");
  let snapId: number, before: string;
  {
    const svc = new Service({ dataDir: dir });
    const g = svc.addGas("air", 1.4, 287);
    const geo = svc.addGeometry("v1", 1, 0.01, [0.015, 0.02]);
    const c = svc.addCase("run", g.id, geo.id, 300, 101325, 1);
    const r = svc.runCase(c.id);
    snapId = r.snapshotId;
    before = JSON.stringify(svc.getSnapshot(snapId).payload);
    svc.close();
  }
  {
    const svc = new Service({ dataDir: dir }); // 模拟重启
    const after = JSON.stringify(svc.getSnapshot(snapId).payload);
    assert.equal(after, before);
    svc.close();
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test("版本比较：报告流率误差与激波残差", () => {
  const dir = tmp("compare");
  const svc = new Service({ dataDir: dir });
  const g = svc.addGas("air", 1.4, 287);
  const geo = svc.addGeometry("v1", 1, 0.01, [0.015, 0.02, 0.03]);
  const c1 = svc.addCase("free", g.id, geo.id, 300, 101325);
  const c2 = svc.addCase("shock", g.id, geo.id, 300, 101325, 1);
  const r1 = svc.runCase(c1.id);
  const r2 = svc.runCase(c2.id);
  const cmp = svc.compareSnapshots(r1.snapshotId, r2.snapshotId);
  assert.ok(cmp.result.rows.length === 4);
  assert.ok(cmp.result.maxMdotRelErr < 1e-9);
  assert.ok(cmp.result.shockResiduals!.b !== undefined);
  assert.ok(cmp.result.rows.some(r => r.M1! > 1 && r.M2! < 1)); // 激波后分支差异
  svc.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
