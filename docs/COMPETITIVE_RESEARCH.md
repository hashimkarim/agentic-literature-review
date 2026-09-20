# Literature Research App Feature Survey

Researched: 2026-09-21. Planning input for the [LitAgent roadmap](ROADMAP.md).

## Scope And Evidence

This survey covers 43 products and adjacent research tools across discovery,
document reading, cited chat, extraction, systematic reviews, writing, and
reference management. It is a broad market survey, not a claim to enumerate
every app or every feature behind a paid account. New products, changing plans,
private betas, and inaccessible documentation make literal completeness
impossible to establish.

Features below are documented or advertised on the linked first-party product,
help, release-note, or repository pages. They were not all tested hands-on.
Availability can depend on plan, corpus, language, region, or full-text access.
Marketing claims about accuracy, completeness, speed, compliance, corpus size,
and absence of hallucinations are not adopted as independently verified facts.
Prices and quotas are deliberately omitted because they do not define our
feature requirements. An omitted feature means unverified here, not absent.

Labels describe the documented product surface, not an audit of its internals:

- **Agentic:** explicitly describes a multi-step research/search/task process.
- **AI-assisted:** AI reading, extraction, drafting, or recommendations without
  enough evidence here to label the entire product an autonomous agent.
- **Workflow/discovery:** useful research infrastructure; not necessarily LLM-based.
- **Reference baseline:** adjacent non-agentic behavior LitAgent must interoperate with.
- **Research preview:** code or a demonstration rather than a production-service guarantee.

Aliases are kept together: Afforai redirects to Logically; ResearchFlow's
`rflow.ai` redirects to Ponder. The unrelated `researchflow.ai` ethics-management
service is not the literature-mapping product. Ai2's Paper Finder and ScholarQA
are covered under Asta rather than counted again. Google's help pages currently
use both NotebookLM and Gemini Notebook names. STORM and Co-STORM count as one
research project.

## Research Assistants And Evidence Search

### C01. Consensus

