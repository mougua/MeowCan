# CanMusic 水淹模式 (Sudden / Flood Mode) 逆向工程与技术实现规范

> **版本**：1.0.0  
> **状态**：通过原版客户端与单机版二进制逆向推演制定，作为 MeowCan 复刻工程的标准技术规范。  
> **适用模块**：`web/src/game/judgment.ts`, `web/src/game/renderer.ts`, `web/src/main.ts`

---

## 一、背景渊源与命名释义

### 1.1 历史背景与中韩命名对照
在 2002–2004 年 HanseulSoft 与 Lemonball 运营的《CanMusic》（以及单机衍生的《MyCanMusic》）中，存在一种极具特色且在音游史中独树一帜的玩法机制——**水淹模式**：

| 语境 / 平台 | 术语名称 | 释义与技术定义 |
| :--- | :--- | :--- |
| **韩国官方原版** | **써든 (Sudden)** | 音游传统的 "Sudden" 概念变体；原厂未采用单纯的“黑色遮光板”，而是具象化为跑道“进水淹没”。 |
| **网络道具战** | **써든 저주 (Sudden Curse)** | 道具对战模式（Item Battle）中的进攻诅咒；使被击中者的演奏跑道水位上涨。 |
| **中国民间单机版** | **水淹模式** | 由 NDogXJ 于 2004 年制作的《MyCanMusic》（v1.0.0.4 / v1.0.0.5）用户界面标准译名。 |
| **现代复刻规范** | **Dynamic Flood / Sudden Engine** | 基于连击动力学与流体视效遮罩的自适应难度增强引擎。 |

---

## 二、逆向工程取证与系统调用链

### 2.1 单机版配置入口 (`MyCanMusic v1.0.0.5 Unicode.exe`)
通过对 `ref/MyCanMusic/MyCanMusic v1.0.0.5 Unicode.exe` 资源段反编译分析：
- **对话框模板**：`Dialog ID 134`（“系统设置” / `COptionSystem`）。
- **控件 ID**：`IDC_CHECK_SUDDEN = 1051 (0x41b)`，控件类型为 `BS_AUTOCHECKBOX`，文本标示为：
  ```
  Item 0: id=1051 (0x41b), class=Button, text="打开水淹模式(&M)"
  ```
- **配置持久化**：
  - INI / 注册表存储节区：`[Option]`
  - 键名：`Sudden`（布尔整型，`0` 表示关闭，`1` 表示开启）
  - 数据绑定：MFC `DoDataExchange` (函数 `0x0040e990`)：
    ```x86asm
    0x0040e998: lea eax, [esi + 0x84]   ; m_bSudden 成员变量
    0x0040e99e: push eax
    0x0040e99f: push 0x41b              ; IDC_CHECK_SUDDEN
    0x0040e9a4: push edi                ; pDX
    0x0040e9a5: call DDX_Check
    ```

### 2.2 启动与 ActiveX 控件调度 (`0x0040dfe5`)
在单机版启动曲目演奏前，宿主主循环初始化 ActiveX 控件容器（`0x0040dfe5`）：
```x86asm
0x0040dfde: mov eax, dword ptr [0x45115c]    ; "Option"
0x0040dfe3: push 0                           ; 默认值 0
0x0040dfe5: push 0x441010                    ; "Sudden"
0x0040dfea: push eax
0x0040dfeb: mov ecx, 0x453440                ; AfxGetApp()
0x0040dff0: call CWinApp::GetProfileIntW     ; 读取配置
0x0040dff5: push eax                         ; 参数 bSudden (0 或 1)
0x0040dff6: mov ecx, esi                     ; CCanMusicCtl COM 包装类
0x0040dff8: call 0x0040c1e0                  ; 调用包装方法 SetSudden
```
包装函数 `0x0040c1e0` 内部通过 COM Automation 调度属性：
```x86asm
0x0040c1f0: push 0x48                        ; DISPID 0x48 (72) = sudden
0x0040c1ee: push 4                           ; DISPATCH_PROPERTYPUT
0x0040c1f3: call COleDispatchDriver::InvokeHelper
```

