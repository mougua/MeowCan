# MeowCan (妙罐) - 经典节奏网游 CanMusic 现代 Web 重制版

<div align="center">

![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)
![Pixi.js](https://img.shields.io/badge/Pixi.js-v8-ff69b4.svg)
![Vite](https://img.shields.io/badge/Vite-6.0+-646CFF.svg)
![WebAudio](https://img.shields.io/badge/WebAudio-Polyphonic%20GM-brightgreen.svg)
![Zero Backend](https://img.shields.io/badge/Zero--Backend-Pure%20Client-orange.svg)
![License](https://img.shields.io/badge/License-MIT-lightgrey.svg)

**用现代 Web 技术（Pixi.js v8 + WebAudio + TypeScript）100% 还原 2000 年代经典节奏音乐网游《CanMusic》！**

[快速开始](#-快速开始) • [游戏玩法与操作](#-游戏玩法与操作) • [核心技术特色](#-核心技术特色) • [曲库与拖放支持](#-曲库与自定义曲目) • [项目架构](#-项目工程结构) • [云端部署](#-部署指南)

</div>

---

## 🎮 项目简介

**CanMusic**（韩瑟软体 HanseulSoft 于 2000 年推出，后由 Lemonball 运营为《New CanMusic》，国内曾由盛大网络等代理引进），是全球节奏音游历史上不可磨灭的经典元老作品。其标志性的**左侧粉色易拉罐（Can）演奏台**、**心形糖果音符**、**右侧复古街机 PDA 绿色监控屏**以及**真实按键演奏发声（Keysound）**，陪伴了无数音游爱好者的青春。

**MeowCan** 旨在通过现代纯前端 Web 技术，在无需安装任何客户端、无需配置声卡波表、无需后端服务器的前提下，在现代浏览器中带来丝滑流畅、原汁原味的 CanMusic 体验。

---

## 🌟 核心技术特色

1. **原版美术资源 100% 逆向还原**：
   - 完整逆向解析了原版客户端专有的 16 位位图格式 `vimg`（`BG.img`、`play_area.img`）。
   - 完整逆向解析了带品红透明键（`0xf81f`）的行程压缩精灵格式 `vlle`（`can.lle` 易拉罐舞台、`hitbar0.lle` 判定底栏、`note_skin0.lle` 16 色心形音符、`Longnote.lle` 彩虹光轨、`hitani0_0.lle` 爆炸粒子）。
   - 完整逆向解析了字模纹理图集 `vifont`（`combo.ift` 闪亮黄绿艺术字、`clock.ift`、`number.ift`）。

2. **零延迟 WebAudio 按键发声（Keysound）与主客发音解耦**：
   - 忠实还原 CanMusic 的核心精髓：**玩家负责敲击的音符（`is_user == 1`）从背景音乐中完全剥离静音**。
   - 当玩家击中音符时，实时向 WebAudio 软音源触发对应 MIDI 音高与力度的发音；若漏键（MISS），则真实漏音！
   - 背景伴奏（BGM）通过 120ms 超前调度器（Lookahead Scheduler）在微秒级硬件时基（`AudioContext.currentTime`）严格对齐播放，不受页面渲染抖动影响。
   - 内置轻量多复音 General MIDI 合成引擎（钢琴、电吉他、贝斯、管弦乐、Lead/Pad 及 10 通道爵士打击乐组）与原版 WAV 击打音效。

3. **双代际 .VOS 谱面全格式纯前端零依赖解析**：
   - **第 2 代 CanMusic 容器（VOS022 / VOS008 / VOS006 / VOS009）**：解包 `Vosctemp.trk` 与 `VOSCTEMP.mid`，解析 16 字节 Note 与 7 键映射。
   - **第 1 代 Classic VOS（inf / mid / EOF 段表架构）**：解析 13 字节紧凑型音符与自适应段填充。
   - 读取 MIDI 伴奏中的 `Set Tempo` 元事件构建精准时间轴（PPQ = 768 $\to$ 物理秒），支持 `EUC-KR`（韩文）与 `GBK`（中文）字符集自适应解码。

4. **现代化流畅体验**：
   - 基于 **Pixi.js v8** 现代化 WebGL/WebGPU 高性能渲染，常数级 $O(1)$ 音符批次裁剪。
   - 忠实还原原版 1～14 档速度算法（默认 8 档，使用 768 PPQ `MUSIC_TIME` tick 计算），保留整数像素步进位移与复古手感，并随歌曲 tempo map 正确变化。
   - 内置 AI 全连自动演奏（Auto-Play）模式，方便练谱与纯音乐欣赏。
   - 支持电脑任意 `.vos` 谱面直接拖拽进浏览器窗口秒加载。

---

## 🕹️ 游戏玩法与操作

### 默认 7 键键位

| 轨道 | 1 轨 | 2 轨 | 3 轨 | 4 轨 (中) | 5 轨 | 6 轨 | 7 轨 |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **标准键位** | **`S`** | **`D`** | **`F`** | **`Space`** | **`J`** | **`K`** | **`L`** |
| **备选键位** | `A` | `S` | `D` | `Space` | `J` | `K` | `L` |
| **数字键位** | `1` | `2` | `3` | `4` | `5` | `6` | `7` |

### 判定标准与计分

- **COOL**（偏差不超过 210 tick）：命中并增加连击。
- **BAD**（偏差为 211～360 tick）：音符发声，但连击归零。
- **MISS**（偏差超过 360 tick 或漏键）：连击归零。按键捕获导致的 MISS 会发声，自然漏键不会发声。
- **长按音符（Long Note）**：音符头必须达到 COOL 才进入保持。抬键时，引擎按实际保持时值再次使用 210/360 tick 阈值结算。

原版使用 768 PPQ 的 MIDI 时间轴，判定窗口会随 BPM 改变。在 120 BPM 下，210 tick 约为 136.7 ms，360 tick 约为 234.4 ms。想放宽判定时，修改 `web/src/game/judgment.ts` 中的 `PERFECT_WINDOW_TICKS` 和 `BAD_WINDOW_TICKS`。

### 控制面板快捷键与功能

- **曲库选歌**：点击右侧 PDA 屏幕下方的 **「🎵 经典曲库」** 打开歌曲选择抽屉。
- **调速调节**：点击顶部 **「➖ 减速」** / **「➕ 加速」** 按钮或键盘 **`↑`** / **`↓`** 方向键（亦支持 `PageUp` / `PageDown`）在 `1`～`14` 档之间调节（默认 `8` 档，边界不循环），顶栏与机台 PDA 屏幕实时显示当前速度档位。
- **自动演奏**：点击 **「Auto 演示」** 按钮开启/关闭 AI 自动全连模式。
- **重放当前歌曲**：点击 **「重放」** 按钮从头开始。

---

## 🎼 曲库与自定义曲目

### 内置精选曲目
游戏默认预装了 20 首经典名曲（位于 `web/public/songs/`），涵盖不同难度与流派：
- 《Canon in d》（卡农 D 大调 - 经典考级与对战名曲）
- 《The Least 100sec (Long Ver.)》（最少 100 秒长版）
- 《FIRE》、《胡桃夹子》、《巴赫二部创意曲》
- 《拳皇 97 (K.O.F 97)》、《土耳其进行曲》等！

### 自由拖放任意 .VOS 谱面
想要游玩原版 `MyCanMusic` 中收藏的 8000 多首经典老歌？
1. 在电脑资源管理器中选中任意 `.vos` 文件。
2. 直接**拖拽并释放**至浏览器窗口中央。
3. 引擎将自动解码谱面、解析 MIDI 伴奏与乐器轨并立即开始演奏！

---

## 🚀 快速开始

### 环境准备
- [Node.js](https://nodejs.org/) (>= 18.0.0) 或 [Bun](https://bun.sh/) (推荐，启动极快)。

### 1. 克隆并进入目录
```bash
git clone https://github.com/hanseulsoft/meowcan.git # 或你的实际仓库地址
cd MeowCan/web
```

### 2. 安装依赖并启动

#### 使用 Bun（推荐）：
```bash
bun install
bun run dev
```

#### 使用 Node.js / npm：
```bash
npm install
npm run dev
```

启动后在浏览器打开终端提示的地址（通常为 `http://localhost:5173` 或 `http://localhost:3000`），点击屏幕激活音频即可畅玩！

### 3. 构建与本地预览
```bash
bun run build
bun run preview
```

---

## 📁 项目工程结构

```
MeowCan/
├── README.md                  # 面向玩家与开发者的总览与上手指南 (本文档)
├── AGENTS.md                  # 面向 AI 编程代理与协作者的代码库规则与技术上下文
├── docs/                      # 核心规范与逆向工程调研文档
│   ├── spec/
│   │   ├── vos-format.md      # VOS 二进制谱面全格式规范
│   │   ├── asset-formats.md   # vimg / vlle / vifont 原生美术资产二进制规范
│   │   ├── web-architecture.md# 渲染引擎、音频调度与音画同步动力学规范
│   │   └── flood-mode.md      # 水淹模式 (Sudden / Flood Mode) 逆向与动力学规范
│   └── research/              # 历史逆向工程、LTF 分析与技术调研报告
├── ref/                       # 原始参考客户端与曲库资产 (仅供研究)
│   ├── CanMusic/              # 2002-2004 HanseulSoft 原版客户端程序、图片与音效
│   └── MyCanMusic/            # 8,000+ 首 .vos 经典歌曲与自制单机版客户端
└── web/                       # 现代 Web 前端重制版源码工程
    ├── index.html             # 街机界面挂载主页面
    ├── package.json           # 项目配置 (Pixi.js v8, Vite, TypeScript)
    ├── vite.config.ts         # Vite 构建配置
    ├── wrangler.json          # Cloudflare Workers 静态托管配置
    ├── public/                # 转换提取后的静态资源
    │   ├── assets/            # bg.png, can.png, hitbar0.png, note_skin0.png 等
    │   ├── songs.json         # 内置 20 首精选曲目元数据列表
    │   └── songs/             # 内置 20 首精选 .vos 谱面二进制流
    ├── scripts/
    │   └── convert_assets.js  # Node.js 离线提取脚本 (RGB565 / vlle -> PNG)
    └── src/
        ├── audio/synth.ts     # WebAudio 软音源、Keysound 触发与 Lookahead BGM 调度
        ├── game/judgment.ts   # 7 键判定状态机、时间窗口、Combo 与能量计量
        ├── game/renderer.ts   # Pixi.js v8 舞台渲染、Can 跑道、粒子与 PDA 监控屏
        ├── parser/vos.ts      # 双代际 VOS 容器与 MIDI Tempo 曲线解析器
        └── main.ts            # 主控游戏循环、UI 交互事件与本地文件拖放绑定
```

---

## 🌐 部署指南

本项目为纯静态结构（Zero Backend），可一键部署至任何现代静态托管平台。

### Cloudflare Workers / Pages
项目根目录已内置 `web/wrangler.json` 静态资产配置：
```bash
cd web
bun run build
npx wrangler deploy
```

### 其他平台 (Vercel / Netlify / GitHub Pages / Nginx)
只需执行 `bun run build`（或 `npm run build`），将生成的 `web/dist/` 目录上传至任意静态文件服务器或对象存储桶即可。

---

## 📜 鸣谢与致敬

- **HanseulSoft**：创造了 CanMusic 这一划时代的音乐节奏网游神作。
- **Lemonball**：延续了 New CanMusic 的运营与辉煌。
- **MyCanMusic 社区及创作者们**：数十年来整理、保存与谱写了 8000 多首无价的 `.vos` 音乐财富。

---

*MeowCan 为基于技术研究与怀旧目的开源重制项目，所有原始美术、音频及游戏资产知识产权归原权利人所有。*
