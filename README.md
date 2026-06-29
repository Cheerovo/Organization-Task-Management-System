# HRO 时代开弈集团 · OTMS

组织与任务管理系统（Organization & Task Management System）

## 功能

- 组织管理（树状架构图、职能分工、员工花名册、在岗状态）
- OKR 目标管理
- KPI 指标看板
- 报表提交
- 例会管理

## 本地运行

直接用浏览器打开 `index.html` 即可，所有数据存储在浏览器 localStorage 中。

或通过 Node.js 启动本地服务（支持钉钉考勤同步）：

```bash
cd otms-server
npm install
cp .env.example .env  # 编辑填写钉钉 AppKey
npm start
```

## 在线访问

部署于 GitHub Pages：https://[你的用户名].github.io/otms/
