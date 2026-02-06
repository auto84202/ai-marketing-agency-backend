import argparse
import json
import sys
import time
import os
import re
import pandas as pd
import undetected_chromedriver as uc
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.common.action_chains import ActionChains
import pyperclip
from groq import Groq

# Force UTF-8 encoding for Windows console
if sys.platform == 'win32':
    import codecs
    sys.stdout = codecs.getwriter('utf-8')(sys.stdout.buffer, 'strict')
    sys.stderr = codecs.getwriter('utf-8')(sys.stderr.buffer, 'strict')

# ====================================================
# CONFIG
# ====================================================
REPLY_DELAY = 40
SCROLL_ROUNDS = 5
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

def get_chrome_profile_path():
    """Get Chrome profile path from config file (set by setup_chrome_profile.py)"""
    config_file = os.path.join(BASE_DIR, "chrome_profile_config.json")
    
    # Check if config exists
    if os.path.exists(config_file):
        try:
            with open(config_file, 'r') as f:
                config = json.load(f)
                profile_path = config.get('profile_path', '')
                if profile_path and os.path.exists(profile_path):
                    return profile_path
        except:
            pass
    
    # Fallback to local chrome_profile folder
    print("⚠️  No Chrome profile config found. Using default local path.")
    print("   Run 'python setup_chrome_profile.py' to configure your profile location.")
    fallback_path = os.path.join(BASE_DIR, 'chrome_profile')
    os.makedirs(fallback_path, exist_ok=True)
    return fallback_path

PROFILE_PATH = get_chrome_profile_path()
print(f"📁 Using Chrome profile: {PROFILE_PATH}")

def log_progress(status, progress, total_comments, total_replies, message=""):
    data = {
        "status": status,
        "progress": progress,
        "totalComments": total_comments,
        "totalReplies": total_replies,
        "message": message
    }
    print(f"PROGRESS:{json.dumps(data)}", flush=True)

# ====================================================
# DRIVER SETUP
# ====================================================
def setup_driver(headless=False):
    options = uc.ChromeOptions()
    # ALWAYS visible (headed mode) for local testing
    options.add_argument("--start-maximized")
    options.add_argument(f"--user-data-dir={PROFILE_PATH}")
    options.add_argument("--disable-blink-features=AutomationControlled")
    
    driver = uc.Chrome(
        options=options,
        version_main=143,
        use_subprocess=True
    )
    
    driver.execute_script(
        "Object.defineProperty(navigator,'webdriver',{get:()=>undefined})"
    )
    return driver

# ====================================================
# GOOGLE SEARCH → GET INSTAGRAM POST LINKS
# ====================================================
def google_search_instagram(driver, keyword, google_pages):
    driver.get("https://www.google.com")
    time.sleep(3)

    try:
        driver.find_element(By.XPATH, "//button[contains(.,'Accept')]").click()
    except:
        pass

    q = driver.find_element(By.NAME, "q")
    q.send_keys(f"site:instagram.com/p {keyword}")
    q.send_keys(Keys.RETURN)
    time.sleep(4)

    links = set()

    for page in range(google_pages):
        log_progress("searching", int((page / google_pages) * 30), 0, 0, f"Google page {page+1}")

        all_links = driver.find_elements(By.XPATH, "//a[@href]")
        for a in all_links:
            href = a.get_attribute("href")
            if href:
                clean = href.split("?")[0]
                if "instagram.com/p/" in clean and "/reel/" not in clean:
                    links.add(clean)

        try:
            next_btn = driver.find_element(By.ID, "pnnext")
            next_btn.click()
            time.sleep(4)
        except:
            break

    log_progress("searching", 30, 0, 0, f"Found {len(links)} Instagram posts")
    return list(links)

# ====================================================
# SCROLL COMMENT PANEL
# ====================================================
def scroll_comment_panel(driver):
    try:
        time.sleep(3)
        comment_box = driver.find_element(
            By.CSS_SELECTOR,
            ".x5yr21d.xw2csxc.x1odjw0f.x1n2onr6"
        )

        last_scroll = -1
        stable = 0

        for i in range(80):
            driver.execute_script(
                "arguments[0].scrollTop = arguments[0].scrollHeight;",
                comment_box
            )
            time.sleep(1.8)

            new_scroll = driver.execute_script(
                "return arguments[0].scrollTop;",
                comment_box
            )

            if new_scroll == last_scroll:
                stable += 1
                if stable >= 5:
                    break
            else:
                stable = 0

            last_scroll = new_scroll

    except Exception as e:
        print("❌ Error scrolling comments:", e)

