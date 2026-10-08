/**
 * Cloudflare CI deployment preflight.
 * No token is printed; the generated wrangler.deploy.jsonc is ephemeral on CI.
 */
import fs from "node:fs/promises";
import {pathToFileURL} from "node:url";

const API = "https://api.cloudflare.com/client/v4";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACCOUNT = /^[0-9a-f]{32}$/i;

export function validateCredentials(token, accountId) {
  if (!token || !token.trim()) throw Error("GitHub Actions secret CLOUDFLARE_API_TOKEN is empty.");
  if (token !== token.trim() || /\s/.test(token)) throw Error("CLOUDFLARE_API_TOKEN contains whitespace. Copy a fresh Cloudflare API Token without spaces or line breaks.");
  if (!ACCOUNT.test(accountId || "")) throw Error("CLOUDFLARE_ACCOUNT_ID should be the 32-character Account ID from Cloudflare, not an API key or email.");
}

export function injectDatabaseId(source, id) {
  if (!UUID.test(id || "")) throw Error("Cloudflare returned an invalid D1 database UUID.");
  const config = JSON.parse(source);
  if (!Array.isArray(config.d1_databases)) throw Error("wrangler.jsonc has no d1_databases.");
  const binding = config.d1_databases.find(x => x.binding === "DB" && x.database_name === "managpt");
  if (!binding) throw Error("Expected DB binding with database_name managpt.");
  binding.database_id = id;
  return JSON.stringify(config, null, 2) + "\n";
}

export function findDatabase(records, name) {
  if (!Array.isArray(records)) throw Error("Invalid D1 list response.");
  const matches = records.filter(x => x.name === name && UUID.test(x.uuid || ""));
  if (matches.length !== 1) throw Error(matches.length ? "Multiple matching D1 databases found; choose one manually." : "D1 database not found.");
  return matches[0].uuid;
}

export async function cloudflareRequest(fetchFn, token, endpoint, options = {}) {
  let response;
  try {
    response = await fetchFn(API + endpoint, {
      ...options,
      headers: {"Authorization": "Bearer " + token, "Content-Type": "application/json", ...options.headers},
      signal: AbortSignal.timeout(15000)
    });
  } catch {
    throw Error("Could not reach Cloudflare API. Check network availability.");
  }
  let data;
  try { data = await response.json(); } catch { throw Error("Cloudflare API returned an unreadable response."); }
  const code = data?.errors?.[0]?.code;
  if (!response.ok || data.success !== true) {
    if (code === 9109 || response.status === 401) {
      throw Error("Cloudflare API Token is INVALID (9109/401). Create a new API Token, not the Global API Key, and replace GitHub secret CLOUDFLARE_API_TOKEN.");
    }
    if (code === 10000 || response.status === 403) {
      throw Error("Cloudflare permission denied (10000/403). Check Account ID and API Token scopes: Workers Scripts Edit and D1 Edit for the selected account.");
    }
    throw Error("Cloudflare request failed (" + response.status + ", code " + (code ?? "unknown") + "). Check API Token permissions and account.");
  }
  return data.result;
}

export async function prepareDeployment({token, accountId, fetchFn = fetch, readFile = fs.readFile, writeFile = fs.writeFile}) {
  validateCredentials(token, accountId);
  // Cloudflare has account-owned and user-owned tokens, each with its own verify endpoint.
  let verification;
  try {
    verification = await cloudflareRequest(fetchFn, token, "/accounts/" + accountId + "/tokens/verify");
  } catch (accountError) {
    if (!/INVALID|permission denied/.test(accountError.message)) throw accountError;
    try {
      verification = await cloudflareRequest(fetchFn, token, "/user/tokens/verify");
    } catch (userError) {
      throw Error("Cloudflare rejected this token on both account and user verification endpoints. Replace CLOUDFLARE_API_TOKEN with a fresh active API Token scoped to your Cloudflare account.");
    }
  }
  if (verification?.status !== "active") throw Error("Cloudflare API Token is not active. Issue a new API Token.");
  console.log("Cloudflare API Token: active (token value hidden)");

  const endpoint = "/accounts/" + accountId + "/d1/database";
  const data = await cloudflareRequest(fetchFn, token, endpoint + "?name=managpt&per_page=100");
  const matches = (Array.isArray(data) ? data : []).filter(x => x.name === "managpt");
  let id;
  if (matches.length === 1) {
    id = findDatabase(matches, "managpt");
    console.log("D1: existing managpt database found.");
  } else if (matches.length === 0) {
    console.log("D1: creating managpt database...");
    const created = await cloudflareRequest(fetchFn, token, endpoint, {method:"POST",body:JSON.stringify({name:"managpt"})});
    id = findDatabase([created], "managpt");
    console.log("D1: database created.");
  } else {
    throw Error("Multiple databases named managpt were found; automatic selection aborted.");
  }
  const input = await readFile("wrangler.jsonc", "utf8");
  await writeFile("wrangler.deploy.jsonc", injectDatabaseId(input, id), {mode:0o600});
  console.log("Prepared temporary deployment configuration with verified D1 database binding.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  prepareDeployment({
    token: process.env.CLOUDFLARE_API_TOKEN,
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID
  }).catch(error => {
    console.error("::error::" + error.message);
    process.exitCode = 1;
  });
}
