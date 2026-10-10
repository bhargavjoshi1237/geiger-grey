# Multimodal Ingestion, Parsing & Ingestion Settings for RAG (as of Oct 2026)

Notes for the Geiger Grey ingestion-settings UX and pipeline design. Prices are list/pay-as-you-go unless noted. Where a figure comes only from a third-party aggregator rather than the vendor page, it is marked **[aggregator]**. Vendors reprice often, so check every number against the vendor page before it goes into the product.

---

## 1. Parsing vendors & tools: cost per page and quality tiers

### Takeaway
Document parsing has settled into tiers. Cheap text/OCR costs about $1–4 per 1K pages, layout-aware parsing about $10–15 per 1K, and VLM/"agentic" parsing about $12–60+ per 1K. Almost every vendor now exposes a fast / balanced / premium (agentic) choice and many offer per-page auto-routing. That maps directly onto a 3–4 tier "quality" preset in Geiger Grey.

### Cited Findings

**LlamaParse / LlamaCloud (LlamaIndex)**
- Credit price: 1,000 credits = $1.25. Plans: Free $0/mo (10K credits), Starter $50/mo (40K credits, 5 concurrent parse jobs), Pro $500/mo (400K credits, 20 concurrent), Enterprise custom (100 concurrent). — [LlamaIndex pricing](https://www.llamaindex.ai/pricing)
- Parse v2 tiers in credits per page: **Fast 1 (~$0.00125/pg)**, **Cost-effective 3 (~$0.00375/pg)**, **Agentic 10 (~$0.0125/pg)**, **Agentic Plus 45 (~$0.056/pg)**. Add-ons: layout extraction +3, enriched forms +10, spreadsheet 1/sheet, **audio 3 credits/minute**. — [LlamaIndex pricing docs](https://developers.llamaindex.ai/python/cloud/general/pricing/)
- Legacy v1 "Parse page with Agent" (Anthropic Sonnet) costs 45–90 credits/page. "Parse with LLM" ranges from 3 to 45 depending on model. — [LlamaIndex pricing docs](https://developers.llamaindex.ai/python/cloud/general/pricing/)
- "Auto Mode — smart tier routing per page (saves up to 80%)". — [LlamaIndex pricing](https://www.llamaindex.ai/pricing)
- Indexing v2: 2 credits per exported page, 1 per retrieval query, 100 per chat turn. Indexing v1: standard 1/page, spreadsheet 2, multimodal 2. Storage: 100 credits per GB per day. Extract (v2): Agentic 25 total (15 extract + 10 parse), Agentic Plus 60, Cost-effective 8. — [LlamaIndex pricing docs](https://developers.llamaindex.ai/python/cloud/general/pricing/)
- An Index created with empty `llama_parse_parameters` defaults to the **cost-effective preset (3 credits/page)**. — via search summary of [LlamaCloud index docs](https://developers.llamaindex.ai/llamaparse/cloud-index-v2/getting_started/) (snippet, not fetched in full)

**Reducto**
- Per 1K pages: **Parse (r-1) $10**, Extract $20, Deep Extract $40, Split $20, Deep Split $40, Classify $7.50, Edit $60 ($15 pre-filled). Standard pay-as-you-go plan includes $150 free usage. Growth/Enterprise are custom, with ZDR, BAA, EU/AU residency and VPC/on-prem. — [Reducto pricing](https://reducto.ai/pricing)
- Benchmarks summary: Reducto's agentic mode adds about +5 points overall, +10 on tables and +16 on charts. — ParseBench, via search summary of [arXiv 2604.08538](https://arxiv.org/pdf/2604.08538) (not fetched in full; verify)

**Unstructured**
- Hosted: 10,000 free pages, then **$0.015/page ($15 per 1K)** pay-as-you-go. Business plan is custom (dedicated instance/VPC). Partition strategies offered: **Auto, Fast, High-Res, VLM**. Enrichments include NER, "generative OCR" and embeddings. Supports 50+ file types and 40+ connectors. — [Unstructured pricing](https://unstructured.io/pricing)
- Open-source chunking defaults: strategies `basic` and `by_title`; `max_characters=500`; `new_after_n_chars` defaults to `max_characters`; `overlap=0`; `overlap_all=False`; `combine_text_under_n_chars` (by_title); `multipage_sections=True`. **Tables are always isolated chunks** and oversized tables split into `TableChunk`s. — [Unstructured OSS chunking docs](https://docs.unstructured.io/open-source/core-functionality/chunking)

**Mistral OCR**
- Features: Markdown/HTML/inline table output, header/footer extraction (OCR 2512+), block extraction with bboxes and reading order (OCR 4+), confidence scores at page/block/word level, 40+ languages. Inputs: PDF, PPTX, DOCX and images. — [Mistral OCR docs](https://docs.mistral.ai/capabilities/document_ai/basic_ocr/)
- Pricing **[aggregator]**: **$4 per 1K pages** standard, $5 per 1K annotated pages (Document AI), **$2 per 1K with Batch API**. Latest version is cited as "OCR 4.1". — [The Rundown](https://www.therundown.ai/tools/mistral-ocr-4), [invoiceextractor.ai](https://invoiceextractor.ai/mistral-ocr-pricing); launch post: [Mistral OCR 4](https://mistral.ai/news/ocr-4/). The docs page fetched did not list prices. An aggregator also reports a July 2026 Mistral API price change ([usagepricing.com](https://www.usagepricing.com/blueprint/activity/mistral-ai-2026-07-06-api-rate-increase)), so verify the current OCR rate.

**Hyperscalers (Azure Document Intelligence, Google Document AI, AWS Textract)** **[aggregator]**
- Basic OCR is about **$1.50 per 1K pages** on all three. Layout: Azure ~$10/1K, Google Layout Parser ~$10/1K, AWS Textract Layout ~$4/1K. Textract forms+tables is about $65/1K. — [soceton.com comparison](https://soceton.com/blogs/document-ai-ocr-pricing-comparison), [aliteq.com](https://aliteq.com/idp-pricing-per-page) (search summaries; vendor pages not fetched)

**Docling (IBM, open source)**
- MIT-licensed and hosted by LF AI & Data. The Granite-Docling-258M VLM is Apache 2.0. It parses PDF/DOCX/PPTX/XLSX/images into Markdown/JSON/chunks. Components: Heron layout model (RT-DETR, mAP@50:95 0.69 on DocLayNet), TableFormer (trained on 1M+ tables), and a VLM pipeline that can call Granite-Docling or any OpenAI-compatible VLM. **HybridChunker** keeps structural boundaries, merges tiny neighbours and splits elements that overflow the embedder's token window. — [docling.org](https://docling.org/), [IBM Granite docs](https://www.ibm.com/granite/docs/models/docling)

**Marker / Datalab (open source + hosted)**
- License: Marker ≥2.0.0 code is Apache-2.0. Model weights are free for commercial use below a **$5M revenue/funding** threshold for Marker/Surya ($2M for Chandra), and a commercial license is required above that. Pre-2.0 was GPL-3.0 with a $2M trigger. — [particula.tech](https://particula.tech/blog/docling-vs-mineru-vs-marker-pdf-parser) **[aggregator]**, [Datalab pricing](https://www.datalab.to/pricing)
- Hosted API is about **$4 per 1K pages** (fast/balanced) and **$6 per 1K** (accurate / structured JSON). Free plan: $20/mo of usage with a work email. Marker v2.0.0 (Jul 20 2026) reportedly runs ~23.7 pages/s with OCR off and scores 76.0 on olmOCR-Bench in balanced mode. — [receiptocr.ai](https://receiptocr.ai/blog/datalab-pricing) **[aggregator]**; search summaries (verify against [Datalab](https://www.datalab.to/pricing))

**MinerU / PaddleOCR-VL (open source)**
- On OmniDocBench v1.6 (10 doc types, 5 languages), the top scorer is PaddleOCR-VL-1.6 at 96.34. MinerU's CPU pipeline scores 86.47 and its hybrid/VLM engines about 95.3. — search summary referencing [OmniDocBench](https://github.com/opendatalab/OmniDocBench) and [MinerU2.5-Pro](https://arxiv.org/pdf/2604.04771) (verify)
- ParseBench (2026, 2,078 enterprise docs) places LlamaParse Agentic on the cost/quality Pareto frontier at about 1.2¢/page and 84.9%. — search summary of [ParseBench arXiv 2604.08538](https://arxiv.org/pdf/2604.08538). ParseBench comes from LlamaIndex authors, so treat it as potentially vendor-biased.

**Chunkr**
- Free 200 pages/mo. Dev $375/mo for 25K pages ($0.015/page). Growth $750/mo for 75K pages ($0.010/page). The core is open source. — [Chunkr pricing](https://www.chunkr.ai/pricing) (search summary)

**Web ingestion: Firecrawl, Jina Reader**
- Firecrawl: scrape/crawl/map at **1 credit/page**, search at 2 credits per 10 results. JSON extraction adds credits (JSON + ZDR = 6 credits/page, JSON + PII redaction = 9). — [Firecrawl billing docs](https://docs.firecrawl.dev/billing), [Firecrawl pricing](https://www.firecrawl.dev/pricing) (search summary)
- Jina Reader (r.jina.ai): about **$0.02 per 1M output tokens** **[aggregator]**. New keys get 10M free tokens. Keyless use is rate-limited to about 20 RPM. — [Jina Reader](https://jina.ai/reader/), [agentscamp guide](https://agentscamp.com/guides/advanced/jina-reader-api)

**Ragie (RAG-as-a-service reference point)**
- Extra pages: **fast $0.02/page**, **hi_res $0.05/page**. hi_res extracts charts, graphs, tables and images. Audio $0.0067/min, video $0.025/min, media storage $0.12/GB-month. — [Ragie pricing](https://www.ragie.ai/pricing) (search summary; the docs page failed to fetch over SSL)

### Inferences
- A reasonable Geiger Grey cost ladder per 1K pages, in COGS terms: **Fast** (text layer / basic OCR, ~$1–2), **Balanced** (layout + tables, e.g. Mistral OCR / Marker / Textract Layout / LlamaParse cost-effective, ~$2–10), **High-accuracy** (agentic VLM, e.g. LlamaParse Agentic / Reducto, ~$10–15), and **Premium** (Agentic Plus / Deep Extract, ~$40–60).
- Ragie's retail price of $20–50 per 1K pages compared with $2–15 COGS shows how much RAG-as-a-service products mark up.
- Self-hosted Docling (MIT) or MinerU is the cleanest license choice for a default "Balanced" tier. Marker weights need a commercial license once revenue or funding passes $5M.
- Per-page auto-routing (LlamaParse "Auto Mode") is a strong pattern to copy: classify each page (text-only, scanned, table-heavy, chart) and send only the hard pages to the expensive tier.

### Gaps
- I did not fetch vendor-official pages for Azure, Google or Textract, so those prices come from aggregators.
- I could not confirm Mistral OCR pricing on a Mistral page.
- No head-to-head independent benchmark exists across all vendors. ParseBench is LlamaIndex-authored, and OmniDocBench mostly covers open models.
- Ragie mode docs were not fetched because of an SSL error.

---

## 2. Audio, video, images & multimodal embeddings

### Takeaway
Batch transcription with diarization and word timestamps is commodity-priced at $0.15–0.40 per audio hour. For video, the choice is either a dedicated index such as Twelve Labs (~$2.6/hr indexed) or Gemini-style token pricing (~300 tokens per second of video). Visually rich documents can now be embedded directly with multimodal embedders such as Cohere Embed 5, Voyage multimodal and jina-v4, or with ColPali-style multi-vector models, at a significant storage cost for the multi-vector approach.

### Cited Findings

**Transcription (batch)** **[aggregator — verify on vendor pages]**
- **AssemblyAI** Universal-2 async: **$0.15/hr**, diarization included, 99 languages. — [futureagi STT comparison](https://futureagi.com/blog/speech-to-text-apis-in-2026-benchmarks-pricing-developer-s-decision-guide/)
- **Deepgram**: $0.0043/min batch (~$0.26/hr) and $0.0077/min streaming PAYG. Growth plan batch $0.0036/min. **Diarization is +$0.0020/min**, for about $0.38/hr total. — [futureagi](https://futureagi.com/blog/speech-to-text-apis-in-2026-benchmarks-pricing-developer-s-decision-guide/), [Gladia](https://www.gladia.io/blog/assemblyai-vs-deepgram)
- **ElevenLabs Scribe v2**: **$0.22/hr** batch, $0.39/hr realtime. Word-level timestamps, diarization up to 32 speakers, audio-event tagging. — [futureagi](https://futureagi.com/blog/speech-to-text-apis-in-2026-benchmarks-pricing-developer-s-decision-guide/)
- **OpenAI**: whisper-1 and gpt-4o-transcribe $0.006/min ($0.36/hr). gpt-4o-mini-transcribe $0.003/min. A gpt-4o-transcribe diarize variant is ~$0.006/min. A newer "GPT-Transcribe" is reported at $0.0045/min. — [costgoat (Oct 2026)](https://costgoat.com/pricing/openai-transcription), [spokenly](https://spokenly.app/blog/gpt-transcribe)
- LlamaParse prices audio at 3 credits/min (~$0.00375/min, $0.225/hr). Ragie charges $0.0067/min for audio and $0.025/min for video. — [LlamaIndex pricing docs](https://developers.llamaindex.ai/python/cloud/general/pricing/), [Ragie pricing](https://www.ragie.ai/pricing)

**Video understanding**
- **Twelve Labs**: Marengo indexing $0.042/min plus $0.0015/min infrastructure (~$2.61/hr). Pegasus analyze ~$0.021–0.029/min input plus $0.0075 per 1K output tokens. Search costs $4 per 1K queries. Free tier is 600 minutes with 90-day retention. — [Twelve Labs pricing](https://www.twelvelabs.io/pricing) (search summary; sources disagree slightly on Pegasus)
- **Gemini API**: samples video at **1 fps by default** (configurable `fps`). Frames cost **258 tokens** at default resolution or **66 tokens** at low `media_resolution`, plus 32 tokens/s for audio. That is about 300 tokens/s at default and about 100 tokens/s at low resolution. — [Gemini video understanding docs](https://ai.google.dev/gemini-api/docs/video-understanding)
- **Bedrock KB** has two video paths. Nova multimodal embeddings chunk audio/video at **1–30 s (default 5 s)**. The Bedrock Data Automation parser converts media into transcripts and scene summaries, which are then text-chunked. — [AWS Bedrock KB chunking](https://docs.aws.amazon.com/bedrock/latest/userguide/kb-chunking.html)

**Multimodal and visual-document embeddings**
- **Cohere Embed 5** (GA ~Oct 1 2026): Pro $0.12/M tokens and Fast $0.08/M, with image inputs at $0.40/M tokens. Dimensions 2048/1536/1024/768/512/256. Formats float/int8/binary. 128K context, 100+ languages, inputs of text, image, or fused text+image. **Pro and Fast share one embedding space**, so you can index with Pro and query with Fast. — [Cohere Embed 5 blog](https://cohere.com/blog/embed-5), [Cohere changelog](https://docs.cohere.com/changelog/embed-v5), [AIwire](https://www.hpcwire.com/aiwire/2026/10/01/cohere-releases-embed-5-with-pro-and-fast-tiers-for-enterprise-ai/). Prior Embed v4: $0.12/M text and ~$0.47/M image **[aggregator]** ([embeddingcost.com](https://embeddingcost.com/cohere)).
- **Voyage**: voyage-multimodal-3.5 at $0.12/M tokens, with 200M free tokens and 150B free pixels **[aggregator]**. — [embeddingcost.com/voyage](https://embeddingcost.com/voyage), [MongoDB Voyage billing](https://www.mongodb.com/docs/voyageai/management/billing/)
- **jina-embeddings-v4** (3.8B params): single-vector 2048-d, Matryoshka-truncatable to 128-d, plus multi-vector 128-d per token (ColBERT/ColPali-style). Strong on ViDoRe and on visually rich tables, charts and diagrams. — [arXiv 2506.18902](https://arxiv.org/html/2506.18902v2), [Jina model page](https://jina.ai/models/jina-embeddings-v4/)
- **ColPali / ColQwen**: embed page images as patch vectors with late interaction, so no OCR is needed. That means about **1,030 vectors × 128-d per page (~257 KB/page)**. One estimate puts 1M pages at 100–500 GB of raw vectors. Pooling or binary quantization can cut storage about 100× with small losses. — [ColPali paper](https://arxiv.org/abs/2407.01449), [HF ColPali blog](https://huggingface.co/blog/manu/colpali), [Spheron](https://www.spheron.network/blog/colpali-multimodal-document-rag-gpu-cloud/), [DocPruner](https://arxiv.org/pdf/2509.23883)
- **ViDoRe v3** benchmark: 26K+ pages, 3,099 queries, 6 languages, 10 datasets (HR, finance, industrial, pharma and others), scored with nDCG. — [HF vidore](https://huggingface.co/vidore), [Qdrant ColPali course](https://qdrant.tech/course/multi-vector-search/module-2/colpali-family/)

### Inferences
- A sensible audio/video default for Geiger Grey: transcribe with diarization and word timestamps, then chunk the transcript by speaker turn or time window (e.g. 30–60 s or ~300–500 tokens) and keep `start_ms`/`end_ms` on every chunk so citations can deep-link into the player.
- Offer an optional "visual understanding" toggle for video. It could sample keyframes and caption them with a VLM, or use Twelve Labs or Gemini. Price it per minute and show that cost before the job runs.
- For PDFs and slides with many charts, a "visual embedding" option (Cohere Embed 5 or Voyage multimodal on page images) is cheaper and simpler than ColPali. Keep ColPali-style multi-vector as an advanced, storage-heavy option.

### Gaps
- I did not fetch vendor-official pages for AssemblyAI, Deepgram, ElevenLabs or OpenAI, so those figures come from aggregators.
- I found no independent 2026 WER benchmark with sources I trust.
- I found no pricing for Jina CLIP / jina-embeddings-v4 API usage.
- Twelve Labs Pegasus pricing is inconsistent between sources.

---

## 3. Chunking strategies: what the evidence says

### Takeaway
Evidence consistently shows that simple recursive or fixed-size chunking at about 200–512 tokens is a strong, robust default, and that semantic chunking rarely justifies its cost. The larger gains come from structure-aware parsing (keeping sections and tables intact), adding document context to each chunk (Anthropic contextual retrieval or late chunking), and parent-child retrieval.

### Cited Findings
- **Vectara, NAACL 2025 Findings, "Is Semantic Chunking Worth the Computational Cost?"**: on realistic document sets, fixed-size chunking matched or beat semantic chunking across document retrieval, evidence retrieval and answer generation. The authors conclude that the computational overhead "rarely yields proportional improvements". — [ACL Anthology](https://aclanthology.org/2025.findings-naacl.114/), [Vectara blog](https://www.vectara.com/blog/is-semantic-chunking-worth-the-computational-cost)
- Benchmark write-ups disagree in an instructive way. Semantic chunking reaches **91.9% retrieval recall** (Chroma eval) but only **54% end-to-end accuracy**, against **69% for recursive 512-token splitting**, in a Feb 2026 benchmark on 50 academic papers. The semantic chunker produced fragments averaging about 43 tokens, which retrieved well but gave the LLM too little context. — [PremAI 2026 chunking benchmark guide](https://www.premai.io/blog/rag-chunking-strategies-the-2026-benchmark-guide/) **[secondary blog]**. Note: this blog also attributes a "25 configurations × 48 embedding models" study to Vectara, which may be a conflation. Verify before citing.
- **Anthropic Contextual Retrieval**: an LLM prepends a short chunk-specific context before embedding and BM25 indexing. Results: contextual embeddings cut top-20 retrieval failure by **35%** (5.7%→3.7%), contextual embeddings plus contextual BM25 by **49%** (→2.9%), and adding a reranker by **67%** (→1.9%). One-time cost is about **$1.02 per 1M document tokens** with prompt caching. Passing the top-20 chunks beat passing 5 or 10. Voyage and Gemini embeddings performed best. — [Anthropic](https://www.anthropic.com/news/contextual-retrieval) (Sept 2024 post; model references are dated)
- **Late chunking (Jina)**: embed the whole long document with a long-context embedder, then mean-pool token embeddings per chunk span, so each chunk vector carries document context. It consistently beats naive chunking, especially for small chunks and long documents, and needs no extra LLM call. — [arXiv 2409.04701](https://arxiv.org/pdf/2409.04701), [Jina blog](https://jina.ai/news/late-chunking-in-long-context-embedding-models/)
- **Parent-child / hierarchical**: Bedrock KB matches on child chunks and returns their parent chunks. Note that this can return fewer results than requested. — [AWS docs](https://docs.aws.amazon.com/bedrock/latest/userguide/kb-chunking.html). Dify Parent-child mode matches on child chunks and returns parents (paragraph or full-doc). — [Dify docs](https://docs.dify.ai/en/use-dify/knowledge/create-knowledge/chunking-and-cleaning-text)
- **Tables**: Unstructured always isolates tables as their own chunk and splits oversized tables into `TableChunk`s. — [Unstructured docs](https://docs.unstructured.io/open-source/core-functionality/chunking). Docling's HybridChunker respects structural elements and splits only when an element exceeds the token window. — [docling.org](https://docling.org/). RAGFlow ships a dedicated **Table** template for spreadsheet-heavy content. — [DataCamp RAGFlow tutorial](https://www.datacamp.com/tutorial/ragflow)
- **Default chunk sizes in products**: Bedrock default is about 300 tokens honoring sentence boundaries. Bedrock fixed-size takes max tokens plus an overlap %. Bedrock semantic takes max tokens, buffer size (e.g. 1 = ±1 sentence) and breakpoint percentile threshold, and incurs foundation-model cost. — [AWS](https://docs.aws.amazon.com/bedrock/latest/userguide/kb-chunking.html). Unstructured defaults to 500 characters with 0 overlap. — [Unstructured](https://docs.unstructured.io/open-source/core-functionality/chunking). LlamaCloud chunk modes are none, character, token, sentence and semantic, each with `chunk_size`/`chunk_overlap`. — [LlamaCloud UI guide](https://docs.cloud.llamaindex.ai/llamacloud/guides/ui) (search summary)

### Inferences
- Recommended Geiger Grey default: structure-aware parsing to Markdown, then section/heading-aware recursive splitting at about 400–512 tokens with 10–15% overlap. Keep tables atomic, with headers repeated if a table must be split. Store heading-path breadcrumbs as metadata and prepend them to the embedded text.
- Present "Contextual enrichment" (Anthropic-style) as a premium toggle with a visible cost estimate of about $1 per 1M tokens on Claude Haiku-class models, which needs re-verifying for current models. Offer parent-child as a "more context in answers" toggle.
- Hide semantic chunking under Advanced or omit it, since evidence says it is not worth the compute.

### Gaps
- I could not verify the primary Chroma or FloTorch benchmark reports (only secondary blogs).
- I found no rigorous benchmark comparing contextual retrieval with late chunking head to head.

---

## 4. Embedding models, dimensions, quantization, rerankers, hybrid search

### Takeaway
API embedders cost about $0.02–0.15 per 1M tokens and now commonly support Matryoshka dimension truncation plus int8/binary output, so dimension and quantization can be storage/cost knobs. Hybrid BM25 + vector search followed by a reranker is the evidence-backed default.

### Cited Findings
- MTEB snapshot **[aggregator]**: Gemini Embedding 001 at $0.15/M, 3072-d. OpenAI text-embedding-3-large at $0.13/M, 3072-d, 8K context. Qwen3-Embedding-8B is open-weight, 4096-d, 32K context. QZhou-Embedding is reported top at 75.97. Leaderboard positions shift constantly. — [PremAI embedding ranking](https://www.premai.io/blog/best-embedding-models-for-rag-2026-ranked-by-mteb-score-cost-and-self-hosting/), [codesota MTEB](https://www.codesota.com/benchmarks/mteb), [Gemini Embedding paper](https://arxiv.org/pdf/2503.07891)
- **Voyage** **[aggregator]**: voyage-4 at $0.06/M tokens with 200M free tokens and a 33% batch discount. rerank-2.5 at $0.05/M tokens. — [embeddingcost.com](https://embeddingcost.com/voyage), [MongoDB Voyage billing](https://www.mongodb.com/docs/voyageai/management/billing/)
- **Cohere Embed 5**: Pro $0.12/M, Fast $0.08/M. Matryoshka dims 256–2048 with float/int8/binary output. — [Cohere blog](https://cohere.com/blog/embed-5)
- **Cohere Rerank**: one search unit is one query with up to 100 docs, and docs over 500 tokens are split and counted per chunk. The current pricing page shows Rerank 3.5, Rerank 4 Fast and Rerank 4 Pro as dedicated Model Vault instances ($5–10/hr). Per-1K-search API rates were not visible; aggregators cite $2 per 1K searches for v3.5 and $1 per 1K for others. — [Cohere pricing](https://cohere.com/pricing), [pecollective](https://pecollective.com/tools/cohere-pricing/) **[aggregator, conflicting]**
- **jina-embeddings-v4**: Matryoshka truncation from 2048 down to 128 dims "with minimal loss". — [arXiv 2506.18902](https://arxiv.org/html/2506.18902v2)
- Hybrid search and rerankers have the strongest evidence. Anthropic's results show BM25 + embeddings beats embeddings alone (35% → 49% failure reduction), and adding reranking takes it to 67%. — [Anthropic](https://www.anthropic.com/news/contextual-retrieval). Dify's built-in "Parent-child-HQ" template defaults to **Hybrid Search**. — [Dify knowledge pipeline docs](https://docs.dify.ai/en/cloud/use-dify/knowledge/knowledge-pipeline/knowledge-pipeline-orchestration) (search summary)

### Inferences
- Make the embedding model a workspace-level, mostly fixed choice. Changing it forces re-embedding everything, as Dify does by locking chunk mode after creation. Expose dimension (e.g. 1024 default, 256 "compact", 2048 "max") and quantization (float / int8 / binary) as storage-vs-quality knobs.
- Cohere Embed 5's shared Pro/Fast space is useful because it allows high-quality indexing with cheap query-time embedding.
- Defaults for Geiger Grey: hybrid (BM25 + dense) on, reranker on, top-k retrieve about 50–100, rerank to about 10–20.

### Gaps
- Official per-search Cohere Rerank 4 API prices were not on the pricing page.
- I could not confirm Jina reranker or BGE reranker pricing. BGE is open-weight, so self-host cost only.
- The MTEB numbers come from secondary aggregators with inconsistent scores (e.g. Qwen3-8B listed as both 67.89 and 75.1).

---

## 5. How products present ingestion settings to non-experts (presets vs advanced)

### Takeaway
The dominant pattern is two levels. First, an opinionated preset or template (Auto / Fast / Hi-res, or doc-type templates) with a cost signal. Second, an "Advanced"/"Custom" panel exposing chunk size, overlap, delimiters, parent/child sizes, embedding model and retrieval mode. Some settings, such as chunk mode and embedding model, are locked after creation.

### Cited Findings
- **LlamaCloud Index UI**: a form with a LlamaParse on/off toggle and **Auto mode** for "best default transformation". Advanced mode configures segmentation and chunking (none/character/token/sentence/semantic, each with chunk_size/overlap) and the embedding model (e.g. OpenAI with your key). Parse tiers are a separate preset choice, with cost-effective as the default. — [LlamaCloud UI guide](https://docs.cloud.llamaindex.ai/llamacloud/guides/ui), [Index v2 getting started](https://developers.llamaindex.ai/llamaparse/cloud-index-v2/getting_started/) (search summaries)
- **Ragie**: a two-mode choice of **fast** (cheap, text) or **hi_res** (charts, tables, images), priced per page so the price is the explanation. — [Ragie pricing](https://www.ragie.ai/pricing)
- **Unstructured**: a strategy picker of **Auto / Fast / High-Res / VLM**. — [Unstructured pricing](https://unstructured.io/pricing)
- **Bedrock Knowledge Bases**: chunking options are Default (~300 tokens), Fixed-size, Hierarchical, Semantic, None, or a custom Lambda. The semantic option warns of extra FM costs. Parser choice is default, foundation model, or Bedrock Data Automation. Multimodal chunk duration is 1–30 s. — [AWS docs](https://docs.aws.amazon.com/bedrock/latest/userguide/kb-chunking.html)
- **Dify**: chunk mode is **General** or **Parent-child** (parent = paragraph or full doc, where full doc processes only the first 10K tokens). Settings: delimiter (e.g. `\n\n`), max chunk length, overlap, and preprocessing (normalize whitespace, remove URLs/emails). Index method is **High Quality** (embeddings) or **Economical** (inverted index/keywords), and Parent-child requires High Quality. Templates are "General Mode-ECO" and "Parent-child-HQ". **Chunk mode cannot be changed after the KB is created.** There is a preview function. Dify also has a visual "Knowledge Pipeline" orchestrator for custom flows. — [Dify chunk settings](https://docs.dify.ai/en/use-dify/knowledge/create-knowledge/chunking-and-cleaning-text), [Dify Knowledge Pipeline](https://dify.ai/blog/introducing-knowledge-pipeline)
- **RAGFlow**: **document-type chunking templates** (General/naive, Q&A, Resume, Manual, Table, Paper, Book, Laws, Presentation, Picture, One, Tag, plus a newer Ingestion Pipeline), with optional auto-keyword and auto-question generation. The HTTP API exposes fewer chunking parameters than the UI. — [DataCamp](https://www.datacamp.com/tutorial/ragflow), [RAGFlow issue #12307](https://github.com/infiniflow/ragflow/issues/12307), [DeepWiki](https://deepwiki.com/infiniflow/ragflow/6.1-document-parsing-strategies)
- **LlamaParse pricing page** encourages users to test configurations before building persistent pipelines. — [LlamaIndex pricing](https://www.llamaindex.ai/pricing)

### Inferences
Recommended UX for Geiger Grey, combining these patterns:
1. **Quality preset** (per collection, overridable per file): *Fast* / *Balanced (default)* / *High accuracy* / *Auto (route per page)*, each with a ¢/page or credits/page label and an example ("scanned PDFs, charts and complex tables need High accuracy").
2. **Content-type template** (RAGFlow-style, optional): General, Q&A/FAQ, Manual/Docs, Legal, Paper, Slides, Spreadsheet/Table, Transcript (audio/video), Image.
3. **Enrichment toggles** with cost: OCR (auto/force/off), image captioning, contextual enrichment, entity/KG extraction, auto-questions/keywords.
4. **Advanced** (collapsed): chunk strategy, size, overlap, parent/child sizes, delimiters, table handling, embedding model, dims, quantization, hybrid weight, reranker, top-k.
5. **Lock warnings**, as in Dify: tell users which settings force a full re-index (embedding model, dims, chunk mode).
6. **Preview** of chunks on a sample file before committing. Dify and LlamaCloud both do this.

### Gaps
- I did not fetch Vectara's ingestion-settings documentation, so Vectara's UX is not covered beyond its chunking paper.
- I did not directly view the current Ragie or LlamaCloud UI screens.
- Geiger Flow and Geiger Notes suite patterns were not reviewed, since they are out of scope for web research.

---

## 6. Re-ingestion, versioning, incremental sync, dedupe, cost estimation

### Takeaway
Hash-based change detection (doc_id → content hash) plus per-transformation caching is the standard mechanism for incremental re-ingestion and dedupe. Cost estimation before a job runs is easy because most vendors price per page, per minute or per token. Products rarely surface it well, which is an opportunity for Geiger Grey.

### Cited Findings
- **LlamaIndex IngestionPipeline** stores a `doc_id → document_hash` map in a docstore. With a vector store attached, documents whose ID is unchanged but whose hash changed get reprocessed and upserted, and unchanged documents are skipped. Without a vector store, it dedupes only on input. Each node+transformation pair is hashed and cached, so re-runs reuse prior outputs. Docstore backends include local, Redis, MongoDB and Firestore. — [LlamaIndex ingestion pipeline docs](https://developers.llamaindex.ai/python/framework/module_guides/loading/ingestion_pipeline/)
- **Dify**: chunk mode is immutable after KB creation, so changing it means creating a new KB and fully re-indexing. — [Dify docs](https://docs.dify.ai/en/use-dify/knowledge/create-knowledge/chunking-and-cleaning-text)
- **Storage-based billing** affects retention decisions. LlamaCloud charges 100 credits/GB/day for retained files, and Ragie charges $0.12/GB-month for media. — [LlamaIndex pricing docs](https://developers.llamaindex.ai/python/cloud/general/pricing/), [Ragie pricing](https://www.ragie.ai/pricing)
- Pricing inputs that support pre-run estimates: pages (parsing), minutes (audio/video), tokens (embeddings, contextual enrichment at ~$1.02/1M doc tokens), sheets (spreadsheets, 1 credit/sheet on LlamaParse). — sources above
- Unstructured, LlamaCloud and Ragie each advertise 40+ or managed connectors, and incremental sync from Drive, SharePoint and similar sources is a core managed-RAG feature. — [Unstructured pricing](https://unstructured.io/pricing), [Ragie SharePoint blog](https://www.ragie.ai/blog/indexing-enterprise-documents-a-developers-guide-to-integrating-sharepoint-for-rag)

### Inferences
- Store, per file version: source hash, parser + tier + version, chunker config hash, embedding model + dims. Re-run only the stages whose config hash changed. A chunk-size change re-chunks and re-embeds but does not re-parse; an embedding model change re-embeds only. Cache parse output (Markdown/JSON) as an artifact so changing chunk settings never repays parsing costs.
- Dedupe at two levels: exact file hash (skip the upload or link to the existing version) and near-duplicate chunk hash (avoid duplicate vectors across versions).
- Pre-run cost estimator: count pages, minutes and tokens at upload time (PDF page count, media duration, a token estimate from text length), multiply by the selected tier's unit price, and show a total with a per-file breakdown and a "cheaper preset" suggestion. Auto-routing can show a range, e.g. "$0.80–$3.20 depending on page complexity".
- Versioning: keep previous index versions queryable until a re-ingest completes, then swap atomically (blue/green index), to avoid serving an empty or partial KB.

### Gaps
- I found no public documentation on how Ragie, Vectara or Bedrock surface pre-run cost estimates in their UIs.
- I found no benchmark on incremental-sync latency or cost.
