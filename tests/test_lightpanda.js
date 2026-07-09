const puppeteer = require('puppeteer-core');

async function testLightpanda() {
  console.log('Connecting to Lightpanda browser at ws://127.0.0.1:9222...');
  
  let browser;
  try {
    browser = await puppeteer.connect({
      browserWSEndpoint: 'ws://127.0.0.1:9222',
      defaultViewport: null
    });
    
    console.log('Connected! Creating a new page...');
    const page = await browser.newPage();
    
    console.log('Navigating to https://example.com...');
    await page.goto('https://example.com', { waitUntil: 'load' });
    
    console.log('Fetching page title...');
    const title = await page.title();
    console.log(`Page Title: "${title}"`);
    
    console.log('Fetching page heading...');
    const heading = await page.$eval('h1', el => el.textContent);
    console.log(`Heading text: "${heading}"`);

    console.log('Taking a screenshot...');
    try {
      await page.screenshot({ path: 'tests/example.png' });
      console.log('Screenshot saved to tests/example.png');
    } catch (e) {
      console.log('Screenshot feature not supported or failed:', e.message);
    }
    
    console.log('Extracting paragraph content...');
    const paragraph = await page.$eval('p', el => el.textContent);
    console.log(`Paragraph text: "${paragraph}"`);
    
    console.log('Test completed successfully!');
  } catch (error) {
    console.error('Error during Lightpanda testing:', error);
  } finally {
    if (browser) {
      console.log('Disconnecting from browser...');
      await browser.disconnect();
    }
  }
}

testLightpanda();
