package com.mengxinggg.gupiaomoniqi.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONObject
import java.text.NumberFormat
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/** 卡片内容均来自服务器保存的提案；客户端确认只提交卡片ID，不能改写订单。 */
@Composable
fun AssistantTradeCard(card: JSONObject, busy: Boolean, onAction: (String) -> Unit) {
    val status = card.optString("status")
    val result = card.optJSONObject("result")
    val buy = card.optString("side") == "BUY"
    val limit = card.optString("orderMode") == "LIMIT"
    val number = NumberFormat.getNumberInstance().apply { maximumFractionDigits = 4 }
    val currency = card.optString("quoteCurrency")
    val label = when (status) {
        "pending" -> "等待你的授权"
        "executing" -> "正在提交委托…"
        "submitted" -> when (result?.optString("status")) { "FILLED" -> "已成交"; "CANCELLED" -> "委托已撤销"; else -> "委托已提交" }
        "rejected" -> "已拒绝"
        "expired" -> "已过期，请重新分析"
        "failed" -> "委托未提交"
        else -> "结果待核对"
    }
    fun time(field: String) = runCatching {
        DateTimeFormatter.ofPattern("MM-dd HH:mm:ss").withZone(ZoneId.systemDefault()).format(Instant.parse(card.getString(field)))
    }.getOrDefault("—")
    Surface(shape = RoundedCornerShape(16.dp), color = Color.White.copy(alpha = .92f), border = BorderStroke(1.dp, Color(0xFFD6DFDB))) {
        Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
            Text("模拟交易授权 · $label", fontSize = 12.sp, color = Color(0xFF53665C))
            Text("${if (buy) "买入" else "卖出"} ${card.optString("name")} · ${card.optString("symbol")}", fontWeight = FontWeight.Bold, fontSize = 17.sp)
            Text("${if (card.optString("mode") == "REAL") "真实行情模拟盘" else "虚拟市场模拟盘"} · ${if (limit) "限价委托" else "市价委托"}", fontSize = 12.sp)
            Text("${number.format(card.optLong("quantity"))} 股   ${if (limit) "限价 ${number.format(card.optDouble("limitPrice"))} $currency" else "按确认时行情成交"}", fontSize = 14.sp)
            Text("参考价 ${number.format(card.optDouble("referencePrice"))} $currency · ${time("quoteTime")}", fontSize = 11.sp, color = Color.Gray)
            Text("${if (buy) "预计占用" else "预计回收"} ${number.format(card.optDouble("estimatedAmount"))} $currency（未含费用）", fontSize = 12.sp)
            Text(card.optString("reason"), fontSize = 13.sp, lineHeight = 20.sp)
            if (status == "pending") {
                Text("仅授权这一笔，有效至 ${time("expiresAt")}。确认时校验资金与可卖持仓；${if (limit) "未达到限价会挂单并冻结对应资金或股票。" else "实际成交金额可能随行情变化。"}", fontSize = 11.sp, lineHeight = 17.sp)
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    OutlinedButton(enabled = !busy, onClick = { onAction("reject") }, modifier = Modifier.weight(1f)) { Text("拒绝") }
                    Button(enabled = !busy, onClick = { onAction("approve") }, modifier = Modifier.weight(1f)) { Text("确认${if (buy) "买入" else "卖出"}") }
                }
            }
            if (status == "executing") LinearProgressIndicator(Modifier.fillMaxWidth())
            if (result != null) {
                Text("订单 ${result.optString("orderId").take(8)} · 已成交 ${number.format(result.optLong("filledQuantity"))} 股", fontSize = 12.sp)
                if (result.has("price")) Text("成交价 ${number.format(result.optDouble("price"))} $currency · 费用 ${number.format(result.optDouble("feeUsd"))} USD", fontSize = 12.sp)
                if (result.optString("status") == "OPEN") Text("此处显示提交结果，后续成交与撤单请到订单页查看。", fontSize = 11.sp)
            }
            if (card.optString("error").isNotBlank()) Text(card.optString("error"), color = MaterialTheme.colorScheme.error, fontSize = 12.sp)
            if (status == "uncertain") {
                Text("核对将使用原授权编号恢复执行；若尚未下单，仍可能提交这笔已授权委托。", fontSize = 11.sp)
                OutlinedButton(enabled = !busy, onClick = { onAction("approve") }) { Text("核对并恢复本卡") }
            }
        }
    }
}
