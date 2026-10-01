/** HTTP API (node:http, 无外部依赖)。端口由 PORT 环境变量配置, 默认 8018。 */
import * as http from "node:http";
import { Service, profileToCsv } from "./service";
import { ProfileResult } from "./solver";

const PORT = Number(process.env.PORT ?? 8018);
const DATA_DIR = process.env.DATA_DIR ?? "./data";
const svc = new Service(DATA_DIR);

function send(res: http.ServerResponse, code: number, body: unknown, contentType = "application/json; charset=utf-8") {
  const text = typeof body === "string" ? body : JSON.stringify(body, null, 2);
  res.writeHead(code, { "Content-Type": contentType });
  res.end(text);
}

async function readBody(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const p = url.pathname;
  try {
    // 建模
    if (req.method === "POST" && p === "/api/gases") {
      const b = await readBody(req);
      return send(res, 201, svc.addGas(b.name ?? "gas", b.gamma, b.R));
    }
    if (req.method === "POST" && p === "/api/geometries") {
      const b = await readBody(req);
      return send(res, 201, svc.addGeometry(b.name ?? "geom", b.throatArea, b.areas));
    }
    if (req.method === "POST" && p === "/api/cases") {
      const b = await readBody(req);
      return send(res, 201, svc.addCase(b.gasId, b.geometryId, b.T0, b.p0, b.shockIndex ?? null));
    }
    if (req.method === "GET" && p.startsWith("/api/list/")) {
      const table = p.split("/")[3] as any;
      if (!["gases", "geometries", "cases", "snapshots"].includes(table)) throw new Error("未知表 " + table);
      return send(res, 200, svc.list(table));
    }
    // 单状态计算
    if (req.method === "POST" && p === "/api/state") {
      const b = await readBody(req);
      return send(res, 200, svc.state({ gamma: b.gamma, R: b.R }, { T0: b.T0, p0: b.p0 }, b.M));
    }
    if (req.method === "POST" && p === "/api/mach-from-area") {
      const b = await readBody(req);
      return send(res, 200, svc.machFromArea({ gamma: b.gamma, R: b.R }, b.areaRatio, b.branch));
    }
    if (req.method === "POST" && p === "/api/shock") {
      const b = await readBody(req);
      return send(res, 200, svc.shock({ gamma: b.gamma, R: b.R }, b.M1));
    }
    // 剖面计算 / 快照 / 比较 / 导出
    if (req.method === "POST" && p === "/api/profile") {
      const b = await readBody(req);
      return send(res, 200, svc.profile(b.caseId));
    }
    const snapMatch = p.match(/^\/api\/snapshots\/(\d+)(\.csv)?$/);
    if (req.method === "GET" && snapMatch) {
      const s = svc.getSnapshot(Number(snapMatch[1]));
      if (snapMatch[2]) {
        return send(res, 200, profileToCsv(s.result as ProfileResult), "text/csv; charset=utf-8");
      }
      return send(res, 200, s);
    }
    if (req.method === "POST" && p === "/api/compare") {
      const b = await readBody(req);
      return send(res, 200, svc.compare(b.snapshotIdA, b.snapshotIdB));
    }
    if (req.method === "GET" && p === "/api/health") {
      return send(res, 200, { ok: true });
    }
    send(res, 404, { error: `未找到路由 ${req.method} ${p}` });
  } catch (err: any) {
    send(res, 400, { error: String(err?.message ?? err) });
  }
});

server.listen(PORT, () => {
  console.log(`喷管/激波校核 API 已启动: http://localhost:${PORT} (数据目录: ${DATA_DIR})`);
});
