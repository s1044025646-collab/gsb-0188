import { ProfileResult } from "./profile";

export interface CompareRow {
  index: number;
  A1: number; A2: number;
  M1?: number; M2?: number;
  p1?: number; p2?: number;
  mdot1?: number; mdot2?: number;
  mdotRelErr?: number;
}

export interface CompareResult {
  rows: CompareRow[];
  maxMdotRelErr: number;
  shockResiduals?: { a?: object; b?: object };
  totals: { a: { T0: number; p0: number }; b: { T0: number; p0: number } };
}

/** 比较两个剖面快照：逐截面流率误差与激波守恒残差，而非只看压力曲线。 */
export function compareProfiles(a: ProfileResult, b: ProfileResult,
  totalsA: { T0: number; p0: number }, totalsB: { T0: number; p0: number }): CompareResult {
  const rows: CompareRow[] = [];
  const n = Math.max(a.sections.length, b.sections.length);
  let maxErr = 0;
  for (let i = 0; i < n; i++) {
    const s1 = a.sections[i], s2 = b.sections[i];
    const row: CompareRow = {
      index: s1?.index ?? s2?.index ?? i,
      A1: s1?.A ?? NaN, A2: s2?.A ?? NaN,
      M1: s1?.M, M2: s2?.M, p1: s1?.p, p2: s2?.p,
      mdot1: s1?.mdot, mdot2: s2?.mdot,
    };
    if (s1?.mdot !== undefined && s2?.mdot !== undefined) {
      row.mdotRelErr = Math.abs(s2.mdot - s1.mdot) / Math.max(Math.abs(s1.mdot), 1e-300);
      maxErr = Math.max(maxErr, row.mdotRelErr);
    }
    rows.push(row);
  }
  return {
    rows, maxMdotRelErr: maxErr,
    shockResiduals: { a: a.shock?.residuals, b: b.shock?.residuals },
    totals: { a: totalsA, b: totalsB },
  };
}
