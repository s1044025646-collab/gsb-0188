/**
 * 理想气体准一维等熵流动与正激波物理核心。
 *
 * 模型假设:
 *   - 定比热理想气体 (cp, cv 常数), 状态方程 p = rho * R * T
 *   - 稳态、绝热、无摩擦、准一维流动
 *   - 所有压力/温度均为绝对单位 (Pa, K)
 *   - 适用范围: 连续介质完全气体; 不覆盖真实气体效应、黏性、非定常现象
 */

export interface Gas {
  gamma: number; // 比热比, 要求 > 1
  R: number;     // 气体常数 J/(kg*K), 要求 > 0
}

export function validateGas(gas: Gas): void {
  if (!Number.isFinite(gas.gamma) || gas.gamma <= 1) {
    throw new Error(`非法比热比 gamma=${gas.gamma}, 要求有限且 > 1`);
  }
  if (!Number.isFinite(gas.R) || gas.R <= 0) {
    throw new Error(`非法气体常数 R=${gas.R}, 要求有限且 > 0`);
  }
}

export interface TotalState {
  T0: number; // 总温 K (绝对)
  p0: number; // 总压 Pa (绝对)
}

export function validateTotal(t: TotalState): void {
  if (!Number.isFinite(t.T0) || t.T0 <= 0) throw new Error(`非法总温 T0=${t.T0} K`);
  if (!Number.isFinite(t.p0) || t.p0 <= 0) throw new Error(`非法总压 p0=${t.p0} Pa`);
}

/** 等熵关系: 静/总 温度比 T/T0 */
export function tempRatio(gas: Gas, M: number): number {
  return 1 / (1 + (gas.gamma - 1) / 2 * M * M);
}

/** 等熵关系: 静/总 压强比 p/p0 */
export function pressureRatio(gas: Gas, M: number): number {
  return Math.pow(tempRatio(gas, M), gas.gamma / (gas.gamma - 1));
}

/** 等熵关系: 静/总 密度比 rho/rho0 */
export function densityRatio(gas: Gas, M: number): number {
  return Math.pow(tempRatio(gas, M), 1 / (gas.gamma - 1));
}

/** 面积-马赫数关系 A/A*(M) */
export function areaMach(gas: Gas, M: number): number {
  const g = gas.gamma;
  const term = (2 / (g + 1)) * (1 + (g - 1) / 2 * M * M);
  return (1 / M) * Math.pow(term, (g + 1) / (2 * (g - 1)));
}

export type Branch = "subsonic" | "supersonic";

export interface MachSolveResult {
  M: number;
  branch: Branch;
  residual: number;   // 最终 |A/A*(M) - target|
  iterations: number; // 迭代次数
  converged: boolean;
}

/**
 * 面积-马赫数关系数值反解。
 * 分支由调用者显式指定 (subsonic: M<=1, supersonic: M>=1),
 * 初值取该分支内的固定值, 不会由初值偶然决定分支。
 * 牛顿迭代 + 分支内二分兜底; 不收敛时抛错, 绝不返回未收敛值。
 */
