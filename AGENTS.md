# MeowCan - AI 编程代理与协作者指南 (AGENTS.md)

本项目使用 Pixi.js v8、WebAudio API、TypeScript、Vite、Rust 和 MySQL 全量重制经典音乐节奏网游《CanMusic》（以及 Lemonball 时代的《New CanMusic》）。游戏引擎和静态资源支持离线运行；账号、RBAC、曲库检索和成绩使用后端服务。

---

## 一、项目全景与目录拓扑

```
MeowCan/
├── README.md                      # 面向人类玩家与开发者的总览与上手指南
├── AGENTS.md                      # 面向 AI 编程代理的代码库结构、规范与约束纲领（本文档）
├── docs/                          # 规范与调研文档
│   ├── spec/                      # 核心系统技术规范（代码实现与演化的权威标准）
│   │   ├── vos-format.md          # VOS 二进制谱面全格式规范 (Classic VOS & Container VOS)
│   │   ├── asset-formats.md       # vimg / vlle / vifont 原生 16 位美术资产规范
│   │   ├── web-architecture.md    # 渲染管线、音频架构、音画动力学方程与判定状态机
│   │   └── flood-mode.md          # 水淹模式 (Sudden / Flood Mode) 原版游戏与动力学规范
│   └── research/                  # 历史原版游戏工程、LTF 分析与曲库调研资料
├── ref/                           # 现有原始参考资产（只读研究）
│   ├── CanMusic/                  # 2002-2004 原版客户端程序、专有格式图片、音效
│   └── MyCanMusic/                # 8,000+ 首官方与玩家自制 .vos 谱面库与单机版客户端
├── backend/                       # Rust/Axum API、MySQL 迁移与 RBAC
│   ├── migrations/               # 数据库结构和基础角色权限
│   └── src/                      # 认证、曲库、成绩与管理接口
└── web/                           # 核心前端重制版工程 (Vite + Pixi.js v8)
    ├── index.html                 # 街机框体与 UI 挂载入口
    ├── package.json               # 依赖管理 (pixi.js v8, vite, typescript)
    ├── vite.config.ts             # Vite 配置
    ├── wrangler.json              # Cloudflare Workers 静态资产托管配置
    ├── public/                    # 提取转换后的静态资产
    │   ├── assets/                # bg.png, can.png, hitbar0.png, note_skin0.png 等
    │   ├── songs.json             # 内置 20 首经典曲目元数据列表
    │   └── songs/                 # 内置 20 首精选 .vos 二进制谱面
    ├── scripts/
    │   └── convert_assets.js      # 离线提取脚本 (RGB565 / vlle -> PNG 管道)
    └── src/
        ├── audio/
        │   └── synth.ts           # WebAudio 软音源、Keysound 触发与 Lookahead BGM 调度器
        ├── game/
        │   ├── judgment.ts        # 7 键判定引擎、时间窗口、连击计算与生命能量槽
        │   └── renderer.ts        # Pixi.js v8 舞台渲染管线 (Can 跑道、粒子、PDA CRT 屏)
        ├── parser/
        │   └── vos.ts             # 双代际 VOS 容器与 MIDI Tempo 分段线性时间曲线解析器
        └── main.ts                # 主控循环、音画对齐与按键事件监听
```



## 三、常用命令与环境指引

系统环境已预装 **Node.js (v22+)** 和 **Bun (v1.3+)**，运行在 Windows 平台（PowerShell）。

### 1. 开发与构建
```powershell
cd web
bun install        # 安装依赖
bun run dev        # 启动热重载开发服务器
bun run build      # 构建生产环境代码到 dist/
bun run build:charts # 重新生成内置曲目的谱面长图
bun run preview    # 本地预览构建产物
```

后端开发需要先建立 SSH 隧道，再启动 Rust 服务：

```powershell
ssh -N -L 3307:127.0.0.1:3307 dev135
cd backend
cargo test
cargo run
```

### 2. 自动化验证与浏览器交互
进行自动化测试验证时（例如使用 Playwright 或 Headless Chromium）：
- **本地服务验证**：直接访问 `http://localhost:3000` 或 `http://localhost:5173`，无需走代理。
- **外部网络/远程部署验证**：由于本机配置了本地代理端口 `http://localhost:1856`，在 Node/Playwright 脚本访问公网环境时，需设置：
  ```javascript
  const browser = await chromium.launch({
    proxy: { server: 'http://localhost:1856' }
  });
  ```