**Agentic.** Natural-language and Boolean paper search; fast and deep research;
question decomposition and citation-network traversal; custom cited reports;
paper/full-text/upload chat; persistent threads; saved papers/searches and
collections; Zotero import and reference-manager export; collection sharing;
API/MCP and assistant integrations. Its study snapshots expose study attributes.
Filters cover date, access, citation count, journal, methodology, population,
sample size, duration, publisher, field, and country. The Consensus Meter groups
retrieved findings by stance, with a supporting snapshot; reports also expose
claim/evidence tables and gap views. Sources: [feature directory](https://help.consensus.app/en/collections/10600168-explore-features),
[filters](https://help.consensus.app/en/articles/9922799-advanced-search-filters),
[changelog](https://help.consensus.app/en/articles/11954907-consensus-product-changelog),
[meter and its limits](https://help.consensus.app/en/articles/10069920-the-consensus-meter).

**LitAgent use:** search planning, source filters, study cards, and scoped evidence
summaries. A stance distribution must disclose its selected studies and never
masquerade as the probability that a claim is true.

### C02. Anara

**Agentic.** Library and academic/web search; conversations over a file, folder,
or library; exact-passage citations; cross-file comparison; writing with citation
suggestions; reference-manager/cloud connectors; web and desktop readers.
September updates document parallel research tasks, steering a running chat,
PDF search/outlines/annotations, preserving original PDF colors, a Word add-in
with dynamic bibliography styles, and an iOS companion with offline downloaded
PDFs, highlights, share-sheet capture, and page scanning. Sources:
[product](https://anara.com/), [chat steering](https://anara.com/updates/steering),
[reader, Word, and iOS update](https://anara.com/updates/ios).

**LitAgent use:** first-class chat with source control, steering/cancellation,
stable citation jumps, annotations, and source-grounded writing. Mobile/cloud
connectors follow the local desktop foundation.

### C03. Elicit

**Agentic.** Semantic search, library reuse, research reports, alerts, and a
research agent producing cited artifacts. Its systematic-review workflow
documents protocol refinement, keyword/semantic searches across research and
trial sources, imported records, suggested screening criteria, per-criterion
quotes and exclusion reasons, dual review, custom extraction templates,
qualitative/quantitative extraction including tables/figures, and reports with
methods and PRISMA diagrams. Sources: [product](https://elicit.com/),
[systematic reviews](https://elicit.com/solutions/systematic-review).

**LitAgent use:** editable extraction sheets, criterion-level review, reusable
protocols, and methods reports generated from actual run records.

### C04. SciSpace

**Agentic.** Research agents and templates, literature search/review, PDF chat,
writing, topic discovery, paraphrasing, citation generation, and presentation/
diagram tasks. Its data-extraction tool offers configurable comparison
parameters, section summaries, section-linked citations, multilingual reading,
and RIS/CSV/BIB/Excel/XML outputs. The product also advertises an AI detector;
that is inventoried separately from research-quality features. Sources:
[product and tool directory](https://scispace.com/),
[data extraction](https://scispace.com/extract-data).

**LitAgent use:** recipes with typed outputs and configurable extraction columns;
readable, cited tables that can leave the app.

### C05. scite

**AI-assisted.** Research assistant, full-text/citation search, contextual
supporting/contrasting/discussing citation signals, collections and monitoring,
reference checks, exact-source links, publisher/library access, Zotero plugin,
browser badges, API, and MCP. Its advertised corpus extends beyond papers to
other research outputs. Source: [product and integrations](https://scite.ai/).

**LitAgent use:** citation-context inspection, claim challenges, and bibliography
audits. A citing sentence's stance is distinct from an independent replication
or a methodological quality assessment.

### C06. Undermind

**Agentic.** Clarifies a research request through follow-ups, iteratively
evaluates papers and follows citations, explains relevance, supports filtering,
report iteration/full-text exploration/custom tables, and monitors topics for
new work. Shared workspaces and connecting external agents are also advertised.
Source: [product](https://www.undermind.ai/).

**LitAgent use:** inspectable search plans, iterative discovery, relevance
explanations, explicit stopping conditions, and scheduled updates.

### C07. Paperguide

**Agentic.** Academic search, research agent, reference manager, DOI and
Zotero/Mendeley imports, extraction, citation-grounded writing, and MCP. Its
review workflow documents editable protocols, pooled deduplicated sources,
dual review/conflict resolution or AI decisions with named verification,
criterion-level evidence, roles per stage, OA PDF retrieval/institutional
access, and PRISMA based on actual counts. Sources:
[product](https://paperguide.ai/), [systematic review](https://paperguide.ai/systematic-review/).

**LitAgent use:** explicit review gates and per-stage provenance; global
deduplication with project-specific review state.

### C08. AnswerThis

**Agentic, vendor-described.** Filtered research search, cited answers, source
verification, PDF annotation, collections/tags/full-text library search,
Zotero/Mendeley connections, writing from existing drafts, citation styles,
team workspaces, and screening/extraction/reporting. It also advertises
meta-analysis, evidence grading, risk-of-bias assessment, presentations,
plagiarism checks, and an AI detector. Source: [product](https://answerthis.io/).

**LitAgent use:** a continuous path from question through accepted evidence to
an editable deliverable. Its claims of universal verification or review
compliance are marketing claims, not our acceptance criteria.

### C09. Logically, Formerly Afforai

**AI-assisted.** Reference management with metadata completion, shared
collections and formatted bibliographies; PDF/URL/EPUB/Markdown/text and DOI
ingestion; multi-document summarization/search/comparison with citations;
separate document, academic-search, and web-search modes; highlights/sticky
notes and collaboration; reference-manager migration and Word integration.
Sources: [product introduction](https://logically.app/blog/afforai-new-reference-manager-announcement/),
[official user guide](https://help.logically.app/en/articles/8478714-everything-you-need-to-know-to-get-started-using-logically-user-guide-with-videos).

**LitAgent use:** visible source modes, portable references, and annotation-linked
notes. Verify current plan availability before promising an integration.

### C10. Iris.ai RSpace

**AI-assisted.** Context-based discovery from a problem statement or seed paper;
topic maps and relevance scores; filtering, analysis, extraction, summaries,
and document chat. Documentation covers dataset organization, an embedded PDF
reader, imported collections, monitoring, OpenAlex, full-text chat, auto-sync
datasets, and versioning. Sources: [Explore](https://iris.ai/help-center/rspace/what-is-the-explore-tool),
[workflow tutorials](https://iris.ai/help-center/rspace/training-resources),
[RSpace 1.3 release](https://iris.ai/blog/announcement-new-features-in-r-space-1-3).

**LitAgent use:** search by research problem, reusable datasets, and versioned
monitoring. The introductory page's future-tense module list alone is not
evidence that every proposed capability has shipped.

### C11. Ai2 Asta

**Agentic.** Query decomposition, paper search, citation following, relevance
evaluation/explanations, full-text/abstract retrieval, passage reranking,
clustering and literature synthesis. Separate data-analysis agents produce
analyses and visualizations; open code and benchmarks are linked. Sources:
[Asta agents](https://allenai.org/asta/agents),
[Asta overview](https://allenai.org/blog/asta).

**LitAgent use:** measurable discovery and synthesis pipelines; inspect relevant
open implementations and licenses before deciding what to reuse.

### C12. Paper Digest

**Agentic and AI-assisted modes.** Literature reviews, deep research, research
copilot, academic reader/writer, claim verification, tagged/shared research
libraries, and search across papers and other research entities. Daily,
conference, topic, and arXiv digests support ongoing discovery. The vendor
distinguishes a non-LLM review mode from other AI offerings. Source:
[product and services](https://www.paperdigest.org/).

**LitAgent use:** conference/topic monitoring, digest recipes, and explicit
provenance for the method used to produce an output.

## Citation Discovery And Mapping

### C13. ResearchRabbit

**Workflow/discovery with recommendations.** Seed-paper discovery, iterative
recommendations, topic/collection organization, interactive maps of papers,
authors and concepts, and exploring how research develops. Sources:
[product](https://www.researchrabbit.ai/), [features](https://www.researchrabbit.ai/features).

**LitAgent use:** expand a selected paper or collection into a discoverable
neighborhood while preserving the path that led to each candidate.

### C14. Litmaps

**Workflow/discovery.** Citation/reference-based recommendations, search
filters, configurable visual maps, article annotations, sharing, Zotero sync,
and email monitoring for new related work. Source:
[features](https://www.litmaps.com/features).

**LitAgent use:** discovery from multiple seeds, saved layouts, temporal views,
and a monitored project library.

### C15. Connected Papers

**Workflow/discovery.** Seed-paper similarity graphs, iterative graph
exploration, bibliographic discovery, Prior Works for foundational literature,
and Derivative Works for follow-on research/reviews. The homepage requires
JavaScript; its official delivered app content documents these views. Sources:
[app](https://www.connectedpapers.com/),
[official app content inspected](https://vue.prod.connectedpapers.com/assets/index-a7gwvqH9.js).

**LitAgent use:** separate similarity edges from actual citation edges; offer
foundational/follow-on discovery views. Recheck the app if the hashed asset URL
changes.

### C16. Inciteful

**Workflow/discovery.** Literature Connector searches citation paths between
two papers and lets users explore/filter the papers connecting them. The former
`inciteful.xyz` address now redirects to its academic app. Source:
[Literature Connector documentation](https://incitefulmed.com/academic/help/literature-connector-explained).

**LitAgent use:** explain how two research areas connect, retaining each real
citation edge instead of inventing relationships from visual proximity.

### C17. Semantic Scholar And Semantic Reader

**AI-assisted discovery/reading.** Scholarly search, paper libraries, research
feeds/alerts, citation graph data/API, and paper summaries. Semantic Reader
provides inline citation cards, section navigation, contextual definitions,
skimming highlights, library-aware citation indicators, and annotation via
Hypothesis. Feature and paper coverage vary. Sources:
[product](https://webflow.semanticscholar.org/product),
[Semantic Reader](https://webflow.semanticscholar.org/product/semantic-reader),
[open reader resources](https://openreader.semanticscholar.org/).

**LitAgent use:** definitions, citation previews and user-controlled skimming;
metadata/graph adapters and reusable reader research, without replacing the
chosen PDF viewer again.

### C18. The Lens

**Workflow/discovery, not an autonomous review agent.** Scholarly search and
analysis, filtering, collections, sharing/export, forward/backward citation
exploration, and links between scholarly work and patents. Sources:
[scholarly analysis](https://about.lens.org/scholarly-search-analysis/),
[citation exploration](https://support.lens.org/knowledge-base/exploring-citations/).

**LitAgent use:** transparent citation traversal and optional patent connections
for engineering research; keep specialist datasets as adapters.

## Reading And Document Understanding

### C19. Scholarcy

**AI-assisted.** Structured summary flashcards, key information, research
quality indicators, study comparisons, a saved summary library, prompting an
article with Dig Deeper, bibliographies, import/export, and literature matrices.
Sources: [features](https://www.scholarcy.com/scholarcy-features),
[feature recap](https://www.scholarcy.com/pricing).

**LitAgent use:** reviewable study cards and progressive disclosure of findings,
methods and limitations; optional study aids after the research loop works.

### C20. SciSummary

**AI-assisted.** Section-structured and bulk summaries, multi-paper synthesis
and comparison, folders/tags, figure chat/interpretation, article search,
quick import, semantic library search, and API documentation. Source:
[product](https://scisummary.com/).

**LitAgent use:** batch reading outputs, figure-specific questions, and clear
separation of numbers extracted from text versus inferred from an image.

### C21. OpenRead

**AI-assisted.** Paper/web search, paper summaries, PDF Q&A, paper comparison,
contradiction exploration, related-paper graphs, notes, model choice, and
trending research. Source: [product](https://www.openread.academy/).

**LitAgent use:** tightly connected reading, notes, comparison and graph views
with the selected paper retained across navigation.

### C22. ChatPDF

**AI-assisted.** Single/multi-file conversations, folders and chat history,
source-linked answers beside the PDF, summaries, multilingual interaction and
translation, varied document formats, share links, and advertised writing,
flashcard, slide, video and research tools. Source: [product](https://www.chatpdf.com/).

**LitAgent use:** low-friction document chat, selected-source controls, and
reliable bidirectional movement between an answer and its source.

### C23. AskYourPDF

**AI-assisted.** Multi-document knowledge bases; a writing copilot with a source
library, suggestions/alternatives, and selected AI commands. Sources:
[knowledge-base guide](https://askyourpdf.com/blog/askyourpdf-knowledge-base-service),
[copilot guide](https://askyourpdf.com/blog/a-complete-guide-to-askyourpdf-copilot).

**LitAgent use:** named source sets reusable across chats and writing. The
homepage was inaccessible to the research tool, so these official guides are
the evidence; current capabilities beyond them were not verified.

## Systematic Review Workspaces

### C24. Rayyan

**AI-assisted review workflow.** Import/deduplication, screening and full-text
review, extraction, risk-of-bias assessment, PRISMA/report exports, decision
audit trails, relevance prioritization, and ResearchPilot analysis/review/
auto-extraction. It also documents keyboard-driven screening, random sampling,
workload distribution, team workflows and mobile/offline work. Source:
[product and feature directory](https://www.rayyan.ai/).

**LitAgent use:** efficient screening queues, explicit reasons, reversible
decisions, calibration samples, and audit exports.

### C25. Covidence

**Review workflow with bounded automation.** Reference import/deduplication,
title/abstract and full-text screening, reviewer conflicts, PDF/form side-by-side
extraction, risk-of-bias tables, and data/reference export. Its AI release
discussion distinguishes a bounded RCT classifier from an experimental general
LLM auto-exclusion system it chose not to release. Sources:
[workflow overview](https://support.covidence.org/help/health-research-center),
[full-text screening](https://www.covidence.org/blog/full-text-screening/),
[AI release decisions](https://www.covidence.org/blog/ai-screening-automation-systematic-reviews/).

**LitAgent use:** avoid treating a recommendation score as an exclusion decision;
retain reviewer identity, disagreements, reasons and reversibility.

### C26. DistillerSR

**AI-assisted review workflow.** Configurable standardized workflows, audit
trail/versioning, shared reusable evidence, suggested answers from previous
extraction, AI-assisted forms, controlled answer lists, custom reports, API/data
integrations, scheduled reference imports, full-text procurement and enterprise
library/BI connections. Source: [platform capabilities](https://www.distillersr.com/).

**LitAgent use:** extraction schema versions, evidence reuse across projects,
and reproducible workflow outputs. Enterprise content licensing remains an
optional integration, not an assumed source of full text.

### C27. Nested Knowledge

**AI-assisted review workflow.** AutoLit search/import/bibliomining, updateable
searches, PICO highlighting, inclusion prediction, single/dual/two-pass screening,
hierarchical tagging, structured extraction, critical appraisal, and Synthesis
visualizations. Documentation also covers meta-analytical extraction, qualitative
maps, quantitative outputs, manuscript/dashboard outputs, PRISMA and model cards.
Sources: [product](https://about.nested-knowledge.com/),
[workflow documentation](https://about.nested-knowledge.com/docs/autolit/),
[definitions](https://about.nested-knowledge.com/docs/key-definitions-in-nested-knowledge/).

**LitAgent use:** question/criterion hierarchies and structured extraction that
feed both a concept map and a review report.

### C28. ASReview

**AI-assisted, open-source screening.** Reviewer-in-the-loop relevance
prioritization, local/server deployment, model choice, simulation/benchmarking,
and collaborative screening through Crowdscreen. Source:
[product and documentation links](https://asreview.nl/).

**LitAgent use:** evaluate active-learning prioritization and stopping behavior
on labeled examples before automating screening decisions.

### C29. EPPI-Reviewer

**AI-assisted review workflow.** A browser review workspace covering screening,
coding and synthesis across review types. Official resources document automation,
LLM coding, OpenAlex, Zotero integration, RIS export and EPPI-Mapper. Sources:
[product/documentation directory](https://eppi.ioe.ac.uk/cms/er4/),
[automation](https://eppi.ioe.ac.uk/cms/er4/Help/Automation-tools-in-EPPI-Reviewer).

**LitAgent use:** reusable coding frameworks, quantitative/qualitative evidence
maps, and interoperable review datasets.

### C30. Sysrev

**AI-assisted review workflow.** Configurable labels and generative auto-labeling
from label descriptions; review filters and exports; project keyword/regex
highlighting with adjustable colors; Zotero-translator-based import support.
Sources: [help centre](https://help.sysrev.com/en),
[January 2026 release](https://help.sysrev.com/en/article/january-2026),
[February 2026 release](https://help.sysrev.com/en/article/february-2026).

**LitAgent use:** user-defined extraction labels, review subsets, and adjustable
criterion highlighting. Homepage access failed; official help pages were used.

## Writing And Citation Assistance

### C31. Jenni

**AI-assisted.** Source-grounded autocomplete, library chat, scholarly search,
PDF/source import including Zotero/Mendeley, selected-source writing, inline
citations linked to PDF passages, bibliography styles, and DOCX/LaTeX/HTML
export. Source: [product](https://jenni.ai/).

**LitAgent use:** optional writing suggestions with visible supporting evidence
and a previewable diff; export a usable manuscript with stable citekeys.

### C32. Paperpal

**AI-assisted.** Academic grammar/style edits, paraphrasing, PDF questions,
research-and-cite, source libraries, citation formatting, plagiarism/similarity
checks, journal/submission checks, and Word/Google Docs/Chrome/Overleaf surfaces.
Source: [product and integrations](https://paperpal.com/).

**LitAgent use:** citation-needed checks and source-preserving edits; external
editor integrations and licensed similarity services are optional later work.

### C33. Sourcely

**AI-assisted.** Finds sources from a pasted paragraph/draft, identifies places
needing citations, offers search filters, deep academic search, source chat,
summaries, a citation library, available PDF links and bibliography exports.
Source: [product](https://www.sourcely.net/).

**LitAgent use:** connect a draft claim to candidate evidence, then verify whether
the paper supports it before attaching a citation.

### C34. Yomu

**AI-assisted.** Document/section assistance, autocomplete, expand/shorten/
paraphrase/summarize actions, citation discovery/styles, reusable sources,
PDF/image/web chat, feedback, grammar/similarity checks, and figure/table
captioning and references. Source: [product](https://www.yomu.ai/).

**LitAgent use:** bounded editing commands, figure/table references and reviewable
writing suggestions. Do not let an edit silently change a claim's evidence.

## Adjacent Research Workspaces

### C35. NotebookLM / Gemini Notebook

**AI-assisted source workspace.** Curated notebooks; PDFs, websites, video,
audio and Google document sources; source-grounded chat with inline citations;
notes, source discovery, briefings/study guides, mind maps, audio and video
overviews, mobile use and sharing surfaces. Google's current documentation uses
both product names. Sources: [NotebookLM help directory](https://support.google.com/notebooklm/answer/16246230?hl=en),
[current product overview](https://support.google.com/gemininotebook/answer/16164461?hl=en).

**LitAgent use:** explicit source selection, reusable research artifacts and
source-linked concept maps. Learning/audio/video outputs are optional extras.

### C36. Perplexity

**Agentic, general research rather than specialist systematic review.**
Multi-step search, cited answers/reports, model selection, persistent files and
instructions, shared workspaces and connectors. Older documentation calls them
Spaces; the August 2026 changelog describes Projects with persistent files,
memory and shared task context. Sources:
[Pro Search](https://www.perplexity.ai/help-center/en/articles/10352903-what-is-pro-search),
[Spaces guide](https://hub-prod.perplexity.ai/hub/faq/what-are-spaces),
[Projects update](https://www.perplexity.ai/changelog/shared-workspaces-personal-computer-for-windows-and-model-council).

**LitAgent use:** project instructions, selectable local/academic/web source
modes, long-running task continuity and transparent source boundaries.

### C37. Stanford STORM / Co-STORM

**Agentic research preview.** Perspective-guided research questions, simulated
expert conversations, search-grounded outline/report generation, citations,
human steering of collaborative discussions, configurable retrieval/model
providers and an option for user-document retrieval. The authors explicitly
describe generated articles as requiring editing. Source:
[official repository](https://github.com/stanford-oval/storm).

**LitAgent use:** editable research plans, alternative viewpoints, and an outline
stage before drafting. Hosted-preview availability was not validated here.

### C38. Zotero

**Reference baseline, not an agentic literature-review app.** Capture/import,
metadata, collections/tags/search, attachments, notes, bibliographies and word
processor citations, syncing, and groups provide the interchange baseline.
Sources: [documentation](https://www.zotero.org/support/),
[quick start](https://www.zotero.org/support/quick_start_guide).

**LitAgent use:** preserve item identity, collection membership, citekeys and
annotations where formats permit; review conflicts before optional write-back.

### C39. ReadCube

**AI-assisted research/review workspace.** Libraries, custom fields/Smart Lists,
PDF markup, search, cited library chat and comparison, literature monitoring,
reference imports/deduplication, configurable review/extraction forms, screening,
PRISMA, reporting, audit logs and team administration. Sources:
[product](https://about.readcube.com/),
[literature review](https://about.readcube.com/literature-review/).

**LitAgent use:** saved filters, metadata-plus-PDF library management, configurable
extraction forms and monitoring that feed the same canonical records.

### C40. Ponder, Formerly ResearchFlow

**AI-assisted visual research workspace.** The official `rflow.ai` redirect
now leads to Ponder. The product advertises a knowledge workspace with
PDF/video/text/web imports, connected thinking, research notes, knowledge graphs,
and report/mind-map/Markdown exports. Earlier ResearchFlow materials describe
cross-document visual comparison. Sources: [current product](https://ponder.ing/),
[earlier mapping guide](https://rflow.ai/blog/visual-knowledge-mapping).

**LitAgent use:** a concept map grounded in papers, claims and notes that can
produce an outline; confirm older guide features still exist before copying UX.

### C41. ScholarAI

**AI-assisted.** Scholarly/patent search, extracting and summarizing papers,
citation-aware drafting, organizing sources, multilingual support, and study/
teaching artifacts. The vendor says it complements existing citation managers.
Source: [academic product page](https://scholarai.io/academics).

**LitAgent use:** adapter-based external discovery and citation-aware outputs;
teaching deliverables remain secondary to research workflows.

### C42. EvidenceHunt

**Agentic, domain-specific.** Medical literature, guidelines and internal
documents in a shared evidence workspace; document processing, chat, extraction,
review workflows, monitoring, tagging, reusable analysis prompts, claim review,
guideline-gap analysis and API access. Sources:
[product](https://evidencehunt.com/),
[medical-affairs workflows](https://evidencehunt.com/solutions/medical-affairs).

**LitAgent use:** domain-specific recipe packs and detecting how new research
changes an existing claim. Clinical decision support is outside our core scope.

### C43. Edison Literature / PaperQA3

**Agentic.** A scientific literature agent with multimodal retrieval/reasoning
over full-text papers, figures and tables; it also supplies literature search
within Kosmos. The vendor publishes benchmark and parser discussions. Sources:
[PaperQA3 announcement](https://advances.edisonscientific.com/research/edison-literature-agent/),
[platform agent overview](https://edisonscientific.com/news/performance-of-our-platform-agents).

**LitAgent use:** preserve figure/table evidence and evaluate multimodal Q&A.
Kosmos-style autonomous experiments and molecule design are separate product
areas, not proposed LitAgent core functionality.

## What This Changes For LitAgent

These are product decisions inferred from the survey, not vendor claims about
LitAgent or commitments to duplicate every competitor.

| Opportunity | Useful references | Direction |
| --- | --- | --- |
| Reliable cited conversation | Anara, Consensus, scite, Asta | First priority: visible sources, complete context, per-claim support and dependable citation jumps |
| Reviewable research memory | Elicit, DistillerSR, Nested Knowledge | Extend accepted records into editable extraction sheets and a claim/evidence ledger |
| Discovery with an audit trail | Undermind, Asta, Consensus | Plan, run, inspect and repeat academic searches; record why each candidate was found |
| Reading without losing context | Anara, Semantic Reader, ChatPDF | Integrated annotation, source preview, definitions, figure/table questions and notes |
| Research rather than a folder of summaries | Jenni, Paperpal, Sourcely | Notes/backlinks, citation-needed checks and source-grounded drafting |
| Reproducible screening | Rayyan, Covidence, Paperguide, ASReview | Criteria, stages, reasons, calibration, undo and counts before unattended decisions |
| Useful maps | ResearchRabbit, Litmaps, Connected Papers, Inciteful, Ponder | Typed citation/similarity/concept edges, graph filters, saved layouts and bridge discovery |
| Living reviews | Elicit, Undermind, Litmaps, EvidenceHunt | Scheduled discovery, deduplicated change sets and stale-claim notifications |
| Portability | Zotero, SciSpace, Jenni, ReadCube | Round-trip reference formats and exportable notes, evidence, tables and reviews |
| Extensible agents | Anara, Asta, STORM, scite | Typed tools, steering, resumable steps, budgets, evaluation and optional MCP connectors |

## Coverage Limits And Follow-up

- Petal's primary site could not be retrieved and no useful official search
  result was found. No current features are attributed to it here.
- Other broad candidates for a later pass include Scinapse, Keenious, Sciwheel,
  Paperpile, Mendeley and newer review-agent startups. This is an explicit
  research queue, not a claim that those tools lack important features.
- General chat/coding providers are already a separate LitAgent adapter concern;
  their entire consumer feature sets are not inventoried here.
- Full-text access and proprietary citation classifications need separate
  integration/API/usage-term evaluation. A feature visible in another product
  does not imply that its corpus or API is available to LitAgent.
- No paid accounts, subscriptions, private-paper uploads or hands-on product
  comparisons were performed for this survey.
- Revisit this inventory quarterly or before starting an integration. Record
  renamed products, source-page dates, availability changes and new evidence;
  retain uncertainty rather than converting an old advertisement into a fact.
