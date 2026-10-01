/** CLI: 建模、校验、单状态计算、剖面计算、版本比较、JSON/CSV 导出。
 *  用法: node dist/src/cli.js <命令> [参数...]
 *  数据目录由 DATA_DIR 环境变量配置, 默认 ./data
 */
import { Service, profileToCsv } from "./service";
import { ProfileResult } from "./solver";

const DATA_DIR = process.env.DATA_DIR ?? "./data";
const svc = new Service(DATA_DIR);
const [cmd, ...args] = process.argv.slice(2);

function out(x: unknown) { console.log(JSON.stringify(x, null, 2)); }
function num(i: number, name: string): number {
  const v = Number(args[i]);
  if (!Number.isFinite(v)) throw new Error(`参数 ${name} 缺失或非法: ${args[i]}`);
  return v;
}

try {
  switch (cmd) {
    case "add-gas":        // add-gas <name> <gamma> <R>
      out(svc.addGas(args[0], num(1, "gamma"), num(2, "R"))); break;
    case "add-geometry":   // add-geometry <name> <throatArea> <a1,a2,...>
      out(svc.addGeometry(args[0], num(1, "throatArea"), args[2].split(",").map(Number))); break;
    case "add-case":       // add-case <gasId> <geomId> <T0> <p0> [shockIndex]
      out(svc.addCase(num(0, "gasId"), num(1, "geomId"), num(2, "T0"), num(3, "p0"),
        args[4] === undefined ? null : num(4, "shockIndex"))); break;
    case "list":           // list <gases|geometries|cases|snapshots>
      out(svc.list(args[0] as any)); break;
    case "state":          // state <gamma> <R> <T0> <p0> <M>
      out(svc.state({ gamma: num(0, "gamma"), R: num(1, "R") },
        { T0: num(2, "T0"), p0: num(3, "p0") }, num(4, "M"))); break;
    case "mach-from-area": // mach-from-area <gamma> <R> <areaRatio> <subsonic|supersonic>
      out(svc.machFromArea({ gamma: num(0, "gamma"), R: num(1, "R") },
        num(2, "areaRatio"), args[3] as any)); break;
    case "shock":          // shock <gamma> <R> <M1>
      out(svc.shock({ gamma: num(0, "gamma"), R: num(1, "R") }, num(2, "M1"))); break;
    case "profile":        // profile <caseId>
      out(svc.profile(num(0, "caseId"))); break;
    case "snapshot":       // snapshot <id> [csv]
      {
        const s = svc.getSnapshot(num(0, "id"));
        if (args[1] === "csv") process.stdout.write(profileToCsv(s.result as ProfileResult));
        else out(s);
      }
      break;
    case "compare":        // compare <snapshotIdA> <snapshotIdB>
      out(svc.compare(num(0, "snapshotIdA"), num(1, "snapshotIdB"))); break;
    default:
      console.error(`未知命令: ${cmd ?? "(空)"}
命令一览:
  add-gas <name> <gamma> <R>
  add-geometry <name> <throatArea> <a1,a2,...>
  add-case <gasId> <geomId> <T0> <p0> [shockIndex]
  list <gases|geometries|cases|snapshots>
  state <gamma> <R> <T0> <p0> <M>
  mach-from-area <gamma> <R> <areaRatio> <subsonic|supersonic>
  shock <gamma> <R> <M1>
  profile <caseId>
  snapshot <id> [csv]
  compare <snapshotIdA> <snapshotIdB>`);
      process.exitCode = 2;
  }
} catch (err: any) {
  console.error("错误: " + String(err?.message ?? err));
  process.exitCode = 1;
} finally {
  svc.close();
}
