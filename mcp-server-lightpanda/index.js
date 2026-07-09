const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require("@modelcontextprotocol/sdk/types.js");
const puppeteer = require("puppeteer-core");
const path = require("path");
const fs = require("fs");

const LIGHTPANDA_WS = process.env.LIGHTPANDA_WS || "ws://127.0.0.1:9222";
const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR || path.join(__dirname, "../workspace/screenshots");

// Ensure screenshot directory exists
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

let browser = null;
let page = null;

async function getPage() {
  if (browser && page) {
    try {
      // Check if connection is still healthy by trying to get the page URL
      await page.url();
      return page;
    } catch (e) {
      console.error("Browser session lost, reconnecting...", e.message);
      page = null;
      browser = null;
    }
  }

  try {
    browser = await puppeteer.connect({
      browserWSEndpoint: LIGHTPANDA_WS,
      defaultViewport: null
    });
    
    page = await browser.newPage();
    return page;
  } catch (error) {
    console.error("Failed to connect to Lightpanda browser:", error.message);
    throw new Error(`Could not connect to browser at ${LIGHTPANDA_WS}. Is Lightpanda container running?`);
  }
}

const server = new Server(
  {
    name: "lightpanda-browser",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "browser_navigate",
        description: "Navigate to a given URL using the headless browser.",
        inputSchema: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "The absolute URL to navigate to (e.g., https://example.com)"
            }
          },
          required: ["url"]
        }
      },
      {
        name: "browser_click",
        description: "Click an element specified by a CSS selector.",
        inputSchema: {
          type: "object",
          properties: {
            selector: {
              type: "string",
              description: "The CSS selector of the element to click (e.g., button.submit, a#home)"
            }
          },
          required: ["selector"]
        }
      },
      {
        name: "browser_fill",
        description: "Fill an input field specified by a CSS selector with text.",
        inputSchema: {
          type: "object",
          properties: {
            selector: {
              type: "string",
              description: "The CSS selector of the input field"
            },
            value: {
              type: "string",
              description: "The text value to input"
            }
          },
          required: ["selector", "value"]
        }
      },
      {
        name: "browser_get_content",
        description: "Get the HTML content and visible text of the current page.",
        inputSchema: {
          type: "object",
          properties: {}
        }
      },
      {
        name: "browser_screenshot",
        description: "Take a screenshot of the current page and save it to the workspace screenshots folder.",
        inputSchema: {
          type: "object",
          properties: {
            filename: {
              type: "string",
              description: "Optional name of the file (defaults to timestamp.png)"
            }
          }
        }
      }
    ]
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  try {
    const activePage = await getPage();
    
    switch (name) {
      case "browser_navigate": {
        console.error(`Navigating to ${args.url}...`);
        await activePage.goto(args.url, { waitUntil: "load", timeout: 30000 });
        const currentUrl = activePage.url();
        const title = await activePage.title();
        
        return {
          content: [
            {
              type: "text",
              text: `Successfully navigated to: ${currentUrl}\nPage Title: ${title}`
            }
          ]
        };
      }
      
      case "browser_click": {
        console.error(`Clicking element: ${args.selector}...`);
        await activePage.waitForSelector(args.selector, { timeout: 5000 });
        await activePage.click(args.selector);
        
        return {
          content: [
            {
              type: "text",
              text: `Clicked element: ${args.selector}`
            }
          ]
        };
      }
      
      case "browser_fill": {
        console.error(`Filling element: ${args.selector} with "${args.value}"...`);
        await activePage.waitForSelector(args.selector, { timeout: 5000 });
        // Clear input first
        await activePage.focus(args.selector);
        await activePage.click(args.selector, { clickCount: 3 });
        await activePage.keyboard.press("Backspace");
        await activePage.type(args.selector, args.value);
        
        return {
          content: [
            {
              type: "text",
              text: `Filled element: ${args.selector} with text value`
            }
          ]
        };
      }
      
      case "browser_get_content": {
        console.error("Retrieving page content...");
        const url = activePage.url();
        const title = await activePage.title();
        const html = await activePage.content();
        
        // Extract a readable text summary of the page body
        const bodyText = await activePage.evaluate(() => {
          return document.body ? document.body.innerText : "";
        });
        
        return {
          content: [
            {
              type: "text",
              text: `Current URL: ${url}\nTitle: ${title}\n\nVisible Content:\n${bodyText.substring(0, 10000)}`
            }
          ]
        };
      }
      
      case "browser_screenshot": {
        const file = args.filename || `screenshot_${Date.now()}.png`;
        const filepath = path.join(SCREENSHOT_DIR, file);
        console.error(`Taking screenshot and saving to ${filepath}...`);
        
        await activePage.screenshot({ path: filepath });
        
        return {
          content: [
            {
              type: "text",
              text: `Screenshot saved to: ${filepath}`
            }
          ]
        };
      }
      
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    console.error(`Error executing tool ${name}:`, error);
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Error executing ${name}: ${error.message}`
        }
      ]
    };
  }
});

// Run server using Stdio transport
async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Lightpanda MCP server running on stdio");
}

run().catch((error) => {
  console.error("Fatal error in Lightpanda MCP server:", error);
  process.exit(1);
});
