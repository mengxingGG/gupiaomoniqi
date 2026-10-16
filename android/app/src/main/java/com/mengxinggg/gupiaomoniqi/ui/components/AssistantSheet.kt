package com.mengxinggg.gupiaomoniqi.ui.components

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.mengxinggg.gupiaomoniqi.data.StockRepository
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

private val AssistantGreen = Color(0xFF214D43)
private fun JSONArray?.objects(): List<JSONObject> = if (this == null) emptyList() else (0 until length()).mapNotNull { optJSONObject(it) }

/** 低频管理集中在应用设置，悬浮球只承载对话和会话。 */
@Composable
fun AssistantManagementSheet(repository: StockRepository, onDismiss: () -> Unit) {
    var overview by remember { mutableStateOf<JSONObject?>(null) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var tab by rememberSaveable { mutableStateOf(0) }
    val scope = rememberCoroutineScope()
    suspend fun refresh() { overview = repository.assistantRequest() }
    fun action(block: suspend () -> Unit) {
        if (busy) return
        scope.launch {
            busy = true; error = ""
            try { block() } catch (e: CancellationException) { throw e }
            catch (e: Exception) { error = e.message ?: "连接失败，请重试" }
            finally { busy = false }
        }
    }
    LaunchedEffect(Unit) { action { refresh() } }
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        Surface(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().imePadding(), color = Color.White) {
            Column {
                Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("AI 助手管理", Modifier.weight(1f), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                    TextButton(onClick = onDismiss) { Text("完成") }
                }
                TabRow(selectedTabIndex = tab) {
                    listOf("模型与对话", "长期记忆").forEachIndexed { index, title ->
                        Tab(selected = tab == index, onClick = { tab = index; action { refresh() } }, text = { Text(title) })
                    }
                }
                if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
                if (error.isNotEmpty()) Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(error, Modifier.weight(1f), color = MaterialTheme.colorScheme.error, fontSize = 12.sp)
                    TextButton(onClick = { action { refresh() } }) { Text("重试") }
                }
                overview?.let { data ->
                    if (tab == 0) AssistantSettings(data.getJSONObject("settings"), busy, onDismiss, ::action, repository::assistantRequest, ::refresh)
                    else AssistantMemory(data.getJSONObject("memory"), busy, onDismiss, ::action, repository::assistantRequest, ::refresh)
                }
            }
        }
    }
}

