import { Gas, StateResult, ShockResult, SolveDiag, areaRatio, machFromAreaRatio, normalShock, stateFromTotal } from "./gas";

export interface SectionResult extends StateResult {
  index: number;
  x?: number;
  A: number;
  AR: number;         // 相对当前有效临界面积 A*
  branch: "subsonic" | "supersonic" | "critical";
  diag: SolveDiag;
}

export interface ProfileResult {
  kind: "shock-free" | "with-shock";
  sections: SectionResult[];
  shock?: {
    atIndex: number;
    upstream: StateResult;
    relations: ShockResult;
    downstreamTotal: { T0: number; p0: number };
    newAStar: number;
    residuals: { mass: number; momentum: number; energy: number };
  };
  mdot: number;
  AStar: number;
}

/** 激波前后守恒残差（应≈0）：质量 ρVA、动量 p+ρV²、能量 h0=cp·T0。 */
export function shockResiduals(g: Gas, up: StateResult, down: StateResult, A: number) {
  const cp = g.gamma * g.R / (g.gamma - 1);
  const m1 = up.rho * up.V * A, m2 = down.rho * down.V * A;
  const mom1 = (up.p + up.rho * up.V * up.V) * A, mom2 = (down.p + down.rho * down.V * down.V) * A;
  const e1 = m1 * cp * up.T0, e2 = m2 * cp * down.T0;
  return {
    mass: (m2 - m1) / Math.max(Math.abs(m1), 1e-300),
    momentum: (mom2 - mom1) / Math.max(Math.abs(mom1), 1e-300),
    energy: (e2 - e1) / Math.max(Math.abs(e1), 1e-300),
  };
}

function sectionState(g: Gas, T0: number, p0: number, A: number, AStar: number,
  branch: "subsonic" | "supersonic", index: number): SectionResult {
  const AR = A / AStar;
  if (Math.abs(AR - 1) < 1e-10) {
    const s = stateFromTotal(g, T0, p0, 1, A);
    return { ...s, index, A, AR: 1, branch: "critical", diag: { iterations: 0, residual: 0, converged: true, method: "critical" } };
  }
  const { M, diag } = machFromAreaRatio(g, AR, branch);
  const s = stateFromTotal(g, T0, p0, M, A);
  return { ...s, index, A, AR, branch, diag };
}

/**
 * 由喉部面积与递增下游截面生成剖面。
 * shockAtIndex 为空：全程无激波超声速；否则在该截面放置一次正激波，之后按新总态与新 A* 走亚声速段。
 */
export function buildProfile(
  g: Gas, T0: number, p0: number,
  throatArea: number, downstreamAreas: number[],
  shockAtIndex?: number
): ProfileResult {
  if (!(throatArea > 0)) throw new Error("喉部面积必须为正值");
  if (downstreamAreas.length === 0) throw new Error("至少需要一个下游截面");
  for (let i = 0; i < downstreamAreas.length; i++) {
    const A = downstreamAreas[i];
    if (!(A > 0)) throw new Error(`截面 ${i} 面积必须为正值`);
    if (A <= throatArea) throw new Error(`截面 ${i} 面积 ${A} 必须大于喉部面积 ${throatArea}（超声速段要求扩张）`);
    if (i > 0 && A <= downstreamAreas[i - 1]) throw new Error(`截面面积必须严格递增（截面 ${i} 违反）`);
  }
  if (shockAtIndex !== undefined) {
    if (!Number.isInteger(shockAtIndex) || shockAtIndex < 0 || shockAtIndex >= downstreamAreas.length)
      throw new Error(`激波位置索引 ${shockAtIndex} 超出下游截面范围 [0, ${downstreamAreas.length - 1}]`);
  }

  const AStar = throatArea;
  const sections: SectionResult[] = [];
  const shockIdx = shockAtIndex ?? -1;

  // 喉部
  const throat = stateFromTotal(g, T0, p0, 1, throatArea);
  sections.push({ ...throat, index: -1, A: throatArea, AR: 1, branch: "critical", diag: { iterations: 0, residual: 0, converged: true, method: "critical" } });
  const mdot = throat.mdot!;

  let shock: ProfileResult["shock"];
  let curT0 = T0, curP0 = p0, curAStar = AStar;

  for (let i = 0; i < downstreamAreas.length; i++) {
    const A = downstreamAreas[i];
    if (i === shockIdx) {
      // 激波前：超声速状态
      const up = sectionState(g, curT0, curP0, A, curAStar, "supersonic", i);
      const rel = normalShock(g, up.M);
      const downT0 = curT0; // 绝热正激波总温不变
      const downP0 = curP0 * rel.p02OverP01;
      const down = stateFromTotal(g, downT0, downP0, rel.M2, A);
      const res = shockResiduals(g, up, down, A);
      const newAStar = A / areaRatio(g, rel.M2);
      shock = { atIndex: i, upstream: up, relations: rel, downstreamTotal: { T0: downT0, p0: downP0 }, newAStar, residuals: res };
      curT0 = downT0; curP0 = downP0; curAStar = newAStar;
      sections.push({ ...down, index: i, A, AR: A / newAStar, branch: "subsonic", diag: up.diag });
    } else if (shockIdx >= 0 && i > shockIdx) {
      sections.push(sectionState(g, curT0, curP0, A, curAStar, "subsonic", i));
    } else {
      sections.push(sectionState(g, curT0, curP0, A, curAStar, "supersonic", i));
    }
  }

  // 质量守恒校核：所有截面 mdot 必须一致
  for (const s of sections) {
    const err = Math.abs((s.mdot! - mdot) / mdot);
    if (err > 1e-6) throw new Error(`截面 ${s.index} 质量流率不一致（相对误差 ${err}），拒绝拼接违反质量守恒的结果`);
  }

  return { kind: shock ? "with-shock" : "shock-free", sections, shock, mdot, AStar };
}
