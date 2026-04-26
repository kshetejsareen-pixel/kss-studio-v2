import puppeteer from 'puppeteer-core'
import chromium from '@sparticuz/chromium'

export const config = { maxDuration: 30 }

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { html, width = 1080, height = 1350 } = req.body
  if (!html) return res.status(400).json({ error: 'No HTML provided' })

  let browser
  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: { width, height },
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    })

    const page = await browser.newPage()
    await page.setViewport({ width, height, deviceScaleFactor: 2 }) // 2x for retina quality
    await page.setContent(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8"/>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { width: ${width}px; height: ${height}px; overflow: hidden; background: #000; }
        </style>
      </head>
      <body>${html}</body>
      </html>
    `, { waitUntil: 'networkidle0', timeout: 15000 })

    // Wait for any web fonts to load
    await page.evaluate(() => document.fonts.ready)
    await new Promise(r => setTimeout(r, 500))

    const screenshot = await page.screenshot({
      type: 'png',
      clip: { x: 0, y: 0, width, height },
      omitBackground: false,
    })

    res.setHeader('Content-Type', 'image/png')
    res.setHeader('Content-Disposition', `attachment; filename="KSS-Export-${Date.now()}.png"`)
    res.setHeader('Cache-Control', 'no-cache')
    return res.send(screenshot)

  } catch (err) {
    console.error('Export error:', err)
    return res.status(500).json({ error: err.message })
  } finally {
    if (browser) await browser.close()
  }
}
