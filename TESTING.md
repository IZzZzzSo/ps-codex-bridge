# 验证范围

`npm test` 包含 11 个自动化测试：PNG RGBA 往返、实际本机 HTTP 鉴权、macOS sips 图像归一化、选区蒙版、坐标补齐、文档绑定检查、并发领取、失败回滚及回传去重。

`npm run check` 检查 JavaScript 语法与插件网络权限范围。

在 Photoshop 27.0.0 中已单独实测 getPixels、getSelection、putPixels 的绝对坐标写入、历史回滚和通知监听。面板加载、配对连接与内容滚动也已实测。

尚未把完整 Codex AI 改图、生成结果文件、登记与回传的端到端流程标记为已通过。不同账户、客户端和 Photoshop 版本的表现需要进一步验证。

提交问题时请提供系统版本、Photoshop 版本、复现步骤和去除私密内容后的错误信息；不要上传配对码、runtime 目录或未获授权的图片。
