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
from groq import Groq

# =====================================================
# CONFIG
# =====================================================
REPLY_DELAY = 60
SCROLL_ROUNDS = 10
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

def setup_driver(headless=False):
    options = uc.ChromeOptions()
    if headless:
        options.add_argument("--headless")
    options.add_argument("--start-maximized")
    options.add_argument(f"--user-data-dir={PROFILE_PATH}")
    options.add_argument("--disable-blink-features=AutomationControlled")
    driver = uc.Chrome(options=options)
    driver.execute_script("Object.defineProperty(navigator,'webdriver',{get:()=>undefined})")
    return driver

# =====================================================
# HELPERS
# =====================================================
def google_search(driver, keyword, google_pages):
    driver.get("https://www.google.com")
    time.sleep(3)
    try:
        driver.find_element(By.XPATH, "//button[contains(text(),'Accept')]").click()
    except:
        pass
    q = driver.find_element(By.NAME, "q")
    q.send_keys(f'(site:twitter.com OR site:x.com) "{keyword}" "status"')
    q.send_keys(Keys.RETURN)
    time.sleep(4)
    links = set()
    for page in range(google_pages):
        log_progress("searching", int((page / google_pages) * 30), 0, 0, f"Google page {page+1}")
        for a in driver.find_elements(By.XPATH, "//a[@href]"):
            href = a.get_attribute("href")
            if href and "twitter.com" in href and "/status/" in href:
                links.add(href.split("?")[0])
        try:
            driver.find_element(By.ID, "pnnext").click()
            time.sleep(3)
        except:
            break
    return list(links)

def load_all_replies(driver, max_rounds=SCROLL_ROUNDS):
    last = 0
    for _ in range(max_rounds):
        driver.execute_script("window.scrollBy(0, 900)")
        time.sleep(1.5)
        tweets = driver.find_elements(By.XPATH, "//article[@data-testid='tweet']")
        if len(tweets) == last:
            break
        last = len(tweets)
    return tweets

def parse_replies(blocks, url):
    data = []
    for block in blocks:
        try:
            comment = block.find_element(By.XPATH, ".//div[@data-testid='tweetText']").text.strip()
            if len(comment) < 5: continue
            username = block.find_element(By.XPATH, ".//div[@dir='ltr']/span").text.strip()
            # Try to find reply button
            reply_btn = block.find_element(By.XPATH, ".//div[@data-testid='reply']")
            data.append({
                "platform": "Twitter",
                "post_url": url,
                "username": username,
                "comment": comment,
                "block": block,
                "reply_btn": reply_btn
            })
        except: continue
    return data

# =====================================================
# REPLY LOGIC
# =====================================================
def generate_reply(groq_client, username, comment):
    prompt = f"Reply casually and naturally to this tweet.\n\nUser: {username}\nTweet: {comment}\n\nOne short sentence. No hashtags. Human."
    try:
        r = groq_client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.7
        )
        return r.choices[0].message.content.strip()
    except:
        return f"Interesting point, {username}!"

def post_twitter_reply(driver, reply_btn, reply_text):
    try:
        driver.execute_script("arguments[0].click();", reply_btn)
        time.sleep(2)
        editor = WebDriverWait(driver, 6).until(EC.presence_of_element_located((By.XPATH, "//div[@data-testid='tweetTextarea_0']")))
        editor.click()
        for ch in reply_text:
            editor.send_keys(ch)
            time.sleep(0.04)
        submit_btn = driver.find_element(By.XPATH, "//div[@data-testid='tweetButton']")
        driver.execute_script("arguments[0].click();", submit_btn)
        time.sleep(2)
        return True
    except Exception as e:
        print(f"Twitter reply error: {e}")
        return False

# =====================================================
# MAIN
# =====================================================
def main():
    parser = argparse.ArgumentParser(description='Twitter Scraper')
    parser.add_argument('--api-key', required=True, help='Groq API Key')
    parser.add_argument('--keyword', required=True, help='Search keyword')
    parser.add_argument('--google-pages', type=int, default=2, help='Google pages to scrape')
    parser.add_argument('--reply-limit', type=int, default=5, help='Max replies')
    parser.add_argument('--job-id', required=True, help='Job ID')
    parser.add_argument('--headless', action='store_true', help='Run headless')
    
    args = parser.parse_args()
    driver = setup_driver(args.headless)
    groq_client = Groq(api_key=args.api_key)
    
    try:
        log_progress("running", 5, 0, 0, "Starting Twitter scraper")
        urls = google_search(driver, args.keyword, args.google_pages)
        log_progress("running", 30, 0, 0, f"Found {len(urls)} tweets")
        
        all_comments = []
        replies_data = []
        reply_count = 0
        
        for i, url in enumerate(urls[:10]):
            progress = 30 + int((i / 10) * 40)
            log_progress("running", progress, len(all_comments), reply_count, f"Processing tweet {i+1}")
            
            driver.get(url)
            time.sleep(5)
            blocks = load_all_replies(driver)
            parsed = parse_replies(blocks, url)
            all_comments.extend(parsed)
            
            for row in parsed:
                if reply_count < args.reply_limit:
                    reply_text = generate_reply(groq_client, row["username"], row["comment"])
                    success = post_twitter_reply(driver, row["reply_btn"], reply_text)
                    if success:
                        reply_count += 1
                        replies_data.append({"username": row["username"], "reply_text": reply_text, "success": True})
                        time.sleep(REPLY_DELAY)
                    else:
                        replies_data.append({"username": row["username"], "reply_text": reply_text, "success": False})
        
        comments_output = [{"post_url": c["post_url"], "username": c["username"], "comment": c["comment"]} for c in all_comments]
        
        result = {
            "success": True,
            "jobId": args.job_id,
            "platform": "TWITTER",
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
