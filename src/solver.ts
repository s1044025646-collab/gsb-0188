/**
 * 剖面求解: 由喉部面积 + 递增下游截面积生成
 *   a) 无激波超声速剖面
 *   b) 在用户指定截面放置一次正激波, 之后按新的总态/临界面积计算亚声速段
 * 激波位置由用户给定, 不做任意背压下的自动定位。
 */
import {
  Gas, TotalState, StaticState, NormalShockResult,
  staticFromTotal, normalShock, solveMachFromArea, criticalMassFlux,
  validateGas, validateTotal,
} from "./physics";

export interface StationResult {
  index: number;
  area: number;        // 截面积 m^2
  areaRatio: number;   // 相对当前临界面积 A/A*
  branch: "subsonic" | "supersonic";
  state: StaticState;  // 静态度
  massFlow: number;    // 该截面质量流率 kg/s
  shockHere: boolean;  // 该截面是否放置正激波(状态为波后)
  shock?: NormalShockResult;
  machSolve: { residual: number; iterations: number };
}

export interface ProfileResult {
  kind: "shock-free" | "with-shock";
  gas: Gas;
  inletTotal: TotalState;
  throatArea: number;
  stations: StationResult[];
  massFlow: number;          // 全程质量流率 (应恒定)
  massFlowError: number;     // 各截面流率相对喉部流率的最大相对误差
  shockResiduals?: {         // 激波前后守恒残差 (相对量级)
    mass: number;            // rho2 V2 - rho1 V1
    momentum: number;        // (p2 + rho2 V2^2) - (p1 + rho1 V1^2)
    energy: number;          // h02 - h01 (绝热, 应为 0)
  };
}

function checkGeometry(throatArea: number, areas: number[]): void {
  if (!Number.isFinite(throatArea) || throatArea <= 0) {
    throw new Error(`非法喉部面积 ${throatArea}`);
  }
  if (areas.length === 0) throw new Error("下游截面积列表为空");
  for (let i = 0; i < areas.length; i++) {
    const a = areas[i];
    if (!Number.isFinite(a) || a <= 0) throw new Error(`非法截面积 areas[${i}]=${a}`);
    if (a <= throatArea) {
      throw new Error(`areas[${i}]=${a} 不大于喉部面积 ${throatArea}, 与扩张段假设不相容, 停止`);
    }
    if (i > 0 && a <= areas[i - 1]) {
      throw new Error(`截面积必须严格递增: areas[${i}]=${a} <= areas[${i - 1}]=${areas[i - 1]}, 停止`);
    }
  }
}

/** 无激波超声速剖面: 全部截面取超声速分支 */
export function shockFreeProfile(
  gas: Gas, inletTotal: TotalState, throatArea: number, areas: number[]
): ProfileResult {
  validateGas(gas); validateTotal(inletTotal);
  checkGeometry(throatArea, areas);
  const mdot = criticalMassFlux(gas, inletTotal) * throatArea;
  const stations: StationResult[] = areas.map((area, index) => {
    const ar = area / throatArea;
    const sol = solveMachFromArea(gas, ar, "supersonic");
    const state = staticFromTotal(gas, inletTotal, sol.M);
    return {
      index, area, areaRatio: ar, branch: "supersonic" as const,
      state, massFlow: state.massFlux * area, shockHere: false,
      machSolve: { residual: sol.residual, iterations: sol.iterations },
    };
  });
  const massFlowError = Math.max(...stations.map(s => Math.abs(s.massFlow - mdot) / mdot));
  return { kind: "shock-free", gas, inletTotal, throatArea, stations, massFlow: mdot, massFlowError };
}

/**
 * 指定截面放一次正激波的剖面。
 * shockIndex 之前的截面为超声速分支(相对喉部临界面积);
 * 激波后总压下降、临界面积增大, 之后截面按新总态取亚声速分支。
 * 若某下游截面小于激波后的临界面积(几何不相容), 解释并停止。
 */
