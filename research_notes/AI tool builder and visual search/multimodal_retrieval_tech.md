# Multimodal retrieval technology for Grey: image similarity search and image-grounded answering on Postgres + pgvector with bring-your-own models (as of October 2026)

Research notes, 2026-10-21. Method: provider docs, model cards, pricing pages, the pgvector README and changelog, Supabase docs, arXiv papers and Hacker News (Algolia API). The web search budget ran out partway through. After that, everything came from fetching known URLs, so some third-party price figures could not be checked against first-party pricing pages. Those are marked "unverified".

Grey context from the repo: `grey.chunks.embedding` is a `halfvec` column with no fixed dimension, plus an `embedding_dims` column. There is one partial expression HNSW index per common dimension (256, 384, 512, 768, 1024, 1536, 2048, 3072), built with `m = 16, ef_construction = 64`. The vector search function sets `hnsw.iterative_scan = relaxed_order` and `hnsw.ef_search = 100` — [supabase/migrations/20261018120200_retrieval.sql](C:/Pro/geiger-grey/supabase/migrations/20261018120200_retrieval.sql). Grey has its own HTTP embedding drivers (openai, cohere, google, voyage, nomic), which today embed text only — [lib/engine/drivers/embed/nomic.js](C:/Pro/geiger-grey/lib/engine/drivers/embed/nomic.js). Image sources currently fail at ingestion until an OCR service exists — [grey_current_capabilities.md](C:/Pro/geiger-grey/research_notes/Knowledge%20base%20uses%20beyond%20chat/grey_current_capabilities.md).

---

## 1. Multimodal embedding APIs a customer could attach in 2026 (hosted, BYO key)

### Takeaway
At least six hosted APIs now put images and text in one shared vector space, and all of them can be reached with a customer's own key:
- **Gemini Embedding 2:** the broadest (text, image, video, audio, PDF), cheapest per image ($0.00012) and strongest in Google's own benchmark.
- **Voyage multimodal-3.5:** best at document screenshots, with transparent pixel pricing.
- **Cohere Embed 5 Pro / Fast:** 128k context, mixed inputs, 2048-d Matryoshka.
- **Amazon Nova 2 Multimodal Embeddings:** for AWS customers, but weaker in one independent test.
- **Jina v5-omni:** API, plus non-commercial weights.
- **Twelve Labs Marengo 3.x:** for video.

OpenAI still offers no image embeddings. The Vercel AI SDK `embed()` takes strings only; its one multimodal path is Gemini through `providerOptions`. So Grey needs its own format-specific image drivers, which matches how Grey already works.

### Cited Findings

