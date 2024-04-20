import * as fs from "fs";
import * as path from "path";

/**
 * CacheApi handles caching of API responses to the filesystem. It allows fetching data and storing it locally,
 * with optional expiration based on age.
 */
class CacheApi {
  /**
   * Base API URL used for making requests.
   */
  private basePath: string;

  /**
   * Directory path where cached data will be stored.
   */
  private savePath: string;

  /**
   * Maximum age of cache files in seconds. If set, cached files older than this age will be refetched.
   * If not set, cached files are stored indefinitely.
   */
  private maxAge?: number;

  /**
   * Creates an instance of CacheApi.
   * @param basePath - The base URL for the API requests.
   * @param savePath - The filesystem path where responses will be cached.
   * @param maxAge - Optional maximum age in seconds for the cache validity.
   */
  constructor(basePath: string, savePath: string, maxAge?: number) {
    this.basePath = basePath;
    this.savePath = savePath;
    this.maxAge = maxAge;
  }

  private sanitizeFilename(input: string): string {
    // Matches disallowed characters and replaces them with '_'
    let filename = input.replace(/[\/*?:"<>|\\]/g, "_").replace(/\s+/g, "_");

    // Remove leading underscores
    filename = filename.replace(/^_+/, "");

    return filename;
  }

  /**
   * Fetches data from the API or cache based on the URL path and options provided.
   * If a valid cache exists and is within the specified maxAge, the cached data is returned.
   * Otherwise, data is fetched from the API and cached.
   *
   * @param urlPath - The API endpoint to fetch data from.
   * @param folderName - The folder within the savePath where the data should be cached.
   * @param option - Optional fetch request configuration.
   * @returns A Promise resolving to the fetched (or cached) data.
   */
  async get(
    urlPath: string,
    folderName: string,
    option: RequestInit = {}
  ): Promise<any> {
    const url = `${this.basePath}/${urlPath}`;
    const folderPath = path.join(this.savePath, folderName);
    const fileName =
      decodeURIComponent(this.sanitizeFilename(urlPath)) + ".json";
    const filePath = path.join(folderPath, fileName);
    const metaDataPath = path.join(
      folderPath,
      decodeURIComponent(this.sanitizeFilename(urlPath)) + ".meta.json"
    );

    // Ensure the directory exists
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
    }

    if (fs.existsSync(filePath)) {
      if (this.maxAge) {
        if (fs.existsSync(metaDataPath)) {
          try {
            const metaData = JSON.parse(fs.readFileSync(metaDataPath, "utf-8"));
            const now = new Date().getTime();
            const lastFetched = new Date(metaData.lastFetched).getTime();
            if (now - lastFetched < this.maxAge * 1000) {
              const fileContents = fs.readFileSync(filePath, "utf-8");
              return JSON.parse(fileContents);
            }
          } catch (error) {
            console.error("Failed to read or parse meta file:", error);
          }
        }
      } else {
        try {
          const fileContents = fs.readFileSync(filePath, "utf-8");
          return JSON.parse(fileContents);
        } catch (error) {
          console.error("Failed to read from cache file:", error);
          throw error;
        }
      }
    }

    try {
      const response = await fetch(url, option);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();

      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
      const metaData = { lastFetched: new Date().toISOString() };
      fs.writeFileSync(
        metaDataPath,
        JSON.stringify(metaData, null, 2),
        "utf-8"
      );

      return data;
    } catch (error) {
      console.error("Failed to fetch and save data:", error);
      throw error;
    }
  }
}

export { CacheApi };
