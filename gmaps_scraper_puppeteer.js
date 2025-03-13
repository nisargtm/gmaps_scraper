const start = performance.now();
const puppeteer = require('puppeteer-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

// Use stealth plugin
puppeteer.use(stealth());

const SAVE_INTERVAL = 1; // Save every 5 businesses scraped
const TEMP_FILE = 'businesses2_temp.json';
const FINAL_FILE = 'businesses2.json';
const VIEWPORT_WIDTH = 1280;
const VIEWPORT_HEIGHT = 800;

async function scrollResults(page) {
    /**Scroll dynamically until no new results appear*/
    let lastHeight = 0;
    // Use a more specific selector if needed
    const scrollableDivSelector = 'div[role="feed"]';

    while (true) {
      try {
        lastHeight = await page.evaluate(scrollableDivSelector => {
            const scrollableDiv = document.querySelector(scrollableDivSelector);
            if (!scrollableDiv) {
              return -1; // Indicate that the element is not found
            }
            const currentScrollHeight = scrollableDiv.scrollHeight;
            scrollableDiv.scrollTop = currentScrollHeight;
            return currentScrollHeight;
        }, scrollableDivSelector);

        if (lastHeight === -1) {
          console.warn("Scrollable div not found. Stopping scroll.");
          break;
        }

        await new Promise(resolve => setTimeout(resolve, 6000)); // Allow results to load

        let newHeight = await page.evaluate(scrollableDivSelector => {
            const scrollableDiv = document.querySelector(scrollableDivSelector);
            return scrollableDiv ? scrollableDiv.scrollHeight : -1;
        }, scrollableDivSelector);

        if (newHeight === -1) {
            console.warn("Scrollable div not found. Stopping scroll.");
            break;
          }


        if (newHeight === lastHeight) {
            // Stop if no new results are loaded
            break;
        }
      } catch (error) {
        console.error("Error during scrolling:", error);
        break;
      }
    }
}

async function scrapeBusinessDetails(pincodes) {
    console.log('Starting scraper with Puppeteer...');

    try {
        // Load existing data if it exists
        let allBusinesses = [];
        if (fs.existsSync(FINAL_FILE)) {
            try {
                const fileContent = fs.readFileSync(FINAL_FILE, 'utf-8');
                allBusinesses = JSON.parse(fileContent).businesses || [];
                console.log(`Loaded ${allBusinesses.length} existing businesses from ${FINAL_FILE}`);
            } catch (error) {
                console.warn(`Error loading existing data from ${FINAL_FILE}: ${error}. Starting with an empty list.`);
            }
        }

        // Function to save the data
        const saveData = () => {
            try {
              fs.writeFileSync(TEMP_FILE, JSON.stringify({ businesses: allBusinesses }, null, 2), 'utf-8');
              console.log(`Successfully saved ${allBusinesses.length} businesses to ${TEMP_FILE}`);
            } catch (err) {
              console.error(`Failed to save data: ${err}`);
            }
        };

        // Handle termination signals
        process.on('SIGINT', () => {
            console.log('Script terminated manually. Saving data...');
            saveData();
            process.exit();
        });

        // Handle unexpected errors
        process.on('uncaughtException', (err) => {
            console.error('Uncaught exception. Saving data...', err);
            saveData();
            process.exit(1);
        });

        const browser = await puppeteer.launch({
            headless: 'new', // Or false for debugging
            //headless:false,
            defaultViewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
        });


        for (const pincode of pincodes) {
            const page = await browser.newPage();
            let businesses = []; // Moved business array inside the pincode loop

            try {
                console.log('Opening Google Maps...');
                await page.goto('https://www.google.com/maps', { waitUntil: 'networkidle2' });

                console.log(`Searching for cafes in ${pincode}...`);
                const searchBoxSelector = '#searchboxinput';
                await page.waitForSelector(searchBoxSelector);
                await page.focus(searchBoxSelector);
                await page.keyboard.type(`cafes in ${pincode}`);

                const searchButtonSelector = '#searchbox-searchbutton';
                await page.waitForSelector(searchButtonSelector);
                await page.click(searchButtonSelector);

                console.log('Waiting for results...');
                await page.waitForSelector('div.Nv2PK', { timeout: 10000 });

                console.log('Scrolling to load all results...');
                await scrollResults(page);

                console.log(`Extracting business listings for ${pincode}...`);
                const elements = await page.$$('div.Nv2PK');
                console.log(`Found ${elements.length} businesses in ${pincode}`);

                for (let index = 0; index < elements.length; index++) {
                    try {
                        const element = elements[index];

                        const titleElement = await element.$('.fontHeadlineSmall');
                        const title = titleElement ? (await titleElement.evaluate(node => node.innerText)).trim() : 'No Title';
                        console.log(`\nScraping details for: ${title}`);

                        // Extract rating and reviews
                        let rating = 'No rating';
                        let reviews = 'No reviews';
                        try {
                            const ratingElement = await element.$('span.MW4etd');
                            rating = ratingElement ? (await ratingElement.evaluate(node => node.innerText)).trim() : 'No rating';
                            const reviewsElement = await element.$('span.UY7F9');
                            reviews = reviewsElement ? (await reviewsElement.evaluate(node => node.innerText)).replace('(', '').replace(')', '').trim() : 'No reviews';
                        } catch (error) {
                            // Keep default values
                            console.warn(`Couldn't extract rating or reviews for ${title}: ${error}`);
                        }

                        // Extract price, cuisine, and location details
                        let priceCategory = 'No price info';
                        let cuisineType = 'No cuisine info';
                        let location = 'No location info';
                        try {
                            const details = await element.$$('div.W4Efsd > div.W4Efsd > span.W4Efsd');
                            priceCategory = details[0] ? await details[0].evaluate(node => node.innerText) : 'No price info';
                            cuisineType = details[1] ? await details[1].evaluate(node => node.innerText) : 'No cuisine info';
                            location = details[2] ? await details[2].evaluate(node => node.innerText) : 'No location info';
                        } catch (error) {
                            // Keep default values
                            console.warn(`Couldn't extract price, cuisine, or location for ${title}: ${error}`);
                        }

                        // Click on business for more details
                        let retries = 3;
                        let address = 'No address found';
                        let phone = 'No phone found';
                        let clicked = false;

                        while (retries > 0) {
                            try {
                                await element.click();
                                clicked = true;

                                // Wait for the address button to appear
                                await page.waitForSelector('button[data-item-id*="address"]', { timeout: 10000 });
                                break; // Exit the retry loop if successful
                            } catch (error) {
                                retries--;
                                console.log(`Retrying to click on ${title} (${3 - retries}/3)`);
                                await new Promise(resolve => setTimeout(resolve, 1000));
                            }
                        }

                        // Extract address and phone (Re-find after click)
                        if (clicked) {
                            await new Promise(resolve => setTimeout(resolve, 2000)); // wait 2 seconds

                            try {
                                const addressElement = await page.$('button[data-item-id*="address"]');
                                address = addressElement ? await addressElement.evaluate(node => node.innerText) : 'No address found';
                            } catch (error) {
                                address = 'No address found';
                                console.warn(`Couldn't extract address for ${title}: ${error}`);
                            }

                            try {
                                const phoneElement = await page.$('button[data-item-id*="phone"]');
                                phone = phoneElement ? await phoneElement.evaluate(node => node.innerText) : 'No phone found';
                            } catch (error) {
                                phone = 'No phone found';
                                console.warn(`Couldn't extract phone for ${title}: ${error}`);
                            }

                          // Click close button to return to results
                        //   try {
                        //     // Attempt to click the close button using JavaScript
                        //     const closeButtonSelector = 'xpath///*[@id=\"QA0Szd\"]/div/div/div[1]/div[3]/div/div[1]/div/div/div[1]/div/div/div[3]/span/button/span/svg/path';
                        //     await page.waitForSelector(closeButtonSelector, { visible: true, timeout: 8000 });
                        //     await page.evaluate((selector) => {
                        //         const closeButton = document.querySelector(selector);
                        //         if (closeButton) {
                        //             closeButton.click();
                        //         }
                        //     }, closeButtonSelector);

                        //     // Wait for the results to reload.
                        //     await page.waitForSelector('div.Nv2PK', { timeout: 10000 });
                        //     console.log(`Returned to search results for ${title}`);
                        // } catch (error) {
                        //     console.log("⚠ Couldn't find or click close button:", error.message);
                        // }
                    }

                        // Store business data
                        const businessData = {
                            title: title,
                            rating: rating,
                            reviews: reviews,
                            price_category: priceCategory,
                            cuisine_type: cuisineType,
                            location: location,
                            address: address,
                            phone: phone,
                            pincode: pincode, // Include the pincode
                        };

                        businesses.push(businessData);
                        console.log(`✔ Successfully scraped: ${title}`);

                        allBusinesses.push(businessData);

                        // Periodically save data
                        if (allBusinesses.length % SAVE_INTERVAL === 0) {
                            saveData();
                        }

                    } catch (e) {
                        console.log(`⚠ Error scraping business: ${e}`);
                        continue;
                    }
                }
            } catch (error) {
                console.error(`Error scraping pincode ${pincode}: ${error}`);
            } finally {
                await page.close(); // Close the page after each pincode
            }
        }


        // Final write to JSON to ensure all data is saved
        saveData();
        fs.renameSync(TEMP_FILE, FINAL_FILE);
        console.log(`\n✅ Successfully scraped and saved ${allBusinesses.length} businesses across ${pincodes.length} pincodes to ${FINAL_FILE}.`);

        await browser.close(); // Close the browser after all pincodes
    } catch (e) {
        console.log(`❌ An error occurred: ${e}`);
    }
}

(async () => {
    // Vadodara city pincodes
    const pincodes = ['390001', '390002', '390004', '390006', '390007', '390008', '390009', '390010', '390011', '390012', '390014', '390015', '390016', '390017', '390018', '390019', '390020', '390022', '390023', '390024', '391310', '391740'];
    // const pincodes = ['390001'];
    await scrapeBusinessDetails(pincodes);
    const end = performance.now();
    console.log(`Execution time: ${(end - start)/60000} milliseconds`);
})();