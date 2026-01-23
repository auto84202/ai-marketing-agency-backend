# -*- coding: utf-8 -*-
import undetected_chromedriver as uc
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
import time, os, re, sys
import pandas as pd
from groq import Groq
import pyperclip
from selenium.webdriver.common.action_chains import ActionChains
import argparse

# Force UTF-8 encoding for Windows console
if sys.platform == 'win32':
    import codecs
    sys.stdout = codecs.getwriter('utf-8')(sys.stdout.buffer, 'strict')
    sys.stderr = codecs.getwriter('utf-8')(sys.stderr.buffer, 'strict')

# =====================================================
# COMMAND LINE ARGUMENTS
# =====================================================
parser = argparse.ArgumentParser(description='Reddit Scraper')
parser.add_argument('--api-key', required=True, help='Groq API Key')
parser.add_argument('--reply-limit', type=int, required=True, help='Total users to reply to')
parser.add_argument('--keyword', required=True, help='Keyword to search for')
parser.add_argument('--google-pages', type=int, required=True, help='Number of Google pages to scrape')
parser.add_argument('--job-id', required=False, help='Job ID from backend')
parser.add_argument('--headless', action='store_true', help='Run in headless mode')

args = parser.parse_args()

GROQ_API_KEY = args.api_key
REPLY_LIMIT = args.reply_limit
KEYWORD = args.keyword
GOOGLE_PAGES = args.google_pages

# =====================================================
# CONFIG
# =====================================================
REPLY_DELAY = 45  # DO NOT LOWER
SCROLL_ROUNDS = 4

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROFILE_PATH = os.path.join(BASE_DIR, 'chrome_profile')
os.makedirs(PROFILE_PATH, exist_ok=True)

def log_progress(status, progress, total_comments, total_replies, message=""):
    data = {
        "status": status,
        "progress": progress,
        "totalComments": total_comments,
        "totalReplies": total_replies,
        "message": message
    }
    print(f"PROGRESS:{json.dumps(data)}", flush=True)

groq = Groq(api_key=GROQ_API_KEY)

# =====================================================
# DRIVER
# =====================================================
def setup_driver():
    options = uc.ChromeOptions()
    if not args.headless:
        options.add_argument("--start-maximized")
    options.add_argument(f"--user-data-dir={PROFILE_PATH}")
    options.add_argument("--disable-blink-features=AutomationControlled")
    options.add_argument("--disable-notifications")
    driver = uc.Chrome(options=options)
    driver.execute_script(
        "Object.defineProperty(navigator,'webdriver',{get:()=>undefined})"
    )
    return driver

# =====================================================
# GOOGLE SEARCH (REDDIT POSTS ONLY)
# =====================================================
def google_search_reddit_posts(driver):
    driver.get("https://www.google.com")
    time.sleep(3)

    try:
        driver.find_element(By.XPATH, "//button[contains(.,'Accept')]").click()
    except:
        pass

    q = driver.find_element(By.NAME, "q")
    q.send_keys(f"site:reddit.com/comments {KEYWORD}")
    q.send_keys(Keys.RETURN)
    time.sleep(4)

    links = set()

    for page in range(GOOGLE_PAGES):
        print(f"🔍 Google page {page+1}")

        for a in driver.find_elements(By.XPATH, "//a[@href]"):
            href = a.get_attribute("href")
            if href and "reddit.com/comments/" in href:
                if "old.reddit.com" not in href:
                    links.add(href.split("?")[0])

        try:
            driver.find_element(By.ID, "pnnext").click()
            time.sleep(4)
        except:
            break

    print(f"Found {len(links)} Reddit links")
    log_progress("RUNNING", 10, 0, 0, f"Found {len(links)} Reddit threads")
    return list(links)

# =====================================================
# SCROLL
# =====================================================
def scroll_page(driver, rounds=4):
    for _ in range(rounds):
        driver.execute_script("window.scrollTo(0, document.body.scrollHeight)")
        time.sleep(3)