/** 会话与任务由服务器持久化，收起面板仅停止界面轮询。 */
@Composable
fun AssistantSheet(visible: Boolean, repository: StockRepository, mode: String, instrumentId: String?, onStatusChange: (String) -> Unit, onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    var overview by remember { mutableStateOf<JSONObject?>(null) }
    var selected by rememberSaveable { mutableStateOf("") }
    var draft by rememberSaveable { mutableStateOf("") }
    var drawer by rememberSaveable { mutableStateOf(false) }
    var full by rememberSaveable { mutableStateOf(false) }
    var query by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var connectionError by remember { mutableStateOf("") }
    var permissions by remember { mutableStateOf(emptySet<String>()) }
    var showScope by remember { mutableStateOf(false) }
    var deletion by remember { mutableStateOf<JSONObject?>(null) }
    var rename by remember { mutableStateOf<JSONObject?>(null) }
    var newTitle by remember { mutableStateOf("") }
    val list = rememberLazyListState()
    val clipboard = LocalClipboardManager.current
    val uri = LocalUriHandler.current
    val sessions = overview?.optJSONArray("sessions").objects()
    val session = sessions.find { it.optString("id") == selected }
    val messages = session?.optJSONArray("messages").objects()
    val task = session?.optJSONObject("task")
    val running = sessions.any { it.optJSONObject("task")?.optString("status") == "running" }
    val settings = overview?.optJSONObject("settings")

    suspend fun refresh() { overview = repository.assistantRequest() }
    fun action(block: suspend () -> Unit) {
        if (busy) return
        scope.launch { busy = true; error = ""; try { block() } catch (e: CancellationException) { throw e }
            catch (e: Exception) { error = e.message ?: "请求失败，请重试" } finally { busy = false } }
    }
    suspend fun create(): String {
        val body = JSONObject().put("mode", mode)
        if (instrumentId != null) body.put("instrumentId", instrumentId)
        listOf("portfolio", "transactions", "watchlist", "web").forEach { body.put(it, it in permissions) }
        val result = repository.assistantRequest("/sessions", "POST", body)
        selected = result.getString("id"); drawer = false; refresh(); return selected
    }
    val latestStatus = task?.optString("status") ?: sessions.maxByOrNull { it.optString("updatedAt") }?.optJSONObject("task")?.optString("status")
    LaunchedEffect(running, latestStatus) {
        onStatusChange(if (running) "running" else latestStatus ?: "idle")
    }
    LaunchedEffect(visible, running) {
        while (true) {
            try { refresh(); connectionError = "" } catch (e: CancellationException) { throw e } catch (e: Exception) { connectionError = e.message ?: "连接失败" }
            if (!visible && !running) break
            delay(1500)
        }
    }
    LaunchedEffect(messages.size, selected) { if (messages.isNotEmpty()) list.animateScrollToItem(messages.size - 1) }
    if (!visible) return
    MaterialTheme(colorScheme = lightColorScheme(primary = AssistantGreen, secondary = AssistantGreen, primaryContainer = Color(0xFFE3EEE6))) {
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        BackHandler { when { drawer -> drawer = false; else -> onDismiss() } }
        Box(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().imePadding(), contentAlignment = Alignment.BottomCenter) {
            Surface(Modifier.fillMaxWidth().fillMaxHeight(if (full) 1f else .87f), shape = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp), color = Color(0xFFFAFBF9)) {
                Column {
                    Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
                        IconButton(onClick = { drawer = !drawer }) { FineIcon(FineSymbol.MENU, "会话管理") }
                        Column(Modifier.weight(1f)) { Text("四海 AI", fontWeight = FontWeight.Bold, color = AssistantGreen); Text(settings?.optString("model")?.ifEmpty { "选择模型开始对话" } ?: "正在连接…", maxLines = 1, fontSize = 11.sp) }
                        IconButton(onClick = { action { create() } }, enabled = !busy) { FineIcon(FineSymbol.NEW_CHAT, "新建对话") }
                        IconButton(onClick = { full = !full }) { FineIcon(FineSymbol.EXPAND, "切换对话窗口大小") }
                        IconButton(onClick = onDismiss) { FineIcon(FineSymbol.CLOSE, "收起AI助手") }
                    }
                    HorizontalDivider()
                    if (error.isNotBlank() || connectionError.isNotBlank()) Row(Modifier.fillMaxWidth().background(Color(0xFFFFEEEA)).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(error.ifBlank { connectionError }, Modifier.weight(1f), color = MaterialTheme.colorScheme.error, fontSize = 12.sp)
                        TextButton(onClick = { action { refresh() } }) { Text("重试") }
                    }
                    when {
                        drawer -> Column(Modifier.fillMaxSize().padding(16.dp)) {
                            Button(onClick = { action { create() } }, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text("＋ 新对话") }
                            OutlinedTextField(value = query, onValueChange = { query = it }, placeholder = { Text("搜索会话") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                            LazyColumn(Modifier.weight(1f)) {
                                items(sessions.filter { it.optString("title").contains(query) || it.optJSONArray("messages")?.toString()?.contains(query) == true }, key = { it.getString("id") }) { item ->
                                    Column(Modifier.fillMaxWidth().background(if (item.optString("id") == selected) Color(0xFFE6EFE8) else Color.Transparent, RoundedCornerShape(12.dp)).padding(8.dp)) {
                                        Column(Modifier.fillMaxWidth().clickable { selected = item.getString("id"); drawer = false }.padding(8.dp)) {
                                            Text((if (item.optBoolean("pinned")) "★ " else "") + item.optString("title"), maxLines = 2)
                                            Text((if (item.optJSONObject("scope")?.optString("mode") == "REAL") "真实行情" else "虚拟市场") + if (item.optJSONObject("task")?.optString("status") == "running") " · 进行中" else "", fontSize = 11.sp)
                                        }
                                        Row { TextButton(onClick = { action { repository.assistantRequest("/sessions/${item.getString("id")}", "PATCH", JSONObject().put("pinned", !item.optBoolean("pinned"))); refresh() } }) { Text("置顶") }
                                            TextButton(onClick = { rename = item; newTitle = item.optString("title") }) { Text("改名") }
                                            TextButton(onClick = { deletion = item }) { Text("删除") } }
                                    }
                                }
                            }
                        }
                        else -> {
                            val activeScope = session?.optJSONObject("scope")
                            Row(Modifier.fillMaxWidth().background(Color(0xFFEDF3EE)).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                                Text((if ((activeScope?.optString("mode") ?: mode) == "REAL") "真实行情 · 模拟交易" else "虚拟市场 · 模拟交易") + (activeScope?.optString("instrumentId", "") ?: instrumentId ?: "").let { if (it.isBlank()) "" else " · $it" }, Modifier.weight(1f), fontSize = 11.sp)
                                TextButton(onClick = { showScope = !showScope }) { Text("数据范围", fontSize = 12.sp) }
                            }
                            if (activeScope != null && (activeScope.optString("mode") != mode || activeScope.optString("instrumentId", "") != (instrumentId ?: ""))) Row(verticalAlignment = Alignment.CenterVertically) {
                                Text("当前页面与会话范围不同", Modifier.weight(1f).padding(start = 12.dp), fontSize = 11.sp)
                                TextButton(onClick = { action { create() } }) { Text("按页面新建", fontSize = 12.sp) }
                            }
                            if (showScope) Column(Modifier.fillMaxWidth().heightIn(max = 210.dp).verticalScroll(rememberScrollState()).padding(horizontal = 12.dp)) {
                                Text("勾选资料会发送给所选模型。已有会话调整权限后须新建；停止任务可取消继续读取。", fontSize = 12.sp)
                                listOf("portfolio" to "资金与持仓", "transactions" to "成交记录", "watchlist" to "自选股", "web" to "联网检索（真实行情）").forEach { (key, label) ->
                                    Row(verticalAlignment = Alignment.CenterVertically) { Checkbox(key in permissions, onCheckedChange = { permissions = if (it) permissions + key else permissions - key }); Text(label, fontSize = 13.sp)
                                        if (activeScope?.optBoolean(key) == true) Text(" · 本会话已授权", fontSize = 10.sp, color = AssistantGreen) }
                                }
                            }
                            LazyColumn(Modifier.weight(1f).fillMaxWidth(), state = list, contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                                if (messages.isEmpty()) item {
                                    Column(Modifier.fillMaxWidth().padding(vertical = 16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                                        Text("✦", fontSize = 40.sp, color = AssistantGreen); Text("一起看懂市场", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                                        Text("从当前股票、走势或模拟组合开始", fontSize = 13.sp, modifier = Modifier.padding(12.dp))
                                        listOf("解释当前股票的走势", "帮我按条件筛选股票", "T+1 和可卖数量是什么意思？").forEach { text -> OutlinedButton(onClick = { draft = text }, modifier = Modifier.fillMaxWidth()) { Text(text) } }
                                        if (settings?.optString("model").isNullOrBlank()) Text("请先到设置 → AI 助手管理配置模型服务", fontSize = 12.sp, color = Color.Gray)
                                    }
                                }
                                items(messages, key = { it.getString("id") }) { message ->
                                    val user = message.optString("role") == "user"
                                    Column(Modifier.fillMaxWidth().padding(start = if (user) 30.dp else 0.dp).background(if (user) Color(0xFFEAF0EB) else Color.Transparent, RoundedCornerShape(18.dp)).padding(if (user) 12.dp else 0.dp)) {
                                        Text(if (user) "你" else message.optString("model", "四海 AI"), fontSize = 10.sp, color = Color(0xFF6E7D75))
                                        SelectionContainer { AssistantText(message.optString("content")) }
                                        message.optJSONArray("sources").objects().forEach { source -> val url = source.optString("url"); if (url.startsWith("https://") || url.startsWith("http://")) TextButton(onClick = { runCatching { uri.openUri(url) } }) { Text(source.optString("title"), fontSize = 12.sp) } }
                                        TextButton(onClick = { clipboard.setText(AnnotatedString(message.optString("content"))) }) { Text("复制", fontSize = 11.sp) }
                                    }
                                }
                                if (task?.optString("status") == "running") item { Text("◌ ${task.optString("progress")}\n关闭面板后任务继续", fontSize = 13.sp, color = AssistantGreen) }
                                if (!task?.optString("error").isNullOrBlank()) item { Text(task!!.optString("error"), color = MaterialTheme.colorScheme.error, fontSize = 13.sp) }
                            }
                            Surface(Modifier.fillMaxWidth().padding(10.dp), shape = RoundedCornerShape(20.dp), color = Color.White, tonalElevation = 2.dp) {
                                Column(Modifier.padding(10.dp)) {
                                    OutlinedTextField(value = draft, onValueChange = { if (it.length <= 30000) draft = it }, placeholder = { Text("向四海 AI 提问…") }, modifier = Modifier.fillMaxWidth().heightIn(max = 140.dp), maxLines = 4, shape = RoundedCornerShape(14.dp))
                                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                                        Text("${minOf(settings?.optInt("contextTokens", 256000) ?: 256000, settings?.optInt("modelContextTokens", 32000) ?: 32000) / 1000}K", Modifier.weight(1f), fontSize = 11.sp)
                                        if (task?.optString("status") == "running") Button(onClick = { action { repository.assistantRequest("/sessions/$selected/stop", "POST", JSONObject()); refresh() } }) { Text("停止") }
                                        else Button(enabled = !busy && !running && draft.isNotBlank(), onClick = { action {
                                            val content = draft.trim(); val target = session?.optString("id") ?: create()
                                            repository.assistantRequest("/sessions/$target/messages", "POST", JSONObject().put("content", content).put("requestId", UUID.randomUUID().toString()))
                                            draft = ""; refresh()
                                        } }) { Text("发送 ↑") }
                                    }
                                    Text(if (task?.optBoolean("compacted") == true) "早期消息未发送，完整记录保留在历史中" else "AI 可能出错，请核对时间与来源", Modifier.align(Alignment.CenterHorizontally), fontSize = 10.sp, color = Color(0xFF78867F))
                                }
                            }
                        }
                    }
                }
            }
        }
        deletion?.let { item -> AlertDialog(onDismissRequest = { deletion = null }, title = { Text("删除会话？") }, text = { Text("“${item.optString("title")}”的记录将被删除，运行中的任务会停止。") }, confirmButton = { TextButton(onClick = { deletion = null; action { repository.assistantRequest("/sessions/${item.getString("id")}", "DELETE"); if (selected == item.getString("id")) selected = ""; refresh() } }) { Text("删除") } }, dismissButton = { TextButton(onClick = { deletion = null }) { Text("取消") } }) }
        rename?.let { item -> AlertDialog(onDismissRequest = { rename = null }, title = { Text("会话名称") }, text = { OutlinedTextField(newTitle, { if (it.length <= 80) newTitle = it }) }, confirmButton = { TextButton(enabled = newTitle.isNotBlank(), onClick = { rename = null; action { repository.assistantRequest("/sessions/${item.getString("id")}", "PATCH", JSONObject().put("title", newTitle)); refresh() } }) { Text("保存") } }, dismissButton = { TextButton(onClick = { rename = null }) { Text("取消") } }) }
    }
    }
}

