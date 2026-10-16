import { providerRequest } from "./ProviderTransport.js";
import { AssistantError } from "./AssistantStore.js";

const decode = (text: string) => text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]*>/g, "")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
export async function searchWeb(query: string) {
  const raw = await providerRequest(`https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}`, { text: true, signal: AbortSignal.timeout(15000) });
  if (typeof raw !== "string") throw new AssistantError("搜索服务暂不可用");
  const sources = [...raw.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 5).map(match => {
    const field = (name: string) => decode(new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`).exec(match[1]!)?.[1] ?? "");
    return { title: field("title"), url: field("link"), snippet: field("description"), publishedAt: field("pubDate") };
  }).filter(s => /^https?:\/\//i.test(s.url));
  if (!sources.length) throw new AssistantError("搜索服务未返回可用结果，请稍后重试");
  return { query, searchedAt: new Date().toISOString(), notice: "公开搜索摘要，未阅读网页全文", sources };
}
