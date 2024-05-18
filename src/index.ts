import * as fs from "fs";
import * as path from "path";

class CacheApi {
  /**
   * Base API URL used for making requests.
   */
  private basePath: string;

  /**
   * Directory path where cached data will be stored.
   */
  private saveFolderName: string;

  /**
   * Maximum age of cache files in seconds. If set, cached files older than this age will be refetched.
   * If not set, cached files are stored indefinitely.
   */
  private maxAge?: number;

  /**
   * Creates an instance of CacheApi.
   * @param basePath - The base URL for the API requests.
   * @param saveFolderName - The filesystem path where responses will be cached.
   * @param maxAge - Optional maximum age in seconds for the cache validity.
   */
  constructor(basePath: string, saveFolderName: string, maxAge?: number) {
    this.basePath = basePath;
    this.saveFolderName = saveFolderName;
    this.maxAge = maxAge;
  }

  private sanitizeFilename(input: string): string {
    // Matches disallowed characters and replaces them with '_'
    let filename = input.replace(/[\/*?:"<>|\\]/g, "_").replace(/\s+/g, "_");

    // Remove leading underscores
    filename = filename.replace(/^_+/, "");

    return filename;
  }

  async getData(
    urlPath: string,
    folderName: string,
    option: RequestInit = {},
    skipCheck: boolean = false
  ): Promise<any> {
    const url = `${this.basePath}/${urlPath}`;
    const folderPath = path.join(this.saveFolderName, folderName);
    const fileName =
      decodeURIComponent(this.sanitizeFilename(urlPath)) + ".json";
    const filePath = path.join(folderPath, fileName);
    const metaDataPath = path.join(
      folderPath,
      decodeURIComponent(this.sanitizeFilename(urlPath)) + ".meta.json"
    );

    if (!skipCheck) {
      return await this.checkExistFileAndServeCache(
        folderPath,
        filePath,
        metaDataPath,
        urlPath,
        folderName
      );
    }
    try {
      const response = await fetch(url, option);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      if (data) {
        this.saveData(filePath, data, metaDataPath);
      }
      return data;
    } catch (error) {
      const fileContents = fs.readFileSync(filePath, "utf-8");
      if (fileContents) {
        return JSON.parse(fileContents);
      } //if file exist and give error serve file
      console.error("Failed to fetch and save data:", error);
      throw error;
    }
  }

  private async checkExistFileAndServeCache(
    folderPath: string,
    filePath: string,
    metaDataPath: string,
    url: string,
    folderName: string
  ) {
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
    }

    if (fs.existsSync(filePath)) {
      if (this.maxAge) {
        if (fs.existsSync(metaDataPath)) {
          try {
            const metaData = JSON.parse(
              fs.readFileSync(metaDataPath, "utf-8")
            ) as { lastFetched: number };
            const timestamp = new Date().getTime();
            const diff = Math.abs(
              Number(
                this.diff_in_unit(timestamp, metaData.lastFetched, "seconds")
              )
            );
            if (diff < this.maxAge) {
              const fileContents = fs.readFileSync(filePath, "utf-8");
              return JSON.parse(fileContents);
            } else {
              return await this.getData(url, folderName, {}, true);
            }
          } catch (error) {
            const fileContents = fs.readFileSync(filePath, "utf-8");
            if (fileContents) {
              return JSON.parse(fileContents);
            } //if file exist and give error serve file
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
    } else {
      return await this.getData(url, folderName, {}, true);
    }
  }

  private async saveData(filePath: string, data: any, metaDataPath: string) {
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
      const metaData = { lastFetched: new Date().getTime() };
      fs.writeFileSync(
        metaDataPath,
        JSON.stringify(metaData, null, 2),
        "utf-8"
      );
    } catch (error) {
      console.error("Failed while saving data:", error);
      throw error;
    }
  }

  private diff_in_unit(
    timestamp: number,
    metaData: number,
    unit: "seconds" | "minutes" | "hours" | "days" = "seconds"
  ) {
    // Convert milliseconds to base units (seconds)
    let timestamp_seconds = timestamp / 1000;
    let sec_seconds = metaData / 1000;

    // Calculate the difference in seconds
    let difference = timestamp_seconds - sec_seconds;

    // Handle unit conversion
    switch (unit.toLowerCase()) {
      case "seconds":
        return difference.toFixed(2);
      case "minutes":
        let minutes = difference / 60;
        return minutes.toFixed(2);
      case "hours":
        let hours = difference / (60 * 60);
        return hours.toFixed(2);
      case "days":
        let days = difference / (60 * 60 * 24);
        return days.toFixed(2);
      default:
        throw new Error("Invalid unit: " + unit);
    }
  }
}

export default CacheApi ;