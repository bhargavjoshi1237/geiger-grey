# Knowledge-Graph Construction from Unstructured Content & GraphRAG (as of Oct 2026)

Context for the reader: Geiger Grey = per-project vector RAG + auto-built knowledge graph (entities + relationships), shown in a react-force-graph 2D/3D explorer, used to improve retrieval, and fed by other suite apps (e.g. Forms) as a lightweight relationship/CRM graph. Stack is Supabase/Postgres.

Dating note: several key data points are 2023-2025 (Diffbot benchmark Nov 2023; Microsoft LazyGraphRAG Nov 2024; Bedrock GraphRAG GA Mar 2025; HippoRAG 2 / Zep papers early 2025). Newer 2026 items are mostly secondary write-ups; flagged where relevant.

## 1. Techniques: how KG-from-documents and GraphRAG are done today

### Takeaway
The common pipeline is chunk -> LLM extracts entities/relations (schema-guided or schema-free) -> entity resolution/dedup -> store in graph + vectors -> retrieval that mixes vector seeds with graph expansion. The design space splits into (a) "heavy" Microsoft-style GraphRAG with community summaries (great for global questions, very expensive), (b) "light" variants (LightRAG, HippoRAG 2, LazyGraphRAG, nano/fast-graphrag) that cut indexing cost 7-1000x, and (c) incremental/temporal graphs (Graphiti/Zep, Cognee) built for continuously changing data, which fits Geiger Grey's "other apps push entities in" requirement best.

