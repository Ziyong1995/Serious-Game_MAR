# Watershed Council：上线操作步骤

联机版已包含：3–5人房间、房间码加入、私人目标、公共棋盘同步、交易确认、回合限制和同一浏览器重连。

## 1. 解压文件

解压 Watershed-Council-online.zip。打开文件夹后，应直接看到 package.json、server.mjs、game-worker.mjs、local-db.mjs、schema.sql 等文件。

## 2. 把文件上传到 GitHub

1. 打开 https://github.com/new ，登录或注册自己的账号。
2. Repository name 填 `watershed-council-online`，创建一个新仓库。
3. 打开仓库的上传文件页面：Add file → Upload files；空仓库也可能显示 uploading an existing file。
4. 把解压后文件夹里面的所有文件拖进去。上传文件，不要只上传 ZIP。
5. 保存上传（Commit changes）。仓库首页应直接显示 package.json；不要多套一层文件夹。

GitHub 官方说明：https://docs.github.com/en/repositories/working-with-files/managing-files/adding-a-file-to-a-repository

## 3. 在 Render 创建网站

1. 打开 https://dashboard.render.com/ ，登录或注册自己的账号。
2. 点击 New → Web Service。这里请选择 Web Service。
3. 连接你的 GitHub，选择上一步的 watershed-council-online 仓库。
4. 填写以下内容：

| 项目 | 填写内容 |
|---|---|
| Name | watershed-council-online，或你喜欢的名称 |
| Language / Runtime | Node |
| Branch | main（或仓库实际默认分支） |
| Root Directory | 留空 |
| Build Command | npm run build |
| Start Command | npm start |
| Instance Type | Free，可用于先试联机 |

项目已指定 Node.js 24。无需额外数据库账号或游戏密钥。

5. 点击创建并等待部署完成。网站状态显示 Live 后，打开它提供的 onrender.com 网址。

Render 官方部署说明：https://render.com/docs/deploy-node-express-app

## 4. 邀请朋友一起玩

1. 打开游戏网址，填写自己的名字。
2. 选择3、4或5人，点击 Create room / 创建房间。
3. 点击 Copy invite link / 邀请链接，把链接发给朋友。
4. 朋友各用自己的电脑或手机打开链接、填写名字并加入。
5. 房间人齐后，房主点击 Start game / 开始游戏。
6. 轮到自己的回合再操作；其他人的操作会自动同步。

建议用平常的视频或语音会议谈判。此版本没有内置语音或聊天。

## 正式试玩前：保存进度

Free 适合先检查多人联机。Render 免费服务空闲15分钟后会休眠，休眠、重启或重新部署会清除本地数据库；正在进行的房间可能因此丢失。

如果希望正式活动中保留进度，需要自行选择支持 Persistent Disk 的付费服务，并设置：

- Disk mount path：`/var/data`
- 环境变量：`DB_PATH` = `/var/data/game.sqlite`

付费服务也需要配置磁盘，才能跨服务重启保留这个版本的游戏数据库。请在自己的账号中确认费用后选择方案。已准备好的程序会自动使用 DB_PATH。

Render 免费服务说明：https://render.com/docs/free
持久化磁盘说明：https://render.com/docs/disks

## 日常使用

- 刷新或短暂掉线后，在同一个浏览器可以恢复座位。
- 清除浏览器数据或更换设备后，不能自动找回原座位。跨设备转移座位尚未实现。
- 其他玩家加入前，房主可以移除误加入的名字。
- 正式开始后不接受新玩家，避免他人接管已有座位。
- 不要直接双击 game-worker.mjs；联机版需要通过上面的网络服务运行。

## 已完成的检查

- 自动走完3、4、5人八轮游戏。
- 检查回合权限、秘密目标隔离、交易和共同投资、重复请求、并发更新及资源余额。
- 三个独立页面逻辑环境完成创建、加入、同步、交易和重连检查。
- 部署包通过网页服务、HTTPS代理和数据库保留后的重启恢复检查。
- 浏览器预览无法连到本地服务，实际浏览器布局与多设备真人试玩仍待上线后检查；游戏数值平衡未经真人试玩验证。

本次没有成功发布网站，因此还没有在线游戏网址。当前自动审批规则拒绝了网站上传操作。ZIP是可部署项目，需要按上述步骤部署后才能远程一起玩。