### 3. 部署与发布
项目已配置 Cloudflare Workers 静态托管（`web/wrangler.json`）：
```powershell
cd web
bun run build
npx wrangler deploy
```

---

## 四、核心模块开发与修改指南

| 模块路径 | 职责范围 | 修改注意事项 |
| :--- | :--- | :--- |
| `web/src/parser/vos.ts` | 负责双代际（Classic inf/mid 段表 + VOS022 容器）二进制解析与 MIDI Tempo 时间映射 | 保持字节对齐，16 字节 Note 结构与 13 字节 Note 结构分支逻辑分离，维护时间排序 |
| `web/src/audio/synth.ts` | WebAudio 软音源合成器、Lookahead 调度器、打击乐与 WAV 音效 | 必须使用 `AudioParam.setValueAtTime` 避免爆音；复音释放时及时断开节点；避免垃圾回收停顿 |
| `web/src/game/judgment.ts` | 7 键按键判定状态机、时间窗口（COOL $\pm 45$ms 等）、长按判定、生命能量槽 | 严格处理按键抬起（KeyUp）的长按结算，按键防抖与幽灵击键过滤 |
| `web/src/game/renderer.ts` | Pixi.js v8 舞台渲染管线、7 轨跑道、糖果音符、粒子爆炸、PDA CRT 屏 | 维持视锥体裁剪（屏幕外音符提早 break），图元复用，严格遵循原版 16 色配色表与 `hitbar0` 定位 |
| `web/src/game/chart-layout.ts` | 谱面长图的公共时间轴与纵向布局 | 离线生成和浏览器生成必须复用此模块，禁止分别实现坐标换算 |
| `web/src/game/chart-exporter.ts` | 检测、下载或即时生成谱面长图 | 先验证本地响应确实为 PNG，再回退到 VOS 解析与 Canvas 生成 |
| `web/src/main.ts` | 全局事件枢纽、AudioContext 激活、UI 交互抽屉、调速与 Auto-Play | 维持浏览器用户手势激活音频策略 |
| `web/scripts/convert_assets.js` | 离线资产提取工具（原版游戏解析 RGB565 `vimg` / `vlle` / `vifont` 转 PNG） | 若从 `ref/` 提取新美术资源，通过此脚本批量转换输出至 `web/public/assets/` |
| `web/scripts/generate_charts.ts` | 批量生成内置曲目的谱面长图 | 修改布局或素材后运行 `bun run build:charts`，并提交更新后的 `web/public/charts/` |
| `backend/src/auth.rs` | 注册、登录、会话与权限提取 | 密码必须使用 Argon2id；数据库只保存会话令牌摘要；接口按权限授权 |
| `backend/src/scores.rs` | 成绩写入与个人前 5 排名 | 插入和清理必须位于同一事务；并发提交必须按用户串行化 |
| `backend/migrations/` | MySQL 表结构和 RBAC 基础数据 | 已发布的迁移不可改写；结构变更必须新增迁移 |

---

## 五、谱面长图开发注意事项

- 游戏与长图统一使用 768 PPQ 的 `MUSIC_TIME`。禁止用歌曲秒数和固定 BPM 估算 tick；缺少原始 tick 时，必须通过 `tempoMap` 换算。
- 长图按下落式游戏的阅读习惯排布：底部是开始，时间从下往上推进。短音符和长音符使用接触点定位，不以精灵左上角作为时间点。
- 图片范围以最后一个可玩音符为准。歌曲总时长可能包含伴奏尾音或错误元数据，不能用于推算长图高度。
- 导出时先请求 `/charts/<文件名>.png`，并检查 PNG 文件签名。开发服务器可能对不存在的静态文件返回 `index.html` 和 `200` 状态码，仅检查 `HEAD` 或 `response.ok` 会误判。
- 本地图片不存在时，再读取并解析 VOS 文件。这样可以避免已有长图时重复下载和解析谱面。
- 修改生成逻辑后，至少运行 `bun test`、`bun run build:charts` 和 `bun run build`。

## 六、界面适配原则

- 前端界面以 PC 和平板电脑横屏为主要适配目标。只需验证桌面端和平板电脑横屏布局。
- 平板电脑竖屏和小屏手机只需保持核心流程可用，不要求进行精细的视觉优化。
