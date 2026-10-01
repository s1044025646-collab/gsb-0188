import { Service, snapshotToCsv } from "./service";
import { startApi } from "./api";
import * as fs from "node:fs";

function parseArgs(argv: string[]) {
  const args: Record<string, string> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const k = argv[i].slice(2);
      if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) args[k] = argv[++i];
      else args[k] = "true";
    } else positional.push(argv[i]);
  }
  return { args, positional };
}

const num = (v: string | undefined, name: string): number => {
  if (v === undefined) throw new Error(`缺少参数 --${name}`);
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`参数 --${name} 必须是数字，收到 "${v}"`);
  return n;
};

const DEFAULT_DIR = process.env.NOZZLE_DATA_DIR ?? "data";

export function runCli(argv: string[]): void {
  const { args, positional } = parseArgs(argv);
  const [cmd, sub] = positional;
  const dataDir = args["data-dir"] ?? DEFAULT_DIR;

  if (cmd === "serve") {
    const port = Number(args.port ?? process.env.PORT ?? 8080);
    startApi(port, dataDir);
    return;
  }
  if (cmd === "demo") { require("./demo").runDemo(dataDir); return; }

  const svc = new Service({ dataDir });
  try {
    switch (`${cmd} ${sub ?? ""}`.trim()) {
      case "gas add":
        console.log(JSON.stringify(svc.addGas(args.name ?? "gas", num(args.gamma, "gamma"), num(args.R, "R"))));
        break;
      case "gas list": console.table(svc.store.listGases()); break;
      case "geom add": {
        const areas = (args.areas ?? "").split(",").map(s => Number(s.trim())).filter(n => Number.isFinite(n));
        console.log(JSON.stringify(svc.addGeometry(args.name ?? "geom", Number(args.version ?? 1), num(args.throat, "throat"), areas)));
        break;
      }
      case "geom list": console.table(svc.store.listGeometries()); break;
      case "case add":
        console.log(JSON.stringify(svc.addCase(args.name ?? "case", num(args.gas, "gas"), num(args.geom, "geom"),
          num(args.T0, "T0"), num(args.p0, "p0"), args["shock-at"] !== undefined ? Number(args["shock-at"]) : undefined)));
        break;
      case "case list": console.table(svc.store.listCases()); break;
      case "state": {
        const r = svc.calcState(num(args.gas, "gas"), num(args.T0, "T0"), num(args.p0, "p0"), {
          M: args.M !== undefined ? Number(args.M) : undefined,
          AR: args.AR !== undefined ? Number(args.AR) : undefined,
          branch: args.branch as any,
          A: args.A !== undefined ? Number(args.A) : undefined,
        });
        console.log(JSON.stringify(r, null, 2));
        break;
      }
      case "shock":
        console.log(JSON.stringify(svc.calcShock(num(args.gas, "gas"), num(args.M1, "M1")), null, 2));
        break;
      case "run": console.log(JSON.stringify(svc.runCase(num(args.case, "case")), null, 2)); break;
      case "compare":
        console.log(JSON.stringify(svc.compareSnapshots(num(args.a, "a"), num(args.b, "b")), null, 2));
        break;
      case "snapshots": console.table(svc.store.listSnapshots()); break;
      case "export": {
        const snap = svc.getSnapshot(num(args.snapshot, "snapshot"));
        const fmt = args.format ?? "json";
        const out = fmt === "csv" ? snapshotToCsv(snap as any) : JSON.stringify(snap, null, 2) + "\n";
        if (args.out) { fs.writeFileSync(args.out, out); console.log(`已导出到 ${args.out}`); }
        else process.stdout.write(out);
        break;
      }
      default:
        console.log(`用法: nozzle <命令> [选项]
  serve --port 8080 [--data-dir data]     启动 API 服务
  gas add --gamma 1.4 --R 287 [--name air]
  gas list
  geom add --throat 0.01 --areas 0.015,0.02,0.03 [--name v1] [--version 1]
  geom list
  case add --gas 1 --geom 1 --T0 300 --p0 101325 [--shock-at 1] [--name run1]
  case list
  state --gas 1 --T0 300 --p0 101325 (--M 2 | --AR 2 --branch supersonic) [--A 0.02]
  shock --gas 1 --M1 2
  run --case 1
  compare --a 1 --b 2
  snapshots
  export --snapshot 1 --format csv [--out file.csv]
  demo                                     运行演示（无激波 vs 指定激波剖面）`);
    }
  } finally {
    svc.close();
  }
}

if (require.main === module) {
  try { runCli(process.argv.slice(2)); }
  catch (e: any) { console.error(`错误: ${e.message ?? e}`); process.exit(1); }
}
