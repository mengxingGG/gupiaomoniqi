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

可从仓库根目录执行：

```powershell
.\android\gradlew.bat -p android :app:assembleDebug
.\android\gradlew.bat -p android :app:testDebugUnitTest
```

依赖均按项目指定版本固定，可在依赖已缓存时追加 `--offline` 进行离线构建。

## 本地开发网络

正式包固定使用 `https://gupiaomoniqi.org`，用户界面不提供服务器地址输入或切换功能。

调试包需要连接局域网服务时，可通过 ADB 临时覆盖：

```powershell
adb shell am start -n com.mengxinggg.gupiaomoniqi/.MainActivity `
  --es debug_server_url http://192.168.1.20:3100
```

该入口受 `BuildConfig.DEBUG` 保护，正式包会忽略覆盖参数。应用内更新始终要求 HTTPS 且与固定服务同源。
