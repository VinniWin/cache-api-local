import * as fs from "fs";
import * as path from "path";

/**
 * Resolves the directory of the calling file.
 */
function getCallerFileDir(): string {
  const originalPrepareStackTrace = Error.prepareStackTrace;
  let callerFile: string | undefined;

  try {
    const err = new Error();
    Error.prepareStackTrace = (_, stack) => stack;
    const callSites = err.stack as unknown as NodeJS.CallSite[];

    if (callSites?.length > 2) {
      callerFile = callSites[2].getFileName() ?? undefined;
    }
  } catch (e) {
    console.error("Error determining caller directory:", e);
  } finally {
    Error.prepareStackTrace = originalPrepareStackTrace;
  }

  if (callerFile?.startsWith("file:///")) {
    let filePath = new URL(callerFile).pathname;
    if (process.platform === "win32" && filePath.startsWith("/")) {
      filePath = filePath.slice(1); // Remove leading slash on Windows
    }
    return path.dirname(filePath);
  }

  return callerFile ? path.dirname(callerFile) : process.cwd();
}

class CacheApi {
  readonly basePath: string;
  readonly actualBaseCachePath: string;
  readonly maxAge?: number;

  constructor(
    basePath: string,
    relativeCacheFolderName: string,
    maxAge?: number
  ) {
    this.basePath = basePath;
    const callerDir = getCallerFileDir();
    this.actualBaseCachePath = path.resolve(callerDir, relativeCacheFolderName);
    this.maxAge = maxAge;
  }

  private sanitizeFilename(input: string): string {
    return input
      .replace(/[\/*?:"<>|\\]/g, "_")
      .replace(/\s+/g, "_")
      .replace(/^_+/, "");
  }

  private readJSONSafe(filePath: string): any {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  private writeJSON(filePath: string, data: any) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  }

  private getFilePaths(urlPath: string, subFolder: string) {
    const fileName =
      this.sanitizeFilename(decodeURIComponent(urlPath)) + ".json";
    const dirPath = path.join(this.actualBaseCachePath, subFolder);
    return {
      dirPath,
      dataPath: path.join(dirPath, fileName),
      metaPath: path.join(dirPath, fileName.replace(".json", ".meta.json")),
    };
  }

  async getData(
    urlPath: string,
    subFolder: string,
    options: RequestInit = {},
    bypassCacheCheck = false
  ): Promise<any> {
    const fullUrl = `${this.basePath}/${urlPath}`;
    const { dirPath, dataPath, metaPath } = this.getFilePaths(
      urlPath,
      subFolder
    );

    if (!bypassCacheCheck) {
      const cache = this.checkAndReadFromCache(dataPath, metaPath);
      if (cache !== null) return cache;
    }

    try {
      const response = await fetch(fullUrl, options);
      if (!response.ok) throw new Error(`HTTP error: ${response.status}`);

      const data = await response.json();
      this.ensureDirExists(dirPath);
      this.writeJSON(dataPath, data);
      this.writeJSON(metaPath, { lastFetched: Date.now() });
      return data;
    } catch (err) {
      console.warn(`Fetch failed for ${fullUrl}, trying cache fallback...`);
      const fallback = this.readJSONSafe(dataPath);
      if (fallback) return fallback;
      console.error("Cache fallback also failed:", err);
      throw err;
    }
  }

  private checkAndReadFromCache(
    dataPath: string,
    metaPath: string
  ): any | null {
    if (!fs.existsSync(dataPath)) return null;

    if (!this.maxAge) return this.readJSONSafe(dataPath);

    const meta = this.readJSONSafe(metaPath);
    if (!meta?.lastFetched) return this.readJSONSafe(dataPath);

    const ageSeconds = (Date.now() - meta.lastFetched) / 1000;
    if (ageSeconds < this.maxAge) {
      return this.readJSONSafe(dataPath);
    }

    return null; // Cache is stale
  }

  private ensureDirExists(dir: string) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

export default CacheApi;