export function shockedProfile(
  gas: Gas, inletTotal: TotalState, throatArea: number,
  areas: number[], shockIndex: number
): ProfileResult {
  validateGas(gas); validateTotal(inletTotal);
  checkGeometry(throatArea, areas);
  if (!Number.isInteger(shockIndex) || shockIndex < 0 || shockIndex >= areas.length) {
    throw new Error(`激波位置 shockIndex=${shockIndex} 超出截面范围 [0, ${areas.length - 1}]`);
  }
  const mdot = criticalMassFlux(gas, inletTotal) * throatArea;

  // 激波上游: 超声速分支
  const stations: StationResult[] = [];
  for (let i = 0; i <= shockIndex; i++) {
    const ar = areas[i] / throatArea;
    const sol = solveMachFromArea(gas, ar, "supersonic");
    const state = staticFromTotal(gas, inletTotal, sol.M);
    stations.push({
      index: i, area: areas[i], areaRatio: ar, branch: "supersonic",
      state, massFlow: state.massFlux * areas[i], shockHere: false,
      machSolve: { residual: sol.residual, iterations: sol.iterations },
    });
  }

  // 激波
  const pre = stations[shockIndex].state;
  const shock = normalShock(gas, pre.M);
  const postTotal: TotalState = { T0: inletTotal.T0, p0: inletTotal.p0 * shock.p02p01 };
  const post = staticFromTotal(gas, postTotal, shock.M2);
  // 激波后临界面积 A2* = mdot / (临界流率(新总态))
  const aStar2 = mdot / criticalMassFlux(gas, postTotal);

  // 守恒残差
  const massRes = post.massFlux - pre.massFlux;
  const momRes = (post.p + post.rho * post.V * post.V) - (pre.p + pre.rho * pre.V * pre.V);
  const cp = gas.gamma * gas.R / (gas.gamma - 1);
  const energyRes = cp * postTotal.T0 - cp * inletTotal.T0;
  const shockResiduals = {
    mass: massRes / pre.massFlux,
    momentum: momRes / (pre.p + pre.rho * pre.V * pre.V),
    energy: energyRes / (cp * inletTotal.T0),
  };

  // 用波后状态替换激波截面
  stations[shockIndex] = {
    index: shockIndex, area: areas[shockIndex], areaRatio: areas[shockIndex] / aStar2,
    branch: "subsonic", state: post, massFlow: post.massFlux * areas[shockIndex],
    shockHere: true, shock,
    machSolve: { residual: 0, iterations: 0 },
  };

  // 激波下游: 相对新临界面积的亚声速分支
  for (let i = shockIndex + 1; i < areas.length; i++) {
    const ar = areas[i] / aStar2;
    if (ar < 1) {
      throw new Error(
        `截面 areas[${i}]=${areas[i]} 小于激波后临界面积 A2*=${aStar2.toFixed(6)}: ` +
        `激波放在 index=${shockIndex} 时, 该截面无法以亚声速等熵流动到达, 几何与分支不相容, 停止`
      );
    }
    const sol = solveMachFromArea(gas, ar, "subsonic");
    const state = staticFromTotal(gas, postTotal, sol.M);
    stations.push({
      index: i, area: areas[i], areaRatio: ar, branch: "subsonic",
      state, massFlow: state.massFlux * areas[i], shockHere: false,
      machSolve: { residual: sol.residual, iterations: sol.iterations },
    });
  }

  const massFlowError = Math.max(...stations.map(s => Math.abs(s.massFlow - mdot) / mdot));
  return {
    kind: "with-shock", gas, inletTotal, throatArea, stations,
    massFlow: mdot, massFlowError, shockResiduals,
  };
}

/** 比较两个剖面: 逐截面流率误差 + 激波守恒残差 */
export interface ProfileComparison {
  stationCount: [number, number];
  massFlow: [number, number];
  massFlowError: [number, number];
  perStation: {
    index: number;
    area: [number, number];
    massFlow: [number, number];
    massFlowDiff: number; // |mdot1 - mdot2| / max(mdot)
    M: [number, number];
    p: [number, number];
  }[];
  shockResiduals: [ProfileResult["shockResiduals"], ProfileResult["shockResiduals"]];
}

export function compareProfiles(a: ProfileResult, b: ProfileResult): ProfileComparison {
  const n = Math.max(a.stations.length, b.stations.length);
  const ref = Math.max(a.massFlow, b.massFlow);
  const perStation: ProfileComparison["perStation"] = [];
  for (let i = 0; i < n; i++) {
    const sa = a.stations[i];
    const sb = b.stations[i];
    perStation.push({
      index: i,
      area: [sa?.area ?? NaN, sb?.area ?? NaN],
      massFlow: [sa?.massFlow ?? NaN, sb?.massFlow ?? NaN],
      massFlowDiff: sa && sb ? Math.abs(sa.massFlow - sb.massFlow) / ref : NaN,
      M: [sa?.state.M ?? NaN, sb?.state.M ?? NaN],
      p: [sa?.state.p ?? NaN, sb?.state.p ?? NaN],
    });
  }
  return {
    stationCount: [a.stations.length, b.stations.length],
    massFlow: [a.massFlow, b.massFlow],
    massFlowError: [a.massFlowError, b.massFlowError],
    perStation,
    shockResiduals: [a.shockResiduals, b.shockResiduals],
  };
}

