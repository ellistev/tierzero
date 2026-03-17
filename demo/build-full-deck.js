// Build full TierZero system demo deck
import { chromium } from 'playwright';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SLIDES_DIR = join(__dirname, 'screenshots');

function img(name) {
  const buf = readFileSync(join(SLIDES_DIR, name));
  return `data:image/png;base64,${buf.toString('base64')}`;
}

const imgs = {
  v1Dash: img('02-v1-dashboard.png'),
  v1Detail: img('04-v1-ticket-detail.png'),
  v2Dash: img('06-v2-dashboard.png'),
  v2Detail: img('07-v2-ticket-detail.png'),
};

const S = (n, content) => `<div class="s">${content}<div class="f">TierZero</div><div class="pn">${n}/14</div></div>`;

const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
@page{size:11in 8.5in;margin:0;}
*{margin:0;padding:0;box-sizing:border-box;}
body{margin:0;background:#0d1117;font-family:'Segoe UI',-apple-system,sans-serif;}
.s{width:11in;height:8.5in;padding:50px 60px;display:flex;flex-direction:column;position:relative;background:#0d1117;color:#c9d1d9;page-break-after:always;page-break-inside:avoid;overflow:hidden;}
.s:last-child{page-break-after:avoid;}
h1{font-size:36px;color:#58a6ff;margin-bottom:16px;font-weight:700;}
h2{font-size:28px;color:#79c0ff;margin-bottom:12px;}
h3{font-size:20px;color:#a5d6ff;margin-bottom:8px;}
p{font-size:16px;line-height:1.55;color:#8b949e;margin:4px 0;}
ul{font-size:15px;line-height:1.6;color:#8b949e;padding-left:20px;}
li{margin:2px 0;}
strong{color:#c9d1d9;}
code{background:#161b22;padding:2px 6px;border-radius:3px;font-size:13px;color:#ff7b72;font-family:'Cascadia Code',Consolas,monospace;}
.g{color:#3fb950;font-weight:600;}
.r{color:#f85149;font-weight:600;}
.y{color:#d29922;font-weight:600;}
.b{color:#58a6ff;font-weight:600;}
.f{position:absolute;bottom:16px;right:40px;font-size:11px;color:#30363d;}
.pn{position:absolute;bottom:16px;left:40px;font-size:11px;color:#30363d;}
.box{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px 18px;margin:8px 0;}
.box-g{border-left:3px solid #3fb950;}
.box-r{border-left:3px solid #f85149;}
.box-b{border-left:3px solid #58a6ff;}
.box-y{border-left:3px solid #d29922;}
.cols{display:flex;gap:20px;margin:10px 0;}
.col{flex:1;}
img.ss{border:1px solid #30363d;border-radius:6px;}
.center{text-align:center;align-items:center;justify-content:center;}
.pipe{display:flex;align-items:center;gap:6px;margin:14px 0;flex-wrap:wrap;}
.pipe .st{background:#1f2937;border:1px solid #30363d;padding:10px 14px;border-radius:8px;text-align:center;font-size:13px;color:#c9d1d9;}
.pipe .st small{display:block;font-size:11px;color:#6e7681;margin-top:3px;}
.pipe .ar{font-size:18px;color:#58a6ff;}
.num{font-size:56px;font-weight:800;letter-spacing:-2px;}
</style></head><body>

${S(1, `
<div class="center" style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;">
<div style="font-size:80px;font-weight:800;color:#58a6ff;letter-spacing:-3px;">TierZero</div>
<div style="font-size:22px;color:#79c0ff;margin:6px 0 24px;">Autonomous AI Ticket Resolution</div>
<div style="width:100px;height:3px;background:linear-gradient(90deg,#58a6ff,#3fb950);border-radius:2px;margin:0 auto 24px;"></div>
<p style="font-size:17px;">Pick up a ticket. Understand the problem. Search knowledge. Do the work. Close the ticket.</p>
<p style="font-size:17px;">No human intervention. No brittle scripts. Fully autonomous.</p>
<p style="font-size:13px;color:#484f58;margin-top:36px;">Steve Elliott -- March 2026</p>
</div>
`)}

${S(2, `
<h1>What TierZero Does</h1>
<p style="font-size:18px;margin-bottom:16px;">An AI agent that <strong>autonomously resolves IT support tickets</strong> -- from reading the ticket to closing it -- without human involvement.</p>
<div class="cols">
<div class="col">
<div class="box box-b">
<h3>🎫 Picks Up Tickets</h3>
<p>Polls ServiceNow, Jira, or GitLab for new open tickets. Reads the full description and comment thread.</p>
</div>
<div class="box box-b">
<h3>🧠 Understands the Problem</h3>
<p>LLM analyzes the ticket against ingested knowledge base. Determines what kind of work is needed.</p>
</div>
<div class="box box-b">
<h3>🔍 Searches for Solutions</h3>
<p>RAG retrieval across runbooks, wiki pages, past tickets, and documentation. Finds the procedure.</p>
</div>
</div>
<div class="col">
<div class="box box-g">
<h3>⚡ Executes the Fix</h3>
<p>Browser automation, code changes, or guided responses. Adapts to UI changes. Self-heals when things break.</p>
</div>
<div class="box box-g">
<h3>✅ Closes the Ticket</h3>
<p>Posts resolution, audit trail, KB sources cited. Marks ticket resolved. Moves to the next one.</p>
</div>
<div class="box box-y">
<h3>🚨 Knows When to Escalate</h3>
<p>Security incidents, low confidence, policy decisions -- TierZero escalates with full context instead of guessing.</p>
</div>
</div>
</div>
`)}

${S(3, `
<h1>The Architecture</h1>
<p>Five-node LangGraph pipeline. Every ticket flows through the same graph:</p>
<div class="pipe" style="margin-top:18px;">
<div class="st" style="border-color:#58a6ff;border-width:2px;">📥 Ingest<small>Load ticket + comments</small></div>
<div class="ar">→</div>
<div class="st" style="border-color:#a371f7;border-width:2px;">🔍 Retrieve<small>RAG search KB</small></div>
<div class="ar">→</div>
<div class="st" style="border-color:#d29922;border-width:2px;">🧠 Decide<small>LLM structured output</small></div>
<div class="ar">→</div>
<div class="st" style="border-color:#3fb950;border-width:2px;">⚡ Act<small>Execute decision</small></div>
<div class="ar">→</div>
<div class="st" style="border-color:#8b949e;border-width:2px;">📝 Record<small>Audit trail</small></div>
</div>
<div class="cols" style="margin-top:14px;">
<div class="col">
<h3>Decide Node Output (5 decisions):</h3>
<ul>
<li><span class="g">automate</span> -- Full resolution exists in KB. Execute and close.</li>
<li><span class="b">draft_response</span> -- Guidance found. Post helpful reply.</li>
<li><span class="y">escalate</span> -- Out of scope or low confidence. Hand to human with context.</li>
<li><span class="b">needs_info</span> -- Ticket too vague. Ask one specific question.</li>
<li><span class="g">implement</span> -- Bug/feature. Write code, create branch, run tests.</li>
</ul>
</div>
<div class="col">
<h3>Safety Rules (built into the LLM prompt):</h3>
<ul>
<li>ALWAYS escalate security incidents</li>
<li>ALWAYS escalate production system changes</li>
<li>Never repeat a fix the user already tried</li>
<li>Confidence below 0.4 = auto-escalate</li>
<li>Cite KB sources in every response</li>
</ul>
</div>
</div>
`)}

${S(4, `
<h1>Knowledge Ingestion</h1>
<p>TierZero learns from your existing documentation. No training required -- just point it at your knowledge sources.</p>
<div class="cols" style="margin-top:14px;">
<div class="col">
<div class="box box-b">
<h3>📚 Sources Supported</h3>
<ul>
<li><strong>Azure DevOps Wiki</strong> -- full wiki + work items</li>
<li><strong>Confluence</strong> -- spaces, pages, attachments</li>
<li><strong>URLs</strong> -- scrape any documentation site</li>
<li><strong>Past Tickets</strong> -- mine ServiceNow/Jira/GitLab for resolved tickets with solutions</li>
<li><strong>Local docs</strong> -- any folder of markdown/text/PDF files</li>
</ul>
</div>
</div>
<div class="col">
<div class="box box-g">
<h3>🔧 How It Works</h3>
<ul>
<li><code>tierzero index ./knowledge</code> -- chunk and embed into ChromaDB</li>
<li><code>tierzero import-wiki --source azuredevops</code> -- pull from AzDO</li>
<li><code>tierzero mine-tickets --connector servicenow</code> -- learn from past tickets</li>
<li><code>tierzero import-url https://docs.example.com</code> -- scrape web docs</li>
<li>Incremental updates -- only re-indexes changed files</li>
</ul>
</div>
</div>
</div>
<div class="box box-y" style="margin-top:10px;">
<p><span class="y">Key:</span> The RAG pipeline uses MMR (Maximal Marginal Relevance) for diverse results -- so it doesn't just return 5 copies of the same runbook.</p>
</div>
`)}

${S(5, `
<h1>Autonomous Execution: The Watch Loop</h1>
<p>TierZero runs continuously, polling for new tickets and resolving them without human intervention.</p>
<div class="box" style="margin-top:14px;background:#0d1117;border:1px solid #30363d;font-family:'Cascadia Code',Consolas,monospace;font-size:13px;line-height:1.8;color:#c9d1d9;">
<span style="color:#8b949e;">$</span> <span style="color:#79c0ff;">tierzero watch</span> --instance-url https://company.service-now.com --interval 60<br><br>
<span style="color:#6e7681;">[14:32:01]</span> Watching for open tickets  interval: 60s<br>
<span style="color:#6e7681;">[14:32:01]</span> → <span style="color:#58a6ff;">INC0401474</span>  VPN not connecting from remote office<br>
<span style="color:#6e7681;">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span> <span style="color:#3fb950;">✓</span> automate (0.91)  action: resolved<br>
<span style="color:#6e7681;">[14:32:08]</span> → <span style="color:#58a6ff;">INC0401489</span>  Suspicious login from unknown IP<br>
<span style="color:#6e7681;">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span> <span style="color:#d29922;">!</span> escalate (0.95)  action: escalated to Security<br>
<span style="color:#6e7681;">[14:33:01]</span> → <span style="color:#58a6ff;">INC0401502</span>  Can't print to 3rd floor printer<br>
<span style="color:#6e7681;">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span> <span style="color:#3fb950;">✓</span> automate (0.87)  action: resolved<br>
<span style="color:#6e7681;">[14:33:15]</span> → <span style="color:#58a6ff;">INC0401510</span>  Need access to shared drive<br>
<span style="color:#6e7681;">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span> <span style="color:#58a6ff;">?</span> needs_info (0.72)  action: requested_info<br>
<span style="color:#6e7681;">[14:34:01]</span> <span style="color:#6e7681;">No new open tickets</span><br>
</div>
<p style="margin-top:10px;"><span class="g">Your queue is zero by morning.</span> That's the pitch. Not "here's a tool" -- "here's an outcome."</p>
`)}

${S(6, `
<h1>Code Implementation</h1>
<p>When the ticket is a bug or feature request, TierZero doesn't just triage -- it <strong>writes the code</strong>.</p>
<div class="cols" style="margin-top:14px;">
<div class="col">
<div class="box box-g">
<h3>What the agent does:</h3>
<ul>
<li>Creates a feature branch (<code>tierzero/INC-1234</code>)</li>
<li>Analyzes the codebase for relevant files</li>
<li>Writes the fix using Claude/GPT/Gemini</li>
<li>Runs the test suite</li>
<li>Commits with descriptive message</li>
<li>Posts the diff summary to the ticket</li>
<li>Supports OpenAI, Anthropic, Google models</li>
</ul>
</div>
</div>
<div class="col">
<div class="box" style="font-family:'Cascadia Code',Consolas,monospace;font-size:12px;line-height:1.6;color:#c9d1d9;background:#0d1117;border:1px solid #30363d;">
<span style="color:#6e7681;">Agent output:</span><br>
<span style="color:#3fb950;">✓</span> Implemented on branch <span style="color:#58a6ff;">tierzero/INC-1234</span><br>
&nbsp;&nbsp;Commit: <span style="color:#8b949e;">a2f8c91</span><br>
&nbsp;&nbsp;Files: 3 changed<br>
&nbsp;&nbsp;Tests: <span style="color:#3fb950;">passing</span><br><br>
<span style="color:#6e7681;">Ticket comment:</span><br>
Code changes on branch tierzero/INC-1234.<br>
Fixed null reference in CoveragesMapper<br>
when cancel quotes return null coverages.<br>
3 file(s) changed. All tests passing.
</div>
</div>
</div>
`)}

${S(7, `
<h1>Self-Healing Browser Automation</h1>
<p>When the work requires browser interaction (ServiceNow forms, admin panels, portals), TierZero uses <strong>intent-based automation</strong> that adapts to UI changes.</p>
<div class="cols" style="margin-top:12px;">
<div class="col">
<h3>The Problem with Scripts:</h3>
<div class="box box-r">
<p><code>page.click('#btn-resolve')</code></p>
<p style="color:#f85149;">UI redesign → selector breaks → script dies</p>
<p style="color:#f85149;">Button renamed → text match fails → script dies</p>
<p style="color:#f85149;">New modal appears → script dies</p>
</div>
<h3 style="margin-top:12px;">TierZero's Approach:</h3>
<div class="box box-g">
<p><code>goal: "Click the Resolve button"</code></p>
<p style="color:#3fb950;">UI redesign → finds element by accessibility role</p>
<p style="color:#3fb950;">Button renamed → LLM understands context</p>
<p style="color:#3fb950;">New modal → auto-dismissed by recovery system</p>
</div>
</div>
<div class="col">
<h3>5-Strategy Fallback Chain:</h3>
<ul style="font-size:14px;">
<li><strong>1. Cached</strong> (~50ms) -- last-known selector</li>
<li><strong>2. Aria</strong> (~200ms) -- accessibility role/label</li>
<li><strong>3. LLM/A11y Tree</strong> (~500ms) -- GPT-4o-mini</li>
<li><strong>4. LLM/Vision</strong> (~1s) -- screenshot analysis</li>
<li><strong>5. Coordinates</strong> (~1.5s) -- pixel-level click</li>
</ul>
<h3 style="margin-top:12px;">Recovery Strategies:</h3>
<ul style="font-size:14px;">
<li>Auto-dismiss modals/dialogs</li>
<li>LLM page state analysis</li>
<li>Navigate away from error pages</li>
<li>Escalate with explanation if all else fails</li>
</ul>
</div>
</div>
`)}

${S(8, `
<h2>Proof: Record on v1, Replay on v2</h2>
<p>We recorded a "resolve ticket" workflow on Layout v1. Then replayed it on a <span class="y">completely redesigned</span> Layout v2. <span class="g">Zero changes to the workflow.</span></p>
<div style="display:flex;gap:14px;margin-top:12px;">
<div style="flex:1;">
<div style="text-align:center;font-size:12px;color:#6e7681;margin-bottom:4px;">Layout v1 -- Recorded Here</div>
<img class="ss" src="${imgs.v1Detail}" style="width:100%;">
<p style="font-size:12px;margin-top:4px;">"Resolve" button, right-aligned, text labels</p>
</div>
<div style="flex:1;">
<div style="text-align:center;font-size:12px;color:#3fb950;margin-bottom:4px;">Layout v2 -- Replayed Successfully ✓</div>
<img class="ss" src="${imgs.v2Detail}" style="width:100%;">
<p style="font-size:12px;margin-top:4px;">"✓ Done" icon button, top-left, different CSS</p>
</div>
</div>
<div class="box box-g" style="margin-top:8px;">
<p><strong>Changes handled:</strong> Button text "Resolve" → "✓ Done" | Position bottom-right → top-left | CSS classes changed | New confirmation modal auto-dismissed | Table columns reordered</p>
</div>
`)}

${S(9, `
<h1>Workflow Recording: Learn by Watching</h1>
<p>TierZero learns new workflows by <strong>watching a human do it once</strong>. No coding required.</p>
<div class="pipe" style="margin-top:16px;">
<div class="st">🎥 Record<small>Human demonstrates task</small></div>
<div class="ar">→</div>
<div class="st">🏷️ Annotate<small>LLM adds meaning</small></div>
<div class="ar">→</div>
<div class="st">⚙️ Generate<small>Intent-based workflow</small></div>
<div class="ar">→</div>
<div class="st">📦 Package<small>Hot-loadable skill</small></div>
<div class="ar">→</div>
<div class="st">▶️ Replay<small>Adaptive execution</small></div>
</div>
<div class="cols" style="margin-top:14px;">
<div class="col">
<div class="box box-b">
<h3>What gets recorded:</h3>
<ul>
<li>Every click, keystroke, navigation</li>
<li>Page state before and after each action</li>
<li>Element accessibility info (role, label)</li>
<li>State changes between steps</li>
</ul>
</div>
</div>
<div class="col">
<div class="box box-g">
<h3>What gets generated:</h3>
<ul>
<li>Intent-based steps (goals, not selectors)</li>
<li>Variables detected (ticket IDs, text input)</li>
<li>Hot-loadable skill with manifest</li>
<li>Parameterized for reuse across tickets</li>
</ul>
</div>
</div>
</div>
<div class="box box-y" style="margin-top:8px;">
<p><span class="y">Key insight:</span> The recording captures WHAT the human did. The generator converts to WHY (intent goals). Replay figures out HOW adaptively. If the UI changes, the skill still works.</p>
</div>
`)}

${S(10, `
<h1>Connectors: Plug Into Any System</h1>
<p>TierZero connects to where your tickets live. Same agent brain, different ticket sources.</p>
<div class="cols" style="margin-top:16px;">
<div class="col">
<div class="box box-b" style="text-align:center;padding:20px;">
<div style="font-size:32px;margin-bottom:8px;">🔧</div>
<h3>ServiceNow</h3>
<p>Incidents, changes, requests. Full REST API integration. Read/write tickets, comments, assignments.</p>
</div>
</div>
<div class="col">
<div class="box box-b" style="text-align:center;padding:20px;">
<div style="font-size:32px;margin-bottom:8px;">📋</div>
<h3>Jira</h3>
<p>Issues, bugs, stories. Atlassian REST API. Project-scoped. Supports custom fields.</p>
</div>
</div>
<div class="col">
<div class="box box-b" style="text-align:center;padding:20px;">
<div style="font-size:32px;margin-bottom:8px;">🦊</div>
<h3>GitLab</h3>
<p>Issues and merge requests. GitLab API v4. Labels, milestones, related MRs.</p>
</div>
</div>
</div>
<div class="box" style="margin-top:16px;">
<p><strong>Adding a new connector:</strong> Implement the <code>TicketConnector</code> interface (7 methods: getTicket, listTickets, getComments, addComment, updateTicket, search, getEscalationTeams). TierZero handles the rest.</p>
</div>
`)}

${S(11, `
<h1>Event Sourcing + CQRS Core</h1>
<p>TierZero is built on Event Sourcing. Every action the agent takes is recorded as an immutable event. Full audit trail. Time travel debugging.</p>
<div class="cols" style="margin-top:14px;">
<div class="col">
<div class="box box-b">
<h3>Domain Aggregates:</h3>
<ul>
<li><strong>Ticket</strong> -- lifecycle events (created, commented, resolved, escalated)</li>
<li><strong>IntentExecution</strong> -- browser interaction events (attempted, resolved, succeeded, failed, recovered)</li>
<li><strong>WorkflowExecution</strong> -- end-to-end workflow events (started, step completed, finished)</li>
</ul>
</div>
</div>
<div class="col">
<div class="box box-g">
<h3>Why This Matters:</h3>
<ul>
<li><strong>Full audit trail</strong> -- every decision, every action, every recovery attempt</li>
<li><strong>Selector cache</strong> -- successful selectors cached as read models, speeds up future runs</li>
<li><strong>Replay debugging</strong> -- reproduce any failure from the event stream</li>
<li><strong>Analytics</strong> -- resolution rates, confidence trends, escalation patterns</li>
</ul>
</div>
</div>
</div>
`)}

${S(12, `
<h1>Skills System: Hot-Loadable Capabilities</h1>
<p>TierZero's capabilities are modular, hot-loadable skills. Each skill provides specific domain capabilities.</p>
<div class="cols" style="margin-top:14px;">
<div class="col">
<div class="box" style="padding:12px;">
<h3>🏢 ServiceNow Skill</h3>
<p style="font-size:13px;">Navigate ServiceNow, fill forms, resolve incidents, handle SSO login</p>
</div>
<div class="box" style="padding:12px;">
<h3>💡 Hue Lights Skill</h3>
<p style="font-size:13px;">Control Philips Hue -- turn on/off, set colors, scenes</p>
</div>
<div class="box" style="padding:12px;">
<h3>📹 Nest Camera Skill</h3>
<p style="font-size:13px;">Check camera status, get snapshots, manage alerts</p>
</div>
</div>
<div class="col">
<div class="box" style="padding:12px;">
<h3>🌡️ Nest Thermostat Skill</h3>
<p style="font-size:13px;">Read temperature, set schedules, eco mode</p>
</div>
<div class="box" style="padding:12px;">
<h3>📊 App Insights Skill</h3>
<p style="font-size:13px;">Query Azure Application Insights, investigate errors</p>
</div>
<div class="box" style="padding:12px;border-color:#3fb950;">
<h3>🎥 Auto-Generated Skills</h3>
<p style="font-size:13px;">Record a workflow → generate a skill. Any browser task becomes a reusable capability.</p>
</div>
</div>
</div>
<div class="box box-y" style="margin-top:8px;">
<p>Skills are loaded from <code>skill.json</code> manifests. Drop a skill folder in, restart, done. Generated skills from workflow recording are production-ready.</p>
</div>
`)}

${S(13, `
<h1>The Market Opportunity</h1>
<div class="cols" style="margin-top:16px;">
<div class="col">
<div class="box box-b" style="text-align:center;padding:20px;">
<div class="num" style="color:#58a6ff;">$50-400B</div>
<p>TAM per vertical in services automation</p>
</div>
<div class="box" style="margin-top:12px;">
<h3>Why Now:</h3>
<ul>
<li>LLMs finally good enough for real decision-making</li>
<li>Vision models enable true UI understanding</li>
<li>Accessibility APIs provide reliable element targeting</li>
<li>Event sourcing enables enterprise-grade audit trails</li>
</ul>
</div>
</div>
<div class="col">
<div class="box box-r" style="text-align:center;padding:20px;">
<div class="num" style="color:#f85149;">30-50%</div>
<p>RPA implementation failure rate</p>
</div>
<div class="box" style="margin-top:12px;">
<h3>Why TierZero Wins:</h3>
<ul>
<li><span class="r">RPA:</span> Brittle scripts. Break on every UI change.</li>
<li><span class="y">Copilots:</span> Suggest answers. Human still does the work.</li>
<li><span class="g">TierZero:</span> Does the work. Autonomously. Adapts when things change.</li>
</ul>
</div>
</div>
</div>
`)}

${S(14, `
<div class="center" style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;">
<h1 style="font-size:34px;margin-bottom:24px;">Built in One Sunday Morning</h1>
<div style="display:flex;gap:40px;margin:20px 0;">
<div style="text-align:center;"><div class="num" style="color:#58a6ff;">9,605</div><p>lines of code</p></div>
<div style="text-align:center;"><div class="num" style="color:#3fb950;">243</div><p>tests passing</p></div>
<div style="text-align:center;"><div class="num" style="color:#d29922;">18</div><p>new modules</p></div>
<div style="text-align:center;"><div class="num" style="color:#f85149;">0</div><p>failures</p></div>
</div>
<div style="width:120px;height:3px;background:linear-gradient(90deg,#58a6ff,#3fb950,#d29922);border-radius:2px;margin:24px auto;"></div>
<p style="font-size:20px;color:#6e7681;">Autopilot, not copilot.</p>
<p style="font-size:20px;color:#6e7681;">Sell outcomes, not tools.</p>
<p style="font-size:22px;color:#c9d1d9;margin-top:20px;">"Your queue is zero by morning."</p>
<p style="font-size:13px;color:#484f58;margin-top:28px;">github.com/ellistev/tierzero</p>
</div>
`)}

</body></html>`;

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle' });
  const pdfPath = join(__dirname, 'TierZero-Full-Demo.pdf');
  await page.pdf({
    path: pdfPath,
    width: '11in',
    height: '8.5in',
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    printBackground: true,
    preferCSSPageSize: true,
  });
  console.log('PDF saved to ' + pdfPath);
  await browser.close();
}

main().catch(console.error);
