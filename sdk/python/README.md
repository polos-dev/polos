# Polos Python SDK

Durable execution engine for Python. Build reliable AI agents and workflows that can survive failures, handle long-running tasks, and coordinate complex processes.

## Features

- 🤖 **AI Agents** - Build LLM-powered agents with tool calling, streaming, and conversation history
- 🔄 **Durable Workflows** - Workflows survive failures and resume from checkpoints
- ⏰ **Long-Running** - Execute workflows that run for hours or days
- 🔗 **Workflow Orchestration** - Chain workflows together and build complex processes
- 🛠️ **Tools** - Define reusable tools that agents can call
- 🐍 **Native Python** - Async/await support, type hints, and Pythonic APIs
- 📊 **Observability** - Built-in tracing, events, and monitoring

## Installation

```bash
pip install polos-sdk
```

Or with UV (recommended):
```bash
uv add polos-sdk
```

### Optional Dependencies

Install provider-specific dependencies for LLM support:

```bash
# OpenAI
pip install polos-sdk[openai]

# Anthropic
pip install polos-sdk[anthropic]

# Google Gemini
pip install polos-sdk[gemini]

# Groq
pip install polos-sdk[groq]

# Fireworks
pip install polos-sdk[fireworks]

# Together AI
pip install polos-sdk[together]

# All providers
pip install polos-sdk[openai,anthropic,gemini,groq,fireworks,together]
```

## Quick Start

Use the quickstart guide at [https://docs.polos.dev](https://docs.polos.dev) to get started in minutes.

## License

Apache-2.0 - see [LICENSE](../../LICENSE) for details.

## Support

- 📖 [Documentation](https://docs.polos.dev)
- 💬 [Discord Community](https://discord.gg/polos)
- 🐛 [Issue Tracker](https://github.com/polos-dev/polos/issues)
- 📧 [Email Support](mailto:support@polos.dev)

---

Built with ❤️ by the Polos team
