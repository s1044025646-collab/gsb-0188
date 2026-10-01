/** 理想气体准一维等熵关系与正激波。所有压力、温度均为绝对单位（Pa、K）。 */
export interface Gas { gamma: number; R: number; }

export interface SolveDiag {
  iterations: number;
  residual: number;   // f(M) = A/A*(M) - target
  converged: boolean;
  method: string;
}

export function assertGas(g: Gas): void {
  if (!Number.isFinite(g.gamma) || g.gamma <= 1 || g.gamma >= 3)
    throw new Error(`比热比 gamma 必须满足 1 < gamma < 3，收到 ${g.gamma}`);
  if (!Number.isFinite(g.R) || g.R <= 0)
    throw new Error(`气体常数 R 必须为正值 (J/(kg·K))，收到 ${g.R}`);
}

/** T0/T = 1 + (γ-1)/2 · M² */
export function t0OverT(g: Gas, M: number): number {
  return 1 + (g.gamma - 1) / 2 * M * M;
}
export function p0OverP(g: Gas, M: number): number {
  return Math.pow(t0OverT(g, M), g.gamma / (g.gamma - 1));
}
export function rho0OverRho(g: Gas, M: number): number {
  return Math.pow(t0OverT(g, M), 1 / (g.gamma - 1));
}

/** 面积-马赫数关系 A/A*（等熵、喉部 M=1 为参考）。 */
export function areaRatio(g: Gas, M: number): number {
  const gm1 = g.gamma - 1, gp1 = g.gamma + 1;
  const term = (2 / gp1) * (1 + gm1 / 2 * M * M);
  return (1 / M) * Math.pow(term, gp1 / (2 * gm1));
}

export type Branch = "subsonic" | "supersonic";

/**
 * 由面积比反解马赫数。
 * AR > 1 时按 branch 显式选择亚/超声速分支；AR = 1 返回临界 M=1；AR < 1 拒绝。
 * 采用固定区间的牛顿法 + 二分兜底，初值不决定分支；不收敛时抛错，绝不返回未收敛值。
 */
export function machFromAreaRatio(g: Gas, AR: number, branch?: Branch): { M: number; diag: SolveDiag } {
  if (!Number.isFinite(AR) || AR <= 0) throw new Error(`面积比必须为正值，收到 ${AR}`);
  const tol = 1e-12;
  if (Math.abs(AR - 1) < 1e-10) {
    return { M: 1, diag: { iterations: 0, residual: 0, converged: true, method: "critical" } };
  }
  if (AR < 1) throw new Error(`面积比 ${AR} < 1，物理上不存在（等熵流最小面积比为 1）`);
  if (!branch) throw new Error("面积比大于 1 时必须显式指定分支 subsonic 或 supersonic");

  const f = (M: number) => areaRatio(g, M) - AR;
  const df = (M: number) => {
    const gm1 = g.gamma - 1, gp1 = g.gamma + 1;
    const term = (2 / gp1) * (1 + gm1 / 2 * M * M);
    const p = gp1 / (2 * gm1);
    return Math.pow(term, p) * (gm1 / gp1 - 1 / (M * M));
  };

  // 固定分支区间：亚声速 (0,1)，超声速 (1, Mmax]
  let lo: number, hi: number;
  if (branch === "subsonic") { lo = 1e-6; hi = 1; }
  else {
    lo = 1; hi = 2;
    while (f(hi) < 0) { hi *= 2; if (hi > 1e6) throw new Error("超声速分支区间扩展失败"); }
  }

  // 带保护的牛顿法：f 在亚声速段单调递减、超声速段单调递增，括号始终包住根。
  // 初值固定（亚 0.5 / 超 1.5），分支只由 branch 参数决定；越界退化为二分。
  let M = branch === "subsonic" ? 0.5 : 1.5;
  let iterations = 0, residual = f(M);
  const maxIter = 200;
  for (; iterations < maxIter; iterations++) {
    residual = f(M);
    if (Math.abs(residual) < tol) return { M, diag: { iterations, residual, converged: true, method: "newton+bisection" } };
    // f 减（亚）：residual>0 说明 M 偏小；f 增（超）：residual>0 说明 M 偏大
    if (branch === "subsonic") { if (residual > 0) lo = M; else hi = M; }
    else { if (residual > 0) hi = M; else lo = M; }
    const d = df(M);
    let next = d !== 0 ? M - residual / d : NaN;
    if (!(next > lo && next < hi)) next = (lo + hi) / 2;
    M = next;
  }
  throw new Error(`面积-马赫数反解未收敛（AR=${AR}, branch=${branch}），拒绝返回未收敛值`);
}

/** 给定总态与马赫数的静态量与单位面积信息。 */
export interface StateResult {
  M: number; T: number; p: number; rho: number; a: number; V: number;
  T0: number; p0: number; mdot?: number; A?: number;
}
export function stateFromTotal(g: Gas, T0: number, p0: number, M: number, A?: number): StateResult {
  if (!(T0 > 0) || !(p0 > 0)) throw new Error("总温总压必须为正值（绝对单位 K、Pa）");
  if (!(M >= 0)) throw new Error("马赫数必须非负");
  const T = T0 / t0OverT(g, M);
  const p = p0 / p0OverP(g, M);
  const rho = p / (g.R * T);
  const a = Math.sqrt(g.gamma * g.R * T);
  const V = M * a;
  const r: StateResult = { M, T, p, rho, a, V, T0, p0 };
  if (A !== undefined) {
    if (!(A > 0)) throw new Error("截面积必须为正值");
    r.A = A;
    r.mdot = rho * V * A;
  }
  return r;
}

/** 喉部（M=1）质量流率：mdot* = p0·A*·sqrt(γ/(R·T0))·(1+(γ-1)/2)^(-(γ+1)/(2(γ-1))) */
export function chokedMassFlux(g: Gas, T0: number, p0: number): number {
  const gm1 = g.gamma - 1, gp1 = g.gamma + 1;
  return p0 * Math.sqrt(g.gamma / (g.R * T0)) * Math.pow(1 + gm1 / 2, -gp1 / (2 * gm1));
}

export interface ShockResult {
  M1: number; M2: number;
  p2OverP1: number; T2OverT1: number; rho2OverRho1: number;
  p02OverP01: number; T02OverT01: number;
}
/** 正激波（Rankine-Hugoniot）。上游必须超声速，否则拒绝。 */
export function normalShock(g: Gas, M1: number): ShockResult {
  if (!(M1 > 1)) throw new Error(`正激波要求上游马赫数 M1 > 1，收到 M1=${M1}（亚声速/声速输入无效）`);
  const gm1 = g.gamma - 1, gp1 = g.gamma + 1;
  const M1sq = M1 * M1;
  const M2sq = (1 + gm1 / 2 * M1sq) / (g.gamma * M1sq - gm1 / 2);
  const M2 = Math.sqrt(M2sq);
  const p2OverP1 = 1 + (2 * g.gamma / gp1) * (M1sq - 1);
  const rho2OverRho1 = (gp1 * M1sq) / (gm1 * M1sq + 2);
  const T2OverT1 = p2OverP1 / rho2OverRho1;
  // 总压比 p02/p01（跨过激波）
  const p02OverP01 =
    Math.pow((gp1 * M1sq) / (gm1 * M1sq + 2), g.gamma / gm1) *
    Math.pow((gp1) / (2 * g.gamma * M1sq - gm1), 1 / gm1);
  return { M1, M2, p2OverP1, T2OverT1, rho2OverRho1, p02OverP01, T02OverT01: 1 };
}
