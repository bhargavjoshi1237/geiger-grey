# Query by image over a private collection: use cases, products, pricing and fit for Geiger Grey

Research date: 2026-10-21. Method note: web search stopped partway through this session because the shared WebSearch budget ran out. Later findings come from fetching vendor pages, docs and the Hacker News Algolia API directly. Several vendors (Bloomreach, Coveo, Amazon's business-facing visual search, Air, Are.na) could not be checked and are listed under Gaps. Vendor-reported statistics are labelled as such.

## 1. Visual similarity over your own catalog or library (e-commerce, DAM, design libraries; is Google Vision Product Search still available?)

### Takeaway
"Find more like this in my own collection" is a standard feature in commerce search and enterprise DAM, and every product sells it on its own proprietary or bundled models. In commerce the value comes from scale and conversion tuning, which is specialist territory. In DAM the feature is usually locked to enterprise tiers, and the main jobs (finding duplicates, finding variants, checking "do we already own this?") are simple enough for a general knowledge platform. Google Cloud Vision Product Search still exists in October 2026, but Google has put it in maintenance mode and points users to Vision Warehouse. No shutdown date has been announced.

### Cited Findings

**Google Cloud Vision API Product Search: status in 2026**
- The Product Search docs say: "The Product Search feature is in maintenance mode." They tell users to move to Vision Warehouse "for better scalability with the same functionality." The page gives no shutdown date. — [Google Cloud Product Search docs](https://docs.cloud.google.com/vision/product-search/docs/apis)
- Product Search is absent from the Vision API deprecations page. That page lists only Celebrity Recognition and OCR On-Prem, both deprecated 16 September 2024 and shut down 16 September 2025. — [Vision API deprecations](https://cloud.google.com/vision/docs/deprecations)
- Vision Warehouse is now described as "a component of Gemini Enterprise Agent Platform Vision", which suggests Vertex AI has been rebranded. It stores and searches streaming video, images and batch video. Its overview page (updated 2026-10-20) mentions "semantic search" in six languages but does not say it accepts an image as the query or does product similarity. No deprecation notice appears. — [Vision Warehouse overview](https://docs.cloud.google.com/vision-ai/docs/warehouse-overview)
- Google's embeddings docs now list a "Gemini Embedding 2" model next to the "Get multimodal embeddings" guide. — [Vertex multimodal embeddings docs](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/embeddings/get-multimodal-embeddings)

**E-commerce visual search, shop the look, "looking similar"**
- **Syte**: sells "Visual Discovery": image (camera) search, Shop Similar, Shop the Look/Room, an inspiration gallery, plus AI tagging and merchandising. Logos shown: Prada, Coleman, Castorama, PrettyLittleThing, Mobly, Farfetch. Vendor-claimed results: 7.1x higher conversion (Coleman), 40% higher AOV (Decathlon), 829% higher ARPU (Chow Sang Sang). No public pricing, demo only. The model is "trained on billions of apparel shopper interactions" (proprietary). — [Syte](https://www.syte.ai/)
- Syte's ownership is unclear. Its privacy policy names "Syte – Visual Conception Ltd., Tel Aviv" as the controller, but the footer links to a URL slug "syte-by-nayax-privacy-dpa". That hints at a Nayax relationship, but nothing found confirms an acquisition. — [Syte privacy policy](https://www.syte.ai/privacy-policy/)
- In 2021 Syte bought the fashion and furniture segments of US visual search company Slyce, for undisclosed terms. — [CX Today](https://www.cxtoday.com/loyalty/syte-acquires-visual-search-company-slyce/)
- **ViSenze was acquired by Rezolve AI (Nasdaq: RZLV)**. The purchase agreement was signed and closed on 7 August 2025. Sellers received $1.0M in Rezolve shares plus a 24-month earn-out tied to recurring revenue. ViSenze's Singapore office became Rezolve's APAC HQ, and ViSenze had raised about US$34.5M before the deal. — [Rezolve FY2025 20-F](https://www.sec.gov/Archives/edgar/data/1920294/000119312526132456/rzlv-20251231.htm); [e27](https://e27.co/singapores-visenze-acquired-by-nasdaq-listed-rezolve-ai-to-power-apac-expansion-20250827/); [ViSenze blog](https://www.visenze.com/visenze-joins-rezolve-ai/)
- **Algolia**: launched "Looking Similar" on 27 February 2024 as part of AI Recommendations. An AI model scans the retailer's product photos and suggests visually similar items. Merchants set a minimum similarity score and filter by color, price or size. It was rolled out to all AI Recommendations customers. The pitch covered out-of-stock substitutes, inspiration and cheaper alternatives. — [Algolia press release](https://www.algolia.com/about/news/algolia-unveils-new-looking-similar-capability-elevating-shopping-experiences-with-image-based-recommendations)
- **Marqo**: has moved from a developer vector-search engine (seed US$5.2M, then a US$12.5M Series A in February 2024 led by Lightspeed, US$17.8M total) to an "AI-native ecommerce search, merchandising, recommendations, and product discovery platform" that "trains a dedicated AI model on your catalog." It claims $130M+ incremental revenue for retailers, including Fashion Nova. No public pricing. — [Marqo pricing page](https://www.marqo.ai/pricing); [Pulse 2.0 Series A](https://pulse2.com/marqo-vector-search-company-raises-12-5-million/); [Marqo blog](https://www.marqo.ai/blog/why-i-joined-marqo)
- **Google Vertex AI Search for commerce**: Google's Conversational Commerce agent went from private preview (March 2025) to GA (September 2025). — [AI Commerce Search release notes](https://docs.cloud.google.com/retail/docs/release-notes). A partner (Grid Dynamics) lists image search ("search with a photo, get ranked items that look and mean similar") among the service's options, but Google's own docs for this were not found. — [Grid Dynamics](https://www.griddynamics.com/solutions/google-discovery-solutions-services)
- **Mixpeek** lists e-commerce "visual search, product page enrichment, catalog QA" as a target use. — [Mixpeek pricing](https://mixpeek.com/pricing)

**Demand signals (consumer visual search, which sets user expectations)**
- Google said in October 2024 that Lens handles nearly 20 billion visual searches a month, about 20% of them shopping-related. — [Scalevise summary](https://scalevise.com/resources/google-lens-visual-search-image-seo/). A later secondary source reports 25 billion a month, citing a June 2026 Think with Google analysis. That figure is Google marketing data and is not independently checked. — [Scalevise](https://scalevise.com/resources/google-lens-25-billion-monthly-visual-searches/)
- Pinterest Lens plus related visual tools reached 600 million visual searches a month (a dated, roughly 2018 figure). Fashion was the top category, followed by home decor, art, food and products. — [VentureBeat](https://venturebeat.com/ai/pinterest-lens-sees-600-million-visual-searches-every-month)
- Market sizing is weak. SkyQuest puts the "visual search market" at US$62.42B in 2025, reaching US$290.84B by 2033 (21.2% CAGR). That number is implausibly broad and its method is unverified. — [GII / SkyQuest](https://www.giiresearch.com/report/sky2078734-visual-search-market-size-share-growth-analysis-by.html). MarketsandMarkets forecast the narrower "image recognition in retail" market at US$3.7B by 2025. — [MarketsandMarkets](https://www.marketsandmarkets.com/Market-Reports/visual-search-market-668.html)

**Digital asset management (DAM) visual search**
- **Bynder** "Search by Image": users upload a file or paste an image URL, and the system embeds it and returns identical or similar DAM assets. An admin must enable it, and uploaded query images are not added to the DAM. Use cases: check whether a stock photo already exists before buying it, find size, format or localized variants, and paste a live URL to confirm the image is still licensed (auditing distributor and reseller sites). It uses "AI-powered image analysis and embedding technology" with no named model. — [Bynder Labs](https://labs.bynder.com/features/search-by-image); [Bynder blog](https://www.bynder.com/en/blog/image-similarity-search/)
- **Cloudinary** Visual Search is a premium feature for Assets Enterprise only. Accounts over 10 million images "may incur extra costs." It accepts an image URL, an existing asset ID or text. Assets must be indexed with visual_search=true. Stated uses are finding duplicates and finding untagged images. — [Cloudinary docs](https://cloudinary.com/documentation/dam_visual_search)
- **Adobe Experience Manager Assets** has had "Find Similar" since 6.5.2.0. It returns similar smart-tagged images, needs Smart Content Service/smart tagging, and works only on images. — [Adobe Experience League](https://experienceleague.adobe.com/en/docs/experience-manager-learn/assets/search-and-discovery/find-similar-images)
- **Canto** markets AI visual search, reverse image search and visual similarity search, including hybrid search over images and video. On its own comparison pages Canto claims Brandfolder offers only tag-based search and Bynder has no true video AI search. These are competitor claims and unverified. — [Canto vs Brandfolder](https://canto.com/compare/canto-vs-brandfolder/); [Canto vs Bynder](https://canto.com/compare/canto-vs-bynder/)
- **Frontify** "Enhanced image search" (open beta) uses Azure OpenAI to analyse images. Its AI page calls image-similarity search "in development." — [Frontify help](https://help.frontify.com/en/articles/12675788-enhanced-image-search); [Frontify AI](https://www.frontify.com/ai)
- A G2 discussion thread asks how important reverse image search is when choosing a brand asset platform. It notes that reviewers praise Bynder's image-similarity matching, and that Canto and Acquia DAM (Widen) also offer AI visual search. — [G2 discussion](https://www.g2.com/discussions/how-important-is-reverse-image-search-when-choosing-a-brand-asset-management-platform)
- **Eagle** (desktop asset manager for designers) offers an AI Search plugin with reverse image search. It runs fully offline, with "no internet connection and no uploads." — [Eagle blog](https://eagle.cool/blog/post/eagle-plugin-ai-search)

**Design and inspiration libraries**
- **Cosmos** offers "Find similar elements" ("Start with an image you love and find more like it") and color search. It is free to join, "used by the world's leading creative teams, studios, and students." — [Cosmos](https://www.cosmos.so/)
- **mymind** pricing sources conflict: $5.99/month flat on Capterra, versus $4.99 and $11.99 tiers with a 100-card free tier on Vantaige. One less reliable source claims search "by content and visual patterns." — [Capterra](https://www.capterra.com/p/10015233/mymind/); [Vantaige](https://vantaige.io/ai-tool/mymind)

**Developer and community demand for own-collection image search (Hacker News)**
- "Show HN: I made a Mac app to search my images and videos locally with ML" (Desktop Docs, May 2024) drew 217 points and 171 comments. Commenters named wedding photographers ("a typical wedding for me had at least 5k raws"), video editors (asking for FCPX/Adobe integration), family archives, near-duplicate cleanup and NAS/Nextcloud indexing. They worried about network privacy ("not clear if it sends absolutely nothing out") and insisted on a trial on their own data. Price dropped from A$75 to US$24.99. Immich and Apple Photos were cited as free alternatives. — [HN thread](https://news.ycombinator.com/item?id=40371467) (via [HN API](https://hn.algolia.com/api/v1/items/40371467))
- "Show HN: Sisi – Semantic Image Search CLI tool, locally without third party APIs" got 128 points and 41 comments (September 2024). — [HN](https://news.ycombinator.com/item?id=41554791)
- In an Ask HN, a media company with a 1M+ image library wanted reverse image search across it to find license holders for older images without licensing data, because "they routinely get notices about infringing on image licenses." — [HN](https://news.ycombinator.com/item?id=33318717)

### Inferences
- In commerce the moat is not the similarity search itself, since CLIP-style embeddings do that. It is catalog-specific training (Marqo, Syte), conversion attribution, merchandising controls and storefront traffic. A per-project platform is not a credible "shop the look" vendor for retailers. It can, however, serve small B2B catalogs, internal merchandising teams ("do we already sell something like this?") and catalog QA such as duplicate or near-duplicate SKUs.
- In DAM the jobs are dedupe, variant lookup, "do we already own this stock image" and licence compliance. These map directly onto Grey plus the suite's Assets app. Incumbents gate visual search behind enterprise tiers (Cloudinary) or admin opt-in (Bynder), or have not shipped it (Frontify), so a project-scoped "search by image" tool is a credible differentiator for small and mid-size teams.
- HN demand is real but mostly personal or prosumer, and those users strongly prefer local/private processing. That fits Grey's BYO-model, per-project data story better than a hosted proprietary model.
- Google Product Search being in maintenance mode, ViSenze being absorbed into Rezolve, and Marqo's pivot to a vertical all suggest the generic "visual product search API" category is consolidating into commerce suites. That leaves room for horizontal tools aimed at non-retail collections.

### Gaps
- Bloomreach, Coveo and Amazon's business-facing visual search were not verified because search hit its budget. Treat any claim about their image-query features as unconfirmed.
- No public pricing for Syte, Marqo, Vertex AI Search for commerce image search, or Bynder/Canto visual search add-ons. The Vision API Product Search pricing page could not be read (fetch was truncated).
- Air (air.inc) and Are.na visual search capabilities were not confirmed.
- No current (2025–2026) Pinterest Lens usage figure was found.
- The Syte–Nayax relationship is unconfirmed.

## 2. "What is this?" identification against a private reference set (spare parts, species, SKU matching, counterfeit, shelf audit)

### Takeaway
Identifying a photo against a private reference set is a proven, paid B2B category with clear ROI stories, especially industrial spare parts (nyris, Partium), shelf audits (Trax IR, now part of FORM) and authentication (Entrupy). The leaders win with proprietary models, CAD-derived synthetic training data, BoM/ERP integration and, for authentication, financial guarantees. A general platform can do "closest matches plus their metadata" for small reference sets (hundreds to tens of thousands of items). It cannot match specialist accuracy on fine-grained or high-stakes identification.

### Cited Findings

**Spare-parts identification (field service, MRO, manufacturing, automotive)**
- **nyris**: sells a no-code Spare Parts Search Suite (search by image, keyword, code or 3D CAD file, plus BoM search and OCR), visual search APIs and SDKs, a synthetic-data pipeline that generates training images from CAD, and a tuning portal. Named customers: Bühler, Volkswagen, Inter Cars, DMG Mori, Trumpf, Claas, Thyssenkrupp Elevator, IKEA, Renault, Schindler, Henkel, Hornbach and others in more than 50 countries. Vendor claims: 3.3x faster and 51% more accurate part identification than keyword search, and synthetic data "99% faster and 90% cheaper" than photography. Listed on the SAP Store. No public pricing. — [nyris](https://www.nyris.io/)
- nyris also publishes domain-specific models such as "Automotive V1" on a public visual product search benchmark site. — [nyris benchmark](https://benchmark.nyris.io/models/automotive_v1)
- **Partium**: was formed by combining Humai, Slyce and Catchoom. Humai's technology is described as reaching "95% or better exact-match recognition" of industrial parts. Its image search recognises parts whether assembled or disassembled, then narrows results with designation, dimensions, weight and parts-list data. manroland Goss customers can submit up to five photos. — [eeNews Europe](https://www.eenewseurope.com/en/image-recognition-partnership-creates-part-id-company/); [manroland Goss](https://www.manrolandgoss.com/en/read-press-release/items/manroland-goss-makes-part-identification-easier-via-partium-the-web-app-for-spare-parts.html)
- Partium raised a US$15M Series A in September 2024, led by Trestle Partners. — [TechNexus](https://www.technexus.com/partiums-ai-search-tool-parts/). Vendor-supplied customer list: Caterpillar, Parker, Liebherr, Deutsche Bahn, New Holland, The Home Depot (the "snap a picture of a part" app feature) and ENGEL. Capterra lists a starting price of "$6000 Usage Based, Per Year" and "millions of spare part searches every month" (vendor claim). — [Capterra](https://www.capterra.com/p/213285/Partium/)
- **XOi** (field service for HVAC and similar trades): a technician photographs an equipment data plate, OCR extracts make, model and serial number, and the app "automatically identifies the equipment and pulls up its service history, manuals, and relevant service bulletins" and "known equipment issues." It integrates with ServiceTitan. XOi raised US$230M and acquired Specifx. — [XOi data plate video](https://xoi.io/videos/micro-learning-capturing-a-data-plate); [XOi news](https://xoi.io/company/news-and-press/the-xoi-experience-just-got-faster); [ServiceTitan marketplace](https://marketplace.servicetitan.com/partner/xoi); [XOi/TechCrunch](https://xoi.io/company/news-and-press/techcrunch-xoi-raises-230m-acquires-specifx-to-expand-its-tech-for-field-service-technicians)
- **Tractable** also sells "part identification" to auto recyclers as part of its damage-AI suite. — [Tractable](https://tractable.ai/)

**Species and plant identification**
- **Pl@ntNet API**: free tier of 500 identifications a day on EU-hosted servers. Pay-as-you-go pricing per 1,000 identifications falls with volume: €5 from 200k a year, then €4, €3 and €2 at 3M, 30M and 300M. A Pro contract needs 200k requests upfront and a €1,000 initial payment. Non-profit terms conflict between sources. — [Pl@ntNet pricing](https://my.plantnet.org/pricing); [Pro plan doc](https://my.plantnet.org/doc/getting-started/pro-plan)

**Retail shelf auditing and SKU recognition**
- **Trax**: "FORM is the new home of Trax IR". Trax Retail and FORM "have joined forces." Trax IR analyses shelf images for availability, share of shelf, planogram, price and promotion compliance, with field-team "next best action." Customers shown: AB InBev, Unilever, Opella, Sanofi, Heineken, Labatt. Contact-us pricing. — [Trax Retail](https://traxretail.com/)
- A secondary source says Gemspring merged Trax IR into FORM in February 2026, with licensing by store count, SKU scope and image volume, and vendor-reported Henkel results of 4.3% fewer out-of-stocks and a 2.1% sales uplift. This is unverified against primary sources. — [KI-Syndikat](https://www.ki-syndikat.de/tools/trax-retail/)
- Competitors named by CB Insights (dated): Scandit, Simbe, One Door, plus Vispera and Pensa Systems. — [CB Insights](https://www.cbinsights.com/investor/trax-technology-solutions)

**Counterfeit and authentication**
- **Entrupy**: AI authentication from a smartphone for bags, leather goods, footwear, apparel and jewelry, plus return-fraud detection. It claims 99.86% accuracy and backs "every item... 100% financially for a full year." Customers include resellers, pawnshops and marketplaces (logos suggest StockX and ShopGoodwill). Prices are not shown on the homepage. — [Entrupy](https://www.entrupy.com/)
- Bynder's URL-based search by image doubles as an image-licence compliance check on reseller and distributor sites. — [Bynder Labs](https://labs.bynder.com/features/search-by-image)

**Hyperscaler building blocks for "match against my catalog"**
- Bedrock Knowledge Bases (multimodal, GA November 2025) advertises "search product catalogs using images" and "product matching, visual similarity search." — [AWS docs](https://docs.aws.amazon.com/bedrock/latest/userguide/kb-multimodal.md)
- Google Product Search was built for this job and is now in maintenance mode (see section 1). — [Google docs](https://docs.cloud.google.com/vision/product-search/docs/apis)

### Inferences
- XOi's pattern (photo, then OCR or recognition, then look up that equipment's manuals, history and bulletins) is the clearest "identify, then answer" workflow a knowledge platform can copy. Most of the value is in the retrieval of documents attached to the identified entity, and Grey already holds those documents in a project. The identification step can be OCR (a model plate or label) or nearest-neighbour image match against a few reference photos per item.
- Spare-parts specialists justify about US$6k+/year entry pricing (Partium, per Capterra) and enterprise deals with OEMs. They differentiate on CAD-to-synthetic-image training, BoM and filter narrowing, and SAP integration. A Grey tool could cover a long tail of small manufacturers, distributors or maintenance teams with a few thousand parts, where nyris or Partium would be too heavy.
- Shelf audits and counterfeit detection need custom detectors, controlled capture, field workflows or physical-authentication guarantees. They are poor fits for a horizontal platform.
- Species ID needs a huge public reference set, which is the opposite of a private collection. Grey adds value only when the reference set is private (a herbarium's own specimens, a nursery's stock list) or by calling a BYO API.

### Gaps
- No public per-query pricing for nyris, Trax IR or Entrupy (beyond "contact us").
- No independent accuracy benchmarks for photo-based part ID. All accuracy figures are vendor claims.
- The Gemspring/FORM/Trax deal terms and date were not confirmed by a primary source.
- Automotive OEM parts catalogs (for example dealer parts-counter tools) and SKU matching for marketplaces were not researched further.

## 3. "Find past similar cases and their answers" (insurance, manufacturing defects, medical, field service, real estate, construction, support tickets)

### Takeaway
This is the use case closest to Grey's headline example (c), "answer for this image based on similar stored items." Specialists exist in insurance (Tractable), real estate condition scoring (Restb.ai) and dermatology education (DermEngine), but most enterprise "similar case" tools still match on text and event data, not images (Freshservice, SAP). Searching image-heavy case history (support tickets with screenshots, QA defect logs, site-issue photos) for the cases and resolutions they hold is a gap a horizontal platform can fill. Regulated outputs (claim estimates, diagnoses) still need specialists.

### Cited Findings

**Insurance claims (damage photos)**
- **Tractable**: AI damage detection and assessment for vehicles. It serves insurers (streamlined claims), dealerships, repairers, recyclers (salvage bidding, part ID) and fleet/rental (check-in and check-out). Logos: Mitchell, Aviva, Tokio Marine, Sompo, Admiral, MSAD/Aioi. News: Foyer partnership (May 2026), renewed Covéa partnership in France (April 2026), Everest Group Top 50 P&C insurtech 2026. Trained on "millions of data-rich images", processes "thousands of claims daily", and gives each estimate a certainty score based on visibility, image quality and severity. No public pricing. — [Tractable](https://tractable.ai/)
- In 2020 Tractable raised a US$60M Series D at a US$1B valuation and said more than 20 of the global top 100 auto insurers used it. The Hartford uses it for US auto claims. These figures are dated. — [Coverager](https://coverager.com/tractable-becomes-worlds-first-computer-vision-unicorn-for-financial-services/); [Insurance Business](https://insurancebusinessmag.com/us/news/technology/the-hartford-will-use-ai-to-appraise-auto-damage-245050.aspx)

**Manufacturing defect images**
- Patents describe "similar-defect search": retrieving past defects with known causes, and matching a defect image to a knowledge base entry linked to a root cause and corrective action. — [USPTO 12124503](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/12124503); [USPTO 12422378](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/12422378)
- **Instrumental** applies computer vision to RGB, AOI, X-ray and microscope images to flag known defects and new anomalies, then builds pass/fail models to find affected units. — [Siemens partner blog](https://blogs.sw.siemens.com/partners/ai-analysis-to-find-root-cause/)
- **SAP** markets AI that "detects similar defects, reuses past resolutions" in Digital Manufacturing. It works from event and text data, not images. — [SAP use case](https://www.sap.com/use-cases/increase-quality-engineer-productivity-in-issue-resolution)
- **Amazon Lookout for Vision** (managed visual defect detection) closed to new customers on 10 October 2024 and was discontinued on 31 October 2025. AWS recommended APN partner solutions, SageMaker JumpStart defect models, or Amazon Bedrock foundation models. — [AWS ML blog](https://aws.amazon.com/blogs/machine-learning/exploring-alternatives-and-seamlessly-migrating-data-from-amazon-lookout-for-vision/)

**Medical and dermatology similar-case retrieval**
- **DermEngine Visual Search** shows visually similar dermoscopic images plus statistics on the diagnoses and malignancy of the top matches. It is "for educational purposes only... not a diagnostic tool." — [DermEngine help](https://help.dermengine.com/how-do-i-use-visual-search)
- Google's consumer dermatology tool (three photos plus a questionnaire) returns dermatologist-reviewed information and "similar matching images from the web." It carried an EU CE mark as a Class I medical device, was trained on about 65,000 images, and was not available in the US. — [MobiHealthNews](https://www.mobihealthnews.com/news/google-gives-sneak-peek-its-new-ai-dermatology-assistant); [HealthITAnalytics](https://healthitanalytics.com/news/google-unveils-artificial-intelligence-tool-for-dermatology)
- A JAMA Dermatology study of Google reverse image search on 100 classic dermatology images found the correct diagnosis missing from the most similar images of skin cancers 20–30% of the time. — [JAMA Dermatology (proxy link)](https://jamanetwork-com.libproxy.ajou.ac.kr/journals/jamadermatology/article-abstract/2529572)
- Google's Derm Foundation embedding model is now "legacy" ("Use MedSigLIP for new development"). Its documented uses are data-efficient classification, not case retrieval, under the Health AI Developer Foundations terms. — [Derm Foundation](https://developers.google.com/health-ai-developer-foundations/derm-foundation)

**Field-service troubleshooting from a photo**
- XOi's data-plate photo brings up service history, manuals, service bulletins and "known equipment issues" at the point of service (see section 2). — [XOi](https://xoi.io/company/news-and-press/the-xoi-experience-just-got-faster)

**Real-estate comparables**
- **Restb.ai** sells property-photo computer vision with volume-based pricing: a fixed monthly fee that includes a set number of API calls, per-call overage, and batch pricing for large datasets. No list prices. — [Restb.ai FAQ](https://restb.ai/company/faq/)
- Realsy's AI valuation uses Restb.ai condition and quality scores for both subject and comparable properties to drive adjustments. — [citybiz](https://www.citybiz.co/?p=880819)

**Construction site issues**
- **OpenSpace** maps 360° and phone photos to floor plans and BIM by time and location ("find conditions by location and date"), and MIT News says it was deploying analytics to "search for objects on their job sites." No photo-to-similar-photo feature was confirmed. — [MIT News](https://news.mit.edu/2020/openspace-construction-1021)

**Support tickets with screenshots**
- **Freshservice** Similar Ticket Suggester compares an open ticket with past resolved ones in the same workspace and type so agents can reuse fixes. It is documented as text-based, with no image input. — [Freshservice](https://support.freshservice.com/support/solutions/articles/50000009528-identify-similar-tickets-using-similar-ticket-suggester)
- Only one minor vendor (DeskGraph) claims it can find past tickets "by meaning and screenshots." This is marketing with no technical detail. — [StackShare](https://stackshare.io/find-similar-support-tickets-with-ai)

**Platform guidance relevant to "answer from similar items"**
- Azure AI Search docs say direct multimodal embeddings suit "find-me-something-that-looks-like-this," but "because the representation is purely mathematical, it doesn't convey why two images are related, and it doesn't offer the LLM ready context for citations." They recommend combining verbalized captions (for RAG) with direct image embeddings (for similarity). — [Azure AI Search multimodal overview](https://learn.microsoft.com/azure/search/multimodal-search-overview)
- Bedrock KB `RetrieveAndGenerate` (generating an answer) "is supported when using BDA processing or when the knowledge base contains text content." Image-query similarity runs on the Nova embedding path. — [AWS docs](https://docs.aws.amazon.com/bedrock/latest/userguide/kb-multimodal.md)

### Inferences
- For "find similar past cases and their answers", stored items must carry both an image embedding (for matching) and the case text: resolution, root cause, cost, outcome. Hyperscaler docs confirm that pure image vectors cannot ground an answer on their own. Grey's existing chunk, graph and text pipeline is already the "answer" half. The new piece is attaching image vectors and captions to the same source or case record.
- Strong fits for Grey: support tickets with screenshots (Grey or Forms holding tickets), internal QA and defect logs at small manufacturers, construction punch-list or site-issue photos stored per project, field-service troubleshooting against manuals already in the project. Incumbents here are either text-only (Freshservice, SAP) or heavy point solutions.
- Weak fits: auto and property claim estimation (Tractable has millions of labelled images, repair-cost data and insurer integrations), clinical similar-case retrieval (regulatory status, documented failure rates in JAMA Dermatology), and appraisal-grade real-estate condition scoring (Restb.ai, valuation compliance).
- The shutdown of Lookout for Vision, with AWS pointing users to foundation models, suggests buyers are being steered from bespoke defect services toward general foundation-model building blocks. That trend favours a horizontal tool with bring-your-own models.

### Gaps
- No product found that lets insurers search their own past claim photos for similar claims and outcomes, as opposed to estimating damage. This is unconfirmed rather than proven absent.
- No pricing for Tractable, Instrumental or DermEngine.
- Photo-to-similar-photo search in construction (OpenSpace, Procore, CompanyCam) was not confirmed.
- No evidence was found that Zendesk or Intercom do image-based similar-ticket retrieval. Not researched further because of the search budget.

## 4. Finding things inside images (object/region search, visual document retrieval, screenshot/UI search, video moment search by image)

### Takeaway
"Find inside" splits into three markets. (1) Visual document retrieval with ColPali-style models is mature in open source and runs on Postgres/pgvector (ColiVara), which makes it directly feasible for Grey. (2) Video moment search by image is a paid API (Twelve Labs) that Grey users could plug in as a BYO provider. (3) Screenshot and screen-memory search has strong consumer demand, but the best-known product (Rewind/Limitless) was absorbed by Meta and its screen capture shut down. Logo or part search across a photo library is offered mainly by media-AI platforms (Mixpeek, Coactive) at enterprise prices.

### Cited Findings

**Visual document retrieval (diagrams, charts, scanned pages; ColPali)**
- ColPali makes multi-vector embeddings "purely from visual document features" with no OCR, and introduced the ViDoRe benchmark. Models, data and code are openly licensed. — [ColPali paper](https://arxiv.org/pdf/2407.01449)
- A reproducibility study found ColPali-style performance "degrades as the corpus size increases." — [arXiv 2505.07730](https://arxiv.org/pdf/2505.07730)
- Vespa (September 2024) scales ColPali with binary quantization. Each page is about 1,030 vectors × 128 dimensions, about 16 KB a page binarized, with 32x storage savings. DocVQA nDCG@5 is 52.4 for float, 49.5 for binary, and 51.6 for binary plus float re-rank. It positions ColPali as the retrieval step before a VLM answers. — [Vespa blog](https://blog.vespa.ai/scaling-colpali-to-billions/)
- **ColiVara**: an open, ColPali-based "store, search and retrieve documents by visual embeddings" service for 100+ file formats, with a hosted API, Python/TS SDKs, metadata filtering, an embeddings-only endpoint, and self-hosting on **Postgres + pgvector** (an 8 GB+ GPU is needed for embeddings). About 1.5k GitHub stars. License is Functional Source License 1.1 (Apache 2.0 future license). — [ColiVara GitHub](https://github.com/tjmlabs/ColiVara)
- Mixpeek's comparison of visual document retrieval models (tested September 2026) warns that index size scales with vectors per page × dimension × bytes, for example 179 GiB versus 896 GiB for the same corpus. A September 2026 practitioner post says full-precision ColPali over a document lake reached 2.1 TB (anecdotal). — [Mixpeek list](https://mixpeek.com/curated-lists/best-visual-document-retrieval-models); [dailyaiworld](https://dailyaiworld.com/blogs/colpali-visual-retrieval-agents-pdfs-screenshots)
- Azure AI Search pitches multimodal search for "charts, screenshots, infographics, scanned forms." Its example answers an HR-approval question whose only source is a diagram inside a PDF. — [Azure AI Search](https://learn.microsoft.com/azure/search/multimodal-search-overview)

**Video moment search by image**
- **Twelve Labs** Search API (`POST /v1.3/search`) takes `query_media_type=image` with up to 10 images per query by URL or file. It can combine `query_text` with images ("composed retrieval", for example a player photo plus a phrase). It runs on Marengo, with a 500-token text limit. — [Twelve Labs API reference](https://docs.twelvelabs.io/v1.3/api-reference/any-to-video-search/make-search-request); [Marengo 3.0 docs](https://docs.twelvelabs.io/docs/concepts/models/marengo/marengo-3-0)
- Twelve Labs pricing (October 2026): Free $0 (3 GB storage), Plus $29/month (50 GB), Pro $99/month (200 GB, optional overage), Enterprise custom with SSO/SAML. Annual billing is 17% cheaper. Marengo search counts against a "Workload" allowance. — [Twelve Labs pricing](https://www.twelvelabs.io/pricing)
- Twelve Labs is also a multimodal embedding provider inside Weaviate. — [Weaviate model providers](https://docs.weaviate.io/weaviate/model-providers)

**Object, logo and region search across a library**
- **Mixpeek** lists logo detection (IP and copyright detection), face search ($0.10/min), on-screen text ($0.10/min), scene search and "visual similarity" as features for advertising, entertainment and e-commerce buyers. — [Mixpeek pricing](https://mixpeek.com/pricing)
- **Coactive**: an API-first platform to "search, tag, & analyze petabytes of image & video" (Dynamic Tags, Content Discovery, Context Studio). Customers: NBCUniversal, Thomson Reuters, A+E Networks, Fandom, Emplifi. Buyers are media and publishers, agencies and brands, and ad tech. The homepage does not mention search by image, and there is no public pricing. — [Coactive](https://www.coactive.ai/). A third party reports a "12-month contract with a base cost of $75,000" (unverified). — [eesel.ai](https://www.eesel.ai/blog/coactive-ai-pricing)
- OpenSpace's object search on job sites (see section 3). — [MIT News](https://news.mit.edu/2020/openspace-construction-1021)

**Screenshot and UI search**
- **Limitless (formerly Rewind) was acquired by Meta.** Pendant sales ended 5 December 2025. Rewind's update "disables all screen and audio capture starting December 19, 2025." Service ended in the EU, UK, Brazil, China, Israel, South Korea and Turkey on 5 December 2025. — [Limitless](https://www.limitless.ai/)
- HN demand: "Screenshot Hero – iPhone app to make all photos text searchable" got 429 points and 118 comments (2020). "Memos – Search engine for your screenshots and photos" got 112 points (2019). "Local privacy-first Microsoft Recall alternative with Gemma 4" (ScreenMind) was posted in July 2026, and a CLI to "search screenshots by what's in them" with local Ollama in January 2026. — [HN Show HN search](https://hn.algolia.com/api/v1/search?query=screenshot%20search&tags=show_hn&hitsPerPage=20)

### Inferences
- ColiVara shows ColPali-style page retrieval running on the same Postgres/pgvector stack Grey uses. The cost is storage (multi-vector per page) and GPU or BYO-provider embedding calls. "Find the page with this diagram or chart" (query by a screenshot of a page) is a natural Grey tool, especially for technical manuals and scanned archives.
- Video moment search by image is commercially packaged by Twelve Labs at $29–$99/month self-serve. Grey should treat it as a BYO provider rather than compete, which fits the BYO-only model.
- Since Rewind/Limitless left, there is no prominent cross-platform screenshot-memory product. HN shows ongoing local-first interest, but that is personal productivity, not Grey's per-project B2B focus. The B2B version is "find the screenshot or UI state in our project's support or QA history."
- Logo and object search across media archives is sold at enterprise media prices (Coactive about $75k/year, Mixpeek Enterprise from $10k/month). Mid-market agencies and brand teams are probably underserved, and could be reached through Grey plus Assets.

### Gaps
- No pricing found for hosted ColiVara or Vespa Cloud ColPali deployments.
- Region-level ("crop and search") object search in DAMs was not confirmed for any vendor.
- No market data on screenshot or UI search in B2B QA or support settings.

## 5. Other media as the query (audio similarity, video frames, document pages)

### Takeaway
Query by audio is a niche, specialist market (music catalogs: Cyanite; fingerprinting: Mixpeek). Hyperscaler knowledge bases treat audio and video mainly as text-searchable via transcripts, not as query inputs. Video-frame and page-image queries are covered by Twelve Labs and ColPali-style retrieval (section 4). Audio-as-query is the least proven demand among Grey's candidate tools.

### Cited Findings
- **Cyanite** (music catalog AI): similarity search by reference track from a library, a YouTube link or a Spotify preview (30-second snippet), via API or web app. Free tier for individuals. Enterprise pricing combines API subscription, usage-based analysis fees and search subscriptions, with volume discounts. Exact prices are unpublished, and third-party figures conflict. — [Cyanite blog](https://cyanite.ai/blog/similar-song-finder-ai/); [Cyanite FAQ](https://cyanite.ai/faq/); [AIMusicPreneur](https://www.aimusicpreneur.com/ai-tools/cyanite/)
- **Bedrock Knowledge Bases**: audio retrieval is "search audio files using text queries" with timestamped segments, and video is "locate specific moments within video files using text queries." Image queries are the only non-text query type, and only with Nova Multimodal Embeddings. Pitched for "customer support call recordings" and "training videos." — [AWS docs](https://docs.aws.amazon.com/bedrock/latest/userguide/kb-multimodal.md)
- **Mixpeek** lists "audio fingerprint" as a feature, with audio processing at $0.01/min and video at $0.05/min. — [Mixpeek pricing](https://mixpeek.com/pricing)
- **Twelve Labs** Marengo separates audio into speech and non-speech and offers non-verbal audio embeddings for video. — [Twelve Labs modalities](https://docs.twelvelabs.io/docs/concepts/modalities)
- **Weaviate** lists Meta ImageBind (locally hosted) among multimodal providers. — [Weaviate model providers](https://docs.weaviate.io/weaviate/model-providers)
- **Ragie** prices audio at $0.0067/min and video at $0.025/min of processing (Starter and Pro), with $0.12/GB/month media storage. It is billed as content to retrieve over, with no documented audio-as-query. — [Ragie pricing](https://ragie.ai/pricing)

### Inferences
- For calls and meetings, buyers want "find calls like this one" in terms of content (topic, objection, issue), which transcripts plus text embeddings already cover. Acoustic similarity matters mainly in music and sound libraries and in media monitoring. That is low priority for Grey unless a customer has a sound-asset library through Assets.
- A "query by document page" tool (upload a page or screenshot, find similar pages and their context) is the most practical non-photo media query for Grey, because project sources are heavily documents.

### Gaps
- No vendor found selling "find similar customer calls by audio" as a distinct product. Contact-center analytics vendors were not researched because of the search budget.
- No pricing for Cyanite search subscriptions.

## 6. Multimodal RAG and retrieval products that already accept image input over private data: what they charge and who buys

### Takeaway
Hyperscalers now ship image-as-query retrieval over a customer's data, but they tie it to their own embedding models: AWS to Nova Multimodal Embeddings, Azure to Azure Vision or a model hosted through Foundry/AML. Answer generation from image-only matches is limited. Developer platforms (Weaviate, Pinecone, Mixpeek Standalone) let customers bring their own vectors or keys. Self-serve list prices cluster at $25–$500/month (Twelve Labs, Mixpeek, Ragie), with enterprise tiers from about $10k/month (Mixpeek) and about $75k/year (Coactive, unverified). Ragie, the closest "RAG-as-a-service" analogue to Grey, documents ingesting images, but its pricing page says nothing about image-as-query.

### Cited Findings

**AWS Bedrock Knowledge Bases (multimodal)**
- GA November 2025. — [AWS What's New](https://aws.amazon.com/pt/about-aws/whats-new/2025/11/multimodal-retrieval-bedrock-knowledge-bases/)
- Two processing paths. **Nova Multimodal Embeddings** (Amazon's model) embeds images, audio and video natively and is the only path that supports image queries ("product matching, visual similarity search"). **Bedrock Data Automation** converts media to text (ASR, scene summaries, OCR) and supports `RetrieveAndGenerate`. Connectors cover S3 and custom data sources. AWS now recommends "Amazon Bedrock Managed Knowledge Base" for accuracy. — [AWS docs](https://docs.aws.amazon.com/bedrock/latest/userguide/kb-multimodal.md)
- Image queries are sent as an `imageQuery` with inline base64. — [AWS test-and-query docs](https://docs.aws.eu/bedrock/latest/userguide/kb-multimodal-test-and-query.html)

**Azure AI Search (also underpins Foundry IQ)**
- There are two paths: verbalization (a GenAI Prompt skill captions images with an LLM, then text embeddings) or direct multimodal embeddings. Image-to-vector queries need the **Azure Vision multimodal embeddings skill** or the **AML skill** (Foundry-catalog models) with a matching vectorizer. The verbalization path "doesn't support image-to-vector queries." Content Understanding adds AI image descriptions from the `2026-05-01-preview` API. Billing follows Azure AI Search and Content Understanding pricing. — [Azure AI Search multimodal overview](https://learn.microsoft.com/azure/search/multimodal-search-overview)

**Google**
- Vertex/"Gemini Enterprise Agent Platform" offers multimodal embeddings (now including Gemini Embedding 2) and Vision Warehouse, and Product Search is in maintenance mode. — [Embeddings docs](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/embeddings/get-multimodal-embeddings); [Vision Warehouse](https://docs.cloud.google.com/vision-ai/docs/warehouse-overview); [Product Search](https://docs.cloud.google.com/vision/product-search/docs/apis)
- Exact Vertex multimodal embedding prices could not be read from the pricing page (fetch returned only the title). — [Vertex pricing](https://cloud.google.com/vertex-ai/generative-ai/pricing)

**Ragie**
- Developer tier free (1,000 pages, 1,000 retrievals). Starter $100/month (10k pages). Pro $500/month (60k pages). Enterprise custom. Overage is $0.02/page fast or $0.05/page hi-res, with storage at $0.002/page/month. "A single, standalone image file is counted as one page, using hi-res mode." Audio is $0.0067/min and video $0.025/min. Extra connectors are $250/month each. The pricing page lists "Multi-Modal"/"Multimodal RAG" only in navigation, with no image-as-query description. — [Ragie pricing](https://ragie.ai/pricing)

**Mixpeek** (multimodal "warehouse")
- Build $25/month plus usage ($10 included), Scale $250/month plus usage ($100 included, SSO), Enterprise from $10,000/month (single-tenant, bring your own extractors, custom model training). Rates: images and document pages $1.50 per 1,000, video $0.05/min, audio $0.01/min, multimodal understanding $0.50 per 1,000 images, standalone vectors $1.56 per million per month, queries $2 per million beyond the pool. Standalone tier is BYO embeddings. BYO extractors only on Enterprise. — [Mixpeek pricing](https://mixpeek.com/pricing)

**Twelve Labs** (video-native; image queries supported)
- $0 / $29 / $99 / Enterprise per month. Image and composed image+text queries over video indexes. Proprietary Marengo models. — [Twelve Labs pricing](https://www.twelvelabs.io/pricing); [API reference](https://docs.twelvelabs.io/v1.3/api-reference/any-to-video-search/make-search-request)

**Vector databases (BYO models)**
- **Weaviate** integrates multimodal embedding providers Cohere, Google, Jina AI, NVIDIA, TwelveLabs, Voyage AI and Weaviate Embeddings (API), plus local Hugging Face CLIP and Meta ImageBind. Customers pass their own provider API keys by request header or environment variable ("never part of the collection configuration"). — [Weaviate model providers](https://docs.weaviate.io/weaviate/model-providers)
- **Pinecone** publishes CLIP text-to-image and image-to-image search tutorials. Customers bring their own embeddings. — [Pinecone learn](https://www.pinecone.io/learn/clip-image-search/)
- **Marqo** has left the generic vector-DB market for e-commerce (see section 1). — [Marqo](https://www.marqo.ai/pricing)

**Computer-vision platforms**
- **Roboflow** pricing has changed repeatedly in 2026. A September 2026 Roboflow blog says the Core plan "now starts at $0 and includes 10 credits," Serverless API moves to per-image pricing, and self-hosted Roboflow Inference becomes free. A third-party tracker reported Core at $39/month on 4 October 2026, and earlier 2026 captures showed $79/month annual ($99 monthly). — [Roboflow blog](https://blog.roboflow.com/making-it-easier-cheaper-to-deploy-with-roboflow/); [usagepricing.com](https://www.usagepricing.com/blueprint/activity/roboflow-2026-10-04-core-price-cut-free-credits); [Roboflow credits docs](https://docs.roboflow.com/platform/billing-and-plans/credits)
- **Clarifai**: Capterra lists usage-based pricing "starting at $1.2" per month, with a free trial (a directory figure, unverified). The official pricing page refused the connection. — [Capterra](https://www.capterra.com/p/166972/Clarifai/)
- **Coactive**: enterprise media and ad tech, about $75k/year base per one third party. — [eesel.ai](https://www.eesel.ai/blog/coactive-ai-pricing)

**Who buys (as named by vendors)**
- AWS: "search product catalogs using images, find specific moments in training videos, and retrieve relevant segments from customer support call recordings." — [AWS docs](https://docs.aws.amazon.com/bedrock/latest/userguide/kb-multimodal.md)
- Mixpeek: advertising, entertainment, e-commerce, education, creative teams (iconik and Mux integrations), and regulated enterprises. — [Mixpeek pricing](https://mixpeek.com/pricing)
- Coactive: NBCUniversal, Thomson Reuters, A+E, Fandom, Emplifi. — [Coactive](https://www.coactive.ai/)

### Inferences
- Hyperscalers bind image-query capability to their own embedding model, so customers on Bedrock or Azure cannot freely choose Cohere, Voyage, Jina or Nomic for visual similarity without custom work (the AML skill route). Grey's BYO stance, letting users attach any multimodal embedding provider key, is a real differentiator, and matches how Weaviate exposes provider keys.
- Ragie, the nearest competitor in shape (RAG-as-a-service with connectors), shows no image-query feature on its pricing page. If that holds, "query by image" tools inside a per-project knowledge platform are not yet table stakes in Grey's direct category.
- Pricing benchmarks for packaging a Grey visual-search tool: self-serve multimodal retrieval sells at $25–$500/month, enterprise media AI at $10k+/month. Because Grey pays for no models, its pricing can rest on platform value (storage, tools, suite integration) rather than resold inference.
- Building answers from image matches needs a second representation (captions or verbalization) or a VLM over retrieved images. Both Azure and AWS docs confirm image-vector-only stores do not ground generation well.

### Gaps
- Vertex AI RAG Engine and Vertex multimodal embedding pricing were not captured.
- Pinecone Assistant's multimodal support and pricing were not confirmed.
- Nova Multimodal Embeddings pricing on Bedrock was not captured.
- Ragie's docs (as opposed to its pricing page) were not checked for image-as-query support, so "not supported" is unconfirmed.

## 7. Which use cases fit a horizontal, per-project knowledge platform with BYO models and a suite (Assets, Forms, Flow), and which need vertical depth?

### Takeaway
Grey fits use cases where the collection is private and moderate in size (up to about hundreds of thousands of items per project), where the "answer" lives in documents or case records already in the project, and where errors are cheap. Examples: DAM-style dedupe and variant search, "what is this part, plus its manual," "find similar past tickets or defects and their fixes," page or diagram retrieval, and video moment search through BYO Twelve Labs. Vertical specialists keep e-commerce storefront search at scale, insurance estimating, clinical imaging, shelf audits, authentication and OEM-scale parts catalogs. Their moats are proprietary training data, custom detectors, regulation, financial guarantees and huge catalogs.

### Cited Findings (evidence used for the fit assessment)
- Specialist vendors train or tune proprietary models on domain or customer data: Syte ("trained on billions of apparel shopper interactions"), Marqo ("trains a dedicated AI model on your catalog"), nyris (CAD-to-synthetic-image pipeline), Tractable ("millions of data-rich images", certainty scores), Entrupy (99.86% claimed, financially backed). — [Syte](https://www.syte.ai/); [Marqo](https://www.marqo.ai/pricing); [nyris](https://www.nyris.io/); [Tractable](https://tractable.ai/); [Entrupy](https://www.entrupy.com/)
- Regulatory and accuracy barriers in medical: Google's derm tool was positioned as a CE Class I device and not launched in the US, and generic reverse image search missed the correct skin-cancer diagnosis 20–30% of the time. — [MobiHealthNews](https://www.mobihealthnews.com/news/google-gives-sneak-peek-its-new-ai-dermatology-assistant); [JAMA Dermatology](https://jamanetwork-com.libproxy.ajou.ac.kr/journals/jamadermatology/article-abstract/2529572)
- Shelf audits need fixed cameras, robots and on-device recognition, are licensed by store count and SKU scope, and are sold to CPG majors. — [Trax Retail](https://traxretail.com/); [KI-Syndikat](https://www.ki-syndikat.de/tools/trax-retail/)
- Incumbent DAM visual search is gated (Cloudinary Enterprise-only, extra cost above 10M images; Bynder admin-enabled; Frontify similarity still "in development"), so mid-market teams have limited access. — [Cloudinary](https://cloudinary.com/documentation/dam_visual_search); [Bynder Labs](https://labs.bynder.com/features/search-by-image); [Frontify AI](https://www.frontify.com/ai)
- Text-only similar-case tools dominate service desks and manufacturing quality (Freshservice, SAP). — [Freshservice](https://support.freshservice.com/support/solutions/articles/50000009528-identify-similar-tickets-using-similar-ticket-suggester); [SAP](https://www.sap.com/use-cases/increase-quality-engineer-productivity-in-issue-resolution)
- Visual document retrieval runs on Postgres/pgvector (ColiVara), the same stack as Grey. — [ColiVara](https://github.com/tjmlabs/ColiVara)
- AWS retired its bespoke defect-detection service and pointed customers to foundation models and partners. — [AWS ML blog](https://aws.amazon.com/blogs/machine-learning/exploring-alternatives-and-seamlessly-migrating-data-from-amazon-lookout-for-vision/)
- Private-collection users on HN prioritise local or private processing and trials on their own data. — [HN Desktop Docs thread](https://news.ycombinator.com/item?id=40371467)
- XOi's identify-then-retrieve-docs workflow (data plate photo, then manuals, bulletins and history) is a paid field-service product category. — [XOi](https://xoi.io/videos/micro-learning-capturing-a-data-plate)

### Inferences (fit matrix)

| Use case | Buyer | Uploads | Expects back | Fit for Grey (horizontal, BYO, suite) | Why |
|---|---|---|---|---|---|
| DAM dedupe / variants / "do we own this?" / licence check | Brand, marketing and creative ops at SMB and mid-market | Reference image or URL | Identical or near matches with metadata and usage rights | **Strong** (with Assets) | Simple embeddings suffice, and incumbents gate the feature. Licence data can live in Grey sources or Forms. |
| Design inspiration "more like this" | Designers, studios | Image | Visually similar saved items | **Moderate** | Easy technically, but consumer tools (Cosmos, Eagle, mymind) are free or cheap and local-first. |
| E-commerce shop-the-look / visual storefront search | Retail e-commerce | Shopper photo | Ranked purchasable SKUs | **Weak** | Needs catalog-trained models, merchandising, traffic-scale latency and conversion attribution (Syte, Marqo, Algolia). |
| Internal catalog or B2B SKU match (small catalogs) | Distributors, wholesalers, sales reps | Photo of item | Closest SKUs plus specs and price sheet | **Strong to moderate** | Small reference sets; the answer comes from documents in the project. |
| Spare-part ID plus manual or troubleshooting | Maintenance teams, small OEMs, field service | Photo of part or data plate | Part number, manual section, past fixes | **Strong (long tail) / weak (OEM scale)** | XOi-style OCR plus retrieval is easy. OEM-scale CAD synthesis and BoM narrowing is nyris or Partium territory. |
| Similar past support tickets with screenshots | Support and QA teams | Screenshot | Similar tickets plus resolutions | **Strong** | Incumbents are text-only. Needs image vectors plus OCR or captions linked to resolution text (Forms/Flow could capture tickets). |
| Manufacturing defect, similar past cases | Quality engineers at SMB manufacturers | Defect photo | Similar past defects plus root cause and corrective action | **Moderate** | Good for case lookup. Inline inspection and detection need custom detectors (Instrumental and others). |
| Construction or site-issue similar cases | GCs, project teams | Site photo | Similar past issues and how they were resolved | **Moderate** | Per-project data is natural. Spatial and BIM mapping is OpenSpace's job. |
| Insurance damage estimation | Insurers, repairers | Damage photos | Repair or total-loss decision, estimate | **Weak** | Proprietary labelled data, cost databases, certainty scoring, insurer integrations (Tractable). |
| Medical / derm similar cases | Clinicians, educators | Clinical image | Similar diagnosed cases | **Weak (clinical) / moderate (education or research only)** | Regulatory status and documented failure rates. |
| Shelf audit / planogram | CPG field teams | Shelf photo | SKU-level compliance KPIs | **Weak** | Custom detectors, capture hardware, field workflows (Trax/FORM). |
| Counterfeit authentication | Resellers, marketplaces | Item photos | Authentic or fake, with guarantee | **Weak** | Financially backed accuracy, specialised capture (Entrupy). |
| Page, diagram or chart retrieval (ColPali-style) | Any doc-heavy team (engineering, legal, research) | Page screenshot or crop | Matching pages plus a grounded answer | **Strong** | Runs on pgvector (ColiVara), and Grey's corpus is document-heavy. Watch storage cost. |
| Video moment search by image | Media, training and marketing teams | Frame or photo | Timestamps in project videos | **Moderate to strong via BYO Twelve Labs** | Packaged API at $29–$99/month, so integrate rather than build. |
| Audio similarity | Music and sound libraries | Audio clip | Similar tracks or sounds | **Weak to moderate** | Niche, and specialist tagging matters (Cyanite). Calls are better served by transcripts. |

- Where Grey's suite helps: Assets is the natural home for image libraries (dedupe, variants, licence checks). Forms can capture photo-bearing tickets, inspections or claims into a project. Flow can route a "query by image" tool result into a workflow such as escalation or a part order. That bundle (capture, store, query by image, act) is something single-purpose visual search APIs do not offer.
- BYO is a double-edged sword. It removes Grey's model cost and matches user privacy preferences, but quality depends on the user's chosen embedding model. Vertical vendors' advantage is precisely their tuned models. Grey should present visual tools as "find candidates and ground an answer in your records," not as authoritative identification.
- Recommended framing for the founder's three headline modes: (a) find similar items is strongest for DAM, catalogs and pages; (b) find something inside the image (detection, OCR of plates and labels) is strongest when the target is text-like (plates, labels, page regions); free-form object detection is better as a BYO provider (Roboflow, Twelve Labs); (c) answer from similar stored items is the most differentiated mode, since few products combine image matches with grounded text answers over the customer's own records outside hyperscaler building blocks.

### Gaps
- No direct customer interviews or survey data on willingness to pay for image-query tools inside a general knowledge platform. The demand evidence is indirect (vendor categories, HN threads, hyperscaler launches).
- No benchmarks comparing general multimodal embeddings with vertical models on fine-grained private catalogs, which would decide where "good enough" ends. The embedding-technology researcher may cover this.
- No data on typical private collection sizes per project for the target customer segments.