### Cited Findings
**Microsoft GraphRAG family**
- GraphRAG supports entity-level retrieval (local neighbourhoods of topic nodes) and corpus-level retrieval via community detection + LLM summarisation of each community, enabling "global sensemaking" over large corpora — [When to use Graphs in RAG (arXiv 2506.05690)](https://arxiv.org/pdf/2506.05690)
- Microsoft's original study: GraphRAG won 72-83% of comprehensiveness comparisons and 62-82% on diversity vs vector RAG on global questions, using "up to 97% fewer tokens" than summarising source text directly (root-level community summaries) — [VentureBeat, Aug 2 2026](https://venturebeat.com/orchestration/stop-graphing-everything-when-graphrag-actually-beats-vector-rag)
- DRIFT search (released late 2024) combines local and global search; claimed 40-60% cost reduction on complex queries (secondary source, not verified against Microsoft primary) — [paperclipped.de / search summary](https://www.paperclipped.de/en/blog/graph-rag-production/)
- LazyGraphRAG (Microsoft Research, Nov 25 2024): indexing cost identical to vector RAG and "0.1% of the costs of full GraphRAG"; for global queries, comparable quality to GraphRAG Global Search at ">700 times lower query cost"; at 4% of GraphRAG global query cost it beat all competing conditions on both local and global queries. As of a June 6 2025 editor's note it ships in Microsoft Discovery, Azure Local (public preview) and the open-source GraphRAG repo — [Microsoft Research blog](https://www.microsoft.com/en-us/research/blog/lazygraphrag-setting-a-new-standard-for-quality-and-cost/)
- LazyGraphRAG builds a concept graph lazily (deferring LLM summarisation to query time) — [arXiv 2503.02922](https://arxiv.org/pdf/2503.02922)

**LightRAG**
- Dual-level retrieval: low-level entity retrieval + high-level "theme" retrieval, combining graph structure with vector representations — [arXiv 2506.05690 / search summary](https://arxiv.org/pdf/2506.05690)
- LightRAG Server/WebUI now supports create/edit/delete of entities and relations, a properties sidebar for inline editing, and an API to merge multiple entities into one with custom per-field merge strategies, automatically re-pointing relationships; visualisation uses Sigma.js/Graphology (WebGL) with gravity layouts, node search and subgraph filtering — [DeepWiki: LightRAG Web UI](https://deepwiki.com/HKUDS/LightRAG/7-web-ui-(lightrag_webui)); [LightRAG fork README](https://github.com/lbucess-rage/LightRAG)
- Neo4j wrote a teardown of LightRAG's extraction prompts — [Neo4j blog: Under the covers with LightRAG](https://neo4j.com/blog/developer/under-the-covers-with-lightrag-extraction/)

**HippoRAG 2 (OSU, Feb 2025)**
- Personalised PageRank over an extracted KG, with deeper passage integration (passages as nodes) and online LLM filtering — [arXiv 2502.14802](https://arxiv.org/html/2502.14802v1); [GitHub](https://github.com/osu-nlp-group/hipporag)
- Results: 59.8 avg F1 vs 57.0 for NV-Embed-v2 dense retrieval (+9.5 on 2Wiki); indexing used 9.2M input tokens on MuSiQue vs LightRAG 68.5M and GraphRAG 115.5M (~7-12x cheaper); authors report RAPTOR, GraphRAG and LightRAG underperform plain dense retrieval on simple factual QA, with GraphRAG/LightRAG degrading severely on some simple QA sets — [arXiv 2502.14802](https://arxiv.org/html/2502.14802v1)

**Graphiti / Zep (temporal, incremental)**
- Graphiti (open source) is the engine behind Zep; it incrementally ingests "episodes", extracts entities/facts, runs an entity-resolution phase that matches new entities to existing nodes and merges duplicates, and invalidates (not deletes) edges when facts stop holding. Graph has episode, entity and community subgraphs — [Zep paper arXiv 2501.13956](https://arxiv.org/pdf/2501.13956.pdf)
- Every fact edge is bi-temporal: valid time (valid_at/invalid_at) and transaction time (created_at/expired_at) — [AviAvni reading notes](https://github.com/AviAvni/database-learning-path/blob/master/topics/38-graphrag-agent-memory/reading-zep-graphiti.md); [Zep blog](https://blog.getzep.com/beyond-static-knowledge-graphs/)
- Zep: DMR 94.8% vs MemGPT 93.4%; on LongMemEval up to 18.5% accuracy improvement with 90% lower response latency vs baselines (Jan 2025) — [arXiv abs 2501.13956](https://arxiv.org/abs/2501.13956)
- Graphiti explicitly synthesises unstructured conversational data and structured business data in one graph — [Zep paper](https://blog.getzep.com/content/files/2025/01/ZEP__USING_KNOWLEDGE_GRAPHS_TO_POWER_LLM_AGENT_MEMORY_2025011700.pdf)

**Cognee**
- Open-source "AI memory" engine; ECL (Extract-Cognify-Load) pipeline: classify docs, check permissions, chunk, LLM-extract entities/relations, summarise, embed to vector store and commit edges to graph; unifies relational, vector and graph storage; "Cognify" does ontology-based entity validation — [Cognee blog](https://www.cognee.ai/blog/fundamentals/how-cognee-builds-ai-memory); [Cognee ontologies](https://www.cognee.ai/blog/deep-dives/grounding-ai-memory); [GitHub](https://github.com/topoteretes/cognee)

**KAG / OpenSPG (Ant Group)**
- Logical-form-guided reasoning + retrieval on the OpenSPG engine; schema-constrained knowledge construction; positioned against OpenIE-noise in GraphRAG and ambiguity of vector similarity; aimed at professional/vertical domains — [GitHub OpenSPG/KAG](https://github.com/openspg/kag); [arXiv 2409.13731](https://arxiv.org/pdf/2409.13731)

**Neo4j tooling**
- Neo4j GraphRAG Python package offers a pipeline for document processing, schema-based entity extraction, entity resolution and storage; entities are de-duplicated with entity resolution, entity linking and vector similarity — [Neo4j developer guide](https://neo4j.com/developer/genai-ecosystem/importing-graph-from-unstructured-data/)
- LLM Knowledge Graph Builder (Neo4j Labs): see Products/UX sections — [Neo4j Labs](https://neo4j.com/labs/genai-ecosystem/llm-graph-builder/)

**LlamaIndex PropertyGraphIndex**
- Labeled-property-graph index with modular extractors and retrievers; SchemaLLMPathExtractor restricts the LLM to allowed entity types, relation types and valid (head, relation, tail) triples (schema-guided); other extractors are schema-free (SimpleLLMPathExtractor, DynamicLLMPathExtractor) — [LlamaIndex blog](https://www.llamaindex.ai/blog/introducing-the-property-graph-index-a-powerful-new-way-to-build-knowledge-graphs-with-llms); [Comparing LLM Path Extractors](https://developers.llamaindex.ai/python/examples/property_graph/dynamic_kg_extraction/); [Predefined schemas](https://developers.llamaindex.ai/python/examples/property_graph/property_graph_advanced/)

**Entity resolution / dedup approaches**
- Practical stack: deterministic cleaning -> merge across chunks -> cheap non-model dedup -> embedding-based resolution subsystem — [Ontology-guided, dedup-aware extraction layer (alphaxiv 2607.28662)](https://www.alphaxiv.org/abs/2607.28662)
- Techniques in literature: embedding clustering (BERT/DBSCAN/correlation clustering), majority-name voting for canonical name, iterative LLM-guided clustering to merge equivalent entities — [LLM-empowered KG construction survey arXiv 2510.20345](https://arxiv.org/pdf/2510.20345); [The Rise of Semantic Entity Resolution (TDS)](https://towardsdatascience.com/the-rise-of-semantic-entity-resolution/)
- Postgres-native ER: pg_trgm trigram fuzzy match + vector similarity for semantic disambiguation — [pg-raggraph](https://github.com/yonk-labs/pg-raggraph)
- KG denoising (removing low-value nodes/edges) can improve RAG — [Less is More: Denoising KGs for RAG, arXiv 2510.14271](https://arxiv.org/pdf/2510.14271)

**Schema-guided vs schema-free**
- Neo4j LLM Graph Builder lets users pick a predefined schema, type custom node labels/relationship types, pull schema from an existing DB, or supply a text/RDF ontology — [Neo4j Labs features](https://neo4j.com/labs/genai-ecosystem/llm-graph-builder-features/)
- KAG and Cognee lean on schema/ontology constraints; KAG explicitly frames schema-free OpenIE as noisy — [KAG GitHub](https://github.com/openspg/kag); [Cognee ontologies](https://www.cognee.ai/blog/deep-dives/grounding-ai-memory)

### Inferences
- For Geiger Grey, a hybrid is most fitting: a small default ontology per project (Person, Organization, Product, Location, Event, Concept, Document) with a schema-free "Other" escape hatch, editable per project. This matches what Neo4j Builder and LlamaIndex expose, and gives Forms-pushed entities stable types to land on.
- Graphiti's model (incremental episodes, entity resolution on insert, bi-temporal edges, invalidation not deletion) maps closely to a CRM-like graph that other apps write into. Full Microsoft GraphRAG (batch re-index + community summaries) maps poorly to that.
- LazyGraphRAG/HippoRAG-style "cheap index, smart query" is the cost-safe default; community summaries can be an optional, per-project "deep index" upgrade.

### Gaps
- nano-graphrag and fast-graphrag: no primary sources fetched. They are lightweight GraphRAG reimplementations, but this was not verified here.
- DRIFT's 40-60% cost reduction comes only from a secondary source. No Microsoft primary was fetched.
- No independent benchmark of Cognee or KAG quality was found.

## 2. Products and platforms offering KG / GraphRAG

### Takeaway
Graph DB vendors (Neo4j, FalkorDB, Memgraph, Neptune, Spanner Graph) sell GraphRAG as SDKs or reference architectures on their databases. Few end-user products give a turnkey "upload docs, see graph" experience. The closest are Neo4j LLM Graph Builder (a Labs/open-source tool), the LightRAG WebUI (open source), Bedrock Knowledge Bases GraphRAG (managed, but no rich graph UI) and Graphlit (API). Enterprise players (Glean, Writer) use graphs internally and mostly don't expose them as an editable graph. That leaves an opening for Geiger Grey's visual, editable, per-project graph.

### Cited Findings
- **Neo4j LLM Knowledge Graph Builder**: ingests PDF, DOCX, PPTX, XLS, images, HTML, TXT, MD, YouTube transcripts, Wikipedia, web pages, S3 and GCS. Supports multiple LLMs (OpenAI, Gemini, Llama 3, Diffbot, Claude, Qwen). Offers schema selection, lexical/entity/full graph views and Bloom integration for editing. Chat modes are vector+fulltext hybrid or GraphRAG (vectors + entity traversal up to 2 hops), with retrieval details showing sources and token usage — [Neo4j Labs features](https://neo4j.com/labs/genai-ecosystem/llm-graph-builder-features/); [Neo4j Labs overview](https://neo4j.com/labs/genai-ecosystem/llm-graph-builder/)
  - Also post-processing: node de-duplication, orphan-node removal, schema adjustments, and Ragas metrics for answer evaluation — [Neo4j developer guide](https://neo4j.com/developer/genai-ecosystem/importing-graph-from-unstructured-data/); [Neo4j blog](https://neo4j.com/blog/developer/graphrag-llm-knowledge-graph-builder/)
  - Front-end architecture write-up — [Neo4j blog](https://neo4j.com/blog/developer/frontend-architecture-and-integration/)
- **Neo4j AuraDB pricing** (secondary source, unverified against Neo4j's page): Professional $0.09/GB-hour (~$66/month per GB); Business Critical $0.20/GB-hour (~$292/month) — [beri.net 2026](https://www.beri.net/article/graphrag-vs-vector-rag-indexing-query-cost-lightrag-lazygraphrag-2026)
- **AWS Bedrock Knowledge Bases + Neptune Analytics GraphRAG**: GA March 2025. It automatically extracts entities, facts and relationships from S3 documents, stores embeddings and the graph in Neptune Analytics, and combines vector search with graph traversal. GraphRAG has no extra charge; you pay for Neptune Analytics (example ~ $0.48/hour, secondary source) — [AWS What's New, Mar 2025](https://aws.amazon.com/about-aws/whats-new/2025/03/amazon-bedrock-knowledge-bases-graphrag-generally-available/); [Bedrock docs](https://docs.aws.amazon.com/bedrock/latest/userguide/knowledge-base-build-graphs.html); [Atlan](https://atlan.com/know/ai-agent/aws/amazon-bedrock-knowledge-bases/)
- **Google Spanner Graph + Vertex AI**: a reference architecture (Cloud Run builds the KG from files with Gemini + LangChain LLMGraphTransformer and stores it in Spanner Graph; GraphRAG retrieval augments prompts). It is a pattern, not a turnkey product — [Google Cloud architecture](https://docs.cloud.google.com/architecture/gen-ai-graphrag-spanner?hl=de); [Google dev forum](https://discuss.google.dev/t/graphrag-reference-architecture-for-genai-with-spanner-graph-vertex-ai-and-cloud-run/193943); [LangChain Spanner notebook](https://colab.research.google.com/github/googleapis/langchain-google-spanner-python/blob/main/docs/graph_rag.ipynb)
- **FalkorDB**: GraphRAG SDK 1.0, modular and LLM-agnostic, builds KGs from documents and answers over them. Integrates with LangChain/LangGraph — [FalkorDB blog](https://www.falkordb.com/blog/graphrag-sdk-knowledge-graph/); [SDK docs](https://falkordb.github.io/GraphRAG-SDK/); [GenAI tools](https://docs.falkordb.com/genai-tools)
- **Memgraph**: integrates with LlamaIndex PropertyGraphIndex for KG construction and single-agent RAG — [LlamaIndex x Memgraph](https://www.llamaindex.ai/blog/constructing-a-knowledge-graph-with-llamaindex-and-memgraph); [Memgraph blog](https://memgraph.com/blog/single-agent-rag-system)
- **WhyHow.ai**: tooling for building and managing many small, specialised KGs queried independently, with rule sets/guardrails controlling what feeds RAG — [Vellum blog](https://www.vellum.ai/blog/graphrag-improving-rag-with-knowledge-graphs)
- **Graphlit**: API platform for ingestion, extraction and enrichment into a KG plus vector store. It emphasises entity-to-content links (provenance) as well as entity-to-entity — [Vellum](https://www.vellum.ai/blog/graphrag-improving-rag-with-knowledge-graphs); [HyperGPT review](https://store.hypergpt.ai/graphlit/review)
- **Writer Knowledge Graph**: graph-based RAG using a specialised LLM to build semantic relationships. Claims top RobustQA scores vs seven vector RAG approaches, multi-hop support, sub-question decomposition with citations, and "67% lower cost" than traditional RAG (vendor claims, not independently verified) — [Writer](https://writer.com/product/graph-based-rag/)
- **Glean Enterprise Graph**: models relationships across content, people, projects, teams, processes and activity for personalised enterprise search/assistant. It is an internal substrate, not a user-editable entity graph — [Glean product](https://www.glean.com/product/knowledge-graph); [Glean docs](https://docs.glean.com/security/knowledge-graph); [Glean Fall '25 launch](https://www.glean.com/blog/live-fall-25-main)
- **Diffbot**: KG-LM accuracy benchmark (Nov 2023, 43 enterprise questions). LLM without KG 16.7% vs with KG 56.2% (3.4x). Vector-only scored 0% on schema-bound Metrics/KPIs and Strategic Planning questions and degraded to 0% beyond 5 entities per query. FalkorDB claims ">90%" with its 2025 SDK (internal, unverified) — [FalkorDB blog](https://www.falkordb.com/blog/graphrag-accuracy-diffbot-falkordb/)
- **Open-source "all-in-one" reference**: flexible-graphrag supports 15 property-graph DBs, 4 RDF stores, 10 vector DBs, KG auto-building, ontologies, hybrid search, chat, React/Vue/Angular UIs and an MCP server — [GitHub](https://github.com/stevereiner/flexible-graphrag)

### Inferences
- Bedrock KB GraphRAG is the closest managed competitor to Geiger Grey's ingest-to-graph flow but has no first-class graph explorer or editing UX. The visual, editable, per-project graph is a differentiator.
- Neo4j LLM Graph Builder is the best UX reference (schema picker, graph views, chat with sources, dedup and orphan cleanup, eval metrics). It is a Labs tool, not a SaaS product.

### Gaps
- Stardog (Voicebox), Kumo and Diffbot's current product/pricing were not researched within budget.
- Memgraph's own GraphRAG features and pricing were not fetched.
- WhyHow.ai's current (2026) status and pricing are unverified. I found only a secondary description.
- Graphlit pricing was not found.
- Aura and Neptune pricing come from secondary sources. Check the vendor pricing pages.

## 3. Storage options for a Supabase/Postgres stack vs dedicated graph DBs

### Takeaway
On Supabase, Apache AGE is not available. The pragmatic path is plain tables (entities, relationships, chunk-mention links) + pgvector + pg_trgm + recursive CTEs. A 2026 open-source project shows this beats AGE on latency and runs on every managed Postgres. A dedicated graph DB is only justified for deep (more than 3-hop) traversals, heavy graph algorithms at scale, or Cypher-native tooling.

### Cited Findings
- Supabase does not officially support Apache AGE. Its Nix-built, sandboxed images don't allow runtime extension compilation. Community workaround: fork supabase-postgres and add AGE as a Nix package (self-host only) — [Supabase discussion #13263](https://github.com/orgs/supabase/discussions/13263); [Supabase discussion #40285](https://github.com/orgs/supabase/discussions/40285); [auxcube/supabase-postgres-age](https://github.com/auxcube/supabase-postgres-age)
- AGE requires `shared_preload_libraries`. Among major managed providers only Azure supports it (not RDS, Supabase, Neon or Cloud SQL) — [pg-raggraph README](https://github.com/yonk-labs/pg-raggraph)
- Azure shows pgvector + AGE combined in one query plan: a CTE using pgvector feeds a `cypher()` call in the same transaction — [Microsoft Tech Community](https://techcommunity.microsoft.com/blog/adforpostgresql/combining-pgvector-and-apache-age---knowledge-graph--semantic-intelligence-in-a-/4508781)
- **pg-raggraph** (Postgres-native GraphRAG):
  - Tables: documents, chunks, entities, relationships, document_versions, facts, fact_edges.
  - Graph expansion uses recursive CTEs inside a single SQL query alongside vector + full-text.
  - Recursive CTEs held sub-millisecond p50 through 3 hops, while AGE variable-length Cypher grew from 33.7 ms to 132.1 ms p50 (p95 670 ms).
  - A documented 17-hour AGE migration failure traced to plans estimating 49B intermediate rows.
  - +19.3% top-chunk retrieval score vs vector+BM25 at ~82-91 ms; +4-5 pp end-to-end accuracy on MuSiQue multi-hop.
  - Entity resolution uses pg_trgm + vector.
  - Supports time-travel `as_of` queries and retraction tracking.
  - Runs on Supabase/RDS/Neon/Cloud SQL (PG16+ with pgvector and pg_trgm).
  - Source: [pg-raggraph GitHub](https://github.com/yonk-labs/pg-raggraph)
- A personal KG built with "just PostgreSQL (no Neo4j)" is a practitioner example of the same pattern — [micelclaw blog](https://micelclaw.com/blog/knowledge-graph-postgresql/)
- Snowflake/others document AGE graph queries in Postgres (AGE supports MATCH, CREATE, MERGE, WITH and aggregations) — [Snowflake engineering blog](https://www.snowflake.com/en/blog/engineering/graph-queries-postgres-apache-age/)

### Inferences
- Suggested Supabase schema:
  - `kg_entities(id, project_id, type, name, canonical_name, aliases[], properties jsonb, embedding vector, source_app, created_at, updated_at, merged_into)`
  - `kg_relations(id, project_id, src_id, dst_id, type, properties jsonb, weight, valid_from, valid_to, created_at, expired_at)`
  - `kg_mentions(entity_id|relation_id, chunk_id, document_id, span, confidence)` for provenance
  - Optional `kg_communities(id, project_id, level, summary, embedding)`
  - RLS by project_id. GIN trigram on names, HNSW on embeddings.
- 1-2 hop neighbourhood expansion (all most GraphRAG retrievers use; Neo4j Builder caps at 2 hops) is trivially fast in Postgres. Community detection (Leiden/Louvain) has to run outside Postgres, e.g. a Python worker with igraph/graspologic, and write results back.
- react-force-graph can be fed straight from these tables. Large graphs should be paginated or filtered server-side (top-N by degree, by type, or ego-network around a selected node).

### Gaps
- I found no independent benchmark of recursive-CTE graphs at large scale (millions of edges, more than 3 hops) on Supabase specifically. pg-raggraph's numbers are self-reported.
- Supabase's 2026 roadmap for any graph extension was not found.

## 4. Evidence: when GraphRAG beats vector RAG, and what it costs

### Takeaway
Graphs clearly help on global/summarisation ("what are the main themes across all docs?") and multi-hop or entity-dense questions. They tie or lose on single-hop fact lookup. Full GraphRAG indexing and global querying cost orders of magnitude more than vector RAG. The consensus 2026 recommendation is hybrid retrieval with query routing, plus cheap graph indexing (LazyGraphRAG/HippoRAG-style) rather than full community summarisation by default.

### Cited Findings
**Quality**
- Microsoft GraphRAG on global questions: 72-83% comprehensiveness win rate, 62-82% diversity — [VentureBeat, Aug 2026](https://venturebeat.com/orchestration/stop-graphing-everything-when-graphrag-actually-beats-vector-rag)
- GraphRAG-Bench (ICLR 2026):
  - Simple fact retrieval: 60.9 chunks vs 60.1 graph (a tie)
  - Complex reasoning: graph 53.4 vs 42.9
  - Contextual summarisation: graph 64.4 vs 51.3
  - Sources: [VentureBeat](https://venturebeat.com/orchestration/stop-graphing-everything-when-graphrag-actually-beats-vector-rag); [arXiv 2506.05690](https://arxiv.org/pdf/2506.05690)
- Michigan State/Meta controlled study (2025): single-hop NQ F1 64.8 RAG vs 63.0 graph; multi-hop 70.3 graph vs 67.0. RAG is best for detail-oriented single-hop questions and graphs for multi-hop/reasoning — [arXiv 2502.11371 "RAG vs GraphRAG: A Systematic Evaluation"](https://arxiv.org/pdf/2502.11371); [VentureBeat](https://venturebeat.com/orchestration/stop-graphing-everything-when-graphrag-actually-beats-vector-rag)
- Graph-guided multi-hop retrieval: Recall@5 73.4% to 87.8%; reported +31 points on MuSiQue and +28 on 2WikiMultiHopQA (aggregated in the article; original papers not individually verified) — [VentureBeat](https://venturebeat.com/orchestration/stop-graphing-everything-when-graphrag-actually-beats-vector-rag)
- Reranked vector RAG scored 60.92 vs Microsoft GraphRAG 49.29 on fact retrieval (GraphRAG-Bench) — [beri.net](https://www.beri.net/article/graphrag-vs-vector-rag-indexing-query-cost-lightrag-lazygraphrag-2026)
- HippoRAG 2: GraphRAG/LightRAG/RAPTOR underperform dense retrieval on simple QA. HippoRAG 2 beats NV-Embed-v2 by 2.8 F1 on average — [arXiv 2502.14802](https://arxiv.org/html/2502.14802v1)
- Diffbot KG-LM benchmark (2023, dated): 16.7% without KG to 56.2% with KG; vector-only at 0% on KPI/strategy questions and on queries with more than 5 entities — [FalkorDB](https://www.falkordb.com/blog/graphrag-accuracy-diffbot-falkordb/)
- Adding a graph doesn't automatically help. Results depend on graph structure, retrieval strategy and question type. A comprehensive analysis concludes graphs suit multi-hop/reasoning, explainability and long-term context — [arXiv 2506.05690](https://arxiv.org/pdf/2506.05690); [Neo4j blog](https://neo4j.com/blog/agentic-ai/vector-rag-vs-graphrag/)
- Hybrid routing "consistently beats either one alone" — [VentureBeat](https://venturebeat.com/orchestration/stop-graphing-everything-when-graphrag-actually-beats-vector-rag)
- An ORAN-domain benchmark compared vector, graph and hybrid pipelines — [arXiv 2507.03608](https://arxiv.org/html/2507.03608v1)

**Cost and latency**
- Indexing a 10M-token corpus: vector ~$1.40; LightRAG ~$330; Microsoft GraphRAG standard ~$430; GraphRAG "fast" ~$100 — [beri.net 2026](https://www.beri.net/article/graphrag-vs-vector-rag-indexing-query-cost-lightrag-lazygraphrag-2026). Caveat: the article prices at "gpt-6.1-sol" rates, a model name I could not verify, so treat absolute dollars as illustrative and ratios as the signal.
- Prompt tokens per question (GraphRAG-Bench): vector 879; GraphRAG local 38,707; LightRAG 100,832; GraphRAG global 331,375 — [beri.net](https://www.beri.net/article/graphrag-vs-vector-rag-indexing-query-cost-lightrag-lazygraphrag-2026)
- Monthly query cost at 2,000 questions/day: vector ~$105; GraphRAG local ~$4,600; LightRAG ~$12,100; GraphRAG global ~$39,800. Re-indexing at 10% monthly churn: vector $0.14/month vs GraphRAG $33-132/month — [beri.net](https://www.beri.net/article/graphrag-vs-vector-rag-indexing-query-cost-lightrag-lazygraphrag-2026)
- Latency (Zhou et al.): vanilla RAG 2.35 s on multi-hop; LightRAG 19.28 s; GraphRAG global ~9 minutes per query — [beri.net](https://www.beri.net/article/graphrag-vs-vector-rag-indexing-query-cost-lightrag-lazygraphrag-2026)
- Corpus that costs under $5 to embed costs $50-200 through GraphRAG extraction + community summarisation. A 500-page corpus takes ~45 min and $50-200 at GPT-4 pricing (dated pricing) — [paperclipped.de 2026](https://www.paperclipped.de/en/blog/graph-rag-production/); [theneuralbase](https://theneuralbase.com/graphrag/learn/beginner/cost-comparison-graphrag-is-expensive/)
- GraphRAG indexing ranged $51.37-$389.12 across MSMARCO/HotPotQA-style benchmarks — [arXiv 2503.02922](https://arxiv.org/pdf/2503.02922)
- LazyGraphRAG/LightRAG/Fast GraphRAG claimed to cut indexing cost 50-6,000x while keeping global-question accuracy (secondary) — [beri.net](https://www.beri.net/article/graphrag-vs-vector-rag-indexing-query-cost-lightrag-lazygraphrag-2026); LazyGraphRAG primary: 0.1% of GraphRAG indexing cost — [Microsoft Research](https://www.microsoft.com/en-us/research/blog/lazygraphrag-setting-a-new-standard-for-quality-and-cost/)
- HippoRAG 2 indexing tokens: 9.2M vs LightRAG 68.5M vs GraphRAG 115.5M (MuSiQue) — [arXiv 2502.14802](https://arxiv.org/html/2502.14802v1)

**Decision heuristics from practitioners**
- Add a graph only if global questions are a meaningful share (under 1 in 10 means "a graph is a cost center"), monthly document churn is under ~10%, query volume justifies per-question tokens, latency tolerance exists, and a named person owns entity types and merge rules. Start with hybrid search (vectors + BM25 + rerank) and measure failures first — [beri.net](https://www.beri.net/article/graphrag-vs-vector-rag-indexing-query-cost-lightrag-lazygraphrag-2026)
- Similar 2026 decision frameworks — [cruxdigits](https://cruxdigits.nl/blog/rag-vs-graphrag-2026/); [TianPan](https://tianpan.co/blog/2026-04-19-graphrag-vs-vector-rag-architecture-decision); [Meilisearch](https://www.meilisearch.com/blog/graph-rag-vs-vector-rag)

### Inferences
- For Geiger Grey the graph has standalone product value (exploration, CRM-style relationships, provenance), so the retrieval ROI bar is lower than for a pure QA system. Still, run graph-augmented retrieval only when a query router detects multi-hop, entity-centric or global intent. Keep default chat on hybrid vector + BM25 + rerank.
- Budget model: extraction costs roughly one LLM pass over all tokens. With a small/cheap model plus gleaning off, this is likely tens of dollars per 10M tokens, but I didn't verify that with current model prices. Community summaries and global search are the expensive parts, so make them opt-in or use LazyGraphRAG-style query-time summarisation.
- Incremental updates matter: Microsoft-style community summaries must be partially recomputed on churn, while Graphiti-style incremental ingest with entity resolution on insert avoids full re-indexing.

### Gaps
- I found no benchmark specific to media-heavy corpora (video/audio transcripts) or to mixed structured (form) + unstructured inputs.
- The GraphRAG-Bench figures come via secondary articles. The ICLR 2026 paper itself was not fetched.
- Current per-token prices for 2026 models were not verified, so absolute dollar figures are illustrative.

## 5. UX patterns: explorer, entity pages, editing/merging, ontology, provenance, chat-over-graph

### Takeaway
The established pattern set has six parts: (1) a WebGL force-graph explorer with type filters, search and subgraph/ego views; (2) a properties side panel for an entity or relation; (3) manual edit/merge/delete plus automated dedup and orphan cleanup; (4) a schema/ontology picker before extraction; (5) chat with citations back to chunks and a view of retrieved graph context; (6) eval metrics. No single product combines all of these with CRM-style entity pages, which is Geiger Grey's opening.

### Cited Findings
- **Graph explorer**:
  - Neo4j LLM Graph Builder offers lexical graph (documents/chunks), entity graph and full graph views, per-document or batch, plus Bloom for exploration/query/edit — [Neo4j Labs features](https://neo4j.com/labs/genai-ecosystem/llm-graph-builder-features/)
  - LightRAG WebUI uses Sigma.js/Graphology WebGL with gravity layouts, node search/queries and subgraph filtering — [DeepWiki LightRAG Web UI](https://deepwiki.com/HKUDS/LightRAG/5-web-user-interface)
- **Entity panel / editing**: LightRAG's PropertiesView supports viewing and inline editing of entity/relation attributes, and create/edit/delete of entities and relations — [DeepWiki](https://deepwiki.com/HKUDS/LightRAG/7-web-ui-(lightrag_webui)); [LightRAG README](https://github.com/lbucess-rage/LightRAG)
- **Merge**: LightRAG's merge-entities API re-points all relationships and takes per-field merge strategies — [LightRAG README](https://github.com/lbucess-rage/LightRAG). Neo4j Builder offers node de-duplication as a post-processing job — [Neo4j developer guide](https://neo4j.com/developer/genai-ecosystem/importing-graph-from-unstructured-data/)
- **Cleanup**: Neo4j Builder's "Delete Disconnected Nodes" removes entities linked only to chunks and not to other entities — [Neo4j Labs features](https://neo4j.com/labs/genai-ecosystem/llm-graph-builder-features/)
- **Ontology editing**: Neo4j Builder offers a schema dropdown, custom labels/relationship types, pull-from-DB, or text/RDF ontology input. Cognee validates entities against an ontology — [Neo4j Labs features](https://neo4j.com/labs/genai-ecosystem/llm-graph-builder-features/); [Cognee](https://www.cognee.ai/blog/deep-dives/grounding-ai-memory)
- **Provenance**:
  - Neo4j's lexical graph links entities to chunks to documents, and chat exposes retrieval details (sources, token usage) — [Neo4j Labs features](https://neo4j.com/labs/genai-ecosystem/llm-graph-builder-features/)
  - Graphlit emphasises entity-to-content edges — [Vellum](https://www.vellum.ai/blog/graphrag-improving-rag-with-knowledge-graphs)
  - Writer shows reasoning, sub-question decomposition and source citations — [Writer](https://writer.com/product/graph-based-rag/)
- **Chat-over-graph**: Neo4j Builder offers selectable modes (vector-only vs GraphRAG with 2-hop traversal), filtering chat to selected documents, and Ragas evaluation — [Neo4j Labs features](https://neo4j.com/labs/genai-ecosystem/llm-graph-builder-features/); [Neo4j blog](https://neo4j.com/blog/developer/graphrag-llm-knowledge-graph-builder/)
- **Temporal UX enabler**: bi-temporal edges (valid/invalid times, invalidation instead of deletion) support "as of" views and fact history — [Zep paper](https://arxiv.org/pdf/2501.13956.pdf); pg-raggraph `as_of` time-travel queries — [pg-raggraph](https://github.com/yonk-labs/pg-raggraph)
- **Guardrails**: WhyHow rule sets control which graph data feeds RAG — [Vellum](https://www.vellum.ai/blog/graphrag-improving-rag-with-knowledge-graphs)

### Inferences
- Recommended Geiger Grey UX set, in roughly this priority order:
  1. Force-graph explorer (existing react-force-graph) with type colour legend, type/source/document filters, search-to-focus, ego-network expand on click, and a degree/top-N cap for large graphs.
  2. Entity side sheet (shadcn Sheet): type, aliases, properties, relations list, "mentioned in" chunks with jump-to-source (document/timestamp for media), and a source_app badge (Ingestion vs Forms vs manual).
  3. Merge flow: suggested duplicates queue (trigram + embedding similarity) and manual multi-select merge with field-level conflict resolution. Keep `merged_into` for undo/audit.
  4. Per-project ontology settings: entity/relation types, colours, extraction on/off per type.
  5. Chat with "graph context" toggle/indicator and citations to chunks and entities. Clicking an entity in an answer highlights it in the graph.
  6. Optional "themes/communities" view if community summaries are enabled.
- Treat Forms-pushed entities as authoritative and structured (high-confidence, no LLM), and LLM-extracted ones as probabilistic with a confidence score and mention provenance. That supports the CRM use without polluting it.

### Gaps
- I found no published usability studies on KG explorers for non-technical users. The patterns above come from product and documentation descriptions only.
- Glean, Writer and Bedrock graph UIs (whether they expose a graph view at all) were not verified hands-on. They appear not to offer user-editable graph views, but that is unconfirmed.
