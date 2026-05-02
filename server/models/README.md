# LLM 模型文件

本目录用于放置 GGUF 格式的 LLM 模型文件。

## 下载模型

从 Hugging Face 下载模型，例如：

# Qwen3 1.7B (推荐，内存占用约 1.8GB)
wget https://huggingface.co/Qwen/Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-Q8_0.gguf

# Qwen3 4B (质量更好，内存占用约 2.5GB)
wget https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf
```

## 配置

在`data/llm-config.json` 中配置模型路径。

## 注意事项

- 如果不需要 LLM 功能，可以在配置中设置 `mockMode: true`
