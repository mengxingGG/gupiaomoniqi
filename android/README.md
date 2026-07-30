# 股票模拟器 Android 客户端

这是 `gupiaomoniqi` 的原生 Kotlin / Jetpack Compose 客户端。应用读取真实行情数据，但所有买卖、持仓与盈亏均为模拟结果，不会连接券商或发起真实证券交易。

## 构建环境

- JDK 17
- Gradle 8.9
- Android SDK Platform 35
- Kotlin 1.9.22
- Compose Compiler 1.5.8
- 最低 Android 版本：API 26

首次构建前，请通过 `ANDROID_HOME` 指向 Android SDK，或在本目录创建未纳入版本控制的 `local.properties`：

```properties
sdk.dir=C\:\\Users\\你的用户名\\AppData\\Local\\Android\\Sdk
```

项目暂未提交 Gradle Wrapper 时，可从仓库根目录执行：

```powershell
gradle -p android :app:assembleDebug
gradle -p android :app:testDebugUnitTest
```

依赖均按项目指定版本固定，可在依赖已缓存时追加 `--offline` 进行离线构建。

## 本地开发网络

Manifest 当前允许 cleartext HTTP，以便 Android 模拟器或测试设备访问局域网内的开发服务。该设置只适合本地开发；正式发布前应改为仅允许 HTTPS，或通过 Network Security Config 将例外限制到明确的开发域名。
