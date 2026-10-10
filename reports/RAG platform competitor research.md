# Sell suite context, not RAG plumbing

The product Geiger Grey describes already exists in several forms, but as a standalone business it has a poor record. Between late 2024 and mid-2026 the startups closest to Grey were acquired, acqui-hired, shut down, pivoted or repriced to $100K+ a year. That list includes **Carbon, Graphlit, Ragie, Contextual AI, Needle and Vectara**. Grey's concept is media upload, configurable ingestion, a knowledge base plus knowledge graph per project, and serving through hosted Q&A or a bring-your-own-LLM (BYO-LLM) API. Two kinds of seller survive. Hyperscalers sell the plumbing at close to zero: Gemini File Search charges **$0.15 per million tokens to index, with storage free**. Enterprise platforms charge **$700/month (Progress Agentic RAG) to $100K+/year (Vectara)**. The notes found no surviving self-serve product at SMB prices that combines audio/video ingestion, an editable knowledge graph, hosted Q&A and a BYO-LLM API. The lane is open, but the competitors' history explains why it is empty. Buyer evidence points the same way. **76% of enterprise AI is now bought rather than built**, half of all spend goes to applications rather than infrastructure, and suites like Notion and Atlassian now give "ask your workspace" away with the seat. Grey should therefore position as the **suite-native context layer** rather than a RAG API. That means three things. First, ingestion from Flow, Notes, Assets and Forms with no connectors and with permissions inherited from the source app. Second, a visual, editable graph per project that other apps write into. Third, outward delivery through MCP, an OpenAI-compatible endpoint and Content widgets. The MVP should ship preset-based ingestion with cost estimates, hybrid retrieval with reranking, a graph stored natively in Postgres, hosted Q&A with citations, and a BYO-LLM retrieval API. The ~$15/month add-on is viable only if parsing, media minutes, graph extraction and public traffic are metered separately. The main risks are commoditization, graph cost, permission leakage, being billed when a customer's own LLM key fails (a Vercel AI Gateway behavior), and buyers' fear that the vendor will disappear.

## Three of the most Grey-like startups exited within twenty months

