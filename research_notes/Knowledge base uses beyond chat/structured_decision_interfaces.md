# Structured decision and extraction interfaces built on a knowledge base

Scope: non-chat, structured-output ways that products let users or systems use ingested documents and media as the grounding for a decision or an extraction. These notes reflect the market as of October 2026 and assume BYO models (Geiger Grey pays for no model usage). Research note: the session's shared web-search budget ran out partway through. Later items rely on direct page fetches, and some gaps below exist only because of that.

---

## 1. Classification grounded in a KB (fixed label set, taxonomy, policy)

### Takeaway
"Classify against my labels/policy" ships today in three forms. (a) Typed LLM functions: Databricks `ai_classify`, Snowflake `AI_CLASSIFY` and BigQuery `AI.CLASSIFY` take labels plus label descriptions plus instructions or few-shot examples, and return labels with optional confidence and rationale. (b) Vertical classifiers inside support suites: Zendesk custom intents and Intercom Fin Attributes classify tickets and conversations into admin-defined values that drive routing. (c) Policy-as-prompt classifiers: OpenAI's open-weight gpt-oss-safeguard and Zentropi CoPE read a written policy at inference time and return a verdict with reasoning. None of the general-purpose functions returns citations to KB passages. Retrieval-grounded classification with citations is an open gap a RAG platform could fill.

### Cited Findings