### 2.3 核心控件接口定义 (`ref/CanMusic/CanMusic.dll`)
提取 `CanMusic.dll` 内部类型库（TypeLib / RT_TYPELIB 874）：
- **控件 CLSID**：`{65926D34-9E50-4094-9791-1E0964FF967A}`
- **接口 IID (`ICanMusicCtl`)**：`{CEFB7EDE-E379-41F3-8CE4-FF60CFAB7F72}`
- **DISPID 映射表**：
  ```idl
  [id(0x3a), helpstring("setChannelCode")]
  void setChannelCode([in] long nCode, [in] long nSudden, [in] long nChatMode);

  [id(0x48), propget, helpstring("sudden")]
  long sudden();

  [id(0x48), propput, helpstring("sudden")]
  void sudden([in] long newVal);
  ```

---

## 三、核心动力学与物理状态机

水淹模式由 `CanMusic.dll` 内部单例游戏引擎 `CPlayArea`（全局基地址 `0x10068e88`）驱动。

### 3.1 引擎核心内存拓扑
| 结构体偏移 | 内部字段含义 | 数据类型 | 作用描述 |
| :--- | :--- | :--- | :--- |
| `+0x0010` (`0x10068e98`) | `m_nSuddenMode` | `uint32` | 判定阈值模式：`0` 为普通单机/练习，`1` 为对战/Mania |
| `+0x3BE0` (`0x1006ca68`) | `m_nTargetSuddenLevel` | `int32` | 当前目标水淹等级（阶数：0 ~ 6 级） |
| `+0x3BE4` | `m_nCurrentWaterHeight`| `int32` | 当前实时水面高度（物理像素标量，自底向上平滑演进） |
| `+0x3BE8` | `m_dwLastWaterTick` | `uint32` | 上次流体动画步进时间戳（时基周期：20ms） |
| `+0x42AC` | `m_nComboCounter` | `EncryptedInt` | 内存混淆保护的击键连击数计数器 |
| `+0x4728` | `m_nActiveSuddenLevel` | `int32` | 激活状态阶梯缓存 |
| `+0x4828` | `m_bBubbleEnabled` | `uint8` | 是否加载并启用水下气泡粒子特效 |
| `+0x4848` | `m_pBubbleFrames` | `void*` | 气泡序列帧纹理指针数组（`bubble_ani%d.lle`） |
| `+0x48F4` | `m_nHitBarY` | `int32` | 判定线垂直像素 Y 坐标 |
| `+0x7B88` | `m_nTrackTopY` | `int32` | 跑道顶端垂直像素 Y 坐标 |

---

### 3.2 连击驱动分阶动力学方程 (`0x10022b38`)

水位的上涨并不是恒定不变的，而是**深度绑定在玩家演奏的连击数（Combo）动力学曲线**上。

#### 1. 阶梯等级阈值
设当前有效连击数为 $C$：

- **单人模式（Mode 0: Practice / Casual）**：

  $$L_{\text{target}}(C) = \begin{cases} 
  0, & C < 25 \\
  1, & 25 \le C < 50 \\
  2, & 50 \le C < 100 \\
  3, & 100 \le C < 200 \\
  4, & 200 \le C < 300 \\
  5, & 300 \le C < 400 \\
  6, & C \ge 400 \quad (\text{最高暴水阶})
  \end{cases}$$

- **狂热/对战模式（Mode 1: Mania / Battle）**：
- 
  $$L_{\text{target}}(C) = \begin{cases} 
  0, & C < 50 \\
  1, & 50 \le C < 100 \\
  2, & 100 \le C < 200 \\
  3, & 200 \le C < 400 \\
  4, & 400 \le C < 800 \\
  5, & 800 \le C < 1200 \\
  6, & C \ge 1200
  \end{cases}$$

