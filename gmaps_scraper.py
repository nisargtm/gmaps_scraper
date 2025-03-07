from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.common.exceptions import StaleElementReferenceException, NoSuchElementException, TimeoutException
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
import time
import json
import traceback

# List to store all business data
all_businesses = []

# Set up Chrome options
chrome_options = Options()
chrome_options.add_argument("--start-maximized")  # Start with maximized browser

# Initialize WebDriver
driver = webdriver.Chrome(options=chrome_options)

try:
    print("Opening Google Maps...")
    driver.get("https://www.google.com/maps")
    time.sleep(3)

    # Search for businesses
    print("Searching for businesses...")
    search_box = driver.find_element(By.ID, "searchboxinput")
    search_box.clear()
    search_box.send_keys("cafes in vadodara")  # Change this as needed
    search_box.send_keys(Keys.ENTER)
    time.sleep(5)  # Wait for results to load

    # Function to get fresh business elements
    def get_fresh_business_elements():
        """Get a fresh list of business elements to avoid stale references"""
        try:
            WebDriverWait(driver, 15).until(
                EC.presence_of_element_located((By.CSS_SELECTOR, 'div[role="feed"]'))
            )
            time.sleep(1)  # Short pause to ensure elements are loaded
            return WebDriverWait(driver, 15).until(
                EC.presence_of_all_elements_located((By.CSS_SELECTOR, 'div.Nv2PK'))
            )
        except Exception as e:
            print(f"⚠ Error getting fresh business elements: {e}")
            return []

    # Function to scroll and load more results
    def scroll_to_load_results():
        print("Starting to scroll for more results...")
        try:
            # Wait for the results container to be present
            scrollable_div = WebDriverWait(driver, 15).until(
                EC.presence_of_element_located((By.CSS_SELECTOR, 'div[role="feed"]'))
            )
            print("Found scrollable container")
        except Exception as e:
            print(f"⚠ Error finding scrollable area: {e}")
            return False
        
        previous_height = -1
        scroll_count = 0

        for i in range(20):  # Adjust this for more scrolling
            try:
                # Get current height
                current_height = driver.execute_script("return arguments[0].scrollHeight;", scrollable_div)
                
                # Scroll down in smaller increments
                driver.execute_script("arguments[0].scrollTop += 300;", scrollable_div)
                print(f"Scroll attempt {i+1}/20")
                time.sleep(3)  # Wait longer for results to load
                
                # Get new height
                new_height = driver.execute_script("return arguments[0].scrollHeight;", scrollable_div)
                
                # Check if we've reached the end
                if new_height == previous_height and i > 5:  # Allow a few scrolls before checking
                    print("No more results to load")
                    break
                
                previous_height = new_height
                scroll_count += 1
            except Exception as e:
                print(f"⚠ Error during scrolling: {e}")
                break

        print(f"✅ Finished scrolling ({scroll_count} scrolls), now scraping businesses...")
        return True

    # Function to safely click on a business element
    def safe_click_business(business_index):
        """Safely click on a business by index, handling stale elements"""
        max_attempts = 3
        for attempt in range(max_attempts):
            try:
                # Get fresh elements each time
                businesses = get_fresh_business_elements()
                if not businesses or business_index >= len(businesses):
                    print(f"⚠ Business index {business_index} out of range (total: {len(businesses) if businesses else 0})")
                    return False
                
                # Scroll the business into view
                driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", businesses[business_index])
                time.sleep(1)
                
                # Click the business
                businesses[business_index].click()
                print(f"Successfully clicked business at index {business_index}")
                time.sleep(3)  # Wait for details to load
                return True
            except StaleElementReferenceException:
                print(f"⚠ Stale element at attempt {attempt+1}/{max_attempts}, retrying...")
                time.sleep(2)
            except Exception as e:
                print(f"⚠ Error clicking business: {e}")
                if attempt == max_attempts - 1:
                    return False
                time.sleep(2)
        return False

    # Function to scrape business details
    def scrape_business_details():
        print("\nLooking for businesses to scrape...")
        
        # Get fresh business elements
        businesses = get_fresh_business_elements()
        
        if not businesses:
            print("⚠ No businesses found! Exiting scraping function.")
            return False
        
        print(f"Found {len(businesses)} businesses to scrape")
        
        # Keep track of processed businesses to avoid duplicates
        processed_names = set(b["name"] for b in all_businesses if b["name"] != "No name found")
        processed_indices = set()
        
        # Process each business
        for index in range(len(businesses)):
            if index in processed_indices:
                continue
                
            try:
                # Get business name before clicking if possible
                try:
                    # Get fresh elements to avoid stale references
                    fresh_businesses = get_fresh_business_elements()
                    if index >= len(fresh_businesses):
                        continue
                        
                    name_element = fresh_businesses[index].find_element(By.CSS_SELECTOR, 'div.fontHeadlineSmall')
                    business_name = name_element.text.strip()
                    
                    # Skip if already processed
                    if business_name in processed_names:
                        print(f"⚠ Skipping duplicate: {business_name}")
                        processed_indices.add(index)
                        continue
                        
                    print(f"Processing business {index+1}/{len(businesses)}: {business_name}")
                except:
                    business_name = f"Business #{index+1}"
                    print(f"Processing unnamed business {index+1}/{len(businesses)}")
                
                # Click on the business to view details
                if not safe_click_business(index):
                    print(f"⚠ Failed to click business at index {index}, skipping...")
                    continue
                    
                # Create a dictionary to store business data
                business_data = {
                    "name": business_name if business_name != f"Business #{index+1}" else "No name found",
                    "address": "No address found",
                    "phone": "No phone found",
                    "website": "No website found",
                    "rating": "No rating found",
                    "reviews": "No reviews found"
                }
                
                # Try to get the name again from the details page if needed
                if business_data["name"] == "No name found":
                    try:
                        name_element = WebDriverWait(driver, 5).until(
                            EC.presence_of_element_located((By.CSS_SELECTOR, 'h1[data-testid="place-title"]'))
                        )
                        business_data["name"] = name_element.text
                    except:
                        pass
                
                # Extract address
                try:
                    address_element = WebDriverWait(driver, 5).until(
                        EC.presence_of_element_located((By.CSS_SELECTOR, 'button[data-item-id*="address"]'))
                    )
                    business_data["address"] = address_element.text
                    print(f"Found address: {address_element.text[:30]}...")
                except:
                    print("No address found")
                
                # Extract phone number
                try:
                    phone_element = driver.find_element(By.CSS_SELECTOR, 'button[data-item-id*="phone"]')
                    business_data["phone"] = phone_element.text
                    print(f"Found phone: {phone_element.text}")
                except:
                    print("No phone found")
                
                # Extract website
                try:
                    website_element = driver.find_element(By.CSS_SELECTOR, 'a[data-item-id*="authority"]')
                    business_data["website"] = website_element.get_attribute("href")
                    print(f"Found website: {website_element.get_attribute('href')[:30]}...")
                except:
                    print("No website found")
                
                # Extract rating
                try:
                    rating_element = driver.find_element(By.CSS_SELECTOR, 'div.F7nice')
                    business_data["rating"] = rating_element.text
                    print(f"Found rating: {rating_element.text}")
                except:
                    print("No rating found")
                
                # Extract reviews count
                try:
                    reviews_element = driver.find_element(By.CSS_SELECTOR, 'span.F7nice')
                    business_data["reviews"] = reviews_element.text
                    print(f"Found reviews: {reviews_element.text}")
                except:
                    print("No reviews found")
                
                # Add business data to the list
                all_businesses.append(business_data)
                processed_names.add(business_data["name"])
                processed_indices.add(index)
                
                print(f"✔ Successfully scraped: {business_data['name']}")
                
                # Go back to results list
                try:
                    # Try multiple selectors for the back button
                    back_selectors = [
                        'button[jsaction*="back"]', 
                        'button[aria-label="Back"]',
                        'button.hYBOP',
                        'button[jsaction*="pane.back"]'
                    ]
                    
                    back_button = None
                    for selector in back_selectors:
                        try:
                            back_button = WebDriverWait(driver, 3).until(
                                EC.element_to_be_clickable((By.CSS_SELECTOR, selector))
                            )
                            if back_button:
                                break
                        except:
                            continue
                    
                    if back_button:
                        back_button.click()
                        print("Clicked back button")
                    else:
                        print("Back button not found, using history.go(-1)")
                        driver.execute_script("window.history.go(-1)")
                        
                    time.sleep(3)  # Wait longer for results to reload
                except Exception as e:
                    print(f"⚠ Error going back: {e}")
                    # Try alternative back method
                    try:
                        driver.execute_script("window.history.go(-1)")
                        print("Used history.go(-1) as fallback")
                        time.sleep(3)
                    except:
                        print("⚠ Failed to go back to results")
                        continue

            except Exception as e:
                print(f"⚠ Error processing business at index {index}: {e}")
                # Try to go back to results list
                try:
                    driver.execute_script("window.history.go(-1)")
                    time.sleep(3)
                except:
                    pass
                continue

        print("✅ All businesses in current view scraped successfully!")
        print(f"Total businesses scraped so far: {len(all_businesses)}")
        return True

    # Function to pan the map to get more results
    def pan_map(direction):
        """Move the Google Maps view in a specified direction to load more businesses"""
        try:
            print(f"Panning map {direction}...")
            WebDriverWait(driver, 10).until(EC.presence_of_element_located((By.CSS_SELECTOR, "canvas")))
            map_element = driver.find_element(By.CSS_SELECTOR, "canvas")
            
            actions = webdriver.ActionChains(driver)
            move_distance = 300  # Adjust for larger/smaller steps
            
            if direction == "left":
                actions.move_to_element_with_offset(map_element, move_distance, 0).click_and_hold().move_by_offset(-move_distance, 0).release().perform()
            elif direction == "right":
                actions.move_to_element_with_offset(map_element, -move_distance, 0).click_and_hold().move_by_offset(move_distance, 0).release().perform()
            elif direction == "up":
                actions.move_to_element_with_offset(map_element, 0, move_distance).click_and_hold().move_by_offset(0, -move_distance).release().perform()
            elif direction == "down":
                actions.move_to_element_with_offset(map_element, 0, -move_distance).click_and_hold().move_by_offset(0, move_distance).release().perform()
            
            print(f"Panned map {direction}")
            time.sleep(3)  # Wait after panning to allow new results to load
            return True
        
        except Exception as e:
            print(f"⚠ Error in pan_map: {e}")
            return False

    # Execute the functions
    print("\n--- STARTING SCRAPING PROCESS ---\n")
    
    # Step 1: Scroll to load businesses
    scroll_success = scroll_to_load_results()
    
    # Step 2: Scrape businesses
    if scroll_success:
        scrape_success = scrape_business_details()
    else:
        scrape_success = False
        
    # Step 3: Pan the map in different directions and scrape again
    #if scrape_success:
     #   for direction in ["right", "down", "left", "up"]:
      #      print(f"\n--- PANNING MAP {direction.upper()} ---\n")
       #     if pan_map(direction):
        #        scroll_to_load_results()
         #       scrape_business_details()

    # Export data to JSON file
    try:
        if all_businesses:
            with open("businesses.json", "w", encoding="utf-8") as f:
                json.dump({"businesses": all_businesses}, f, indent=4, ensure_ascii=False)
            print(f"\n✅ Successfully exported {len(all_businesses)} businesses to businesses.json")
        else:
            print("\n⚠ No businesses were scraped, nothing to export.")
    except Exception as e:
        print(f"\n⚠ Error exporting to JSON: {e}")

except Exception as e:
    print(f"⚠ An unexpected error occurred: {e}")

finally:
    # Close browser
    print("\nClosing browser...")
    driver.quit()
    print("Browser closed")