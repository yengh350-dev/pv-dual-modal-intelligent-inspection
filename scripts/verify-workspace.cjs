const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/Users/heyanfeng/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

// Run against an isolated seeded preview database, never a production instance.
const base = process.env.PREVIEW_URL || 'http://127.0.0.1:5188';
const output = path.resolve(__dirname, '../.impeccable/review');

async function main() {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const captures = [];
  const audits = [];
  async function capture(name) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(output, name + '.png'), fullPage: true });
    captures.push(name);
    const audit = await page.evaluate(() => {
      const rect = document.body.getBoundingClientRect();
      const visible = element => { const r = element.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const parse = value => (value.match(/[\d.]+/g) || []).map(Number);
      const luminance = channels => channels.slice(0, 3).map(c => c / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4).reduce((sum, c, index) => sum + c * [.2126, .7152, .0722][index], 0);
      const failures = [];
      for (const element of document.querySelectorAll('.button, .workspace-table small, .workspace-source, .workbench-heading p')) {
        if (!visible(element) || element.matches(':disabled')) continue;
        const foreground = parse(getComputedStyle(element).color);
        let parent = element, background;
        while (parent) {
          const candidate = parse(getComputedStyle(parent).backgroundColor);
          if (candidate.length >= 3 && (candidate.length < 4 || candidate[3] === 1)) { background = candidate; break; }
          parent = parent.parentElement;
        }
        if (!background) continue;
        const a = luminance(foreground), b = luminance(background);
        const ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
        if (ratio < 4.5) failures.push({ text: element.textContent.trim().slice(0, 50), ratio: Number(ratio.toFixed(2)) });
      }
      return { viewport: innerWidth, width: rect.width, documentWidth: document.documentElement.scrollWidth, contrastFailures: failures };
    });
    audits.push({ name, ...audit });
  }
  try {
    await page.goto(base, { waitUntil: 'networkidle' });
    await capture('login-desktop');
    await page.getByRole('button', { name: '登录工作空间', exact: true }).click();
    await page.getByRole('heading', { name: '运维工作台', exact: true }).waitFor();
    await page.getByRole('button', { name: /证据待复核/ }).waitFor();
    await page.locator('.workspace-source time').waitFor();
    await capture('desktop');
    await page.getByRole('button', { name: '切换到深色模式' }).click();
    await capture('desktop-dark');
    await page.getByRole('button', { name: /在办工单/ }).click();
    await page.getByRole('link', { name: '继续处置' }).first().waitFor();
    await page.getByRole('link', { name: '继续处置' }).first().click();
    await page.getByRole('dialog', { name: '工单处置与验收' }).waitFor();
    await page.getByLabel('现场处置记录', { exact: true }).fill('浏览器回归：现场复测记录已保留');
    await page.getByRole('button', { name: '保存记录', exact: true }).click();
    await page.getByText('处置记录已保存', { exact: true }).waitFor();
    await capture('order-detail-dark');
    await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
    await page.goto(base + '/missions?create=1', { waitUntil: 'networkidle' });
    await page.getByLabel('任务名称', { exact: true }).fill('浏览器回归任务-' + Date.now());
    await page.getByLabel('目标场站', { exact: true }).fill('浏览器验证场站');
    await page.getByLabel('飞行设备', { exact: true }).fill('DJI 测试设备');
    await page.getByRole('button', { name: '保存任务', exact: true }).click();
    await page.getByRole('dialog', { name: '任务记录' }).waitFor();
    await page.getByText('浏览器验证场站', { exact: true }).last().waitFor();
    await capture('mission-detail-dark');
    await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
    await page.getByRole('button', { name: '搜索平台记录或功能', exact: true }).click();
    await page.getByRole('combobox', { name: '搜索平台记录或功能' }).fill('浏览器回归任务');
    await page.getByRole('option', { name: /浏览器回归任务/ }).waitFor();
    await capture('search-dark');
    await page.getByRole('combobox', { name: '搜索平台记录或功能', exact: true }).press('Enter');
    await page.getByRole('dialog', { name: '任务记录' }).waitFor();
    await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
    for (const route of ['dashboard', 'missions', 'anomalies', 'work-orders', 'command-center', 'evidence', 'models', 'reports', 'data', 'assets', 'users', 'settings', 'live', 'overview']) {
      await page.goto(base + '/' + route, { waitUntil: 'networkidle' });
      await page.locator('.route-frame :is(h1,h2)').first().waitFor();
      await capture('route-' + route + '-dark');
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(base + '/dashboard', { waitUntil: 'networkidle' });
    await capture('mobile-dark');
    await page.getByRole('button', { name: '切换到浅色模式' }).click();
    await capture('mobile');
    await page.getByRole('button', { name: '打开主导航' }).click();
    await capture('mobile-navigation');
    await page.getByRole('link', { name: '运维工单', exact: true }).click();
    assert.equal(await page.locator('.app-shell.mobile-nav-open').count(), 0);
    await capture('mobile-work-orders');
    assert.deepEqual(errors, [], 'Browser runtime errors');
    assert.ok(audits.filter(item => ['desktop', 'desktop-dark', 'mobile', 'mobile-dark'].includes(item.name)).every(item => item.documentWidth <= item.viewport + 1), 'Workspace page overflow');
    await fs.writeFile(path.join(output, 'browser-results.json'), JSON.stringify({ captures, audits, errors, flows: ['login', 'queue to work-order', 'persist work-order note', 'create mission', 'search record + keyboard Enter', 'all route loads', 'mobile navigation'] }, null, 2));
    console.log(JSON.stringify({ screenshots: captures.length, errors, contrastFindings: audits.filter(item => item.contrastFailures.length).map(item => ({ name: item.name, issues: item.contrastFailures })) }, null, 2));
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exit(1); });
