// Build a proper multi-page PDF from individual slide HTML pages
// Uses Playwright to render each slide as a page

import { chromium } from 'playwright';
import { writeFileSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SLIDES_DIR = join(__dirname, 'screenshots');

// Read the screenshots as base64 for embedding
function imgToDataUrl(name) {
  const buf = readFileSync(join(SLIDES_DIR, name));
  return `data:image/png;base64,${buf.toString('base64')}`;
}

const imgs = {
  v1Login: imgToDataUrl('01-v1-login.png'),
  v1Dashboard: imgToDataUrl('02-v1-dashboard.png'),
  v1Search: imgToDataUrl('03-v1-search.png'),
  v1Detail: imgToDataUrl('04-v1-ticket-detail.png'),
  v2Login: imgToDataUrl('05-v2-login.png'),
  v2Dashboard: imgToDataUrl('06-v2-dashboard.png'),
  v2Detail: imgToDataUrl('07-v2-ticket-detail.png'),
};

function slide(content, pageNum) {
  return `<div style="width:1056px;height:816px;padding:48px 56px;box-sizing:border-box;display:flex;flex-direction:column;position:relative;background:#0f1117;color:#e0e0e0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;page-break-after:always;page-break-inside:avoid;">
${content}
<div style="position:absolute;bottom:16px;right:40px;font-size:11px;color:#444;">TierZero</div>
<div style="position:absolute;bottom:16px;left:40px;font-size:11px;color:#444;">${pageNum} / 12</div>
</div>`;
}

const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
@page{size:11in 8.5in;margin:0;}
*{margin:0;padding:0;box-sizing:border-box;}
body{margin:0;padding:0;background:#0f1117;}
h1{font-size:36px;color:#4fc3f7;margin-bottom:14px;}
h2{font-size:28px;color:#81d4fa;margin-bottom:12px;}
h3{font-size:20px;color:#b3e5fc;margin-bottom:8px;}
p{font-size:16px;line-height:1.55;color:#bbb;margin:5px 0;}
ul{font-size:15px;line-height:1.65;color:#bbb;padding-left:22px;}
li{margin:2px 0;}
code{background:#1e1e2e;padding:1px 6px;border-radius:3px;font-size:13px;color:#e06c75;}
.g{color:#4caf50;font-weight:bold;}
.r{color:#f44336;font-weight:bold;}
.y{color:#ff9800;font-weight:bold;}
.b{color:#4fc3f7;font-weight:bold;}
img.ss{border:2px solid #2a2a3a;border-radius:6px;}
</style></head><body>

${slide(`
<div style="text-align:center;display:flex;flex-direction:column;align-items:center;justify-content:center;flex:1;">
<div style="font-size:72px;font-weight:800;color:#4fc3f7;letter-spacing:-2px;">TierZero</div>
<div style="font-size:24px;color:#81d4fa;margin:8px 0 28px;">Self-Healing Adaptive Browser Automation</div>
<div style="width:80px;height:3px;background:linear-gradient(90deg,#4fc3f7,#4caf50);border-radius:2px;margin:0 auto 28px;"></div>
<p style="font-size:18px;color:#888;">Record a workflow once. Replay it anywhere.</p>
<p style="font-size:18px;color:#888;">The UI changes. The workflow doesn't break.</p>
<p style="font-size:14px;color:#555;margin-top:36px;">Steve Elliott -- March 2026</p>
</div>
`, 1)}

${slide(`
<h1>The Problem: Brittle Automation</h1>
<p>Every enterprise has repetitive browser workflows -- ServiceNow tickets, insurance claims, HR onboarding. Today they're either done <strong>manually</strong> or automated with <span class="r">fragile scripts that break constantly</span>.</p>
<div style="display:flex;gap:24px;margin-top:14px;">
<div style="flex:1;">
<h3><span class="r">What breaks scripts:</span></h3>
<ul>
<li>UI redesign changes CSS selectors</li>
<li>Button text changes ("Save" to "Apply")</li>
<li>New confirmation modal appears</li>
<li>Table columns get reordered</li>
<li>Form fields move to different section</li>
</ul>
</div>
<div style="flex:1;">
<h3><span class="y">The cost:</span></h3>
<ul>
<li><strong>$50-400B/year</strong> per vertical in manual services</li>
<li>RPA implementations fail 30-50% of the time</li>
<li>Every UI update = weeks of script maintenance</li>
<li>Companies hire humans instead of fixing scripts</li>
</ul>
</div>
</div>
<div style="background:#1a2332;border-left:4px solid #4fc3f7;padding:10px 14px;margin-top:14px;border-radius:0 6px 6px 0;">
<p><span class="b">The gap:</span> Scripted automation = consulting gig (rebuild every time). Self-healing automation = scalable product.</p>
</div>
`, 2)}

${slide(`
<h1>The Solution: Intent-Based Automation</h1>
<p>Instead of telling the computer <strong>HOW</strong> to interact (CSS selectors), tell it <strong>WHAT</strong> to achieve (goals). The system figures out the HOW at runtime.</p>
<div style="display:flex;gap:20px;margin-top:18px;">
<div style="flex:1;background:#1a1a2e;padding:18px;border-radius:8px;border:1px solid #f44336;">
<h3><span class="r">Traditional (Scripted)</span></h3>
<p><code>page.click('#btn-resolve-main')</code></p>
<p><code>page.fill('#comment-textarea', text)</code></p>
<p><code>page.click('button.submit-btn')</code></p>
<p style="margin-top:10px;color:#f44336;font-size:14px;">Selector changes = script dies. Every time.</p>
</div>
<div style="flex:1;background:#1a2e1a;padding:18px;border-radius:8px;border:1px solid #4caf50;">
<h3><span class="g">TierZero (Intent-Based)</span></h3>
<p><code>goal: "Click the Resolve button"</code></p>
<p><code>goal: "Fill the comment field"</code></p>
<p><code>goal: "Submit the form"</code></p>
<p style="margin-top:10px;color:#4caf50;font-size:14px;">UI changes = system adapts automatically.</p>
</div>
</div>
<div style="background:#1a2332;border-left:4px solid #4caf50;padding:10px 14px;margin-top:14px;border-radius:0 6px 6px 0;">
<p><span class="g">Key insight:</span> The workflow describes the GOAL ("click Resolve"), not the SELECTOR ("#btn-resolve"). When the UI changes, the IntentEngine finds the element by <em>understanding the page</em>, not memorizing DOM paths.</p>
</div>
`, 3)}

${slide(`
<h1>The Full Pipeline</h1>
<p>From human demonstration to adaptive automated skill in 5 steps:</p>
<div style="display:flex;align-items:center;gap:6px;margin:18px 0;flex-wrap:wrap;">
<div style="background:#1a237e;padding:10px 14px;border-radius:8px;text-align:center;font-size:14px;">🎥 Record<br><span style="font-size:11px;color:#999;">Watch human do task</span></div>
<div style="font-size:20px;color:#4fc3f7;">→</div>
<div style="background:#1a237e;padding:10px 14px;border-radius:8px;text-align:center;font-size:14px;">🏷️ Annotate<br><span style="font-size:11px;color:#999;">LLM adds meaning</span></div>
<div style="font-size:20px;color:#4fc3f7;">→</div>
<div style="background:#1a237e;padding:10px 14px;border-radius:8px;text-align:center;font-size:14px;">⚙️ Generate<br><span style="font-size:11px;color:#999;">Create intent workflow</span></div>
<div style="font-size:20px;color:#4fc3f7;">→</div>
<div style="background:#1a237e;padding:10px 14px;border-radius:8px;text-align:center;font-size:14px;">📦 Package<br><span style="font-size:11px;color:#999;">Hot-loadable skill</span></div>
<div style="font-size:20px;color:#4fc3f7;">→</div>
<div style="background:#1a237e;padding:10px 14px;border-radius:8px;text-align:center;font-size:14px;">▶️ Replay<br><span style="font-size:11px;color:#999;">Adaptive execution</span></div>
</div>
<ul style="margin-top:8px;">
<li><strong>Record:</strong> CDP captures every click, keystroke, navigation with page state snapshots</li>
<li><strong>Annotate:</strong> LLM generates semantic descriptions and detects variable vs constant values</li>
<li><strong>Generate:</strong> Converts recording into intent-based workflow steps -- goals, not selectors</li>
<li><strong>Package:</strong> Outputs a hot-loadable TierZero skill with manifest and executable entry point</li>
<li><strong>Replay:</strong> IntentEngine executes each intent adaptively with 5-strategy fallback + recovery</li>
</ul>
<div style="background:#1a2332;border-left:4px solid #4fc3f7;padding:10px 14px;margin-top:10px;border-radius:0 6px 6px 0;">
<p><span class="b">No coding required.</span> A business analyst demonstrates the task. TierZero generates the automation. If the UI changes, it adapts.</p>
</div>
`, 4)}

${slide(`
<h2>Demo: Layout v1 -- Dashboard (Original Design)</h2>
<p>A simulated ticket management system. 10 tickets. Standard layout: ID first, status/priority inline, nav right-aligned. <strong>This is where we record the workflow.</strong></p>
<div style="margin-top:10px;text-align:center;"><img class="ss" src="${imgs.v1Dashboard}" style="max-width:100%;max-height:420px;object-fit:contain;"></div>
<p style="margin-top:6px;font-size:14px;"><span class="b">Column order:</span> ID → Title → Status → Priority → Assignee. Blue accent. Buttons in nav bar.</p>
`, 5)}

${slide(`
<h2>Layout v1 -- Ticket Detail Page</h2>
<p>The recorded workflow: open TKT-007, add comment, assign, click Resolve. All buttons are <strong>text-based</strong> and <strong>right-aligned</strong>.</p>
<div style="margin-top:10px;text-align:center;"><img class="ss" src="${imgs.v1Detail}" style="max-width:100%;max-height:400px;object-fit:contain;"></div>
<p style="margin-top:6px;font-size:14px;"><span class="g">"Resolve"</span> (green, bottom-right). <span class="b">"Save Changes"</span> (blue, right). <span class="b">"Add Comment"</span> (blue, right). Standard text labels on all buttons.</p>
`, 6)}

${slide(`
<h1>Now: The UI Gets Redesigned</h1>
<p>Product team ships a redesign. <span class="r">Traditional automation breaks immediately.</span> Here's what changed:</p>
<ul style="margin-top:12px;font-size:16px;">
<li><span class="y">Button text changed:</span> "Resolve" → "✓ Done" &nbsp; "Add Comment" → "💬 Comment" &nbsp; "Save Changes" → "💾 Save"</li>
<li><span class="y">Button position changed:</span> Moved from bottom-right to top-left and bottom-left</li>
<li><span class="y">CSS classes changed:</span> <code>.btn</code> → <code>.action-btn</code>, <code>.card</code> → <code>.panel</code></li>
<li><span class="y">Table columns reordered:</span> Priority moved to FIRST column, Status to LAST</li>
<li><span class="y">Labels uppercased:</span> "Username" → "USERNAME", "Add Comment" → "ADD COMMENT"</li>
<li><span class="y">Color scheme changed:</span> Light blue → Purple/Indigo</li>
<li><span class="y">New confirmation modal:</span> v2 shows "Are you sure?" on resolve (didn't exist before)</li>
</ul>
<div style="background:#2e1a1a;border-left:4px solid #f44336;padding:10px 14px;margin-top:12px;border-radius:0 6px 6px 0;">
<p><span class="r">With scripted automation:</span> Every selector fails. Every text match fails. Script is dead. Engineer spends days rewriting.</p>
</div>
<div style="background:#1a2e1a;border-left:4px solid #4caf50;padding:10px 14px;margin-top:8px;border-radius:0 6px 6px 0;">
<p><span class="g">With TierZero:</span> Workflow says "Click Resolve button." IntentEngine finds "✓ Done" via aria-label. Zero changes needed.</p>
</div>
`, 7)}

${slide(`
<h2>Layout v2 -- Redesigned Dashboard</h2>
<p>Same data. <span class="y">Completely different structure.</span> Priority column FIRST. Headers UPPERCASE. Status pills on RIGHT. Nav below logo. Different background color.</p>
<div style="margin-top:10px;text-align:center;"><img class="ss" src="${imgs.v2Dashboard}" style="max-width:100%;max-height:400px;object-fit:contain;"></div>
<p style="margin-top:6px;font-size:14px;"><span class="y">Every CSS selector is different.</span> Column order: Priority → ID → Title → Assignee → Status. A scripted automation would fail on every single element.</p>
`, 8)}

${slide(`
<h2>Side-by-Side: The Adaptive Challenge</h2>
<p>Workflow recorded on v1 (left). Replayed on v2 (right). <span class="g">Zero modifications to the workflow.</span></p>
<div style="display:flex;gap:16px;margin-top:12px;">
<div style="flex:1;">
<div style="text-align:center;font-size:13px;color:#888;margin-bottom:4px;">v1 -- Workflow Recorded Here</div>
<img class="ss" src="${imgs.v1Detail}" style="width:100%;">
</div>
<div style="flex:1;">
<div style="text-align:center;font-size:13px;color:#4caf50;margin-bottom:4px;">v2 -- Replayed Successfully ✓</div>
<img class="ss" src="${imgs.v2Detail}" style="width:100%;">
</div>
</div>
<p style="margin-top:8px;font-size:14px;"><span class="g">Every difference handled:</span> "Resolve" → "✓ Done" (found via aria-label). Button moved top-left (found via role). New confirm modal auto-dismissed. Comment field found despite uppercase label change.</p>
`, 9)}

${slide(`
<h1>How the IntentEngine Adapts</h1>
<p>Five resolution strategies tried in order. If one fails, the next kicks in automatically:</p>
<ul style="margin-top:10px;">
<li><strong>1. Cached (~50ms):</strong> Try last-known-good selector. If UI hasn't changed, instant.</li>
<li><strong>2. Aria (~200ms):</strong> Find by accessibility role + label. "Resolve" found even when text is "✓ Done" because <code>aria-label</code> is preserved.</li>
<li><strong>3. LLM -- Accessibility Tree (~500ms):</strong> Feed page's a11y tree to GPT-4o-mini. Understands context: "this looks like a resolve/submit action."</li>
<li><strong>4. LLM -- Vision (~1s):</strong> Screenshot + GPT-4o vision. Finds anything visible on screen.</li>
<li><strong>5. Coordinates (~1.5s):</strong> Ask LLM for pixel coordinates, click directly. Last resort.</li>
</ul>
<p style="margin-top:10px;"><strong>Recovery strategies:</strong></p>
<ul>
<li><strong>Dialog Dismissal:</strong> Detects and closes unexpected modals/alerts automatically</li>
<li><strong>LLM Recovery:</strong> Analyzes page state, suggests navigation or wait actions</li>
<li><strong>Page State Assertions:</strong> Verifies expected state between steps, retries if wrong</li>
</ul>
<div style="background:#1a2332;border-left:4px solid #4fc3f7;padding:10px 14px;margin-top:10px;border-radius:0 6px 6px 0;">
<p>The system <strong>never just crashes</strong>. It tries 5 strategies, then 3 recovery methods, then escalates with a clear explanation of what failed.</p>
</div>
`, 10)}

${slide(`
<h1>Real-World Applications</h1>
<div style="display:flex;gap:20px;margin-top:14px;">
<div style="flex:1;background:#1a1a2e;padding:14px;border-radius:8px;">
<h3 style="color:#4fc3f7;">IT Service Management</h3>
<p>Auto-resolve ServiceNow/Jira tickets. Investigate alerts in App Insights. Update status, add comments, assign owners.</p>
</div>
<div style="flex:1;background:#1a1a2e;padding:14px;border-radius:8px;">
<h3 style="color:#4fc3f7;">Insurance/Gov</h3>
<p>Process claims, renewals, cancellations across legacy web portals. Handles form changes gracefully.</p>
</div>
<div style="flex:1;background:#1a1a2e;padding:14px;border-radius:8px;">
<h3 style="color:#4fc3f7;">Any Enterprise</h3>
<p>Onboarding, procurement, compliance checks -- any repetitive browser task a human does today.</p>
</div>
</div>
<p style="margin-top:18px;font-size:18px;"><strong>The pitch:</strong> "Show me how you do it once. I'll do it forever, even when the UI changes."</p>
<div style="background:#1a2332;border-left:4px solid #ff9800;padding:10px 14px;margin-top:14px;border-radius:0 6px 6px 0;">
<p><span class="y">Sequoia/Julien Bek framing:</span> Sell outcomes ("your queue is zero by morning"), not tools. Autopilot, not copilot.</p>
</div>
`, 11)}

${slide(`
<div style="text-align:center;display:flex;flex-direction:column;align-items:center;justify-content:center;flex:1;">
<h1 style="font-size:38px;">Built in One Sunday Morning</h1>
<div style="display:flex;gap:50px;margin:28px 0;">
<div style="text-align:center;">
<div style="font-size:56px;font-weight:bold;color:#4fc3f7;">9,605</div>
<p>lines of code</p>
</div>
<div style="text-align:center;">
<div style="font-size:56px;font-weight:bold;color:#4caf50;">243</div>
<p>tests passing</p>
</div>
<div style="text-align:center;">
<div style="font-size:56px;font-weight:bold;color:#ff9800;">18</div>
<p>new modules</p>
</div>
<div style="text-align:center;">
<div style="font-size:56px;font-weight:bold;color:#f44336;">0</div>
<p>failures</p>
</div>
</div>
<div style="width:120px;height:3px;background:linear-gradient(90deg,#4fc3f7,#4caf50,#ff9800);border-radius:2px;margin:20px auto;"></div>
<p style="font-size:20px;color:#888;">Scripted automation = <span class="r">consulting gig</span></p>
<p style="font-size:20px;color:#888;">Self-healing adaptive automation = <span class="g">scalable business</span></p>
<p style="font-size:16px;color:#555;margin-top:24px;">$50-400B TAM per vertical in services automation.</p>
</div>
`, 12)}

</body></html>`;

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle' });
  
  const pdfPath = join(__dirname, 'TierZero-Demo-Deck.pdf');
  await page.pdf({
    path: pdfPath,
    width: '11in',
    height: '8.5in',
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    printBackground: true,
    preferCSSPageSize: true,
  });
  
  console.log(`PDF saved to ${pdfPath}`);
  await browser.close();
}

main().catch(console.error);
