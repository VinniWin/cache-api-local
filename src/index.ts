import * as fs from 'fs';
import * as path from 'path';

export class CacheApi {
  basePath: string;
  savePath: string;
  maxAge?: number;  // Make maxAge optional and undefined by default

  constructor(basePath: string, savePath: string, maxAge?: number) {
    this.basePath = basePath;
    this.savePath = savePath;
    this.maxAge = maxAge; // maxAge is optional; if not provided, cache indefinitely
  }

  async get(
    urlPath: string,
    folderName: string,
    option: RequestInit = {}
  ): Promise<any> {
    const url = `${this.basePath}/${urlPath}`;
    const folderPath = path.join(this.savePath, folderName);
    const fileName = encodeURIComponent(urlPath) + ".json";
    const filePath = path.join(folderPath, fileName);
    const metaDataPath = path.join(folderPath, encodeURIComponent(urlPath) + ".meta.json");

    // Ensure the directory exists
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
    }

    if (fs.existsSync(filePath)) {
      if (this.maxAge) {  // Check maxAge only if it is defined
        if (fs.existsSync(metaDataPath)) {
          try {
            const metaData = JSON.parse(fs.readFileSync(metaDataPath, "utf-8"));
            const now = new Date().getTime();
            const lastFetched = new Date(metaData.lastFetched).getTime();
            if ((now - lastFetched) < this.maxAge * 1000) {
              const fileContents = fs.readFileSync(filePath, "utf-8");
              return JSON.parse(fileContents);  // Return the cached JSON data if within maxAge
            }
          } catch (error) {
            console.error("Failed to read or parse meta file:", error);
            // Proceed to fetch new data if error occurs
          }
        }
      } else {
        try {
          const fileContents = fs.readFileSync(filePath, "utf-8");
          return JSON.parse(fileContents);  // Return the cached JSON data indefinitely
        } catch (error) {
          console.error("Failed to read from cache file:", error);
          throw error;
        }
      }
    }

    // Fetch new data if the cache is not fresh or no cache exists
    try {
      const response = await fetch(url, option);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();

      // Save the fetched data and the current timestamp to the cache
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
      const metaData = { lastFetched: new Date().toISOString() };
      fs.writeFileSync(metaDataPath, JSON.stringify(metaData, null, 2), "utf-8");

      return data;
    } catch (error) {
      console.error("Failed to fetch and save data:", error);
      throw error;
    }
  }
}