#### 2. 断连极速泄退（Combo Break）
在击键判定逻辑中（反汇编 `0x10022a4d`）：
当玩家发生断连（判定结果为 `MISS` 或 `BAD` 时，传入状态为 0）：
```x86asm
0x10022a4d: cmp byte ptr [esi + 0x487c], 0
0x10022a54: mov dword ptr [esi + 0x4728], 0   ; 目标水淹等级瞬间归零！
```
此时目标水位立即降为 0，水位触发排水过程急速消退。

---

### 3.3 水位几何高度计算与平滑滤波 (`0x10020d48`)

游戏引擎在每帧渲染前计算水位物理坐标：

```
顶端 (TopY)   ┌────────────────────────────────┐
              │                                │
              │                                │
              │ ~ ~ ~ ~ 水面 (Water Surface) ~ │ ◄── Y_surface = HitBarY - Height_current
              │▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒│
              │▒▒▒▒▒▒ 淹没区 (Submerged) ▒▒▒▒▒▒│ ◄── 气泡浮动 + 水下色散/半透明遮罩
              │▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒│
判定线 (HitBar)└────────────────────────────────┘ ◄── Y_hitbar (判定基准线)
```

1. **总跑道高度跨度**：
   $$H_{\text{track}} = Y_{\text{hitbar}} - Y_{\text{top}}$$
2. **等分高度标量**：
   原版将跑道等分为 7 个层级：
   $$\Delta H = \left\lfloor \frac{H_{\text{track}}}{7} \right\rfloor$$
3. **目标水位绝对高度**：
   $$H_{\text{target}} = \Delta H \times L_{\text{target}}$$
4. **20ms 动力学插值演进（Fluid Smoothing）**：
   原版内置 20ms 定时器驱动（`cmp edx, 20`）：
   - **水位上升（涨潮阶段）**：
     $$H_{\text{current}}(t + \Delta t) = H_{\text{current}}(t) + \left( \text{acceleration} \times 2 + 1 \right)$$
   - **水位下降（退潮阶段）**：
     $$H_{\text{current}}(t + \Delta t) = \max\left(0, H_{\text{current}}(t) - 1\right)$$
   此平滑过渡确保水位不是突变跳跃，而是呈现类似水箱注水与放水的连续物理动态。

---

## 四、视觉渲染管线与美术资产规范

### 4.1 水体资产清单
原版提取目录（`ref/CanMusic/image/skin/default/`）：
1. **气泡序列帧**：`left/bubble_ani0.lle` 及 `right/bubble_ani0.lle`
   - 帧数：32 帧（`bubble_effect_frame = 32`）。
   - 物理尺寸：由 `bubble_effect_size` 约束（默认 $32 \times 32$ 像素）。
2. **水波浪涌边缘**：`hit_effect` 与 `play_area` 混合叠加层。

### 4.2 水体折射与气泡渲染逻辑 (`0x10020aa0` / `0x100231b0`)
1. **水面剪裁矩形 (Water Body Clip Rect)**：
   - 剪裁矩形范围：
     $$\text{Rect}_{\text{water}} = \left( X_{\text{left}}, Y_{\text{hitbar}} - H_{\text{current}}, \text{Width}_{\text{track}}, H_{\text{current}} \right)$$
   - 跑道着色：在水淹区域内叠加半透明青蓝色滤镜层（色调偏置：RGB `#1a6899`，不透明度 $\alpha \approx 0.45 \sim 0.6$）。
2. **气泡生成与上浮动画**：
   - 气泡从判定线底层各轨道随机水平偏移处生成，沿 Y 轴向上浮升。
   - **动态透明度衰减公式**（反汇编 `0x10020adf`）：
     $$\alpha_{\text{bubble}}(\text{frame}) = \frac{21 - (\text{frame} \times 2)}{21} \times 255$$
     随着气泡接近水面，尺寸微幅扩张并快速衰减至全透明消失。
3. **水面浪涌波动线 (Surface Waveform)**：
   - 在水面分界处（$Y = Y_{\text{hitbar}} - H_{\text{current}}$），逐帧循环渲染正弦波纹或水波序列切片，使水界具有生动的流体感。

