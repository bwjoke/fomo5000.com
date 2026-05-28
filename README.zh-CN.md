# FOMO5000

[English](README.md) | [中文](README.zh-CN.md)

FOMO5000 是一个静态美股市场地图，用来在同一张图上观察 5,000+ 只美股。

在线访问：https://fomo5000.com

## 展示内容

- 横轴：AI 相关度估计，基于官方 sector/industry 信息，并用公司简介语义结果做小幅微调。
- 纵轴：近 1W、1M、3M、6M、12M 的市值变化。
- 颜色：官方 Nasdaq 行业板块。
- 三角形角度：所选周度时间点的当周价格涨跌。
- 时间轴：从 2025-01-01 到最新数据日期的周度快照。

## 数据说明

仓库中的市场数据是由 Nasdaq screener 和历史报价接口生成的快照。当前快照包含 5,292 只可用股票，最新数据日期为 2026-05-26。

市值变化是估算值：用当前 screener 市值结合历史收盘价收益率反推，并假设股本数量不变。AI 相关度是实验性排序信号，不代表投资建议。

本项目仅用于可视化观察和学习，不构成任何金融或投资建议。市场数据仍受原始数据提供方条款约束。

## 本地开发

```sh
npm ci
npm run build
```

构建脚本会把可部署到 Cloudflare Pages 的静态资源写入 `dist/`，并把 `data/market-data.json` 拆分为 `dist/data/` 下的数据分片。

## 部署

生产环境从 `main` 分支通过 GitHub Actions 部署到 Cloudflare Pages。部署凭证只存放在 GitHub environment secrets 中，不提交到仓库。

## License

代码使用 MIT License。市场数据不包含在代码 license 中，仍受原始数据提供方条款约束。
