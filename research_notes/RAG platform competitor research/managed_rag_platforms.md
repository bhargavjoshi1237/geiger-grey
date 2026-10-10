# Managed / Hosted RAG-as-a-Service Platforms: Competitor Catalog (as of Oct 10, 2026)

Scope note: research done Oct 10, 2026 via web search + vendor pricing/docs pages fetched that day. Where a fact comes from a third-party aggregator, an older date, or could not be confirmed on a primary page, it is flagged inline (FLAG). Pricing pages fetched today are treated as current.

---

## Q1. Competitor catalog: what each product is, inputs, ingestion settings, retrieval, graph, BYO-LLM, APIs, connectors, deployment, compliance, pricing, status

### Takeaway
The independent "RAG-as-a-service" startup tier has thinned out sharply in 2025-2026 (Carbon, Graphlit, Mendable gone; Ragie acquired by Ticketmaster; Contextual AI's founders/research team taken by Google DeepMind; Needle pivoted; Vectara moved to $100K+/yr enterprise only). What remains is (a) hyperscaler building blocks (Bedrock KB, Vertex RAG Engine, Azure AI Search/Foundry IQ, OpenAI File Search, Gemini File Search) that are cheap and increasingly multimodal/graph-capable, (b) enterprise-priced platforms (Vectara, Progress Agentic RAG, Cohere North, Contextual AI), and (c) small dev-first/open-source players (Morphik, R2R, Cognee, Supermemory, LlamaCloud, Langbase, CustomGPT for no-code).

### Cited Findings

#### Independent RAG-as-a-service platforms

**Ragie** (status: ACQUIRED by Ticketmaster, July 27, 2026)
- Positioning: "the context engine for agents, assistants and apps"; fully managed RAG-as-a-Service with indexing, parsing, entity extraction — [Ragie homepage](https://www.ragie.ai/)
- Inputs: text/PDF, images, audio and video, PowerPoint, tables/forms/charts — [Ragie homepage](https://www.ragie.ai/)
- Connectors: Google Drive, Notion, Confluence, Slack + connector marketplace; MCP server with permissioned KB access — [Ragie homepage](https://www.ragie.ai/)
- Retrieval: builds three indexes (vector, keyword, summary) → hybrid; LLM reranking, entity extraction, chunk filtering, summary-based retrieval — [Ragie homepage](https://www.ragie.ai/). All plans include hybrid search, reranking, entity extraction, partitions, hierarchical search, recency bias, multi-language — [Ragie pricing](https://www.ragie.ai/pricing)
- Ingestion settings exposed: "Fast" vs "Hi-res" processing modes (priced differently) — [Ragie pricing](https://www.ragie.ai/pricing)
- Compliance/deployment: claims SOC 2 Type II, GDPR, HIPAA; cloud, VPC, or on-prem — [Ragie homepage](https://www.ragie.ai/) (FLAG: forage.ai lists it as SaaS only — [forage.ai](https://forage.ai/blog/rag-as-a-service-platforms/))
- Pricing: Developer free (1,000 pages); Starter $100/mo (10,000 pages); Pro $500/mo (60,000 pages); Enterprise custom. Fast $0.02/page, Hi-res $0.05/page, storage $0.002/page/mo; audio $0.0067/min, video $0.025/min, streaming $0.001/MB, media storage $0.12/GB/mo; first connector free then $250/connector/mo — [Ragie pricing](https://www.ragie.ai/pricing)
- Customers: Zapier, Ellis, Glue, Vambe — [Ragie homepage](https://www.ragie.ai/)
- Funding: $5.5M seed (Aug 2024, Craft Ventures, Chapter One, Saga, Valor) — [Tracxn](https://tracxn.com/d/companies/ragie/__ouO3CdjThofC4vYM2gg2H62VIDJBL9AVa1OZ38kJcuo/funding-and-investors); [VentureBeat](https://venturebeat.com/ai/ragie-debuts-enterprise-rag-as-a-service-raises-5-5m-seed)
- Status: "Ragie joins Ticketmaster" post dated July 27, 2026 (Investor News); CEO Bob Remeika; founders transitioning to apply Ragie tech inside Ticketmaster. Announcement does NOT state an API shutdown date or customer migration plan — [Ragie blog](https://www.ragie.ai/blog), [Ragie announcement](https://www.ragie.ai/blog/ragie-joins-ticketmaster). Pricing page still live as of Oct 10, 2026 — [Ragie pricing](https://www.ragie.ai/pricing)

**Vectara** (status: independent; repriced upmarket July 2026)
- Positioning: enterprise agent platform with built-in RAG, hallucination detection/correction (HHEM factual-consistency score), governance; agent harness with skills, tools, MCP, memory, sub-agents — [AppSecSanta review](https://appsecsanta.com/vectara)
- MCP server exposes ask_vectara, search_vectara, correct_hallucinations, eval_factual_consistency — [AppSecSanta](https://appsecsanta.com/vectara); [Glama MCP listing](https://glama.ai/mcp/servers/vectara/vectara-mcp/inspect)
- Models: Boomerang retrieval model, Mockingbird RAG LLM, plus BYO model (ChatGPT, Claude, Gemini) — [Vectara pricing](https://www.vectara.com/pricing)
- Pricing: 30-day free trial; SaaS from $100K/yr; VPC from $250K/yr; on-prem from $500K/yr; add-ons: forward-deployed AI engineer, platinum support — [Vectara pricing](https://www.vectara.com/pricing). Repriced July 2026, free/growth tiers removed — [forage.ai](https://forage.ai/blog/rag-as-a-service-platforms/)
- Funding: $25M Series A (July 2024, FPV, Race Capital) + $28.5M seed = $53.5M — [BigDATAwire](https://www.hpcwire.com/bigdatawire/this-just-in/vectara-secures-25m-series-a-funding-to-advance-rag-trustworthiness-with-new-mockingbird-llm/); a Tracxn-derived summary says $73.5M total over 3 rounds (conflict, unverified) — [Tracxn](https://tracxn.com/d/companies/vectara/__B2HorZ0b9oeKtrr4S1EDjqD-0h8QipBkMx5sL3VtgNk)
- Vendor claims >100% new revenue growth in H1 2026 (vendor press, unaudited) — [Vectara newsroom](https://www.vectara.com/company/newsroom/press-release)
- Knowledge graph: no evidence found.

**Pinecone Assistant** (status: independent; CEO change Sept 2025; sale exploration reported)
- Features: chat API (JSON or stream), context API to "use with your own LLM or agent" (BYO-LLM via retrieval-only), metadata filtering, citations, custom instructions, evaluation (correctness/completeness), MCP server — [Pinecone docs](https://docs.pinecone.io/guides/assistant/overview)
- Pricing (current page): Starter free (1GB storage, 500k input tokens, 300k output, 500k context tokens, 1,000 ingestion units/mo); Builder tier (3GB, 2M in, 1M out, 2M context, 10K ingestion units); Standard ($50/mo min) / Enterprise ($500/mo min): storage $3/GB/mo, input $8/M, output $15/M, context-processed $5/M, ingestion $0.0005/unit, $0.001/unit multimodal — [Pinecone pricing](https://www.pinecone.io/pricing/)
- Older complaint (June 2025): Assistant billed $0.05 per assistant per hour even when idle; staff escalated to product — [Pinecone Community](https://community.pinecone.io/t/why-is-pinecone-assistant-so-expensive-any-tips-to-reduce-the-cost/8111). FLAG: hourly fee not visible on Oct 2026 pricing page; may have been removed.
- Corporate: Ash Ashutosh named CEO Sept 8, 2025; founder Edo Liberty → Chief Scientist — [Pinecone blog](https://www.pinecone.io/blog/growing-ai-ambitions/). Reports Pinecone explored a sale after losing Notion as a customer; no deal announced — [search summary of reporting; see VentureBeat](https://venturebeat.com/data-infrastructure/pinecone-founder-edo-liberty-appoints-googler-ash-as-ceo)
- Knowledge graph: none found.

**Contextual AI** (status: founders + 20+ researchers licensed/acqui-hired by Google DeepMind, May 2026; company continues under interim CEO)
- Product: enterprise RAG agent platform ("RAG 2.0", jointly optimized retriever/generator); GA Jan 2025; Grounded Language Model Mar 2025 — [Wikipedia](https://en.wikipedia.org/wiki/Contextual_AI). Agent Composer launched Jan 27, 2026 (six pre-built agents: basic search, agentic search, deep research, root-cause analysis, task execution, structured extraction; visual builder) targeting aerospace/semiconductor/engineering — [VentureBeat](https://venturebeat.com/technology/contextual-ai-launches-agent-composer-to-turn-enterprise-rag-into-production); [Contextual blog](https://contextual.ai/blog/introducing-agent-composer)
- Pricing: On-demand with $25 free credits; Parse $3/1,000 pages text-only, $40/1,000 pages multimodal; Rerank-v2 $0.05/M tokens, Rerank-v2-mini $0.02/M; Generate $3/M in, $15/M out; LMUnit $3/M. On-demand includes unlimited users/agents/datastores, query optimization, reranking, filtering, groundedness eval, SaaS. Enterprise: SSO, RBAC, SLA, VPC, custom integrations — [Contextual pricing](https://contextual.ai/pricing/)
- Compliance: SOC2 Type II (on-demand); HIPAA on Enterprise — [Contextual pricing](https://contextual.ai/pricing/)
- Funding: $20M seed (2023, Bain Capital Ventures); $80M Series A (Aug 2024, Greycroft; Bezos Expeditions, NVentures) — [Wikipedia](https://en.wikipedia.org/wiki/Contextual_AI)
- May 19-20, 2026: Google DeepMind hired 20+ researchers incl. CEO Douwe Kiela and licensed the tech for ~$80-100M; not an acquisition; interim CEO Jay Chen — [Bloomberg](https://www.bloomberg.com/news/articles/2026-05-19/google-hires-staff-from-bezos-backed-contextual-ai-in-licensing-deal); [Silicon UK](https://www.silicon.co.uk/ai-2/google-contextual-ai-629967); [WinBuzzer](https://winbuzzer.com/2026/05/20/deepmind-contextual-ai-deal-follows-hume-licensing-playbook-xcxwbn/). Observers suggest likely wind-down or pivot (speculative) — [Krasa.ai](https://www.krasa.ai/news/google-deepmind-contextual-ai-acquihire-douwe-kiela-90-million-may-2026)

**Progress Agentic RAG (formerly Nuclia)** (status: acquired by Progress Software June 30, 2025; relaunched Sept 10, 2025)
- Acquisition — [Progress IR](https://investors.progress.com/news-releases/news-release-details/progress-software-acquires-nuclia-innovator-agentic-rag-ai); ~$50M reported (secondary source) — [ragaboutit.com](https://ragaboutit.com/how-progress-softwares-50m-nuclia-acquisition-just-changed-enterprise-rag-forever/); relaunch date — [forage.ai](https://forage.ai/blog/rag-as-a-service-platforms/)
- Inputs: 30+ content types incl. text, HTML, Markdown, JSON, PDF, Word, images (JPEG/PNG/TIFF), video (MP4/AVI/MPEG), audio (MP3/WAV) indexed into a "knowledge box" — [Progress Agentic RAG](https://www.progress.com/agentic-rag)
- Knowledge graph: configurable entity + relation extraction (define entity types with descriptions, relation labels, ≥3 examples) to build custom KGs — [Progress docs: custom graph](https://docs.rag.progress.cloud/docs/ingestion/how-to/custom-graph/); [Nuclia](https://nuclia.com/developers/from-unstructured-data-to-connected-knowledge/)
- Retrieval agents query knowledge boxes, SQL DBs, internet search and MCP servers; user controls retrieval strategy, LLM, pipeline config (BYO-LLM) — [Progress Agentic RAG](https://www.progress.com/agentic-rag)
- Pricing: Starter $700/mo (text-only files, max 750MB/file, 5GB indexed or 15k resources); Pro $1,925/mo (all file types, 1.5GB/file, 25GB or 80k resources, AI classification, generative search, AI assistant, summarization); Enterprise custom (cloud & hybrid cloud) — [Progress pricing](https://www.progress.com/agentic-rag/pricing). Available on AWS Marketplace — [AWS Marketplace](https://aws.amazon.com/marketplace/pp/prodview-mzfuii2riokkc)
- This is architecturally the closest match to Grey (multimodal incl. AV + KG + BYO-LLM + hosted Q&A), but priced at enterprise mid-market.

**Graphlit** (status: WINDING DOWN, 2026)
- Was: managed "AI context and agent platform" with 50+ source integrations, GraphRAG, temporal knowledge graph, AI gateway across 25+ model providers — [search summary of Kirk Marple LinkedIn/X](https://www.linkedin.com/in/kirkmarple/)
- Pricing page still live: Free; Hobby $49/mo + $0.10/credit (10GB, 10K items); Starter $199/mo + $0.09/credit (100GB, 100K items); Growth $999/mo + $0.08/credit (unlimited). KG (entity extraction, observables, relationships, graph queries); audio transcription 10 min/credit, video 4 min/credit; MCP server (Claude, Cursor, ChatGPT); feeds: RSS, web, Notion, blob storage — [Graphlit pricing](https://www.graphlit.com/pricing)
- Founder: "After five years, I'm making the hard call…" — wind-down; free-account data export closes Aug 1, 2026; tech available to acquire; paid customers get assisted export — [forage.ai](https://forage.ai/blog/rag-as-a-service-platforms/); [Kirk Marple LinkedIn](https://www.linkedin.com/in/kirkmarple/)
- Funding ~$3.6-4M seed (2021/2022), ~4 employees — [Graphlit PitchBook/Latka summaries](https://getlatka.com/companies/graphlit.com)
- Significance: the most Grey-like product (multimodal + KG + MCP + usage pricing) could not become a standalone business.

**Needle** (status: PIVOTED away from RAG)
- Previously RAG/AI search + agent platform; raised $2.2M seed (Berlin) — [Needle news](https://needle.app/news/needle-seed-funding); [Vestbee](https://www.vestbee.com/insights/articles/needle-secures-2-2-m)
- Current site sells an "agent-native outbound engine" (LinkedIn/Instagram/email prospecting), $69/account/mo; no mention of RAG, collections, or document upload — [Needle homepage](https://needle.app/); [Needle pricing](https://needle.app/pricing)

**Morphik** (status: active, small YC company)
- Open-source core (morphik-core) + hosted; multimodal ingestion & queries on all tiers; knowledge graph ("community graph templates") — [Morphik pricing](https://dev.morphik.ai/pricing); auto-builds knowledge graphs mapping entities across documents; direct image retrieval, caching — [Tracxn](https://tracxn.com/d/companies/morphik/__8aw_SnLiGCiGQhq0KuP7223BKBcL2VvUJAL0ELW49CU); [Show HN](https://news.ycombinator.com/item?id=43763814)
- Pricing: Free (200 pages, 3 research-agent calls/mo); Pro $59/mo (2,000 pages); Team $799/mo (10GB, unlimited queries, auto-scale $2.5/GPU-hr); overages $0.03/page; Enterprise custom with SOC 2 + HIPAA/BAA — [Morphik pricing](https://dev.morphik.ai/pricing)
- Funding: $500K YC seed (June 2025) — [Tracxn](https://tracxn.com/d/companies/morphik/__8aw_SnLiGCiGQhq0KuP7223BKBcL2VvUJAL0ELW49CU)

**SciPhi / R2R** (status: active open source)
- MIT license, ~8,000 GitHub stars; multimodal ingestion (PDF, text, JSON, images, audio), hybrid search, automatic knowledge graph extraction, agentic RAG with REST API, auth/access management; no deprecation notice — [GitHub R2R](https://github.com/SciPhi-AI/R2R)
- Managed cloud free tier reportedly 300 RAG requests/mo (FLAG: "verify liveness") — [forage.ai](https://forage.ai/blog/rag-as-a-service-platforms/). SciPhi launched Mar 2025 — [Fondo](https://www.fondo.com/blog/sciphi-launches)
- Complaints: documentation/maturity issues in GitHub issues; small company — [forage.ai](https://forage.ai/blog/rag-as-a-service-platforms/)

**CustomGPT.ai** (status: active; no-code business chatbot RAG)
- Pricing: Standard $99/mo ($89 annual): 10 agents, 1,000 queries/mo, 5,000 docs/agent, 60M words; Premium $499/mo ($449 annual): 25 agents, 5,000 queries, 20,000 docs/agent, 300M words; Enterprise custom with auto-sync — [CustomGPT pricing](https://customgpt.ai/pricing/)
- Inputs: 1,400+ document formats, YouTube, audio, podcasts, voice recordings; connectors: WordPress, Wix, YouTube, Zapier, Zendesk, Confluence, Shopify, Google Drive, Notion, HubSpot, Slack; SharePoint on Premium — [CustomGPT pricing](https://customgpt.ai/pricing/)
- BYO-LLM: Azure OpenAI / Claude via Bedrock on Enterprise only; RAG API on Standard+; SOC2 Type 2, GDPR — [CustomGPT pricing](https://customgpt.ai/pricing/)
- Reviews thin/mixed: Capterra 3.3/5 (n=3), Product Hunt 3.6/5 (n=5); complaints on pricing, support, speed/relevance — [forage.ai](https://forage.ai/blog/rag-as-a-service-platforms/)

**Langbase** (status: active; serverless agent platform with "Memory" RAG)
- Pricing: Free (500 credits, 5MB memory, 2 memory files); Individual $100/mo (20K credits, 20MB memory, 20 files); Growth $250/mo (75K credits, 50MB, 50 files); Custom (unlimited RAG memory) — [Langbase pricing](https://langbase.com/pricing)
- Memory agents claim "30-50x less expensive than competitors", agentic routing, reranking (vendor claim) — [Langbase docs](https://langbase.com/docs/memory)
- Note: memory caps (MB) are tiny vs. media-heavy use cases.

**Carbon.ai** (status: SHUT DOWN) — acquired by Perplexity Dec 2024; managed API ceased Mar 31, 2025; connectors (Google Docs, Notion, HubSpot, Slack) folded into Perplexity — [TechCrunch](https://techcrunch.com/2024/12/18/perplexity-acquires-carbon-to-connect-ai-search-to-your-work-files/); [HN](https://news.ycombinator.com/item?id=42452009). Ragie ran a Carbon migration page — [Ragie for Carbon customers](https://www.ragie.ai/carbon)

**Vespa Cloud** (status: active; infrastructure, not turnkey)
- Resource pricing per hour — Basic: vCPU $0.10, memory $0.01/GB, disk $0.0004, GPU memory $0.07; Commercial: $0.145/$0.0145/$0.0005/$0.10; Enterprise: $0.18/$0.018/$0.0007/$0.125; $300 free credits; volume discount up to 50%; enclave (BYOC) min $10K/mo — [Vespa price calculator](https://cloud.vespa.ai/price-calculator) (via search summary)
- RAG Blueprint: hybrid vector + BM25, advanced ranking (BERT, LightGBM, custom) — [Vespa blog](https://blog.vespa.ai/build-a-high-quality-rag-app-on-vespa-cloud-in-15-minutes/)

**Cohere North / Compass** (status: active; enterprise)
- North 2 launched Oct 5, 2026: agent memory across sessions, budget controls (quotas, rate limits, spend caps), orchestration harness with human oversight, reusable skills, RBAC; cloud, on-prem, air-gapped; custom pricing — [VentureBeat](https://venturebeat.com/orchestration/coheres-north-2-puts-ai-agents-on-a-budget-and-gives-them-a-memory)
- North on-prem with Dell (May 2025) — [search summary](https://www.eesel.ai/blog/cohere-north-2); North reportedly uses no seats, shared credit pool (secondary) — [eesel.ai](https://www.eesel.ai/blog/cohere-north-2)
- Compass pricing not published; third-party estimates ($100-500/mo SaaS; $50K-150K+/yr VPC) are low-confidence (FLAG) — [lystr.tech](https://www.lystr.tech/platform/cohere-compass/)
- Funding: $500M at $6.8B (Aug 2025), extended to $7B (Sept 2025); Schwarz Group €500M Series E lead (Apr 2026); reported talks for $2-3B at $20B (Sept 2026); ~$240M ARR Feb 2026 — [PYMNTS](https://www.pymnts.com/startups/2026/ai-startup-cohere-targets-20-billion-dollar-valuation-funding-round/); [Sacra](https://sacra.com/c/cohere/)
- North is a full workspace, not an embeddable API (watch-out) — [forage.ai](https://forage.ai/blog/rag-as-a-service-platforms/)

#### Additional players found (not in original list)

- **LlamaCloud / LlamaParse (LlamaIndex)**: credits $1.25/1,000 (raised from $1 in 2026); free 10,000 credits/mo (~1,000 pages); Starter 40K credits, Pro 400K credits; parse tiers Fast 1 credit/page, Cost-effective 3, Agentic 10, Agentic Plus 45 — [LlamaParse pricing docs](https://developers.llamaindex.ai/llamaparse/general/pricing/); [LlamaIndex pricing](https://www.llamaindex.ai/pricing). Watch-out: 45x per-page variance makes forecasting hard; app layer still yours; self-host Enterprise-gated — [forage.ai](https://forage.ai/blog/rag-as-a-service-platforms/)
- **WRITER Knowledge Graph** (graph-based RAG): hosting $0.085/GB/day; data extraction $0.00015/page; OCR parsing $0.055/page; web access $0.12/page; connectors Enterprise only — [Writer AI Studio pricing](https://dev.writer.com/home/pricing); [Writer KG](https://writer.com/product/knowledge-graph/)
- **Cognee** (open-source graph memory): $7.5M seed Feb 2026 (Pebblebed); Free 1M tokens; Standard $1.00/1M tokens processed + $5/mo per extra workspace, retrieval unmetered; Enterprise BYOC; self-host free — [Cognee pricing page](https://www.cognee.ai/cheapest-ai-memory-platforms-pricing); [review summary](https://www.stackaitools.com/tool/cognee)
- **Supermemory** (memory API + knowledge graph; connectors Drive/Notion/Slack/email): $2.6M seed Oct 2025 (Susa, Browder, SF1; Jeff Dean); Free / Pro $19 / Max $100 / Scale $399 / Enterprise; storage $5-10/M tokens, search $5/M queries — [Supermemory pricing](https://supermemory.ai/pricing/); [Contextely review](https://www.contextely.com/blog/supermemory-review-2026)
- **Glean** (enterprise search/assistant, adjacent): per-seat, enterprise-quoted, 100+ permission-aware connectors; $150M Series F at $7.2B (June 2025); $300M ARR by May 2026; G2 4.7 (n=140) — [forage.ai](https://forage.ai/blog/rag-as-a-service-platforms/)
- **Elastic ESRE, Databricks Mosaic AI**: retrieval/infra building blocks, not turnkey — [forage.ai](https://forage.ai/blog/rag-as-a-service-platforms/)
- **Mendable** (shut down 2025, ~$250K ARR) and **Subtl.ai** (Indian RAG doc-chat, shut down July 3, 2025) — [forage.ai](https://forage.ai/blog/rag-as-a-service-platforms/); [tooldirectory.ai](https://tooldirectory.ai/tools/subtl-ai)

#### Hyperscaler / model-provider offerings

**AWS Bedrock Knowledge Bases**
- Multimodal KB: native video and audio on top of text and images; metadata incl. modality, MIME type, chunk start/end time for AV — [AWS ML blog](https://aws.amazon.com/blogs/machine-learning/introducing-multimodal-retrieval-for-amazon-bedrock-knowledge-bases/); [AWS docs](https://docs.aws.amazon.com/bedrock/latest/userguide/kb-multimodal.html)
- GraphRAG with Neptune Analytics GA; auto-builds graph (Claude 3 Haiku); S3-only source, 1,000 files/data source default — [AWS](https://aws.amazon.com/bedrock/knowledge-bases/); [hidekazu-konishi.com](https://hidekazu-konishi.com/entry/graphrag_architecture_on_aws_neptune_bedrock.html)
- Pricing examples on pricing page: standard retrieval $1.00/1,000 API calls; agentic retrieval $4.00/1,000 + $1.00/1,000 underlying Retrieve calls; index storage $5.00/GB raw/month; Cohere Rerank 3.5 $2.00/1,000 queries — [AWS Bedrock pricing](https://aws.amazon.com/bedrock/pricing/) (FLAG: could not confirm which vector-store mode the $5/GB applies to)
- Bedrock Data Automation (parsing): $0.010/page standard docs ($0.040 custom ≤30 fields), audio $0.006/min, video $0.050/min — [BigData Boutique](https://bigdataboutique.com/blog/aws-bedrock-pricing-guide) (secondary; primary page didn't render numbers)
- Complaints: customization ceiling on chunking/retrieval, cost spread across many line items, "black box" — [forage.ai](https://forage.ai/blog/rag-as-a-service-platforms/)

**Google Vertex AI RAG Engine (now under "Gemini Enterprise Agent Platform") / Vertex AI Search ("Agent Search")**
- RAG Engine: sources local files, GCS, Google Drive (plus Slack/Jira/SharePoint mentioned); parsing via Document AI Layout Parser or LLM Parser; vector DB choice: RagManagedDb, Pinecone, Weaviate, Vector Search 1.0/2.0, Feature Store; reranking, hybrid; BYO embedding + generative models; Spanner mode and Serverless mode; 22+ regions — [Google docs](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/rag-engine/rag-overview)
- RAG Engine pricing: orchestration free; pay for embeddings (e.g., ~$0.075/M tokens), LLM parsing/generation, Ranking API, and Spanner (RagManagedDb Basic ~100 PUs, ~$200-250/mo — secondary estimate) or serverless Vector Search storage — [Google billing doc](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/rag-engine/rag-engine-billing); [Finout](https://www.finout.io/blog/top-16-vertex-services-in-2026)
- Vertex AI Search: $1.50/1,000 queries Standard, $4.00/1,000 Enterprise (incl. generative answers); index storage $5/GiB/mo after 10 GiB free — [Google AI Applications pricing](https://cloud.google.com/generative-ai-app-builder/pricing) (via search summary)
- Complaints: pricing complexity, steep IAM/quota learning curve, product name "in motion" — [forage.ai](https://forage.ai/blog/rag-as-a-service-platforms/)

**Gemini API File Search** (public preview launched Nov 6, 2025)
- Fully managed: storage, chunking, embeddings, context injection; indexing charged at embedding price $0.15/M tokens; storage free; query-time embeddings free; retrieved tokens billed as context — [Gemini docs](https://ai.google.dev/gemini-api/docs/file-search); [Google blog](https://blog.google/innovation-and-ai/technology/developers-tools/file-search-gemini-api/)
- Limits: 100MB/file; project storage Free 1GB, Tier1 10GB, Tier2 100GB, Tier3 1TB; recommend stores <20GB; configurable maxTokensPerChunk / maxOverlapTokens (whitespace chunking); key-value metadata with AIP-160 filters; citations incl. page numbers and media IDs for referenced images — [Gemini docs](https://ai.google.dev/gemini-api/docs/file-search)

**Azure AI Search / Foundry IQ (agentic retrieval)**
- Foundry IQ: knowledge bases connected to multiple knowledge sources; agentic retrieval engine with optional Azure OpenAI LLM for query planning; billed under Azure AI Search — [Microsoft Learn](https://learn.microsoft.com/en-us/azure/foundry/agents/concepts/what-is-foundry-iq); [Foundry blog](https://devblogs.microsoft.com/foundry/build-smarter-agents-faster-with-foundry-iq/)
- Tiers: Free (50MB, 3 indexes), Basic (15GB), S1 (160GB), S2 (512GB), S3 (1TB), L1 (2TB), L2 (4TB); Serverless Developer tier in preview (scale-to-zero, 1GB/index, 30 indexes) — [Azure pricing](https://azure.microsoft.com/en-us/pricing/details/search/) (dollar amounts did not render)
- Agentic retrieval: first 50M tokens/month free, then $0.022/M tokens (secondary); semantic ranker first 1k requests free/mo — [Azure pricing](https://azure.microsoft.com/en-us/pricing/details/search/); [Microsoft Learn](https://learn.microsoft.com/en-us/azure/search/agentic-retrieval-overview)
- Complaints: assembling multiple Azure products; first paid tier ~14x comparable SQL tier; 16MB file cap; steep free→paid jump — [forage.ai](https://forage.ai/blog/rag-as-a-service-platforms/)

**OpenAI File Search / Vector Stores**
- Storage $0.10/GB/day (1GB free); file search tool calls $2.50/1k calls (Responses API); tokens at model rates — [OpenAI pricing](https://developers.openai.com/api/docs/pricing)
- Supports PDF, Office, code, text/markdown/JSON/HTML; max_num_results; attribute (metadata) filtering — [OpenAI file search guide](https://developers.openai.com/api/docs/guides/tools-file-search)

**Anthropic / Claude Projects**
- Projects: 30MB/file, unlimited file count within context; auto "RAG mode" when knowledge nears context limit expands capacity up to ~10x — [MemoryLake](https://www.memorylake.ai/en/blogs/claude-project-rag-mode); [fast.io](https://fast.io/resources/claude-project-knowledge-limit/) (secondary sources)
- Files API: 500MB/file, 100GB/org — [fast.io](https://fast.io/resources/claude-file-upload-limit/) (secondary). No first-party hosted vector-store/retrieval API comparable to OpenAI/Gemini File Search was found.

### Inferences
- Graph + multimodal (audio/video) + BYO-LLM in one self-serve product is rare: among survivors only Progress Agentic RAG (enterprise-priced), Bedrock KB (AWS-only, S3-only graph), Morphik and R2R (small/open source) cover most of it.
- Hyperscaler bundles now cover upload → managed chunking → retrieval cheaply (Gemini File Search: free storage, $0.15/M token indexing), which squeezes any pure "upload docs and chat" product.

### Gaps
- Could not confirm whether Ragie's API remains open to new customers post-Ticketmaster, or a sunset date.
- Exact Azure AI Search tier dollar prices and semantic-ranker per-1k price (page rendered placeholders).
- OpenAI chunking config defaults/limits and max files per vector store (doc excerpt lacked them).
- Contextual AI current product roadmap after the DeepMind deal; no primary statement found.
- Vectara exact total funding (conflict $53.5M vs $73.5M).
- Cohere Compass public pricing does not exist; estimates are low confidence.
- Langbase supported file types and BYO-key specifics not on pricing page.

---

## Q2. Which products are closest to the Grey concept (upload → configurable ingestion → KB + knowledge graph → hosted Q&A or BYO-LLM API)?

### Takeaway
Closest matches: Progress Agentic RAG (Nuclia), Graphlit (now dead), Morphik, R2R, and AWS Bedrock KB (multimodal + GraphRAG). Ragie was closest on multimodal/self-serve but had no explicit graph and has been acquired. No surviving self-serve product clearly combines AV ingestion + user-configurable KG extraction + hosted Q&A + BYO-LLM API at SMB prices.

### Cited Findings
- Progress Agentic RAG: audio/video/images/docs ingestion; custom entity/relation KG; BYO LLM; retrieval agents over KBs, SQL, web, MCP; $700-$1,925/mo — [Progress](https://www.progress.com/agentic-rag); [Progress custom graph docs](https://docs.rag.progress.cloud/docs/ingestion/how-to/custom-graph/); [Progress pricing](https://www.progress.com/agentic-rag/pricing)
- Graphlit: KG with entities/relationships/graph queries, audio/video transcription, MCP, 25+ model providers — but winding down 2026 — [Graphlit pricing](https://www.graphlit.com/pricing); [forage.ai](https://forage.ai/blog/rag-as-a-service-platforms/)
- Morphik: multimodal ingestion & queries, knowledge graphs, open source, SOC2/HIPAA on Enterprise, $59-$799/mo — [Morphik pricing](https://dev.morphik.ai/pricing)
- R2R: multimodal (incl. audio), hybrid search, automatic KG extraction, REST API, MIT — [GitHub](https://github.com/SciPhi-AI/R2R)
- Bedrock KB: text/image/audio/video + GraphRAG via Neptune Analytics, any Bedrock model — [AWS blog](https://aws.amazon.com/blogs/machine-learning/introducing-multimodal-retrieval-for-amazon-bedrock-knowledge-bases/); [AWS KB](https://aws.amazon.com/bedrock/knowledge-bases/)
- Ragie: images/audio/video, hybrid+rerank+entity extraction, MCP, connectors, Fast/Hi-res modes; acquired July 2026 — [Ragie](https://www.ragie.ai/); [Ragie pricing](https://www.ragie.ai/pricing)
- Pinecone Assistant: hosted chat + context API for own LLM + MCP; multimodal ingestion units priced 2x — [Pinecone docs](https://docs.pinecone.io/guides/assistant/overview); [Pinecone pricing](https://www.pinecone.io/pricing/)
- WRITER Knowledge Graph and Cognee offer graph-based RAG/memory but are, respectively, tied to the Writer platform and developer memory-layer oriented — [Writer](https://writer.com/product/knowledge-graph/); [Cognee](https://www.cognee.ai/cheapest-ai-memory-platforms-pricing)

### Inferences
- The "hosted Q&A OR export as RAG API for your own LLM" dual mode is covered by Pinecone Assistant (chat vs context API), Vectara (BYO model), Progress, and Ragie (retrieval API + Base Chat-like apps). Grey's differentiation must come from the visible, configurable ingestion UI + KG exploration for non-enterprise buyers, which none of the cheap options emphasize.
- Ingestion settings exposed to users across the market are thin: Ragie (fast/hi-res), LlamaParse (4 parse tiers), Gemini (chunk size/overlap), Vertex (layout vs LLM parser, vector DB choice), Progress (entity/relation schema). A unified settings panel is an open lane.

### Gaps
- No product found that lets end users visually inspect/edit the generated knowledge graph in a self-serve UI at low price (Progress may; not verified).

---

## Q3. How do they price? Concrete numbers

### Takeaway
Four models dominate: per-page ingestion + subscription (Ragie, Morphik, LlamaCloud, Contextual Parse), token/usage metering (Pinecone, Gemini, OpenAI, Cognee, Supermemory), storage/query metering (hyperscalers), and flat enterprise contracts ($100K-$500K/yr Vectara; $700-$1,925/mo Progress; custom Cohere/Contextual). Per-page parse costs range ~$0.001-$0.05/page; audio ~$0.006-0.0067/min; video ~$0.025-0.05/min.

### Cited Findings
- Per page: Ragie $0.02 fast / $0.05 hi-res + $0.002/page/mo storage — [Ragie](https://www.ragie.ai/pricing); Morphik overage $0.03/page — [Morphik](https://dev.morphik.ai/pricing); Contextual Parse $0.003/page text, $0.04/page multimodal — [Contextual](https://contextual.ai/pricing/); LlamaParse $0.00125-$0.056/page (1-45 credits at $1.25/1k) — [LlamaParse](https://developers.llamaindex.ai/llamaparse/general/pricing/); Bedrock Data Automation $0.01/page — [BigData Boutique](https://bigdataboutique.com/blog/aws-bedrock-pricing-guide); Writer OCR $0.055/page — [Writer](https://dev.writer.com/home/pricing)
- Audio/video: Ragie $0.0067/min audio, $0.025/min video — [Ragie](https://www.ragie.ai/pricing); Bedrock BDA $0.006/min audio, $0.05/min video — [BigData Boutique](https://bigdataboutique.com/blog/aws-bedrock-pricing-guide); Graphlit 10 audio-min/credit, 4 video-min/credit at $0.08-0.10/credit (~$0.01/min audio, ~$0.025/min video) — [Graphlit](https://www.graphlit.com/pricing)
- Storage: OpenAI $0.10/GB/day (~$3/GB/mo), 1GB free — [OpenAI](https://developers.openai.com/api/docs/pricing); Pinecone $3/GB/mo — [Pinecone](https://www.pinecone.io/pricing/); Bedrock KB $5/GB raw/mo — [AWS](https://aws.amazon.com/bedrock/pricing/); Vertex AI Search $5/GiB/mo after 10GiB — [Google](https://cloud.google.com/generative-ai-app-builder/pricing); Gemini File Search storage free — [Gemini docs](https://ai.google.dev/gemini-api/docs/file-search); Writer KG $0.085/GB/day — [Writer](https://dev.writer.com/home/pricing)
- Per query: OpenAI $2.50/1k file search calls — [OpenAI](https://developers.openai.com/api/docs/pricing); Bedrock $1/1k standard, $4/1k agentic retrievals; Rerank $2/1k — [AWS](https://aws.amazon.com/bedrock/pricing/); Vertex AI Search $1.50-$4/1k — [Google](https://cloud.google.com/generative-ai-app-builder/pricing); CustomGPT 1,000 queries/mo on $99 plan (~$0.10/query) — [CustomGPT](https://customgpt.ai/pricing/)
- Tokens: Pinecone Assistant $8/M in, $15/M out, $5/M context — [Pinecone](https://www.pinecone.io/pricing/); Gemini indexing $0.15/M — [Google blog](https://blog.google/innovation-and-ai/technology/developers-tools/file-search-gemini-api/); Cognee $1/M processed — [Cognee](https://www.cognee.ai/cheapest-ai-memory-platforms-pricing); Azure agentic retrieval 50M free then $0.022/M (secondary) — [Azure](https://azure.microsoft.com/en-us/pricing/details/search/)
- Subscriptions: Ragie $0/$100/$500; Morphik $0/$59/$799; Graphlit $49/$199/$999 + credits; CustomGPT $99/$499; Langbase $100/$250; Supermemory $19/$100/$399; Progress $700/$1,925; Pinecone minimums $50/$500 — sources above
- Enterprise contracts: Vectara $100K/$250K/$500K per year (SaaS/VPC/on-prem) — [Vectara](https://www.vectara.com/pricing); Glean six-figure first-year commitments commonly reported — [forage.ai](https://forage.ai/blog/rag-as-a-service-platforms/); Vespa enclave $10K/mo min — [Vespa](https://cloud.vespa.ai/price-calculator)
- Connector pricing: Ragie $250/mo per additional connector — [Ragie](https://www.ragie.ai/pricing); Writer connectors Enterprise-only — [Writer](https://dev.writer.com/home/pricing)
- Seats: Needle $69/account (now outbound tool); Cohere North reportedly seatless shared credit pool — [eesel.ai](https://www.eesel.ai/blog/cohere-north-2). Per-seat is mainly the enterprise-search tier (Glean).

### Inferences
- Gemini's free storage + $0.15/M indexing sets a near-zero floor for text RAG; paid differentiation must come from multimodal parsing, graph, connectors, and app/UX.
- Per-page pricing with tiers (fast vs hi-res vs multimodal) is the de facto standard for document ingestion; AV per-minute rates cluster at ~$0.006/min audio and $0.025-0.05/min video.

### Gaps
- Morphik/R2R cloud query pricing beyond plan limits not found.
- Progress Agentic RAG token overage pricing not found.

---

## Q4. Gaps and common complaints

### Takeaway
Recurring complaints: unpredictable/fragmented costs (hyperscalers, LlamaParse variance, Pinecone idle fees), enterprise-only opacity (Vectara, Cohere, Contextual, Glean), black-box/limited ingestion customization (Bedrock), multi-product assembly (Azure), thin review bases and vendor survival risk (startups).

### Cited Findings
- Pinecone Assistant: $0.05/hr per assistant billed even when idle; Assistant + DB share one org plan (June 2025) — [Pinecone Community](https://community.pinecone.io/t/why-is-pinecone-assistant-so-expensive-any-tips-to-reduce-the-cost/8111); "pricing climbs fast on Standard/Enterprise" — [forage.ai](https://forage.ai/blog/rag-as-a-service-platforms/)
- Vectara: $100K/yr entry eliminates prototyping devs; almost no independent reviews — [forage.ai](https://forage.ai/blog/rag-as-a-service-platforms/)
- Bedrock KB: customization ceiling on chunking/retrieval; costs spread across line items; "black box"; GraphRAG S3-only and 1,000 files/source default — [forage.ai](https://forage.ai/blog/rag-as-a-service-platforms/); [hidekazu-konishi.com](https://hidekazu-konishi.com/entry/graphrag_architecture_on_aws_neptune_bedrock.html)
- Azure: three products to assemble; first paid tier ~14x SQL tier; 16MB file cap — [forage.ai](https://forage.ai/blog/rag-as-a-service-platforms/)
- Vertex: pricing complexity, IAM/quota learning curve, renaming churn — [forage.ai](https://forage.ai/blog/rag-as-a-service-platforms/)
- LlamaCloud: 45x per-page variance; credit price rose 25% in 2026 — [forage.ai](https://forage.ai/blog/rag-as-a-service-platforms/); [search summary of LlamaParse pricing](https://developers.llamaindex.ai/llamaparse/general/pricing/)
- Ragie: page metering means costs scale with volume; overage math needs modeling — [forage.ai](https://forage.ai/blog/rag-as-a-service-platforms/)
- CustomGPT: pricing, support inflexibility, speed/relevance complaints (tiny n) — [forage.ai](https://forage.ai/blog/rag-as-a-service-platforms/)
- R2R: documentation/maturity issues; self-host ops burden — [forage.ai](https://forage.ai/blog/rag-as-a-service-platforms/)
- Progress: "three names in roughly a year", no reviews under new name — [forage.ai](https://forage.ai/blog/rag-as-a-service-platforms/); Starter tier text-only — [Progress pricing](https://www.progress.com/agentic-rag/pricing)
- Langbase memory capped at 5-50MB on self-serve tiers — [Langbase pricing](https://langbase.com/pricing)
- Category critique: "RAG-as-a-product is dying" — base layer commoditized (pgvector, cloud providers), hard problems (curation, chunking, eval, ACLs) are org-specific, "chat with your docs" novelty gone; claims of diverging renewal rates and shrinking renewal contract sizes (no named data source) — [Sam on AI, July 7, 2026](https://samonai.substack.com/p/rag-as-a-product-is-dying)

### Inferences
- Opportunities for Grey: predictable all-in pricing (bundling ingestion+storage+queries), transparent and editable ingestion settings, first-class AV + graph at SMB price, and a credible data-portability/export story (given vendor failures, buyers will ask "what happens if you shut down?").
- Risk: the category critique suggests standalone RAG products need workflow embedding (agents, MCP, integrations) to retain customers.

### Gaps
- Little direct Reddit/HN complaint data was retrieved for 2026 specifically; most complaint synthesis relies on one aggregator (forage.ai, which itself is a vendor in an adjacent space — "by a company that isn't one of them").

---

## Q5. Shutdowns, pivots, acquisitions (consolidation signals)

### Takeaway
Heavy consolidation 2024-2026: at least 4 shutdowns, 3 acquisitions/acqui-hires, 1 pivot, and 1 upmarket repricing among the named competitors. The pattern: small RAG-API startups get absorbed by companies wanting the team/tech for internal use (Perplexity, Ticketmaster, Google DeepMind, Progress) or die; hyperscalers absorb the feature.

### Cited Findings
- Carbon.ai → acquired by Perplexity (Dec 2024); API shut Mar 31, 2025 — [TechCrunch](https://techcrunch.com/2024/12/18/perplexity-acquires-carbon-to-connect-ai-search-to-your-work-files/)
- Nuclia → acquired by Progress Software (June 30, 2025); relaunched as Progress Agentic RAG (Sept 10, 2025) — [Progress IR](https://investors.progress.com/news-releases/news-release-details/progress-software-acquires-nuclia-innovator-agentic-rag-ai); [forage.ai](https://forage.ai/blog/rag-as-a-service-platforms/)
- Mendable → shut down 2025 (~$250K ARR) — [forage.ai](https://forage.ai/blog/rag-as-a-service-platforms/)
- Subtl.ai → shut down July 3, 2025 after failing to raise — [tooldirectory.ai](https://tooldirectory.ai/tools/subtl-ai)
- Contextual AI → Google DeepMind licensing + acqui-hire of CEO and 20+ researchers, ~$80-100M (May 2026) — [Bloomberg](https://www.bloomberg.com/news/articles/2026-05-19/google-hires-staff-from-bezos-backed-contextual-ai-in-licensing-deal); [WinBuzzer](https://winbuzzer.com/2026/05/20/deepmind-contextual-ai-deal-follows-hume-licensing-playbook-xcxwbn/)
- Vectara → repriced July 2026 to $100K+/yr, removed free/growth tiers — [forage.ai](https://forage.ai/blog/rag-as-a-service-platforms/); [Vectara pricing](https://www.vectara.com/pricing)
- Graphlit → winding down 2026; free-account export closes Aug 1, 2026; assets for sale — [forage.ai](https://forage.ai/blog/rag-as-a-service-platforms/); [Kirk Marple LinkedIn](https://www.linkedin.com/in/kirkmarple/)
- Ragie → "joins Ticketmaster" (July 27, 2026) — [Ragie blog](https://www.ragie.ai/blog/ragie-joins-ticketmaster)
- Needle → pivoted from RAG/AI search to agent-native outbound sales engine — [Needle](https://needle.app/)
- Pinecone → CEO change Sept 2025; sale exploration reported (no deal) — [Pinecone](https://www.pinecone.io/newsroom/next-chapter/); [forage.ai](https://forage.ai/blog/rag-as-a-service-platforms/)
- Counter-signals (capital still flowing to adjacent "memory/graph" layer): Cognee $7.5M seed (Feb 2026), Supermemory $2.6M seed (Oct 2025), Cohere Series E/$20B talks — [Cognee summary](https://www.stackaitools.com/tool/cognee); [Supermemory](https://app.dealroom.co/companies/supermemory); [PYMNTS](https://www.pymnts.com/startups/2026/ai-startup-cohere-targets-20-billion-dollar-valuation-funding-round/)

### Inferences
- Investor/buyer interest is moving from "RAG API" to "agent memory/context layer" and graph-based memory; Grey's KG angle aligns with where seed money is going, but its hosted-Q&A angle overlaps the commoditized layer.
- The three most Grey-like startups (Ragie, Graphlit, Carbon) all exited within ~20 months — strong signal that a standalone RAG API business is hard; positioning Grey as an end-user SaaS (UI, ingestion settings, graph exploration) rather than pure infra may be more defensible.

### Gaps
- Ragie deal terms and API continuity unknown.
- Whether Contextual AI's product remains sold to new customers (Agent Composer, on-demand APIs) after May 2026 — pricing page still live but no primary post-deal statement found.
- No confirmed Pinecone sale outcome.
