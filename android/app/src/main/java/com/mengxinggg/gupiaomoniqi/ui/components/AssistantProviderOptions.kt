package com.mengxinggg.gupiaomoniqi.ui.components

/** 接口选项与原生思考参数对应，避免把其他协议的强度继续发出。 */
enum class AssistantApi(val id: String, val label: String, val officialUrl: String) {
    CHAT("openai-chat", "OpenAI · Chat Completions", "https://api.openai.com/v1"),
    RESPONSES("openai-responses", "OpenAI · Responses", "https://api.openai.com/v1"),
    DEEPSEEK("deepseek", "DeepSeek 专项", "https://api.deepseek.com/v1"),
    CLAUDE("anthropic", "Claude · Messages", "https://api.anthropic.com/v1");

    fun efforts(mode: String = "adaptive"): List<String> = when (this) {
        DEEPSEEK -> listOf("auto", "none", "low", "high", "max")
        CLAUDE -> if (mode == "budget") listOf("auto", "none", "low", "medium", "high")
            else listOf("auto", "none", "low", "medium", "high", "xhigh", "max")
        else -> listOf("auto", "none", "minimal", "low", "medium", "high", "xhigh")
    }

    fun thinkingHint(mode: String): String = when (this) {
        CHAT -> "自动跟随模型默认；手动强度按 Chat Completions 发送。具体档位需所选模型支持。"
        RESPONSES -> "自动跟随模型默认；手动强度使用 Responses 原生 reasoning 设置。"
        DEEPSEEK -> "自动跟随模型默认；关闭会禁用思考，低 / 高 / 最大开启对应思考强度。工具续接会保留必要思考信息。"
        CLAUDE -> if (mode == "budget") "旧模型预算方式：低 1024、中 2048、高 4096 token；自动跟随模型默认。"
            else "新模型自适应方式：手动档位使用原生 thinking 与 effort；自动跟随模型默认。部分模型不支持关闭或最高档。"
    }

    companion object {
        fun fromId(id: String) = entries.firstOrNull { it.id == id } ?: CHAT
    }
}

fun effortLabel(value: String) = when (value) {
    "auto" -> "自动"; "none" -> "关闭"; "minimal" -> "极低"; "low" -> "低"
    "medium" -> "中"; "high" -> "高"; "xhigh" -> "很高"; "max" -> "最大"; else -> value
}
