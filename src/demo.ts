import { Service } from "./service";
import { compareProfiles } from "./compare";

/** 演示：空气 γ=1.4，同一几何下无激波超声速剖面 vs 指定截面正激波剖面，打印差异与残差。 */
export function runDemo(dataDir: string) {
  const svc = new Service({ dataDir });
  try {
    console.log("=== 准一维喷管演示（理想气体、定比热、绝热无摩擦稳态；绝对单位 Pa/K） ===\n");
    const gasId = svc.addGas("air-demo", 1.4, 287);
    const geomId = svc.addGeometry("demo-geom", 1, 0.01, [0.015, 0.02, 0.03, 0.04]);
    const caseFree = svc.addCase("shock-free", gasId.id, geomId.id, 300, 101325);
    const caseShock = svc.addCase("with-shock@idx1", gasId.id, geomId.id, 300, 101325, 1);

    const free = svc.runCase(caseFree.id);
    const shocked = svc.runCase(caseShock.id);

    const fmt = (x: number | undefined, d = 6) => x === undefined ? "-" : x.toPrecision(d);
    console.log("--- 无激波（全程超声速分支） ---");
    console.log("idx\tA(m2)\t\tM\tp(Pa)\t\tT(K)\t\tmdot(kg/s)");
    for (const s of free.profile.sections)
      console.log(`${s.index}\t${s.A}\t\t${fmt(s.M, 5)}\t${fmt(s.p)}\t${fmt(s.T)}\t${fmt(s.mdot)}`);

    console.log("\n--- 在截面索引 1 放置正激波 ---");
    console.log("idx\tA(m2)\t\tbranch\t\tM\tp(Pa)\t\tmdot(kg/s)");
    for (const s of shocked.profile.sections)
      console.log(`${s.index}\t${s.A}\t\t${s.branch}\t\t${fmt(s.M, 5)}\t${fmt(s.p)}\t${fmt(s.mdot)}`);

    const sh = shocked.profile.shock!;
    console.log(`\n激波: M1=${fmt(sh.relations.M1, 6)} -> M2=${fmt(sh.relations.M2, 6)}`);
    console.log(`p2/p1=${fmt(sh.relations.p2OverP1)}, T2/T1=${fmt(sh.relations.T2OverT1)}, rho2/rho1=${fmt(sh.relations.rho2OverRho1)}`);
    console.log(`总压恢复 p02/p01=${fmt(sh.relations.p02OverP01)}（总压损失 ${fmt(1 - sh.relations.p02OverP01)}）`);
    console.log(`新临界面积 A*'=${fmt(sh.newAStar)} m2（原 A*=${fmt(shocked.profile.AStar)}）`);
    console.log(`激波守恒残差: 质量=${sh.residuals.mass.toExponential(3)}, 动量=${sh.residuals.momentum.toExponential(3)}, 能量=${sh.residuals.energy.toExponential(3)}`);

    const cmp = compareProfiles(free.profile, shocked.profile, free.totals, shocked.totals);
    console.log("\n--- 两剖面逐截面比较 ---");
    console.log("idx\tM(无激波)\tM(有激波)\tp(无激波)\tp(有激波)\t流率相对误差");
    for (const r of cmp.rows)
      console.log(`${r.index}\t${fmt(r.M1, 5)}\t\t${fmt(r.M2, 5)}\t\t${fmt(r.p1)}\t\t${fmt(r.p2)}\t\t${r.mdotRelErr?.toExponential(3) ?? "-"}`);
    console.log(`\n最大流率相对误差: ${cmp.maxMdotRelErr.toExponential(3)}`);
    console.log(`\n快照已保存: 无激波 #${free.snapshotId}, 有激波 #${shocked.snapshotId}`);
    console.log("注意：本模型不含黏性、边界层、热传导与非定常效应，结果仅适用于理想准一维假设。");
  } finally {
    svc.close();
  }
}