### 4.3 玩法视觉挑战（Gameplay Handicap）
在水淹模式下，当下落音符进入水体区域后：
- 音符视觉对比度大幅下降或被水体遮挡，产生音游特有的 **“突现（Sudden）”** 视效阻碍。
- 连击数越高，被水体封锁的区域越大，玩家能看到音符在空气中飞行的预判时间缩短至极限，极度考验玩家的读谱极限与肌肉记忆反应。

---

## 五、Web 前端复刻实现蓝图 (MeowCan Architecture)

为在 `MeowCan`（Pixi.js v8 + WebAudio）中无缝实现原汁原味的水淹模式，建议在现有工程中实施以下改造：

### 5.1 数据模型扩展 (`web/src/game/judgment.ts`)
在判定与状态机中新增水淹控制接口：

```typescript
export interface FloodModeOptions {
  enabled: boolean;
  mode: 0 | 1; // 0: Casual, 1: Mania
}

export class FloodState {
  enabled: boolean = false;
  mode: 0 | 1 = 0;
  level: number = 0;           // 0..6
  currentHeight: number = 0;    // 像素标量
  targetHeight: number = 0;
  private lastUpdateMs: number = 0;

  updateFromCombo(combo: number): void {
    if (!this.enabled) {
      this.level = 0;
      return;
    }
    const thresholds = this.mode === 0 
      ? [25, 50, 100, 200, 300, 400] 
      : [50, 100, 200, 400, 800, 1200];
    
    let nextLevel = 0;
    for (let i = 0; i < thresholds.length; i++) {
      if (combo >= thresholds[i]) {
        nextLevel = i + 1;
      } else {
        break;
      }
    }
    this.level = nextLevel;
  }

  onMiss(): void {
    if (this.enabled) {
      this.level = 0; // 断连瞬间目标水位清零
    }
  }

  tickPhysics(nowMs: number, trackHeight: number): void {
    if (nowMs - this.lastUpdateMs < 20) return;
    this.lastUpdateMs = nowMs;

    const stepHeight = Math.floor(trackHeight / 7);
    this.targetHeight = this.level * stepHeight;

    if (this.currentHeight < this.targetHeight) {
      this.currentHeight = Math.min(this.targetHeight, this.currentHeight + 3);
    } else if (this.currentHeight > this.targetHeight) {
      this.currentHeight = Math.max(0, this.currentHeight - 2);
    }
  }
}
```

### 5.2 渲染管线扩充 (`web/src/game/renderer.ts`)
利用 Pixi.js v8 搭建多层次水淹合成器：

1. **`waterContainer` 容器**：置于音符图层之上、判定线之下。
2. **`waterOverlay`**：使用 `Pixi.Graphics` 绘制半透明水体矩阵：
   ```typescript
   waterGraphics.clear();
   if (floodState.currentHeight > 0) {
     const surfaceY = hitBarY - floodState.currentHeight;
     // 绘制水体半透明遮罩
     waterGraphics.rect(trackX, surfaceY, trackWidth, floodState.currentHeight);
     waterGraphics.fill({ color: 0x1a6899, alpha: 0.5 });

     // 绘制水面波浪线
     waterGraphics.moveTo(trackX, surfaceY);
     waterGraphics.lineTo(trackX + trackWidth, surfaceY);
     waterGraphics.stroke({ width: 2, color: 0x8fe7ff, alpha: 0.8 });
   }
   ```
3. **`bubbleEmitter` 气泡粒子系统**：
   - 在水淹高度大于 20px 时激活发射源。
   - 使用从 `bubble_ani0.lle` 导出的 32 帧贴图序列。
   - 粒子随物理帧上浮并执行 α 衰减方程。

### 5.3 用户界面集成 (`web/src/main.ts` & `index.html`)
- 在街机设置抽屉菜单（Option Drawer）中增加「水淹模式 (Sudden / Flood Mode)」复选开关。
- 支持快捷键或设置面板持久化到浏览器的 `localStorage`，默认键值与单机版一致命名为 `Option.Sudden`。
