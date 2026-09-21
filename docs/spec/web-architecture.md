# MeowCan Web 技术架构规范 (Web Architecture Specification)

> **版本**：2.0.0
> **适用范围**：`web/` 前端与 `backend/` 服务端的职责边界、数据流和运行约束。

---

## 一、系统架构拓扑

系统采用静态资源与业务 API 分离的架构。浏览器负责低延迟的判定、音频、渲染和 VOS 解析。Rust 服务负责持久化数据和权限校验。

```text
浏览器 ── /api ──> Rust/Axum ──> MySQL 8
  │                    │
  └── 静态资源 ────────┴── 账号、RBAC、曲库元数据、个人前 5 成绩
```

以下内容必须留在前端：

- WebAudio 硬件时钟、按键判定和 Keysound 调度。
- Pixi.js 渲染和输入状态。
- VOS 二进制解析，以及本地文件拖放。
- VOS、PNG 和 WAV 等大体积不可变资源。

以下内容必须通过后端处理：

- 注册、登录、注销和会话续存。
- 角色、权限、用户状态和管理操作。
- 曲库元数据检索。
- 成绩写入、排名和个人前 5 清理。

```
                           用户交互 (Keyboard / Touch / Mouse)
                                           │
                                           ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           MeowCan Web Application                               │
├──────────────────────────────────────┬──────────────────────────────────────────┤
│           渲染中枢 (Pixi.js v8)       │           音频中枢 (WebAudio API)         │
│  - 7 轨半透明易拉罐舞台 (Can Highway) │  - 零延迟按键发音 (Keysound)              │
│  - 心形糖果音符 / 长按光带 (Notes)    │  - 超前调度伴奏 (Lookahead BGM Scheduler) │
│  - 打击粒子爆炸帧动画 (Hit Bursts)    │  - 通用 MIDI 多复音合成器 (GM Synth)       │
│  - 街机 PDA CRT 屏与闪耀 Combo 数字   │  - 原版 WAV 音效播放器 (SFX Player)       │
├──────────────────────────────────────┴──────────────────────────────────────────┤
│                          时钟主控与判定核心 (Core Engine)                         │
│  - Master Clock: AudioContext.currentTime (微秒级硬件时基)                       │
│  - 7 键判定状态机: COOL (±210 tick), BAD (±360 tick), MISS                      │
│  - 长按追踪: Held MUSIC_TIME Duration & Tail Release Judgement                  │
├─────────────────────────────────────────────────────────────────────────────────┤
│                          乐谱与数据层 (Chart & Parser)                           │
│  - 纯前端双代际 VOS 解析器 (Classic VOS + CanMusic Container VOS)                │
│  - MIDI Set Tempo 映射 (PPQ=768 -> Seconds 物理时间轴)                           │
│  - EUC-KR / GBK 多语言字符集自适应解码器                                         │
│  - 外部任意本地 .vos 文件即时拖放导入机制                                        │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 二、音画同步动力学方程

现代浏览器中存在两大时钟：
1. **渲染时钟**：`requestAnimationFrame`（受显示器垂直同步和 GC 影响，存在抖动）。
2. **音频硬件采样时钟**：`AudioContext.currentTime`（数模转换 DAC 驱动，微秒级权威硬件时钟）。

### 2.1 下落位置计算方程
游戏引擎以 `AudioContext.currentTime` 减去歌曲开始时间，计算得到当前绝对物理秒 $t_{\text{now}}$。

设判定线垂直坐标为 $Y_{\text{judge}}$，速度档位为 $\text{gear} \in [1, 14]$（默认 8 档）。原版使用 `MUSIC_TIME` 计算位移，谱面时基为每四分音符 768 tick。渲染器通过 `tempoMap` 将音频秒数映射回这个 tick 时基。
- 当前 tick：$T_{\text{now}} = \text{secondsToMusicTick}(t_{\text{now}}, \text{tempoMap})$
- 音符头 tick：$T_{\text{note}} = \text{startTick}$；旧谱面缺少该字段时，使用 `startSec` 通过 `tempoMap` 换算。
- 速度步进：$S = 16 - \text{gear}$ tick/像素
- 整数像素位移：$\text{offset} = \text{trunc}\left(\frac{T_{\text{note}} - T_{\text{now}}}{S}\right)$
- 普通短音符 Y 坐标：
  $$Y_{\text{note}} = Y_{\text{judge}} - \text{offset}$$
- 长按音符（Long Note）尾部 Y 坐标：
  $$Y_{\text{tail}} = Y_{\text{judge}} - \text{trunc}\left(\frac{T_{\text{note}} + \text{durationTicks} - T_{\text{now}}}{16 - \text{gear}}\right)$$
  当谱面缺少 `durationTicks` 时，使用长音结束秒数通过 `tempoMap` 换算。这样可以正确处理跨 tempo 变化的长音。
- 渲染边界裁剪：当 $Y_{\text{note}} < -80$ 时视为屏幕外未来音符；由于音符按时间升序排布，检测到超出上界可提前 `break`，保证 $O(1)$ 常数渲染开销。

---

## 三、发音解耦（Keysound）与合成机制

根据 CanMusic 的乐理机制：
1. **伴奏流（BGM）**：
   - 过滤条件：`is_user == 0` 的全部音符。
   - 调度策略：维护一个向前看窗口（Lookahead Window，120ms），每隔 30ms 运行一次定时调度，向 WebAudio 的 `BgmGain` 预派发未来的 NoteOn/NoteOff 事件，避免主线程垃圾回收造成音频卡顿。
2. **玩家演奏流（Keysound）**：
   - 过滤条件：`is_user == 1` 的音符。
   - 默认静音：**绝对不放入 BGM 自动发声队列中**。
   - 触发逻辑：玩家按下某轨时，若该轨在 600 tick 判定窗口内有候选音符，则播放该音符本身并执行 COOL/BAD/MISS 判定与连击计分；若音符尚未到达判定线、位于 600 tick 窗口外或该轨无音符（如歌曲刚开始或倒计时阶段），则采用原版琴键模式，以当前主奏乐器结合 7 键大调自然音阶白键偏移（0, 2, 4, 5, 7, 9, 11）立即发声（八分音符时值，力度 100），且不产生判定、不扣分、不断连。

---

## 四、项目工程与目录结构

```
MeowCan/
├── AGENTS.md                  # 面向 AI 编程代理的规则与架构纲领
├── README.md                  # 面向人类开发者的项目总览与快速入门
├── docs/                      # 规格与调研文档
│   ├── spec/
│   │   ├── vos-format.md      # VOS 二进制谱面规范
│   │   ├── asset-formats.md   # vimg / vlle / vifont 原生美术格式规范
│   │   └── web-architecture.md# 本架构设计文档
│   └── research/              # 历史逆向工程与技术调研资料
├── ref/                       # 原版游戏与曲库资产
│   ├── CanMusic/              # 2002-2004 原版客户端程序、图片、音效
│   └── MyCanMusic/            # 8,000+ 首 .vos 官方/玩家自制曲库
├── backend/                   # Rust/Axum API 与 MySQL 数据层
│   ├── migrations/           # 表结构、角色与权限种子数据
│   └── src/                  # 认证、曲库、成绩和管理接口
└── web/                       # 现代 Web 前端重制版工程
    ├── index.html             # 街机界面挂载主页
    ├── package.json           # 项目配置 (Pixi.js v8, Vite)
    ├── vite.config.ts         # 构建配置
    ├── wrangler.json          # Cloudflare Workers 静态托管配置
    ├── public/                # 提取转换后的静态资产
    │   ├── assets/            # bg.png, can.png, hitbar0.png, note_skin0.png 等
    │   ├── songs.json         # 内置精选曲库清单
    │   └── songs/             # 内置精选 .vos 谱面二进制流
    ├── scripts/               # 离线转换脚本 (convert_assets.js)
    └── src/
        ├── audio/synth.ts     # WebAudio 软音源与 BGM 超前调度器
        ├── game/judgment.ts   # 7 键判定引擎与分数能量状态机
        ├── game/renderer.ts   # Pixi.js v8 舞台渲染管线
        ├── parser/vos.ts      # 双代际 VOS 谱面与 MIDI 解析器
        └── main.ts            # 主循环控制中枢与 UI 交互绑定
```
