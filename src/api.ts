import * as http from "node:http";
import { Service, snapshotToCsv } from "./service";

function send(res: http.ServerResponse, code: number, body: unknown, contentType = "application/json; charset=utf-8") {
  const data = typeof body === "string" ? body : JSON.stringify(body, null, 2);
  res.writeHead(code, { "Content-Type": contentType });
  res.end(data);
}

async function readBody(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
}

export function createServer(service: Service) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;
    try {
      if (req.method === "GET" && path === "/health") return send(res, 200, { ok: true });

      if (req.method === "POST" && path === "/gases") {
        const b = await readBody(req);
        return send(res, 201, service.addGas(b.name ?? "gas", b.gamma, b.R));
      }
      if (req.method === "GET" && path === "/gases") return send(res, 200, service.store.listGases());

      if (req.method === "POST" && path === "/geometries") {
        const b = await readBody(req);
        return send(res, 201, service.addGeometry(b.name ?? "geom", b.version ?? 1, b.throatArea, b.downstreamAreas));
      }
      if (req.method === "GET" && path === "/geometries") return send(res, 200, service.store.listGeometries());

      if (req.method === "POST" && path === "/cases") {
        const b = await readBody(req);
        return send(res, 201, service.addCase(b.name ?? "case", b.gasId, b.geomId, b.T0, b.p0, b.shockAtIndex));
      }
      if (req.method === "GET" && path === "/cases") return send(res, 200, service.store.listCases());

      if (req.method === "POST" && path === "/calc/state") {
        const b = await readBody(req);
        return send(res, 200, service.calcState(b.gasId, b.T0, b.p0, { M: b.M, AR: b.AR, branch: b.branch, A: b.A }));
      }
      if (req.method === "POST" && path === "/calc/shock") {
        const b = await readBody(req);
        return send(res, 200, service.calcShock(b.gasId, b.M1));
      }
      if (req.method === "POST" && path === "/calc/profile") {
        const b = await readBody(req);
        if (b.caseId !== undefined) return send(res, 200, service.runCase(b.caseId));
        // 直接参数模式（不入库工况，仅存快照）
        const { buildProfile } = require("./profile");
        const g = service["mustGas"].call(service, b.gasId);
        const profile = buildProfile(g, b.T0, b.p0, b.throatArea, b.downstreamAreas, b.shockAtIndex);
        const id = service.store.addSnapshot(null, "profile", { gas: g, totals: { T0: b.T0, p0: b.p0 }, profile });
        return send(res, 200, { snapshotId: id, profile });
      }
      if (req.method === "POST" && path === "/compare") {
        const b = await readBody(req);
        return send(res, 200, service.compareSnapshots(b.a, b.b));
      }

      const snapMatch = path.match(/^\/snapshots\/(\d+)$/);
      if (req.method === "GET" && snapMatch) {
        const snap = service.getSnapshot(Number(snapMatch[1]));
        if (url.searchParams.get("format") === "csv")
          return send(res, 200, snapshotToCsv(snap as any), "text/csv; charset=utf-8");
        return send(res, 200, snap);
      }
      if (req.method === "GET" && path === "/snapshots") return send(res, 200, service.store.listSnapshots());

      send(res, 404, { error: `未找到路由 ${req.method} ${path}` });
    } catch (e: any) {
      send(res, 400, { error: e.message ?? String(e) });
    }
  });
}

export function startApi(port: number, dataDir: string) {
  const service = new Service({ dataDir });
  const server = createServer(service);
  server.listen(port, () => console.log(`喷管校核 API 已启动: http://localhost:${port} (数据目录: ${dataDir})`));
  const shutdown = () => { server.close(); service.close(); process.exit(0); };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  return server;
}