The independent RAG-as-a-service tier has thinned sharply. **Carbon.ai** was acquired by Perplexity in December 2024 and shut its managed API on March 31, 2025, giving customers about three months to leave ([TechCrunch](https://techcrunch.com/2024/12/18/perplexity-acquires-carbon-to-connect-ai-search-to-your-work-files/); [SiliconANGLE](https://siliconangle.com/2024/12/18/perplexity-ai-gets-500m-funding-immediately-spends-buy-rag-startup-carbon/)).

**Graphlit** was the closest analog to Grey: multimodal ingestion, a temporal knowledge graph, an MCP server, 25+ model providers and usage pricing from $49 to $999/month plus credits. It is **winding down in 2026**, and its technology is up for sale ([Graphlit pricing](https://www.graphlit.com/pricing); [forage.ai](https://forage.ai/blog/rag-as-a-service-platforms/)).

**Ragie** had the most polished self-serve offer. It covered images, audio and video, hybrid search with reranking, entity extraction, an MCP server, and Fast vs Hi-res parsing at $0.02 vs $0.05 per page. It **"joined Ticketmaster" on July 27, 2026**, and the announcement gives no API continuity plan ([Ragie announcement](https://www.ragie.ai/blog/ragie-joins-ticketmaster); [Ragie pricing](https://www.ragie.ai/pricing)).

Contextual AI raised $100M. In May 2026 Google DeepMind took its CEO and 20+ researchers in a **~$80–100M licensing deal**, leaving an interim CEO ([Bloomberg](https://www.bloomberg.com/news/articles/2026-05-19/google-hires-staff-from-bezos-backed-contextual-ai-in-licensing-deal)). Other exits:

- **Nuclia** became Progress Agentic RAG after Progress acquired it in June 2025 ([Progress IR](https://investors.progress.com/news-releases/news-release-details/progress-software-acquires-nuclia-innovator-agentic-rag-ai)).
- **Needle** now sells an outbound-sales agent ([Needle](https://needle.app/)).
- **Mendable** shut at ~$250K ARR, and **Subtl.ai** shut in July 2025 ([forage.ai](https://forage.ai/blog/rag-as-a-service-platforms/); [tooldirectory.ai](https://tooldirectory.ai/tools/subtl-ai)).
- **Vectara** dropped its free and growth tiers in July 2026 and now starts at **$100K/year for SaaS** ([Vectara pricing](https://www.vectara.com/pricing)).

The low-code builder layer followed the same path. Workday acquired **Flowise** and then end-of-lifed it on August 31, 2026. The stated reason was that "the typical rigid workflow low-code approach quickly hits the limit" as developers move to coding agents ([GitHub discussion #6727](https://github.com/FlowiseAI/Flowise/discussions/6727)). DataStax removed hosted **Langflow** on April 9, 2026 ([DataStax docs](https://docs.datastax.com/en/langflow/administration.html)).

The survivors cluster into three groups:

| Product | Status (Oct 2026) | Audio/video | Knowledge graph | BYO-LLM / API surface | Entry price |
|---|---|---|---|---|---|
| Progress Agentic RAG (ex-Nuclia) | Acquired, relaunched Sep 2025 | Yes | Custom entity/relation schema | BYO-LLM, retrieval agents, MCP | $700–$1,925/mo ([Progress](https://www.progress.com/agentic-rag/pricing)) |
| Morphik | Active, YC, $500K seed | Multimodal | Auto-built KG | Open-source core + API | $0 / $59 / $799 ([Morphik](https://dev.morphik.ai/pricing)) |
| R2R (SciPhi) | Active, MIT | Incl. audio | Automatic KG extraction | REST API | Self-host ([GitHub](https://github.com/SciPhi-AI/R2R)) |
| AWS Bedrock Knowledge Bases | Active | Native audio/video | GraphRAG via Neptune (S3 only) | Any Bedrock model | $1/1K retrievals, $5/GB/mo ([AWS](https://aws.amazon.com/bedrock/pricing/)) |
| Pinecone Assistant | Active; CEO change, sale reportedly explored | Multimodal ingestion at 2x rate | None | Chat API, Context API, MCP per assistant | $50/mo min; $8/$15/$5 per M in/out/context ([Pinecone](https://www.pinecone.io/pricing/)) |
| Gemini File Search | Preview since Nov 2025 | Images cited | None | Gemini only | $0.15/M tokens to index, storage free ([Gemini docs](https://ai.google.dev/gemini-api/docs/file-search)) |
| Vectara | Independent, upmarket | Not confirmed | None found | BYO model (ChatGPT, Claude, Gemini) | $100K+/yr ([Vectara](https://www.vectara.com/pricing)) |
| Ragie | Acquired Jul 2026 | Yes | Entity extraction only | Retrieval API, MCP | $0 / $100 / $500 ([Ragie](https://www.ragie.ai/pricing)) |

Two patterns stand out. First, small RAG API companies get absorbed by firms that want the team for internal use (Perplexity, Ticketmaster, DeepMind, Progress), while hyperscalers absorb the feature. Second, money has not left the category. It has moved toward the "memory/graph" layer. **Cognee raised a $7.5M seed in February 2026** and Supermemory $2.6M in October 2025 ([Cognee pricing](https://www.cognee.ai/cheapest-ai-memory-platforms-pricing); [Supermemory](https://supermemory.ai/pricing/)). Grey's graph is aligned with where seed capital is going, while its hosted-Q&A half overlaps the commoditized layer.

Open source does not offer a shortcut. **Dify** (~158K stars) ships a license that restricts multi-tenant SaaS re-hosting ([GitHub](https://github.com/langgenius/dify)). **Open WebUI** now forbids removing its branding above 50 users ([license](https://docs.openwebui.com/license/)). **RAGFlow** is the closest open-source analog: per-document graphs and wikis, citation grounding, and per-assistant OpenAI-compatible endpoints. It has no hosted offering ([GitHub](https://github.com/infiniflow/ragflow)). Grey has to build its own core, though it can learn heavily from these projects.

## Buyers buy applications, and suites now give workspace Q&A away

The demand is real. **Enterprise GenAI spend tripled to $37B in 2025**, 51% of it on applications. **76% of solutions were bought rather than built**, up from 53% a year earlier. RAG is the second most common technique after prompt design ([Menlo Ventures](https://menlovc.com/perspective/2025-the-state-of-generative-ai-in-the-enterprise/)). Analysts put the standalone RAG market at only **~$1.9B in 2025, growing to ~$9.9B by 2030**, a model-based estimate best read as directional ([MarketsandMarkets via Yahoo](https://finance.yahoo.com/news/retrieval-augmented-generation-rag-market-141500359.html)). The same Menlo data shows enterprises spreading LLM API spend across **Anthropic (40%), OpenAI (27%) and Google (21%)**, which supports "connect your own LLM" as a real need rather than a niche one.

Buyers fail on data, not models. Gartner reports that **over 50% of GenAI projects were abandoned after proof of concept**, citing poor data quality, weak risk controls, rising costs and unclear value ([Gartner](https://www.gartner.com/en/articles/genai-project-failure)). Practitioners name the same RAG failure modes again and again:

- connectors that drop permissions
- chunking that destroys tables
- single-shot retrieval that cannot do multi-hop reasoning
- stale chunks that outrank fresh ones
- no evaluation at all

Sources: [Atolio](https://www.atolio.com/blog/enterprise-rag-guide); [DEV Community](https://dev.to/gabrielanhaia/70-of-enterprise-rag-deployments-fail-before-production-heres-what-kills-them-26ml). On Hacker News, document parsing is repeatedly called "the hardest part" ([HN](https://news.ycombinator.com/item?id=41072632)). Credit meters create a second complaint: Chatbase bots stop replying when credits run out, and Atlassian Rovo pauses at its cap ([SiteGPT](https://sitegpt.ai/blog/chatbase-review); [IV Consulting](https://ivconsulting.in/blogs/atlassian-rovo-vs-notion-ai-vs-clickup-brain-credits/)). Each of these failures is something a product can fix visibly, which matters more for Grey than any benchmark.

The pricing environment cuts both ways. Per a September 2026 comparison ([IV Consulting](https://ivconsulting.in/blogs/atlassian-rovo-vs-notion-ai-vs-clickup-brain-credits/)), suites are folding knowledge Q&A into the seat:

- **Notion AI** is included in Business at $20/member, and "everyday AI comes with the seat".
- **Atlassian Rovo** is bundled with paid Jira and Confluence.
- **ClickUp Brain** is a $9 add-on.

Google's NotebookLM, now **Gemini Notebook, has 30M+ users and 600K+ organizations**. It has set the consumer baseline: click-through citations, studio outputs (audio and video overviews, mind maps, slides), deep research, and since July 2026 per-notebook code execution ([Google blog](https://blog.google/innovation-and-ai/products/gemini-notebook/notebooklm-gemini-notebook/)). Above that, **Glean costs roughly $50–75/user/month with ~$60K minimums** ([Cybernews](https://cybernews.com/ai-tools/glean-ai-review/)). SMB support bots sell at **$40–$500/month (Chatbase)** and **$99–$499/month (CustomGPT)** ([SiteGPT comparison](https://sitegpt.ai/blog/ai-chatbot-pricing-comparison)). In practice, basic "ask my workspace" is becoming free, and paid value shows up in three places: outward-facing bots, API and agent access, and compliance-grade enterprise search.

Not everyone agrees the category is viable at all. One July 2026 analysis argues that "RAG-as-a-product is dying". Its case is that the base layer is commoditized (pgvector, cloud providers), while the hard problems (curation, chunking, evaluation, ACLs) differ for every organization ([Sam on AI](https://samonai.substack.com/p/rag-as-a-product-is-dying)). Its renewal-rate claims have no named source, but the structural argument matches the shutdown record. The implication for Grey is to avoid selling "RAG" at all. Grey should sell outcomes inside a workflow the customer already uses. In order of fit, the strongest segments are **agencies** managing many client knowledge bases, which maps directly to Flow projects; **SMB support teams** wanting a cheaper embedded bot; and **SMB internal knowledge**, where Glean is out of reach. Legal and regulated buyers are a poor fit at $15/month.

## Four priced presets beat forty ingestion knobs

Competitors expose ingestion settings in two layers. The first is an opinionated preset with a price signal: Ragie's fast vs hi_res, Unstructured's Auto/Fast/High-Res/VLM, and LlamaParse's four tiers ([Ragie](https://www.ragie.ai/pricing); [Unstructured](https://unstructured.io/pricing); [LlamaIndex](https://developers.llamaindex.ai/python/cloud/general/pricing/)). The second is a collapsed Advanced panel for chunking, embeddings and retrieval. Dify adds two details Grey should copy: a **chunk preview before committing**, and an explicit warning that chunk mode **cannot be changed after creation** ([Dify docs](https://docs.dify.ai/en/use-dify/knowledge/create-knowledge/chunking-and-cleaning-text)). RAGFlow adds **document-type templates** (Q&A, Manual, Paper, Laws, Table, Presentation) ([DataCamp](https://www.datacamp.com/tutorial/ragflow)). The parsing market has settled into cost tiers that map cleanly onto Grey presets:

| Grey preset | What it does | Reference cost of goods per 1K pages | Reference vendors |
|---|---|---|---|
| Fast | Text layer + basic OCR | ~$1.25–1.50 | LlamaParse Fast; hyperscaler OCR ([LlamaIndex](https://developers.llamaindex.ai/python/cloud/general/pricing/); [soceton](https://soceton.com/blogs/document-ai-ocr-pricing-comparison)) |
| Balanced (default) | Layout + tables to Markdown | ~$2–10, or self-hosted | Docling (MIT), Mistral OCR ~$4, LlamaParse cost-effective ~$3.75 ([docling.org](https://docling.org/); [The Rundown](https://www.therundown.ai/tools/mistral-ocr-4)) |
| High accuracy | VLM/agentic parsing for scans, charts, complex tables | ~$10–15 | Reducto $10, Unstructured $15, LlamaParse Agentic ~$12.50 ([Reducto](https://reducto.ai/pricing)) |
| Auto | Routes each page to the cheapest adequate tier | Range shown up front | LlamaParse Auto Mode claims "up to 80%" savings ([LlamaIndex pricing](https://www.llamaindex.ai/pricing)) |

These costs leave room for margin. Ragie charged **$20–50 per 1K pages retail** against $2–15 in parsing costs, so per-page metering on a cheap base plan is sustainable. Licensing points to self-hosted Docling (MIT) or MinerU as the default "Balanced" engine. Marker's model weights need a commercial license once revenue or funding passes $5M ([Datalab](https://www.datalab.to/pricing)).

Audio and video are cheaper to ingest than most teams assume. Batch transcription with diarization costs **$0.15–0.40 per hour**: AssemblyAI $0.15, ElevenLabs Scribe $0.22, OpenAI $0.36 ([futureagi](https://futureagi.com/blog/speech-to-text-apis-in-2026-benchmarks-pricing-developer-s-decision-guide/)). Ragie charged $0.40/hour retail for audio and $1.50/hour for video ([Ragie](https://www.ragie.ai/pricing)). Visual understanding of video is the expensive part. Twelve Labs indexing costs about **$2.61 per hour** ([Twelve Labs](https://www.twelvelabs.io/pricing)), and Gemini consumes **~300 tokens per second of video** at default resolution ([Gemini docs](https://ai.google.dev/gemini-api/docs/video-understanding)). The default should be transcript-first: diarized transcripts chunked by speaker turn or a 30–60 second window, with `start_ms`/`end_ms` stored on every chunk so citations deep-link into the Assets player. Visual keyframe captioning should be a priced toggle.

The evidence on chunking favors simple defaults combined with context enrichment. Vectara's NAACL 2025 study found **fixed-size chunking matched or beat semantic chunking** on realistic corpora, at a fraction of the compute ([ACL Anthology](https://aclanthology.org/2025.findings-naacl.114/)). Anthropic's contextual retrieval prepends LLM-generated context to each chunk. Contextual embeddings alone cut retrieval failures by **35%**, adding contextual BM25 brings it to **49%**, and adding a reranker brings it to **67%**, at about **$1.02 per million document tokens** with prompt caching ([Anthropic](https://www.anthropic.com/news/contextual-retrieval)). That makes the following Grey defaults:

- structure-aware parsing to Markdown
- heading-aware recursive splits of ~400–512 tokens with 10–15% overlap
- tables kept atomic
- heading breadcrumbs prepended to each chunk
- hybrid BM25 + vector search with reranking on by default

Contextual enrichment and parent-child retrieval should be paid toggles. Semantic chunking can be buried or dropped.

The embedding model should be a mostly fixed, project-level choice, because changing it forces a full re-embed. Dimension and quantization can be storage knobs. **Cohere Embed 5** supports 256–2048 dimensions with int8/binary output, and its Pro ($0.12/M) and Fast ($0.08/M) tiers **share one embedding space**, so documents can be indexed with Pro and queried with Fast ([Cohere](https://cohere.com/blog/embed-5)).

Two operational features are underbuilt across the market:

- **Pre-run cost estimation.** Page counts, media durations and token estimates are all known at upload time, yet no vendor in the research surfaces them well.
- **Stage-hashed incremental re-ingestion.** LlamaIndex's `doc_id → hash` plus per-transformation caching is the reference pattern ([LlamaIndex](https://developers.llamaindex.ai/python/framework/module_guides/loading/ingestion_pipeline/)). Grey should cache parse output so that a chunk-size change never pays for parsing again, and swap index versions atomically so a re-ingest never serves a half-built knowledge base.

## Build the graph cheaply in Postgres and route queries to it selectively

The evidence on graph retrieval is now fairly clear. In GraphRAG-Bench (ICLR 2026), graphs **tie vector retrieval on simple fact lookup (60.1 vs 60.9)** but win on **complex reasoning (53.4 vs 42.9)** and **contextual summarization (64.4 vs 51.3)** ([VentureBeat](https://venturebeat.com/orchestration/stop-graphing-everything-when-graphrag-actually-beats-vector-rag)). A Michigan State/Meta study found the same split: vector RAG is better on single-hop, graphs on multi-hop ([arXiv 2502.11371](https://arxiv.org/pdf/2502.11371)).

The costs are what make naive GraphRAG dangerous for a $15 product. In one 2026 analysis, a question used **879 prompt tokens with vector retrieval, 38,707 with GraphRAG local search and 331,375 with global search**. Indexing a 10M-token corpus cost ~$1.40 for vectors against ~$430 for standard Microsoft GraphRAG ([beri.net](https://www.beri.net/article/graphrag-vs-vector-rag-indexing-query-cost-lightrag-lazygraphrag-2026)). Those dollar figures rest on unverified model prices, so the ratios are the signal. Cheaper designs close most of the gap. Microsoft's **LazyGraphRAG indexes at 0.1% of full GraphRAG's cost** and is comparable on global queries at over 700x lower query cost ([Microsoft Research](https://www.microsoft.com/en-us/research/blog/lazygraphrag-setting-a-new-standard-for-quality-and-cost/)). **HippoRAG 2 used 9.2M indexing tokens where GraphRAG used 115.5M**, and still beat dense retrieval ([arXiv 2502.14802](https://arxiv.org/html/2502.14802v1)).

Grey's graph clears a lower bar than a pure QA system's would, because it has value beyond retrieval: exploration, CRM-style relationships from Forms, and provenance. The right design is to **extract cheaply on ingest, keep default chat on hybrid retrieval, and expand through the graph only when a router detects multi-hop, entity-centric or global intent**. Community summaries should be an opt-in "deep index" upgrade. Practitioners warn that if fewer than 1 in 10 questions are global, a full graph is "a cost center" ([beri.net](https://www.beri.net/article/graphrag-vs-vector-rag-indexing-query-cost-lightrag-lazygraphrag-2026)).

Storage should stay in Supabase. **Apache AGE is not available on Supabase** or most managed Postgres providers ([Supabase discussion](https://github.com/orgs/supabase/discussions/13263); [pg-raggraph](https://github.com/yonk-labs/pg-raggraph)). It is also not needed. The pg-raggraph project models entities, relationships and facts as plain tables, expands the graph with recursive CTEs alongside vector and full-text search in one SQL query, and reports **sub-millisecond p50 through three hops versus 33.7–132.1 ms for AGE Cypher**. It also reports **+19.3% top-chunk retrieval over vector+BM25**, with entity resolution via pg_trgm plus vector similarity ([pg-raggraph](https://github.com/yonk-labs/pg-raggraph)). These are self-reported numbers, but the architecture is sound for the one-to-two-hop expansion most GraphRAG retrievers use.

The existing `grey_knowledge_nodes` table should evolve into four tables, all protected by row-level security (RLS) on `project_id`:

- **`kg_entities`**: type, canonical name, aliases, properties, embedding, `source_app`, `confidence`, `merged_into`.
- **`kg_relations`**: bi-temporal `valid_from`/`valid_to`, so facts are invalidated rather than deleted.
- **`kg_mentions`**: links each entity or relation to a chunk, document, page or timestamp for provenance.
- **`kg_communities`** (optional): community summaries for the deep index.

Community detection (Leiden/Louvain) has to run in a worker outside Postgres.

For the "Forms pushes entities in" requirement, the model to copy is **Graphiti/Zep**, not Microsoft's batch GraphRAG. Graphiti ingests incremental episodes, resolves entities on insert, merges duplicates, and invalidates outdated edges. It explicitly mixes conversational and structured business data in one graph ([Zep paper](https://arxiv.org/pdf/2501.13956.pdf)). Entities from Forms should land as authoritative, high-confidence records with no LLM involved. LLM-extracted entities should carry confidence scores and mention links. That keeps the CRM use clean while letting documents enrich it. A small default ontology (Person, Organization, Product, Location, Event, Concept, Document) with an "Other" escape hatch, editable per project, mirrors what Neo4j's LLM Graph Builder and LlamaIndex's schema-guided extractors expose ([Neo4j Labs](https://neo4j.com/labs/genai-ecosystem/llm-graph-builder-features/); [LlamaIndex](https://www.llamaindex.ai/blog/introducing-the-property-graph-index-a-powerful-new-way-to-build-knowledge-graphs-with-llms)).

The UX is where Grey can lead. Bedrock's managed GraphRAG has no first-class graph explorer, and Glean and Writer use graphs internally without exposing them for editing. **Neo4j's LLM Graph Builder** is the best UX reference, but it is a Labs tool rather than a SaaS product. It offers a schema picker, lexical/entity/full graph views, deduplication, orphan cleanup, and chat that shows retrieval sources ([Neo4j Labs](https://neo4j.com/labs/genai-ecosystem/llm-graph-builder-features/)). **LightRAG's WebUI** shows inline entity editing and merges that re-point relationships ([DeepWiki](https://deepwiki.com/HKUDS/LightRAG/7-web-ui-(lightrag_webui))). Grey's existing react-force-graph explorer should gain:

- type filters and search-to-focus
- ego-network expansion on click, with a top-N degree cap for large graphs
- a shadcn Sheet entity panel showing aliases, relations, "mentioned in" chunks with jump-to-source, and a `source_app` badge
- a duplicate-suggestion merge queue
- **click-a-node-to-chat**

Users will expect the last item because NotebookLM's mind map already does it ([Jeff Su](https://www.jeffsu.org/notebooklm-changed-completely-heres-what-matters-in-2026/)).

## Serve every knowledge base three ways, and never pay for a customer's failed key

By 2026, competitors expose a knowledge base through three standard surfaces:

- **An OpenAI-compatible chat endpoint per pipeline.** RAGFlow exposes `/api/v1/chats_openai/{chat_id}/chat/completions` with streaming and optional references, and LiteLLM lists RAGFlow as a "provider", so a RAG pipeline can be consumed like a model ([RAGFlow API](https://ragflow.io/docs/http_api_reference); [LiteLLM](https://docs.litellm.ai/docs/providers/ragflow)).
- **A retrieval-only "context" API** for customers who bring their own generation step. Pinecone's Context API returns expanded chunks with scores and references ([Pinecone docs](https://docs.pinecone.io/guides/assistant/overview)).
- **A remote MCP server per knowledge base.** Pinecone runs one MCP server per Assistant, Dify publishes apps as MCP endpoints, and Ragie markets one ([Pinecone MCP](https://www.pinecone.io/blog/assistant-MCP/); [Dify v1.6.0](https://dify.ai/blog/v1-6-0-built-in-two-way-mcp-support)).

The industry frames this as context engineering: retrieval as one input alongside memory and tools, increasingly consumed by agents through MCP ([Sourcegraph](https://sourcegraph.com/blog/context-engineering); [RAGFlow review](https://ragflow.io/blog/rag-review-2025-from-rag-to-context)). Grey should ship all three surfaces plus an embeddable widget. Each pipeline should be a versioned configuration row holding model, temperature, system prompt, top-k, rerank and threshold. Responses should include a `citations` extension field.

BYO-LLM billing models fall into three groups:

- **Included credits, then BYOK** (Dify).
- **Pure BYOK** (AnythingLLM Cloud at $50–99/month).
- **Gateway routing** ([Dify](https://dify.ai/pricing); [AnythingLLM](https://anythingllm.com/pricing)).

On Grey's stack, the natural design has four parts:

1. Store each tenant's provider key in **Supabase Vault**, which uses libsodium AEAD with the root key held outside the database. Lock down the `decrypted_secrets` view, because "anyone that has access to the view has access to decrypted secrets" ([Supabase Vault](https://supabase.com/docs/guides/database/vault)).
2. Decrypt the key per request in a server-side function.
3. Route the call with request-scoped BYOK through **Vercel AI Gateway**, which charges **no markup or platform fee, including on BYOK** ([Vercel pricing](https://vercel.com/docs/ai-gateway/pricing)).
4. Add a generic "OpenAI-compatible base URL + key + model" option, which covers vLLM, Ollama, Groq and Together in one integration.

There is a material catch. Vercel's docs state that if a BYOK request fails, the Gateway **retries with system credentials billed to the platform's account**, and BYOK spend "isn't counted in budgets" ([Vercel BYOK](https://vercel.com/docs/ai-gateway/authentication-and-byok/byok)). For a multi-tenant product, that means a customer's revoked or exhausted key silently becomes Grey's cost. The research could not confirm whether this fallback can be disabled. Until it is verified, the safer option is to call providers directly through the AI SDK for BYOK tenants, health-check keys on save, and meter usage per tenant inside Grey. OpenRouter is the alternative gateway: it charges 5% on BYOK after $25K/month free and can be set to fail rather than fall back ([OpenRouter](https://openrouter.ai/docs/use-cases/byok)).

Production features separate a demo from a service:

- **Multi-tenancy and partitions.** Ragie ships "Partitions" for multi-tenancy on every plan ([Ragie](https://www.ragie.ai/pricing)). On Supabase, RLS plus metadata filters (`tenant_id`, `end_user_id`, ACL groups) on pgvector chunks provide the same thing, exposed as a `user`/`filter` parameter.
- **Permission-aware retrieval.** Onyx keeps permission syncing behind its paid license ([Onyx](https://onyx.app/pricing)), and Microsoft sets the bar: agents search only what the user can access ([Microsoft Learn](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/knowledge-sources)).
- **Observability.** This can be outsourced cheaply. Langfuse is MIT-licensed and starts at $29/month in the cloud ([Langfuse](https://langfuse.com/pricing)).
- **Evaluation.** RAGAS-style faithfulness, relevance and context precision/recall are the standard metrics ([Atlan](https://atlan.com/know/llm-evaluation-frameworks-compared/)). Pinecone already sells evaluation as a metered feature ([Pinecone](https://www.pinecone.io/pricing/)).

Grey should charge for **retrievals rather than LLM tokens**. Grey cannot see a BYOK tenant's LLM spend, so per-retrieval pricing keeps those tenants profitable.

## The suite is the connector moat that RAG APIs cannot copy

Carbon's fate shows that thin connector middleware gets acquired rather than becoming a durable business ([HN](https://news.ycombinator.com/item?id=42452009)). Glean's reviewers complain about the reverse problem: heavy IT setup that needs admin access to every tool, and confusing permission-filtered results ([G2](https://www.g2.com/products/glean-technologies-glean/reviews?qs=pros-and-cons)). Grey avoids both. It owns the source apps, so it can ingest them without connectors and inherit their permissions natively. Mapping each pain point from the evidence onto the suite gives a feature set no standalone competitor can match:

| Feature | Suite apps involved | Pain it answers | Phase |
|---|---|---|---|
| Project = knowledge base; answers spawn tasks; task attachments auto-ingested | Flow | Setup friction; "unclear business value" | MVP |
| Media ingestion from the DAM with page/timestamp deep-link citations; transcripts and extracted tags written back to the asset | Assets | Parsing quality; NotebookLM-style citation expectations | MVP |
| Authoritative entity push into the graph (light CRM); form submissions seed golden Q&A sets | Forms | Graph noise; no evaluation | MVP (entities), Phase 2 (eval) |
| Auto-sync notes with inherited permissions; studio outputs (briefs, summaries) saved as notes | Notes | Connectors dropping permissions; staleness | Phase 2 |
| Embeddable Q&A/support widget on Content-powered sites; Content entries ingested; drafts published back | Content | SMB support-bot demand at $40–500/mo | Phase 2 |
| Grey bot in channels; channel history ingested with permissions | Chat | Glean-style internal Q&A without per-seat cost | Phase 2 |
| Scheduled research digests and "what changed in this knowledge base" emails | Campaign | Freshness; outbound value NotebookLM lacks | Phase 3 |
| Session recordings and decks ingested; speaker/attendee entities in the graph; event Q&A bot | Events | Multimodal value; reuse of event content | Phase 3 |
| Usage, cost, deflection, unanswered-question and eval dashboards | Dash | Cost unpredictability; no evaluation | Phase 2 |

Several cross-cutting features rest on direct evidence:

- **Owners, review dates and "verified" badges.** Guru's answer to staleness is SME verification ([Guru](https://www.getguru.com/features/verification)).
- **Soft caps with graceful degradation instead of hard pauses.** The Chatbase and Rovo complaints are the warning here.
- **White-label widgets for agencies.** Chatbase charges $99/month just to remove its branding ([SiteGPT](https://sitegpt.ai/blog/chatbase-review)).
- **A documented export guarantee** covering chunks, embeddings, graph and eval sets. This answers the stranding fear that Carbon, Graphlit and Ragie customers all experienced.

The Events and Dash rows are design inferences from the suite map rather than findings from the research. They are lower priority for that reason.

## Recommendation: position, scope, price and risks

**Positioning.** Grey should be described as "the knowledge layer for your Geiger projects". Every project's files, media, notes and form data become a cited knowledge base and a living graph, which the team can query, embed on a site, or plug into any LLM or agent. Grey should not be marketed as a RAG API or as "chat with your docs". Hyperscalers price that plumbing near zero, and Notion, Rovo and Gemini Notebook give it away. Lead with outcomes for the three target segments: client knowledge portals for agencies, support deflection for SMBs, and internal answers for teams too small for Glean.

**MVP scope (first release).** The MVP should cover the following:

- **Ingestion settings:** four presets (Fast, Balanced default, High accuracy, Auto) with a per-file cost estimate before the run; content-type templates; a collapsed Advanced panel; warnings for settings that are locked after creation; and a chunk preview.
- **Media:** PDF, Office, images (OCR) and transcript-first audio/video from Assets.
- **Retrieval:** hybrid pgvector + full-text search with reranking.
- **Graph:** cheap extraction with a default ontology, the four-table schema replacing `grey_knowledge_nodes`, Forms entity push, and the force-graph explorer with entity panel, merge queue and click-to-chat.
- **Hosted Q&A:** page- and timestamp-level citations.
- **BYO-LLM serving:** keys in Vault, called directly through the AI SDK, plus a retrieval API and per-project MCP server, scoped by RLS.
- **Infrastructure:** ingestion jobs on a durable background worker rather than in request handlers, and a full export endpoint.

**Phase 2.** Add the following:

- the OpenAI-compatible `/chat/completions` endpoint
- the Content widget with white-label option
- Notes and Chat auto-sync with inherited ACLs
- contextual enrichment and parent-child retrieval as paid toggles
- eval sets with a Dash dashboard
- freshness and verification badges
- Langfuse tracing

**Phase 3.** Add the following:

- the optional graph "deep index" (community summaries, global questions)
- video visual understanding
- Campaign digests and Events ingestion
- external connectors (Drive, Notion) only if demand appears
- enterprise controls (SSO, audit logs, residency)

**Pricing approach.** The internal ~$15/month add-on is below every self-serve competitor: Morphik and Dify at $59, Ragie at $100, CustomGPT at $99. That price is sustainable only if it covers the fixed experience and meters the variable costs:

| Component | Recommended treatment | Evidence anchor |
|---|---|---|
| Basic Q&A over suite data (Notes, Flow) | Consider including in base or Dash plans | Notion, Rovo and Gemini Notebook bundle it |
| Grey add-on (~$15/workspace/mo) | Uploaded media knowledge bases, graph explorer, MCP/retrieval API, BYOK, a modest monthly allowance of Balanced pages, media minutes and retrievals | Competitor entry tiers $59–100 |
| Ingestion overage | Per page by preset, per media minute, per million tokens for graph extraction and contextual enrichment, always estimated before the run | Parsing $1–15/1K pages; transcription $0.15–0.40/hr; Ragie retail $20–50/1K |
| Serving | Per 1K retrievals above the allowance (API, MCP, widget) | Bedrock $1/1K; OpenAI $2.50/1K file-search calls |
| LLM generation | BYOK at zero markup; hosted models at a disclosed markup | Vercel 0% markup; Botpress moved SMBs to bundled AI spend |
| Public widget / white-label | Higher tier (~$49–99) | Chatbase $99 branding removal; support bots $40–500 |
| Limits | Soft caps with alerts; fall back to retrieval-only answers rather than going dark | Chatbase and Rovo pause complaints |

The specific allowance numbers should be set from measured cost of goods during a beta, not copied from this table.

**Key risks, in order:**

1. **Commoditization.** Gemini File Search and OpenAI vector stores make basic RAG nearly free. The mitigation is to compete only on suite context, graph and delivery, and to treat the hyperscalers as possible backends.
2. **Graph cost blowouts.** Full GraphRAG can turn a $1 index into a $400 one. The mitigation is cheap extraction by default, query routing, and graph builds shown in the cost estimate.
3. **Permission leakage.** Access-control bugs in filter logic are "among the most severe and hardest-to-detect failures" ([Atolio](https://www.atolio.com/blog/enterprise-rag-guide)). The mitigation is to enforce RLS at retrieval time, not in the UI.
4. **BYOK fallback billing on Vercel AI Gateway.** Verify the behavior or bypass the gateway for BYOK tenants.
5. **License traps.** Dify, Open WebUI and Marker weights each carry one.
6. **The buyer's survival question after a decade of RAG shutdowns.** Answer it with export guarantees and the fact that Grey ships inside a broader suite rather than as a single-feature startup.

Several facts remain unverified and should be checked before committing:

- whether Ragie's API stays open
- whether Vercel's BYOK fallback can be disabled
- current Mistral OCR and transcription list prices
- the GraphRAG-Bench figures, which came via secondary reporting

## Conclusion

The record of the last two years separates two things that look alike. "Grey" as a feature has strong demand: multimodal ingestion, an editable graph, and cited answers served to any model. "Grey" as a standalone company has failed repeatedly. Grey's advantage is not technical, since every component is replicable and much of it is open source. Its advantage is that the suite already holds the data, the permissions and the destinations. That changes what the knowledge graph is for. Its main job is not to lift retrieval scores, which matter only for the minority of multi-hop and global questions. Its main job is to be the **shared entity registry for the whole suite**: Forms writes into it, Notes and Assets cite into it, Flow acts on it, and agents read it over MCP. Seen this way, the graph is the stickiest asset Grey can build and the one hardest for a hyperscaler or a seat-bundled assistant to copy.

Pricing follows from the same logic. A $15 add-on cannot carry the cost of goods of a RAG platform, but it does not need to if it is the entry point to a metered, cost-transparent layer that grows with media volume and outward traffic. The hard requirements are to show every cost before it is incurred and never let a public widget go dark. Grey should build the context layer the suite needs, and the RAG product will follow from it.