# ====================================================
# PARSE RAW TEXT USING REGEX
# ====================================================
def parse_ig_comment_blocks(raw_texts):
    comments = []

    # Username: simple IG handle pattern
    username_pattern = re.compile(r"^[A-Za-z0-9._]+$")

    # Time: only patterns ending with h, d, w, m (e.g., 7 w, 2 h, 15 m, 23 d)
    time_pattern = re.compile(r"^\d+\s*(h|d|w|m)$", re.IGNORECASE)

    noise_patterns = [
        re.compile(r"^(reply|like|likes|view all)$", re.IGNORECASE),
        re.compile(r"^(locations|threads|instagram lite|meta ai|meta verified)$", re.IGNORECASE),
        re.compile(r"^(about|blog|jobs|help|api|privacy|terms|contact uploading and non-users)$", re.IGNORECASE),
        re.compile(r"^©"),  # lines starting with copyright
    ]

    def is_noise(text):
        text_clean = text.strip()
        if not text_clean:
            return True
        for p in noise_patterns:
            if p.match(text_clean):
                return True
        return False

    i = 0
    while i < len(raw_texts):
        username = None
        timestamp = None
        text_lines = []

        # find username first
        if username_pattern.match(raw_texts[i]) and not is_noise(raw_texts[i]):
            username = raw_texts[i]
            i += 1
        else:
            i += 1
            continue

        # skip stray bullets
        while i < len(raw_texts) and raw_texts[i].strip() in ["•", ""]:
            i += 1

        # next must be valid time, otherwise skip comment
        if i < len(raw_texts) and time_pattern.match(raw_texts[i]):
            timestamp = raw_texts[i]
            i += 1
        else:
            # if no valid time right after username, skip this username
            continue

        # now gather comment text until next valid username/time
        while i < len(raw_texts):
            # break if next is a username
            if username_pattern.match(raw_texts[i]) and not is_noise(raw_texts[i]):
                break
            # break if next is a valid time (indicates new comment)
            if time_pattern.match(raw_texts[i]):
                break

            # skip noise and UI text
            if is_noise(raw_texts[i]) or re.match(r"^\d+\s+likes?$", raw_texts[i].strip().lower()):
                i += 1
                continue

            text_lines.append(raw_texts[i])
            i += 1

        # combine comment text
        comment_text = " ".join(text_lines).strip()

        # if we have valid username/time and comment text, add it
        if username and timestamp and comment_text:
            comments.append({
                "author": username,
                "time": timestamp,
                "text": comment_text
            })

    return comments

# ====================================================
# EXTRACT INSTAGRAM COMMENTS
# ====================================================
def extract_ig_comments(driver, post_url):
    print(f"\n📄 Opening: {post_url}")
    driver.get(post_url)
    time.sleep(5)

    scroll_comment_panel(driver)

    raw_elements = driver.find_elements(By.XPATH, "//span[contains(@class,'x193iq5w') and not(@role)]")
    raw_texts = [el.text.strip() for el in raw_elements if el.text.strip()]

    parsed = parse_ig_comment_blocks(raw_texts)

    for p in parsed:
        p["post_url"] = post_url

    print(f"💬 Extracted: {len(parsed)} comments")
    return parsed

# ====================================================
# LLM REPLY
# ====================================================
def generate_reply(groq_client, author, comment):
    prompt = f"""
Write a natural, polite Instagram reply to this comment.

User: {author}
Comment: {comment}

One short sentence. No emojis. No links.
"""
    try:
        r = groq_client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.6
        )
        return r.choices[0].message.content.strip()
    except:
        return f"Thank you for your comment, {author}!"

