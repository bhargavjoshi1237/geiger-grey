# RAG / Knowledge-Base-as-a-Service: Market, Pain Points, Gaps and Differentiating Features for Geiger Grey

Research date: 2026-10-10. Items older than ~12 months are flagged "[dated]". Market-research-firm numbers (MarketsandMarkets, Mordor, etc.) are model-based estimates; treat as directional only.

---

## 1. Market size and 2025–2026 trends (agentic RAG, deep research, MCP, context engineering, long-context vs RAG, multimodal, memory)

### Takeaway
Enterprise GenAI spend tripled to ~$37B in 2025, and buyers now mostly *buy* rather than build (76%). RAG remains the second most common architecture after prompt design. The 2026 framing has shifted from "RAG" to "context engineering": retrieval is one input alongside memory, tools (MCP) and long context, and is increasingly consumed by agents rather than chat UIs. The standalone "RAG market" is small (~$2B in 2025) and is being absorbed into hyperscaler APIs and suite products.

### Cited Findings
- Enterprise GenAI spend reached $37B in 2025, up 3.2x from $11.5B in 2024 ($1.7B in 2023). Split: $19B applications (51%) vs $18B infrastructure (49%). [dated: Dec 2025 report, latest edition found] — [Menlo Ventures 2025 State of GenAI in the Enterprise](https://menlovc.com/perspective/2025-the-state-of-generative-ai-in-the-enterprise/)
- In 2025, 76% of enterprise AI solutions were purchased rather than built, up from 53% in 2024. — [Menlo Ventures](https://menlovc.com/perspective/2025-the-state-of-generative-ai-in-the-enterprise/); [GlobeNewswire release](https://www.globenewswire.com/news-release/2025/12/09/3202258/0/en/Menlo-Ventures-2025-State-of-Generative-AI-Report-Enterprise-Investment-Hit-37B-in-2025-Tripling-in-One-Year)
- Prompt design is the dominant technique, RAG is second. "True agents" are only 16% of enterprise deployments (27% at startups). Copilots hold 86% ($7.2B of $8.4B) of horizontal AI spend. — [Menlo Ventures](https://menlovc.com/perspective/2025-the-state-of-generative-ai-in-the-enterprise/)
- Departmental AI spend ($7.3B): coding $4.0B (55%), IT ops $700M, marketing $660M, customer support $630M, design 7%, HR 5%. — [Menlo Ventures](https://menlovc.com/perspective/2025-the-state-of-generative-ai-in-the-enterprise/)
- Enterprise LLM API share (2025): Anthropic 40%, OpenAI 27%, Google 21%, others 12%. Relevant to "bring your own LLM": buyers spread across several providers. — [Menlo Ventures](https://menlovc.com/perspective/2025-the-state-of-generative-ai-in-the-enterprise/)
- About 47% of AI pilots reach production, versus about 25% for conventional software. — [Yahoo Finance / Menlo release](https://finance.yahoo.com/news/menlo-ventures-2025-state-generative-123000623.html)
- RAG market estimate: $1.94B (2025) rising to $9.86B (2030), 38.4% CAGR (MarketsandMarkets). Other firms say $1.92B to $10.2B at 39.66% CAGR, or $2.0B (2026) to $11.0B (2030) at 49.1%. US market is $558.8M in 2025. — [Yahoo/MarketsandMarkets](https://finance.yahoo.com/news/retrieval-augmented-generation-rag-market-141500359.html); [Mordor Intelligence](https://www.mordorintelligence.com/industry-reports/retrieval-augmented-generation-market); [Research and Markets](https://www.researchandmarkets.com/reports/6182071/retrieval-augmented-generation-rag-market); [MarketsandMarkets US](https://www.marketsandmarkets.com/Market-Reports/geography/retrieval-augmented-generation-rag-market/us)
- RAG-as-a-Service funding reportedly grew from $230M (H1 2025) to $510M (H1 2026). The same source says $2.3B was raised by RAG-sector startups in H1 2026. **Low confidence:** this is a vendor blog with no primary data cited. — [Ailog "RAG Startups to Watch in 2026"](https://app.ailog.fr/en/blog/news/rag-startups-watch)
- Context engineering = instructions + retrieval (RAG) + memory (short and long term) + tools, with tools "increasingly standardized via MCP". — [Sourcegraph: Context Engineering guide (2026)](https://sourcegraph.com/blog/context-engineering); [arXiv survey of context engineering](https://arxiv.org/pdf/2507.13334)
- "RAG isn't dead, but context engineering is the new hotness." — [The New Stack](https://thenewstack.io/rag-isnt-dead-but-context-engineering-is-the-new-hotness/)
- RAGFlow's 2025 year-end review makes these points:
  - It argues for "retrieval-first, long-context containment" rather than long context replacing RAG. Stuffing whole documents causes "Lost in the Middle" effects and costs that grow non-linearly.
  - RAG is repositioning as infrastructure that serves agents ("context assembly" across domain knowledge, tool metadata and conversation history).
  - Memory and RAG form one data foundation. Tool retrieval (choosing among hundreds of MCP tools) is itself a retrieval problem.
  - GraphRAG has "massive token consumption" during entity extraction (several to dozens of times the original text), and auto-extracted graphs fall short of curated ones.
  - Multimodal RAG "lagged 2024 predictions" because of storage and compute costs.
  - 2026 focus is predicted to be "pragmatic, large-scale adoption and ROI".
  
  [RAGFlow: From RAG to Context, 2025 review](https://ragflow.io/blog/rag-review-2025-from-rag-to-context)
- Contract review and other latency-tolerant use cases began experimenting with feeding whole document sets into long-context windows in 2025. — [Medium: RAG, MCP, Tool Calling, Agents, or Long Context?](https://medium.com/@mrschneider/rag-mcp-tool-calling-agents-or-long-context-ca53a9cb43ca); [SmartScope: Context Engineering design guide 2026](https://smartscope.blog/en/blog/context-engineering-overview/)
- Deep research over private data is now table stakes in consumer tools. NotebookLM/Gemini Notebook offers "Fast Research" (a list of sources) and "Deep Research" (reads the sources and writes a report). In July 2026 it added per-notebook code execution on a "secure cloud computer". — [Jeff Su, NotebookLM in 2026](https://www.jeffsu.org/notebooklm-changed-completely-heres-what-matters-in-2026/); [Google blog, July 16 2026](https://blog.google/innovation-and-ai/products/gemini-notebook/notebooklm-gemini-notebook/)
- Multimodal managed RAG is now in hyperscaler APIs: the Gemini API File Search tool has a multimodal RAG developer guide. — [Google AI dev.to guide](https://dev.to/googleai/multimodal-rag-with-the-gemini-api-file-search-tool-a-developer-guide-5878)

### Inferences
- The addressable market for a pure "RAG API" is small and is being commoditised (see section 6). The value sits in apps and workflows: about 51% of spend goes to applications, and 76% of buyers buy. That favours Grey's suite-integrated positioning over competing as raw infrastructure.
- Grey should position its RAG API as a **context endpoint for agents** (MCP server plus REST), not only as a chat UI. Agents are the growing consumer, and MCP is the default way to plug knowledge into Claude, ChatGPT, Cursor and similar tools.
- The knowledge graph is a differentiator, but extraction cost is real (several to dozens of times the source tokens). Make graph building an optional ingestion setting with a visible cost estimate, which fits the plan to meter AI usage separately.
- The mixed LLM market (Anthropic, OpenAI and Google all at 20% or more) supports "connect your own LLM" as a real buyer need.

### Gaps
- No 2026 edition of Menlo's enterprise report was found (the latest is Dec 2025). a16z's 2026 enterprise CIO survey was not retrieved.
- No reliable primary source was found for MCP adoption statistics (number of servers, enterprise adoption rates).
- No reliable figures were found on the memory-layer startup market (Mem0, Zep, Letta) or its funding.

---

## 2. Why RAG projects fail and what buyers complain about

### Takeaway
Failures cluster around data, not models: poor data quality and parsing (tables, scanned PDFs), stale content, permissions leakage, no evaluation, and costs that are unpredictable or keep rising. Gartner says at least 50% of GenAI projects were abandoned after proof of concept by the end of 2025, citing data quality, risk controls, cost and unclear value. The most fixable gaps for a new entrant are ingestion quality, freshness, eval and trust UX.

### Cited Findings
- Gartner predicted (Jul 2024) that at least 30% of GenAI projects would be abandoned after PoC by end of 2025 because of "poor data quality, inadequate risk controls, escalating costs or unclear business value". [dated] — [BigDATAwire](https://www.hpcwire.com/bigdatawire/this-just-in/gartner-predicts-30-of-generative-ai-projects-will-be-abandoned-after-proof-of-concept-by-end-of-2025/)
- Gartner later reported that "by the end of last year, over 50% of GenAI projects were abandoned after the proof-of-concept stage", citing the same four causes. — [Gartner on X](https://x.com/Gartner_inc/status/2067623145960305095); [Gartner: Why Half of GenAI Projects Fail](https://www.gartner.com/en/articles/genai-project-failure)
- Gartner predicts over 40% of agentic AI projects will be canceled by end of 2027, and warns of "agent washing" (only about 130 of thousands of agentic vendors are "real"). [dated: Jun 2025 prediction] — [BigDATAwire](https://www.hpcwire.com/bigdatawire/this-just-in/gartner-predicts-over-40-of-agentic-ai-projects-will-be-canceled-by-end-of-2027/)
- Production failure modes named by practitioners:
  - Connectors that drop permissions
  - Chunking that destroys tables and charts
  - Single-shot retrieval that can't do multi-hop reasoning
  - No evaluation
  - The "freshness gap": old chunks win on semantic similarity because the retriever ignores ingestion timestamps
  - Answers sitting in a table "on page 14" that parsers flatten into pipe characters
  - A claim that ~70% of production RAG teams have no systematic retrieval eval. **Unverified blog stat**, and the headline "70% fail before production" is also unsourced.

  [DEV Community: 70% of Enterprise RAG deployments fail](https://dev.to/gabrielanhaia/70-of-enterprise-rag-deployments-fail-before-production-heres-what-kills-them-26ml); [Atolio Enterprise RAG guide 2026](https://www.atolio.com/blog/enterprise-rag-guide); [Appinventiv](https://appinventiv.com/blog/why-rag-systems-fail/)
- Access-control bugs in application-layer filter logic are "among the most severe and hardest-to-detect failures". — [Atolio](https://www.atolio.com/blog/enterprise-rag-guide)
- On HN, practitioners call document parsing "the hardest part", especially tables spanning pages, charts and footnotes. Many complex PDF table formats are "barely human-readable". — [Ask HN: parsing PDFs for RAG](https://news.ycombinator.com/item?id=41072632); [Show HN: PDF parser comparison for RAG](https://news.ycombinator.com/item?id=46120828); [HN: Just use images for RAG](https://news.ycombinator.com/item?id=44637715)
- A Fortune 500 RAG build (50M records) treated vectors as supplementary to text (hybrid) search, embedded whole PDF pages instead of chunking, and tracked document name and page for citations. Eval started with 10–20 SME-written Q&A pairs. It reached 90% five-star approval with 10–30 second latency. [dated: Mar 2025] — [Ask HN: Lessons from a Fortune 500 RAG chatbot](https://news.ycombinator.com/item?id=43420170)
- Glean reviewers complain about:
  - High cost, especially because broad per-seat rollout is needed for it to "work"
  - Heavy IT setup, needing admin access to every connected tool
  - Confusing permission-filtered results ("I know it exists but can't open it")

  [G2 Glean pros and cons](https://www.g2.com/products/glean-technologies-glean/reviews?qs=pros-and-cons); [Slite Glean review](https://slite.com/learn/glean-ai-review); [Cybernews Glean review](https://cybernews.com/ai-tools/glean-ai-review/)
- Guru's differentiator against staleness is SME verification: owners are prompted on a schedule, and unverified cards are visibly marked. — [Guru verification feature](https://www.getguru.com/features/verification); [Bunnydesk Guru review](https://bunnydesk.ai/blog/guru-ai-review/)
- Cost unpredictability with credit meters:
  - Chatbase replies cost 1–6 credits depending on model, and the bot "stops responding once credits run out" unless auto-recharge is on.
  - Atlassian Rovo pauses at the credit cap unless extra usage is enabled.

  [SiteGPT Chatbase review](https://sitegpt.ai/blog/chatbase-review); [IV Consulting pricing comparison, Sep 2026](https://ivconsulting.in/blogs/atlassian-rovo-vs-notion-ai-vs-clickup-brain-credits/)
- Vendor lock-in and offboarding risk: Carbon.ai's managed API shut down on 31 Mar 2025 after Perplexity acquired it, forcing customers to migrate. — [HN thread](https://news.ycombinator.com/item?id=42452009); [SiliconANGLE](https://siliconangle.com/2024/12/18/perplexity-ai-gets-500m-funding-immediately-spends-buy-rag-startup-carbon/)

### Inferences
- Map each pain point to a visible Grey feature (details in section 4):
  - Parsing quality: a parse-preview and correction step
  - Staleness: freshness, owners and verification
  - Permissions: inherit suite ACLs natively
  - Eval: a built-in eval set and dashboard
  - Cost: estimates before ingestion plus hard and soft caps
  - Lock-in: export of chunks, embeddings and graph
- Credit meters that silently pause are a known complaint. If Grey meters AI usage, it should default to soft caps with alerts and graceful degradation (for example, retrieval-only answers) rather than a hard stop on public widgets.
- Hybrid search, page-level citations and SME golden sets are proven practitioner patterns, which are cheap to adopt and easy to message.

### Gaps
- No primary survey data was found with a ranked list of RAG buyer complaints. Evidence is practitioner blogs, HN and G2 summaries.
- Raw hallucination-rate benchmarks for hosted RAG products (for example, Vectara's HHEM leaderboard) were not retrieved.

---

## 3. NotebookLM / Gemini Notebook feature set and the user expectations it sets

### Takeaway
NotebookLM has defined the consumer and prosumer mental model for "upload sources, ask grounded questions, generate outputs". It was renamed Gemini Notebook on 16 Jul 2026 and has 30M+ users and 600K+ organisations. Grey's baseline UX will be judged against it: citations to source passages, one-click "Studio" outputs (audio, video, mind map, slides, reports, quizzes), deep research and now code execution. NotebookLM is weak on API access, BYO-LLM, team workflows and embedding answers elsewhere, which is where Grey can differentiate.

### Cited Findings
- On 16 Jul 2026, NotebookLM was renamed Gemini Notebook (now at notebook.google.com, with redirects). It has "over 30 million individual users and 600,000+ organizations". Every notebook gets a "secure cloud computer" that writes and runs code on sources. It is integrated with the Gemini app, with Google Search AI Mode integration upcoming. It ships first to AI Ultra and Workspace tiers, rolling out to Pro. — [Google blog](https://blog.google/innovation-and-ai/products/gemini-notebook/notebooklm-gemini-notebook/); [Workspace Updates](https://workspaceupdates.googleblog.com/2026/07/notebooklm-now-gemini-notebook.html)
- Studio outputs:
  - Reports (briefing docs)
  - Slide Decks (generated as images and not editable, though revisions can be requested; PPTX export is mentioned elsewhere)
  - Infographics
  - Mind Maps (interactive; clicking a node opens grounded chat on that topic)
  - Data Tables (structured extraction)
  - Video Overviews (narrated slides)
  - Quizzes and Flashcards
  - Audio Overviews

  Brand guidelines can be uploaded as a source to style outputs. — [Jeff Su, Mar 2026](https://www.jeffsu.org/notebooklm-changed-completely-heres-what-matters-in-2026/); [XDA](https://www.xda-developers.com/created-a-personal-knowledge-hub-in-notebooklm/); [DigitalOcean](https://www.digitalocean.com/resources/articles/what-is-notebooklm)
- Video Overviews are narrated slides that pull images, diagrams, quotes and numbers from the documents. They support about 80 languages, and a "cinematic" mode was also announced. — [Google blog: Video Overviews and upgraded Studio](https://blog.google/innovation-and-ai/models-and-research/google-labs/notebooklm-video-overviews-studio-upgrades/); [DigitalOcean](https://www.digitalocean.com/resources/articles/what-is-notebooklm)
- The sources panel supports web search, Drive search and Deep Research for discovering sources, and chat supports custom instructions. — [Jeff Su](https://www.jeffsu.org/notebooklm-changed-completely-heres-what-matters-in-2026/)

### Inferences
- Expectations NotebookLM has made standard, which Grey must meet:
  - Inline citations that open the exact source passage, page or timestamp
  - Multi-format ingestion (PDF, audio, video, web, Drive)
  - Auto-generated overviews such as a mind map or summary
  - A "studio" of outputs
- Gaps in NotebookLM that Grey can exploit (inferred; no source lists these as gaps):
  - No public RAG API, MCP endpoint or BYO-LLM
  - No embeddable widget for websites or support
  - No eval, analytics or admin governance for teams
  - No structured knowledge graph users can edit (its mind map is a generated view, not an editable graph)
  - Tied to the Google ecosystem
- Grey's knowledge graph and mind map should be interactive the way NotebookLM's is: clicking a node opens grounded chat. Users will expect this.

### Gaps
- Current NotebookLM/Gemini Notebook source limits and pricing tiers as of Oct 2026 were not confirmed.
- Whether Gemini Notebook exposes an API or MCP endpoint was not confirmed. None was found.

---

## 4. Customer segments that buy hosted RAG, and differentiating features a new entrant could ship

### Takeaway
The clearest SMB willingness to pay is in **customer-support and website chatbots trained on your content**. Chatbase charges $40–$500/mo and CustomGPT $99–$499/mo, typically with message-credit metering. Internal knowledge or enterprise search is dominated by expensive enterprise tools (Glean at roughly $50–75/user/mo, ~$60K minimums) or by suite-bundled AI. Research and analyst use cases are anchored by free or cheap NotebookLM. Agencies and SMBs are underserved between these poles. A ~$15/mo Grey add-on sits far below the support-bot price points, which leaves room for usage-based upsell.

### Cited Findings
- Chatbase pricing (2026): Free (50 credits), Hobby $40 (700 credits), Standard $150 (4,000), Pro $500 (15,000). Auto-recharge is $40 per 1,000 credits, extra agents are $25/mo, and removing branding is $99/mo. It deploys to web, WhatsApp, Slack, Shopify and voice. — [SiteGPT Chatbase review](https://sitegpt.ai/blog/chatbase-review); [SiteGPT 11-platform pricing comparison](https://sitegpt.ai/blog/ai-chatbot-pricing-comparison)
- CustomGPT: Standard $99/mo (1,000 queries) and Premium $499/mo, with 2,500 extra queries for $375/mo. — [SiteGPT pricing comparison](https://sitegpt.ai/blog/ai-chatbot-pricing-comparison); [Boei per-message comparison](https://boei.help/blog/ai-chatbot-message-credits-pricing-comparison/)
- Glean: quote-based, typically about $50–75/user/mo, with a minimum annual contract around $60K and ~100 seats. — [IV Consulting / GoSearch summaries via search](https://www.gosearch.ai/blog/the-best-atlassian-rovo-alternatives-in-2026/); [Cybernews](https://cybernews.com/ai-tools/glean-ai-review/) (third-party estimates, not list prices)
- Customer support is a $630M departmental AI category, and IT ops is $700M (2025). — [Menlo Ventures](https://menlovc.com/perspective/2025-the-state-of-generative-ai-in-the-enterprise/)
- Guru targets support and enablement teams with verified knowledge cards. — [Bunnydesk](https://bunnydesk.ai/blog/guru-ai-review/)
- Enterprise RAG platform comparisons in 2026 are framed "compliance-first" (legal, regulated). A 2026 arXiv paper describes "naive RAG to deep agentic retrieval" for regulatory compliance. — [Sphere: 12 best enterprise RAG platforms 2026](https://www.sphereinc.com/blogs/best-enterprise-rag-platforms-2026); [arXiv 2607.24791](https://arxiv.org/pdf/2607.24791)
- Ragie, a RAG-as-a-service API (seed $5.5M), has about 7 employees per a 2026 profile. It markets a migration path for Carbon customers. Vectara has raised $53.5M+ (seed plus Series A; one source claims a $75M Series B, unverified) and has about 60 employees. — [VentureBeat](https://venturebeat.com/business/ragie-debuts-enterprise-rag-as-a-service-raises-5-5m-seed); [Ragie for Carbon customers](https://www.ragie.ai/carbon); [BigDATAwire Vectara](https://www.hpcwire.com/bigdatawire/this-just-in/vectara-secures-25m-series-a-funding-to-advance-rag-trustworthiness-with-new-mockingbird-llm/); [Tracxn Ragie](https://tracxn.com/d/companies/ragie/__ouO3CdjThofC4vYM2gg2H62VIDJBL9AVa1OZ38kJcuo)

### Inferences: segment fit for Grey
- **Agencies (strong fit):** they manage many client knowledge bases, which maps to Flow projects. They need white-label widgets, per-client isolation and resale margin. Chatbase charges $99/mo just to remove branding, so white-label is monetisable.
- **SMB support teams (strong fit):** an embeddable Q&A or support bot on Content-powered sites, with deflection analytics, competing with Chatbase at a lower suite-bundled price.
- **Internal knowledge for SMB/mid-market (good fit):** Glean is out of reach under 100 seats. Grey can offer permission-aware Q&A over Notes, Flow, Chat and Assets with no connector setup.
- **Research and content teams (moderate fit):** NotebookLM-style workflows plus scheduled digests and publish-to-Content.
- **Legal and regulated (weak fit at $15/mo):** requires compliance, audit logs, data residency and SSO. Defer or offer as an enterprise tier.

### Inferences: differentiating features (ranked by evidence of pain and suite leverage)
1. **Zero-connector ingestion from the suite.** Auto-sync Notes, Assets, Content entries, Chat channels and Flow tasks into Grey, with permissions inherited from the source app. This addresses the Glean setup and permission complaints and Atolio's "connectors drop permissions" failure.
2. **Parse preview and fix.** Show how each PDF, table, slide or audio transcript was parsed, and let users correct tables or choose page-level versus semantic chunking before indexing. This addresses the HN "parsing is the hardest part" complaint.
3. **Freshness and verification layer.** Owners, review dates and "verified" badges (Guru-style), recency weighting, auto re-ingest on source edit, and stale-content alerts. This addresses the freshness gap.
4. **Cite-and-link to source assets.** Citations jump to the exact page, timestamp or region in Assets, Notes or Content, which matches NotebookLM expectations and the Fortune 500 page-level pattern.
5. **Built-in eval dashboard.** Golden Q&A sets (seeded from FAQs or Forms), retrieval hit-rate, groundedness, unanswered-question log and regression runs on re-ingest. This addresses the "no eval" failure and the "unclear business value" reason Gartner gives for abandonment.
6. **Cost transparency.** Ingestion cost estimates (especially for graph extraction), per-KB usage, soft caps, alerts and BYO-LLM keys. This addresses credit-pause complaints and Gartner's "escalating costs".
7. **MCP server plus RAG API per knowledge base**, with scoped keys, so agents in Claude, ChatGPT, Cursor or Copilot Studio can use Grey as context. This follows the context-engineering and agentic trend.
8. **Editable knowledge graph with grounded chat per node.** It exceeds NotebookLM's generated mind map, and Forms can push entities into it (a light CRM or entity registry).
9. **Studio outputs routed into the suite.** Reports go to Notes, slide or brief drafts to Content, audio or video overviews to Assets, digests to Campaign email, and action items to Flow tasks.
10. **Scheduled research digests.** "Deep research over private data plus web" on a cron, posted to Chat or emailed via Campaign.
11. **Portability and exit guarantee.** Export chunks, embeddings, graph and eval sets. This is a direct response to the Carbon.ai shutdown lesson.

### Gaps
- No reliable data was found on the share of hosted-RAG revenue by segment (agencies vs support vs legal).
- No pricing was found for agency-focused white-label RAG tools beyond Chatbase's branding add-on.

---

## 5. How integrated suites bundle knowledge and RAG, and what that implies for Grey

### Takeaway
Suites are bundling knowledge Q&A into the base seat and metering only "autonomous" or agentic work:
- Notion AI is included in Business at $20/user.
- Atlassian Rovo is bundled into paid Jira and Confluence plans with pooled credits.
- ClickUp Brain is a $9 add-on with credits.
- Microsoft requires a Copilot license for SharePoint-grounded agents.
- Google bundles Gemini Notebook into AI Pro and Ultra.

"Ask your workspace" is becoming free-with-seat, so Grey's $15 add-on must deliver capabilities beyond basic workspace Q&A: the external API/MCP, embeddable widgets, multimodal media KBs, graph, eval and BYO-LLM.

### Cited Findings
- Notion AI is fully included in the Business plan ($20/member/mo), including AI Meeting Notes and Enterprise Search across workspace and connected apps. Free and Plus get a capped trial. — [eesel Notion pricing](https://www.eesel.ai/blog/notion-pricing); [Layer3 Labs](https://www.layer3labs.io/guides/notion-ai-pricing)
- Pricing details as of Sep 2026:
  - **Notion:** core interactive AI is unmetered. Credits are drawn only by Custom Agents and by "Workers" (from 15 Oct 2026), at $10 per 1,000 credits overage. Quote: "Everyday AI comes with the seat, so occasional users cost nothing extra."
  - **Atlassian Rovo:** bundled with Standard seats ($7.91 Jira / $5.42 Confluence). It gets 25 credits/user/month pooled; a basic question costs 10 credits. Overage of $0.01/credit begins 3 Dec 2026, and usage pauses at the cap unless extra usage is enabled.
  - **ClickUp Brain:** a $9 add-on on a $19 seat, with 1,500 credits/user/month and $10 per 10,000 credits overage.
  - **Cost for 10 users asking one question per working day:** Rovo ~$153/mo, Notion $200, ClickUp $280.

  [IV Consulting, prices verified 16 Sep 2026](https://ivconsulting.in/blogs/atlassian-rovo-vs-notion-ai-vs-clickup-brain-credits/)
- Rovo's core experience is included at no extra per-user cost in paid Atlassian cloud plans. — [GoSearch Rovo alternatives 2026](https://www.gosearch.ai/blog/the-best-atlassian-rovo-alternatives-in-2026/); [The AI Agent Index: Rovo](https://theaiagentindex.com/agents/atlassian-rovo)
- Microsoft: SharePoint-grounded Copilot agents (built in Copilot Studio or Agent Builder) answer with citations using only SharePoint content the user can access. SharePoint and OneDrive knowledge sources require a Microsoft 365 Copilot license. "Knowledge Agent in SharePoint" launched in public preview for content management. — [Microsoft Learn: knowledge sources](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/knowledge-sources); [Copilot Studio knowledge sources](https://learn.microsoft.com/en-us/microsoft-copilot-studio/knowledge-copilot-studio); [SharePoint blog: Knowledge Agent](https://techcommunity.microsoft.com/blog/spblog/introducing-knowledge-agent-in-sharepoint/4454154)
- Glean is enterprise-only (see section 4). Guru differentiates on verification rather than search breadth. — [Coworker: Guru vs Glean](https://coworker.ai/blog/guru-vs-glean); [Techplustrends](https://techplustrends.com/guru-vs-glean-2026-enterprise-ai-knowledge-tools/)
- Google Gemini Notebook is bundled with Google AI Pro/Ultra and Workspace tiers, and is integrated with the Gemini app. — [Google blog](https://blog.google/innovation-and-ai/products/gemini-notebook/notebooklm-gemini-notebook/)
- Menlo found copilots take 86% of horizontal AI spend, meaning suite-embedded assistants dominate. — [Menlo Ventures](https://menlovc.com/perspective/2025-the-state-of-generative-ai-in-the-enterprise/)

### Inferences
- **Pricing implication:** competitors bundle "ask questions about your workspace" into the seat. Grey should consider including basic suite Q&A (over Notes, Flow and others) in Dash or base plans as table stakes. The $15/mo add-on should then be reserved for:
  - Uploaded media KBs
  - Graph
  - External API, MCP and widgets
  - Eval
  - BYO-LLM
- AI usage should be metered Notion-style: interactive use is cheap or included, and agents, digests, deep research and public widget traffic draw credits.
- **Avoid hard pauses** (Rovo's "continuity trap"). Support widgets on public Content sites must not go dark mid-month.
- **The suite moat is cross-app context**, as with Rovo and Jira or Copilot and SharePoint. Grey's edge over Notion and ClickUp would be multimodal media (Assets audio and video), structured Forms-to-graph data, and publishing answers outward (Content widgets, Campaign digests). Notion, Rovo and Copilot are inward-facing.
- Microsoft's permission model (agents search only what the user can access) is the bar. Grey must enforce suite ACLs at retrieval time, not only in the UI.

### Gaps
- Coda Brain and current ClickUp Brain knowledge or connector feature details were not retrieved. Coda was acquired by Grammarly/Superhuman in 2024–2025, and its current status was not verified in this session.
- No confirmed 2026 pricing for Microsoft 365 Copilot ($30/user/mo historically [dated]) or Glean list prices was retrieved from primary sources.

---

## 6. RAG startup failures, shutdowns and commoditisation lessons

### Takeaway
Pure RAG plumbing is being commoditised by model providers:
- Gemini File Search charges $0.15 per 1M tokens to index, with free storage and free query-time retrieval.
- OpenAI file search charges $0.10/GB/day, with the first GB free.

Carbon.ai's acqui-hire and API shutdown shows the risk for thin RAG middleware and for its customers. Survivors differentiate on trust (Vectara: hallucination and grounding), developer UX (Ragie) or verticalisation.

### Cited Findings
- Carbon (JDCT Inc.), a RAG connector and ingestion API, was acquired by Perplexity in Dec 2024. Its managed API shut down on 31 Mar 2025, and its four employees joined Perplexity. Customers were given about 3 months to offboard. [dated] — [SiliconANGLE](https://siliconangle.com/2024/12/18/perplexity-ai-gets-500m-funding-immediately-spends-buy-rag-startup-carbon/); [HN discussion](https://news.ycombinator.com/item?id=42452009); [VentureBeat](https://venturebeat.com/ai/perplexitys-carbon-integration-will-make-it-easier-for-enterprises-to-connect-their-data-to-ai-search)
- Competitors immediately marketed migration offers: Ragie's "Ragie for Carbon Customers" page and the open-source Supavec. — [Ragie](https://www.ragie.ai/carbon); [Supavec intro](https://www.abdulazizahwan.com/2025/02/introducing-supavec-an-open-source-powerful-rag-alternative-to-carbonai.html)
- Gemini API File Search is a fully managed RAG service (chunking, embeddings, injection):
  - Indexing costs $0.15 per 1M tokens. Storage and query-time retrieval are free.
  - Storage limits are 1 GB (free tier) to 1 TB (Tier 3), with a 100 MB per-file cap.
  - Commentators called it "the end of homebrew RAG?".

  [Google blog](https://blog.google/innovation-and-ai/technology/developers-tools/file-search-gemini-api/); [Analytics Vidhya, May 2026](https://www.analyticsvidhya.com/blog/2026/05/gemini-api-file-search/); [Medium: end of homebrew RAG?](https://medium.com/the-low-end-disruptor/google-gemini-file-search-the-end-of-homebrew-rag-1aa1529839fd)
- OpenAI file search vector storage costs $0.10/GB/day with the first GB free. Limits are 512 MB per file, 5M tokens per file, 10K files per vector store and 100 GB per project. — [OpenAI Assistants API v2 FAQ](https://help.openai.com/en/articles/8550641-assistants-api-v2-faq)
- Vectara has raised $53.5M+ and positions on RAG "trustworthiness" (its Mockingbird LLM and hallucination detection). — [BigDATAwire](https://www.hpcwire.com/bigdatawire/this-just-in/vectara-secures-25m-series-a-funding-to-advance-rag-trustworthiness-with-new-mockingbird-llm/)
- An unverified claim says Ragie and others are "actively migrating Vectara customers with discounted onboarding". The source is unclear and no primary confirmation was found. — [search summary of Tracxn/Ailog pages](https://app.ailog.fr/en/blog/news/rag-startups-watch)

### Inferences
- Grey should not compete on the price of chunk, embed and store; hyperscalers make that nearly free. Grey can even use Gemini or OpenAI file search as a backend option for BYO-LLM users. Value must be in the workflow, the suite data, trust and eval, and outputs.
- Lessons from Carbon:
  - Customers fear being stranded, so offer export guarantees and documented data-portability.
  - Thin connector middleware is acquisition fodder, not a durable business.
  - Grey's native suite data is a connector advantage that external RAG APIs can't copy.
- Lead marketing with outcomes (support deflection, research briefs, client knowledge portals for agencies) rather than "RAG".

### Gaps
- No comprehensive list of 2025–2026 RAG startup shutdowns beyond Carbon was found. Other casualties likely exist but were not verified.
- Current (Oct 2026) OpenAI file search pricing was not reconfirmed. The FAQ figure may be older [possibly dated].
