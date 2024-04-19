import { CacheApi } from "../src/index1"

const ss=new CacheApi('https://jsonplaceholder.typicode.com','./data')


ss.get('/photos/1?t=12','photo')