# =====================================================
# EXTRACT COMMENTS
# =====================================================
def extract_comments(driver, post_url):
    print(f"\n📄 Opening: {post_url}")
    driver.get(post_url)
    time.sleep(6)

    scroll_page(driver, SCROLL_ROUNDS)

    comments = []
    blocks = driver.find_elements(By.XPATH, "//shreddit-comment | //div[@data-testid='comment']")
    print(f"💬 Found {len(blocks)} comments")

    for block in blocks:
        try:
            full_text = block.text.strip()
            if not full_text or len(full_text) < 5:
                continue

            # Advanced author detection
            author = "Unknown"
            try:
                author_el = block.find_element(By.XPATH, ".//a[contains(@href,'/user/')]")
                author = author_el.text.strip().replace("u/", "")
            except:
                # Try to extract from first line of text
                match = META_PATTERN.search(full_text)
                if match:
                    author = match.group("username")

            # Clean the comment text
            text = clean_comment_text(full_text)
            if not text or len(text) < 5:
                continue

            comments.append({
                "post_url": post_url,
                "author": author,
                "text": text,
                "block": block
            })
        except:
            continue

    return comments

# =====================================================
# LLM REPLY
# =====================================================
def generate_reply(username, comment):
    prompt = f"""
Reply casually and naturally to this Reddit comment.

User: {username}
Comment: {comment}

One short sentence. Human. No hashtags.
"""
    try:
        r = groq.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.6
        )
        return r.choices[0].message.content.strip()
    except Exception as e:
        print(f"Groq error: {e}")
        return f"Interesting perspective, {username}!"

# =====================================================
# POST REPLY (NEW REDDIT)
# =====================================================
def post_reply(driver, block, reply_text):
    try:
        # 1. Scroll into view
        driver.execute_script(
            "arguments[0].scrollIntoView({block:'center'});", block
        )
        time.sleep(1)

        # 2. Click Reply
        reply_btn = block.find_element(
            By.XPATH, ".//span[normalize-space()='Reply']/ancestor::button"
        )
        driver.execute_script("arguments[0].click();", reply_btn)
        time.sleep(3)

        # 3. Copy text to clipboard
        pyperclip.copy(reply_text)

        # 4. Focus editor using TAB navigation (CRITICAL)
        actions = ActionChains(driver)
        actions.send_keys(Keys.TAB).pause(0.5)
        actions.send_keys(Keys.TAB).pause(0.5)
        actions.send_keys(Keys.TAB).perform()

        time.sleep(1)

        # 5. Paste text (REAL keyboard event)
        actions = ActionChains(driver)
        actions.key_down(Keys.CONTROL).send_keys("v").key_up(Keys.CONTROL).perform()

        time.sleep(2)

        # 6. Submit using CTRL + ENTER
        actions = ActionChains(driver)
        actions.key_down(Keys.CONTROL).send_keys(Keys.ENTER).key_up(Keys.CONTROL).perform()

        print("✅ Reply posted")
        return True

    except Exception as e:
        print("❌ Reply failed:", e)
        return False


# =====================================================
# TEXT CLEANING
# =====================================================
META_PATTERN = re.compile(
    r"(?P<username>[A-Za-z0-9_-]+)\s+[•â€¢]\s+(?P<value>\d+)\s*(?P<unit>[a-zA-Z]+)",
    re.MULTILINE
)

REDUNDANT_LINES = {
    "upvote", "downvote", "reply", "award",
    "share", "follow", "report", "save"
}

def normalize_time(value, unit):
    unit = unit.lower()

    if unit.startswith("min"):
        return f"{max(1, value // 60)}h"
    if unit.startswith("h"):
        return f"{value}h"
    if unit.startswith("d"):
        return f"{value * 24}h"
    if unit.startswith("y"):
        return f"{value}y"
    return None


