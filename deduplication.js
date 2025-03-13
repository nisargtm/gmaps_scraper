const fs = require('fs');

function removeDuplicateBusinesses(filePath = 'businesses2.json') {
    try {
        // 1. Read the JSON file
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        const data = JSON.parse(fileContent);

        // Check if the file has the businesses array
        if (!data || !Array.isArray(data.businesses)) {
            console.warn("The JSON file doesn't have the expected structure or 'businesses' array is missing/not an array.");
            return; // Exit if the file structure is not as expected.
        }

        const totalEntries = data.businesses.length; // Log total entries before processing

        // 2. Create a Set to store unique business identifiers
        const uniqueBusinesses = new Map(); // Use a Map to preserve the order
        const uniqueBusinessList = [];

        // 3. Iterate through the businesses and identify duplicates
        for (const business of data.businesses) {
            // Create a unique identifier for each business
            const identifier = `${business.title}-${business.address}`;

            if (!uniqueBusinesses.has(identifier)) {
                uniqueBusinesses.set(identifier, business); // Add to the Map
                uniqueBusinessList.push(business);       // Add to the new list.
            } else {
                console.log(`Duplicate found and removed: ${business.title} - ${business.address}`);
            }
        }

        // 4. Overwrite the original array with the unique entries
        data.businesses = uniqueBusinessList;

        // 5. Write the updated JSON back to the file
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');

        const totalUniqueEntries = uniqueBusinesses.size; // Log total unique entries after processing

        console.log(`Successfully removed duplicates from ${filePath}.`);
        console.log(`Total entries before processing: ${totalEntries}`);
        console.log(`Total unique entries after processing: ${totalUniqueEntries}`);

    } catch (error) {
        console.error(`An error occurred: ${error}`);
    }
}

// Example usage:
removeDuplicateBusinesses(); // Uses the default file path 'businesses.json'

// To use with a different file path:
// removeDuplicateBusinesses('my_other_file.json');