package com.mengxinggg.gupiaomoniqi.ui

import com.mengxinggg.gupiaomoniqi.data.ApiClientException
import com.mengxinggg.gupiaomoniqi.model.IndustryCount

private const val UNCATEGORIZED_INDUSTRY = "未分类"

internal fun normalizeIndustryCounts(
    counts: List<IndustryCount>,
): List<IndustryCountUi> = counts
    .groupBy { normalizeIndustry(it.industry) }
    .map { (industry, rows) ->
        IndustryCountUi(industry, rows.sumOf { it.count.coerceAtLeast(0) })
    }
    .filter { it.count > 0 }
    .sortedWith(compareByDescending<IndustryCountUi> { it.count }.thenBy { it.industry })

internal data class IndustryDirectoryResolution(
    val options: List<IndustryCountUi>,
    val selectedIndustry: String?,
    val shouldReloadMarket: Boolean,
)

internal data class IndustryDirectoryFailureResolution(
    val selectedIndustry: String?,
    val shouldReloadMarket: Boolean,
    val notice: String,
)

/**
 * 行业目录是全量口径的唯一来源；只有目录成功返回后，才能判断原选择是否仍有效。
 */
internal fun resolveIndustryDirectory(
    counts: List<IndustryCount>,
    selectedIndustry: String?,
): IndustryDirectoryResolution {
    val options = normalizeIndustryCounts(counts)
    val retainedSelection = selectedIndustry?.takeIf { selected ->
        options.any { option -> option.industry == selected }
    }
    return IndustryDirectoryResolution(
        options = options,
        selectedIndustry = retainedSelection,
        shouldReloadMarket = selectedIndustry != null && retainedSelection == null,
    )
}

private fun normalizeIndustry(value: String): String {
    val normalized = value.trim()
    return if (
        normalized.uppercase() in setOf(
            "",
            "-",
            "--",
            "N/A",
            "NA",
            "NONE",
            "NULL",
            "UNKNOWN",
            "未知",
        )
    ) {
        UNCATEGORIZED_INDUSTRY
    } else {
        normalized
    }
}

internal fun Throwable.isMissingOrdersEndpoint(): Boolean =
    this is ApiClientException && status == 404

internal fun Throwable.isMissingIndustriesEndpoint(): Boolean =
    this is ApiClientException && status == 404

/**
 * 旧后端不仅缺少目录端点，还会忽略行情请求里的 industry，因此 404 时不能保留假筛选。
 * 短暂网络或服务端错误无法证明行业无效，仍保留用户选择。
 */
internal fun resolveIndustryDirectoryFailure(
    error: Throwable,
    selectedIndustry: String?,
): IndustryDirectoryFailureResolution = if (error.isMissingIndustriesEndpoint()) {
    IndustryDirectoryFailureResolution(
        selectedIndustry = null,
        shouldReloadMarket = selectedIndustry != null,
        notice = "旧版后端不支持行业筛选，请更新后端",
    )
} else {
    IndustryDirectoryFailureResolution(
        selectedIndustry = selectedIndustry,
        shouldReloadMarket = false,
        notice = "行业目录暂不可用，请下拉刷新",
    )
}
