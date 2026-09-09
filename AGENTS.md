# MeowCan - AI 编程代理与协作者指南 (AGENTS.md)

本项目致力于使用现代 Web 前端技术（Pixi.js v8 + WebAudio API + TypeScript + Vite）全量重制经典音乐节奏网游《CanMusic》（以及 Lemonball 时代的《New CanMusic》），实现**纯前端、零后端、零外部庞大波表依赖、离线可用**的经典单机网页版。

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
│   │   └── web-architecture.md    # 渲染管线、音频架构、音画动力学方程与判定状态机
│   └── research/                  # 历史逆向工程、LTF 分析与曲库调研资料
├── ref/                           # 现有原始参考资产（只读研究）
│   ├── CanMusic/                  # 2002-2004 原版客户端程序、专有格式图片、音效
│   └── MyCanMusic/                # 8,000+ 首官方与玩家自制 .vos 谱面库与单机版客户端
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
        └── main.ts                # 主控循环、音画对齐、按键事件监听与本地文件拖拽
```



## 三、常用命令与环境指引

系统环境已预装 **Node.js (v22+)** 和 **Bun (v1.3+)**，运行在 Windows 平台（PowerShell）。

### 1. 开发与构建
```powershell
cd web
bun install        # 安装依赖
bun run dev        # 启动热重载开发服务器
bun run build      # 构建生产环境代码到 dist/
bun run preview    # 本地预览构建产物
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
| `web/src/main.ts` | 全局事件枢纽、AudioContext 激活、UI 交互抽屉、调速、Auto-Play、文件拖放 | 维持浏览器用户手势激活音频策略，处理拖放二进制 ArrayBuffer 读取 |
| `web/scripts/convert_assets.js` | 离线资产提取工具（逆向解析 RGB565 `vimg` / `vlle` / `vifont` 转 PNG） | 若从 `ref/` 提取新美术资源，通过此脚本批量转换输出至 `web/public/assets/` |