**Google Gemini Embedding 2 (recommended default for Google-key customers)**
- Announced 2026-03-10 as public preview `gemini-embedding-2-preview` on the Gemini API and Vertex AI. It maps text, images, video, audio and PDFs into one space and accepts interleaved inputs, such as image plus text in one request — [Google blog](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-embedding-2/).
- The Gemini API docs list `gemini-embedding-2` as **Stable (latest update April 2026)**, with:
  - Output of 128–3072 dims (default 3072; 768, 1536 or 3072 recommended), and truncated dims auto-normalized.
  - Limits of 8,192 input tokens, 6 images per request (PNG/JPEG), 180 s audio, 120 s video (max 32 frames), and 1 PDF of up to 6 pages (1 page recommended).
  - No `task_type` parameter; text prefixes are used instead.
  - Batch API supported.
  - "The embedding spaces between `gemini-embedding-001` and `gemini-embedding-2` are **incompatible**." `gemini-embedding-001` is text-only.
  - Source: [Gemini API embeddings docs](https://ai.google.dev/gemini-api/docs/embeddings).
- Vertex docs for `gemini-embedding-2`:
  - Up to 6 images per request, max 16384×16384 px per image, in JPEG, PNG, WebP, BMP, HEIC, HEIF or AVIF.
  - 8192 tokens shared across all modalities; longer inputs are "silently truncated".
  - The preview model "and its regional quotas might be deleted in the future" (so **treat `-preview` as deprecated**).
  - Source: [Vertex multimodal embeddings](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/embeddings/get-multimodal-embeddings).
- Pricing (standard / batch, per 1M tokens): text $0.20 / $0.10; **image $0.45, i.e. $0.00012 per image / $0.00006 batch**; audio $0.00016/s; video $0.00079/frame. Free tier for standard input. PDFs are billed at the image token rate — [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing).
- The Gemini Embedding 2 paper reports these scores against Nova MME, Voyage-3.5-mm and multimodalembedding@001 (vendor-authored):

  | Benchmark | Gemini Emb. 2 | Nova MME | Voyage-3.5-mm | multimodalembedding@001 |
  |---|---|---|---|---|
  | MSCOCO text→image R@1 | 62.9 | 57.2 | 58.1 | 53.1 |
  | Flickr30k text→image R@1 | 89.1 | 81.6 | 89.9 | 81.4 |
  | MSCOCO image→text R@1 | 78.8 | 68.3 | 74.5 | 68.2 |
  | ViDoRe V2 nDCG@10 | 64.9 | 60.6 | 65.5 | 28.9 |
  | Overall mean | 77.2 | 68.2 | 70.0 | 64.1 |

  The paper also says Matryoshka (MRL) is "optimized for 768 and 1,536 dimensions" — [arXiv 2605.27295](https://arxiv.org/html/2605.27295v1).
- Independent test on Flickr30k with hard negatives (1,000 queries, 25 candidates): R@1 was Gemini Embedding 2 0.804, GPT-4.1 0.789, Claude Sonnet 4.6 0.796 and **Amazon Nova 2 0.673**. Nova was significantly worse than the other three — [arXiv 2608.11343](https://arxiv.org/html/2608.11343).
- Data use: on the free (unpaid) tier, Google "uses the content you submit… to provide, improve, and develop" products, and "human reviewers may read" inputs. Paid-tier prompts are not used to improve products. Only paid services may serve users in the EEA, Switzerland or UK — [Gemini API terms](https://ai.google.dev/gemini-api/terms).
- **Legacy model `multimodalembedding@001` (Vertex):**
  - Default 1408 dims (128–1408).
  - Images resized to 512×512.
  - Text limited to **32 tokens, English only**.
  - Video intervals from 4 s.
  - Text and image share one space.
  - No deprecation notice was found, but it is clearly superseded (ViDoRe V2 28.9 vs 64.9).
  - Sources: [Vertex docs](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/embeddings/get-multimodal-embeddings); [arXiv 2605.27295](https://arxiv.org/html/2605.27295v1).

**Voyage AI (MongoDB) — `voyage-multimodal-3.5` (current), `voyage-multimodal-3` (older)**
- 3.5 handles interleaved text plus images and video frames ("screenshots of PDFs, slides, tables, figures, videos").
- 32,000-token context; dims 1024 (default), 256, 512 or 2048.
- Images are processed between 50,000 and 2,000,000 pixels: smaller images are upscaled, larger ones downsampled, and billing follows the processed size.
- Pricing: $0.12 per 1M tokens plus $0.60 per 1B pixels. That is **$0.0006 per 1 MP image and $0.0012 per image at ≥2 MP**; a 200×200 image costs $0.00003.
- Free tier: 200M tokens and 150B pixels.
- `voyage-multimodal-3` is 1024-d only and labelled older ("still accessible… we recommend using the new models").
- Source: [MongoDB Voyage models docs](https://www.mongodb.com/docs/voyageai/models/).
- docs.voyageai.com could not be fetched from this environment, so the request format for the multimodal endpoint was not verified.

**Cohere — `embed-v5.0-pro`, `embed-v5.0-fast` (current), `embed-v4.0` (previous), v3 family (legacy)**
- v5 Pro and Fast: text, images and mixed text/image input (e.g. PDFs); 128k context; dims 256, 512, 768, 1024, 1536 or **2048 (default)**.
- v4.0: same inputs, dims 256, 512, 1024 or 1536 (default).
- v3 models accept images but have a 512-token context.
- Source: [Cohere embed models](https://docs.cohere.com/docs/cohere-embed).
- Image limits:
  - PNG, JPEG, WebP or GIF.
  - ≤5 MB on the `images` parameter.
  - The `inputs` path takes a 20 MB payload; images above 2,458,624 px are downsampled and below 56×56 upsampled.
  - Up to 96 images per request for v5 Pro; v3 cannot batch images.
- Output types: float, int8, uint8, binary and ubinary.
- Source: [Cohere embeddings docs](https://docs.cohere.com/docs/embeddings).
- Pricing (unverified, third-party): text $0.12 per 1M tokens and images $0.40 per 1M image tokens for both Pro and Fast. Embed 4 was reportedly $0.47 per 1M image tokens. No per-image token count is documented — [eesel.ai](https://www.eesel.ai/blog/cohere-embed-5-pricing); [developersdigest](https://www.developersdigest.tech/models/embeddings/cohere-embed-v5-0-pro). One aggregator lists $0.50 per 1M image tokens instead — [cloudprice](https://cloudprice.net/models/cohere-embed-5-pro-image).
- A headline reports that Pro and Fast share one embedding space — [digg](https://digg.com/ai/grs9ko2c). This was not checked against first-party docs.
- Cohere's pricing page shows only dedicated "Model Vault" instances: Embed 5 Pro or Fast, Small at $3/hr ($2,000/month) and Medium at $5/hr. Cohere supports "private deployment of all our products" at custom pricing — [Cohere pricing](https://cohere.com/pricing).

**Amazon — Nova 2 Multimodal Embeddings (current), Titan Multimodal Embeddings G1 (legacy)**
- Nova MME (`amazon.nova-2-multimodal-embeddings-v1:0`):
  - Text, image, document image, video and audio in one space.
  - Max context of 8K tokens or 30 s of video or audio. Async API segmentation handles longer files.
  - Dims 3072, 1024, 384 or 256.
  - `embeddingPurpose` values such as `GENERIC_INDEX`.
  - Input as an S3 URI or inline base64. The async API writes output to S3.
  - Source: [AWS Nova embeddings guide](https://docs.aws.amazon.com/nova/latest/userguide/nova-embeddings.md).
- Nova pricing (unverified, third-party): $0.135 per 1M input tokens, **about $0.00006 per image**, about $0.0006 per document image, and roughly half price on batch. One calculator says $0.0001 per image — [developersdigest](https://www.developersdigest.tech/models/embeddings/amazon-nova-multimodal-embeddings); [Maxim Bifrost](https://www.getmaxim.ai/bifrost/llm-cost-calculator/provider/bedrock/model/amazon.nova-2-multimodal-embeddings-v1-0).
- Titan Multimodal G1 (`amazon.titan-embed-image-v1`):
  - 256 text tokens, English only.
  - Images up to 25 MB and 2048×2048.
  - Output of 1024, 384 or 256 dims; fine-tunable.
  - No deprecation notice on its page, but it is superseded by Nova.
  - Source: [AWS Titan MM docs](https://docs.aws.amazon.com/bedrock/latest/userguide/titan-multiemb-models.html).

**Jina AI (Elastic) — `jina-embeddings-v5-omni-small` / `-nano` (May 2026), `jina-embeddings-v4` (2025)**
- v5-omni covers text, image, audio, video and PDF.
- Small: 1024-d, Matryoshka down to 32, 32K context. Nano: 768-d, 8K context.
- Text embeddings are "byte-for-byte" identical to `jina-embeddings-v5-text`, so v5-text indexes need no rebuild.
- Weights are **CC BY-NC 4.0** (non-commercial).
- The API is at `api.jina.ai/v1/embeddings` and takes images as base64 data URIs. Also available on Elastic Inference Service.
- Vendor benchmarks: ViDoRe-in-MIEB 79.25 (Nemotron-3B scores 85.64), MIEB image overall 58.00, and video is the weak spot.
- Source: [Jina v5-omni announcement](https://jina.ai/news/jina-embeddings-v5-omni-multimodal-embeddings-for-text-image-audio-and-video).
- jina-embeddings-v4:
  - Built on Qwen2.5-VL-3B (about 4B parameters).
  - Single-vector 2048-d (Matryoshka down to 128) plus a multi-vector late-interaction mode at 128-d per token.
  - 32,768-token context.
  - License: Qwen Research License (first released under CC-BY-NC "due to an error").
  - Served by the Jina API, Transformers and vLLM (merged-adapter variants).
  - Source: [HF model card](https://huggingface.co/jinaai/jina-embeddings-v4).

**Nomic (Grey already has a native Nomic text driver)**
- Endpoint: `POST https://api-atlas.nomic.ai/v1/embedding/image` with models `nomic-embed-vision-v1` and `-v1.5`. Input is image files/bytes or URLs (multipart form) in PNG, JPEG or WebP — [Nomic API reference](https://docs.nomic.ai/reference/api/embed-image-v-1-embedding-image-post).
- `nomic-embed-vision-v1.5`:
  - "shares the same embedding space as nomic-embed-text-v1.5", with the `search_query:` prefix used for text queries.
  - 92.9M params, Apache-2.0.
  - ImageNet zero-shot 71.0.
  - Source: [HF card](https://huggingface.co/nomic-ai/nomic-embed-vision-v1.5).
- Nomic Embed Multimodal (April 2025):
  - 3B and 7B sizes, in single-vector and multi-vector (ColNomic) variants, built on Qwen2.5-VL.
  - ColNomic 7B scores 62.7 nDCG@5 on ViDoRe-v2.
  - 7B is Apache 2.0.
  - Source: [Nomic announcement](https://nomic.ai/news/nomic-embed-multimodal); [HF card](https://huggingface.co/nomic-ai/colnomic-embed-multimodal-7b).

**Twelve Labs Marengo (video-first)**
- The docs list Marengo 3.5 (video, audio, images, text, documents) and 3.0. Marengo 2.7 is no longer listed — [Twelve Labs Marengo](https://docs.twelvelabs.io/docs/concepts/models/marengo).
- Marengo 3.0:
  - **512-d** embeddings; text up to 500 tokens (was 77).
  - Video from 4 s to 4 h (≤4 GB, 360×360 to 5184×2160).
  - Images JPEG or PNG, at least 128×128 and ≤32 MB.
  - Audio up to 4 h.
  - "any-to-any search" and composed text-plus-image queries.
  - Source: [Marengo 3.0](https://docs.twelvelabs.io/v1.3/docs/concepts/models/marengo/marengo-3-0).

**OpenAI and Mistral**
- OpenAI's embeddings guide lists only `text-embedding-3-small` (1536), `text-embedding-3-large` (3072) and `text-embedding-ada-002`. All are text only: "OpenAI's text embeddings measure the relatedness of text strings" — [OpenAI embeddings guide](https://developers.openai.com/api/docs/guides/embeddings).
- **OpenAI has no image embedding API.** Its image capability is vision input on chat models — [OpenAI vision guide](https://developers.openai.com/api/docs/guides/images-vision).
- The AI SDK provider table lists only `mistral-embed` (1024) for Mistral — [AI SDK embeddings](https://ai-sdk.dev/docs/ai-sdk-core/embeddings).

**Others found (lower confidence)**
- Alibaba Cloud Model Studio `qwen3-vl-embedding` API: fused text, image and video embeddings with dims 256–2560, per search-result summary — [Alibaba docs](https://www.alibabacloud.com/help/en/model-studio/multimodal-embedding-api-reference).
- Google EmbeddingGemma 2: about 740M parameters, Apache-2.0, covers text, image, video and audio, announced October 2026 for on-device use, per search-result summary — [Google Developers Blog](https://developers.googleblog.com/google-ai-edge-with-embeddinggemma-2/).

**Vercel AI SDK reachability**
- `embed` and `embedMany` take plain strings (`value` / `values`).
- The only multimodal path is Google `gemini-embedding-2` / `-preview`, which "supports multimodal embedding content through `providerOptions.google.content`" (text, inline data or file parts; `fileUri` accepts HTTP or GCS URLs).
- The AI SDK Cohere provider lists only v2/v3 text models, and Bedrock lists only Titan text models.
- The page does not mention OpenAI-compatible embedding providers, Voyage or Jina.
- Source: [AI SDK embeddings](https://ai-sdk.dev/docs/ai-sdk-core/embeddings).

### Inferences
- Grey should not route image embeddings through the AI SDK. It should extend its own drivers in `lib/engine/drivers/embed/` with an `embedImages`/`embedParts` call per wire format:
  - Google `parts`
  - Voyage multimodal `inputs`
  - Cohere v2 `inputs`/`images` (base64 data URIs)
  - Bedrock Nova `InvokeModel` (needs the customer's AWS credentials and SigV4 signing)
  - Jina `/v1/embeddings` with data URIs
  - Nomic `/embedding/image` multipart
  - vLLM `messages` (see §2)
- Per-image embedding cost for 1M images:

  | Provider | Cost per 1M images |
  |---|---|
  | Gemini Embedding 2 | about $120 (about $60 on batch) |
  | Nova MME | about $60 (unverified) |
  | Voyage 3.5, at about 1 MP | about $600 |
  | Voyage 3.5, at ≥2 MP | about $1,200 |
  | Cohere | not computable without a documented tokens-per-image figure |

  Pre-resizing to about 1 MP cuts Voyage cost in half compared with ≥2 MP uploads.
- Dimension fit with Grey's existing partial HNSW indexes (256/384/512/768/1024/1536/2048/3072):
  - Fit: Gemini (3072/1536/768), Voyage (256/512/1024/2048), Cohere v5 (all its sizes), Nova (all four), Titan, Jina omni (1024/768), Nomic vision (768), Marengo (512).
  - Do not fit at their defaults: multimodalembedding@001 (default 1408) and SigLIP 2 So400m (1152). They need an extra partial index or a supported smaller size.
- Only Gemini, Voyage, Cohere, Nova, Jina and Twelve Labs give a true shared text–image space through an API. That shared space is what lets a stored image be found by a text query and vice versa, so a "text query finds images" feature is limited to customers holding one of those keys (or self-hosting, see §2). An OpenAI-only or Anthropic-only customer cannot get native image embeddings at all; they must caption-then-embed (§3).

### Gaps
- First-party Bedrock pricing for Nova MME, and Cohere's tokens-per-image formula and per-image price, could not be verified (the pricing pages did not list them).
- Voyage request format and data-retention or training opt-out terms were not fetched (docs.voyageai.com was blocked).
- Twelve Labs pricing, Bedrock availability and Marengo 3.5 dims were not found.
- No first-party confirmation that Mistral lacks a multimodal embedding model; the evidence is that only `mistral-embed` appears in the AI SDK table.

---

## 2. Self-hosted and open models, and how they can be served

### Takeaway
Open models now cover every need:
- **SigLIP 2 or CLIP** for cheap joint image–text vectors.
- **DINOv3** for pure visual (instance) similarity, with no text alignment.
- **Qwen3-VL-Embedding** (Apache 2.0, MMEB-V2 77.8) as the strongest open general multimodal embedder.
- **ColPali, ColQwen, ColNomic or Nemotron ColEmbed** for document pages.

Serving matters as much as the model. **vLLM** is the realistic "OpenAI-compatible" self-host path for image embeddings, through a non-standard `messages` field on `/v1/embeddings` or a Cohere-compatible `/v2/embed`. **Infinity** serves CLIP, SigLIP and ColPali. **Hugging Face TEI and Ollama embed text only.** Every one of these means *the customer* hosts a GPU endpoint; Grey would host nothing.

### Cited Findings
- **SigLIP 2** (Feb 2025):
  - Multilingual vision–language encoders in Base (86M), Large (303M), So400m and Giant (1B), at resolutions from 224 to 512.
  - A NaFlex dynamic-resolution variant for aspect-ratio-sensitive tasks.
  - `siglip2-so400m-patch14-384` image features are 1152-d.
  - The blog claims it beats SigLIP "at all model scales" on zero-shot classification and image–text retrieval but gives no numbers in text, and it does not state a license.
  - Source: [HF SigLIP 2 blog](https://huggingface.co/blog/siglip2).
- **DINOv3** (Meta):
  - 12 models: ViT-S/S+/B/L/H+/7B and ConvNeXt variants, with web and satellite pretraining.
  - ViT dims: S 384, B 768, L 1024, H+ 1280, 7B 4096.
  - Vision-only (no text encoder).
  - Recommended uses include "image retrieval with nearest neighbors" and "k-NN classification on the class token".
  - ViT-L scores Oxford-Hard 63.1 and IN-ReaL 90.2.
  - **Custom "DINOv3 License", gated on HF**; commercial terms are not stated on the card.
  - Source: [HF DINOv3 ViT-L card](https://huggingface.co/facebook/dinov3-vitl16-pretrain-lvd1689m).
- DINOv3 versus SigLIP for instance-level matching, from the Patch-wise Retrieval paper on mini-ILIAS (from a search-result summary of the PDF, not independently read):
  - Global descriptor: DINOv3 0.2180 mAP@1k vs SigLIP 0.2041.
  - Patch level: DINOv3 0.4298 vs 0.4048 for a linearly adapted SigLIP.
  - Source: [arXiv 2512.12610](https://arxiv.org/pdf/2512.12610).
- SigLIP 2 scores 89.1% on ImageNet classification against PE-Core 89.3%, where DINOv3 trailed — [The Batch](https://www.deeplearning.ai/the-batch/metas-dinov3-gets-an-updated-loss-term-and-improved-vision-performance) (via search summary).
- **Qwen3-VL-Embedding:**
  - 2B (up to 2048-d) and 8B (up to 4096-d), both with user-defined dims from 64 upward (Matryoshka) and 32K sequence length.
  - MMEB-V2 overall 77.8 (8B, ranked first at release) and 73.2 (2B).
  - Apache 2.0 per community sources (license not confirmed on the HF card in results).
  - Sources: [HF Qwen3-VL-Embedding-8B](https://huggingface.co/Qwen/Qwen3-VL-Embedding-8B); [arXiv 2601.04720](https://arxiv.org/abs/2601.04720v1).
- **ColPali** (late interaction):
  - PaliGemma-3B (SigLIP-So400m plus Gemma 2B), giving about 1030 vectors per page (1024 patches + 6) at 128-d.
  - **257.5 KB per page in fp16**, against 8.60 KB for BGE-M3.
  - Indexing takes **0.39 s per page vs 7.22 s** for an Unstructured layout + OCR + captioning pipeline.
  - ViDoRe v1 nDCG@5 of **81.3 vs 67.0** for the best text pipeline (Unstructured + captioning + BGE-M3), against 51.4 for single-vector SigLIP and 58.8 for single-vector BiPali.
  - Token pooling with factor 3 cuts vectors by 66.7% and keeps 97.8% of performance.
  - Source: [ColPali paper](https://arxiv.org/html/2407.01449).
- **ViDoRe V3** (ACL 2026):
  - 10 enterprise corpora, 26K pages, 3,099 queries in 6 languages.
  - English nDCG@10 leaders: nemo-colembed-3b 0.656, nemo-colembed-1b 0.643, jina-v4 0.639.
  - Late interaction beats dense: colnomic-7b 0.630 vs nomic-7b dense 0.573.
  - Multilingual scores drop 3–5 points.
  - Source: [HF ViDoRe V3 blog](https://huggingface.co/blog/QuentinJG/introducing-vidore-v3).
- ViDoRe V3 paper findings:
  - Visual retrievers beat textual ones at equal parameter count.
  - Textual rerankers help much more than visual rerankers.
  - Visual grounding lags human agreement widely.
  - Source: [ACL 2026 paper](https://aclanthology.org/2026.acl-long.755.pdf) (via search summary).
- A vendor claims its VultronRetriever leads ViDoRe V3 as of July 2026 (unverified) — [Vultr blog](https://blogs.vultr.com/vidore-v3).
- **vLLM:**
  - On the OpenAI-compatible `/v1/embeddings` endpoint, "You can pass multi-modal inputs to embedding models by defining a custom chat template". The request sends a `messages` list with `{"type":"image_url"}` parts, run with `--runner pooling`. This is not in the OpenAI client schema.
  - The Cohere-compatible `/v2/embed` takes `images` as base64 data URIs, or `inputs` for mixed content.
  - Listed multimodal embedders: CLIP, SigLIP/SigLIP2, VLM2Vec, Qwen3-VL-Embedding-2B, `nvidia/llama-nemotron-embed-vl-1b-v2`, E5-V and DSE-Qwen2.
  - Matryoshka `dimensions` is supported only for MRL-trained models.
  - Source: [vLLM embed docs](https://docs.vllm.ai/en/latest/models/pooling_models/embed/).
- vLLM pooling also supports token-wise `token_embed` with late-interaction (MaxSim) scoring — [vLLM pooling models](https://docs.vllm.ai/en/latest/models/pooling_models.html).
- **Infinity** serves CLIP models ("able to encode images and text at the same time"), SigLIP (`google/siglip-so400m-patch14-384`), jina-clip, ColPali/ColQwen and CLAP audio. "Plain vision models are not supported." Images are passed as URLs; the API is "OpenAPI aligned". The last dated news entry is from 2025-07, so maintenance is uncertain — [Infinity README](https://github.com/michaelfeil/infinity).
- **HF TEI** supports text architectures only (BERT, Nomic, JinaBERT, GTE, Qwen2/3, ModernBERT, Gemma3…), with no CLIP, SigLIP or ColPali — [TEI README](https://github.com/huggingface/text-embeddings-inference).
- **Ollama** `/api/embed` documents only "text embeddings", with no mention of images — [Ollama embeddings docs](https://docs.ollama.com/capabilities/embeddings).
- Practitioner evidence:
  - CLIP plus pgvector powers small production image-search sites: FlatHawk (150k+ property photos) and inkdex.io (tattoo search) — [HN FlatHawk](https://news.ycombinator.com/item?id=48556886); [HN inkdex](https://news.ycombinator.com/item?id=46663280).
  - ColiVara stores page-image multi-vectors in pgvector and scores in Postgres — [HN ColiVara](https://news.ycombinator.com/item?id=42158351).

### Inferences
- For a BYO self-host story, Grey only needs two new driver formats to cover nearly all open models: "vLLM OpenAI + `messages`" and "Cohere v2 `/v2/embed`" (which vLLM also speaks). Infinity is a third option for CLIP, SigLIP and ColPali.
- Triton was not researched. It is a generic inference server and would need a customer-written HTTP shim.
- DINOv3 is the best choice when "similar" means visually the same object or product (instance retrieval). It cannot answer text queries, so it is a secondary vector next to a joint text–image vector, not a replacement for one.
- Qwen3-VL-Embedding-8B at 4096-d exceeds pgvector's 4,000-dim halfvec HNSW limit (§6) and must be truncated with MRL, for example to 2048 or 3072.
- ColPali-style multi-vector at about 257 KB per page means 1M pages is about 257 GB of vectors. pgvector has no native MaxSim index, so late interaction is not a near-term fit for Grey's Postgres-only design (§6).

### Gaps
- No direct SigLIP 2 vs DINOv3 instance-retrieval head-to-head was found.
- No first-party SigLIP 2 license confirmation was found on the page read (believed Apache 2.0, not verified this session).
- No current Triton or OpenAI-compatible image embedding reference was fetched.
- Ollama's possible future multimodal embedding support is unknown.

---

## 3. Approaches compared: joint embeddings, caption-then-embed, OCR, late interaction, region-level and perceptual hashing

### Takeaway
No single technique wins. Match it to the data:
- **Joint image–text embeddings:** the default for photos and products. Cheapest at query time, about 0.6 s to rank 1,000 queries once vectors exist.
- **Caption-then-embed with a vision LLM:** works with any BYO LLM key. It adds searchable words and is the only route for customers without a multimodal embedding key, but costs a generative call per image.
- **OCR or vision-LLM text extraction plus text embedding:** for screenshots and documents. Visual document retrievers now beat it (81.3 vs 67.0 nDCG@5 for ColPali).
- **Late interaction:** most accurate for document pages, but storage-heavy.
- **Region-level embeddings:** needed to "find something inside an image". Patch-level methods roughly double instance-retrieval mAP over a single global vector.
- **Perceptual hashing:** free and exact enough for near-duplicates.

### Cited Findings
- **Joint embeddings vs a frontier LLM ranker** (Flickr30k with hard negatives, 1,000 queries × 25 candidates):
  - R@1: Gemini Embedding 2 0.804, GPT-4.1 0.789, Claude Sonnet 4.6 0.796 (statistically indistinguishable).
  - Ranking-only latency: **0.66 s total with precomputed embeddings, against 6,100 s for GPT-4.1 and 9,415 s for Claude**.
  - Authors' conclusion: embeddings suit "low-latency applications over a large but fixed set", while LLMs may be preferable when the gallery is small or changes often.
  - Hard negatives were built in caption space, which may favour embeddings.
  - Source: [arXiv 2608.11343](https://arxiv.org/html/2608.11343).
- **Caption-then-embed in practice:** "Indexing iCloud Photos with AI Using LLaVA and Pgvector" got 208 points on HN — [HN story](https://news.ycombinator.com/item?id=39067615); [article](https://medium.com/@mustafaakin/indexing-icloud-photos-with-ai-using-llava-and-pgvector-fd58182febf6). In the thread, a practitioner warned that short caption or classifier output is poor input for sentence embeddings: "pure caption/classification model text output is pretty terrible by comparison" — [HN comment 39090218](https://news.ycombinator.com/item?id=39090218).
- Another practitioner, on CLIP image embeddings for search: "they work incredibly well" — [HN comment 32153917](https://news.ycombinator.com/item?id=32153917).
- **Cost of a caption or OCR call with BYO vision LLMs:**
  - Claude bills `⌈w/28⌉ × ⌈h/28⌉` visual tokens: a 1000×1000 image is 1,296 tokens, and the cap is 1,568 tokens on standard-tier models or 4,784 on high-resolution-tier models (Claude 4.7+).
  - At Haiku 4.5's $1 per 1M input tokens, a 1 MP image is about **$1.30 per 1,000 images**; at Opus 5.5's $4 per 1M it is $5.18 per 1,000 (input only).
  - Source: [Claude vision docs](https://platform.claude.com/docs/en/build-with-claude/vision).
- OpenAI current models (`gpt-6-astra`, `gpt-5.6`) use 32 px patches × a 1.2 multiplier: a 1024×1024 image at `detail: high` is 1,229 tokens, and `low` fits within 512×512 — [OpenAI vision guide](https://developers.openai.com/api/docs/guides/images-vision).
- Gemini bills 258 tokens for an image ≤384 px, and larger images tile at 768×768 with 258 tokens per tile — [Gemini image understanding](https://ai.google.dev/gemini-api/docs/image-understanding).
- Gemini image input prices: 2.5 Flash-Lite $0.10 per 1M tokens, 3.1 Flash-Lite $0.25 per 1M, 2.5 Flash $0.30 per 1M — [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing).
- **OCR/text pipeline vs visual retrieval for documents:**
  - ColPali 81.3 vs best text pipeline 67.0 nDCG@5, with indexing 0.39 s vs 7.22 s per page; the text pipeline's captioning step alone takes 3.71 s per page — [ColPali paper](https://arxiv.org/html/2407.01449).
  - VisRAG (VLM retrieval plus VLM generation on page images) reports a "20–40% end-to-end performance gain over traditional text-based RAG pipeline" — [arXiv 2410.10594](https://arxiv.org/abs/2410.10594).
  - Visual retrievers beat textual ones at equal size on ViDoRe V3 — [ACL 2026](https://aclanthology.org/2026.acl-long.755.pdf).
- **Single-vector document-page embedding is close behind late interaction:** Voyage-3.5-mm 65.5 and Gemini Emb 2 64.9 on ViDoRe V2 nDCG@10 — [arXiv 2605.27295](https://arxiv.org/html/2605.27295v1). That compares with ColNomic-7B at 62.7 nDCG@5 on ViDoRe-v2, a different metric so not directly comparable — [Nomic](https://nomic.ai/news/nomic-embed-multimodal).
- **Region- and object-level ("find something inside the image"):**
  - Patchify splits each database image "into a small number of structured patches" and compares local features to a global query descriptor, with no fine-tuning. It adds Product Quantization for scale and a LocScore metric for whether the retrieved region matches — [arXiv 2512.12610](https://arxiv.org/abs/2512.12610).
  - Patch level roughly doubled mAP@1k against global vectors in that paper's mini-ILIAS table (DINOv3: 0.2180 global → 0.4298 at the finest patch level; search summary) — [PDF](https://arxiv.org/pdf/2512.12610).
- Vision LLMs available under BYO can localize objects:
  - Gemini returns `box_2d` as [ymin, xmin, ymax, xmax] normalized to 0–1000, plus segmentation polygons; "disable thinking" is advised for better results — [Gemini image understanding](https://ai.google.dev/gemini-api/docs/image-understanding).
  - Claude's "coordinate and localization outputs are approximate" — [Claude vision docs](https://platform.claude.com/docs/en/build-with-claude/vision).
  - OpenAI lists precise localization as a weak point — [OpenAI vision guide](https://developers.openai.com/api/docs/guides/images-vision).
- Twelve Labs Marengo 3.0 supports composed text-plus-image queries — [Marengo 3.0](https://docs.twelvelabs.io/v1.3/docs/concepts/models/marengo/marengo-3-0).
- Gemini Embedding 2 accepts interleaved image plus text in one embedding request — [Gemini API docs](https://ai.google.dev/gemini-api/docs/embeddings).
- **Perceptual hashing:**
  - The `imagehash` library supports average, perceptual (pHash), difference (dHash), wavelet, HSV colour and crop-resistant hashing. Hash size is adjustable; the 8×8 default gives a 64-bit (16 hex) hash.
  - Comparison is `hash1 - hash2` (Hamming distance) against a threshold.
  - The structural hashes analyse "luminance (without color information)"; crop resistance needs the dedicated crop-resistant hash.
  - No recommended thresholds are given.
  - Source: [imagehash README](https://github.com/JohannesBuchner/imagehash).
- pgvector indexes the `bit` type with HNSW `bit_hamming_ops`, up to 64,000 dims — [pgvector README](https://github.com/pgvector/pgvector).
- **Video:**
  - A popular Show HN (438 points) embedded raw dashcam video with Gemini Embedding 2 in 30 s chunks with 5 s overlap, at about $2.50–2.84 per hour of footage ($0.00079 per frame at 1 fps), and skipped still chunks to save cost.
  - The author had no similarity threshold, so a query for an absent object ("cybertruck") returned the nearest big truck.
  - A commenter noted that CLIP-style frame averaging "loses temporal information".
  - Source: [HN 47503617](https://news.ycombinator.com/item?id=47503617).

### Inferences
- When each approach wins:

  | Approach | Wins when | Cost / latency |
  |---|---|---|
  | Joint embeddings (Gemini Emb 2, Voyage, Cohere, SigLIP 2) | Photos, products, scenes, "more like this", text→image search | $0.00006–0.0012 per image to index; query = 1 embed call + an ANN lookup in milliseconds |
  | Caption-then-embed (any BYO vision LLM) | Customer has only an OpenAI or Anthropic key; text in captions should be keyword-searchable and shown as an explanation; also makes images visible to Grey's existing hybrid BM25 + vector + knowledge-graph pipeline | About $0.0001–0.005 per image, plus output tokens; seconds per image at ingest; image→image similarity is indirect and loses fine visual detail |
  | OCR or vision-LLM transcription + text embedding | Screenshots, receipts, scanned text where the *words* matter and must also feed chunking and the knowledge graph | Same as captioning; still needed even when visual retrieval is used, for full-text and grounding |
  | Late interaction (ColPali family) | Visually rich PDFs and slides at modest scale | About 257 KB per page; needs a self-hosted model and specialized storage |
  | Region or patch embeddings | "Find this logo, part or product inside larger photos" | Multiplies stored vectors by N regions per image |
  | Perceptual hash (pHash/dHash, 64-bit) | Exact or near-duplicate detection, re-uploads, resized or recompressed copies | No model, CPU-only, microseconds; fails on crops, rotations and semantic similarity |

- "Find something inside" has two directions:
  - **Query is a small object; find stored images that contain it.** This needs region vectors at *index* time: a VLM detector or fixed grid crops, each embedded and stored with a bounding box. This is the expensive direction.
  - **Query image is a big scene; find stored items that appear in it.** Detect regions in the *query* only (one VLM detection call, or a user-drawn crop in the UI), then run N searches. This is cheap.

  Offer the second direction first, and a user crop tool before automatic detection.
- Combining approaches is usually best: store a joint image vector *and* a caption/OCR text chunk per image. Search both (Grey already fuses BM25 and vector results), and use the pHash only for dedupe and exact-match boosts.

### Gaps
- No controlled benchmark was found comparing caption-then-embed retrieval accuracy directly against native image embeddings on photo collections (the 2608.11343 study compared LLM *ranking*, not captions).
- No sourced numbers for open-vocabulary detectors (OWLv2, Grounding DINO) as region proposers.
- No published pHash false-positive rates or thresholds were found.

---

## 4. Image-grounded answering: retrieve by image vector, then ask a vision LLM

### Takeaway
The pattern works with any BYO vision LLM:
1. Embed the query image.
2. Retrieve the top-k stored items through pgvector.
3. Send the query image, k labelled thumbnails and their metadata to GPT, Claude or Gemini, with instructions to cite item IDs.

Evidence that image context helps comes mostly from document RAG (VisRAG +20–40% over text RAG). Input cost is about $0.004–0.02 per query. The main risks are hallucinated grounding and injected instructions inside retrieved images.

### Cited Findings
- VisRAG reports a 20–40% end-to-end gain over text-based RAG by retrieving and generating from page images — [arXiv 2410.10594](https://arxiv.org/abs/2410.10594).
- ViDoRe V3 found visual grounding (pointing to the right region as evidence) lags human agreement by a wide margin, and textual rerankers help more than visual ones — [ACL 2026](https://aclanthology.org/2026.acl-long.755.pdf) (search summary).
- **Multi-image prompts:**
  - Claude accepts up to 600 images per API request (100 for 200k-context models), max 8000×8000 px. Above 20 images per request a stricter per-image size limit applies, so keep each image ≤2000 px per side or use ≤20 images.
  - Max image size is 10 MB, the request limit is 32 MB, and the Files API lets an image be uploaded once and reused by `file_id`.
  - Recommended practice: label images "Image 1:", "Image 2:" so the model can refer to them, and place images before text.
  - Claude "does not parse or receive any metadata from images".
  - Source: [Claude vision docs](https://platform.claude.com/docs/en/build-with-claude/vision).
- OpenAI allows up to 1,500 images and 512 MB per request; "File names and metadata aren't processed" — [OpenAI vision guide](https://developers.openai.com/api/docs/guides/images-vision).
- Gemini allows up to 3,600 image files per request, with inline data counting toward a 20 MB request limit — [Gemini image understanding](https://ai.google.dev/gemini-api/docs/image-understanding).
- Token costs per image:
  - Claude: 1000×1000 = 1,296 tokens; 1920×1080 = 1,560 tokens on standard tier or 2,691 on high-res tier.
  - Example rates in the docs: Haiku 4.5 $1 per 1M input; Opus 5.5 $4 per 1M input.
  - Source: [Claude vision docs](https://platform.claude.com/docs/en/build-with-claude/vision).
  - OpenAI: 1024² at high detail = 1,229 tokens — [OpenAI vision guide](https://developers.openai.com/api/docs/guides/images-vision).
  - Gemini: 258 tokens per ≤384 px image or per 768² tile — [Gemini image understanding](https://ai.google.dev/gemini-api/docs/image-understanding).
- Known vision-LLM limits:
  - Hallucination on low-quality, rotated or <200 px images; approximate counting.
  - Claude will not identify people.
  - Source: [Claude vision docs](https://platform.claude.com/docs/en/build-with-claude/vision).
  - OpenAI misreads rotated images and non-Latin text, and blocks CAPTCHAs — [OpenAI vision guide](https://developers.openai.com/api/docs/guides/images-vision).

### Inferences
- **Worked cost estimate per query** (Claude, input only; derived from the token formula above):

  | Component | Tokens |
  |---|---|
  | Query image at 1 MP | 1,296 |
  | 5 retrieved thumbnails at 512×512 (19×19 = 361 each) | 1,805 |
  | About 1,000 tokens of item metadata | 1,000 |
  | **Total input** | **about 4,100** |

  That is **about $0.004 per query on Haiku 4.5 and about $0.016 on Opus 5.5**, plus output and one query embedding (about $0.00012 on Gemini Embedding 2). Sending thumbnails at 384 px or less keeps Gemini at 258 tokens each.
- Citations:
  - Give each retrieved item a short stable ID ("Image 2 = item `src_123`").
  - Ask for structured output, `{answer, used_item_ids[], confidence}`.
  - Check that every returned ID was in the retrieved set before rendering citations.
  - Report similarity scores next to each citation so users can see weak matches.
- Keep the retrieval threshold separate from the LLM. If the best cosine score falls below a per-model calibrated threshold, answer "no similar stored items" rather than letting the LLM reason over irrelevant neighbours (the SentrySearch "cybertruck → big truck" failure in §3).
- Retrieved stored images and their OCR text are untrusted input to the answering prompt (§7).

### Gaps
- No benchmark was found that measures answer accuracy for *photo* (non-document) retrieval-augmented VQA with retrieved neighbours versus no retrieval.
- No benchmark was found on citation faithfulness for multi-image prompts.
- Output token prices for each LLM were not fetched, so the cost figures cover input only.

---

## 5. Classification by image: kNN voting vs zero-shot labels vs a vision LLM choosing from a list

### Takeaway
k-nearest-neighbour voting over a customer's own labelled examples needs no generative call. It adds classes without retraining, explains itself through the neighbours it found, and reached 79.8% ImageNet top-1 in one study without fine-tuning. Zero-shot text labels (CLIP-style) need a shared text–image space and are weaker on custom labels. A vision LLM choosing from a fixed list is the most flexible and costs about $0.001–0.005 per image. The best design is kNN first, escalating to a vision LLM only when the neighbours disagree.

### Cited Findings
- A kNN classifier over stored features reached "79.8% top-1 accuracy on the ImageNet dataset" with no fine-tuning after pretraining. Its other benefits:
  - New knowledge is added by updating the database, not the model.
  - It "avoids catastrophic forgetting".
  - It is interpretable through the retrieved neighbours.
  - Source: [arXiv 2204.01186](https://arxiv.org/abs/2204.01186).
- DINOv3 recommends "k-NN classification on the class token" with frozen features. ViT-L scores IN-ReaL 90.2 — [HF DINOv3 card](https://huggingface.co/facebook/dinov3-vitl16-pretrain-lvd1689m).
- Zero-shot ImageNet: nomic-embed-vision-v1.5 scores 71.0 — [HF card](https://huggingface.co/nomic-ai/nomic-embed-vision-v1.5).
- SigLIP 2 is positioned for zero-shot classification through text labels using the `pipeline` API — [HF SigLIP 2 blog](https://huggingface.co/blog/siglip2).
- Jina v5-omni-small scores MIEB image classification 68.99 (best baseline 64.30) — [Jina](https://jina.ai/news/jina-embeddings-v5-omni-multimodal-embeddings-for-text-image-audio-and-video).
- Nova MME exposes an `embeddingPurpose` setting covering retrieval, classification and clustering — [AWS Nova guide](https://docs.aws.amazon.com/nova/latest/userguide/nova-embeddings.md).
- In 25-way image ranking, frontier LLMs matched embeddings in accuracy (R@1 about 0.79–0.80) but were thousands of times slower in aggregate (6,100–9,415 s vs 0.66 s per 1,000 queries) — [arXiv 2608.11343](https://arxiv.org/html/2608.11343).
- Vision-LLM cost per image is about $0.0013 for 1 MP on Haiku 4.5 and about $0.005 on Opus 5.5 (input only) — [Claude vision docs](https://platform.claude.com/docs/en/build-with-claude/vision).

### Inferences
- **kNN voting** (for example k=7, similarity-weighted, abstaining below a vote margin): cost is one embed call (about $0.00006–0.0012) and latency is milliseconds. Accuracy grows with labelled examples per class (from roughly 5–20 upward), and Grey's knowledge bases already hold labelled items. It works with *any* image embedding model, including vision-only DINOv3, because no text alignment is needed.
- **Zero-shot labels:** embed the label prompts ("a photo of a {label}") once and compare with the image vector. This is free per class and suits cold start before examples exist. It only works with shared-space models (Gemini, Voyage, Cohere, Nova, Jina, SigLIP/CLIP, Nomic vision) and is fragile with jargon labels.
- **Vision LLM picks from options:** constrained JSON output (enum) costs about $0.001–0.005 per image and takes seconds. It is best for subjective or compound labels and for explanations. Accuracy improves if the k neighbours and their labels are passed as few-shot examples, which combines this with §4.
- **Recommended cascade:**
  1. Run kNN.
  2. If the top label's weighted vote share is below a threshold, or the top similarity is below a floor, call the BYO vision LLM with the neighbours as examples.
  3. Store the LLM's decision as a new labelled example (with human review), so the kNN covers more cases over time.

### Gaps
- No head-to-head benchmark was found of kNN-over-embeddings vs vision-LLM multiple-choice classification on the same custom-label dataset.
- Zero-shot accuracies for Gemini Emb 2, Voyage and Cohere on ImageNet-style tasks were not found.

---

## 6. pgvector specifics for image vectors at 100K–10M scale

### Takeaway
pgvector 0.8.7 (2026-10-01) is enough for image search up to the low millions of vectors per Supabase instance:
- halfvec indexes up to **4,000 dims**, enough for every hosted model's vectors, and well above the 2,000-dim limit for full-precision `vector`.
- Iterative scans (0.8.0+) fix filtered top-k recall.
- Partial expression indexes per dimension, which Grey already has, let several models share one table.

Pressure points start around 1–10M vectors per index: RAM (Supabase needs 32 GB for 1M 1536-d vectors at 0.99 recall), build time, and per-tenant filtering. Before moving to a dedicated vector database, use binary quantization with re-ranking, smaller Matryoshka dimensions, or partitioning.

### Cited Findings
- **Versions and features:**
  - Latest pgvector is 0.8.7 (2026-10-01); 0.9.0 is unreleased (drops PG13/14).
  - 0.6.0 added parallel HNSW builds.
  - 0.7.0 added `halfvec`, `sparsevec`, `bit` indexing and `binary_quantize`.
  - 0.8.0 (2024-10-30) added iterative index scans and better filter cost estimation.
  - Several 2026 point releases fix HNSW vacuum corruption (0.8.3) and "hnsw graph not repaired" errors (0.8.4).
  - Source: [pgvector CHANGELOG](https://raw.githubusercontent.com/pgvector/pgvector/master/CHANGELOG.md).
- **Limits:**
  - `vector` stores up to 16,000 dims but indexes up to 2,000.
  - `halfvec` stores up to 16,000 dims and **indexes up to 4,000**.
  - `bit` indexes up to 64,000 dims.
  - Storage is 2 × dims + 8 bytes for halfvec and 4 × dims + 8 for vector.
  - Source: [pgvector README](https://github.com/pgvector/pgvector).
- **Filtering:**
  - Filters apply after the index scan: "If a condition matches 10% of rows, with HNSW and the default `hnsw.ef_search` of 40, only 4 rows will match on average."
  - Iterative scans (`hnsw.iterative_scan = strict_order | relaxed_order`) continue until `hnsw.max_scan_tuples` (default 20,000), with memory set by `hnsw.scan_mem_multiplier`.
  - "For few distinct filter values, use partial indexes. For many, use partitioning."
  - Source: [pgvector README](https://github.com/pgvector/pgvector).
- **Mixing models:** expression plus partial indexes, for example `CREATE INDEX ... USING hnsw ((embedding::vector(3)) vector_l2_ops) WHERE (model_id = 123)`, queried with the same cast — [pgvector README](https://github.com/pgvector/pgvector).
- **Build:**
  - "Indexes build significantly faster when the graph fits into `maintenance_work_mem`" (example: 8GB).
  - Use `max_parallel_maintenance_workers` (default 2; example 7).
  - Binary quantization plus re-ranking is the recommended way "to keep indexes in-memory at scale".
  - Source: [pgvector README](https://github.com/pgvector/pgvector).
- Crunchy Data: over 1M rows "can take 6 minutes to build some of the simplest of indexes", the index for 1M rows of embeddings "can be 8GB or larger", and the index should fit in memory — [Crunchy Data](https://www.crunchydata.com/blog/hnsw-indexes-with-postgres-and-pgvector).
- An anecdotal pgvector issue reports a build of about 40M rows per partition stalling for more than 8 hours with 40 GB of `maintenance_work_mem` and 11 workers. The same source estimates a 10M × 1536-d index at about 200–250 GB (secondary source; treat as rough) — [selfhost.dev](https://www.selfhost.dev/blog/pgvector-in-production-2026-critiques-failures/); [particula.tech](https://particula.tech/blog/pgvector-hnsw-tuning-millions-rows-production) (via search summary).
- **Supabase sizing (HNSW, accuracy 0.99):**
  - 1536-d: Micro (1 GB) 15K vectors; Medium (4 GB) 100K; Large (8 GB) 224K; XL (16 GB) 500K; **2XL (32 GB) 1M at 560 QPS**.
  - 384-d: Large (8 GB) holds 1M.
  - Raising m to 32 and ef_construction to 80 on 4XL lifts 1536-d QPS to 1,280.
  - Supabase advises benchmarking and "spread your workload across multiple databases" beyond that.
  - Source: [Supabase compute add-on guide](https://supabase.com/docs/guides/ai/choosing-compute-addon).
- **pgvectorscale (Timescale)** adds StreamingDiskANN, Statistical Binary Quantization and label-based filtered search through `smallint[]` labels. It claims 28× lower p95 latency than Pinecone s1 at 99% recall on 50M 768-d vectors. The README mentions only Timescale Cloud as a managed host, not Supabase — [pgvectorscale README](https://github.com/timescale/pgvectorscale).
- Grey's current schema uses one halfvec column with no fixed dimension, partial HNSW indexes per dimension 256–3072 (m 16, ef_construction 64), and iterative scans on at query time with ef_search 100 — [Grey migration](C:/Pro/geiger-grey/supabase/migrations/20261018120200_retrieval.sql).

### Inferences
- **Storage arithmetic for halfvec:**

  | Dims | Bytes per vector | 1M images | 10M images |
  |---|---|---|---|
  | 768 | 1,544 | 1.5 GB | 15 GB |
  | 1024 | 2,056 | 2.1 GB | 21 GB |
  | 3072 | 6,152 | 6.2 GB | 62 GB |

  HNSW graph overhead comes on top. **For images, use 768 or 1024 dims (Matryoshka) rather than 3072.** Gemini says 768 and 1536 are its MRL sweet spots, so 768 is a good default.
- At about 1M vectors per dimension index, Supabase 2XL-class RAM is needed for 1536-d at high recall. Halving to 768-d halfvec cuts memory about fourfold against 1536-d float `vector`, which keeps 1–3M images on mid-size compute. At 10M, use `binary_quantize(...)::bit(n)` HNSW plus re-ranking on halfvec, or split databases.
- **Mixing models:** today's partial indexes are per *dimension*, so two models that both output 1024-d share one HNSW graph. A filtered query for model A then wastes candidates on model B's vectors, and the iterative scan's 20,000-tuple cap can return too few rows for a small project in a large shared index. Options:
  - Partial indexes keyed on `(embedding_model_id, dims)` for heavily used models.
  - LIST partitioning by embedding model or tenant tier.
  - For small knowledge bases (tens of thousands of vectors), an exact scan filtered by project. This is fast enough and has perfect recall, and the planner will pick it when the filter is selective.
- **Separate image vectors from text-chunk vectors** (a new `grey.media_embeddings` table, or a `modality` column plus partial indexes). Image and text embeddings from the same model live in one space, but mixing them in one index skews text-only RAG results.
- **When to leave pgvector:**
  - Sustained more than 10M vectors per model index.
  - Index rebuilds that exceed maintenance windows.
  - Heavy multi-tenant filtering that iterative scans cannot satisfy.
  - Late-interaction multi-vector retrieval (ColPali MaxSim has no pgvector index).

  pgvectorscale is the Postgres-native next step but is not on Supabase per its README. After that comes a dedicated store (Qdrant, Vespa, Turbopuffer, etc.), which is out of scope here.

### Gaps
- No controlled build-time benchmark at 1M–10M halfvec vectors was found (search budget exhausted).
- Supabase docs do not mention halfvec sizing.
- Whether Supabase offers pgvectorscale was not confirmed.

---

## 7. Pitfalls

### Takeaway
The biggest risks:
- **Lock-in and re-embedding:** vectors are incompatible across providers, and even across generations from one provider (Gemini 001 → 2).
- **Silent preprocessing differences:** EXIF rotation, resizing, provider-side downsampling.
- **Privacy:** images go to third-party APIs, and free tiers may be used for training.
- **Prompt injection hidden in image pixels.** This can't be fully mitigated, only contained.

### Cited Findings
- **Incompatibility:** "The embedding spaces between `gemini-embedding-001` and `gemini-embedding-2` are **incompatible**" — [Gemini API docs](https://ai.google.dev/gemini-api/docs/embeddings). The notable exception is Jina v5-omni, whose text vectors are "byte-for-byte" equal to v5-text's, so no reindex is needed when adding media — [Jina](https://jina.ai/news/jina-embeddings-v5-omni-multimodal-embeddings-for-text-image-audio-and-video).
- **Deprecation churn:**
  - `gemini-embedding-2-preview` "might be deleted in the future" — [Vertex docs](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/embeddings/get-multimodal-embeddings).
  - `voyage-multimodal-3` is "older… we recommend using the new models" — [MongoDB Voyage docs](https://www.mongodb.com/docs/voyageai/models/).
  - Marengo 2.7 no longer appears in Twelve Labs' model list — [Twelve Labs](https://docs.twelvelabs.io/docs/concepts/models/marengo).
- **Matryoshka:** Gemini Embedding 2 auto-normalizes truncated dims, while `gemini-embedding-001` needs manual normalization for non-3072 dims — [Gemini API docs](https://ai.google.dev/gemini-api/docs/embeddings). vLLM rejects `dimensions` for non-MRL models — [vLLM](https://docs.vllm.ai/en/latest/models/pooling_models/embed/).
- **Preprocessing:**
  - Provider-side resizing differs. Voyage clamps to 50K–2M px — [Voyage](https://www.mongodb.com/docs/voyageai/models/). Cohere downsamples above 2,458,624 px — [Cohere](https://docs.cohere.com/docs/embeddings). multimodalembedding@001 resizes to 512×512 — [Vertex](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/embeddings/get-multimodal-embeddings). Claude caps the long edge at 1568 px (standard) or 2576 px (high-res) — [Claude](https://platform.claude.com/docs/en/build-with-claude/vision).
  - Gemini text input beyond 8,192 tokens is "silently truncated" — [Vertex](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/embeddings/get-multimodal-embeddings).
  - Per-request caps: Gemini Embedding 2 allows only 6 images per request; Cohere v5 allows 96 — [Gemini](https://ai.google.dev/gemini-api/docs/embeddings); [Cohere](https://docs.cohere.com/docs/embeddings).
  - Accepted formats differ: Gemini API takes PNG/JPEG for embeddings, while Vertex also takes WebP, HEIC and AVIF; Nomic takes PNG, JPEG and WebP; Titan and Marengo take PNG and JPEG.
- **EXIF orientation:**
  - sharp `autoOrient()` will "Auto-orient based on the EXIF `Orientation` tag, then remove the tag"; `rotate()` with no angle does the same; "Only the EXIF `Orientation` tag is considered" (not XMP) — [sharp docs](https://sharp.pixelplumbing.com/api-operation/).
  - Vision LLMs do not read metadata (Claude), and they misread rotated images (OpenAI, Claude). Gemini advises verifying rotation.
  - Sources: [Claude](https://platform.claude.com/docs/en/build-with-claude/vision); [OpenAI](https://developers.openai.com/api/docs/guides/images-vision); [Gemini](https://ai.google.dev/gemini-api/docs/image-understanding).
- **Privacy:**
  - Gemini free-tier content is used to improve products and may be read by human reviewers; "Do not submit sensitive, confidential, or personal information to the Unpaid Services". Paid-tier content is not used, and EEA/CH/UK users must use paid services — [Gemini API terms](https://ai.google.dev/gemini-api/terms).
  - Anthropic says image uploads "are ephemeral and not stored beyond the duration of the API request" and are not used for training — [Claude vision docs](https://platform.claude.com/docs/en/build-with-claude/vision).
  - HN commenters on SentrySearch flagged that footage is still sent to Gemini even though vectors are local, and raised surveillance concerns — [HN 47503617](https://news.ycombinator.com/item?id=47503617).
- **Prompt injection in images:**
  - Demonstrated against GPT-4V with visible text ("say hello"), **near-invisible off-white text** on a white image, and **exfiltration** by making the model emit a Markdown image URL containing the encoded conversation. Willison: "Large Language Models are gullible", and there is no reliable fix — [Simon Willison](https://simonwillison.net/2023/Oct/14/multi-modal-prompt-injection/).
  - OWASP LLM01 Scenario #7 covers "hiding instructions in images that accompany benign text". It recommends segregating untrusted content, least privilege, human approval for risky actions, and adversarial testing, and notes multimodal defences are an open research area — [OWASP LLM01](https://genai.owasp.org/llmrisk/llm01-prompt-injection/).
  - CLIP's own authors studied "typographical adversarial attacks", where text in an image drives the classification — [Distill multimodal neurons](https://distill.pub/2021/multimodal-neurons/). Text inside an image can therefore skew *embedding* similarity too, not just LLM answers.
- **No-match behaviour:** nearest-neighbour search always returns something; without a threshold, a query for an absent object returns the closest look-alike — [HN 47503617](https://news.ycombinator.com/item?id=47503617).

### Inferences
- **Lock-in mitigations for Grey:**
  - Always keep the original image in storage (Grey already stores `storage_path` and `content_hash`), so re-embedding is a background job, not data loss.
  - Store `embedding_model_id`, `dims` and `preprocess_version` on every vector row.
  - On a provider switch, dual-write and backfill into a new partial index, then cut over per knowledge base.
  - Show the customer a re-embed estimate using §1 prices: 1M images is about $60–120 on Gemini or Nova, and about $600–1,200 on Voyage.
  - Similarity thresholds must be calibrated *per model*, because cosine score ranges differ.
- **Preprocessing pipeline (worker, sharp):**
  1. Auto-orient.
  2. Convert HEIC/AVIF/TIFF to JPEG or WebP.
  3. Strip EXIF/GPS for privacy before sending to any third party.
  4. Resize to about 1–1.5 MP long-edge-capped, one canonical derivative reused for embedding, captioning and LLM thumbnails.
  5. Keep a 384–512 px thumbnail for answer prompts.

  This keeps vectors reproducible across re-embeds and caps per-image API cost.
- **Injection containment:**
  - Treat OCR text, captions and retrieved images as untrusted data in prompts, with clear delimiters.
  - Never auto-render Markdown images or links produced from image-derived content.
  - Give image-answering tools no write or exfiltration tools.
  - Run a cheap "does this image contain instructions aimed at an AI?" check at ingest, using the same BYO vision call that produces the caption, and flag hits.
- **Privacy setting:** expose a per-knowledge-base "send images to provider X" disclosure. Steer customers on Gemini to paid keys. Offer pHash-only and self-hosted (vLLM) modes for sensitive tenants.

### Gaps
- No quantitative attack-success rates for image prompt injection against 2026 models were gathered (the search budget ran out).
- Voyage, Cohere, Jina and Nomic data-retention and training terms were not fetched.

---

## 8. Recommended technical approach for Grey

### Takeaway
Ship image search in three layers, all BYO and all on the existing Postgres:
1. **Always-on, model-free:** content hash plus pHash dedupe.
2. **Default semantic layer:** one joint image–text embedding per image from the customer's attached multimodal embedding provider. Gemini Embedding 2 at 768-d first, then Voyage multimodal-3.5, Cohere Embed 5, Nova MME, Jina omni and Nomic vision. Store it in a separate media-embedding table with Grey's per-dimension partial halfvec HNSW pattern.
3. **Text layer:** a BYO vision-LLM caption plus OCR chunk per image, feeding Grey's existing hybrid text retrieval and knowledge graph.

On top of these: kNN classification, region search from a query-side crop, and image-grounded answers with cited item IDs through the customer's vision LLM. Defer late interaction (ColPali) and automatic index-side region embeddings. Grey hosts no model at any point. Self-hosted models come in only as customer-run vLLM or Infinity endpoints.

### Cited Findings
- Gemini Embedding 2 has the broadest modalities, $0.00012 per image, 768/1536 as MRL sweet spots, a stable `gemini-embedding-2` ID, and AI SDK `providerOptions.google.content` support — [Gemini docs](https://ai.google.dev/gemini-api/docs/embeddings); [pricing](https://ai.google.dev/gemini-api/docs/pricing); [paper](https://arxiv.org/html/2605.27295v1); [AI SDK](https://ai-sdk.dev/docs/ai-sdk-core/embeddings).
- Joint embeddings match frontier LLM rankers in accuracy at a tiny fraction of the latency — [arXiv 2608.11343](https://arxiv.org/html/2608.11343).
- Visual document retrieval beats OCR text pipelines — [ColPali](https://arxiv.org/html/2407.01449); [VisRAG](https://arxiv.org/abs/2410.10594).
- halfvec HNSW indexes up to 4,000 dims; partial expression indexes support multiple models; iterative scans exist for filtering; binary quantization with re-ranking handles scale — [pgvector README](https://github.com/pgvector/pgvector).
- Supabase RAM sizing — [Supabase](https://supabase.com/docs/guides/ai/choosing-compute-addon).
- vLLM accepts images on `/v1/embeddings` through `messages`, and on Cohere-style `/v2/embed` — [vLLM](https://docs.vllm.ai/en/latest/models/pooling_models/embed/).
- kNN classification without retraining — [arXiv 2204.01186](https://arxiv.org/abs/2204.01186).

### Inferences
- **Provider capability flag.** Add `supports_image_embedding` (and the modalities list) to `lib/grey/provider_kinds.js` and `embedding_models.js`. Add image-capable driver formats:
  - `google` parts (gemini-embedding-2)
  - `voyage_multimodal`
  - `cohere_v2_inputs`, which also covers self-hosted vLLM `/v2/embed`
  - `bedrock_nova`
  - `jina`
  - `nomic_image`
  - `openai_compatible_messages` (vLLM)

  OpenAI and Anthropic keys mark "no native image vectors". Those customers get the caption layer only, and the UI says so.
- **Schema.** Add a `grey.media_embeddings` table: `source_id`, `kb_id`/`project_id`, `region` (null = whole image, else a normalized bbox), `embedding_model_id`, `dims`, `preprocess_version`, `embedding halfvec`, `phash bit(64)`, `created_at`.
  - Use partial HNSW indexes on `(embedding::halfvec(d))` per common dim. Add a `WHERE embedding_model_id = X` partial index for high-volume models.
  - Add an HNSW `bit_hamming_ops` index on `phash`, or plain Hamming scans for small knowledge bases.
  - Keep it separate from `grey.chunks` so text RAG is unaffected.
  - Default to 768-d (Gemini, Jina nano, Nomic vision) or 1024-d (Voyage, Nova, Cohere at 1024).
- **Worker ingest for `kind = image`** (also video keyframes and PDF page renders later):
  1. Preprocess with sharp: auto-orient, convert to JPEG/WebP, strip EXIF, cap at about 1.5 MP, make a 384–512 px thumbnail.
  2. Compute the pHash and check the existing `content_hash` for duplicates.
  3. Embed the image with the knowledge base's image model.
  4. Optionally run one BYO vision-LLM call that returns `{caption, ocr_text, tags, injection_suspected}` as structured JSON. Store caption and OCR as a normal chunk (text embedding and BM25), which also unblocks today's "images fail without OCR" state.
- **Query flows for the tool builder:**
  - (a) **Similar items:** embed the query image → top-k on `media_embeddings`, filtered by project, with a calibrated similarity floor. Optionally fuse with text-chunk hits from the caption.
  - (b) **Find inside:** v1 is a user crop box, or one BYO vision-LLM detection call on the *query* (Gemini `box_2d`). Each crop is embedded and searched. Index-side region vectors are v2, opt-in per knowledge base, because storage grows N-fold.
  - (c) **Answer about the image:** top-k neighbours → BYO vision LLM with the labelled query image, thumbnails, metadata and an untrusted-content wrapper → structured `{answer, used_item_ids, confidence}`, with IDs validated server-side. Estimated input cost is $0.004–0.02 per query.
  - (d) **Classify:** kNN vote over labelled items. Escalate to the vision LLM with neighbours as examples when the vote margin is low.
- **Scale plan:**
  - Up to about 1–3M images per Supabase project at 768-d halfvec on mid-to-large compute.
  - Beyond that, add `binary_quantize` HNSW plus halfvec re-rank, and partition by model.
  - Revisit a dedicated vector database past about 10M per model or for ColPali-style multi-vector.
- **Explicitly deferred or flagged:**
  - ColPali/ColQwen late interaction needs a customer-hosted model and multi-vector storage that pgvector cannot index.
  - DINOv3 needs customer self-hosting (gated, custom license).
  - Twelve Labs is a video-specialist integration for later.
  - Do not build on `gemini-embedding-2-preview`, `multimodalembedding@001`, Titan MM G1 or `voyage-multimodal-3` for new knowledge bases.

### Gaps
- Real recall and threshold calibration on customer-like image sets should be measured with Grey's existing eval runner before choosing default dims and thresholds. No public benchmark matches Grey's mixed-media knowledge bases.
- First-party Nova and Cohere per-image prices should be confirmed before quoting re-embed estimates in the product UI.
