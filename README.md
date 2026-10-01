# 准一维喷管流动与正激波校核后端

纯后端离线数值实验服务：TypeScript + Node.js + SQLite（`node:sqlite`，零原生依赖、零外部服务），提供 HTTP API 与 CLI。在 Windows 本地直接运行，不需要 Docker / WSL / 任何在线 API。

## 物理模型与适用范围

- 理想气体、**定比热**、**稳态、绝热、无摩擦**的准一维流动。
- 所有压力、温度均为**绝对单位**：Pa、K；气体常数 R 单位 J/(kg·K)。
- 等熵关系（`src/gas.ts`）：
  - `T0/T = 1 + (γ-1)/2·M²`，`p0/p = (T0/T)^(γ/(γ-1))`，`ρ0/ρ = (T0/T)^(1/(γ-1))`
  - 面积-马赫数关系 `A/A* = (1/M)·[(2/(γ+1))(1+(γ-1)/2·M²)]^((γ+1)/(2(γ-1)))`
  - 质量流率 `ṁ = ρ·V·A`，喉部（M=1）壅塞流率 `ṁ* = p0·A*·√(γ/(R·T0))·(1+(γ-1)/2)^(-(γ+1)/(2(γ-1)))`
- 正激波（Rankine–Hugoniot）：输出 M2、p2/p1、T2/T1、ρ2/ρ1、总压恢复 p02/p01（绝热激波 T02=T01）。**上游必须 M1>1**，亚声速/声速输入直接拒绝。
- 适用范围：完全气体、γ 恒定、截面缓变、远离强三维效应的喷管流动。**不覆盖**黏性、边界层、热传导、凝结与非定常现象；不做任意背压下的激波自动定位（激波位置由用户显式指定）。

## 面积-马赫数反解约定

- `A/A* = 1`：返回临界状态 M=1。
- `A/A* < 1`：物理上不存在，直接拒绝。
- `A/A* > 1`：必须显式指定 `subsonic` 或 `supersonic` 分支。求解采用固定区间 + 带保护的牛顿法（越界退化二分），初值固定、**不决定分支**；不收敛时抛错，**绝不返回未收敛值**。每次求解保留残差与迭代次数诊断。

## 构建 / 测试 / 启动 / 演示

```powershell
npm install
npm run build     # 编译 TypeScript 到 dist/
npm test          # 构建并运行全部单元测试（node:test）
npm start         # 启动 API（默认端口 8080，数据目录 data/）
npm run demo      # 演示：无激波 vs 指定激波剖面的差异与数值残差
```

端口与数据目录可配置：`node dist/src/cli.js serve --port 9000 --data-dir mydata`，或环境变量 `PORT` / `NOZZLE_DATA_DIR`。数据库文件为 `<数据目录>/nozzle.db`。

## CLI

```
node dist/src/cli.js gas add --gamma 1.4 --R 287 --name air
node dist/src/cli.js geom add --throat 0.01 --areas 0.015,0.02,0.03 --name v1 --version 1
node dist/src/cli.js case add --gas 1 --geom 1 --T0 300 --p0 101325 [--shock-at 1] --name run1
node dist/src/cli.js state --gas 1 --T0 300 --p0 101325 --AR 2 --branch supersonic [--A 0.02]
node dist/src/cli.js state --gas 1 --T0 300 --p0 101325 --M 2
node dist/src/cli.js shock --gas 1 --M1 2
node dist/src/cli.js run --case 1            # 计算剖面并存快照
node dist/src/cli.js compare --a 1 --b 2     # 比较两个剖面快照
node dist/src/cli.js export --snapshot 1 --format csv --out out.csv
node dist/src/cli.js snapshots | gas list | geom list | case list
```

## HTTP API（默认 http://localhost:8080）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 健康检查 |
| POST/GET | `/gases` | 新增 / 列出气体（gamma、R） |
| POST/GET | `/geometries` | 新增 / 列出几何版本（throatArea、downstreamAreas[]） |
| POST/GET | `/cases` | 新增 / 列出工况（gasId、geomId、T0、p0、可选 shockAtIndex） |
| POST | `/calc/state` | 单状态：`{gasId,T0,p0,M}` 或 `{gasId,T0,p0,AR,branch}`，可选 A |
| POST | `/calc/shock` | 正激波关系：`{gasId,M1}` |
| POST | `/calc/profile` | 剖面：`{caseId}` 或直接 `{gasId,T0,p0,throatArea,downstreamAreas,shockAtIndex?}` |
| POST | `/compare` | 比较两个剖面快照：`{a,b}`，输出逐截面流率误差与激波守恒残差 |
| GET | `/snapshots` / `/snapshots/:id?format=json\|csv` | 快照查询与导出 |

错误以 `{"error": "中文说明"}` 返回（HTTP 400），包括非法物性、面积比<1、未指定分支、亚声速激波、非递增截面、质量不守恒等。

## 剖面语义

- 无激波：喉部 M=1，全部下游截面取超声速分支（要求面积自喉部严格递增）。
- 指定激波：`shockAtIndex` 处先取超声速状态，跨激波后总温不变、总压按 p02/p01 下降，临界面积增大为 `A*' = A/A*(M2)`，后续截面按新总态与新 A* 取亚声速分支。
- 每个剖面强制校核各截面质量流率一致（相对误差 >1e-6 即拒绝拼接结果）。
- 激波处输出质量、动量、能量归一化残差（机器精度量级）。

## 测试覆盖（`test/nozzle.test.ts`，13 项）

等熵换算往返、分支语义与拒绝、γ=1.4 手算基准（M=2：T0/T=1.8、p0/p≈7.824、A/A*≈1.6875）、喉部流率最大、M1=2 正激波手算基准（p2/p1=4.5、T2/T1=1.6875、ρ2/ρ1=8/3、M2≈0.5774、p02/p01≈0.7209）、激波三守恒、弱激波极限（M1→1 退化）、非法物性拒绝、剖面流率一致性、不相容几何拒绝、SQLite 重启后快照复现、版本比较报告。

## 已知限制

- 不做任意背压下的激波自动定位；激波位置必须由用户指定。
- 不支持变比热、化学反应、两相流、黏性/边界层与非定常计算。
- `node:sqlite` 在 Node 25 仍为实验特性（启动时有 ExperimentalWarning，功能稳定可用）。