# ====================================================
# POST INSTAGRAM REPLY
# ====================================================
def post_ig_reply(driver, author, reply_text):
    try:
        time.sleep(1)

        # scroll a bit to make sure the comment box loads
        driver.execute_script("window.scrollBy(0, 500);")
        time.sleep(1)

        # 1) Click the main comment input box
        comment_box = WebDriverWait(driver, 15).until(
            EC.element_to_be_clickable(
                (By.XPATH, "//textarea[@aria-label='Add a comment…']")
            )
        )
        driver.execute_script("arguments[0].scrollIntoView(true);", comment_box)
        comment_box.click()
        time.sleep(0.5)

        # 2) Build the full text: @username + space + generated reply
        full_text = f"@{author} {reply_text}"

        # 3) Copy to clipboard and paste
        pyperclip.copy(full_text)
        ActionChains(driver).key_down(Keys.CONTROL).send_keys("v").key_up(Keys.CONTROL).perform()
        time.sleep(0.8)

        # 4) Click Post button
        post_btn = driver.find_element(
            By.XPATH,
            "//div[@role='button' and (text()='Post' or contains(.,'Post'))]"
        )
        driver.execute_script("arguments[0].scrollIntoView(true);", post_btn)
        time.sleep(0.5)
        post_btn.click()

        time.sleep(2)
        print(f"✅ Reply posted for @{author}")
        return True

    except Exception as e:
        print("❌ Reply failed:", e)
        return False

# ====================================================
# MAIN PROCESS
# ====================================================
def main():
    parser = argparse.ArgumentParser(description='Instagram Scraper')
    parser.add_argument('--api-key', required=True, help='Groq API Key')
    parser.add_argument('--keyword', required=True, help='Search keyword')
    parser.add_argument('--google-pages', type=int, default=1, help='Google pages to scrape')
    parser.add_argument('--reply-limit', type=int, default=1, help='Max replies')
    parser.add_argument('--job-id', required=True, help='Job ID')
    parser.add_argument('--headless', action='store_true', help='Run headless')
    
    args = parser.parse_args()
    
    try:
        driver = setup_driver(args.headless)
        groq_client = Groq(api_key=args.api_key)
        
        log_progress("running", 5, 0, 0, "Starting Instagram scraper")
        
        post_urls = google_search_instagram(driver, args.keyword, args.google_pages)
        
        all_comments = []
        replies_data = []
        reply_count = 0
        
        # Limit to first 3 posts for testing
        for idx, url in enumerate(post_urls[:3]):
            progress = 30 + int((idx / 3) * 40)
            log_progress("running", progress, len(all_comments), reply_count, f"Processing post {idx+1}")
            
            comments = extract_ig_comments(driver, url)
            all_comments.extend(comments)
        
        log_progress("running", 70, len(all_comments), reply_count, f"Collected {len(all_comments)} comments")
        
        replied_users = set()
        
        for comment in all_comments:
            if reply_count >= args.reply_limit:
                break
            
            user = comment["author"]
            text = comment["text"]
            
            if user in replied_users:
                continue
            
            print(f"👤 {user}")
            print(f"💬 {text[:100]}")
            
            reply = generate_reply(groq_client, user, text)
            print("🤖", reply)
            
            driver.get(comment["post_url"])
            time.sleep(6)
            
            if post_ig_reply(driver, user, reply):
                replied_users.add(user)
                reply_count += 1
                replies_data.append({
                    "username": user,
                    "reply_text": reply,
                    "success": True
                })
                progress = 70 + int((reply_count / args.reply_limit) * 30)
                log_progress("running", progress, len(all_comments), reply_count, f"Replied to {user}")
                time.sleep(REPLY_DELAY)
            else:
                replies_data.append({
                    "username": user,
                    "reply_text": reply,
                    "success": False
                })
                time.sleep(10)
        
        comments_output = [{
            "post_url": c["post_url"],
            "username": c["author"],
            "comment": c["text"],
            "time": c["time"]
        } for c in all_comments]
        
        result = {
            "success": True,
            "jobId": args.job_id,
            "platform": "INSTAGRAM",
            "totalComments": len(all_comments),
            "totalReplies": reply_count,
            "comments": comments_output[:100],
            "replies": replies_data
        }
        
        print("\n" + json.dumps(result))
        log_progress("completed", 100, len(all_comments), reply_count, "Job completed")
        
    except Exception as e:
        log_progress("failed", 0, 0, 0, str(e))
        sys.exit(1)
    finally:
        driver.quit()

if __name__ == "__main__":
    main()