**Typed classification functions (define labels once, call at scale)**
- Databricks `ai_classify` (REST `POST /api/2.0/ai-functions/...`):
  - Inputs: `content` (a string or the output of `ai_parse_document`) and `labels` (an array, or an object mapping each label to a description; 2–500 labels of 1–100 characters each). `options.instructions` takes up to 20,000 characters of guidance, and `options.multilabel` allows several labels.
  - Outputs: a `response` array of per-label objects. Each object carries `confidence_score` when `enable_confidence_scores` is set and `rationale` when `enable_rationales` is set.
  - Limits and model: the default rate limit is 1,200 requests/min per workspace. The only model control is `options.version` ("2.1"/latest), and the page does not say you can bring your own model. — [Databricks ai_classify](https://docs.databricks.com/api/ai-functions/v1/ai-classify)
- Snowflake `AI_CLASSIFY(<input>, <list_of_categories> [, <config_object>])`:
  - Categories are strings or `{label, description}` objects, with descriptions of 25 words or fewer.
  - Config keys: `task_description` (50 words or fewer), `output_mode` (`single`/`multi`) and `examples` (a list of `{input, labels, explanation}` for few-shot use; examples are not supported for documents).
  - Output: a `labels` array, with no confidence score documented.
  - Limits and cost: the docs warn that more than 20 categories "might reduce classification accuracy", and document calls are capped at 100 categories. Descriptions and examples count as input tokens. — [Snowflake AI_CLASSIFY](https://docs.snowflake.com/en/sql-reference/functions/ai_classify)
- Snowflake's Cortex AI Functions run on LLMs hosted inside Snowflake. `AI_FILTER` (true/false, usable in WHERE/JOIN) is still marked preview, and `AI_EXTRACT` pulls information from strings or files. — [Snowflake Cortex AI Functions](https://docs.snowflake.com/en/user-guide/snowflake-cortex/aisql)
- BigQuery has managed `AI.IF` (natural-language filters and joins) and `AI.CLASSIFY` (used in GROUP BY), which "do not need you to choose models". The general-purpose `AI.GENERATE_TABLE` calls a remote model and returns a table with a custom schema. — [BigQuery generative AI overview](https://docs.cloud.google.com/bigquery/docs/generative-ai-overview)
- **Deprecated:** Cohere Classify. On 31 Jan 2025 Cohere deprecated Classify with default Embed models, leaving only fine-tuned Embed models — [Cohere changelog](https://docs.cohere.com/changelog/classify-default-model-deprecation). On 15 Sep 2025 it listed `/v1/classify` among deprecated endpoints and retired fine-tuning for classify, among other models — [Cohere changelog](https://docs.cohere.com/changelog/2025-09-15-major-command-deprecations). I found no confirmed final shutdown date.

**Document-type classifiers (IDP vendors), priced per page**
- Reducto Classify costs $7.50 per 1,000 pages and Deep Classify $15 per 1,000 pages at Standard list rates — [Reducto pricing](https://reducto.ai/pricing)
- Extend Classify costs 0.5 credits/page, or $5 per 1,000 pages at Pay As You Go ($0.01/credit), and needs no parse step — [Extend pricing](https://www.extend.ai/pricing.md)
- Google Document AI custom classifier is listed at $5 per 1,000 pages. This figure comes from Extend's comparison page, which cites a Korean-locale Google page, so it may be stale — [Extend vs Google Document AI](https://www.extend.ai/compare/extend-vs-google-document-ai)
- Azure Content Understanding offers "categorization" (labels documents or segments and routes them to specialized analyzers). It is billed as LLM tokens on the customer's own Foundry deployment plus a contextualization fee — [Azure CU pricing explainer](https://learn.microsoft.com/en-us/azure/ai-services/content-understanding/pricing-explainer)

**Support-suite intent and attribute classification (routing)**
- Zendesk intelligent triage classifies tickets by intent, language and sentiment using a pre-trained Intent Model. Since the January 2025 EAP, admins can create custom intents instantly. In November 2025 Zendesk added categories and sub-categories of custom intents for Copilot add-on customers — [Zendesk announcement](https://support.zendesk.com/hc/en-us/articles/9882930657050-Announcing-custom-intent-categories-for-intelligent-triage)
- Custom intents are capped at 50 active per account and are English-only. They are not meant for product names or subscription types, which Zendesk handles with "entity detection". Prerequisites conflict between articles (Advanced AI add-on vs Copilot add-on) — [Zendesk help](https://support.zendesk.com/hc/en-us/articles/8718789695002); [Zendesk EAP](https://support.zendesk.com/hc/en-us/articles/8761963171226)
- Intercom Fin Attributes:
  - What they do: tag each conversation with structured values (issue type, sentiment, urgency, spam). Admins define the values with descriptions and test accuracy in a preview tool before enabling.
  - Where values go: Escalation Rules, Workflows and Reporting.
  - When Fin classifies: at handoff, at resolution and at inactivity, and after every message when escalation rules exist. A later pass overwrites earlier values.
  - Fin Attributes replace the older "AI Category Detection" feature. — [Intercom Fin Attributes](https://www.intercom.com/help/en/articles/11680403-fin-attributes-beta); [How to create Fin attributes](https://fin.ai/help/en/articles/12017712-how-to-create-fin-attributes); [Intercom changelog](https://www.intercom.com/changes/en/113764-train-fin-to-detect-key-attributes-in-every-conversation); [AI Category Detection (legacy)](https://intercom.com/help/en/articles/9842128-ai-category-detection-beta)
- Vectara agents can emit a `structured_output` event, and later steps can branch on a field such as `$.output.intent`, so an agent step can act as an intent classifier — [Vectara structured outputs](https://docs.vectara.com/docs/agents/structured-outputs)

**Policy-as-prompt classifiers (BYO-compatible, open weights)**
- OpenAI gpt-oss-safeguard is an open-weight safety reasoning model in 20B and 120B sizes under Apache 2.0, fine-tuned from gpt-oss.
  - The developer's written policy goes in the system message. The model reasons in a separate channel and ends with a verdict (e.g. VIOLATION/SAFE).
  - Changing the policy text changes behaviour, with no retraining. Reasoning effort can be set to low, medium or high.
  - It is hosted on Ollama, LM Studio and Groq, and Groq caches re-used policy prompts. — [OpenAI cookbook guide](https://developers.openai.com/cookbook/articles/gpt-oss-safeguard-guide); [Groq](https://groq.com/blog/day-zero-support-for-openai-open-safety-model); [LM Studio](https://lmstudio.ai/blog/gpt-oss-safeguard); [Ollama](https://registry.ollama.ai/blog/gpt-oss-safeguard)
- Zentropi's CoPE model family takes a free-form policy plus content and returns a label for that policy. CoPE-A-9B and CoPE-B-A4B (Apache 2.0) are on Hugging Face, while CoPE-B-A4B-MM (multimodal) is subscriber-only. A hosted API and policy-authoring platform exist, but pricing is not public — [Zentropi README](https://zentropi-ai-readme.static.hf.space/README.md); [Zentropi HF org](https://huggingface.co/zentropi-ai)

### Inferences
- **Common API shape:** `{input, labels[{name, description}], instructions|policy, examples[], multilabel}` → `{labels[], confidence?, rationale?}`. No vendor I found returns citations to the KB passages or policy clauses that justified the label. Grey could differentiate with "RAG-grounded classification": retrieve the relevant policy chunks, past labelled examples and KG facts for each input, then return `{label, confidence, rationale, citations[]}`.
- Two kinds of "KB-grounded" classification exist and Grey could support both:
  - Example-grounded: kNN over labelled historical items stored in the KB, done with embeddings alone or as retrieved few-shot examples for an LLM.
  - Policy-grounded: retrieve the relevant section of a policy or taxonomy document. gpt-oss-safeguard shows this works with BYO open models.
- **What Grey would need:**
  - A "Classifier" resource: label set (optionally sourced from KG entity types or a taxonomy document), label descriptions, instructions, an example store, and a retrieval scope (pipeline or source filter).
  - A structured-output enforcement layer that works across BYO providers. Vectara's experience shows `strict` JSON is honoured only on OpenAI-family APIs, so Grey must validate and repair itself.
  - Confidence from self-reports or voting, documented as uncalibrated.
  - An evaluation and preview harness, as Intercom provides before go-live.
  - Batch runs over all sources, with labels written back as source metadata or KG properties.
  - Triggers on ingest and webhooks to Geiger Flow for routing.
- Snowflake's guidance (accuracy drops past about 20 categories) and Zendesk's 50-intent cap suggest large taxonomies need hierarchical classification (category, then sub-category, as Zendesk added in November 2025) or retrieval-based label shortlisting.

### Gaps
- No vendor documentation found for "classify with citations to KB passages". It appears to be unshipped by the major players, but I could not search exhaustively.
- Pricing of Databricks and Snowflake classification per call was not found (token/DBU based).
- Lead-qualification-against-ICP-document products (e.g. Clay, Default, Warmly scoring) were not researched in depth because the search budget ran out.
- Final shutdown date for Cohere `/v1/classify` is unconfirmed.

---

## 2. Schema-based extraction (typed fields → JSON)

### Takeaway
This is the most mature and most transparently priced pattern. The convergent design is:
- A JSON Schema (often OpenAI Structured-Outputs-compatible), where field descriptions act as instructions.
- Per-field citations (page plus bounding box or character span).
- Optional per-field confidence (explicitly uncalibrated) and per-field reasoning.
- Saved, versioned "processors/agents/blueprints/analyzers" with evaluation sets.

List prices cluster around $5–$50 per 1,000 pages. Most SaaS vendors bundle their own model choice. Azure Content Understanding (bills LLM tokens to the customer's own Foundry deployment) and the open-source Unstract (many LLM providers) are the closest analogues to Grey's BYO model.

### Cited Findings

**LlamaExtract (LlamaIndex / LlamaCloud)**
- Citations: with `cite_sources`, each leaf field gets a page number, verbatim source text and bounding box in `extract_metadata`. `advanced_citations` gives tighter boxes.
- Confidence scores are beta: `parsing_confidence`, `extraction_confidence` and a combined `confidence`. The docs warn they "are not calibrated", so 0.6 does not mean 60% accurate.
- Reasoning: `use_reasoning` adds a per-field explanation, or an error if the text lacks the information. — [LlamaExtract extensions](https://developers.llamaindex.ai/python/cloud/llamaextract/features/extensions)
- Tiers are Cost Effective, Agentic, Agentic Plus and Turbo (no parse step; PDF/JPG/PNG only). Reusable extraction configurations bundle schema, tier and options, and the API lists an Extraction Agents endpoint.
- Self-hosted deployments can plug in OpenAI, Azure OpenAI, Anthropic, Bedrock, Gemini or Vertex. — [LlamaExtract options](https://developers.llamaindex.ai/python/cloud/llamaextract/features/options/)
- Pricing: 1,000 credits = $1.25. Free (10K credits), Starter $50/mo (40K), Pro $500/mo (400K), Enterprise custom. Citations, confidence, classify and split are on all plans. — [LlamaIndex pricing](https://www.llamaindex.ai/pricing)

**Reducto**
- Standard list rates per 1,000 pages: Parse $10, Extract $20, Deep Extract $40, Split $20, Deep Split $40, Classify $7.50, Edit (form fill) $60, or $15 for fully prefilled pages. Batch processing is 20% off Parse and Extract.
- Growth adds ZDR, BAA, EU/AU residency and 350 guaranteed concurrent pages. Enterprise adds VPC or on-prem. — [Reducto pricing](https://reducto.ai/pricing)
- A legacy credit page says those credit rates apply to plans from before 1 September 2026, which implies a pricing restructure that month — [Reducto legacy credits](https://docs.reducto.ai/reference/legacy-credit-usage.md)
- `/extract` maps to a JSON Schema and returns per-field citations (bounding boxes) — [Reducto demo page](https://reducto.ai/lp/demo-request); [Nutrient comparison](https://www.nutrient.io/api/data-extraction-api/vs/reducto/)

**Extend**
- Pay As You Go includes 10,000 free credits, then $0.01/credit. Credits per page:
  - Extract: Light 0.7 ($7/1k pages), Performance 3 ($30/1k), Operator-1 5 ($50/1k), with parse billed separately.
  - Parse: Light 0.5, Performance 2.
  - Split: 0.5/2.
  - Classify: 0.5.
  - Edit: filling 1, form detection 2.
- Citations, "Evaluation suites" and a "Review Agent" come on all plans. Enterprise offers "custom models" and BYOC deployment, but no BYO-LLM is stated. — [Extend pricing](https://www.extend.ai/pricing.md)
- A splitter config is saved as a versioned "processor" that you can evaluate and optimize. Each split returns a type, a page range and a fileId to pass to Extract. Extend also exposes an MCP server. — [Extend splitting](https://docs.extend.ai/splitting/overview); [Extend MCP](https://docs.extend.ai/mcp)

**Hyperscalers**
- Azure Content Understanding (Foundry Tools; GA API `2025-11-01`, agentic workflow in `2026-06-01-preview`):
  - Field schema: name, description, value type and generation method.
  - Confidence and source grounding are produced by "contextualization".
  - Contextualization costs $1 per 1,000 pages standard and $3 per 1,000 pages advanced (labelled-data or agentic analyzers); $0.10/hr for audio and $1/hr for video.
  - All LLM and embedding tokens run on the customer's own Foundry deployment and are billed there. This is close to BYO.
  - Turning on grounding and confidence roughly doubles tokens per page in the invoice example, whose total illustrative cost is $0.0837 for 10 pages. — [Azure CU pricing explainer](https://learn.microsoft.com/en-us/azure/ai-services/content-understanding/pricing-explainer)
- AWS Bedrock Data Automation (BDA):
  - "Blueprints" define custom output. A project holds up to 40 document blueprints and one image blueprint, and standard output is always returned alongside custom output. — [AWS BDA docs](https://docs.aws.amazon.com/bedrock/latest/userguide/bda-custom-output-idp.html)
  - Pricing examples: documents $0.010/page for standard output and $0.040/page for custom output with 30 fields or fewer, plus $0.0005 per field above 30. Images $0.005 custom; video $0.050/min standard; audio $0.006/min standard. — [AWS Bedrock pricing](https://aws.amazon.com/bedrock/pricing/)
  - A third-party cheat sheet lists $0.009/audio minute, which conflicts. It also says that when BDA is the parser for a Bedrock Knowledge Base, standard-output pricing applies. — [Tutorials Dojo](https://tutorialsdojo.com/amazon-bedrock-data-automation-cheat-sheet/)
- Google Document AI custom extractor costs $30 per 1,000 pages (1–1M pages/month) — [Google Document AI](https://cloud.google.com/document-ai)

**Data-platform and content-platform extraction functions**
- Databricks `ai_extract`:
  - Schema: either a list of field names or an object with types (`string`, `integer`, `number`, `boolean`, `enum`), descriptions and nullability. Up to 256 fields, 12 nesting levels and 500 enum values.
  - Options: `instructions` (up to 20k characters) and `mode: "precision"`.
  - Citations: `enable_citations` returns `citation_ids` per field, as character offsets for text or `bbox` + `page_id` for parsed PDFs. `enable_confidence_scores` adds a per-field confidence.
  - Rate limit: 120 rpm. — [Databricks ai_extract](https://docs.databricks.com/api/ai-functions/v1/ai-extract)
- Box AI `POST /2.0/ai/extract_structured`:
  - Takes either a `metadata_template` (template_key and scope) or inline `fields`. Each field has `key`, `displayName`, `description`, `prompt`, `type` and `options`.
  - Types: string, float, date, enum and multiSelect, plus complex `struct` and `table`.
  - An "Enhanced Extract Agent" is recommended for complex types. — [Box API reference](https://developer.box.com/reference/post-ai-extract-structured); [Box guide](https://developer.box.com/guides/box-ai/ai-tutorials/extract-metadata-structured)
- Mistral OCR "annotations":
  - `bbox_annotation` labels figures and charts, and `document_annotation` structures the whole document. Both take a JSON schema (Pydantic, Zod or raw), and field descriptions act as instructions. — [Mistral docs](https://docs.mistral.ai/capabilities/document_ai/annotations)
  - Using annotations switches billing to an "annotated-page" rate — [AIML API docs](https://docs.aimlapi.com/api-references/vision-models/ocr-optical-character-recognition/mistral-ai/mistral-ocr). Base OCR is reported at $4 per 1,000 pages ($2 batch) — [Implicator](https://www.implicator.ai/mistral-ocr-4-ships-bounding-boxes-for-170-language-document-ai/)

**Pipelines and open source**
- Unstructured added a schema-driven "Extract" node (March 2026) that sits before the destination node. The schema follows the OpenAI Structured Outputs format, a visual builder is available, and output is a new `DocumentData` element — [Unstructured blog](https://www.unstructured.io/blog/introducing-extract)
- Unstract (Zipstack), AGPL-3.0:
  - Build extraction prompts in Prompt Studio, then deploy as an API or as an ETL pipeline. A client is published as `unstract-client` on PyPI.
  - LLM providers include OpenAI, Vertex, Gemini, Azure OpenAI, Anthropic, Ollama and Bedrock. "LLMChallenge" (dual-model verification) is Enterprise-only. — [Zipstack GitHub](https://github.com/Zipstack); [unstract-client](https://pypi.org/project/unstract-client)
  - "Agentic Prompt Studio" infers a JSON Schema from sample documents — [Unstract](https://unstract.com/agentic-prompt-studio/)
- Sensible:
  - Bills per document, not per page. Free tier is 100 extractions/month, and paid plans start at $499/month for 750 — [Sensible pricing](https://www.sensible.so/pricing); [Sensible vs Docparser](https://www.sensible.so/compare/docparser)
  - "Confidence signals" flag multiple, partial or missing answers — [Sensible blog](https://sensible.so/blog/confidence-signals)
  - SenseML configs are version-controlled files — [Sensible vs Parseur](https://www.sensible.so/compare/parseur)
- Instill AI (Instill Core/Cloud): I found no shutdown or acquisition notice. The GitHub repo is not archived and references v0.58.1, but recency is unverified — [instill-core GitHub](https://github.com/instill-ai/instill-core)
- The common reliability pattern is: schema validator, then repair step for malformed JSON, then retry policy, then low-confidence fields routed to human review — [agnt5 cookbook](https://agnt5.com/cookbooks/data-extraction); [Lindy](https://www.lindy.ai/tools/ai-json-data-extractor)

### Inferences
- **Converged API contract:** `POST /extract {source_id(s) | file, schema (JSON Schema, field descriptions as prompts), instructions, mode/tier, options{citations, confidence, reasoning}}` → `{data, per-field {citations[{page, bbox | char span, quote}], confidence, reasoning}}`. A saved, versioned config is referenced by id.
- **Grey's structural advantage:** Grey already parses, chunks and stores sources, so it can extract from already-ingested media (audio and video transcripts, images, web pages), not just PDFs. It can also write extracted fields into the KG as typed entity properties, which closes the loop between extraction and graph.
- **What Grey would need:**
  - Preserve layout coordinates (page and bbox) and transcript timestamps through chunking so citations can point to them.
  - A schema builder UI (field name, type, description, enum or table types, required or nullable).
  - Provider-agnostic structured-output handling: native JSON Schema where the BYO provider supports it, otherwise tool-calling or prompt-plus-validate-plus-repair.
  - Long-document handling: map over chunks or page windows, then merge or reduce per field.
  - Per-field citation alignment (match the extracted value back to a chunk span).
  - Confidence, either self-reported or via agreement between two models (as in Unstract's LLMChallenge).
  - Eval sets and versioning, and a human review queue.
- **Pricing benchmark:** vendors charge $5–$50 per 1,000 pages including the model. Under BYO, Grey's fee would cover only orchestration, storage and UI, so platform-fee or seat pricing looks more natural than per-page.

### Gaps
- Per-mode LlamaExtract credit costs were not on the pages fetched.
- Reducto's post-1-September-2026 credit mapping is not fully documented on the pages I saw.
- The official Google Document AI page does not say whether the custom extractor price includes generative surcharges.
- Mistral's annotated-page rate was not found.

---

## 3. Matrix / grid interfaces (documents × questions)

### Takeaway
"Rows = documents (or entities), columns = prompts, cells = cited answers" is the most commercially proven structured interface. It is the flagship surface of the fastest-growing vertical AI companies: Harvey review tables, Legora Tabular Review, Hebbia Matrix, AlphaSense Generative Grid, and Rogo in finance. It is also reappearing horizontally as AI columns or fields in Airtable, Notion, Excel, Google Sheets and Clay. Shared mechanics:
- Typed columns, with column prompts that can be generated from a header.
- Reference files (e.g. a playbook) applied to every row.
- `[N]` citations per cell.
- Verify, flag and lock states, where human edits override AI values.
- Cell-level refresh.
- Chat over the table.
- Export to Excel or PowerPoint.

### Cited Findings

**Harvey (Vault review tables)**
- Developer API (cells):
  - Each cell has `summary` (short answer), `additional_context` (full reasoning), `citations`, and verification and flag status.
  - Inline `[N]` markers index into the cell's citations, and a user-edited value takes precedence over the AI value.
  - One row is one document or one file group.
- Developer API (endpoints and limits):
  - Endpoints: `GET review_table`, `GET get_row`, `POST add_row` (async, returns `review_event_run_id`, then poll) and `GET get_metadata`.
  - Rate limit: 10 req/min. Up to 25 files per `add_row` request by default. — [Harvey dev guide](https://developers.harvey.ai/guides/review_tables)
- UI:
  - A Column builder generates suggested columns, each with a display type, label and query.
  - A column can take an attached reference file, such as a playbook or standard form, as context for every row.
  - Users verify, edit or flag answers, assign rows to teammates, and run Assistant questions over the table. — [Harvey help](https://help.harvey.ai/articles/using-review-tables)
- Release notes: cell-level refresh (10 June 2026) and persistent table-wide instructions for new columns (27 May 2026) — [Harvey release notes](https://help.harvey.ai/release-notes/category/review-tables/page/2)
- Limits: 100k files per Vault, 10,000 files per review table. Harvey advises fewer columns or smaller batches if tables stall at scale — [Harvey Vault](https://help.harvey.ai/articles/vault); [Uploading files](https://help.harvey.ai/articles/uploading-files-to-harvey)
- Commercial (secondary sources, conflicting):
  - Funding: $550M raised 9 Sep 2026 at a $15.5B valuation (another tracker says $16B), after a $200M round at $11B in March 2026.
  - ARR: about $195M at end of 2025, about $300M by May 2026; some coverage claims $400M+.
  - Customers: 3,000+ organizations in one source, versus about 1,300 organizations and 100,000+ lawyers in another. — [Entrepreneurloop](https://entrepreneurloop.com/harvey-ai-valuation-15-5b/); [multiples.vc](https://multiples.vc/private-comps/harvey); [Tech-Insider](https://tech-insider.org/harvey-ai-200m-arr-manifold-odds-2026/)

**Legora (Tabular Review)**
- Documents imported from a DMS, repository or VDR become rows, and prompts become columns.
- Output can be shaped with formats, filtering and sorting, and insights are "cited to its source".
- Collaboration features: real-time collaboration, "Mark as Reviewed", "Lock Cells" and "Review Mode". Users can ask questions with the table as context.
- Targets "thousands of documents". — [Legora Tabular Review](https://legora.com/product/tabular-review)
- Playbooks are configured in the web app and run in the Word add-in. I found no source confirming playbooks run as Tabular Review columns — [Legora](https://legora.com). A competitor comparison says Legora prioritizes portfolio-level analysis while Ivo focuses on enforcing playbooks on individual contracts — [Spellbook brief](https://www.spellbook.legal/briefs/legora-vs-ivo)
- Commercial:
  - $550M Series D at $5.55B (March 2026), plus a $50M extension with NVIDIA and Atlassian at $5.6B — [TNW](https://thenextweb.com/news/legora-series-d-550m-legal-ai-us-expansion); [TNW](https://thenextweb.com/news/egora-nvidia-atlassian-600m-series-d)
  - Passed $100M ARR in about 18 months (April 2026) — [TNW](https://thenextweb.com:443/news/legora-just-hit-100-million-in-revenue-it-took-18-months); [Sacra](https://sacra.com/research/100m-year-harvey-for-the-rest-of-the-world/)
  - Unconfirmed reports of $150M ARR in Q2 2026 and talks at an $8.5B–$10B valuation — [Inforcapital](https://inforcapital.com/news/legal-ai-startup-legora-seeks-10-billion-valuation-nearly-doubling-its-worth-in-just-four-months/)

**Hebbia (Matrix)**
- The product page shows rows = companies and columns = research questions or fields. Cell types include tables, summaries, dropdowns (e.g. "Sub-sector", "Acquirer Profile"), checklists ("Origination Scorecard") and labels ("High conviction"). Each row lists its source documents (SEC filings, transcripts, decks), and output exports to PowerPoint — [Hebbia Matrix](https://www.hebbia.com/matrix)
- No public pricing. Third-party estimates put Lite at about $3,000–3,500/seat/yr and Professional at about $10,000/seat/yr, with "unlimited" usage under fair use — [Metronome pricing index](https://metronome.com/pricing-index/hebbia); [Sacra](https://sacra.com/chat/h/06c453cc-9871-47c4-bc57-83b47d85c44c/)
- A second product, "Max", launched in August 2026 with no published pricing — [UsagePricing](https://usagepricing.com/blueprint/activity/hebbia-2026-08-06-launch)
- Company facts: OpenAI models were integrated into Matrix (2025), Hebbia acquired FlashDocs (slide generation, 2025), and its Series B was $130M (a16z, 2024) — [Wikipedia](https://en.wikipedia.org/wiki/Hebbia)
- ARR is reported at nearly $50M, with a Morgan Stanley deployment to about 5,000 bankers after a bake-off against Rogo. These figures come from a single aggregator and are unconfirmed — [arr.club](https://www.arr.club/hebbia/hebbia-arr-hit-50m-with-strong-enterprise-adoption)

**AlphaSense (Generative Grid)**
- Documents are rows and each prompt is a column applied to every document. Templates include "Industry Read-Through" and "Earnings Analysis", and "Generate Prompt" expands a column header into a full prompt — [AlphaSense help](https://help.alpha-sense.com/en/articles/10249048-leveraging-generative-grid)
- The grid works over a 300M+ document library plus the user's own files, with direct citations and export — [AlphaSense press release](https://www.alpha-sense.com/press-releases/alphasense-supercharges-its-generative-ai-suite-with-groundbreaking-new-features/)

**Rogo (finance)**
- $160M Series D at about $2B (29 April 2026, led by Kleiner Perkins), bringing total funding above $300M. The "Felix" agent serves 250+ banks and investment firms.
- It combines OpenAI, Anthropic and other models with Capital IQ and PitchBook data, plus Excel and PowerPoint integrations. — [FinTech Global](https://fintech.global/2026/04/29/rogo-raises-160m-series-d-to-scale-finance-ai-platform/)
- Earlier: $75M Series C at $750M (January 2026) — [Axios](https://www.axios.com/pro/fintech-deals/2026/01/28/sequoia-rogo-750m-valuation). Reported $50M+ ARR, citing The Information — [Digg](https://digg.com/ai/gpp9r7ys)

**V7 Go**
- Pricing is a base platform fee plus user licenses plus usage-based processing, quoted custom, with a free PoC.
- Claims of 300+ prebuilt agents and 95–99% accuracy are vendor marketing. — [V7 compare page](https://www.v7labs.com/compare/aws-textract)

**Horizontal AI columns (same pattern in general workspaces)**
- Airtable "field agents" retrieve, analyze or generate data per cell. They work on formula, long text, linked record (suggesting records from related tables), select and number fields, can pull web information, and consume AI credits — [Airtable support](https://support.airtable.com/docs/using-airtable-ai-in-fields); [Zapier](https://zapier.com/blog/airtable-field-agents.md)
- Notion AI autofill properties offer summary, translation, keywords (which reuse existing multi-select options) and custom prompts, with "Autofill all pages" — [XRAY](https://www.xray.tech/post/notion-ai-autofills)
- Excel `=COPILOT(prompt_part, [context range]…)` suits classifying and summarizing ranges, runs on an Azure-hosted model, works only on workbook data, and "can give incorrect responses" — [Microsoft support](https://support.microsoft.com/en-us/excel/copilot-function); [heise](https://heise.de/-10544915)
- Google Sheets `=AI("prompt", A2)` (also `=Gemini()`) requires a paid Workspace or AI plan — [Dupple](https://dupple.com/learn/how-to-use-ai-in-google-sheets)
- Clay (GTM tables with Claygent web-research columns):
  - Two meters since 11 March 2026: "Actions" (each enrichment or AI run) and "Data Credits" (from $0.05). Launch is $185/mo and Growth $495/mo. — [Spotsaas](https://www.spotsaas.com/blog/clay-pricing); [Clay pricing](https://clay.com/pricing)
  - AI-column costs vary with prompt and token size, and users complain about unpredictability — [Clay community](https://community.clay.com/x/support/c3fhicyuc7n1/concerns-over-gpt-4omini-price-hike-on-claygent-ta)
- Dust's "Extract Data" tool takes a data selection and a schema, then searches and extracts matching information. A separate "Query tables" tool runs text-to-SQL over CSV, Sheets, Notion or warehouses — [Dust docs](https://docs.dust.tt/docs/knowledge)

### Inferences
- **The matrix is the highest-leverage new surface for Grey.** Grey sources map naturally to rows, and Grey's per-pipeline retrieval and KG supply the cell context. The pattern is proven at $3k–$10k+ per seat per year in finance and legal (Hebbia estimates) and sits at the core of companies with $50M–$400M ARR.
- **Minimum viable Grey matrix:**
  - Rows: sources, source groups or KG entities (e.g. one row per company entity, aggregating all sources about it, which is how Hebbia's company rows behave).
  - Columns: prompt plus type (text, number, date, enum/dropdown, multi-select, checklist, table), optional reference sources applied to every row, and an optional generated prompt from the header.
  - Cells: `{value, short answer, reasoning, citations[N], status: ai/edited/verified/flagged/locked}`.
  - Behaviour: async cell jobs with per-cell refresh, table-level instructions, chat over the table, export to CSV/XLSX, and an API to add rows (as Harvey offers).
- Under BYO, cost scales as rows × columns × tokens. Harvey's advice to reduce columns or batch at scale, and Clay users' cost complaints, suggest Grey needs cost estimates before a run and per-column model selection (cheap model for enums, strong model for analysis).
- **Suite fit:** the matrix maps directly onto Geiger Notes databases (Notion-style autofill properties) and could feed Geiger Forms and Flow. Matrix columns and the "LLM function" in section 8 should be the same primitive.

### Gaps
- No official pricing found for Harvey, Legora, Hebbia, AlphaSense Generative Grid, Rogo or V7 Go.
- Whether Hebbia or Legora let customers pick models (Hebbia integrated OpenAI models; no BYO-key evidence found).
- Hebbia's cell-level citation mechanics (the page is a teaser).
- Rogo customer counts conflict: other secondary reports cite 300+ institutions and 40,000 users, but I could not pin those to a reliable source.

---

## 4. Scoring, ranking and evaluation against a KB (questionnaires, playbooks, compliance, rubrics, claim verification)

### Takeaway
"Evaluate input X against reference knowledge Y and return a verdict, score or answer with citations" splits into five commercial sub-markets:
- RFP and security questionnaire answering (Loopio, Responsive, Conveyor, Vanta; SafeBase acquired by Drata for $250M). This is the largest and oldest "answer from my KB" structured workflow, typically $5k–$60k+/yr.
- Contract review against a playbook (LegalOn, Ivo, Spellbook, Harvey or Legora reference files). Robin AI is a cautionary distressed sale.
- Regulatory compliance checking (Norm Ai at a $1.2B valuation; AWS Bedrock Automated Reasoning checks).
- Rubric grading (CoGrader and similar, at low price points).
- Claim and grounding verification APIs (Google Vertex Check Grounding, Bedrock contextual grounding checks, small fact-check APIs).

### Cited Findings

**RFP / security questionnaire answering (KB + answer library → drafted, cited answers)**
- Vanta Questionnaire Automation:
  - Import past questionnaires to build an answer library and sync policies from Vanta compliance.
  - Without AI it matches similar questions in the library. With AI it drafts "well-cited responses" from previous answers and resources, for human approval.
  - It "can only answer questions that are covered by your knowledge base", and "coverage insights" flag topic areas where the KB has gaps or conflicts. — [Vanta getting started](https://help.vanta.com/en/articles/11345464-getting-started-with-questionnaire-automation); [Vanta implementation guide](https://help.vanta.com/en/articles/11488356-vanta-questionnaire-automation-implementation-guide)
  - The Vanta Agent answers grounded in existing KB content and previous responses. Routing questions to SMEs is marketed for 2026 but unverified — [Vanta community update](https://community.vanta.com/x/vanta-product-updates/msg_8y62Tluf2NdD/vanta-agent-enhancements-smarter-answers-for-quest)
- **Acquired:** SafeBase was acquired by Drata (about $250M, announced February 2025) — [SC World](https://www.scworld.com/brief/drata-acquires-safebase-for-250m); [Drata FAQ](https://help.drata.com/en/articles/10524109-safebase-acquisition). SafeBase had earlier bought Stacksi (AI questionnaire answering, 2023) — [PrivSource](https://www.privsource.com/acquisitions/deal/7YSpql)
  - **Shut down:** Drata's own Security Questionnaire Automation beta sunset on 30 April 2026, and users were directed to SafeBase's "AI Questionnaire Assistance (AIQA)" — [Drata sunset notice](https://help.drata.com/en/articles/9554898-security-questionnaire-automation-sqa-beta-sunset-notice)
  - A competitor says AIQA is a Chrome extension for portals such as OneTrust that suggests answers inline but needs manual copy-paste into most portal fields (competitor view) — [Wolfia](https://connect.wolfia.com/blog/safebase-reviews-pricing-alternatives)
- Conveyor:
  - Accuracy: vendor claims 95%+ first-pass accuracy, and 98% on one page — [Conveyor vs Loopio](https://www.conveyor.com/compare/conveyor-vs-loopio); [Conveyor vs Whistic](https://conveyor.com/compare/conveyor-vs-whistic). The 95%+ figure is not independently audited — [SOC2 Auditors](https://soc2auditors.org/software/conveyor/). An older Conveyor blog gives 80–90% — [Conveyor blog](https://www.conveyor.com/blog/conveyor-vs-securitypal-a-head-to-head-breakdown)
  - Pricing: the Business tier is reported from $9,600/yr — [Skypher](https://skypher.co/post/conveyor-reviews-pricing-alternatives) — conflicting with "from $4,800/yr" (March 2026) — [Dataconomy](https://dataconomy.com/tools/conveyor/)
  - Data: says no data is stored on OpenAI and it has opted out of training — [Conveyor pricing calculator](https://www.conveyor.com/landing-page/conveyor-pricing-calculator)
- Loopio: no public pricing. A competitor says Foundations starts around $20,000/yr — [AutoRFP](https://autorfp.ai/blog/loopio-pricing). Vendr 2026 data gives a median of about $23,700/yr (range about $11,800–$58,400), with Foundations including 10 seats and generative AI on all plans — [KI-Syndikat](https://www.ki-syndikat.de/tools/loopio/)
- Responsive (formerly RFPIO): about $7k–$28k/yr, averaging about $13,955 (competitor-sourced). Its "AI Agents" and "AI Agent Studio" sit in higher tiers — [Inventive AI](https://www.inventive.ai/blog-posts/responsive-software-pricing-alternatives)

**Contract review against a playbook**
- LegalOn prices per seat. A "Core Review" tier targets solo attorneys, and 50+ prebuilt attorney-built playbooks ship — [LegalOn pricing](https://legalontech.com/pricing). A competitor reports the Individual plan at $550/month billed annually, with team pricing via sales — [Spellbook](https://spellbook.com/learn/legalon-pricing)
- Harvey review-table columns can attach a playbook or standard form as a reference for every row — [Harvey help](https://help.harvey.ai/articles/using-review-tables). Legora runs playbooks in its Word add-in — [Legora](https://legora.com)
- **Distressed:** Robin AI (contract review) was listed on an insolvency marketplace in late October 2025 after failing to close about a $50M round, with a final-offer deadline of 13 November 2025. The outcome after that deadline was not found — [Legal Technology](https://legaltechnology.com/robin-ai-listed-for-distressed-sale-nine-months-after-making-the-sunday-times-100-tech-list/); [Geek Law Blog](https://www.geeklawblog.com/2025/11/is-the-collapse-of-robin-ai-a-one-off-or-a-sign-of-a-legal-tech-ai-bubble.html); [Business Cloud](https://businesscloud.co.uk/news/200-jobs-at-risk-as-revolut-monzo-backed-robin-ai-listed-for-sale/)

**Regulatory / policy compliance checks**
- Norm Ai builds agents that encode legal and regulatory frameworks for banks, insurers and asset managers, and produce compliance reports. It raised a $120M Series C at a $1.2B valuation (led by Khosla, announced about 7 July 2026; Blackstone, Vanguard and TIAA participated), bringing total funding above $260M — [Let's Data Science](https://letsdatascience.com/news/norm-ai-raises-120m-for-legal-ai-agents-c3604243); [Seedtable](https://seedtable.com/companies/norm-ai/funding-rounds/series-c-2026-07)
- AWS Bedrock Guardrails Automated Reasoning checks:
  - Upload a policy document. The service derives formal-logic rules and variables, which you validate with test cases, and then it verifies LLM outputs against the policy.
  - Limits: documents up to 5MB / 50,000 characters, and nested or contradictory documents may not translate cleanly. — [AWS docs](https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails-automated-reasoning-checks.html)
  - AWS claims up to 99% verification accuracy for unambiguous translations — [AWS announcement mirror](https://aihub.hkuspace.hku.hk/?p=7904)
  - Pricing: $0.17 per 1,000 text units per policy (1 text unit is up to 1,000 characters) — [AWS Bedrock pricing](https://aws.amazon.com/bedrock/pricing/)

**Rubric grading**
- CoGrader scores each rubric section with feedback and integrates with Canvas, Schoology, Google Classroom, Brightspace and Blackboard. The free tier is 100 submissions/month and Standard is $15/month for 300 — [TCEA blog](https://blog.tcea.org/tag/ai-grading-tool)
- A reviewer says rubrics often need several revisions before grading matches intent — [Capterra](https://www.capterra.ca/software/1068756/CoGrader)

**Claim / grounding verification against supplied facts**
- Google Vertex AI Check Grounding:
  - Request: `answerCandidate` (up to 4,096 tokens) and up to 200 `facts` (each up to 10k characters, with optional attributes). `groundingSpec.citationThreshold` defaults to 0.6, and `enableClaimLevelScore` turns on per-claim scores.
  - Response: `supportScore` (0–1, roughly the fraction of claims grounded), cited chunks, and claims with byte offsets, citations and a `groundingCheckRequired` flag. Per-claim scores are optional.
  - Any text, including human-written text, can be checked. — [Google docs](https://docs.cloud.google.com/generative-ai-app-builder/docs/check-grounding)
  - Partial entailment counts as ungrounded. Anti-citations (contradiction score) and helpfulness scores are experimental and need allowlisting — [Google docs (alt)](https://docs.cloud.google.com/generative-ai-app-builder/docs/check-grounding?authuser=0)
- AWS Bedrock contextual grounding check costs $0.10 per 1,000 text units — [AWS Bedrock pricing](https://aws.amazon.com/bedrock/pricing/)
- Small fact-check APIs exist:
  - verification-mcp returns a verdict (supported, contradicted, mixed or unverified) plus confidence and excerpts, against Wikipedia, Wikidata and Crossref — [mcp.so](https://mcp.so/servers/verification-mcp)
  - Apify AI Fact Checker runs pro and contra searches per claim — [Apify](https://apify.com/raional/ai-fact-checker)
  - I found no established vendor of "verify claims against my KB" with independent benchmarks.

### Inferences
- **Questionnaire answering is a direct fit for Grey.** It is the most mature "KB → structured answers" business.
- **Core loop:**
  1. Ingest a questionnaire (XLSX, DOCX, PDF or portal).
  2. Split it into a question list.
  3. Retrieve from the KB plus an approved-answer library.
  4. Draft each answer with citations, confidence and a "needs SME" flag.
  5. Review and approve.
  6. Write approved answers back to the library.
  7. Export in the original format.
- Vanta's "coverage insights" (gaps and conflicts in the KB) is a cheap, high-value add-on.
- **Playbook review generalizes to "check each document against a reference source".** A matrix column with a reference file, as Harvey does, covers it, so Grey does not need a separate product.
- **What Grey would need:**
  - Rule or playbook objects: clause type, standard position, fallback positions, severity.
  - Per-rule verdicts `{pass/fail/deviation, severity, quote, suggested redline}` with citations to both the reviewed document and the playbook.
  - Optional redline generation, which is Word-specific and probably out of scope.
- **A grounding-check endpoint is cheap to build on Grey and fully BYO-compatible.** For example: `POST /verify {text, pipeline_id | facts[]}` → `{support_score, claims[{span, verdict: supported|contradicted|unsupported, score, citations}]}`. It can use any BYO LLM as judge, or an NLI model. It also doubles as a chat guardrail and as the engine for fact-checking user drafts written in Geiger Notes.
- Bedrock Automated Reasoning shows demand for formal policy checking, but the method is proprietary to AWS. Grey can approximate it with LLM-as-judge per rule, but not with a mathematical guarantee.

### Gaps
- No public list prices for Vanta Questionnaire Automation or SafeBase AIQA after the Drata deal.
- Ivo funding and pricing, plus Spellbook, Luminance and Kira (Litera) playbook features, were not researched because the search budget ran out.
- Robin AI's final outcome after November 2025 is unknown.
- Vertex Check Grounding pricing was not on the docs page.
- Rubric-grading products beyond CoGrader (e.g. Turnitin, Gradescope AI) were not covered.

---

## 5. Comparison, diffing and contradiction detection

### Takeaway
Two distinct patterns exist:
- **Pairwise document comparison** (version A vs B, or a document vs a standard form). It is mature in legal (Litera Compare, Draftable), with AI adding "semantic" clause-level diffs and risk notes.
- **Corpus-level contradiction detection** inside a KB (two articles disagree). This is emerging as a KM and support feature at Leena AI, Alhena, Bloomfire and Vanta (coverage insights). The common method is to retrieve candidate pairs, judge them with an LLM or NLI model, then have a human resolve them.

No major RAG platform exposes contradiction detection as an API. Grey's knowledge graph gives it a natural advantage here.

### Cited Findings
- Leena AI "Conflict Analysis" reports which articles contain contradictions and the specific conflicting text blocks. Humans resolve the conflicts. It does not support CSV and blocks runs over 1,000 selected articles — [Leena AI docs](https://docs.leena.ai/docs/conflict-analysis-within-km)
- Alhena "FAQ Conflict Detection" targets cases like two FAQs giving different return windows, citing the Air Canada chatbot case as the cost of KB conflicts — [Alhena](https://alhena.ai/blog/faq-conflict-detection-ai-knowledge-base/)
- Bloomfire describes chunk-level scanning that compares facts, figures and instructions across sources — [Bloomfire](https://bloomfire.com/blog/conflicting-content-detection-guide/)
- A DIY recipe: semantic matching finds related articles, then the top 5 are sent to an LLM asking for factual contradictions with quoted evidence — [tcworld](https://www.tcworld.info/news/finding-ambiguity-in-content)
- A patent filing resolves conflicts by ranking documents with a priority rule (recency, source type, document type) — [USPTO](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/12602370)
- Research: CLAIRE (retrieval plus LLM agent) flags corpus inconsistencies for human review and estimates about 3.3% of Wikipedia facts conflict with other corpus content. The paper releases the WIKICOLLIDE benchmark — [arXiv 2509.23233](https://arxiv.org/pdf/2509.23233)
- Vanta's questionnaire "coverage insights" flag KB areas with gaps or conflicts — [Vanta guide](https://help.vanta.com/en/articles/11488356-vanta-questionnaire-automation-implementation-guide)
- Legal document comparison:
  - AI comparison reads drafts "for meaning" and flags the clause that actually changed rather than formatting churn — [GC AI](https://gc.ai/blog/legal-document-comparison-software)
  - Litera Compare announced a Google Workspace integration in April 2026 and is described as the enterprise standard. Pricing is quote-only, with anecdotes of $500+/user/yr — [Vaquill](https://www.vaquill.ai/blog/ai-tools-comparing-document-versions)
  - Hebbia lists document comparison among legal use cases — [Wikipedia](https://en.wikipedia.org/wiki/Hebbia)
- AWS warns that policy documents with contradictory statements may not translate cleanly into Automated Reasoning rules, an indirect demand signal for pre-checking KB consistency — [AWS docs](https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails-automated-reasoning-checks.html)

### Inferences
- **Grey's KG is an unusually good contradiction detector.** The same (entity, relation) with different object values across sources is a cheap candidate contradiction, for example (Product X, return_window, 30 days) vs (Product X, return_window, 14 days). An LLM judge then confirms with quotes from both sources.
- The output shape would be `{conflict_id, entity, attribute, claims[{value, source, quote, date}], verdict, suggested_winner (by recency or source priority)}`. That gives a "KB health" dashboard and webhooks.
- Pairwise comparison can reuse chunk alignment (embed both documents, align sections, LLM-diff the aligned pairs) and output `{section, change_type: added/removed/modified/semantic, before, after, materiality, citations}`.
- These features protect the quality of every other Grey output (chat, matrix, questionnaires), so they work as both a product and a trust feature.

### Gaps
- No pricing found for Leena AI, Alhena or Bloomfire conflict features.
- I found no RAG-platform vendor (Vectara, Pinecone, Contextual AI) shipping contradiction detection as an API, though this was not searched exhaustively.
- Draftable's AI features are unconfirmed.

---

## 6. Entity resolution, record matching, dedup and normalization against a reference KB

### Takeaway
Matching messy input against a canonical catalog (SKUs, vendors, customers) is a real workflow in procurement, AP and e-commerce. The proven architecture is a hybrid: embedding or blocking shortlists candidates, then an LLM adjudicates. Pure-LLM matching degrades quickly with catalog size, and accuracy varies widely by model. Products range from classic entity-resolution SDKs (Senzing, about $58k+/yr) to LLM-era workflow tools (bem, Nanonets `llm_match`).

### Cited Findings
- bem's cookbook resolves free-text buyer order lines to catalog SKUs in one workflow call. Output includes the matched SKU and pack size, and the catalog is a "Collection" — [bem docs](https://docs.bem.ai/guide/cookbooks/match-buyer-orders-to-catalog-skus)
- Nanonets `llm_match` matches free text (an invoice vendor name, a PO line description) against a catalog synced from SAP or NetSuite. It works only with integrations that have a registered adapter — [Nanonets docs](https://agents.nanonets.com/docs/tools/llm-match)
- The TAIL zero-shot LLM title-normalization pipeline was tested on 1,200 Brazilian e-commerce pairs. Matching F1 ranged from 0.44 to 0.78 depending on the LLM, and only the best model beat TF-IDF baselines — [SBC paper](https://sol.sbc.org.br/index.php/wesaac/article/download/45245/45006/)
- Q2K (multi-agent) turns SKU mapping into generating and validating inspectable facts, with web search for fast-changing attributes — [arXiv 2509.01182](https://arxiv.org/pdf/2509.01182v2)
- A practitioner write-up (SKUai) found an LLM-only design degraded past about 50 products. v2 used pgvector embeddings to shortlist candidates before LLM judgment, because "matching and standardization are fundamentally different problems" — [SKUai](https://saifsgallery.notion.site/SKUai-321819ee4451803c81e7f5a5431e66b2)
- Bauplan shows an example of LLM entity matching between Walmart and Amazon product tables — [Bauplan docs](https://docs.bauplanlabs.com/examples/llm)
- Senzing (classic entity-resolution SDK):
  - Priced by data-source records (DSRs). Third-party listings show about $58,560/yr entry, $78,000/yr for 20M DSRs and $136,500/yr for 50M DSRs — [PricingSaaS](https://pricingsaas.com/companies/senzing); [FitGap](https://us.fitgap.com/products/senzing)
  - Ships an MCP server for AI assistants — [Senzing MCP](https://senzing.com/senzing-mcp-server/)
- Workspace analogues:
  - Airtable linked-record field agents suggest records from related tables based on context — [Airtable](https://support.airtable.com/docs/using-airtable-ai-in-fields)
  - Notion keyword autofill reuses existing multi-select options to avoid redundant tags — [XRAY](https://www.xray.tech/post/notion-ai-autofills)
  - Zendesk routes product and subscription names to "entity detection" rather than intents — [Zendesk](https://support.zendesk.com/hc/en-us/articles/8718789695002)

### Inferences
- Grey's KG extraction already produces entities, so it is one step from offering canonicalization:
  - A canonical entity table with aliases and attributes.
  - Embedding-based blocking (top-k candidates).
  - LLM adjudication returning `{canonical_id | new, score, top_candidates[{id, score}], rationale, evidence citations}`.
  - Merge and split review UI with an audit log.
- **External API:** `POST /match {record or text, entity_type, catalog=pipeline|collection}`. It is BYO-friendly because any embedding plus any LLM works, and the research shows model choice matters, so per-function model binding is important.
- **Internal benefit:** the same machinery deduplicates Grey's own KG nodes ("Acme Inc" vs "ACME Corporation"), which improves GraphRAG quality.
- Normalization against controlled vocabularies (map a free-text category onto a taxonomy) is the same thing as KB-grounded classification (section 1) with a very large label set, so retrieval-shortlisting of labels is the shared technique.

### Gaps
- No pricing found for bem or Nanonets matching.
- Tamr, Zingg, Splink, Databricks and Snowflake entity-matching features were not researched because the search budget ran out.
- No independent accuracy benchmark of commercial LLM matching APIs found.

---

## 7. Form autofill and data validation from a KB

### Takeaway
"Fill this form or questionnaire from what we already know" exists commercially in three places:
- Security and RFP questionnaires (section 4).
- Per-page "Edit/fill" APIs from IDP vendors: Reducto Edit at $60 per 1,000 pages ($15 prefilled), and Extend Edit at 1 credit/page for filling plus 2 credits/page for form detection.
- Smaller form-filler tools (ONLYOFFICE AI agent with a Knowledge tab, Instafill, browser extensions).

Validation against a KB (checking entered values against reference data) appears mostly as calculation and consistency checks inside extraction tools. There is no strong standalone category.

### Cited Findings
- Reducto Edit costs $60 per 1,000 pages, or $15 per 1,000 for fully prefilled pages — [Reducto pricing](https://reducto.ai/pricing)
- Extend Edit: filling costs 1 credit/page ($10/1k) and form detection 2 credits/page ($20/1k). Filling without a schema also runs form detection — [Extend pricing](https://www.extend.ai/pricing.md)
- ONLYOFFICE's AI agent autofills PDF form fields it has data for, asks about missing details, and can draw on documents added to a "Knowledge" tab — [ONLYOFFICE help](https://helpcenter.onlyoffice.com/ai/userguides/pdf-forms/ai-filling-forms.aspx)
- Instafill (Chrome extension and web app) fills forms from images, documents, partly filled PDFs and CSVs. It claims to compare entries against a knowledge base for accuracy and completeness (vendor claim, untested) — [Instafill (Chrome Web Store)](https://chrome.google.com/webstore/detail/instafill/ibgpnfcocajgfcbbeepgihhmjbifnige); [Instafill (DEV)](https://dev.to/instafill/what-is-instafillai-and-why-it-works-2jka)
- A DIY pattern: PyMuPDF reads PDF fields, then an LLM returns JSON field values to write back — [Kitemetric](https://kitemetric.com/blogs/automating-pdf-form-filling-with-ai-a-python-implementation)
- SafeBase AIQA suggests questionnaire answers inline in vendor portals but often needs manual copy-paste (competitor view) — [Wolfia](https://connect.wolfia.com/blog/safebase-reviews-pricing-alternatives)
- Validation examples:
  - Sensible flags failed calculation checks (line items vs subtotal, tax vs rate) with confidence, so reviewers see only exceptions — [Sensible invoices](https://www.sensible.so/extract/invoices)
  - Vanta flags KB conflicts — [Vanta](https://help.vanta.com/en/articles/11488356-vanta-questionnaire-automation-implementation-guide)

### Inferences
- **Suite synergy is direct:** Geiger Forms plus Grey could offer "prefill from project knowledge".
  - Mechanism: map each form field to a retrieval query, generate the value with a citation and confidence, and mark fields as "needs input" when the KB lacks coverage (the ONLYOFFICE ask-for-missing pattern).
  - Same machinery as extraction (section 2), but the schema comes from the form and the source is the whole KB rather than one document.
- KB-based validation of submitted form answers is a natural add-on: run the grounding check (section 4) or entity match (section 6) on each submitted value and flag mismatches against the catalog or contradictions with stored facts.
- PDF and portal write-back (bboxes, AcroForm fields, browser extension) is a separate engineering surface. Starting with Geiger-native forms avoids it.

### Gaps
- No pricing or accuracy data for Instafill or other form fillers.
- Enterprise form-prefill players (insurance applications, KYC, procurement onboarding) were not researched because the search budget ran out.

---

## 8. Generic "task endpoint" / LLM-function products (define once, call as API)

### Takeaway
"Define once, call as an API" is now standard in three families:
- IDP vendors: LlamaExtract configurations and agents, Extend versioned processors, AWS BDA blueprints and projects, Azure CU custom analyzers, Box metadata templates, Sensible SenseML configs, Unstract API deployments.
- Data platforms: Databricks AI Functions as REST endpoints, Snowflake and BigQuery SQL AI functions.
- Agent platforms: Vectara agent steps with a JSON schema, Dust's Extract Data tool, Relevance AI tools, Contextual AI templates.

RAG-first vendors are weakest here. Pinecone Assistant offers only a JSON-mode flag with no schema, and OpenAI's file_search plus strict JSON schema has reported rough edges. A KB platform that makes "typed function grounded in my pipeline" a first-class object has room to stand out.

### Cited Findings

**RAG / KB platforms**
- OpenAI file_search (Responses API):
  - Citations are `file_citation` annotations (`file_id`, `filename`, `index`) on `output_text`. Raw search results need `include: ["file_search_call.results"]`.
  - Other controls: metadata `filters` and `max_num_results`. Rate limits are 500 RPM (Build tier) and 1,000 RPM (Launch/Grow).
  - The guide does not document combining file_search with `text.format` json_schema. — [OpenAI file search guide](https://developers.openai.com/api/docs/guides/tools-file-search)
  - A forum thread (no replies) reports malformed JSON with strict json_schema plus file_search plus included results. This is unconfirmed — [OpenAI community](https://community.openai.com/tag/file-search/707)
  - Strands' Responses provider does not emit file citation annotations, so SDK support varies — [Strands docs](https://strandsagents.com/docs/api/python/strands.models.openai_responses/)
- Vectara agents:
  - Set `output_parser: structured` plus a `json_schema` per agent step. The schema constrains only the final response, and tool calls run normally mid-turn.
  - `strict` is honoured only on OpenAI-family clients and dropped for Anthropic and Vertex.
  - Vectara does not re-validate output and recommends validating at the application boundary.
  - Output arrives as one `structured_output` event (not streamed), and later steps can branch on its fields. — [Vectara structured outputs](https://docs.vectara.com/docs/agents/structured-outputs)
- Pinecone Assistant:
  - Chat has a `jsonResponse: true` flag, but no schema parameter was documented — [Pinecone TS SDK](https://sdk.pinecone.io/typescript/media/chat.md)
  - The Context API runs retrieval without generation and returns `snippets[{type, content, score, reference}]` — [Pinecone context API](https://docs.pinecone.io/reference/api/2025-01/assistant/context_assistant)
  - A separate "Context Engine" (alpha) indexes JSON documents with repository schemas — [Pinecone Context Engine](https://docs.pinecone.io/guides/context-engine/overview)
- Contextual AI launched Agent Composer on 27 January 2026. Templates include Basic and Agentic Search (self-serve) and an enterprise-only "Structured Extraction" template; the output format is not documented — [Contextual AI 2026 release notes](https://docs.contextual.ai/release-notes/2026.md); [PR Newswire](https://tools.prnewswire.com/en-us/live/20813/release/20260127EN71236). A third-party listing calls it model-agnostic (OpenAI, Anthropic, Google) — [Beri](https://www.beri.net/tools/contextual-ai)
- GroundX (EyeLevel) markets grounded answers, structured extraction and classification over ingested "buckets" — [GroundX docs](https://docs.eyelevel.ai/)
- Dust's "Extract Data" tool: select data sources, define a schema, and the agent searches and extracts matching data — [Dust docs](https://docs.dust.tt/docs/knowledge)
- Relevance AI pricing:
  - Base cost is 4 credits per tool or agent run (lower on higher plans).
  - Since 1 September 2025, credits are split into "Actions" and "Vendor Credits" passed through at cost, and bringing your own API keys avoids Vendor Credits entirely. — [Relevance AI plans](https://relevanceai.com/docs/get-started/plans)
  - Older list prices: Pro $19/mo, Team $199/mo, extra knowledge at $100/GB — [Relevance AI old pricing](https://relevanceai.com/pricing-old)

**Data platforms (typed functions as SQL or REST)**
- Databricks exposes `ai_classify` and `ai_extract` as GA REST endpoints under `/api/2.0/ai-functions/`, with versioned behaviour (`version: "2.1"`) and confidence, rationale and citation options — [Databricks AI Functions API](https://docs.databricks.com/api/ai-functions/v1); [ai_extract](https://docs.databricks.com/api/ai-functions/v1/ai-extract)
- Snowflake runs `AI_CLASSIFY`, `AI_EXTRACT` and `AI_FILTER` as SQL over tables and files on Snowflake-hosted LLMs — [Snowflake](https://docs.snowflake.com/en/user-guide/snowflake-cortex/aisql). BigQuery's managed `AI.IF`/`AI.CLASSIFY` hide model choice, and `AI.GENERATE_TABLE` uses a remote model with a custom output schema — [BigQuery](https://docs.cloud.google.com/bigquery/docs/generative-ai-overview)

**IDP "saved config" objects**
- Extend: versioned "processors" with evaluation suites — [Extend](https://docs.extend.ai/splitting/overview)
- AWS BDA: projects with up to 40 blueprints — [AWS](https://docs.aws.amazon.com/bedrock/latest/userguide/bda-custom-output-idp.html)
- Azure CU: custom analyzers, optionally trained with labelled data (advanced rate) and an agentic workflow (preview) — [Azure](https://learn.microsoft.com/en-us/azure/ai-services/content-understanding/pricing-explainer)
- Box: metadata templates — [Box](https://developer.box.com/reference/post-ai-extract-structured)
- Unstract: Prompt Studio project deployed as an API — [Zipstack](https://github.com/Zipstack)
- Sensible: SenseML configs deployed like code — [Sensible](https://www.sensible.so/compare/parseur)

### Inferences
- **Grey should introduce one primitive: a "Function" (or "Task").** All the structured patterns above are specializations of it.
  - Definition: name, input schema, output JSON Schema (with field descriptions, enums, nested or table types), instructions or policy, retrieval binding (pipeline, source filters, KG scope, reference sources such as a playbook), BYO model binding (per function), options (citations, confidence, rationale), eval set, and version.
  - Invocation surfaces:
    1. `POST /functions/{id}/run` (sync) and `/batch` (async over N sources).
    2. MCP tool, auto-exposed through Grey's existing MCP server so agents get typed tools.
    3. Matrix column.
    4. Ingest-time enrichment step, with results written as source metadata or KG properties.
    5. Geiger Flow node and webhooks.
    6. OpenAI-compatible `response_format` passthrough on the existing chat/completions endpoint.
  - Output envelope: `{output (schema-valid), citations[{source_id, chunk_id, page/bbox | timestamp, quote}], confidence (labelled uncalibrated), rationale, usage, function_version, model}`.
- **BYO implications (from the cited docs):**
  - Native JSON-schema enforcement varies by provider (Vectara's `strict` caveat), so Grey must validate, repair and retry itself.
  - Confidence scores are uncalibrated across vendors (LlamaExtract), so present them for relative ranking only, or derive them via multi-sample or dual-model agreement.
  - Many competitors bundle proprietary or managed models: Snowflake, BigQuery managed functions, Databricks, Vertex Check Grounding, Bedrock Automated Reasoning, and SaaS Reducto/Extend/LlamaExtract. Azure CU (customer's Foundry deployment), Unstract (many providers) and Relevance AI (BYO keys avoid vendor credits) show BYO works commercially.
- Relevance AI's split between "actions" and "pass-through vendor credits" is a pricing model Grey could mirror, charging per run, page or row for orchestration while the customer pays their own model provider.

### Gaps
- Not verified this session: Humanloop status, LLM-function frameworks (BAML, Marvin, Instructor beyond a mention), Langbase, Vellum, and Glean or Writer structured-output APIs.
- Not verified: what "Pinecone Nexus" (seen in a site banner) is, and whether Pinecone Assistant supports schema-constrained output.
- Not confirmed: whether OpenAI officially supports strict json_schema with file_search, and Relevance AI's current (post-September 2025) list prices.

---

## 9. Which patterns are most commercially proven, and what does Grey need to ship them?

### Takeaway
Based on the evidence above, here is the ranking by commercial proof. Grey's existing stack (parsing, transcription, chunking, embeddings, KG, per-pipeline retrieval, MCP) covers the retrieval half of all of these. The missing half is a typed-output layer: functions, schemas, citations to spans, validation, review states, evals, and batch jobs over sources.

| Rank | Pattern | Proof |
|---|---|---|
| 1 | Matrix / tabular review | Harvey, Legora, Hebbia, AlphaSense, Rogo; tens to hundreds of $M ARR |
| 2 | Schema extraction / IDP | Public per-page pricing from more than 8 vendors and all 3 hyperscalers |
| 3 | Questionnaire / RFP answering from a KB | $5k–$60k/yr tools; SafeBase about $250M exit |
| 4 | Support classification and routing | Zendesk, Intercom |
| 5 | Playbook and compliance checks | LegalOn, Norm Ai at $1.2B, AWS Automated Reasoning |
| 6 | Typed LLM functions | Databricks, Snowflake, BigQuery |
| 7 | Horizontal AI columns | Airtable, Notion, Excel, Sheets, Clay |

Less proven but strategic for Grey: KB contradiction detection, entity resolution against a KB, grounding verification, and form prefill.

### Cited Findings
- Commercial anchors:
  - Harvey: $15.5B valuation, about $300M ARR by May 2026 — [Entrepreneurloop](https://entrepreneurloop.com/harvey-ai-valuation-15-5b/)
  - Legora: $100M ARR in about 18 months — [TNW](https://thenextweb.com:443/news/legora-just-hit-100-million-in-revenue-it-took-18-months)
  - Rogo: about $2B valuation, 250+ financial firms — [FinTech Global](https://fintech.global/2026/04/29/rogo-raises-160m-series-d-to-scale-finance-ai-platform/)
  - Hebbia: estimated $3k–$10k per seat per year — [Metronome](https://metronome.com/pricing-index/hebbia)
  - Norm Ai: $1.2B valuation — [Let's Data Science](https://letsdatascience.com/news/norm-ai-raises-120m-for-legal-ai-agents-c3604243)
  - SafeBase: about $250M acquisition — [SC World](https://www.scworld.com/brief/drata-acquires-safebase-for-250m)
  - Loopio: median about $23.7k/yr — [KI-Syndikat](https://www.ki-syndikat.de/tools/loopio/)
- Extraction per-1,000-page list prices:
  - Extend: $7–$50 — [Extend](https://www.extend.ai/pricing.md)
  - Reducto: $20–$40 — [Reducto](https://reducto.ai/pricing)
  - Google custom extractor: $30 — [Google](https://cloud.google.com/document-ai)
  - AWS BDA custom: $40 — [AWS](https://aws.amazon.com/bedrock/pricing/)
  - Azure CU contextualization: $1–$3 plus the customer's own LLM tokens — [Azure](https://learn.microsoft.com/en-us/azure/ai-services/content-understanding/pricing-explainer)
- Caution signal: Robin AI (contract review) went into a distressed sale in late 2025 despite the category's growth — [Legal Technology](https://legaltechnology.com/robin-ai-listed-for-distressed-sale-nine-months-after-making-the-sunday-times-100-tech-list/)

### Inferences
- **Recommended build order for Grey, given BYO and the suite:**
  1. A generic Function primitive (typed output plus citations plus validation), exposed via REST, MCP and Flow.
  2. Extraction functions run at ingest, writing to source metadata and the KG.
  3. A Matrix view (sources or entities × functions), shared with Geiger Notes databases.
  4. KB-grounded classification (labels plus policy plus retrieved examples) with routing webhooks.
  5. A grounding and claim-verification endpoint, which also hardens chat.
  6. Questionnaire answering (matrix with question rows, plus an answer library and export).
  7. KG-powered contradiction detection and entity canonicalization.
  8. Forms prefill.
- **Cross-cutting requirements:**
  - Span- and bbox-level citations preserved from parsing (and timestamps for audio and video).
  - A provider-agnostic structured-output adapter with validate, repair and retry.
  - Confidence, explicitly uncalibrated.
  - Review states: edited, verified, flagged, locked, with human edits overriding AI.
  - Versioned function definitions with eval sets.
  - Async batch jobs with per-cell refresh and cost estimates before runs (BYO tokens are the user's money).
  - Per-function model selection.
- **Differentiation versus RAG competitors** (Pinecone Assistant, OpenAI file_search, Vectara): none offers a matrix, KB-grounded classification with citations, or contradiction detection. Versus IDP vendors (Reducto, Extend, LlamaExtract): they extract one document at a time and are not KB- or graph-aware. Versus vertical tools (Harvey, Hebbia): they are closed, sold per seat at high prices, and use their own model choices. A BYO, per-project, suite-integrated version addresses a different (SMB or mid-market, multi-vertical) buyer.

### Gaps
- No direct customer-demand data (surveys, Hacker News or Reddit threads) was gathered on "structured outputs from my KB", because the search budget ran out before community sources could be mined.
- Seat pricing for the legal and finance matrix tools is third-party estimated only.
- No data on what share of Harvey, Legora or Hebbia usage comes from tables or matrices versus chat.