@Composable
private fun AssistantText(text: String) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        var code = false
        text.lines().forEach { line ->
            if (line.startsWith("```")) code = !code
            else if (code) Text(line, Modifier.fillMaxWidth().background(Color(0xFFEDF1ED)).horizontalScroll(rememberScrollState()).padding(6.dp), fontFamily = FontFamily.Monospace, fontSize = 12.sp)
            else {
                val heading = line.startsWith("#")
                val clean = if (heading) line.trimStart('#', ' ') else line
                Text(buildAnnotatedString {
                    clean.split("**").forEachIndexed { index, part -> if (index % 2 == 1) withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append(part) } else append(part) }
                }, fontSize = if (heading) 17.sp else 14.sp, fontWeight = if (heading) FontWeight.Bold else FontWeight.Normal, lineHeight = 23.sp)
            }
        }
    }
}

@Composable
private fun AssistantSettings(initial: JSONObject, busy: Boolean, onBack: () -> Unit, onAction: (suspend () -> Unit) -> Unit, request: suspend (String, String, JSONObject?) -> JSONObject, onSaved: suspend () -> Unit) {
    var url by remember { mutableStateOf(initial.optString("baseUrl")) }; var key by remember { mutableStateOf("") }; var model by remember { mutableStateOf(initial.optString("model")) }
    var context by remember { mutableStateOf(initial.optInt("contextTokens", 256000)) }; var capacity by remember { mutableStateOf(initial.optInt("modelContextTokens", 32000).toString()) }
    var effort by remember { mutableStateOf(initial.optString("reasoning", "auto")) }; var tools by remember { mutableStateOf(initial.optBoolean("toolsEnabled", true)) }
    var models by remember { mutableStateOf(emptyList<String>()) }; var notice by remember { mutableStateOf("") }; var menu by remember { mutableStateOf(false) }
    suspend fun save(removeKey: Boolean = false) {
        val body = JSONObject().put("baseUrl", url.trim()).put("model", model.trim()).put("contextTokens", context).put("modelContextTokens", capacity.toIntOrNull() ?: 0).put("reasoning", effort).put("toolsEnabled", tools)
        if (key.isNotEmpty() || removeKey) body.put("apiKey", if (removeKey) "" else key)
        request("/settings", "PATCH", body); key = ""; onSaved()
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        TextButton(onClick = onBack) { Text("← 返回设置") }; Text("模型与对话设置", style = MaterialTheme.typography.titleLarge)
        Text("使用自己的 OpenAI 兼容服务。请求由服务器发起，localhost 指服务器本机。", fontSize = 12.sp)
        OutlinedTextField(url, { url = it }, label = { Text("API 地址") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
        OutlinedTextField(key, { key = it }, label = { Text(if (initial.optBoolean("hasKey")) "API Key · 已保存，留空保留" else "API Key") }, visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth(), singleLine = true)
        Text("更换地址会清除旧密钥，请重新填写。", fontSize = 11.sp)
        Row { TextButton(enabled = !busy, onClick = { onAction { save(); models = request("/models", "POST", JSONObject()).optJSONArray("data").objects().map { it.getString("id") }; menu = true; notice = "已获取列表，请选择模型并测试" } }) { Text("获取模型") }
            TextButton(enabled = !busy, onClick = { onAction { save(true); notice = "密钥已移除" } }) { Text("移除密钥") } }
        OutlinedTextField(model, { model = it }, label = { Text("模型 ID（支持手填）") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
        if (models.isNotEmpty()) Box { TextButton(onClick = { menu = true }) { Text("选择已获取模型") }; DropdownMenu(expanded = menu, onDismissRequest = { menu = false }, modifier = Modifier.heightIn(max = 300.dp)) { models.forEach { name -> DropdownMenuItem(text = { Text(name) }, onClick = { model = name; menu = false }) } } }
        Text("上下文额度（默认 256K）", fontWeight = FontWeight.Bold)
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) { listOf(32000,64000,128000,256000,512000,1000000).forEach { n -> FilterChip(selected = context == n, onClick = { context = n }, label = { Text(if (n == 1000000) "1M" else "${n / 1000}K") }) } }
        OutlinedTextField(capacity, { capacity = it.filter(Char::isDigit).take(7) }, label = { Text("模型实际容量（token）") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.fillMaxWidth())
        Text("按提供方文档填写；未确认时保守使用 32K。实际取两者较小值，并预留输出和思考。", fontSize = 12.sp)
        Text("思考强度", fontWeight = FontWeight.Bold)
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) { listOf("auto", "none", "minimal", "low", "medium", "high", "xhigh").forEach { value -> FilterChip(selected = effort == value, onClick = { effort = value }, label = { Text(if (value == "auto") "自动" else value) }) } }
        Text("自动跟随模型默认；手动值须模型支持。", fontSize = 12.sp)
        Row(verticalAlignment = Alignment.CenterVertically) { Switch(tools, onCheckedChange = { tools = it }); Text("启用行情与记忆等工具", Modifier.padding(start = 8.dp), fontSize = 13.sp) }
        Row { Button(enabled = !busy, onClick = { onAction { save(); notice = "已保存，对下一条消息生效" } }) { Text("保存设置") }; TextButton(enabled = !busy, onClick = { onAction { save(); notice = request("/test", "POST", JSONObject()).optString("message") } }) { Text("测试模型") } }
        Text(notice, color = AssistantGreen, fontSize = 13.sp)
    }
}

@Composable
private fun AssistantMemory(initial: JSONObject, busy: Boolean, onBack: () -> Unit, onAction: (suspend () -> Unit) -> Unit, request: suspend (String, String, JSONObject?) -> JSONObject, onSaved: suspend () -> Unit) {
    var text by remember { mutableStateOf(initial.optString("text")) }; var revision by remember { mutableStateOf(initial.optString("revision")) }; var enabled by remember { mutableStateOf(initial.optBoolean("enabled", true)) }
    var notice by remember { mutableStateOf("") }; var confirm by remember { mutableStateOf(false) }
    suspend fun save(clear: Boolean = false, undo: Boolean = false) {
        val saved = request("/memory", "PATCH", JSONObject().put("text", if (clear) "" else text).put("revision", revision).put("enabled", enabled).put("undo", undo))
        text = saved.optString("text"); revision = saved.optString("revision"); enabled = saved.optBoolean("enabled"); onSaved(); notice = "记忆已更新"
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        TextButton(onClick = onBack) { Text("← 返回设置") }; Text("长期记忆", style = MaterialTheme.typography.titleLarge)
        Text("AI 自主整理稳定偏好，最多 3000 字符。行为规则由开发团队维护。", fontSize = 13.sp)
        Row(verticalAlignment = Alignment.CenterVertically) { Switch(enabled, onCheckedChange = { enabled = it }); Text("使用并更新记忆（保存后生效）", fontSize = 12.sp) }
        OutlinedTextField(text, { text = it }, modifier = Modifier.fillMaxWidth().heightIn(min = 220.dp), label = { Text("记忆内容") })
        val normalized = text.replace("\r\n", "\n").replace("\r", "\n")
        Text("${normalized.codePointCount(0, normalized.length)} / 3000 字符", fontSize = 12.sp)
        Row { Button(enabled = !busy, onClick = { onAction { save() } }) { Text("保存") }; TextButton(enabled = !busy && initial.optBoolean("canUndo"), onClick = { onAction { save(undo = true) } }) { Text("撤销修改") }; TextButton(enabled = !busy, onClick = { confirm = true }) { Text("清空") } }
        TextButton(enabled = !busy, onClick = { onAction {
            val latest = request("", "GET", null).getJSONObject("memory")
            text = latest.optString("text"); revision = latest.optString("revision"); enabled = latest.optBoolean("enabled"); onSaved()
        } }) { Text("读取最新记忆") }
        Text(notice, color = AssistantGreen)
    }
    if (confirm) AlertDialog(onDismissRequest = { confirm = false }, title = { Text("清空长期记忆？") }, text = { Text("同时清除撤销副本。对话历史仍会保留。") }, confirmButton = { TextButton(onClick = { confirm = false; onAction { save(clear = true) } }) { Text("清空") } }, dismissButton = { TextButton(onClick = { confirm = false }) { Text("取消") } })
}
