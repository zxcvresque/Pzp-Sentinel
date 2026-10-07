import { readFile, writeFile } from "node:fs/promises";

// Keep display names and usernames out of the deployed access list. Authorization
// uses only immutable Telegram IDs, never a username supplied by a visitor.
function ids(text) {
  return text.split(/\r?\n/).filter((line) => line.trim()).map((line) => {
    const id = line.split("\t")[0].trim();
    if (!/^[1-9]\d{4,19}$/.test(id)) throw new Error("Invalid Telegram ID in member export");
    return id;
  });
}
async function main() {
  const members = await readFile(new URL("./members.txt", import.meta.url), "utf8");
  const bots = await readFile(new URL("./members_bots.txt", import.meta.url), "utf8");
  const excluded = new Set(ids(bots));
  const allowlist = [...new Set(ids(members))].filter((id) => !excluded.has(id)).sort();
  await writeFile(new URL("../src/lib/pzp-member-ids.json", import.meta.url), JSON.stringify(allowlist, null, 2) + "\n");
  console.log(`Saved ${allowlist.length} PzP member IDs for automatic donor access.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
