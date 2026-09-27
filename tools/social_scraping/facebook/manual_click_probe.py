"""Manual, visible Facebook DOM probe for development only."""

import os
import sys
from pathlib import Path

os.environ["RESUME_BUILD_PLAYWRIGHT_CDP_PORT"] = "9222"

ROOT = next(
    parent
    for parent in Path(__file__).resolve().parents
    if (parent / "pyproject.toml").exists()
)
sys.path.insert(0, str(ROOT / "legacy" / "python"))

from resume_builder.sources.social.headless_browser import PlaywrightSession  # noqa: E402

def run_probe() -> None:
    url = "https://www.facebook.com/me"
    print(">>> Kumokonekta sa Chrome...")
    with PlaywrightSession("facebook", headless=False) as page:
        page.goto(url, wait_until="domcontentloaded")
        page.bring_to_front()
        
        result = page.evaluate("""() => {
            return new Promise(resolve => {
                const banner = document.createElement('div');
                banner.innerHTML = 'MAG-SCROLL PABABA! Hanapin ang isang TOTOONG POST mo, tapos I-CLICK ang text niyan.';
                banner.style.position = 'fixed';
                banner.style.top = '0';
                banner.style.left = '0';
                banner.style.width = '100%';
                banner.style.backgroundColor = '#10b981';
                banner.style.color = 'white';
                banner.style.textAlign = 'center';
                banner.style.padding = '15px';
                banner.style.fontSize = '24px';
                banner.style.fontWeight = 'bold';
                banner.style.zIndex = '9999999';
                document.body.appendChild(banner);

                let lastOutline = '';
                let lastElement = null;

                const mouseOverHandler = (e) => {
                    if(lastElement && lastElement !== e.target) {
                        lastElement.style.outline = lastOutline;
                    }
                    lastElement = e.target;
                    lastOutline = e.target.style.outline;
                    e.target.style.outline = '4px solid #10b981';
                };

                const clickHandler = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    
                    let element = e.target;
                    if (element.tagName !== 'DIV') {
                        element = element.closest('div') || element;
                    }
                    
                    // Reject if it's the "What's on your mind?" box
                    if (element.innerText.includes("What's on your mind?")) {
                        banner.style.backgroundColor = '#ef4444';
                        banner.innerHTML = 'MALI! "What\\'s on your mind?" ang kinlick mo. MAG-SCROLL PABABA at i-click ang totoong post!';
                        return; // Keep waiting
                    }
                    
                    const article = element.closest('[role="article"]');
                    if (!article) {
                        banner.style.backgroundColor = '#ef4444';
                        banner.innerHTML = 'MALI! Hindi yan nasa loob ng post. MAG-SCROLL PABABA at i-click ang totoong post!';
                        return; // Keep waiting
                    }
                    
                    if(lastElement) {
                        lastElement.style.outline = lastOutline;
                    }
                    
                    document.removeEventListener('mouseover', mouseOverHandler);
                    document.removeEventListener('click', clickHandler, true);
                    banner.remove();
                    
                    resolve({
                        text: element.innerText,
                        tagName: element.tagName,
                        className: element.className,
                        dataAdPreview: element.getAttribute('data-ad-preview'),
                        dir: element.getAttribute('dir'),
                        hasArticleParent: !!article
                    });
                };

                document.addEventListener('mouseover', mouseOverHandler);
                document.addEventListener('click', clickHandler, true);
            });
        }""")
        
        print("\n==================================================")
        print("TAMA! Nakuha na natin ang POST TEXT container:")
        print(f"data-ad-preview: {result['dataAdPreview']}")
        print(f"dir attribute: {result['dir']}")
        print(f"Class: {result['className']}")
        print(f"Text Preview: {result['text'][:100]}...")
        print("==================================================")
        
if __name__ == "__main__":
    run_probe()
