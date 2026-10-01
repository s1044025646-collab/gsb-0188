/** 演示: 无激波剖面 vs 指定位置正激波剖面, 打印差异与数值残差。 */
import { shockFreeProfile, shockedProfile, compareProfiles } from "./solver";

const gas = { gamma: 1.4, R: 287 };
const total = { T0: 500, p0: 500000 };
const throatArea = 0.01;
const areas = [0.012, 0.015, 0.02, 0.03, 0.045];
const shockIndex = 2; // 在 A=0.02 处放正激波

const free = shockFreeProfile(gas, total, throatArea, areas);
const shocked = shockedProfile(gas, total, throatArea, areas, shockIndex);

console.log("=== 无激波超声速剖面 (gamma=1.4, R=287, T0=500K, p0=500kPa, A*=0.01 m^2) ===");
console.log("idx   area      A/A*      M         p(Pa)      T(K)      V(m/s)    mdot(kg/s)");
for (const s of free.stations) {
  console.log(
    `${s.index}     ${s.area.toFixed(4)}    ${s.areaRatio.toFixed(3)}    ` +
    `${s.state.M.toFixed(4)}    ${s.state.p.toFixed(1)}   ${s.state.T.toFixed(1)}   ` +
    `${s.state.V.toFixed(1)}    ${s.massFlow.toFixed(5)}`
  );
}
console.log(`质量流率: ${free.massFlow.toFixed(6)} kg/s, 最大相对流率误差: ${free.massFlowError.toExponential(3)}`);

console.log(`\n=== 在 index=${shockIndex} (A=${areas[shockIndex]}) 放置正激波的剖面 ===`);
console.log("idx   area      A/A*      branch       M         p(Pa)      T(K)      V(m/s)    mdot(kg/s)");
for (const s of shocked.stations) {
  console.log(
    `${s.index}     ${s.area.toFixed(4)}    ${s.areaRatio.toFixed(3)}    ` +
    `${s.branch.padEnd(10)}   ${s.state.M.toFixed(4)}    ${s.state.p.toFixed(1)}   ` +
    `${s.state.T.toFixed(1)}   ${s.state.V.toFixed(1)}    ${s.massFlow.toFixed(5)}${s.shockHere ? "  <== 激波(波后)" : ""}`
  );
}
const sh = shocked.stations[shockIndex].shock!;
console.log(`激波: M1=${sh.M1.toFixed(4)} -> M2=${sh.M2.toFixed(4)}, p2/p1=${sh.p2p1.toFixed(4)}, ` +
  `T2/T1=${sh.T2T1.toFixed(4)}, rho2/rho1=${sh.rho2rho1.toFixed(4)}, p02/p01=${sh.p02p01.toFixed(6)} (总压损失 ${(100 * (1 - sh.p02p01)).toFixed(2)}%)`);
const r = shocked.shockResiduals!;
console.log(`激波守恒残差(相对): 质量=${r.mass.toExponential(3)}, 动量=${r.momentum.toExponential(3)}, 能量=${r.energy.toExponential(3)}`);
console.log(`质量流率: ${shocked.massFlow.toFixed(6)} kg/s, 最大相对流率误差: ${shocked.massFlowError.toExponential(3)}`);

console.log("\n=== 两剖面逐截面比较 ===");
const cmp = compareProfiles(free, shocked);
console.log("idx   M(无激波)   M(有激波)   p(无激波)Pa   p(有激波)Pa   流率相对差");
for (const row of cmp.perStation) {
  console.log(
    `${row.index}   ${row.M[0].toFixed(4)}      ${row.M[1].toFixed(4)}      ` +
    `${row.p[0].toFixed(1)}      ${row.p[1].toFixed(1)}      ${row.massFlowDiff.toExponential(3)}`
  );
}
console.log("\n注意: 本模型为准一维等熵+正激波跳变, 不覆盖真实黏性、边界层、激波-边界层干扰与非定常现象。");
