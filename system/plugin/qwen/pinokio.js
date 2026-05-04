module.exports = {
  title: "Qwen Code",
  link: "https://github.com/QwenLM/qwen-code",
  icon: "qwen.png",
  watch: [{
    method: "draft.watch",
    params: {
      path: ".pinokio/drafts",
      publish: {
        target: "registry",
        type: "post",
        parent: {
          type: "app",
          url: "{{args.url || ''}}"
        }
      }
    }
  }],
  env: [{
    key: "OPENAI_API_KEY",
    default: "OPENAI_API_KEY"
  }, {
    key: "OPENAI_BASE_URL",
    description: "use the OpenAI API compatible api endpoint",
    default: "http://localhost:1234/v1"
  }, {
    key: "OPENAI_MODEL",
    description: "the openai compatible model",
    default: "mradermacher/Bootes-Qwen3_Coder-Reasoning-i1-GGUF"
  }],
  run: [{
    id: "run",
    method: "shell.run",
    params: {
      message: {
        _: [
          "npx",
          "-y",
          "@qwen-code/qwen-code@latest"
        ],
        "prompt-interactive": "{{args.prompt || undefined}}"
      },
      path: "{{args.cwd}}",
      buffer: 1024,
      input: true
    }
  }]
}
