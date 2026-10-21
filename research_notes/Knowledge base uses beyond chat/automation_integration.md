# Automation, agent and integration surfaces for a knowledge base (state of market, October 2026)

Scope: the ways ingested knowledge is put to work by events, workflows, other apps and agents, rather than a person typing into a chat box. Grey baseline (verified by scanning this repo, `lib/server/mcp/tools.js`): the MCP server already exposes `search`, `ask`, `get_entity` and `list_sources`. HTTP has `/retrieve`, an OpenAI-compatible `chat/completions` per pipeline, and a widget. The scan found no outbound webhook, trigger or schedule code. All models are bring-your-own (BYO).

Research note: the shared web-search budget ran out partway through. Community sentiment from Reddit and Hacker News, browser-extension and IDE-context products, and a few vendor docs could not be checked. Those items are listed under Gaps.

---

## 1. Event-driven knowledge actions (on ingest, on content change, on schedule, on external webhook)

### Takeaway
Event triggers on agents became a standard feature between 2025 and 2026. Glean, Dust, Notion Custom Agents, Copilot Studio, Atlassian Rovo (through Automation), SharePoint, Box and Google Workspace Studio all ship "when X happens, run an agent or extraction over the knowledge, then act." The common building blocks are: a trigger catalog per source, filters or conditions, the event payload injected into the prompt, and the action run as a specific user's permissions. Most also add a per-trigger rate limit and per-run credit metering, which matters a lot under BYO billing.

### Cited Findings

