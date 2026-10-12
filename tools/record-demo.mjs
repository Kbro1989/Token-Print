/**
 * Record the current app with real backend data and the README's terminal frame.
 * Prerequisites: npm ci in frontend, Chrome, ffmpeg, app on :3000, backend on :8000.
 * Run: node tools/record-demo.mjs
 * Override DEMO_URL, CHROME_PATH, DEMO_WORK_DIR, or DEMO_OUTPUT_DIR if needed.
 * Browser automation changes only this disposable browser session.
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'frontend/package.json'));
const { chromium } = require('playwright');
const url = process.env.DEMO_URL || 'http://localhost:3000';
const work = process.env.DEMO_WORK_DIR || mkdtempSync(path.join(tmpdir(), 'tokenprint-demo-'));
const output = process.env.DEMO_OUTPUT_DIR || path.join(root, '.github/assets');
mkdirSync(work, { recursive: true });
mkdirSync(output, { recursive: true });
const width = 1600, height = 1000;
const browser = await chromium.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
  headless: true,
});
const errors = [];
const segments = [];
let cdp;
try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  page.on('pageerror', e => errors.push(e.message));
  await page.route(`${url}/__demo_capture`, route => route.fulfill({
    contentType: 'text/html; charset=utf-8',
    body: `<!doctype html><html><head><meta charset="utf-8"><style>
      *{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#0d1117}
      #window{height:100%;overflow:hidden;border:1px solid #35363c;border-radius:14px;background:#000}
      header{height:50px;background:#19191d;border-bottom:1px solid #303036;display:flex;align-items:center;justify-content:center;position:relative;color:#d5d5da;font:600 16px -apple-system,BlinkMacSystemFont,sans-serif;letter-spacing:.15px}
      .dots{position:absolute;left:22px;display:flex;gap:10px}.dots i{display:block;width:13px;height:13px;border-radius:50%;background:#ff5f57}.dots i:nth-child(2){background:#febc2e}.dots i:nth-child(3){background:#28c840}
      iframe{display:block;width:100%;height:calc(100% - 86px);border:0;background:#000}
      footer{height:36px;padding:0 20px;display:flex;align-items:center;justify-content:space-between;background:#19191d;border-top:1px solid #303036;color:#d5d5da;font:12px -apple-system,BlinkMacSystemFont,sans-serif}
      #label{font-weight:600}.meta{color:#96969f;font:10px ui-monospace,Menlo,monospace;letter-spacing:.7px}
      </style></head><body><div id="window"><header><span class="dots"><i></i><i></i><i></i></span>TokenPrint — live demo</header><iframe src="${url}/app"></iframe><footer><span id="label">Architecture · inspect a real transformer</span><span class="meta">QWEN2.5-0.5B · REAL MODEL DATA</span></footer></div></body></html>`,
  }));
  await page.goto(`${url}/__demo_capture`, { waitUntil: 'networkidle' });
  const app = page.frames().find(f => f.url().includes('/app'));
  if (!app) throw new Error('App frame did not load');
  page.setDefaultTimeout(60_000);
  await app.locator('.tensor-row').first().waitFor();
  // Hide only the Next.js development badge; retain all product UI and data.
  await app.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
  const nav = async name => {
    await app.locator('.landing-nav-item').filter({ hasText: name }).first().click();
    await page.waitForTimeout(1000);
  };
  const title = name => app.getByTitle(name, { exact: true });
  const label = text => page.locator('#label').evaluate((el, text) => el.textContent = text, text);
  // Warm the educational analysis before filming so loading screens are excluded.
  await nav('Walkthrough');
  await app.getByRole('button', { name: /Show Prediction Timeline/ }).waitFor({ timeout: 120_000 });
  await nav('Architecture');
  await title('Next Operation').click();
  await title('Focus camera on current active layer').click();
  await page.waitForTimeout(2500);
  // Frame the complete active layer using the same orbit/zoom controls as a user.
  await page.mouse.move(780, 440);
  await page.mouse.wheel(0, 280);
  await page.waitForTimeout(1800);

  cdp = await page.context().newCDPSession(page);
  let active = null;
  const writes = [];
  cdp.on('Page.screencastFrame', ({ data, sessionId, metadata }) => {
    if (active) {
      const filename = `${active.name}-${String(active.frames.length).padStart(5, '0')}.png`;
      writeFileSync(path.join(work, filename), Buffer.from(data, 'base64'));
      active.frames.push({ filename, timestamp: metadata.timestamp });
    }
    writes.push(cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {}));
  });
  async function record(name, caption, action) {
    await label(caption);
    await page.mouse.move(1590, 45);
    const segment = { name, caption, frames: [] };
    // Screencast emits only on paint. Anchor both ends so static dashboard
    // reading time is preserved even when Chromium emits no new frames.
    const first = `${name}-start.png`;
    await page.screenshot({ path: path.join(work, first) });
    segment.frames.push({ filename: first, timestamp: Date.now() / 1000 });
    active = segment;
    console.log(`Recording ${name}…`);
    await cdp.send('Page.startScreencast', { format: 'png', maxWidth: width, maxHeight: height, everyNthFrame: 2 });
    await action();
    await cdp.send('Page.stopScreencast');
    await Promise.all(writes.splice(0));
    active = null;
    const last = `${name}-preview.png`;
    const endTimestamp = Date.now() / 1000;
    await page.screenshot({ path: path.join(work, last) });
    segment.frames.push({ filename: last, timestamp: endTimestamp });
    if (segment.frames.length < 20) throw new Error(`Too few frames: ${name}`);
    segments.push(segment);
    console.log(`${name}: ${segment.frames.length} lossless frames`);
  }

  await record('01-architecture', '01 / 04   Architecture · inspect operations, tensors and equations', async () => {
    await page.waitForTimeout(1800);
    await title('Next Operation').click();
    await page.waitForTimeout(2200);
    await title('Next Operation').click();
    await page.waitForTimeout(2200);
    await title('Next Operation').click();
    await page.waitForTimeout(2000);
  });

  await nav('Generation');
  await app.locator('textarea').fill('Explain attention in one short sentence.');
  await app.locator('input[type="number"]').first().fill('16');
  await record('02-generation', '02 / 04   Generation · real tokens, probabilities and KV cache', async () => {
    await app.getByRole('button', { name: 'GENERATE →', exact: true }).click();
    await app.getByTitle('Next token', { exact: true }).waitFor();
    await page.waitForTimeout(1500);
    await title('Focus camera on current active layer').click();
    await page.waitForTimeout(2500);
    await title('Next token').click();
    await page.waitForTimeout(2000);
    await title('Toggle live camera follow mode during execution').click();
    await page.waitForTimeout(2500);
  });

  await nav('Walkthrough');
  await app.getByRole('button', { name: '05 Self-Attention', exact: true }).click();
  await title('Reset camera to full model view (Overview)').click();
  await page.waitForTimeout(2500);
  // Zoom on the central layers; no model or camera internals are modified.
  await page.mouse.move(790, 430);
  await page.mouse.wheel(0, -2300);
  await page.waitForTimeout(2200);
  await record('03-walkthrough', '03 / 04   Walkthrough · attention and SwiGLU, explained with real data', async () => {
    await page.waitForTimeout(3200);
    await app.getByRole('button', { name: '06 MLP / SwiGLU', exact: true }).click();
    await page.waitForTimeout(3500);
  });

  await nav('Debugger');
  await app.getByRole('button', { name: 'Capture', exact: true }).click();
  await app.locator('.debug-path').first().waitFor({ timeout: 120_000 });
  await app.locator('.debug-path').first().click();
  await record('04-debugger', '04 / 04   Debugger · captured tensors, layer metrics and attention heads', async () => {
    await page.waitForTimeout(3200);
    await app.getByRole('button', { name: 'Attention Analysis attention_analysis', exact: true }).click();
    await page.waitForTimeout(4000);
  });
  if (errors.length) throw new Error(`Browser errors: ${errors.join('; ')}`);
} finally {
  await browser.close();
}

// Preserve each captured frame's real timestamp; do not speed up model execution.
let concat = '';
for (const segment of segments) {
  for (let i = 0; i < segment.frames.length; i++) {
    const frame = segment.frames[i];
    const duration = i + 1 < segment.frames.length
      ? Math.max(0.001, segment.frames[i + 1].timestamp - frame.timestamp)
      : 1 / 30;
    concat += `file '${frame.filename}'\nduration ${duration.toFixed(6)}\n`;
  }
}
concat += `file '${segments.at(-1).frames.at(-1).filename}'\n`;
writeFileSync(path.join(work, 'frames.ffconcat'), concat);
writeFileSync(path.join(work, 'capture.json'), JSON.stringify({ url, width, height, segments, errors }, null, 2));
function ffmpeg(args) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'warning', '-y', ...args], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error('ffmpeg failed');
}
console.log('Encoding high-quality MP4…');
ffmpeg(['-f', 'concat', '-safe', '0', '-i', path.join(work, 'frames.ffconcat'),
  '-vf', 'fps=30', '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p',
  '-movflags', '+faststart', '-an', path.join(output, 'demo.mp4')]);
console.log('Encoding palette-optimized GIF…');
// Generate the palette directly from lossless captures, not the compressed MP4.
ffmpeg(['-f', 'concat', '-safe', '0', '-i', path.join(work, 'frames.ffconcat'),
  '-filter_complex', 'fps=20,scale=1280:-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=full[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle',
  '-loop', '0', path.join(output, 'demo.gif')]);
console.log(`Updated ${output}/demo.gif and demo.mp4. Capture details: ${work}`);
