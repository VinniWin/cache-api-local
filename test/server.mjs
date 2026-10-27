import { createServer } from "node:http";

/** Local JSON server that counts hits. `state.failing = true` makes it answer 500. Paths under `/slow` answer after 50 ms. */
export async function startServer() {
  const state = { hits: 0, failing: false };
  const server = createServer(async (req, res) => {
    state.hits++;
    if (req.url.startsWith("/slow")) await sleep(50);
    if (state.failing) {
      res.statusCode = 500;
      return res.end();
    }
    res.setHeader("content-type", "application/json");
    res.end(req.url === "/zero" ? "0" : JSON.stringify({ n: state.hits, method: req.method }));
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));

  return {
    state,
    url: `http://127.0.0.1:${server.address().port}`,
    reset() {
      state.hits = 0;
      state.failing = false;
    },
    close() {
      server.closeAllConnections();
      server.close();
    },
  };
}

export const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
