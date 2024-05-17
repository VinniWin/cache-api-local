# Installation

    npm install cache-api-local

## Coding Example

```javascript
import CacheApi from "cache-api-local";

const ss = new CacheApi("https://jsonplaceholder.typicode.com", "data", 100);
                        
ss.getData("/photos/1?t=12", "photo");
```

# Props

new CacheApi(baseUrl,saveFolderName,revalidate_time_in_sec)