# -*- coding: utf-8 -*-
import undetected_chromedriver as uc
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException
import time, os, re, sys
import pandas as pd
from groq import Groq
import argparse
import json

# Force UTF-8 encoding for Windows console
if sys.platform == 'win32':
    import codecs
    sys.stdout = codecs.getwriter('utf-8')(sys.stdout.buffer, 'strict')
    sys.stderr = codecs.getwriter('utf-8')(sys.stderr.buffer, 'strict')

# =====================================================
# COMMAND LINE ARGUMENTS
# =====================================================
parser = argparse.ArgumentParser(description='Facebook Scraper')
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

groq_client = Groq(api_key=GROQ_API_KEY)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROFILE_PATH = os.path.join(BASE_DIR, 'chrome_profile')

SCROLL_ROUNDS = 15
REPLY_DELAY = 30  # DO NOT LOWER

# =====================================================
# DRIVER
# =====================================================
def setup_driver():
    options = uc.ChromeOptions()
    if not args.headless:  # Only show browser if not in headless mode
        options.add_argument("--start-maximized")
    options.add_argument(f"--user-data-dir={PROFILE_PATH}")
    options.add_argument("--disable-blink-features=AutomationControlled")
    driver = uc.Chrome(options=options)
    driver.execute_script(
        "Object.defineProperty(navigator,'webdriver',{get:()=>undefined})"
    )
    return driver

# =====================================================
# HELPERS
# =====================================================
def log_progress(status, progress, total_comments, total_replies, message=""):
    data = {
        "status": status,
        "progress": progress,
        "totalComments": total_comments,
        "totalReplies": total_replies,
        "message": message
    }
    print(f"PROGRESS:{json.dumps(data)}", flush=True)

def is_reel_loaded(driver):
    u = driver.current_url.lower()
    return any(x in u for x in ["/reel/", "/reels/", "/watch/"])

def fb_time_to_hours_from_comment(text):
    if not isinstance(text, str):
        return None

    match = re.search(r"\b(\d+)\s*(m|h|d|w|y)\b", text.lower())
    if not match:
        return None

    value = int(match.group(1))
    unit = match.group(2)

    if unit == "m":
        return value / 60
    if unit == "h":
        return value
    if unit == "d":
        return value * 24
    if unit == "w":
        return value * 168
    if unit == "y":
        return value * 8760

def clean_username(username_text):
    """Extract clean username from messy text"""
    if not username_text:
        return "Unknown"
    
    # Remove "Anonymous participant" repeated text
    username_text = re.sub(r'(Anonymous participant\s*\d*\s*)+', 'Anonymous participant', username_text)
    
    # Remove multiple spaces
    username_text = re.sub(r'\s+', ' ', username_text).strip()
    
    # If it's just "Anonymous participant", keep it
    if username_text.startswith("Anonymous participant"):
        return "Anonymous participant"
    
    # Otherwise, take the first meaningful part
    parts = username_text.split()
    if len(parts) > 0:
        # Get first 2-3 words as username
        return ' '.join(parts[:min(3, len(parts))])
    
    return username_text or "Unknown"

def clean_comment(comment_text):
    """Extract clean comment text"""
    if not comment_text:
        return ""
    
    # Remove URLs
    comment_text = re.sub(r'https?://\S+', '', comment_text)
    
    # Remove "Like Like" patterns
    comment_text = re.sub(r'\bLike\b\s*\bLike\b', '', comment_text, flags=re.IGNORECASE)
    
    # Remove standalone "Like" at the end
    comment_text = re.sub(r'\s*\bLike\b\s*', ' ', comment_text).strip()
    
    # Remove "Edited" text
    comment_text = re.sub(r'\bEdited\b', '', comment_text, flags=re.IGNORECASE)
    
    # Remove reaction counts like "2 2" or "3 3"
    comment_text = re.sub(r'\b(\d+)\s+\1\b', '', comment_text)
    
    # Remove "Follow · Follow"
    comment_text = re.sub(r'·\s*Follow\s*·?\s*Follow', '', comment_text)
    
    # Remove "Reply" text
    comment_text = re.sub(r'\bReply\b', '', comment_text, flags=re.IGNORECASE)
    
    # Remove newlines and replace with spaces
    comment_text = comment_text.replace('\n', ' ')
    
    # Remove multiple spaces
    comment_text = re.sub(r'\s+', ' ', comment_text).strip()
    
    return comment_text

def extract_time_from_text(text):
    """Extract time information from comment text"""
    if not text:
        return None
    
    # Look for patterns like "1y", "2d", "3h", "45m"
    match = re.search(r'\b(\d+)\s*(y|w|d|h|m)\b', text.lower())
    if match:
        return f"{match.group(1)}{match.group(2)}"
    
    return None


