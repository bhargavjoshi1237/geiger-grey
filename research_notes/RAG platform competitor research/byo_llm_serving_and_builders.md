# BYO-LLM, RAG Serving/Delivery Patterns, and Open-Source & Low-Code RAG Builders (as of Oct 10, 2026)

Notes for the Geiger Grey report writer. Every claim has an inline source. Where a figure comes from a third-party aggregator/review site rather than the vendor, it is flagged "(aggregator)". Things I could not verify are in the Gaps sections.

---

## 1. Open-source / low-code RAG builders: hosted offerings, pricing, traction

### Takeaway
The low-code builder market consolidated sharply in 2025-26. Flowise was shut down (repo archived Aug 13, 2026; end of life Aug 31, 2026) and DataStax's hosted Langflow was removed on Apr 9, 2026. Dify (~158k stars) and RAGFlow (~92k stars) are the open-source leaders still standing. The hosted/no-code vendors (Stack AI, deepset, Onyx Enterprise) have moved to enterprise or contact-sales pricing. That leaves a gap for a self-serve, developer-friendly "KB + knowledge graph + BYO-LLM API" product.

### Cited Findings

**Dify (LangGenius)**
- 158.1k GitHub stars, 25k forks. Ships as Dify Cloud, a self-hosted Community Edition, and an Enterprise Edition with SSO/RBAC. Includes a "Backend-as-a-Service API", a RAG pipeline, workflows, agents, and LLMOps monitoring — [GitHub langgenius/dify](https://github.com/langgenius/dify)
- License: the "Dify Open Source License" is Apache 2.0 with extra conditions that **restrict multi-tenant SaaS use**. You cannot freely re-host it as a competing SaaS — [GitHub langgenius/dify](https://github.com/langgenius/dify)
- Cloud pricing:
  - Sandbox (free): 200 message credits, 50 knowledge docs, 50MB knowledge storage, 5,000 API calls/month, 1 member.
  - Professional ($590/yr, about $59/mo): 5,000 message credits/mo, 500 docs, 5GB, unlimited API rate, 3 members, 100 knowledge requests/min.
  - Team ($1,590/yr, about $159/mo): 10,000 credits/mo, 1,000 docs, 20GB, 50 members, 1,000 knowledge requests/min.
  - Enterprise: custom.
  - "Once [credits] are used up, you can switch to your own API key", so BYOK is the overflow path on every tier. — [Dify pricing](https://dify.ai/pricing)
- v1.6.0 (Jul 10, 2025) added two-way MCP: Dify can consume external MCP servers as tools, and "any Dify agent or workflow can be exposed as a standard MCP endpoint" for Claude, Cursor, etc. — [Dify blog v1.6.0](https://dify.ai/blog/v1-6-0-built-in-two-way-mcp-support)
- Apps can be published as hosted web apps, API endpoints, embeds, or MCP tools. Each knowledge base has its own "API Access" key for CRUD and query through the Knowledge API. Dify can also call an "External Knowledge" API, so it can use your retrieval service as its KB — [Dify Knowledge docs](https://docs.dify.ai/en/guides/knowledge-base/readme); [Connect External KB](https://docs.dify.ai/en/cloud/use-dify/knowledge/connect-external-knowledge-base)
- Community issue: Dify's OpenAI-compatible model integration "cannot retrieve knowledge bases". Dify does not natively expose RAG apps as an OpenAI-compatible endpoint — [Dify issue #18669](https://github.com/langgenius/dify/issues/18669)

**RAGFlow (InfiniFlow)**
- About 92k stars, Apache 2.0. The latest release is v1.0.0-rc1 (Sep 29, 2026).
- Features:
  - "Deep document understanding" and template-based chunking.
  - "Knowledge compilation": wikis, graphs, and mind maps generated per document or dataset.
  - Agentic retrieval with reasoning modes (Low/Medium/High/Ultra).
  - Citation visualization and grounding.
  - Configurable LLMs and embeddings, with an OpenAI-compatible API.
  — [GitHub infiniflow/ragflow](https://github.com/infiniflow/ragflow)
- OpenAI-compatible endpoints are scoped per assistant or agent: `POST /api/v1/chats_openai/{chat_id}/chat/completions` and `POST /api/v1/agents_openai/{agent_id}/chat/completions`. They support streaming and an option to return references/citations. The `model` value can be a placeholder that falls back to the assistant's configured model — [RAGFlow HTTP API](https://ragflow.io/docs/http_api_reference); [Python API](https://ragflow.io/docs/python_api_reference); regression report [issue #12040](https://github.com/infiniflow/ragflow/issues/12040)
- LiteLLM lists RAGFlow as a provider, so a RAG pipeline can sit behind a gateway like any other model — [LiteLLM RAGFlow provider](https://docs.litellm.ai/docs/providers/ragflow)
- I found no hosted/cloud RAGFlow pricing page; it appears to be self-host only (see Gaps).

**Flowise (acquired by Workday, now end-of-life)**
- Workday announced it had acquired Flowise on Aug 14, 2025 — [Nasdaq press release](https://www.nasdaq.com/press-release/workday-acquires-flowise-bringing-powerful-ai-agent-builder-capabilities-workday)
- "Future of Flowise" announcement:
  - Code freeze on Jul 29, 2026; repo archived (read-only) on Aug 13, 2026; official EOL on Aug 31, 2026. "We've decided to wind down our operations for Flowise."
  - Stated reason: "The typical rigid workflow low-code approach quickly hits the limit when it comes to complexity"; developers are moving to AI coding agents.
  - Users are told to fork the Apache-2.0 code.
  — [GitHub discussion #6727](https://github.com/FlowiseAI/Flowise/discussions/6727); [GitHub FlowiseAI/Flowise (archived, 55.5k stars)](https://github.com/FlowiseAI/Flowise)
- Conflict: ByteIota says the archive date was Aug 10 and that Cloud ends too. The primary GitHub source says Aug 13 — [ByteIota](https://byteiota.com/flowise-shutdown-august-31-migrate-your-ai-pipelines-now/)
- Historical cloud pricing, now moot (aggregator): Free gave 2 flows and 100 predictions/mo; Starter $35/mo for 10k predictions; Pro $65/mo for 50k predictions, plus $15/user. LLM and vector costs were billed separately — [aixcove](https://aixcove.com/flowise-review-2026-pricing-pros-cons-and-best-use-cases/); [checkthat.ai](https://checkthat.ai/brands/flowise/pricing)

**Langflow (DataStax, now IBM)**
- IBM's acquisition of DataStax, including Langflow, closed May 28, 2025. Langflow is being folded into watsonx — [The New Stack](https://thenewstack.io/ibm-to-acquire-datastax-to-boost-watsonx-ai-development/); [Langflow blog](https://www.langflow.org/blog/big-news-for-langflow/)
- DataStax's own docs: "Removed DataStax Langflow from Astra. As an alternative, you can use Langflow OSS." (Apr 9, 2026) — [DataStax Langflow docs](https://docs.datastax.com/en/langflow/administration.html)
- (Aggregator) Hosted Langflow was deprecated Mar 9, 2026 and data deleted at shutdown with no migration tool. OSS v1.9 (Apr 2026) added desktop support, **MCP server export**, and AI-assisted component generation. The license is MIT — [BetterClaw](https://www.betterclaw.io/blog/langflow-alternative-2026)

**AnythingLLM (Mintplex Labs)**
- Hosted cloud plans:
  - Basic $50/mo: a private instance with a custom subdomain; "requires user-provided LLM API key", so it is pure BYOK.
  - Pro $99/mo: for larger teams, with a 72-hour support SLA.
  - Enterprise: custom, including on-prem, SSO, and RBAC.
- The desktop app and Docker self-hosting are free. Supports multi-user with tenant isolation, and white-labeling — [AnythingLLM pricing](https://anythingllm.com/pricing)

**Open WebUI**
- About 154k stars. Built-in local RAG with 9 supported vector DBs — [GitHub open-webui](https://github.com/open-webui/open-webui) (star count via search snippet)
- In Apr 2025 (v0.6.6+) the license changed from BSD-3 to a custom "Open WebUI License". You cannot remove or alter Open WebUI branding unless you have 50 or fewer users in 30 days, or you buy an enterprise license that includes white-labeling — [Open WebUI License](https://docs.openwebui.com/license/); [wz-it analysis](https://wz-it.com/en/blog/open-webui-license-branding-business/)

**Kotaemon (Cinnamon)**
- About 25.8k stars. A RAG UI for document QA that works with OpenAI, Azure, Cohere, and local models (Ollama, llama-cpp) — [GitHub Cinnamon/kotaemon](https://github.com/Cinnamon/kotaemon) (via search snippet)
- No hosted offering found.

**Onyx (formerly Danswer)**
- Business plan: $20/user/mo (annual). Includes chat and search, custom agents, MCP/OpenAPI actions, 40+ connectors, Slack integration, developer APIs, RBAC, "permission inheritance", and secret encryption.
- Enterprise: custom. Adds OIDC/SAML SSO, on-prem, region-specific deployment, and white-label — [Onyx pricing](https://onyx.app/pricing)
- About 32.4k stars. The Community Edition is MIT, but the project is dual-licensed: connector **permission syncing** and SSO are under the paid Enterprise license. There is a 100% MIT mirror repo, `onyx-foss` — [GitHub onyx-dot-app/onyx](https://github.com/onyx-dot-app/onyx); [onyx-foss](https://github.com/onyx-dot-app/onyx-foss); [wz-it](https://wz-it.com/en/blog/onyx-self-hosted-installation/)

**Haystack / deepset**
- Three tiers: Haystack OSS, Haystack Enterprise Starter (templates plus support), and the Haystack Enterprise Platform (cloud or on-prem, formerly "deepset Cloud"). Pricing is sales-led and based on organization size, with a free platform trial — [deepset blog](https://www.deepset.ai/blog/introducing-haystack-enterprise); [AWS Marketplace listing](https://aws.amazon.com/marketplace/pp/prodview-kxwftacdholy2)

**Stack AI**
- (Aggregator) Only two public plans: Free (500 runs/mo, 2 projects, 1 seat) and Enterprise (custom).
- An AWS Marketplace "StackAI Hosted" contract is cited at **$120,000 per 12 months for up to 5,000 runs/month**. That works out to about $2 per run, a sign of enterprise-only positioning — [getmacha](https://www.getmacha.com/blog/stack-ai-complete-guide); [sitegpt](https://sitegpt.ai/blog/stack-ai-review)

**Vellum**
- (Aggregator, Sep 2026)
  - Free: 50 builder credits/mo, 1 seat, KB up to 20 docs.
  - Pro: $25/mo, 200 credits.
  - Business: $50/mo, 5 users, 500 credits.
  - Enterprise: custom.
  - Credits are spent when you chat with Vellum's AI to *build* agents; **workflow execution does not consume credits**. Sources note older, higher prices — [eesel.ai](https://www.eesel.ai/blog/vellum-ai-pricing); [toolradar](https://toolradar.com/tools/vellum-ai/pricing)

**Botpress**
- (Aggregator plus a vendor blog title) Plans are Pay-as-you-go (free), Plus $89/mo + AI Spend, Team $495/mo + AI Spend, and Enterprise.
- Change in May 2026: AI spend is now *bundled* into plans as a quota per purchased conversation. Before that, LLM, embedding, and search usage was passed through "at exactly what the provider charged, no markup".
- The Team plan includes 2GB vector DB storage — [Botpress pricing update May 2026](https://botpress.com/blog/pricing-update-may-2026); [getmacha](https://www.getmacha.com/blog/botpress-complete-guide)

**Voiceflow**
- (Aggregator) Pro $60/mo (10k credits, 1 editor); Business $150/mo (30k credits); Enterprise custom. Free gives 100 credits and 50 KB sources per agent.
- KB source limits: 3,000 per agent on Pro, 10,000 on Business.
- 1 credit per user message (10 per minute of phone calls) plus variable LLM token costs; **KB queries are free**. There is a Knowledge Base API — [ringly](https://www.ringly.io/blog/voiceflow-pricing); [sitegpt](https://sitegpt.ai/blog/voiceflow-review)

**Adjacent "RAG-as-a-service" APIs (useful pricing comparables)**
- **Ragie**:
  - Plans: Developer free; Starter $100/mo (10k pages); Pro $500/mo (60k pages, unlimited retrievals); Enterprise custom.
  - Metering: overage is $0.02/page (fast) or $0.05/page (hi-res). Storage beyond the allowance is $0.002/page/mo. Retrievals are capped at 1,000 on Developer.
  - Included on all plans: rerank, hybrid search, and **Partitions for multi-tenancy**.
  - Extra connectors cost $250/mo each — [Ragie pricing](https://www.ragie.ai/pricing)
- **Pinecone Assistant**:
  - Token rates: $8/M input, $15/M output, **$5/M "context processed" tokens**.
  - Evaluation tokens: $8/M processed, $15/M output.
  - Storage: $3/GB/mo. Minimums: $50/mo on Standard, $500/mo on Enterprise — [Pinecone pricing](https://www.pinecone.io/pricing/)

### Inferences
- Many OSS builders are shrinking or being absorbed: Flowise closed, Langflow's cloud closed, Dify's license forbids multi-tenant SaaS re-hosting, and Open WebUI added branding restrictions. A hosted, multi-tenant, API-first product has room to grow as these narrow. Geiger Grey cannot simply re-host Dify or Open WebUI as its SaaS core without licensing work.
- The Flowise EOL rationale (coding agents replacing visual builders) suggests competing on API, MCP, and SDK delivery plus KB quality (graph, citations). A drag-and-drop canvas looks like the weaker bet.
- RAGFlow is the closest open-source analog to Geiger Grey: KB, generated graphs/wikis, citations, and per-assistant OpenAI-compatible endpoints. It has no SaaS offering.

### Gaps
- No hosted RAGFlow pricing found. I could not confirm whether InfiniFlow sells a cloud tier.
- Kotaemon: search also surfaced a `keenableai/kotaemon` repo. Possible transfer or fork; I did not verify the canonical owner.
- Haystack and Langflow GitHub star counts were not fetched.
- Stack AI, Vellum, Voiceflow, and Botpress figures come from aggregator reviews. I did not open the vendor pricing pages, apart from Botpress's blog URL.
- I did not verify whether Workday continues to offer Flowise inside its own platform after the EOL.

---

## 2. BYO-LLM patterns: keys, OpenAI-compatible endpoints, gateways, self-hosted models, key storage, billing

### Takeaway
There are three dominant patterns:
1. **Credits included, then BYOK overflow.** Used by Dify and Botpress (pre-May 2026).
2. **Pure BYOK.** Used by AnythingLLM Cloud and Flowise.
3. **Routing through a gateway that supports per-request or stored BYOK.** Examples are Vercel AI Gateway, OpenRouter, LiteLLM, and Portkey.

Gateways charge 0% (Vercel) or 5% (OpenRouter) on BYOK traffic. On a Vercel and Supabase stack, the natural pattern is to store each tenant's provider key in Supabase Vault and pass it per request through Vercel AI Gateway's `providerOptions.gateway.byok`. The catch is the gateway's silent fallback to system credentials.

### Cited Findings

**Vercel AI Gateway**
- "No markup and no platform fee on tokens", including with BYOK. BYOK requires the paid tier (purchased credits) — [Vercel AI Gateway pricing](https://vercel.com/docs/ai-gateway/pricing) (updated 2026-09-08)
- **Request-scoped BYOK:** pass `providerOptions.gateway.byok: { anthropic: [{ apiKey }] }`. This works through the AI SDK, the OpenAI Chat Completions endpoint (`https://ai-gateway.vercel.sh/v1`), the Anthropic Messages API, and the Responses API. Request credentials override dashboard-stored ones.
  - Credential shapes: Anthropic and OpenAI `{apiKey}`; Azure `{apiKey, resourceName}`; Vertex service account; Bedrock SigV4.
  - Multiple keys per provider are tried in order.
  - `modelMappings` handle custom Azure deployment names.
  — [Vercel BYOK docs](https://vercel.com/docs/ai-gateway/authentication-and-byok/byok) (updated 2026-09-22)
- **Gotcha:** "If a query using your credentials fails, AI Gateway will retry the query with its system credentials", and that fallback is billed to the gateway account's credits. BYOK spend "isn't counted in budgets", so budgets cannot cap BYOK spend. With ZDR enabled, BYOK keys are skipped unless marked ZDR-compliant — [Vercel BYOK docs](https://vercel.com/docs/ai-gateway/authentication-and-byok/byok)
- Add-on surcharges:
  - Custom Reporting: $0.075 per 1k tag/user-ID writes; $5 per 1k report queries.
  - Team-wide provider allowlist: $0.10 per 1k requests. Team-wide ZDR: $0.10 per 1k requests.
  - Trace Drains: $0.05 per 1k traces plus $0.50/GB.
  - Budgets can be set per team, project, API key, or member — [Vercel AI Gateway pricing](https://vercel.com/docs/ai-gateway/pricing)

**OpenRouter**
- BYOK costs **5% of normal model cost**, with **$25,000/month of free BYOK usage** (measured at list price) on pay-as-you-go accounts.
- Keys "are securely encrypted".
- Routing order: prioritized keys, then shared OpenRouter endpoints, then fallback keys. Fallback to shared endpoints is the default, but keys can be restricted so requests fail rather than spend credits — [OpenRouter BYOK](https://openrouter.ai/docs/use-cases/byok)

**LiteLLM (self-hosted gateway, OSS)**
- Virtual keys support per-key TPM/RPM limits, max budgets, model allowlists, model aliases, user and team ownership, spend tracking (`LiteLLM_VerificationTokenTable`), scheduled key rotation with grace periods, IP filtering, and custom validation hooks.
- Requires Postgres; Supabase and Neon are named as options — [LiteLLM virtual keys](https://docs.litellm.ai/docs/proxy/virtual_keys)

**Portkey**
- (Aggregator)
  - Free: 10k logs/mo, 3-day retention.
  - Production: $49/mo for 100k logs, then $9 per extra 100k (up to 3M). Includes virtual keys and key management, fallbacks, load balancing, and retries.
  - Enterprise adds VPC, SSO, and HIPAA — [TrueFoundry Portkey guide](https://www.truefoundry.com/blog/portkey-pricing-guide); [Portkey pricing](https://portkey.ai/pricing)

**Secure key storage on Supabase**
- Vault uses libsodium-based AEAD. The root key is kept outside the database in Supabase backend systems. Secrets decrypt at query time through the `vault.decrypted_secrets` view.
- The docs warn: "anyone that has access to the view has access to decrypted secrets", so lock it down with SQL privileges — [Supabase Vault](https://supabase.com/docs/guides/database/vault)
- Onyx lists "secret encryption" as a Business-tier feature. OpenRouter says provider keys are "securely encrypted" — [Onyx pricing](https://onyx.app/pricing); [OpenRouter BYOK](https://openrouter.ai/docs/use-cases/byok)

**Self-hosted and local models**
- AnythingLLM, Kotaemon, and Open WebUI support Ollama and llama-cpp local models — [Kotaemon](https://github.com/Cinnamon/kotaemon); [Open WebUI](https://github.com/open-webui/open-webui)
- Dify supports "any OpenAI API-compatible models", so vLLM and Ollama servers can plug in as an OpenAI-compatible base URL plus key — [Dify](https://dify.ai/)

**Billing patterns observed**
- **Pass-through at cost:**
  - Botpress (pre-May 2026): "billed at exactly what the provider charged, no markup".
  - Vercel AI Gateway: 0% markup.
- **Bundled AI quota:** Botpress after May 2026. — [Botpress update](https://botpress.com/blog/pricing-update-may-2026); [getmacha](https://www.getmacha.com/blog/botpress-complete-guide)
- **Included credits, then BYOK:** Dify — [Dify pricing](https://dify.ai/pricing)
- **BYOK mandatory:** AnythingLLM Cloud — [AnythingLLM pricing](https://anythingllm.com/pricing)
- **Bundled per-token RAG pricing with built-in margin:** Pinecone Assistant at $8/M in and $15/M out, plus $5/M context — [Pinecone pricing](https://www.pinecone.io/pricing/)

### Inferences
- Recommended architecture for Geiger Grey:
  - Store tenant keys in Supabase Vault, reachable only from a server-side function with the service role.
  - Decrypt per request in a Vercel Function.
  - Call the Vercel AI Gateway (or AI SDK providers directly) with request-scoped `byok`.
  - Persist per-pipeline settings (model, temperature, system prompt, top_k, rerank, threshold) as a versioned config row.
- Because Vercel falls back to system credentials on BYOK failure, Geiger Grey would pay when a customer's key fails, and BYOK spend is invisible to budgets. Mitigations: check key health up front (like Vercel's "Test Key"), track usage per tenant yourself, or call providers directly via the AI SDK for BYOK tenants. Also consider OpenRouter-style "no fallback" semantics.
- An "OpenAI-compatible base URL + key + model name" field covers vLLM, Ollama, Together, Groq, and similar providers in one integration.

### Gaps
- I did not find whether Vercel AI Gateway lets you **disable** system-credential fallback for BYOK. Verify before relying on it for multi-tenant BYOK.
- LangSmith and Arize Phoenix pricing were not fetched.
- I did not confirm how Dify or Flowise store provider keys at rest (encryption scheme).

---

## 3. Delivery surfaces

### Takeaway
Table stakes in 2026:
- A REST retrieval API.
- A per-assistant OpenAI-compatible `/chat/completions` endpoint with citations and streaming (RAGFlow, Pinecone Assistant).
- An **MCP server per knowledge base or app** (Dify, Pinecone Assistant, Langflow export, Ragie).
- An embeddable widget.

Slack bots appear mostly in enterprise-search products (Onyx).

### Cited Findings
- **OpenAI-compatible RAG endpoint**
  - RAGFlow: `/api/v1/chats_openai/{chat_id}/chat/completions`, with streaming and optional references — [RAGFlow HTTP API](https://ragflow.io/docs/http_api_reference)
  - Pinecone Assistant: an OpenAI-compatible chat interface "useful if you need inline citations or OpenAI-compatible responses" but with limited functionality compared to its native chat API — [Pinecone docs](https://docs.pinecone.io/guides/assistant/chat-through-the-openai-compatible-interface)
- **MCP**
  - Pinecone: a dedicated MCP server *per Assistant*, available as a managed remote endpoint or a self-hosted Docker image. It exposes the Context API, which returns "expanded chunks with relevancy scores and references" — [Pinecone Assistant MCP blog](https://www.pinecone.io/blog/assistant-MCP/); [Pinecone MCP docs](https://docs.pinecone.io/guides/operations/mcp-server)
  - Dify: apps and workflows can be published as MCP endpoints — [Dify v1.6.0](https://dify.ai/blog/v1-6-0-built-in-two-way-mcp-support)
  - Langflow 1.9: MCP server export — [BetterClaw (aggregator)](https://www.betterclaw.io/blog/langflow-alternative-2026)
  - Third-party "Dify knowledge MCP servers" exist that offer semantic, full-text, or hybrid search with rerank, which suggests real demand — [Glama](https://glama.ai/mcp/servers/liiklin/dify-knowledge-mcp-server)
  - Ragie markets an MCP server alongside connectors — [Ragie pricing](https://www.ragie.ai/pricing)
- **Context or retrieval-only API (bring your own generation):**
  - Pinecone Context API (above).
  - Dify Knowledge API with per-KB API keys — [Dify Knowledge docs](https://docs.dify.ai/en/guides/knowledge-base/readme)
  - Dify External Knowledge API, which runs the other direction (Dify calls your retriever) — [Dify External KB](https://docs.dify.ai/en/cloud/use-dify/knowledge/connect-external-knowledge-base)
- **Hosted web app, embed, API:** Dify publishes apps as hosted experiences, API endpoints, or embeds — [Dify docs/search summary](https://docs.dify.ai/en/cloud/use-dify/build/mcp)
- **Slack, chat, and developer APIs:** Onyx Business includes a Slack integration and developer APIs — [Onyx pricing](https://onyx.app/pricing)
- **Gateway-as-surface:** LiteLLM lists RAGFlow as a "provider", so RAG pipelines can be consumed like models — [LiteLLM RAGFlow](https://docs.litellm.ai/docs/providers/ragflow)

### Inferences
- Geiger Grey should expose each pipeline in three ways:
  - (a) `POST /v1/pipelines/{id}/chat/completions`: OpenAI-compatible, with SSE streaming and a `citations` extension field.
  - (b) `POST /v1/kb/{id}/retrieve`: context only.
  - (c) A remote MCP server per KB, using Streamable HTTP and API-key or OAuth auth.
- Vercel Chat SDK (Slack, Teams, Discord adapters) could cover bots cheaply. This is unverified in this research; see vercel:chat-sdk.

### Gaps
- I did not verify webhook offerings or official SDKs (npm/pypi) per vendor.
- I did not verify shareable public Q&A pages beyond Dify's hosted web apps.

---

## 4. Production features

### Takeaway
Enterprise competitors differentiate on permission-aware retrieval (Onyx gates permission sync behind its Enterprise license) and multi-tenancy primitives (Ragie Partitions). Observability is usually outsourced to Langfuse, LangSmith, or Phoenix. Evaluation has converged on faithfulness/groundedness, answer relevance, and context precision/recall, using Ragas, TruLens, or DeepEval.

### Cited Findings
- **Rate limits and quotas**
  - Dify: Sandbox gets 5,000 API calls/mo; knowledge request rates are 100/min (Pro) and 1,000/min (Team) — [Dify pricing](https://dify.ai/pricing)
  - LiteLLM: per-key RPM, TPM, and budgets — [LiteLLM](https://docs.litellm.ai/docs/proxy/virtual_keys)
  - Vercel AI Gateway: budgets per API key, project, or member; returns 429 on rate limits — [Vercel pricing](https://vercel.com/docs/ai-gateway/pricing)
- **Per-end-user metering**
  - Vercel Custom Reporting attaches user IDs and quota entity IDs to requests ($0.075 per 1k writes) — [Vercel pricing](https://vercel.com/docs/ai-gateway/pricing)
  - LiteLLM tracks spend per key, user, and team — [LiteLLM](https://docs.litellm.ai/docs/proxy/virtual_keys)
- **Multi-tenancy**
  - Ragie "Partitions (for multi-tenancy)" on all plans — [Ragie pricing](https://www.ragie.ai/pricing)
  - AnythingLLM: "multi-user capability with tenant isolation" — [AnythingLLM pricing](https://anythingllm.com/pricing)
- **Permission-aware retrieval (ACLs):** Onyx offers 40+ connectors with permission syncing (Slack, Confluence, Jira, Google Drive, GitHub), but permission sync and SSO sit in the paid Enterprise license — [wz-it](https://wz-it.com/en/blog/onyx-self-hosted-installation/); [Onyx pricing](https://onyx.app/pricing) ("permission inheritance" in Business)
- **Citations**
  - RAGFlow: citation visualization and grounding — [RAGFlow GitHub](https://github.com/infiniflow/ragflow)
  - Pinecone: inline citations via its OpenAI-compatible API — [Pinecone docs](https://docs.pinecone.io/guides/assistant/chat-through-the-openai-compatible-interface)
- **Data governance:** Vercel AI Gateway ZDR routing and regional inference also apply to BYOK requests — [Vercel BYOK](https://vercel.com/docs/ai-gateway/authentication-and-byok/byok)
- **Observability**
  - Langfuse is MIT and free to self-host.
  - Cloud plans:

    | Plan | Price | Included units | Retention |
    |---|---|---|---|
    | Hobby | Free | 50k/mo | 30 days |
    | Core | $29/mo | 100k/mo | 90 days |
    | Pro | $199/mo | 100k/mo | 3 years |
    | Enterprise | $2,499/mo | 100k/mo | 3 years |

  - Overage is $8 per 100k units, falling to $6 per 100k above 50M — [Langfuse pricing](https://langfuse.com/pricing)
  - Vercel Trace Drains export OpenTelemetry traces for $0.05 per 1k traces — [Vercel pricing](https://vercel.com/docs/ai-gateway/pricing)
  - Portkey prices on logged requests — [TrueFoundry](https://www.truefoundry.com/blog/portkey-pricing-guide)
- **Evaluation**
  - RAGAS: four ground-truth-free RAG metrics (faithfulness, answer relevancy, context precision, context recall).
  - TruLens: the "RAG Triad" (context relevance, groundedness, answer relevance) plus OpenTelemetry tracing.
  - DeepEval: 50+ Pytest-native metrics for CI gates, covering RAG, agentic, multi-turn, MCP, and safety.
  - Suggested 2026 production thresholds are faithfulness ≥0.75, answer relevancy ≥0.80, context precision ≥0.70, and context recall ≥0.80. These are blog guidance, not a standard — [Atlan](https://atlan.com/know/llm-evaluation-frameworks-compared/); [Analytics Vidhya, Jul 2026](https://www.analyticsvidhya.com/blog/2026/07/rag-evaluation-frameworks/)
  - Pinecone sells evaluation as a metered feature ($8/M processed tokens, $15/M output) — [Pinecone pricing](https://www.pinecone.io/pricing/)
- **Versioning:** Third-party Dify MCP tooling exposes "publish, manage versions" for apps, which implies app version management exists in Dify — [dify-mcp GitHub](https://github.com/alexjiaguo/dify-mcp)

### Inferences
- On Supabase, Postgres RLS plus metadata filters (tenant_id, end_user_id, ACL groups) on pgvector chunks gives "partitions" and per-end-user filtering cheaply. Expose it as a `filter` / `user` parameter on the retrieval and chat endpoints.
- Langfuse (MIT, Postgres-friendly, $29 entry tier) is the lowest-friction way to offer per-pipeline tracing. A metered "evaluate this pipeline" feature (Pinecone-style) is a credible upsell.

### Gaps
- Guardrails and PII redaction: I found no primary source in this pass. Portkey guardrails and LiteLLM/Presidio integrations are known but unverified here.
- Semantic or response caching offerings were not researched.
- A/B testing of pipeline versions: no vendor found that documents it explicitly, besides Vellum's general positioning (unverified).
- Arize Phoenix and LangSmith features and pricing were not fetched.

---

## 5. Pricing patterns for usage-based RAG serving

### Takeaway
Vendors meter on six different units:

| Unit | Example |
|---|---|
| Messages / credits | Dify, Voiceflow |
| Runs / predictions | Stack AI, Flowise |
| Conversations with bundled AI quota | Botpress |
| Pages ingested, with retrievals unlimited at higher tiers | Ragie |
| Tokens including "context processed" | Pinecone Assistant |
| Seats | Onyx |

No single standard has emerged. The clearest developer-facing pattern is a subscription with included quota, plus metered overage, plus either BYOK or pass-through LLM cost.

### Cited Findings
- **Message credits plus a KB-size tier:** Dify Professional ($59/mo) includes 5,000 messages/mo with 500 docs and 5GB, and BYOK after credits run out — [Dify pricing](https://dify.ai/pricing)
- **Credits per message:** Voiceflow charges 1 credit per message (Pro $60 for 10k), and KB queries are free — [ringly (aggregator)](https://www.ringly.io/blog/voiceflow-pricing)
- **Per run:** Stack AI enterprise works out to about $120k/yr for 5,000 runs/mo — [getmacha (aggregator)](https://www.getmacha.com/blog/stack-ai-complete-guide)
- **Per prediction:** Flowise (historical) charged $35 for 10k and $65 for 50k predictions — [aixcove (aggregator)](https://aixcove.com/flowise-review-2026-pricing-pros-cons-and-best-use-cases/)
- **Per page ingested:** Ragie charges $0.02-0.05/page plus $0.002/page/mo storage, with unlimited retrievals on Pro ($500) — [Ragie pricing](https://www.ragie.ai/pricing)
- **Per token, including retrieved context:** Pinecone Assistant charges $5/M context tokens plus $8/$15 per M in/out, with a $50/mo minimum — [Pinecone pricing](https://www.pinecone.io/pricing/)
- **Per seat:** Onyx charges $20/user/mo — [Onyx pricing](https://onyx.app/pricing)
- **Conversation bundles:** (Aggregator) Botpress Team at $750/mo annual includes 1,500 conversations and $150 of AI spend — [getmacha](https://www.getmacha.com/blog/botpress-complete-guide)
- **Builder credits only:** Vellum charges credits for AI-assisted building; execution is free — [eesel (aggregator)](https://www.eesel.ai/blog/vellum-ai-pricing)
- **Self-host free, cloud for convenience:**
  - AnythingLLM Cloud costs $50-99/mo and is BYOK-only — [AnythingLLM](https://anythingllm.com/pricing)
  - Langfuse is free self-hosted with cloud from $29 — [Langfuse](https://langfuse.com/pricing)
- **Gateway layer costs** Geiger Grey would absorb: Vercel AI Gateway adds 0% on tokens; OpenRouter charges 5% on BYOK above $25k/mo free; Portkey costs $49/mo per 100k logs — [Vercel](https://vercel.com/docs/ai-gateway/pricing); [OpenRouter](https://openrouter.ai/docs/use-cases/byok); [TrueFoundry](https://www.truefoundry.com/blog/portkey-pricing-guide)

### Inferences
- A defensible Geiger Grey model:
  - A plan fee covering KB size (pages or storage), graph-build jobs, and seats.
  - Included **queries per month** (retrieval API, MCP, and hosted Q&A), with metered overage per 1k queries.
  - LLM cost either via BYOK (no markup, like Vercel and Dify) or via hosted credits with a disclosed markup.
- Botpress moving from pass-through to bundled AI spend suggests SMB buyers prefer predictable bundles. Developers using BYOK prefer zero markup.
- Charging per retrieval rather than per token keeps BYOK tenants profitable, because Geiger Grey does not see their LLM spend.

### Gaps
- I found no public per-1k-query price from a direct RAG API competitor; Ragie bundles retrievals into tiers. Vectara, Cohere, and Azure AI Search per-query pricing were not checked in this pass.
- I did not verify markup levels for platforms that resell LLM tokens as "credits" (Dify message credit cost per model, Voiceflow token multipliers).
