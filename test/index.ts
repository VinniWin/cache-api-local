import { CacheApi } from "../src/local"

const ss=new CacheApi('https://jsonplaceholder.typicode.com','data',100)

ss.getData('/photos/1?t=12','photo')