# =====================================================
# GOOGLE SEARCH
# =====================================================
def google_search_and_collect_links(driver):
    driver.get("https://www.google.com")
    time.sleep(3)

    try:
        driver.find_element(By.XPATH, "//button[contains(text(),'Accept')]").click()
    except:
        pass

    q = driver.find_element(By.NAME, "q")
    q.send_keys(f'site:facebook.com "{KEYWORD}"')
    q.send_keys(Keys.RETURN)
    time.sleep(4)

    links = set()

    for page in range(GOOGLE_PAGES):
        print(f"🔍 Google page {page+1}")
        for a in driver.find_elements(By.XPATH, "//a[@href]"):
            url = a.get_attribute("href")
            if not url:
                continue
            u = url.lower()
            if "facebook.com" in u and any(x in u for x in ["/posts/", "/groups/", "permalink.php", "/reel/", "/reels/"]):
                if not any(x in u for x in ["/video", "/watch"]):
                    links.add(url.split("?")[0])
        try:
            driver.find_element(By.ID, "pnnext").click()
            time.sleep(4)
        except:
            break

    return list(links)

# =====================================================
# POST COMMENTS
# =====================================================
def load_all_post_comments(driver):
    """Load all comments with proper scrolling and element detection - based on working notebook code"""
    try:
        dialog = WebDriverWait(driver, 10).until(
            EC.presence_of_element_located((By.XPATH, "//div[@role='dialog']"))
        )
        print("📁 Dialog detected for comments")
    except TimeoutException:
        print("⚠️ No dialog found, returning empty list")
        return []

    # Find scroller element within dialog
    scrollers = dialog.find_elements(By.XPATH, ".//div[contains(@style,'overflow')]")
    scroller = scrollers[0] if scrollers else None
    
    if scroller:
        print(f"   📜 Found scroller element")
    else:
        print(f"   ⚠️ No scroller found, will use window scroll")

    # Scroll and expand comments multiple times
    for round_num in range(SCROLL_ROUNDS):
        # Click all "View more" and "See more" buttons
        for b in driver.find_elements(
            By.XPATH,
            "//div[@role='button' and (contains(.,'View more') or contains(.,'See more'))]"
        ):
            try:
                b.click()
                print(f"   📂 Clicked to expand comments (round {round_num + 1})")
                time.sleep(0.5)
            except:
                pass
        
        # Scroll the scroller element or window
        if scroller:
            driver.execute_script("arguments[0].scrollTop = arguments[0].scrollHeight", scroller)
        else:
            driver.execute_script("window.scrollBy(0, 800)")
        
        time.sleep(1.2)
    
    # Find all article elements (comments) within the dialog
    article_elements = dialog.find_elements(By.XPATH, ".//div[@role='article']")
    print(f"   🔍 Found {len(article_elements)} unique article elements total")
    
    return article_elements

# =====================================================
# REEL COMMENTS
# =====================================================
def click_reel_comment_button(driver):
    try:
        btn = WebDriverWait(driver, 8).until(
            EC.element_to_be_clickable((
                By.XPATH,
                "//div[@role='button'][.//i[@data-visualcompletion='css-img']]"
            ))
        )
        driver.execute_script("arguments[0].click();", btn)
        time.sleep(2)
        return True
    except:
        return False

# =====================================================
# PARSER - Based on working notebook code
# =====================================================
def parse_blocks(blocks, url):
    data = []
    for block in blocks:
        try:
            # Extract username from first link element
            username = block.find_element(By.XPATH, ".//a").text.strip()
            
            # Extract comment text from all span elements
            text = " ".join(s.text for s in block.find_elements(By.XPATH, ".//span") if s.text).strip()
            
            if len(text) < 5:
                continue
            
            # Extract time information
            try:
                abbr = block.find_element(By.XPATH, ".//abbr")
                time_raw = abbr.get_attribute("aria-label") or abbr.text
            except:
                time_raw = None
            
            data.append({
                "post_url": url,
                "username": username if username else "Anonymous",
                "comment": text,
                "time_raw": time_raw,
                "block": block
            })
        except Exception as e:
            # Skip blocks that can't be parsed
            continue
    
    return data

def prepare_post_for_reply(driver):
    """Ensure comments + reply UI are visible - based on working notebook code"""
    time.sleep(2)

    if is_reel_loaded(driver):
        click_reel_comment_button(driver)
        time.sleep(2)
    else:
        load_all_post_comments(driver)

    # Small scroll to wake DOM
    driver.execute_script("window.scrollBy(0, 400)")
    time.sleep(1)

# =====================================================
# LLM
# =====================================================
def generate_reply(username, comment):
    prompt = f"""
Reply casually and friendly to this Facebook comment.

User: {username}
Comment: {comment}

One short sentence. Human. Not spammy.
"""
    try:
        r = groq_client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.7
        )
        return r.choices[0].message.content.strip()
    except Exception as e:
        print(f"Groq error: {e}")
        return f"Thanks for sharing your thoughts, {username}!"

# =====================================================
# POST REPLY - Based on working notebook code
# =====================================================
def post_reply(driver, reply_text):
    try:
        reply_btn = driver.find_element(
            By.XPATH, "//div[@role='button' and contains(.,'Reply')]"
        )
        driver.execute_script("arguments[0].click();", reply_btn)
        time.sleep(1)

        input_box = driver.find_element(By.XPATH, "//div[@contenteditable='true']")
        for ch in reply_text:
            input_box.send_keys(ch)
            time.sleep(0.05)

        input_box.send_keys(Keys.ENTER)
        return True
    except Exception as e:
        print("Reply error:", e)
        return False