def clean_comment_text(raw_text):
    if not isinstance(raw_text, str):
        return None

    lines = [l.strip() for l in raw_text.splitlines() if l.strip()]
    cleaned = []

    for line in lines:
        l = line.lower()

        # UI junk
        if l in REDUNDANT_LINES:
            continue

        # vote counts
        if l.isdigit():
            continue

        # username + time line
        if META_PATTERN.search(line):
            continue

        # bullet characters
        if line in {"•", "â€¢"}:
            continue

        cleaned.append(line)

    return " ".join(cleaned).strip() if cleaned else None


def process_reddit_csv(df, text_col="text"):
    authors = []
    times = []
    cleaned_texts = []

    for text in df[text_col].fillna(""):
        match = META_PATTERN.search(text)

        if match:
            author = match.group("username")
            value = int(match.group("value"))
            unit = match.group("unit")
            time = normalize_time(value, unit)
        else:
            author = None
            time = None

        authors.append(author)
        times.append(time)
        cleaned_texts.append(clean_comment_text(text))

    df["author"] = authors
    df["time"] = times
    df[text_col] = cleaned_texts

    return df


# =====================================================
# MAIN
# =====================================================
if __name__ == "__main__":
    driver = setup_driver()
    wait = WebDriverWait(driver, 12)

    print("➡️ Log in to Reddit manually (15s)")
    post_urls = google_search_reddit_posts(driver)
    all_comments = []
    for i, url in enumerate(post_urls):
        print(f"📄 Thread {i+1}/{len(post_urls)}")
        log_progress("RUNNING", 10 + ((i+1)/len(post_urls)*40), 0, 0, f"Processing thread {i+1}/{len(post_urls)}")
        all_comments.extend(extract_comments(driver, url))
        if i+1 > 1: # Original code had c > 1, changed to i+1 for consistency
            break

    df = pd.DataFrame(all_comments)
    df = process_reddit_csv(df)
    print(f"\n📊 Total comments collected: {len(df)}")
    log_progress("RUNNING", 50, len(df), 0, f"Collected {len(df)} comments")

    # =====================================================
    # AUTO REPLY
    # =====================================================
    replied_users = set()
    reply_count = 0
    replies_data = []  # Track replies for output

    print("\n================ STARTING REPLIES ================\n")

    for _, row in df.iterrows():
        if reply_count >= REPLY_LIMIT:
            break

        if row["author"] in replied_users:
            continue

        print(f"👤 {row['author']}")
        print(f"💬 {row['text'][:120]}")

        reply = generate_reply(row["author"], row["text"])
        print(f"🤖 {reply}")

        driver.get(row["post_url"])
        time.sleep(6)
        scroll_page(driver, 3)
        
        blocks = driver.find_elements(
        By.XPATH,
        "//shreddit-comment | //div[@data-testid='comment']")

        for block in blocks:
            if row["author"] and row["author"] in block.text:
                success = post_reply(driver, block, reply)
                if success:
                    replied_users.add(row["author"])
                    reply_count += 1
                    log_progress("RUNNING", 50 + (reply_count/REPLY_LIMIT*40), len(all_comments), reply_count, f"Engaged with {row['author']}")
                    time.sleep(REPLY_DELAY)
                
                # Track reply regardless of success
                replies_data.append({
                    "username": row["author"],
                    "reply_text": reply,
                    "success": success
                })
                break

    print("\n🎉 DONE")
    driver.quit()

    # Output JSON result for backend to parse
    import json
    
    # Calculate stats
    total_comments = len(df) if not df.empty else 0
    
    # Prepare comments data for output
    comments_data = []
    if not df.empty:
        for _, row in df.iterrows():
            comments_data.append({
                "post_url": row.get("post_url", ""),
                "username": row.get("author", ""),
                "comment": row.get("text", ""),
                "time": row.get("time", "")
            })
    
    result = {
        "success": True,
        "totalComments": total_comments,
        "totalReplies": reply_count,
        "comments": comments_data,
        "replies": replies_data
    }
    print("\n" + json.dumps(result))


