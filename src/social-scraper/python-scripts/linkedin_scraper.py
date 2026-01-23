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
REPLY_DELAY = 45
SCROLL_ROUNDS = 6
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
    driver.execute_script(
        "Object.defineProperty(navigator,'webdriver',{get:()=>undefined})"
    )
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
    q.send_keys(f'site:linkedin.com/posts "{keyword}"')
    q.send_keys(Keys.RETURN)
    time.sleep(4)
    
    links = set()
    for page in range(google_pages):
        log_progress("searching", int((page / google_pages) * 30), 0, 0, f"Google page {page+1}")
        for a in driver.find_elements(By.XPATH, "//a[@href]"):
            href = a.get_attribute("href")
            if href and href.startswith("https://www.linkedin.com/posts/") and "google" not in href:
                links.add(href.split("?")[0])
        try:
            driver.find_element(By.ID, "pnnext").click()
            time.sleep(3)
        except:
            break
    return list(links)

def open_linkedin_comments(driver):
    try:
        btn = WebDriverWait(driver, 8).until(
            EC.element_to_be_clickable((By.XPATH, "//button[contains(@aria-label,'Comment')]"))
        )
        driver.execute_script("arguments[0].click();", btn)
        time.sleep(3)
    except:
        pass

def load_all_linkedin_comments(driver, max_rounds=SCROLL_ROUNDS):
    last_count = 0
    for _ in range(max_rounds):
        driver.execute_script("window.scrollBy(0, 900);")
        time.sleep(1.2)
        for btn in driver.find_elements(By.XPATH, "//button[contains(.,'Load') or contains(.,'See previous')]"):
            try:
                driver.execute_script("arguments[0].click();", btn)
                time.sleep(0.8)
            except:
                pass
        comments = driver.find_elements(By.XPATH, "//article[contains(@class,'comments-comment-entity')]")
        if len(comments) == last_count:
            break
        last_count = len(comments)
    return comments

def parse_comments(blocks, post_url):
    data = []
    for block in blocks:
        try:
            username = block.find_element(By.XPATH, ".//span[contains(@class,'comments-comment-meta__description-title')]").text.strip()
            comment = block.find_element(By.XPATH, ".//span[contains(@class,'comments-comment-item__main-content')]//span[@dir='ltr']").text.strip()
            try:
                time_raw = block.find_element(By.XPATH, ".//time[contains(@class,'comments-comment-meta__data')]").text.strip()
            except:
                time_raw = None
            if len(comment) < 5: continue
            data.append({
                "platform": "LinkedIn",
                "post_url": post_url,
                "username": username,
                "comment": comment,
                "time_str": time_raw,
                "block": block
            })
        except: continue
    return data

# =====================================================
# REPLY LOGIC
# =====================================================
def generate_reply(groq_client, username, comment):
    prompt = f"Reply professionally and naturally to this LinkedIn comment.\n\nUser: {username}\nComment: {comment}\n\nOne short sentence. No emojis. No links. Human."
    try:
        r = groq_client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.6
        )
        return r.choices[0].message.content.strip()
    except:
        return f"Great insights, {username}!"

def post_linkedin_reply(driver, block, reply_text):
    try:
        reply_btn = block.find_element(By.XPATH, ".//button[contains(@class,'comments-comment-social-bar__reply-action-button')]")
        driver.execute_script("arguments[0].click();", reply_btn)
        time.sleep(2)
        reply_container = WebDriverWait(block, 6).until(EC.presence_of_element_located((By.XPATH, ".//div[contains(@class,'comments-comment-box--reply')]")))
        editor = reply_container.find_element(By.XPATH, ".//div[contains(@class,'ql-editor') and @contenteditable='true']")
        editor.click()
        editor.send_keys(Keys.END)
        time.sleep(0.3)
        for ch in reply_text:
            editor.send_keys(ch)
            time.sleep(0.04)
        submit_btn = reply_container.find_element(By.XPATH, ".//button[contains(@class,'comments-comment-box__submit-button')]")
        driver.execute_script("arguments[0].click();", submit_btn)
        return True
    except Exception as e:
        print(f"LinkedIn reply error: {e}")
        return False

# =====================================================
# MAIN
# =====================================================
def main():
    parser = argparse.ArgumentParser(description='LinkedIn Scraper')
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
        log_progress("running", 5, 0, 0, "Starting LinkedIn scraper")
        urls = google_search(driver, args.keyword, args.google_pages)
        log_progress("running", 30, 0, 0, f"Found {len(urls)} posts")
        
        all_comments = []
        replies_data = []
        reply_count = 0
        
        for i, url in enumerate(urls[:10]):
            progress = 30 + int((i / 10) * 40)
            log_progress("running", progress, len(all_comments), reply_count, f"Processing post {i+1}")
            
            driver.get(url)
            time.sleep(5)
            open_linkedin_comments(driver)
            blocks = load_all_linkedin_comments(driver)
            parsed = parse_comments(blocks, url)
            all_comments.extend(parsed)
            
            # Attempt replies if under limit
            for row in parsed:
                if reply_count < args.reply_limit:
                    reply_text = generate_reply(groq_client, row["username"], row["comment"])
                    success = post_linkedin_reply(driver, row["block"], reply_text)
                    if success:
                        reply_count += 1
                        replies_data.append({"username": row["username"], "reply_text": reply_text, "success": True})
                        time.sleep(REPLY_DELAY)
                    else:
                        replies_data.append({"username": row["username"], "reply_text": reply_text, "success": False})
        
        comments_output = [{"post_url": c["post_url"], "username": c["username"], "comment": c["comment"], "time": c["time_str"]} for c in all_comments]
        
        result = {
            "success": True,
            "jobId": args.job_id,
            "platform": "LINKEDIN",
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
