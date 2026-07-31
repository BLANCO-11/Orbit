import sys
import json
import urllib.request
import urllib.parse
import xml.etree.ElementTree as ET
import warnings

def fetch_rss_news(feed_url="http://feeds.bbci.co.uk/news/world/rss.xml"):
    try:
        req = urllib.request.Request(
            feed_url, 
            data=None, 
            headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'}
        )
        with urllib.request.urlopen(req, timeout=10) as response:
            xml_data = response.read()
            root = ET.fromstring(xml_data)
            items = []
            for item in root.findall('.//item'): 
                title_el = item.find('title')
                link_el = item.find('link')
                desc_el = item.find('description')
                title = title_el.text if title_el is not None else ""
                link = link_el.text if link_el is not None else ""
                desc = desc_el.text if desc_el is not None else ""
                items.append({'title': title, 'link': link, 'summary': desc})
            return items
    except Exception as e:
        return {'error': str(e)}

def search_web(query: str, max_results: int = 5):
    results = []
    try:
        from ddgs import DDGS
        with DDGS(timeout=10) as ddgs:
            for r in ddgs.text(query, max_results=max_results):
                results.append({
                    'title': r.get('title'),
                    'link': r.get('href'),
                    'summary': r.get('body')
                })
        return results
    except Exception as e:
        return [{'error': str(e)}]

def fetch_webpage_text(url: str) -> str:
    try:
        from bs4 import BeautifulSoup, GuessedAtParserWarning
        warnings.filterwarnings("ignore", category=GuessedAtParserWarning)

        req = urllib.request.Request(
            url,
            data=None,
            headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
            }
        )
        with urllib.request.urlopen(req, timeout=15) as response:
            content_type = response.getheader('Content-Type', '')
            if 'text/html' not in content_type and 'text/plain' not in content_type:
                return f"Non-text content type: {content_type}"
            
            html_bytes = response.read()
            html_str = html_bytes.decode('utf-8', errors='ignore')
            
            try:
                from readability import Document
                doc = Document(html_str)
                summary_html = doc.summary()
                soup = BeautifulSoup(summary_html, 'html.parser')
                text = soup.get_text(separator='\n', strip=True)
                if text and len(text) > 100:
                    return text
            except Exception:
                pass

            soup = BeautifulSoup(html_str, 'html.parser')
            for tag in soup(['nav', 'header', 'footer', 'aside', 'script', 'style', 'form']):
                tag.decompose()

            text = soup.get_text(separator='\n', strip=True)
            lines = (line.strip() for line in text.splitlines())
            return "\n".join(line for line in lines if line)

    except Exception as e:
        return f"Error fetching webpage content for {url}: {e}"

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No command provided"}))
        sys.exit(1)
        
    cmd = sys.argv[1]
    raw_args = sys.argv[2] if len(sys.argv) > 2 else "{}"
    try:
        args = json.loads(raw_args)
    except Exception as e:
        args = {}

    if cmd == "search_web":
        q = args.get("query", "")
        limit = args.get("limit", 5)
        res = search_web(q, limit)
        print(json.dumps(res))
    elif cmd == "fetch_webpage":
        u = args.get("url", "")
        text = fetch_webpage_text(u)
        print(json.dumps({"url": u, "content": text}))
    elif cmd == "fetch_rss_news":
        feed = args.get("feed_url", "http://feeds.bbci.co.uk/news/world/rss.xml")
        res = fetch_rss_news(feed)
        print(json.dumps(res))
    else:
        print(json.dumps({"error": f"Unknown command: {cmd}"}))
