# dupscan

零依赖单文件重复代码块检测 CLI —— 代码健康 family 第八轴「重复代码」。

扫 JS / TS 生态（`.js .mjs .cjs .ts .jsx .tsx .vue .svelte`），找出连续重复的代码片段，给出严重度加权健康分与开箱即用的 CI 门禁。不联网、不装依赖、不需要配置，单文件 `index.js` 直接跑。

## 为什么需要它

重复代码是 SonarQube 列出的头号技术债坏味道之一：同一段逻辑被复制粘贴，改一处忘改另一处就会埋下 bug。dupscan 用确定性的静态扫描把"重复块"量化出来，让复制粘贴在 Code Review 和 CI 里无所遁形。

## 安装

```bash
git clone https://github.com/huanweide/dupscan
cd dupscan
node index.js .          # 需要 Node >= 18
```

零依赖，不需要 `npm install`。

## 用法

```bash
# 扫当前目录
dupscan .

# 扫指定目录，最小重复块改为 6 行
dupscan src --min-lines 6

# 机器可读输出（CI 里接 jq / 流水线）
dupscan . --json

# CI 门禁：不允许任何 HIGH 重复块，且重复块总数不超过 3
dupscan . --fail-on-high --max-issues 3

# 仅容忍最多 20 行"额外重复行"（重复块行数 × 重复份数 - 1 的累计）
dupscan . --max-lines 20
```

## 原理

1. **逐字符 tokenizer 剥离噪声**：把注释、字符串字面量位置变空格，但保留换行（行号对齐）。字符串内容归一化为占位符 `_`，所以"逻辑相同但字符串不同"的复制会被准确识别为重复。
2. **正则上下文感知**：遇到 `/regex/` 不会把正则里的引号误判成字符串（这是零依赖 SAST 的经典坑）。
3. **行归一化**：每行去前后空白、压缩内部空白。
4. **行哈希 n-gram 滑动窗口**：对每连续 `--min-lines` 行计算块指纹，相同指纹归组。
5. **区间合并 + 跨文件聚合**：把重叠窗口合并成连续重复块，并按块指纹跨文件统计"出现份数"。
6. **严重度加权健康分**：重复行越多、份数越多、跨文件越严重。

## 严重度

| 等级 | 触发条件 |
| --- | --- |
| `HIGH` | 块 ≥ 15 行 **或** 跨文件重复 **或** 出现 ≥ 4 次 |
| `MED` | 块 ≥ 8 行 **或** 出现 ≥ 2 次 |
| `low` | 其余 |

## 健康分

`health = clamp(100 - 额外重复行 / 总行数 × 200, 0, 100)`。额外重复行 = 每个重复块行数 ×（份数 − 1）的累计。0 重复即 100 分。

## 与 jscpd 的差异

| | dupscan | jscpd |
| --- | --- | --- |
| 依赖 | 零依赖单文件 | 需 `npm install` + 配置 |
| 范围 | JS/TS 聚焦，确定性 | 跨语言泛化 |
| CI 门禁 | 内置 `--max-issues` / `--max-lines` / `--fail-on-high` | 需额外集成 |
| 定位 | 开箱即用的代码健康 family 一员 | 通用重复检测 |

## 代码健康 family（八件套）

`devdoctor`（依赖体检）· `testlite`（测试卫生）· `debtlens`（技术债）· `a11ydoctor`（前端可访问性）· `awaitscan`（异步性能）· `cycscan`（结构复杂度）· `secscan`（安全反模式）· **`dupscan`（重复代码）**

## 注意事项

跨文件重复往往是"共享库 / 共享范式"的真实信号（例如多个文件共用同一段 CLI 骨架），这本身就是值得治理的技术债，不是误报。用 `--max-issues` / `--max-lines` 设定你的 CI 容忍阈值即可。

## License

MIT

---

## 作者

由 **ReTr · 樊斯瑞** 维护 · [GitHub 主页](https://github.com/huanweide)

## CI 门禁用法

开箱即可接入 CI：在流水线中运行本工具，它会输出健康分与严重度；若存在不达标项会以非 0 退出码结束，从而拦下问题提交（具体参数见上方「快速开始」）。

## 赞助支持

如果这个项目帮到了你，欢迎 [点 Star](https://github.com/huanweide/dupscan) 支持；也可微信扫码自愿赞助（收款码见 `sponsor/wechat-qr.png`，作者本人带 Tri 水印的码，纯静态图片、不含任何密钥）。

## 许可证

详见 [LICENSE](LICENSE)。
