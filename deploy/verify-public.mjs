const baseUrl = process.argv[2] ?? process.env.PUBLIC_BASE_URL;
const timeoutMs = 20_000;

if (!baseUrl) {
  throw new Error(
    "Usage: node deploy/verify-public.mjs https://example.com",
  );
}

const marketResponse = await fetch(
  `${baseUrl}/api/market?mode=VIRTUAL&page=1&pageSize=1`,
);
if (!marketResponse.ok) {
  throw new Error(`Market request failed: ${marketResponse.status}`);
}
const marketPayload = await marketResponse.json();
const instrumentId = marketPayload.data.items[0]?.instrument.id;
if (!instrumentId) {
  throw new Error("The virtual market did not return an instrument.");
}

for (const path of ["/", "/real", "/account"]) {
  const response = await fetch(`${baseUrl}${path}`);
  if (!response.ok) {
    throw new Error(`SPA route failed: ${path} -> ${response.status}`);
  }
  const html = await response.text();
  if (!html.includes('<div id="root"></div>')) {
    throw new Error(`SPA shell missing from ${path}.`);
  }
}

const socketUrl = new URL("/ws/market", baseUrl);
socketUrl.protocol = "wss:";
socketUrl.searchParams.set("mode", "VIRTUAL");
socketUrl.searchParams.set("instrumentId", instrumentId);

const socketResult = await new Promise((resolve, reject) => {
  const socket = new WebSocket(socketUrl);
  const timer = setTimeout(() => {
    socket.close();
    reject(new Error("WebSocket verification timed out."));
  }, timeoutMs);

  socket.addEventListener("message", (event) => {
    try {
      const message = JSON.parse(event.data);
      if (
        message.type !== "snapshot" ||
        !Array.isArray(message.data) ||
        message.data.length !== 1
      ) {
        return;
      }
      clearTimeout(timer);
      socket.close();
      resolve({
        messageType: message.type,
        quoteCount: message.data.length,
        instrumentId,
      });
    } catch (error) {
      clearTimeout(timer);
      socket.close();
      reject(error);
    }
  });
  socket.addEventListener("error", () => {
    clearTimeout(timer);
    reject(new Error("WebSocket connection failed."));
  });
});

console.log(
  JSON.stringify({
    baseUrl,
    spaRoutes: ["/", "/real", "/account"],
    websocket: socketResult,
  }),
);