export function solveMachFromArea(
  gas: Gas,
  areaRatio: number,
  branch: Branch,
  tol = 1e-12,
  maxIter = 100
): MachSolveResult {
  validateGas(gas);
  if (!Number.isFinite(areaRatio)) throw new Error(`非法面积比 ${areaRatio}`);
  if (areaRatio < 1) {
    throw new Error(`面积比 A/A*=${areaRatio} < 1, 等熵喷管流动不存在, 拒绝求解`);
  }
  if (areaRatio === 1) {
    return { M: 1, branch, residual: 0, iterations: 0, converged: true };
  }
  const g = gas.gamma;
  const f = (M: number) => areaMach(gas, M) - areaRatio;
  const df = (M: number) => {
    const term = (2 / (g + 1)) * (1 + (g - 1) / 2 * M * M);
    const expo = (g + 1) / (2 * (g - 1));
    return (
      -Math.pow(term, expo) / (M * M) +
      (1 / M) * expo * Math.pow(term, expo - 1) * (2 / (g + 1)) * (g - 1) * M
    );
  };

  let M = branch === "subsonic" ? 0.5 : 2.0; // 分支内固定初值
  let lo = branch === "subsonic" ? 1e-9 : 1.0;
  let hi = branch === "subsonic" ? 1.0 : 1e6;

  let iterations = 0;
  let residual = Math.abs(f(M));
  for (let i = 0; i < maxIter; i++) {
    iterations = i + 1;
    const fv = f(M);
    residual = Math.abs(fv);
    if (residual <= tol) return { M, branch, residual, iterations, converged: true };
    if (branch === "subsonic") { if (fv > 0) lo = M; else hi = M; } else { if (fv > 0) hi = M; else lo = M; }
    const dfv = df(M);
    let next = M - fv / dfv;
    if (!Number.isFinite(next) || next <= lo || next >= hi) {
      next = 0.5 * (lo + hi); // 牛顿步越界时退回二分
    }
    M = next;
  }
  residual = Math.abs(f(M));
  if (residual <= Math.max(tol, 1e-10)) {
    return { M, branch, residual, iterations, converged: true };
  }
  throw new Error(
    `面积-马赫数反解未收敛: 分支=${branch}, A/A*=${areaRatio}, 残差=${residual}, 迭代=${iterations}`
  );
}

/** 由总态与马赫数计算静态量、速度、单位面积质量流率 */
export interface StaticState {
  M: number;
  T: number;        // 静温 K
  p: number;        // 静压 Pa
  rho: number;      // 密度 kg/m^3
  a: number;        // 声速 m/s
  V: number;        // 速度 m/s
  massFlux: number; // 单位面积质量流率 rho*V, kg/(s*m^2)
}

export function staticFromTotal(gas: Gas, total: TotalState, M: number): StaticState {
  validateGas(gas);
  validateTotal(total);
  if (!Number.isFinite(M) || M < 0) throw new Error(`非法马赫数 M=${M}`);
  const T = total.T0 * tempRatio(gas, M);
  const p = total.p0 * pressureRatio(gas, M);
  const rho = p / (gas.R * T);
  const a = Math.sqrt(gas.gamma * gas.R * T);
  const V = M * a;
  return { M, T, p, rho, a, V, massFlux: rho * V };
}

/** 喉部(临界)单位面积质量流率: 给定总态下的最大可能值 */
export function criticalMassFlux(gas: Gas, total: TotalState): number {
  return staticFromTotal(gas, total, 1).massFlux;
}

/** 正激波 (Rankine-Hugoniot), 上游必须为超声速 */
export interface NormalShockResult {
  M1: number;
  M2: number;       // 下游马赫数 (<1)
  p2p1: number;     // 静压比
  T2T1: number;     // 静温比
  rho2rho1: number; // 密度比
  p02p01: number;   // 总压比 (<1, 表征总压损失)
}

export function normalShock(gas: Gas, M1: number): NormalShockResult {
  validateGas(gas);
  if (!Number.isFinite(M1) || M1 <= 1) {
    throw new Error(`正激波要求上游马赫数 M1 > 1, 收到 M1=${M1}; 亚声速输入不是有效正激波`);
  }
  const g = gas.gamma;
  const M1sq = M1 * M1;
  const M2 = Math.sqrt((1 + (g - 1) / 2 * M1sq) / (g * M1sq - (g - 1) / 2));
  const p2p1 = 1 + (2 * g / (g + 1)) * (M1sq - 1);
  const rho2rho1 = ((g + 1) * M1sq) / ((g - 1) * M1sq + 2);
  const T2T1 = p2p1 / rho2rho1;
  const p02p01 =
    Math.pow(((g + 1) * M1sq) / ((g - 1) * M1sq + 2), g / (g - 1)) *
    Math.pow((g + 1) / (2 * g * M1sq - (g - 1)), 1 / (g - 1));
  return { M1, M2, p2p1, T2T1, rho2rho1, p02p01 };
}

