# Azure DeepSeek configuration

In the private `.env.event`, replace only the shared model block with:

```dotenv
LLM_PROVIDER=azure
LLM_MODEL=DeepSeek-V4.1-Flash
LLM_THINKING=medium
AZURE_OPENAI_BASE_URL=https://lab-coding.openai.azure.com/openai/v1
AZURE_OPENAI_API_KEY=replace-with-azure-api-key
```

Do not change the four `TEAM_*_GITHUB_TOKEN` fields. Enter the Azure key locally,
not in chat. An old `OPENCODE_API_KEY` can remain unused in the master file; it is
not copied into Azure team bundles. The repository/model configuration files may
be edit-protected by your agent harness; update them manually rather than bypassing
that protection.

`LLM_MODEL` is the **exact Azure deployment name**, including case. It is not
looked up as an OpenAI or DeepSeek public catalog ID. Provider/model selection is
explicit; missing Azure credentials never fall back to another provider.

Requests use:

- `POST https://lab-coding.openai.azure.com/openai/v1/chat/completions`
- Azure's `api-key` header, inserted only by the trusted broker
- `model: "DeepSeek-V4.1-Flash"`
- The six fixed bot function tools and SSE streaming

No dated `api-version` or different project endpoint is required for this v1 API.
The broker permits only an HTTPS `RESOURCE.openai.azure.com/openai/v1` URL with
no embedded credentials, query parameters, nonstandard port, or other paths. The
Pi process still receives only the private broker URL and a dummy API key.

The pinned Pi version predates this Azure deployment's catalog entry. A static
Chat Completions profile uses a conservative 128K context budget and 8192 output
tokens. Azure pricing is not estimated (zero cost metadata does **not** mean free).
Native reasoning defaults are left to the deployment: no unverified `thinking` or
`reasoning_effort` fields are injected. Returned `reasoning_content` is replayed
when continuing the function-tool loop.

After entering the key:

```sh
make check-event
```

This validates config only; it never calls Azure. For an explicit **live** model test:

```sh
make check-model
```

It runs from the organizer's machine without Docker or GitHub access. It uses the
same Pi serializer and trusted Azure proxy, enables only `read_docs`, and makes up
to **two real inference requests** (uses model quota). Success requires a streamed
response, a successful doc-tool call, and a follow-up accepting its result. There
are no bot writes, Python execution, Git operations, persistent sessions, or raw
model/credential output. Automatic retries/compaction are disabled, and the check
has a three-minute deadline. HTTP errors report only status and known error codes,
not raw provider messages. This command is never run automatically by config checks,
builds, or CI. Unit tests exercise it with fake SSE only.

Before publishing/distributing the event image, perform this live streamed prompt
and tool cycle. Fake SSE tests do not prove deployment availability, credentials,
quotas, model limits, or firewall access.
The endpoint returning 404 to an anonymous GET of its base path is not an inference
test. Existing file, Git, and offline Python sandbox restrictions are unchanged.

References:

- https://learn.microsoft.com/en-us/azure/foundry/openai/api-version-lifecycle
- https://learn.microsoft.com/en-us/rest/api/microsoft-foundry/azureopenai/chat
