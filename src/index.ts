import * as fs from "fs";
import * as path from "path";

class CacheApi {
  private basePath: string;
  private saveFolderName: string;
  private maxAge?: number;

  constructor(basePath: string, saveFolderName: string, maxAge?: number) {
    this.basePath = basePath;
    this.saveFolderName = saveFolderName;
    this.maxAge = maxAge;
  }

  private sanitizeFilename(input: string): string {
    return input.replace(/[\/*?:"<>|\\]/g, "_").replace(/\s+/g, "_").replace(/^_+/, "");
  }

  async getData(urlPath: string, folderName: string, option: RequestInit = {}, skipCheck: boolean = false): Promise<any> {
    const url = `${this.basePath}/${urlPath}`;
    const folderPath = path.join(this.saveFolderName, folderName);
    const fileName = decodeURIComponent(this.sanitizeFilename(urlPath)) + ".json";
    const filePath = path.join(folderPath, fileName);
    const metaDataPath = path.join(folderPath, decodeURIComponent(this.sanitizeFilename(urlPath)) + ".meta.json");

    if (!skipCheck) {
      return await this.checkExistFileAndServeCache(folderPath, filePath, metaDataPath, urlPath, folderName);
    }

    try {
      const response = await fetch(url, option);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

      const data = await response.json();
      if (data) this.saveData(filePath, data, metaDataPath);
      return data;
    } catch (error) {
      if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf-8"));
      console.error("Failed to fetch and save data:", error);
      throw error;
    }
  }

  private async checkExistFileAndServeCache(folderPath: string, filePath: string, metaDataPath: string, url: string, folderName: string) {
    if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath, { recursive: true });

    if (fs.existsSync(filePath)) {
      if (this.maxAge && fs.existsSync(metaDataPath)) {
        try {
          const metaData = JSON.parse(fs.readFileSync(metaDataPath, "utf-8")) as { lastFetched: number };
          const timestamp = Date.now();
          const diff = (timestamp - metaData.lastFetched) / 1000;
          if (diff < this.maxAge) return JSON.parse(fs.readFileSync(filePath, "utf-8"));
          return await this.getData(url, folderName, {}, true);
        } catch (error) {
          if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf-8"));
          console.error("Failed to read or parse meta file:", error);
        }
      } else {
        return JSON.parse(fs.readFileSync(filePath, "utf-8"));
      }
    }

    return await this.getData(url, folderName, {}, true);
  }

  private saveData(filePath: string, data: any, metaDataPath: string) {
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
      fs.writeFileSync(metaDataPath, JSON.stringify({ lastFetched: Date.now() }, null, 2), "utf-8");
    } catch (error) {
      console.error("Failed while saving data:", error);
      throw error;
    }
  }
}

export default CacheApi;
