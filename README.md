# Agent Twin · 0.4 预发布

在 DeepSeek Harness 内搭建和持续管理一个有来源、有权限边界的 AI 分身。原生工作台提供“项目沉淀、分身能力、通道连接、身份与规则”四个常驻模块，首次搭建后可在日常管理中继续补材料、更新能力、处理审批和检查回执。

原生版面向 **DeepSeek Harness Web / Desktop 0.2.1-rc.2、0.2.1-rc.3、0.2.1-rc.4、0.2.1-rc.5 / Node.js 22.13+**。Desktop 已验证安装启用、真实模型整理蒸馏、候选试跑与明确采用、日报和材料回流；真实 Slack 收发仍待验收，完整证据见 [0.4 发布说明](https://github.com/oxmumu3/ai-twin-starter/blob/132996e3fc112e78b84c4215b63fb070a9dbc404/docs/release-0.4.md)。其他宿主版本需重新验证。模型使用宿主配置，Slack 需要你自己的应用授权。完整路径见 [原生运行手册](docs/native.md)。

用已有工作 Agent，按四步搭分身：**准备分身材料 → 蒸馏分身 → 连接通道 → 设定权限**。

你只需指定项目范围、补充必要事实并完成自己的渠道授权。资料盘点、结构化整理、命令和 JSON 提案由当前 Agent 处理；不要求你先把项目整理成一套完美的知识库。

## 四步分别做什么

1. **准备分身材料**：在选定项目内盘点元数据，明确选材后读取正文，整理背景、知识、判断、工作流、案例、工具和成果；保留出处与缺口。原生版调用宿主模型，通用 CLI 由当前 Agent 组织提案。
2. **蒸馏分身**：从所选原始来源提炼知识、判断、工作流和工具卡，校验出处。原生版先生成候选，用具体任务试跑，再明确采用；材料包或候选生成都不等于能力已经验收。
3. **连接通道**：用自己的 Slack 授权核对真实身份、允许频道和本人目的地。先做只读核验，原生版另行执行明确的回传测试并保存记录；通用工具路径保持只读。
4. **设定权限**：按稳定身份、范围、动作和目的地设置规则。陌生身份拒绝，越权或不明确的请求交本人；原生服务还需本人明确启用，通用 `channel-tick` 继续只读 dry-run。

代码负责读取边界、来源校验、落盘、通道探测、权限与任务状态。材料可以边工作边积累；安装不会附带作者的业务知识、工具账号或个人记忆。

## 给 Agent 的一句话

其他 Agent：

> 请阅读 https://github.com/oxmumu3/ai-twin-starter 的 README 和全部 Releases（含预发布），选择已公开、与当前宿主兼容的版本，核对包及 SHA256SUMS，再按该版本 SETUP.md 带我准备材料、蒸馏分身、连接通道、设定权限。先完成只读验收。

DeepSeek Harness：

> 请阅读 https://github.com/oxmumu3/ai-twin-starter 的 README 和 https://github.com/oxmumu3/ai-twin-starter/releases （包含预发布），核对当前 Harness 版本，选择已经公开且兼容的安装包，验证 SHA256SUMS 后安装并回读启用状态。按对应版本运行手册带我搭建 AI 分身；若安装 0.4，打开原生“AI 分身”页面，完成首次搭建后继续日常管理。先核验模型、来源和 Slack 权限，再由我明确启用服务。

首次由你选定可读取范围，并完成自己的 Slack 授权和必要的身份/范围设置。不要在对话中粘贴 token。免开发指这些已实现步骤不要求你编写程序；不代表免授权、没有材料也能复制能力，或安装后自动常驻。

## 从零散项目开始

[零散项目示例](https://github.com/oxmumu3/ai-twin-starter/blob/132996e3fc112e78b84c4215b63fb070a9dbc404/examples/messy-project/README.md)用独立编写的合成背景、笔记、旧报告和工具说明演示材料准备。待转换的 PDF 留作缺口，被排除的配置不作为知识来源；不要求先有成套规则文件。后续过程是盘点 → 选择与读取来源 → Agent 整理材料/缺口 → 校验落包 → 从原始来源蒸馏。

[工作方法示例](https://github.com/oxmumu3/ai-twin-starter/blob/132996e3fc112e78b84c4215b63fb070a9dbc404/examples/synthetic-operations/README.md)保留既有的四类蒸馏演示。它们均不包含真实业务资料或作者私有知识包。

## Agent 使用的命令

要求 Node.js 22.13+。以下为兼容 0.3 的通用 CLI 路径，语义整理由当前 Agent 完成；0.4 原生工作台则调用宿主已配置的真实模型。下面的命令由 Agent 执行，用户无需手写提案。

```sh
git clone https://github.com/oxmumu3/ai-twin-starter.git
cd ai-twin-starter
node bin/agent-twin.mjs init --cwd /absolute/path/to/your/project
node bin/agent-twin.mjs materials-inventory --cwd /absolute/path/to/your/project --root .
node bin/agent-twin.mjs materials-prepare --cwd /absolute/path/to/your/project --entry notes.md --entry reports/previous.md
```

Agent 用 prepare 返回的真实内容组织 `{project, materials, gaps}`，写本地私有提案，再运行 `materials-apply --batch <batchId> --packet <proposal.json>`。`materials-status` 核对材料包；`materials-distill` 重新读取已选原始来源，进入既有 `distill-apply` 流程。完整操作见 [SETUP.md](SETUP.md)，卡片结构见 [蒸馏说明](docs/distill.md)，授权与只读接口见 [通道说明](docs/channel.md)。

## 本地工作流与材料回流

原生“分身能力”支持严格 CSV 输入的本地日报、正文预览和历史；“项目沉淀”支持材料提交、审阅、明确采纳，再单独纳入来源。它们由主人显式发起，远程来信不能触发；材料采纳后仍须重新整理、蒸馏、试跑并采用能力候选。通用 CLI 继续可用，命令与边界见 [SETUP.md](SETUP.md#本地有界工作流与材料回流)。

## DSH 与市场

DSH 插件同时提供原生工作台和兼容 0.3 的 `agent_twin` 工具。后者使用宿主当前项目目录并尊重只读/工作区权限。[安装说明](docs/dsh-install.md)列出宿主版本和操作。

DSH 有官方提供的[自定义插件市场功能](https://deepseek-harness.github.io/deepseek-harness/guide/plugin-market)。本项目提供[自托管索引](https://raw.githubusercontent.com/oxmumu3/ai-twin-starter/main/market/index.json)，可以添加到该发现页；这不代表本项目经过官方统一审核或收录。直接安装固定版本 `.tgz` 不需要先添加市场。

## 版本与验收边界

- **0.1.0**：模板初始化；当时未实现内容蒸馏和通道连接，把它描述成完整搭建入口不准确。
- **0.2.0**：增加显式资料蒸馏、来源刷新、Slack 只读探测和代码权限 dry-run，仍默认用户已有可直接选择的材料。
- **0.3.0**：补上零散项目的材料盘点、整理、缺口与来源校验，并从已选原始来源衔接蒸馏。
- **0.4.0-preview.3**：新增原生日报与材料回流管理，保留 preview.1 的四模块与服务机制。
- **0.4.0-preview.1**：新增原生四模块、能力候选试跑与采用、授权知识问答/草稿/Slack 回传、审批、持久任务与恢复。仅作为预发布提供，下载是否可用以 [全部 Releases](https://github.com/oxmumu3/ai-twin-starter/releases) 的实际资产为准；不依赖 `/releases/latest` 发现预发布。

0.3 通用工具中的正式业务执行、审批消费、对外回复和持续调度仍由原 Agent 与其授权工具承担，须分别验收。合成示例和测试不能证明真实 Slack 已收发或服务已全天在线；`status` 不把配置齐全标成已在线。

0.4 原生执行器只使用本次身份获准的来源卡片，完成问答、草稿和消息回传，不开放任意 Agent 工具调用。工具卡说明不等于已经接通或执行了工具。合成模型和隔离消息适配器的端到端验收及重启恢复已完成；Desktop 的实际安装和本地工作流另有实跑记录。真实 Slack 收发、真实同事体验及长期稳定性仍需验收。GitHub 预发布分发不代表官方市场收录或生产服务验收。

MIT，作者：牛村木木山（`oxmumu3`）。[安装说明](docs/dsh-install.md)、[原生运行手册](docs/native.md)、[0.4 发布说明](https://github.com/oxmumu3/ai-twin-starter/blob/132996e3fc112e78b84c4215b63fb070a9dbc404/docs/release-0.4.md)。旧 [验收记录](https://github.com/oxmumu3/ai-twin-starter/blob/132996e3fc112e78b84c4215b63fb070a9dbc404/docs/verification.md)、[架构](https://github.com/oxmumu3/ai-twin-starter/blob/132996e3fc112e78b84c4215b63fb070a9dbc404/docs/architecture.md)和 [通道说明](docs/channel.md)描述通用 0.3 路径；原生版以本次发布说明及运行手册为准。

## 官方 rc.3 兼容维护

`0.4.0-preview.3` 保留已安装 0.4.0-preview.2 的全部运行代码，仅更新官方 Harness 0.2.1-rc.3 及其 SDK 兼容声明、版本和安装文案。不含正在开发的 0.5 新功能。现有能力、身份规则、材料及投递记录不迁移、不清除。详见[兼容验收](https://github.com/oxmumu3/ai-twin-starter/blob/132996e3fc112e78b84c4215b63fb070a9dbc404/docs/rc3-compatibility.md)。