**Glean Agents: content triggers, scheduled triggers, Triggers API (most complete reference design)**
- Content triggers run an agent when something changes in a connected source, and the triggering content is passed in as context. Documented examples: "When a Gong call is transcribed, extract deal details, update the Salesforce opportunity, and draft a follow-up email". "When a new high-priority Jira ticket is created, summarize it and suggest next steps". A pre-meeting brief compiled from CRM, call, email and support data. — [Glean docs: content trigger](https://docs.glean.com/agents/concepts/content-trigger)
- Trigger catalog. Recommended sources fire within a few minutes: Gong new call. Jira new, updated, or "meets condition". Salesforce new, updated, or meets condition. Gmail/Outlook new email. Google Calendar new event or "before the event starts". Slack new message or channel. Experimental sources fire within "a couple of hours, always under a day": Google Drive, GitHub, OneDrive, SharePoint, ServiceNow, Zendesk, Zoom and Outlook Calendar. Latency depends on each connector's crawl frequency. — [Glean docs](https://docs.glean.com/agents/concepts/content-trigger)
- Design details. "Meets condition" fires when a record reaches a state, while "Updated" fires on any change to a field. For "New" events, conditions must be true at creation. Glean recommends at least one filter per trigger because "unscoped triggers can exhaust hourly quotas quickly." Gleanbot's own Slack messages are excluded to prevent loops. `[[Trigger input]]` inserts the full event content and `[[Field Name]]` inserts extracted fields. — [Glean docs](https://docs.glean.com/agents/concepts/content-trigger)
- Governance. An admin turns the feature on for everyone, some users, or no one. Activation is per user: each user reviews a trigger summary and clicks "Activate agent". The agent runs with the activating user's permissions, so the trigger does not fire for documents that user cannot see. Users can pause, resume, view run history and remove agents. — [Glean docs](https://docs.glean.com/agents/concepts/content-trigger)
- Scheduled triggers come with admin controls. Access can be granted through Google Groups or Entra ID groups. Background runs that send outputs need action packs set to allow running without user confirmation. — [Glean May 2026 release notes](https://docs.glean.com/release-notes/releases/2026-05-06-may-release) (via search summary)
- The Triggers API (experimental, August 18, 2026 release) lets external apps subscribe to content events and receive signed webhooks while keeping the subscribing user's permissions. Triggers are built from curated presets, one per datasource, discovered with `GET /api/trigger-presets`. Preset inputs are typed PICKLIST, TEXT or USER. The `signing_secret` is returned only when the trigger is created. Scopes are `triggers:read` and `triggers:write`. A trigger can be set to `DISABLED` to pause it. A preview shows matches from the last 7 days, and 7 days ahead for schedule presets. A documented use case is a "meeting starts in 30 minutes" prep trigger. — [Glean developer docs: Triggers overview](https://developers.glean.com/guides/triggers/overview); [Aug 2026 release](https://docs.glean.com/release-notes/releases/2026-08-18-august-release)
- Glean's press material lists the trigger types as content changes, scheduled runs, forms and external events. — [Glean press](https://www.glean.com/fr/press/glean-introduces-the-enterprise-agent-development-lifecycle-codifying-how-enterprises-build-govern-and-measure-ai-agents) (via search summary)

**Dust: schedule and webhook triggers**
- Schedules launched September 16, 2025. They are written in plain language, the LLM converts them to a schedule, and a confirmation shows the exact schedule. — [Dust changelog: agent scheduling](https://docs.dust.tt/changelog/agent-scheduling); [Dust triggers docs](https://docs.dust.tt/docs/triggers)
- Webhook triggers launched November 10, 2025. Built-in providers are GitHub, Jira, Linear, Zendesk and Fathom, and custom HTTP sources are also supported. An admin must create webhook sources first. Each run starts a new conversation, and event data is included only if the author opts in. Webhook triggers are capped at 42 runs per 24 hours by default. Trigger runs consume credits, and a per-trigger setting chooses the member's or the workspace's credits. A "Review your triggers" panel lists triggers and their consumption. — [Dust triggers docs](https://docs.dust.tt/docs/triggers); [Dust changelog: webhooks as triggers](https://docs.dust.tt/changelog/webhooks-as-triggers)
- Dust also documents being triggered from Zapier and n8n. — [Dust + Zapier](https://docs.dust.tt/docs/trigger-your-dust-agent-from-anywhere-using-zapier); [Dust + n8n](https://docs.dust.tt/docs/n8n)

**Notion Custom Agents (Notion 3.x)**
- Agents run on a schedule or a trigger. Documented triggers: Slack emoji reactions and mentions (public channels only, private "coming soon"), Mail (for example, new emails from specific senders), and Calendar event create, update or cancel. Actions include drafting and labeling emails, syncing email into Notion databases, posting to Slack, recurring reports and task routing. Custom Agents can use pre-built MCP partners (Linear, Figma, HubSpot, Ramp, Stripe, GitHub, Intercom, Sentry and others) and custom MCP servers. — [Notion: Custom Agents product page](https://www.notion.com/product/custom-agents)
- A third-party review dates Custom Agents to Notion 3.3 (February 2026). It says they can run on a schedule or a trigger such as "when a database row is created", and write back through AI Autofill (Notion 3.4 part 2, April 14, 2026). — [beginnersinai review](https://beginnersinai.org/notion-ai-review/). This conflicts with the official product page, which does not mention database-event triggers.
- Pricing: from May 4, 2026, Custom Agents consume Notion credits, an add-on to Business and Enterprise plans at $10 per 1,000 credits per month. Credits are shared across the workspace and do not roll over. Alerts fire at 80% and 100%. — [Notion product page](https://www.notion.com/product/custom-agents); [Notion help: Custom Agent pricing](https://www.notion.com/en-gb/help/custom-agent-pricing)

**Microsoft Copilot Studio: autonomous agents**
- Autonomous triggers are billed as "agent actions" at 5 Copilot Credits each. Microsoft's own example: an "order processing agent" is "autonomously triggered anytime a new order is received". It uses one knowledge source for product details and makes 4 action calls (check availability, view shipping, approve, email the customer), costing 20 credits per run. — [Microsoft Learn: Copilot Studio billing rates](https://learn.microsoft.com/en-us/microsoft-copilot-studio/requirements-messages-management)
- Third-party sources disagree on autonomous-trigger cost. One says each self-triggered run costs 25 credits. Another says "up to 100 credits per 10 automatically triggered interactions" with deep reasoning. Neither matches the official per-feature table. — [SAMexpert](https://samexpert.com/copilot-studio-licensing-guide/); [Syskit](https://www.syskit.com/blog/microsoft-copilot-studio-credits)

**SharePoint (Copilot in SharePoint / Knowledge Agent): rules on documents**
- Users describe a rule in natural language and Copilot creates it. Supported triggers: item created, modified or deleted. Supported actions: email, move, copy, set value. Example prompts: "Email me when a contract is approved", "Move reviewed invoices to the Verified Expenses folder". On first use it auto-generates up to 3 suggested metadata columns from the files in the library. Limits: 15 rules per library, English-only file processing, no encrypted files, and the "date approaches" trigger is not yet supported. — [Microsoft Learn: Automate workflows in a SharePoint document library](https://learn.microsoft.com/en-us/sharepoint/knowledge-agent-automate-workflows) (doc dated 2026-09-24)

**Box Extract: on-ingest structured extraction**
- Box Extract became GA in January 2026 on the Enterprise Advanced plan. Users create custom Extract Agents in Box Relay by choosing a metadata template and the fields to fill, with optional per-field prompts. Extracted values are stored as metadata on the file and can sync to Snowflake and Databricks. Box automates downstream steps with Relay today and plans to use "Box Automate in the future". — [Box Extract](https://www.box.com/extract); [BusinessWire, Jan 15 2026](https://www.businesswire.com/news/home/20260115566865/en); [Reworked](https://www.reworked.co/information-management/box-launches-box-extract-for-ai-data-extraction/)
- Limits: PDF only, up to 10 source folders per agent, root-folder files only (no subfolders), agents cannot be shared, and 100 agents per user. Extraction consumes Box AI Units. Confidence scoring and automated prompt refinement are listed as "coming soon". — [Box support: Using Box Extract](https://support.box.com/hc/en-us/articles/48156443597331-Using-Box-Extract); [Box Extract](https://www.box.com/extract)
- Model dependency: Google Cloud says it integrated Gemini into Box Extract. This is vendor-model, not BYO. — [BusinessWire](https://www.businesswire.com/news/home/20260115566865/en)

**Ragie (RAG-as-a-service peer): ingest webhooks plus extraction instructions**
- The `document_status_updated` webhook fires when a document reaches indexed, keyword_indexed, ready or failed. Ragie makes up to 18 delivery attempts per endpoint, treats any 2xx as success, and includes a nonce for idempotency and replay protection. — [Ragie webhooks](https://docs.ragie.ai/docs/webhooks)
- "Instructions" are natural-language extraction prompts that run on every created or updated document. They can be scoped with a metadata filter and given a JSON schema, and results are fetched per instruction or per document. — [Ragie entity extraction](https://docs.ragie.ai/docs/entity-extraction)

**Google Workspace Studio (formerly Workspace Flows)**
- Workspace Flows was announced in alpha at Cloud Next 2025, built on Gems. — [9to5Google](https://9to5google.com/2025/04/09/google-workspace-flows/)
- In April 2026 Gems became a step ("Ask a Gem") in Workspace Studio, the renamed Flows product. Only Gems whose knowledge base is Drive files can be used. Eligible editions include Business Starter, Standard and Plus. Promotional limits end on June 1, 2026 in one locale's copy of the post and September 1, 2026 in another. — [Google Workspace Updates, Apr 2026](https://workspaceupdates.googleblog.com/2026/04/use-your-gems-in-your-google-workspace-studio-flows.html)

**Atlassian Rovo agents in Automation** (details in section 2)
- The examples are trigger-driven. "Decision director" reviews Confluence pages published with "DACI" in the title. "Jira work item organizer" suggests a parent for new work items. "Jira theme analyzer" runs every two days and posts themes to Slack. — [Atlassian support: agents in automations](https://support.atlassian.com/rovo/docs/agents-in-automations/)

### Inferences
- The proven event-to-action shape is: source event, then filter or condition, then a knowledge-grounded agent or extraction step, then an action (notify, write a field, create a record, draft), all logged as a reviewable run. Grey has the middle step (retrieve and ask over a pipeline) but no trigger layer and no outbound action layer.
- **What Grey would need**, in rough build order:
  - Outbound **ingest lifecycle webhooks** on source.ready, source.failed and source.updated (copy Ragie: signed, retried, nonce or idempotency key).
  - **Extraction "instructions" or schemas** that run automatically on every new source matching a filter (Ragie instructions, Box Extract agents, SharePoint autofill). The output is a typed record stored with the source and emitted in the webhook.
  - **Saved-query or "watch" triggers**: fire when a new chunk or entity matches a standing query or entity type. Glean "meets condition" is the analogue.
  - **Schedules**: digests and recurring reports.
  - A **preview of matches** before activation (Glean's 7-day preview).
  - **Per-trigger rate caps** (Dust: 42 runs per 24 hours by default).
- Because Grey ingests audio, video and images, "new recording transcribed → extract action items/entities → notify or write to Geiger Flow" matches the Glean Gong-call example with no extra connector work. The recording is already a Grey source.
- Run-as-identity matters. Glean runs triggered agents as the activating user and Dust attributes credits per trigger. Grey would need per-automation ownership plus a choice of which BYO provider key the automation uses.

### Gaps
- No primary source was found for Lindy, Gumloop, Relevance AI or Zapier Agents trigger catalogs. Pricing is covered in section 2.
- No primary source confirms that Notion Custom Agents support database-row triggers. Only a third-party review says so.
- Gemini Enterprise scheduled actions and triggers: nothing official found. The rebrand of Google Agentspace into Gemini Enterprise (October 2025) comes from prior knowledge and was not re-verified in this session.
- Glean Triggers API payload schema and GA date: not documented on the page I read.

---

## 2. Knowledge as a workflow node (retrieve / classify / extract / draft / decide inside builders)

### Takeaway
Every major automation builder now has an "AI agent" step that can take a knowledge source. The main split is between builders that host the knowledge themselves (Make knowledge files, Zapier live data sources, Relevance AI, Gumloop) and builders that treat knowledge as a pluggable vector store or tool (n8n, Vercel Workflow plus the AI SDK). Pricing is per task, per execution or per credit, and a few platforms explicitly support BYO keys (Relevance AI, Gumloop, self-hosted n8n). For a BYO-only product like Grey, the realistic path is to be the knowledge node inside those builders, mainly through MCP and HTTP, and inside Geiger Flow, rather than building another general-purpose builder.

### Cited Findings

**Zapier (Zaps, AI steps, Agents, MCP)**
- Each successful action step uses one task. Triggers, filters and some built-in steps are free. One directory snapshot (June 2026) says Zaps, AI steps, code, MCP and SDK share one task pool. Professional starts at $19.99/month billed annually ($29.99 monthly). — [eesel](https://eesel.ai/blog/zapier-subscription); [usagepricing](https://usagepricing.com/blueprint/zapier)
- Agents are an add-on, listed at $33.33/month (annual, on Pro) and "metered by activities". This is a secondary source. — [usagepricing](https://usagepricing.com/blueprint/zapier)
- Agents can be given "live data" sources such as Google Drive, Box, Notion or Asana files. They also support web browsing, agent-to-agent delegation and an activity log that flags runs needing attention. — [Zapier blog: Zapier Agents](https://zapier.com/blog/zapier-agents/); [Zapier agents guide](https://zapier.com/blog/zapier-agents-guide/)
- Zapier MCP: each successful tool call costs 2 tasks from the shared allowance, with no separate MCP fee. Failed calls, listing tools and setup are free. There is no cap on tool calls per session, and calls stop when the allowance runs out. — [Zapier MCP usage docs](https://docs.zapier.com/mcp/usage.md); [Zapier help](https://help.zapier.com/hc/en-us/articles/45645738385805)
- The Human in the Loop app pauses Zaps for approval or data collection and notifies by email or Slack. — [Zapier help (helpjuice mirror)](https://ob-zapier.helpjuice.com/use-human-in-the-loop-to-pause-zaps-pending-human-review)

**n8n**
- Human-in-the-loop for tools: an AI Agent node can require approval before running all tools or only selected ones. A reviewer approves or denies in Slack, Telegram or n8n Chat, and a denial cancels the call. n8n recommends this for irreversible effects such as deleting data, sending external communications or making purchases. — [n8n docs: HITL for tools](https://docs.n8n.io/build/integrate-ai/ai-examples/human-in-the-loop-for-tools.md)
- Pricing is per workflow execution regardless of step count. Starter is about 2,500 executions per month and Pro about 10,000. Sources disagree on EUR prices (about €20/€50 annual vs about €24/€60 monthly) and on AI-credit allowances. The Community Edition is free to self-host, so model usage is BYO by construction. — [Jet Admin](https://www.jetadmin.io/blog/n8n-pricing/); [coworker.ai](https://coworker.ai/blog/n8n-pricing); [CloudZero](https://www.cloudzero.com/blog/n8n-pricing/)
- n8n's LangChain-style cluster nodes (vector-store retriever as an agent tool, memory nodes) are widely used for RAG. Community tutorials show Qdrant-backed long-term memory. — [DEV: n8n + Qdrant memory](https://dev.to/einarcesar/long-term-memory-for-llms-using-vector-store-a-practical-approach-with-n8n-and-qdrant-2ha7). I could not read the official vector-store node docs before the search budget ran out.

**Make**
- Make AI Agents have a team-shared knowledge base. Uploaded files are chunked into a database, and Make generates a description of each file that the agent uses to pick which files to search. — [Make Academy: AI agents and files (PDF)](https://academy-content.make.com/pdfs/unit-2-ai-agents-and-files.pdf); [Make help](https://help.make.com/beta-make-ai-agents/create-your-first-make-ai-agent)
- A third-party source lists limits of txt, PDF, Word, CSV, MD and JSON files, 20 MB per file, 20 files per agent, and recommends Pinecone or Supabase at scale. — [growwstacks](https://growwstacks.com/blog/make-com-new-ai-agents-2026)

**Atlassian Automation + Rovo**
- There are two setup paths: a trigger on the agent (from Studio), or the agent as a flow step ("Use agent" action with a required prompt). Later steps use `{{agentResponse}}`. Agents in automations "can run without asking a user to confirm each action". Admins or users can block agent write actions, in which case write tools fail and the flow must act on `{{agentResponse}}` instead. Out-of-the-box agents take no actions, while custom agents need tools added. — [Atlassian support](https://support.atlassian.com/rovo/docs/agents-in-automations/)
- In practice agents cannot call each other directly. The workaround is a label plus a second rule. — [Atlassian community](https://community.atlassian.com/forums/Rovo-questions/Can-Rovo-agents-communicate-with-each-other-in-Atlassian/qaa-p/3109682)

**Relevance AI, Gumloop, Lindy (no-code agent builders)**
- Relevance AI splits billing into Actions (agent work) and Vendor Credits (model cost, passed through at cost). Users can "bring your own API keys anytime to bypass Vendor Credits entirely." — [Relevance AI docs: new pricing](https://relevanceai.com/docs/admin/subscriptions/new-pricing.md). Third-party figures: Pro $29/month ($19 annual) with 2,500 Actions, Team $349/month with 7,000 Actions. Sources disagree on which plans allow BYOK. — [11x review](https://www.11x.ai/guides/relevance-ai-review); [Macha](https://www.getmacha.com/blog/relevance-ai-pricing-explained)
- Gumloop Pro is $37/month and includes 20,000 credits plus an 8% orchestration fee. A competitor's blog lists 10,000 credits instead. With BYOK the fee rises to 16% and model calls cost 0 credits. — [Jet Admin: Gumloop pricing](https://www.jetadmin.io/blog/gumloop-pricing/); [coworker.ai](https://coworker.ai/blog/gumloop-pricing); [Lindy blog (competitor)](https://www.lindy.ai/blog/gumloop-pricing)
- Lindy Plus is $29.99 per user per month with 3,000 credits, and Pro is $99.99 with 15,000. The credit pool is shared, and Lindy pauses credit-using actions instead of billing overage. This is a secondary source. — [TinyCommand](https://tinycommand.com/ai-agents/lindy-ai-alternatives)

**Developer-grade durable workflow runtimes**
- Vercel Workflow (Workflow DevKit) is GA. Since its October 2025 beta it has processed over 100M runs and over 500M steps across more than 1,500 customers. The AI SDK integration enables "infinitely long running durable agents" that handle external events and interruptions. AI SDK v7 adds `WorkflowAgent`, and a Python SDK is in beta. Inputs and outputs are kept in an event log and replayed deterministically after a crash. — [Vercel blog](https://vercel.com/blog); [Vercel docs: Workflow](https://vercel.com/docs/workflow); [createwith summary](https://www.createwith.com/tool/vercel/updates/vercel-workflows-reaches-general-availability-for-long-running-processes)
- Pipedream (Workflows, Connect, MCP servers): Workday signed a definitive agreement to acquire it on November 19, 2025, with closing expected by January 31, 2026. Completion is asserted only by a competitor's blog, so it is unverified. Pipedream MCP became available inside ChatGPT and Agent Builder. — [Pipedream blog](https://pipedream.com/blog/pipedream-to-be-acquired-by-workday/); [Nasdaq](https://www.nasdaq.com/articles/workday-acquire-pipedream-deal-close-q4); [Scalekit](https://www.scalekit.com/blog/pipedream-alternatives)

**Suite-native builders**
- Microsoft "agent flows" in Copilot Studio cost 13 Copilot Credits per 100 flow actions. They are a deterministic step sequence that doesn't require "agent reasoning and orchestration at each step". — [Microsoft Learn](https://learn.microsoft.com/en-us/microsoft-copilot-studio/requirements-messages-management)
- Google Workspace Studio has an "Ask a Gem" step grounded in Drive files (see section 1). — [Google Workspace Updates](https://workspaceupdates.googleblog.com/2026/04/use-your-gems-in-your-google-workspace-studio-flows.html)

### Inferences
- Builders converge on a small set of knowledge step verbs: **retrieve** (chunks plus citations), **ask** (grounded answer), **extract** (schema to JSON), **classify** (label from a closed set), **draft** (template plus grounding) and **decide or route** (pick a branch). Grey's HTTP API has retrieve and ask (chat/completions). Adding `extract`, `classify` and `draft` as first-class endpoints that return structured output would make Grey usable as an n8n, Zapier, Make or Flow node without prompt engineering on the caller's side.
- **Geiger Flow is the natural host.** A "Grey: retrieve / extract / classify" node in Flow, plus Grey ingest events as Flow triggers, mirrors how Atlassian ties Rovo into Jira/Confluence Automation (agent as a step, agent output in a variable) and how Microsoft ties Copilot Studio to agent flows.
- Under BYO, the pricing patterns that suit Grey are Relevance AI's split (platform actions vs pass-through model cost, with BYOK removing the model meter) and Lindy's "pause instead of overage" behaviour. Gumloop's higher fee for BYOK shows some vendors price BYO as a premium, not a discount.
- A connector for n8n and Make (or simply documented HTTP and MCP recipes) is cheap distribution. Dust ships docs for both Zapier and n8n triggering.

### Gaps
- Temporal-style tools (Temporal, Inngest, Trigger.dev) were not researched because the search budget ran out.
- No official source on how Zapier Agents meter knowledge-source reads, or on knowledge-source size limits.
- n8n's 2026 AI-credit allowances are contradictory across sources.

---

## 3. Support and operations automation grounded in a KB

### Takeaway
This is the most commercially proven "knowledge beyond chat" market, with outcome-based pricing at around $1 to $2 per resolution. It consolidated heavily in 2026. Intercom renamed itself Fin (May 2026), and Salesforce agreed to buy it for about $3.6B (June 2026, not yet closed). Zendesk bought Forethought (March 2026). Sierra was valued at $15.8B (May 2026) and Decagon at $4.5B (January 2026). The knowledge-specific features that recur are: KB-grounded auto-resolution, agent-assist copilots (per seat), procedures or SOPs written in natural language, and ticket-to-article generation that closes knowledge gaps. Leaders increasingly lean on their own tuned models, which runs against Grey's BYO stance.

### Cited Findings

**Fin (formerly Intercom)**
- The company rebranded to Fin in May 2026. Salesforce signed a definitive agreement on June 15, 2026 to acquire it for about $3.6B, adding more than 30,000 business customers. Salesforce expects Fin's "packaged offerings and **proprietary models**" to complement Agentforce. — [MarTech](https://martech.org/salesforce-acquires-fin-formerly-known-as-intercom/); [Trending Topics](https://www.trendingtopics.eu/salesforce-to-acquire-fin-ai-formerly-intercom-for-3-6-billion/)
- Salesforce's 10-Q lists the expected close as Q3 of FY2027, while other outlets say Q4. As of the latest sources the deal had not closed. — [Salesforce 10-Q (SEC)](https://www.sec.gov/Archives/edgar/data/0001108524/000110852426000190/crm-20260731.htm); [MarTech](https://martech.org/salesforce-acquires-fin-formerly-known-as-intercom/)
- Pricing: $0.99 per resolution, minimum 50 per month. Lead-qualification outcomes are reportedly $9.99. Copilot (agent assist) is about $35 per seat per month. Seats are $29, $85 and $132 annual. All are secondary sources. Customers complain that a conversation counts as "resolved" when the customer simply stops replying. — [SiteGPT](https://sitegpt.ai/blog/intercom-fin-ai-review); [Gleap](https://www.gleap.io/blog/intercom-fin-ai-pricing-2026); [Drag](https://www.dragapp.com/blog/intercom-pricing/)
- Reported performance and size conflict: a 67% average resolution rate (Fin 3, 2025) vs a 76% claim across more than 12,000 customers, and ARR reported as $250M+ vs $400M. — [createwith](https://www.createwith.com/tool/intercom/updates/intercom-ships-200-updates-in-2025-fin-3-reaches-67-average-resolution-rate); [Fini comparison](https://www.usefini.com/compare/intercom-fin-vs-fini)

**Zendesk (AI agents, Copilot, Knowledge Builder, Forethought)**
- Zendesk does not publish its per-automated-resolution rate. Third-party estimates are about $1.50 committed and $2.00 pay-as-you-go. Plans include some resolutions; for example, 10 agents on Suite Professional get about 100 per month. Copilot is $50 per agent per month. Suite Team is $55 and Professional $115 per agent per month. Sources disagree on whether the "Advanced AI" add-on still exists. — [Voiceflow](https://www.voiceflow.com/blog/zendesk-pricing); [pluno](https://pluno.ai/blog/zendesk-ai-pricing); [eesel](https://www.eesel.ai/blog/zendesk-ai-agent-review)
- Knowledge Builder (EAP announced July 2025) clusters tickets by topic and drafts 20 to 25 help-center articles per run, layered on top of existing content, to feed AI agents. — [Zendesk support: Knowledge Builder EAP](https://support.zendesk.com/hc/en-us/articles/9370896311962-Announcing-the-Knowledge-Builder-EAP); [Zendesk blog](https://www.zendesk.de/blog/zendesk-insights/innovation/fuel-your-ai-with-a-knowledge-base-built-in-days-not-months/)
- **Forethought was acquired by Zendesk**: announced March 11, 2026 and reportedly closed March 26, 2026, for a reported $200M+ (Reuters via secondary source). It is now sold as "Forethought AI agents by Zendesk" and still available to non-Zendesk customers. — [SiliconANGLE](https://siliconangle.com/2026/03/11/zendesk-announces-deal-acquire-customer-support-ai-startup-forethought/); [Macha](https://www.getmacha.com/blog/forethought-ai-complete-guide)
- Third-party analysis names knowledge-base quality (Zendesk Guide) as "the single biggest variable" in resolution rate. — [Voiceflow](https://www.voiceflow.com/blog/zendesk-pricing)

**Sierra, Decagon, Ada**
- Sierra uses outcome-based pricing (pay per resolved conversation or saved cancellation, with negotiated rates). Estimated entry contracts are about $150k per year. — [eesel: Decagon vs Sierra](https://eesel.ai/blog/decagon-vs-sierra); [SleekFlow](https://sleekflow.io/blog/sierra-ai-alternatives)
- Sierra raised $950M at a $15.8B post-money valuation in May 2026, led by Tiger Global and GV. ARR estimates range from $150M (Sacra, January 2026) to about $200M. — [valueaddvc](https://valueaddvc.com/blog/sierra-ai-valuation-2026-15-8b-series-e-enterprise-ai-agents); [agentmarketcap](https://agentmarketcap.ai/blog/2026/05/14/sierra-950m-15b-valuation-cx-agent-mega-round)
- Sierra "Ghostwriter" (March 2026) builds and edits agents from prompts, SOPs or call recordings. This comes from a single comparison source. — [vantaige](https://vantaige.io/blog/intercom-fin-vs-decagon-vs-sierra-2026)
- Decagon defines agent logic as plain-language procedures (AOPs) that customers edit, and bills per conversation or per resolution on top of a platform fee of about $50k per year. Vendr reports a median contract of $432,750 per year. It raised $250M at a $4.5B valuation in January 2026 (Coatue, Index) and completed a tender offer at $4.5B. — [eesel](https://eesel.ai/blog/decagon-vs-sierra); [Bloomberg Law](https://news.bloomberglaw.com/artificial-intelligence/ai-customer-support-startup-decagon-valued-at-4-5-billion); [TechCrunch](https://www.techcrunch.com/2026/03/04/decagon-completes-first-tender-offer-at-4-5b-valuation/)
- Ada is described as independent and sales-led with no public pricing. This is a weak vendor-blog source. — [MyAskAI](https://myaskai.com/blog/ada-cx-forethought-comparison-2026)

**Helpdesk-adjacent ops automation in suites**
- Glean's own examples are triage-style: summarize new high-priority Jira tickets and suggest next steps, and turn a Gong call into CRM updates plus a draft follow-up email. — [Glean docs](https://docs.glean.com/agents/concepts/content-trigger)
- Notion Custom Agents target "task routing agents that triage incoming work" and Q&A agents for repeat questions. — [Notion](https://www.notion.com/product/custom-agents)

### Inferences
- The support market proves that buyers will pay per outcome for KB-grounded automation. But head-on competition is crowded and consolidating, and the leaders use proprietary models. Grey's opening is to be **the knowledge layer behind** helpdesk agents: Zendesk, Fin or custom bots call Grey's `/retrieve` or MCP for long-tail documents, audio and video knowledge that help centers don't hold. Grey would not be the agent itself.
- The knowledge-side features worth copying are cheap on a RAG+KG stack:
  - **Ticket or conversation clustering into draft articles** (Zendesk Knowledge Builder), which Grey could run over ingested support exports or transcripts.
  - **Unanswered or low-confidence query logs turned into a "knowledge gap" queue.**
  - **Suggested reply drafts** grounded in citations.
- If Grey ever offers "resolution"-style automation, the "resolution" definition disputes (Fin, Zendesk) argue for transparent, customer-defined success events. Under BYO, Grey can't charge per resolution on top of model cost without seeming to double-charge, so a platform fee plus the customer's own model bill is cleaner.

### Gaps
- Official Fin/Intercom documentation on knowledge-gap detection and "content suggestions": not found (search returned only pricing pages).
- Decagon's official AOP docs and Sierra's agent SDK docs: not reached (search budget ran out).
- Email auto-drafting products (Front, Superhuman, Gmail/Outlook copilots) and IT/HR helpdesk products (Moveworks, ServiceNow) were not researched.

---

## 4. Agent memory and context; MCP tool design beyond "search"

### Takeaway
A KB-as-memory category (Mem0, Zep/Graphiti, Letta, Cognee, Supermemory) has formed. Each exposes write tools (`add_memory`, `cognify`, `add_triplet`) next to read tools, and several are graph-based. Leading knowledge MCP servers in 2026 are moving well past a single `search` tool:
- Notion exposes about 60 tools, including SQL over databases, write tools, memory search and agent-session control.
- Atlassian groups tools by permission (read, write, search) and is moving to discover/execute meta-tools to save context.
- Glean ships search, chat and read_document by default, plus `read_memory`.

The MCP spec revision of 2026-07-28 deprecates Sampling, so a server can no longer borrow the client's model. That matters for BYO: Grey must run extraction on the user's attached keys.

### Cited Findings

**Memory products**
- Positioning (comparison guides, several vendor-written):
  - Mem0 is a memory layer added to an existing agent, with graph memory at the Pro tier.
  - Zep is a temporal knowledge graph (Graphiti) suited to "what was true at time T".
  - Letta (from MemGPT) is a full stateful runtime with core, recall and archival tiers, where the agent manages its own context.
  - Cognee is graph-native and local-first, closer to graph-RAG, with remember, recall, forget and improve operations.
  - Supermemory is a TypeScript-first, MIT-licensed, vector-first engine.
  - Mem0, Zep, Cognee and Supermemory extract memories automatically, while Letta lets the agent decide.
  - LoCoMo benchmark claims should be replicated before trusting them.
  — [mcp.directory comparison](https://mcp.directory/blog/mem0-vs-letta-vs-zep-vs-cognee-2026); [contextstudios](https://www.contextstudios.ai/guides/best-ai-agent-memory-tools-2026); [Cognee blog (vendor)](https://www.cognee.ai/blog/guides/best-open-source-ai-memory-tools-for-llm-agents-and-developers)
- Mem0 pricing: Free (10K memories per month after the 2026 change), Starter $19 (vector only), Pro $249/month (graph memory, 500K memories), Enterprise custom. Secondary sources. — [Vectorize](https://vectorize.io/articles/mem0-vs-zep); [Atlan](https://atlan.com/know/mem0-alternatives/)
- Zep pricing is credit-based. Episodes cost 1 credit per 350 bytes. Paid plans auto-buy credits when the balance falls below 20%, "so monthly spend is not capped". Entry pricing conflicts: Flex at $104/month annual with 50K credits vs older $25/month. Secondary sources. — [Vectorize](https://vectorize.io/articles/zep-alternatives); [toolradar](https://toolradar.com/guides/best-ai-agent-memory-tools)
- Supermemory's MCP "deliberately exposes a small tool set": save facts, recall relevant context, know the user's profile (`addMemory`). Its connectors cover Google Drive, Gmail, Notion and GitHub. Pricing in the launch blog: 10 memories free, $9/month for 500 memories and 10 connections (early-user offer). — [Supermemory MCP docs](https://supermemory.ai/docs/supermemory-mcp/technology); [Supermemory connectors](https://docs.supermemory.ai/memory-api/connectors); [Supermemory blog](https://supermemory.ai/blog/unified-memory-that-works-where-you-work-your-second-brain-with-supermemory/)
- Mem0 OpenMemory MCP exposes four standard memory tools, including `add_memories` and `search_memory`. It runs locally (no cloud sync), and a hosted version also exists. — [Mem0 docs: OpenMemory](https://docs.mem0.ai/openmemory); [Mem0 blog](https://mem0.ai/blog/introducing-openmemory-mcp)

**Knowledge-graph MCP tool surfaces**
- Graphiti (Zep) MCP has 13 tools: `add_memory`, `search_nodes`, `search_memory_facts`, `delete_entity_edge`, `delete_episode`, `get_entity_edge`, `get_episodes`, `summarize_saga`, `build_communities`, `add_triplet`, `get_episode_entities`, `clear_graph`, `get_status`. LLM providers: OpenAI, Azure OpenAI, Anthropic, Gemini, Groq. Embedders: OpenAI, Azure, Gemini, Voyage. In practice it is BYO models. — [Zep docs: Graphiti MCP server](https://help.getzep.com/graphiti/getting-started/mcp-server)
- Cognee MCP tools: `cognify` (build the KG), `codify` (code graph), `search` with modes GRAPH_COMPLETION, RAG_COMPLETION, CODE, CHUNKS and INSIGHTS, `prune`, `list_data`, `delete`, and `cognify_status`/`codify_status` for tracking background jobs. — [FlowHunt listing](https://www.flowhunt.io/integrations/cognee-mcp/); [Cognee MCP test client](https://glama.ai/mcp/servers/@topoteretes/cognee/blob/dc0b1630e70500042095e450f92338f74a8f2254/cognee-mcp/src/test_client.py)

**Enterprise knowledge MCP servers**
- Notion's official MCP (about 60 tools) covers:
  - Search: `notion-search`, `notion-connector-search` over Slack, Drive and GitHub, and `notion-memory-search` for "memories saved by the user's connected agents".
  - Fetch and backlinks.
  - Database query: `notion-query-data-sources` (saved views or SQL) and `notion-query-multiple-data-sources` (read-only SQL across 2 to 100 sources).
  - `notion-query-meeting-notes`.
  - Writes: create and update pages, databases and views, comments, move, duplicate.
  - Deletes require `user_confirmed: true`.
  - Async task status (`notion-get-async-task`).
  - Custom Agent session control: `notion-spawn-session`, `notion-send-message-to-session`, `notion-wait-session`, `notion-stop-session`.
  - Skills tools.
  - Admins choose which tools a workspace-owned connection exposes.
  — [Notion developers: MCP supported tools](https://developers.notion.com/docs/mcp-supported-tools)
- Atlassian Rovo MCP: tools are grouped into permission groups by intent (read, write, search) that admins grant or revoke. A beta `getTeamworkGraphContext` tool exists. The Preview endpoint replaces much of the list with **discover and execute** tools, reaching a larger catalog while "cutting context use by more than 50%". GA on February 4, 2026 per a third-party blog. — [Atlassian: supported tools](https://support.atlassian.com/atlassian-rovo-mcp-server/docs/supported-tools/); [Atlassian developer: Rovo MCP preview](https://developer.atlassian.com/cloud/rovo-mcp/preview/); [Unblocked blog](https://getunblocked.com/blog/best-confluence-jira-mcp-servers-coding-agents/)
- Glean remote MCP: default tools are `glean_search` (or `search`), `chat` and `read_document`. Optional tools include `code_search`, `employee_search`, meeting lookup, Gmail and Outlook, and `read_memory`. Glean advises "designing each server for a single, specific purpose". It uses OAuth 2.0 natively, with an `mcp-remote` bridge fallback. — [Glean: connecting to MCP server](https://docs.glean.com/administration/platform/mcp/connecting-to-glean-mcp-server); [Glean: create MCP servers](https://docs.glean.com/administration/platform/mcp/create-mcp-servers)
- Slack MCP server and Real-time Search (RTS) API went GA on February 17, 2026. More than 50 partners (Anthropic, Google, OpenAI, Perplexity and others) build on them, and Slack reports 25x growth in RTS queries and MCP tool calls since the limited release. Tools are "built specifically for LLM consumption", and granular `search:read.*` scopes need user consent. RTS lets apps retrieve Slack data "without storing customer information on external servers". — [Slack blog](https://slack.com/blog/news/mcp-real-time-search-api-now-available); [Slack changelog](https://docs.slack.dev/changelog/2026/02/17/slack-mcp)

**MCP protocol changes relevant to tool design (spec 2026-07-28)**
- The protocol is now stateless: no initialize handshake and no `Mcp-Session-Id`. Servers that need state mint explicit handles passed as tool arguments.
- `subscriptions/listen` replaces `resources/subscribe` with a long-lived stream of opted-in change notifications.
- Tasks moved to an official extension (`io.modelcontextprotocol/tasks`), with polling through `tasks/get`, `tasks/update` for client input, and unsolicited task handles.
- Multi Round-Trip Requests (`InputRequiredResult`) replace server-initiated elicitation and sampling requests.
- `tools/list` should be returned in a deterministic order to help prompt caching, and new `ttlMs`/`cacheScope` fields hint how long clients may cache list and read results.
- **Roots, Sampling and Logging are deprecated.** The guidance is to "integrate directly with LLM provider APIs instead of Sampling".
- Dynamic Client Registration is deprecated in favour of Client ID Metadata Documents.
— [MCP spec changelog 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/changelog)
- The earlier 2025-11-25 spec introduced experimental tasks for "expensive computations and batch jobs" and URL-mode elicitation. — [MCP tasks (2025-11-25)](https://modelcontextprotocol.net/specification/2025-11-25/basic/utilities/tasks)
- Registry scale: about 30,375 unique servers as of September 10, 2026 (from 99,114 server-version records), roughly tripling since May 2026, per a single third-party analysis. Another count was about 16,967 in July 2026. The registry API was still v0.1 preview. — [DevToolHub](https://devtoolhub.com/mcp-registry-by-the-numbers/); [Towards AI](https://pub.towardsai.net/mcp-registries-in-mid-2026-one-upstream-won-2ce541b92036)

### Inferences
- Grey's current MCP (`search`, `ask`, `get_entity`, `list_sources`) is close to Glean's default trio and already has one graph tool. Gaps compared with 2026 leaders, in order of value:
  - **Graph traversal and facts**: `get_relations` / `neighbors(entity, depth)`, `search_entities(type, query)` and `search_facts`, modelled on Graphiti's `search_nodes` and `search_memory_facts`. Optionally `get_entity_timeline` for temporal facts.
  - **Source-level reads**: `get_source` / `read_source(id, range)` with transcript timestamps for audio and video, like Glean's `read_document`.
  - **Structured operations**: `extract(schema, filter)`, `classify(labels, filter)` and `summarize(filter)`, run as **MCP tasks** for long or batch jobs, with polling (`tasks/get`) and a status tool like Cognee's `cognify_status`.
  - **Write-back**: `add_note` / `add_source(url | text)`, `add_fact` / `add_triplet` with provenance, `flag_answer` (feedback), `propose_correction`. Destructive tools need confirmation (Notion's `user_confirmed`) or MRTR-based elicitation.
  - **Permission groups**: read vs write tool groups toggled per API key or connection (Atlassian, Notion admin-selected tools).
  - **Change subscriptions**: through `subscriptions/listen`, so agents learn when new sources or entities land, which is MCP's in-protocol answer to webhooks.
- Sampling being deprecated means "let the calling agent's model do the extraction" is not a durable design. Grey should run extract and classify jobs on the project's attached provider key and expose cost estimates. This fits BYO.
- Being agent memory as well as a KB means adding a "conversation/episode" source type with automatic fact extraction, keyed by user or agent ID, as Mem0, Zep and Supermemory do. Grey's KG extraction pipeline already does most of that work. The difference is low-latency incremental ingest of small text items.
- Deterministic tool order and cacheable list results are cheap compliance work that improves prompt-cache hit rates for BYO users, who pay the token bill.

### Gaps
- Letta pricing and its MCP tool list were not retrieved.
- Official 2026 Mem0 pricing page not read (secondary only).
- I could not confirm the full official write-tool list for Atlassian Rovo MCP.
- No independent benchmark of memory-product accuracy was found.

---

## 5. Write-back and bidirectional flows (agents adding knowledge, verification queues, capture)

### Takeaway
Write-back now ships in three forms:
- **Agents writing structured fields or records**: Notion Autofill and database writes, SharePoint "set value", Box metadata, Glean updating Salesforce.
- **Mining conversations into knowledge**: Zendesk Knowledge Builder from tickets, Notion meeting notes queryable over MCP, agent memories in Notion's MCP.
- **Verification loops**: Guru auto-verify and auto-unverify driven by answer feedback, Hebbia sign-off checkpoints.

Human review is the norm. Drafts are layered on top of existing content, and Guru's auto-unverify is off by default.

### Cited Findings
- Guru Knowledge Agents: auto-verify is on by default for agents built after January 2026 and configured under the agent's Quality tab. Auto-unverify is off by default. When answers using a card are flagged incorrect, the agent unverifies the card, logs why and alerts the team, and positive feedback re-verifies it. — [Guru help: verifying cards](https://help.getguru.com/docs/verifying-and-unverifying-cards); [Guru: automated knowledge quality](https://www.getguru.com/features/automated-knowledge-quality)
- Guru assigns each card a subject-matter expert and a review interval (weekly to yearly), flagging it unverified when the interval lapses. Guru's pricing is now custom ("not a per-seat tool"). — [Macha guide](https://www.getmacha.com/blog/guru-complete-guide); [Guru KM automation](https://getguru.com/solutions/km-automation)
- Zendesk Knowledge Builder generates article drafts from ticket clusters. A third-party Zendesk app detects missing or outdated articles by comparing solved tickets with the Help Center and never auto-publishes. — [Zendesk support](https://support.zendesk.com/hc/en-us/articles/9370896311962-Announcing-the-Knowledge-Builder-EAP); [Macha: Past Tickets AI KB app](https://www.getmacha.com/apps/past-tickets-ai-knowledge-base)
- Notion's MCP exposes `notion-memory-search` ("memories saved by the user's connected agents") and `notion-query-meeting-notes`. So meeting capture and agent memories are queryable knowledge for outside agents. Notion AI Meeting Notes consume about 10 Standard credits per one-hour meeting. — [Notion MCP tools](https://developers.notion.com/docs/mcp-supported-tools); [Notion credits help](https://www.notion.com/en-gb/help/custom-agent-pricing)
- Glean content triggers write back to systems of record, for example updating the Salesforce opportunity from a Gong call. — [Glean docs](https://docs.glean.com/agents/concepts/content-trigger)
- Glean's Indexing API is used to push meeting data from meeting tools into Glean through webhooks, a capture-into-KB pattern. — [Spinach.ai blog](https://www.spinach.ai/blog/glean-indexing-api-meeting-data-webhooks) (title-level evidence only; not read in full)
- In SharePoint, knowledge-agent autofill suggests columns, and "nothing is saved until you apply the changes". This is an explicit apply step before write-back. — [Syskit](https://www.syskit.com/blog/knowledge-agent-in-sharepoint)
- Hebbia Matrix 2.0 (announced August 26, 2026) extends grid workflows to multi-step runs with "a sign-off checkpoint before each step". Single third-party source. — [AllMind comparison](https://allmind.ai/research/alphasense-vs-hebbia-vs-allmind-ai)
- Graphiti and Cognee MCP expose write tools (`add_memory`, `add_triplet`, `cognify`) so agents can add knowledge directly. — [Graphiti MCP](https://help.getzep.com/graphiti/getting-started/mcp-server); [FlowHunt: Cognee](https://www.flowhunt.io/integrations/cognee-mcp/)

### Inferences
- For Grey the low-risk write-back sequence is:
  1. **Agent-submitted sources land in a "pending" or "unverified" state**, visible in a review queue and excluded from or down-weighted in retrieval until approved.
  2. **Answer feedback from the widget, Playground and API feeds a per-source or per-entity trust score.** Guru's feedback-driven unverify is the model, with auto-unverify off by default.
  3. **Entity-level corrections**: merge, split and edit relations, with provenance (who or which agent, from which conversation).
  4. **Gap capture**: queries with low retrieval scores or "no answer" are clustered into a "missing knowledge" list. This is Zendesk Knowledge Builder's idea applied to Grey's own query logs.
- Suite angle: Geiger Notes is a natural capture surface. A note becomes a Grey source automatically, and Grey can suggest related entities back into Notes. Geiger Forms submissions can also be ingested as structured sources.
- Grey already transcribes meetings and audio, so "meeting → decisions, action items and entities → written to Geiger Flow tasks" is a bidirectional flow it can own inside the suite.

### Gaps
- Official Fin/Intercom documentation on converting conversations into articles (content suggestions) was not found.
- Glean "verification" or knowledge-quality features were not researched.
- No quantitative data found on how often teams accept AI-drafted articles.

---

## 6. Embedding knowledge inside other apps (bots, extensions, IDE, in-app help, cross-suite)

### Takeaway
Distribution into other apps in 2026 runs mainly through MCP (Slack, Notion, Atlassian, Glean and Zapier all expose or consume it) and through suite-wide graphs:
- Microsoft Graph and Copilot connectors pull third-party content into one index that powers Copilot everywhere.
- Atlassian has the Teamwork Graph context tool.
- Notion connector search reaches Slack, Drive and GitHub.
- Google Gems with Drive-file knowledge can be used as steps in Workspace Studio.

The cross-app pattern is "one index, many surfaces". A sibling app calls the knowledge layer as a step or a side panel instead of keeping its own store.

### Cited Findings
- Microsoft Graph connectors, now increasingly called **Copilot connectors**, bring external content (ServiceNow, Jira, Confluence, Salesforce, file shares and others) into the Microsoft Graph index so Copilot and Copilot Studio agents can answer across systems. — [Microsoft Learn: prebuilt connectors](https://learn.microsoft.com/en-us/microsoft-365/copilot/connectors/prebuilt-connectors-overview); [Spreaker podcast summary](https://www.spreaker.com/episode/microsoft-graph-connectors-simply-explained--73049092)
- In Copilot Studio, "tenant graph grounding" (RAG over the tenant-wide Graph, including connector content) costs 10 Copilot Credits per message and can be toggled per agent. — [Microsoft Learn](https://learn.microsoft.com/en-us/microsoft-copilot-studio/requirements-messages-management)
- Atlassian Rovo MCP's beta `getTeamworkGraphContext` exposes Atlassian's cross-product graph to outside agents. — [Atlassian supported tools](https://support.atlassian.com/atlassian-rovo-mcp-server/docs/supported-tools/)
- Notion `notion-connector-search` searches connected Slack, Google Drive and GitHub from Notion's MCP. Custom Agents act in Slack, Mail and Calendar. — [Notion MCP tools](https://developers.notion.com/docs/mcp-supported-tools); [Notion Custom Agents](https://www.notion.com/product/custom-agents)
- Google Workspace Studio's "Ask a Gem" step uses Gems whose knowledge is Drive files to automate summaries and document writing. — [Google Workspace Updates](https://workspaceupdates.googleblog.com/2026/04/use-your-gems-in-your-google-workspace-studio-flows.html)
- SharePoint document-library Copilot builds metadata columns and rules inside the library UI, an in-app contextual assistant attached to a content container. — [Microsoft Learn](https://learn.microsoft.com/en-us/sharepoint/knowledge-agent-automate-workflows)
- Slack is both a surface and a source. Its MCP and RTS let outside agents read Slack in real time with user-consented scopes. Fin's AI Agent runs "across every channel, including live chat, email, WhatsApp, SMS, phone, and Slack". — [Slack blog](https://slack.com/blog/news/mcp-real-time-search-api-now-available); [MarTech](https://martech.org/salesforce-acquires-fin-formerly-known-as-intercom/)
- Glean MCP is validated with ChatGPT, Claude Code, Claude Desktop (native OAuth) and Cursor (bridge), which puts enterprise knowledge into IDEs and chat clients. — [Glean docs](https://docs.glean.com/administration/platform/mcp/connecting-to-glean-mcp-server)
- Copilot Studio agents grounded in Graph connectors can be published "within Microsoft Copilot or third-party applications". — [Microsoft 365 dev blog (via search summary)](https://devblogs.microsoft.com/microsoft365dev/wp-json/wp/v2/posts/21565) (undated, may be old)

### Inferences
- For the Geiger suite, the proven cross-app pattern is a **single per-project knowledge index (Grey) consumed by siblings**. Possible surfaces:
  - **Flow**: "related knowledge" side panel on a task, a Grey step in automations, and auto-filled task fields from extracted entities.
  - **Notes**: inline citations, "link to entity" suggestions, and auto-capture of notes into Grey.
  - **Forms**: field autocomplete or validation from known entities (customers, products), and submissions ingested as sources.
  - **Assets**: asset descriptions and tags extracted on upload, the same pattern as SharePoint autofill and Box Extract.
- Outside the suite, a Slack or Teams bot is the most common "knowledge in another app" surface. The Vercel Chat SDK (available in this environment's skills) supports Slack, Teams, Discord, Google Chat and others from one codebase, which would make a Grey bot cheap to build. This is not market-validated here.
- MCP plus OAuth already covers IDE and agent-client distribution (Claude, ChatGPT, Cursor). Grey's existing MCP server is the distribution channel. Listing it in the official MCP registry (about 30k servers) is low cost.

### Gaps
- **Browser extensions and sidebars** (Glean extension, Guru extension, Atlassian browser extension): not verified because the search budget ran out.
- **IDE-context products** (Unblocked, Context7, Sourcegraph): not researched beyond Glean's MCP host list.
- **In-app contextual help widgets** (for example Intercom/Fin Messenger, Pendo) and **form-field autocomplete from knowledge**: no sources found.
- Teams and Discord bot patterns specifically: no sources.

---

## 7. Batch and bulk operations (prompt/classifier/extraction across all or filtered documents; export)

### Takeaway
Batch knowledge processing has settled into two UX forms. The **grid** has documents as rows and questions or fields as columns, with citations per cell (Hebbia Matrix, Airtable AI fields, Google Sheets `=AI()`, Notion AI Autofill). The **folder or library rule** auto-extracts metadata for every file that lands in a location (Box Extract agents, SharePoint autofill columns at $0.005 per page). Output goes to metadata, a database or a warehouse (Box syncs to Snowflake and Databricks). Pricing is per page or per credit, which makes cost preview essential under BYO.

### Cited Findings
- Hebbia Matrix lays out work as a grid of documents (rows) by questions or fields (columns), with inline citations. It splits queries into steps handled by separate agents. Reviewers rate its audit trail highly but say citation UX gets cumbersome across many projects. — [V7 Labs: Hebbia alternatives](https://www.v7labs.com/blog/hebbia-alternatives); [rfp.wiki review](https://www.rfp.wiki/vendors/hebbia)
- SharePoint autofill columns use LLMs to extract, summarize or generate metadata from files uploaded to a library. The service needs pay-as-you-go through an Azure subscription, and the price fell from $0.05 to $0.005 per page. Sources conflict on whether Knowledge Agent use is included with a Copilot license. — [Microsoft Learn: autofill overview](https://learn.microsoft.com/microsoft-365/syntex/autofill-overview); [Microsoft Learn: autofill setup](https://learn.microsoft.com/en-us/microsoft-365/syntex/autofill-setup); [Cloudwell](https://cloudwell.io/ai-in-sharepoint-knowledge-agent/)
- Box Extract runs automatic extraction on selected folders and offers Extract Agent APIs for third-party apps. Standard and Enhanced agent tiers exist, with Enhanced for complex, multimodal documents. Metadata exports to Snowflake and Databricks. — [Box Extract](https://www.box.com/extract)
- Copilot Studio "content processing tools" are billed at 8 Copilot Credits per page. — [Microsoft Learn](https://learn.microsoft.com/en-us/microsoft-copilot-studio/requirements-messages-management)
- Airtable AI fields are available on all paid plans and generate content from other fields in the same record. A third-party source says field agents run per record and can re-run when the underlying data changes. — [Airtable support: AI in fields](https://support.airtable.com/docs/using-airtable-ai-in-fields.md); [sagnikbhattacharya blog](https://sagnikbhattacharya.com/blog/airtable-vs-google-sheets-business-data-ai-use)
- Google Sheets `=AI("prompt", range)` (or `=Gemini()`) needs an eligible Workspace or Google AI plan. A third-party source says only the first 350 selected cells run at once and the function does not auto-refresh. — [sagnikbhattacharya blog](https://sagnikbhattacharya.com/blog/airtable-vs-google-sheets-business-data-ai-use)
- Notion AI Autofill writes AI-generated database properties (Notion 3.4 part 2, April 2026, per a third-party source). — [beginnersinai](https://beginnersinai.org/notion-ai-review/)
- Ragie instructions apply an extraction prompt with a JSON schema to every created or updated document, filtered by metadata. This is a continuous batch that also backfills over the corpus. — [Ragie entity extraction](https://docs.ragie.ai/docs/entity-extraction)
- MCP tasks were designed for "expensive computations and batch jobs", with polling and deferred results. In 2026-07-28 they became an official extension. — [MCP tasks (2025-11-25)](https://modelcontextprotocol.net/specification/2025-11-25/basic/utilities/tasks); [MCP changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)

### Inferences
- Grey already chunks, embeds and extracts entities on ingest, so a **"Grid / Columns" feature** fits naturally: pick a source filter (type, tag, date, entity mentioned), define columns as prompts or typed fields, and run per source with citations to chunks or timestamps. Export to CSV or Sheets, push to Geiger Flow, or emit through webhook.
- Run it as a durable background job (Vercel Workflow fits this repo's Vercel deployment) with progress, resumability and per-cell retries. Expose the same job through MCP tasks and HTTP.
- BYO cost control is non-negotiable here. Show an **estimate before running** (sources × average tokens × the provider's price), allow a **dry run on N sample documents** (Glean-style preview), set a **hard token or $ cap per job**, and let users pick a cheaper model per column. Batch APIs from providers (where the attached provider supports them) can roughly halve cost, but that is outside this research's evidence.
- "Re-run on change", as with Airtable field agents and Ragie instructions, turns a batch column into a standing extraction that runs on every new source. This is the same feature as the on-ingest extraction in section 1, and building them as one system avoids duplication.

### Gaps
- Official Google documentation on Sheets `=AI()` limits was not read. The 350-cell figure is third-party.
- Hebbia's own product documentation and pricing were not found.
- No public data on typical batch job sizes or accuracy-review rates.

---

## 8. Governance: approvals, audit logs, cost caps per automation

### Takeaway
2026 governance converges on:
1. Per-action **human approval gates** for write or irreversible tools: n8n tool-level human-in-the-loop, Zapier Human in the Loop, Notion `user_confirmed` deletes, Atlassian's option to block agent actions, Glean action packs that must be set to run without confirmation.
2. **Per-run audit trails**: Notion logs what triggered a run, what it did and why. Glean and Dust keep run history and conversations.
3. **Credit budgets with alerts and hard stops**:
   - Notion alerts at 80% and 100% and pauses agents.
   - Copilot Studio lets admins set per-agent monthly caps and disables agents at 125% of capacity.
   - Lindy pauses instead of billing overage.
   - Zep, by contrast, auto-buys credits with uncapped spend.

Per-automation cost caps exist (Copilot Studio) but are rare, which is an opening for a BYO product.

### Cited Findings
- **Copilot Studio**:
  - Admins "can set monthly consumption limits for individual agents in the Power Platform admin center (Licensing > Copilot Studio > Manage Agents)".
  - At 125% of prepaid capacity, custom agents are disabled and users see "This agent is currently unavailable. It has reached its usage limit." Admins are notified by email and in the admin center.
  - Agent-flow enforcement blocks new flow runs but lets runs in progress finish.
  - Capacity can be allocated per environment.
  - The published rates "exclude bring-your-own-model configurations, including Azure Foundry models, which are billed separately."
  — [Microsoft Learn: billing rates and management](https://learn.microsoft.com/en-us/microsoft-copilot-studio/requirements-messages-management)
- Copilot Studio rate card (official):
  - Classic answer 1 credit, generative answer 2, agent action (including triggers) 5, tenant graph grounding 10.
  - Agent flow actions 13 per 100.
  - AI tools per 1K tokens: basic 0.1, standard 1.5, premium (reasoning) 10.
  - Content processing 8 per page.
  - Microsoft offers an agent usage estimator.
  - Third parties put pay-as-you-go at about $0.01 per credit and a 25,000-credit pack at $200 per month.
  — [Microsoft Learn](https://learn.microsoft.com/en-us/microsoft-copilot-studio/requirements-messages-management); [CloudZero](https://www.cloudzero.com/blog/copilot-studio-pricing/)
- **Notion**: admins control who can create agents and can disable any agent. They can see what each agent can access. Credit usage is tracked with alerts at 80% and 100%. Each agent has page-level permissions. "Every run is logged with an audit trail showing what triggered it, what it did, and why," and changes are reversible through version history. Agents pause when credits run out. Credit types are Standard, Select (user-chosen model) and Notion credits, with estimates of about 5, 10 and 25 credits for simple, medium and complex tasks. — [Notion Custom Agents](https://www.notion.com/product/custom-agents); [Notion help](https://www.notion.com/en-gb/help/custom-agent-pricing); [search summary of Notion pricing pages](https://www.notion.com/ko/help/custom-agent-pricing)
- **Glean**: an admin enables content triggers per group, activation is per user, agents run with the activating user's permissions, and run history can be paused. Background (scheduled) runs need action packs explicitly set to run without user confirmation. — [Glean content triggers](https://docs.glean.com/agents/concepts/content-trigger); [Glean May 2026 release](https://docs.glean.com/release-notes/releases/2026-05-06-may-release)
- **Dust**: a per-trigger credit source (member or workspace), default webhook rate limit of 42 runs per 24 hours, and a review panel for triggers and their consumption. — [Dust triggers](https://docs.dust.tt/docs/triggers)
- **n8n** applies human-in-the-loop approval per tool and **Zapier** pauses for approval through email or Slack. — [n8n docs](https://docs.n8n.io/build/integrate-ai/ai-examples/human-in-the-loop-for-tools.md); [Zapier help](https://ob-zapier.helpjuice.com/use-human-in-the-loop-to-pause-zaps-pending-human-review)
- **Atlassian**: admins and users can block agent write actions in automations. Rovo skills can otherwise require user confirmation before writing. — [Atlassian support](https://support.atlassian.com/rovo/docs/agents-in-automations/); [eesel](https://eesel.ai/blog/rovo-agent-automations)
- **Notion MCP**: delete tools require `user_confirmed: true`, and workspace-owned connections expose only admin-selected tools. **Atlassian MCP**: tool permission groups. — [Notion MCP tools](https://developers.notion.com/docs/mcp-supported-tools); [Atlassian supported tools](https://support.atlassian.com/atlassian-rovo-mcp-server/docs/supported-tools/)
- **Gemini Enterprise** (secondary sources): agent-infrastructure components moved from free to metered between July 1 and September 1, 2026. Under "Semantic Governance Policies", each governed tool call is checked by an evaluation model whose tokens are billed. Seats cost $21 to $60 per user per month. — [ecorpit](https://ecorpit.com/gemini-enterprise-agent-platform-cost-breakdown-2026/); [DEV](https://dev.to/mr_manushukla/gemini-enterprise-agent-billing-in-2026-the-august-1-governance-charge-and-how-to-cut-it-5en5)
- **Lindy** pauses credit-using actions when the pool runs low rather than charging overage. **Zep** auto-buys credits below 20%, "so monthly spend is not capped". — [TinyCommand](https://tinycommand.com/ai-agents/lindy-ai-alternatives); [Vectorize](https://vectorize.io/articles/zep-alternatives)
- **Demand and risk signals**: Gartner predicts 40% of enterprise apps will feature task-specific AI agents by the end of 2026, up from less than 5% in 2025. An aggregator reports a Gartner prediction that more than 40% of agentic AI projects will be cancelled by the end of 2027 over cost, unclear value or inadequate risk controls. — [Gartner press release, Aug 26 2025](https://gartner.com/en/newsroom/press-releases/2025-08-26-gartner-predicts-40-percent-of-enterprise-apps-will-feature-task-specific-ai-agents-by-2026-up-from-less-than-5-percent-in-2025); [sqmagazine (aggregator)](https://sqmagazine.co.uk/statistics/agentic-ai-statistics)

### Inferences
- **Grey's governance kit for automations**, given that customers pay their own model bill:
  - **Per-automation budget**: tokens or $ per run, per day and per month, with soft alerts at 80% and 100% (Notion) and a hard stop that pauses rather than overspends (Lindy, Copilot Studio caps).
  - **Pre-run cost estimate and dry run**: Copilot Studio estimator, Glean preview.
  - **Per-trigger rate limits and loop guards**: Dust's 42 per day, Glean excluding its own bot's messages.
  - **Run log**: trigger payload, retrieved chunks and citations, model and provider used, tokens and cost, actions taken, approver (Notion-style audit trail).
  - **Approval gates on outbound or write actions**, routed to email, Slack or a Grey inbox (n8n, Zapier).
  - **Read and write tool groups per API key or MCP connection** (Atlassian, Notion).
  - **Run-as identity and provider-key selection per automation** (Glean).
- Ranking of the most commercially proven patterns, used for depth:
  1. KB-grounded support auto-resolution and agent assist (Fin, Zendesk, Sierra, Decagon): billions in valuation and per-resolution pricing.
  2. Event-triggered agents in enterprise knowledge platforms (Glean, Copilot Studio, Notion, Dust).
  3. On-ingest structured extraction to metadata or rules (SharePoint autofill, Box Extract, Ragie instructions).
  4. Knowledge as a step in workflow builders (Zapier, n8n, Make, Rovo Automation, Workspace Studio).
  5. MCP knowledge servers with read, write and graph tools (Notion, Atlassian, Glean, Slack, Graphiti).
  6. Batch grid extraction (Hebbia, Airtable, Sheets).
  7. Agent memory layers (Mem0, Zep, Supermemory, Cognee, Letta).
  8. Verification and write-back loops (Guru, Zendesk Knowledge Builder).
- **BYO compatibility**:
  - Fully BYO-compatible patterns: 2–8, as shown by n8n self-hosting, Relevance AI and Gumloop BYOK, and Graphiti's multi-provider support.
  - Vendor-model dependent: Fin (proprietary models), Box Extract (Gemini), Gemini Enterprise, and Copilot Studio's standard rates (BYO billed separately).
  - Grey's BYO stance is a differentiator for regulated customers. The cost of that stance is that Grey must build cost controls itself.

### Gaps
- No primary-source data on per-automation cost caps in Zapier, Make, n8n Cloud or Glean.
- Audit-log export formats and retention for Glean and Notion were not researched.
- Reddit and Hacker News sentiment on automation cost blowouts and approval fatigue was not gathered because the search budget ran out.
- The Deloitte 2026 agent-adoption figures (74% expect moderate use by 2027, 25% moved 40% or more of pilots to production) come only from an aggregator. — [ainauten (aggregator)](https://news.ainauten.com/en/story/agentic-ai-enterprise-adoption-2026)
