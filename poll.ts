// --- Constants ---

const LOGIN_URL =
  "https://api-bitlab2.bitlabenterprise.com.br/v1/login/resultados";
const EXAMES_URL =
  "https://api-bitlab2.bitlabenterprise.com.br/v1/resultados/exames/detalhes";

const LOGIN_USER = process.env.LOGIN_USER;
const LOGIN_PASSWORD = process.env.LOGIN_PASSWORD;

if (!LOGIN_USER || !LOGIN_PASSWORD) {
  console.error("ERROR: LOGIN_USER and LOGIN_PASSWORD must be set in .env");
  process.exit(1);
}

const EXAMES_BODY = JSON.stringify({
  posto: 1,
  requisicao: 287037,
  convenio: 1,
});

const SHARED_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  Accept: "*/*",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  Origin: "https://bitlabenterprise.com.br",
  Referer: "https://bitlabenterprise.com.br/",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.2 Safari/605.1.15",
  "device-os": "Web",
  "device-type": "resultados",
  "device-version": "1.0.0, pasteursc",
  codbanco: "47",
};

// --- Login ---

interface LoginResponse {
  userToken: {
    token: string;
    expires: string;
    userName: string;
  };
}

async function login(): Promise<string> {
  console.log("Logging in...");

  const response = await fetch(LOGIN_URL, {
    method: "POST",
    headers: SHARED_HEADERS,
    body: JSON.stringify({ userName: LOGIN_USER, password: LOGIN_PASSWORD }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Login failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as LoginResponse;
  const token = data.userToken.token;
  const expires = data.userToken.expires;

  console.log(`Logged in as ${data.userToken.userName}`);
  console.log(`Token expires: ${expires}\n`);

  return token;
}

// --- Poll exames ---

interface PollResult {
  status: number;
  deStatusWeb: string | null;
  raw: unknown;
}

async function pollExames(token: string): Promise<PollResult> {
  const response = await fetch(EXAMES_URL, {
    method: "POST",
    headers: {
      ...SHARED_HEADERS,
      Authorization: `Bearer ${token}`,
    },
    body: EXAMES_BODY,
  });

  if (response.status === 401) {
    return { status: 401, deStatusWeb: null, raw: null };
  }

  const data = await response.json();

  // Search for deStatusWeb in the response (could be array or object, possibly nested)
  const items = Array.isArray(data) ? data : [data];

  for (const item of items) {
    const statusValue = item.deStatusWeb ?? item.destatusweb;
    if (statusValue) {
      return { status: response.status, deStatusWeb: statusValue, raw: data };
    }
  }

  // Fallback: regex search in serialized JSON
  const json = JSON.stringify(data);
  const match = json.match(/"deStatusWeb"\s*:\s*"([^"]+)"/i);

  return {
    status: response.status,
    deStatusWeb: match ? match[1] : null,
    raw: data,
  };
}

// --- Pushover notification ---

async function sendPushover(message: string): Promise<void> {
  const user = process.env.PUSHOVER_USER;
  const token = process.env.PUSHOVER_TOKEN;

  if (!user || !token) {
    console.error(
      "WARNING: PUSHOVER_USER or PUSHOVER_TOKEN not set. Skipping notification."
    );
    return;
  }

  const response = await fetch("https://api.pushover.net/1/messages.json", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token,
      user,
      title: "Exame Status Changed",
      message,
      priority: 1,
      sound: "persistent",
    }),
  });

  if (response.ok) {
    console.log("Pushover notification sent.");
  } else {
    const text = await response.text();
    console.error(`Pushover error (${response.status}): ${text}`);
  }
}

// --- Main ---

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const TEST_MODE = process.argv.includes("-t");

async function main() {
  // In test mode, just send a fake notification and exit
  if (TEST_MODE) {
    console.log("=== TEST MODE ===\n");
    console.log("Simulating status change...");
    await sendPushover(
      `[TEST] Exam status changed from "Em Andamento" to "Liberado"`
    );
    process.exit(0);
  }

  const intervalMinutes = parseInt(process.argv[2] ?? "30", 10);
  const intervalMs = intervalMinutes * 60 * 1000;

  console.log("=== Pasteus Pass - Exam Status Poller ===\n");
  console.log(`Poll interval: ${intervalMinutes} minutes`);
  console.log(`Watching: deStatusWeb (expecting "Em Andamento")\n`);

  let token = await login();
  let checkCount = 0;

  while (true) {
    checkCount++;
    const now = new Date().toLocaleTimeString();
    process.stdout.write(`[${now}] Check #${checkCount} ... `);

    try {
      let result = await pollExames(token);

      // Auto-refresh token on 401
      if (result.status === 401) {
        console.log("token expired, re-authenticating...");
        token = await login();
        result = await pollExames(token);
      }

      if (!result.deStatusWeb) {
        console.log("deStatusWeb not found in response");
      } else if (result.deStatusWeb === "Em Andamento") {
        console.log(`still "Em Andamento"`);
      } else {
        console.log(`CHANGED -> "${result.deStatusWeb}"`);
        await sendPushover(
          `Exam status changed from "Em Andamento" to "${result.deStatusWeb}"`
        );
        console.log("\nDone - status changed. Exiting.");
        process.exit(0);
      }
    } catch (err) {
      console.log(`ERROR: ${err}`);
    }

    await sleep(intervalMs);
  }
}

main();
