# -*- coding: utf-8 -*-
import undetected_chromedriver as uc
import os
import sys
import time

# Force UTF-8 encoding for Windows console
if sys.platform == 'win32':
    import codecs
    sys.stdout = codecs.getwriter('utf-8')(sys.stdout.buffer, 'strict')
    sys.stderr = codecs.getwriter('utf-8')(sys.stderr.buffer, 'strict')

def setup_chrome_profile():
    """
    Opens Chrome with the persistent profile so you can log into social media accounts.
    Your logins will be saved and used by all scrapers.
    """
    print("=" * 60)
    print("CHROME PROFILE SETUP")
    print("=" * 60)
    print("\nThis will open Chrome with your persistent profile.")
    print("Please log into the following accounts:")
    print("  - Facebook (https://facebook.com)")
    print("  - Twitter/X (https://twitter.com)")
    print("  - LinkedIn (https://linkedin.com)")
    print("  - Reddit (https://reddit.com)")
    print("  - Google Account (for Chrome sync)")
    print("\nYour logins will be saved automatically.")
    print("Close the browser when done, or press Ctrl+C here.\n")
    print("=" * 60)
    
    # Get the chrome_profile directory path
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    CHROME_PROFILE_DIR = os.path.join(BASE_DIR, "chrome_profile")
    
    # Create profile directory if it doesn't exist
    os.makedirs(CHROME_PROFILE_DIR, exist_ok=True)
    
    print(f"\nProfile directory: {CHROME_PROFILE_DIR}")
    print("\nOpening Chrome...\n")
    
    try:
        # Setup Chrome options
        options = uc.ChromeOptions()
        options.add_argument(f"--user-data-dir={CHROME_PROFILE_DIR}")
        options.add_argument("--disable-blink-features=AutomationControlled")
        options.add_argument("--start-maximized")
        
        # Launch Chrome
        driver = uc.Chrome(options=options)
        driver.execute_script(
            "Object.defineProperty(navigator,'webdriver',{get:()=>undefined})"
        )
        
        # Open tabs for each social media platform
        print("Opening social media login pages...")
        
        # Facebook
        driver.get("https://www.facebook.com")
        time.sleep(2)
        
        # Twitter
        driver.execute_script("window.open('https://twitter.com', '_blank');")
        time.sleep(2)
        
        # LinkedIn
        driver.execute_script("window.open('https://www.linkedin.com', '_blank');")
        time.sleep(2)
        
        # Reddit
        driver.execute_script("window.open('https://www.reddit.com', '_blank');")
        time.sleep(2)
        
        # Google (for Chrome sync)
        driver.execute_script("window.open('https://accounts.google.com', '_blank');")
        
        print("\n" + "=" * 60)
        print("Chrome is now open with all login pages.")
        print("Please log into each account in the browser tabs.")
        print("Your sessions will be saved automatically.")
        print("Press Ctrl+C here when you're done logging in.")
        print("=" * 60 + "\n")
        
        # Keep the browser open until user interrupts
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            print("\n\nSaving profile and closing Chrome...")
            driver.quit()
            print("✓ Profile saved successfully!")
            print("✓ You can now run the scrapers with your logged-in accounts.\n")
            
    except Exception as e:
        print(f"\n✗ Error: {str(e)}")
        print("Make sure Chrome and undetected-chromedriver are properly installed.\n")
        return 1
    
    return 0

if __name__ == "__main__":
    exit_code = setup_chrome_profile()
    sys.exit(exit_code)
