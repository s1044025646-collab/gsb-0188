# 准一维喷管流动与正激波校核后端

纯后端离线数值实验服务：理想气体准一维喷管等熵流动 + 正激波校核。
技术栈：TypeScript + Node.js + SQLite（Node 内置 node:sqlite，无原生编译依赖）。
仅提供 HTTP API 与 CLI，无界面、无网格、无可视化，不依赖 Docker / WSL / 在线服务。

## 模型假设与适用范围

- 定比热理想气体：p = rho * R * T，cp、cv 为常数，gamma = cp/cv > 1
- 稳态、绝热、无摩擦、准一维流动；激波为一道正激波（Rankine-Hugoniot 跳变）
- 所有压力、温度均为绝对单位：Pa、K
- 适用：连续介质完全气体、喷管扩张段（截面自喉部严格递增）
- 不覆盖：真实气体效应、黏性/边界层、激波-边界层干扰、二维/三维效应、非定常现象
- 激波位置由用户显式指定，不做任意背压下的激波自动定位

## 公式

- 等熵：T/T0 = (1 + (g-1)/2 M^2)^-1；p/p0 = (T/T0)^(g/(g-1))；rho/rho0 = (T/T0)^(1/(g-1))
- 面积-马赫数：A/A* = (1/M) [ 2/(g+1) (1 + (g-1)/2 M^2) ]^((g+1)/(2(g-1)))
- 正激波（上游 M1>1）：
  - M2^2 = (1 + (g-1)/2 M1^2) / (g M1^2 - (g-1)/2)
  - p2/p1 = 1 + 2g/(g+1) (M1^2 - 1)
  - rho2/rho1 = (g+1) M1^2 / ((g-1) M1^2 + 2)；T2/T1 = (p2/p1)/(rho2/rho1)
  - p02/p01 = [ ((g+1)M1^2)/((g-1)M1^2+2) ]^(g/(g-1)) [ (g+1)/(2g M1^2-(g-1)) ]^(1/(g-1))

## 数值方法

- 面积-马赫数反解：牛顿迭代（解析导数）+ 分支内二分兜底。
  - 分支由调用者显式指定（subsonic / supersonic），初值为分支内固定值，分支不由初值偶然决定
  - A/A* = 1 直接返回临界状态 M = 1；A/A* < 1 拒绝求解
  - 不收敛时抛出错误，绝不返回未收敛值；结果附带残差与迭代次数诊断
- 剖面：喉部（M=1）质量流率最大；无激波剖面全程超声速分支；
  指定激波剖面在激波后按新总压、新临界面积 A2* = A1* / (p02/p01) 取亚声速分支
- 校核量：逐截面质量流率相对误差、激波前后质量/动量/能量守恒残差、总压损失

## 运行（Windows 本地，Node >= 22）

    npm install      # 仅开发依赖 typescript / @types/node
    npm run build    # 编译到 dist/
    npm test         # 构建并运行全部测试
    npm start        # 启动 API，默认端口 8018（PORT 环境变量可改）
    npm run cli -- <命令>
    npm run demo     # 演示：无激波 vs 指定激波剖面差异与残差

配置：端口 PORT（默认 8018）；数据目录 DATA_DIR（默认 ./data，SQLite 文件 nozzle.db 在其中）。

## CLI 命令

    add-gas <name> <gamma> <R>
    add-geometry <name> <throatArea> <a1,a2,...>     # 截面积须严格递增且大于喉部
    add-case <gasId> <geomId> <T0> <p0> [shockIndex] # 不给 shockIndex 即无激波工况
    list <gases|geometries|cases|snapshots>
    state <gamma> <R> <T0> <p0> <M>                  # 单状态等熵换算
    mach-from-area <gamma> <R> <areaRatio> <subsonic|supersonic>
    shock <gamma> <R> <M1>
    profile <caseId>                                 # 计算剖面并保存快照
    snapshot <id> [csv]                              # JSON / CSV 导出
    compare <snapshotIdA> <snapshotIdB>              # 版本比较(流率误差+激波残差)

## HTTP API（JSON）

- POST /api/gases {name,gamma,R}
- POST /api/geometries {name,throatArea,areas}
- POST /api/cases {gasId,geometryId,T0,p0,shockIndex?}
- GET  /api/list/:table
- POST /api/state {gamma,R,T0,p0,M}
- POST /api/mach-from-area {gamma,R,areaRatio,branch}
- POST /api/shock {gamma,R,M1}
- POST /api/profile {caseId}            计算并保存快照
- GET  /api/snapshots/:id 与 /api/snapshots/:id.csv
- POST /api/compare {snapshotIdA,snapshotIdB}
- GET  /api/health

错误（非法物性、面积比<1、亚声速激波、非递增几何、未收敛等）统一返回 400 {error} 并附中文说明。

## 数据库

四张表：gases（气体参数）、geometries（几何版本：喉部面积+截面序列）、
cases（工况：气体+几何+入口总态+可选激波位置）、snapshots（计算快照，完整 JSON 结果）。
快照落盘后可跨进程重启复现（有对应测试）。

## 测试与示例

test/physics.test.ts 共 14 项，覆盖：

- 等熵换算往返（M → A/A* → M，两个分支）
- gamma=1.4 可手算参考值（M=2：T/T0=0.5556、p/p0=0.1278、A/A*=1.6875）
- 临界面积（A/A*=1 → M=1）与面积比<1 拒绝
- 喉部质量流率最大
- 正激波已知解（M1=2 → M2=0.5774、p2/p1=4.5、T2/T1=1.6875、rho2/rho1=2.6667、p02/p01=0.7209）
- 激波前后质量/动量/能量守恒（残差 < 1e-12）
- 弱激波极限（M1→1+ 各比值→1）
- 非法物性、亚声速激波、非递增几何的拒绝
- 快照写入 SQLite 后重开复现

npm run demo 打印无激波剖面与在 index=2 截面放置正激波的剖面对比，
含逐截面 M/p 差异、质量流率误差（约 1e-14 量级）与激波守恒残差（约 1e-16 量级）。

## 已知限制

- 仅准一维、稳态、无黏；不做背压反推激波位置；不做非设计工况自动判别
- node:sqlite 在 Node 25 仍标记为 experimental（启动时有警告，不影响功能）
- 激波后临界面积恒小于激波处截面，故严格递增几何下波后亚声速段总可达；
  代码仍保留面积比<1 的防御性检查