# =====================================================
# MAIN
# =====================================================
if __name__ == "__main__":
    driver = setup_driver()
    print("➡️ Log in to Facebook (15s)")
    #time.sleep(15)

    urls = google_search_and_collect_links(driver)
    print(f"🔗 Found {len(urls)} URLs")
    log_progress("RUNNING", 10, 0, 0, f"Found {len(urls)} target posts")

    all_comments = []

    for i, url in enumerate(urls, 1):
        try:
            print(f"\n📄 Processing {i}/{len(urls)}: {url}")
            driver.get(url)
            time.sleep(4)

            if is_reel_loaded(driver):
                print("🎬 Reel detected")
                if not click_reel_comment_button(driver):
                    print("ℹ️ No comment button")
                    log_progress("RUNNING", 10 + (i/len(urls)*40), len(all_comments), 0, f"Processed {i}/{len(urls)} - No comments")
                    continue
                blocks = driver.find_elements(By.XPATH, "//div[@role='article']")
            else:
                print("📰 Post detected")
                blocks = load_all_post_comments(driver)

            if not blocks:
                print("ℹ️ No comments found or timed out")
                log_progress("RUNNING", 10 + (i/len(urls)*40), len(all_comments), 0, f"Processed {i}/{len(urls)} - 0 comments")
                continue

            data = parse_blocks(blocks, driver.current_url)
            print(f"   ➜ {len(data)} comments")
            all_comments.extend(data)
            log_progress("RUNNING", 10 + (i/len(urls)*40), len(all_comments), 0, f"Found {len(all_comments)} total comments")
        except Exception as e:
            print(f"⚠️ Error skipping URL {i}: {e}")
            log_progress("RUNNING", 10 + (i/len(urls)*40), len(all_comments), 0, f"Error on page {i}")
            continue

    df = pd.DataFrame(all_comments)
    
    # Check if DataFrame is empty
    if df.empty:
        print("\n⚠️ No comments found to process")
        total_comments = 0
        last_1h = 0
        last_24h = 0
    else:
        # Use time_raw for hours calculation
        df["hours_ago"] = df["time_raw"].apply(fb_time_to_hours_from_comment)

        # =====================================================
        # COUNTS
        # =====================================================
        total_comments = len(df)
        last_1h = int((df["hours_ago"] <= 1).sum()) if "hours_ago" in df.columns else 0
        last_24h = int((df["hours_ago"] <= 24).sum()) if "hours_ago" in df.columns else 0

    # =====================================================
    # AUTO REPLY
    # =====================================================
    print("\n================ STARTING REPLIES ================\n")

    replied_users = set()
    reply_count = 0
    failed_count = 0
    replies_data = []  # Track replies for output

    if not df.empty:
        for _, row in df.iterrows():
            if reply_count >= REPLY_LIMIT:
                break

            if row["username"] in replied_users:
                continue

            print("\n-----------------------------------")
            print(f"👤 User: {row['username']}")
            print(f"💬 Comment: {row['comment'][:120]}")

            reply_text = generate_reply(row["username"], row["comment"])
            print(f"🤖 LLM Reply: {reply_text}")

            driver.get(row["post_url"])
            time.sleep(4)

            # 🔥 THIS IS THE FIX
            prepare_post_for_reply(driver)

            success = post_reply(driver, reply_text)
            if success:
                print("✅ Reply posted successfully")
                replied_users.add(row["username"])
                reply_count += 1
                time.sleep(REPLY_DELAY)
            else:
                print("❌ Failed to post reply")
                failed_count += 1
                time.sleep(5)
            
            # Track reply
            replies_data.append({
                "username": row["username"],
                "reply_text": reply_text,
                "success": success
            })
            log_progress("RUNNING", 50 + (reply_count/REPLY_LIMIT*40), total_comments, reply_count, f"Engaged with {row['username']}")
    else:
        print("ℹ️ No comments available for replies")

    # =====================================================
    # FINAL LOGS
    # =====================================================
    print("\n================ FINAL LOGS ================\n")
    print(f"📊 Total comments found       : {total_comments}")
    print(f"🕐 Comments last 1 hour       : {last_1h}")
    print(f"🕘 Comments last 24 hours     : {last_24h}")
    print("\n🎉 DONE")

    driver.quit()

    # Output JSON result for backend to parse
    import json
    
    # Prepare comments data for output
    comments_data = []
    if not df.empty:
        for _, row in df.iterrows():
            comments_data.append({
                "post_url": row["post_url"],
                "username": row["username"],
                "comment": row["comment"],
                "time": row.get("time_raw", "")
            })
    
    result = {
        "success": True,
        "totalComments": total_comments,
        "totalReplies": reply_count,
        "comments": comments_data,
        "replies": replies_data,
        "stats": {
            "last_1h": last_1h,
            "last_24h": last_24h,
            "failed": failed_count
        }
    }
    print("\n" + json.dumps(result))


